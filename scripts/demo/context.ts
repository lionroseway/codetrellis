/**
 * What a scene is given: `createContext` builds the `Ctx` for one run, and
 * `tidy` puts back everything the run changed.
 *
 * Two modes. `watch` is the demo a person watches: narration in the window,
 * a beat between steps, verified screenshots. `check` is the same scenes with
 * no window (`tests/e2e/demo-check.test.ts`): narration and pictures do
 * nothing and there is no pause, so CI fails when a scene's tools change
 * under it rather than on the release machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpClient, type ScriptedMcp } from '../../tests/harness/mcp-client';
import { cleanupFixtures, fixtureRoot } from '../demo-fixtures';
import type { DemoOptions } from './options';
import type { AgentBinding, Bridge, Ctx, PersonStep } from './types';
import { collapse, describeSeen, describeWant, meets, seenFrom } from './shots';

export interface ContextDeps {
  /** The demo's own MCP connection, already connected. */
  client: ScriptedMcp;
  token: string;
  mode: 'watch' | 'check';
  /** The HTTP API's base URL. A packaged build serves none; calls then answer null. */
  apiBase: string;
}

export interface RunContext {
  ctx: Ctx;
  /** Everything worth a look, in the order it was noticed. */
  flags: string[];
  /** Put back what the run changed: undo steps last first, files, plans, agents, fixtures. */
  tidy(): Promise<void>;
  /** Restore edited files only — for a crash, when nothing else can be trusted. */
  restoreFiles(): void;
}

export function createContext(opts: DemoOptions, deps: ContextDeps): RunContext {
  const { client, token, mode } = deps;
  const flags: string[] = [];
  const edited = new Map<string, string>();
  /** Projects the demo opened, so the throwaway ones leave the recent list with their folders. */
  const opened = new Set<string>();
  const extraAgents: ScriptedMcp[] = [];
  const bridges: Client[] = [];
  const undo: Array<{ label: string; run: () => unknown }> = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const ctx: Ctx = {
    state: {},
    opts,
    mode,
    edits: () => edited,
    flag: (m) => { flags.push(m); console.log(`    ⚠  ${m}`); },
    beat: async (mult = 1) => { if (mode !== 'check') await sleep(opts.beat * mult); },
    async call(tool, args = {}) {
      if (tool === 'open_project' && typeof args.path === 'string') opened.add(args.path);
      const r = await client.callTool(tool, args);
      // Collapse rather than take the first line: an error whose body is
      // pretty-printed JSON has "{" as its first line, and a flag reading
      // `review_plan: {` says nothing at all.
      if (r.isError) ctx.flag(`${tool}: ${collapse(r.text)}`);
      return { ok: !r.isError, text: r.text, answer: r.answer };
    },
    async refuse(tool, args = {}) {
      const r = await client.callTool(tool, args);
      return { ok: !r.isError, text: r.text, answer: r.answer };
    },
    async json(tool, args = {}) {
      // The tool's own answer: a notice an agent is told is added after it.
      const r = await ctx.call(tool, args);
      try { return JSON.parse(r.answer); } catch { return null; }
    },
    async say(title, text, tone = 'neutral') {
      if (mode === 'check') { console.log(`    · ${title}`); return; }
      await client.callTool('present', { title, text, tone }).catch(() => {});
      await ctx.beat();
    },
    async shot(label, want = {}) {
      if (mode === 'check' || !opts.shots) return;

      // Wait for the window to actually be showing the subject, rather
      // than photographing whatever happens to be there when the beat
      // elapses. Navigation is async and a fixed pause is a guess.
      if (Object.keys(want).length > 0) {
        let seen = seenFrom('');
        for (let attempt = 0; attempt < 16; attempt += 1) {
          seen = seenFrom((await client.callTool('ui_ready', {})).text);
          if (meets(want, seen)) break;
          await sleep(500);
        }
        if (!meets(want, seen)) {
          ctx.flag(`shot "${label}" wanted ${describeWant(want)}; the window showed ${describeSeen(want, seen)} — not captured`);
          return;
        }
        console.log(`    on screen: ${describeSeen(want, seen)}`);
      }

      const r = await client.callTool('screenshot', {});
      const img = r.content.find((x) => x.type === 'image') as { data?: string } | undefined;
      if (!img?.data) { ctx.flag(`screenshot "${label}" came back empty — is the capture capability on?`); return; }
      fs.mkdirSync(opts.shots, { recursive: true });
      fs.writeFileSync(path.join(opts.shots, `${label}.png`), Buffer.from(img.data, 'base64'));
      console.log(`    📸 ${label}`);
    },
    edit(relative, mutate) {
      const abs = path.join(opts.project, relative);
      if (!edited.has(abs)) edited.set(abs, fs.readFileSync(abs, 'utf-8'));
      const before = edited.get(abs)!;
      const after = mutate(before);

      // An edit that changes nothing is the scene not happening.
      //
      // `String.replace` with no match returns the original, silently. The
      // work scene replaced a line that was no longer in the fixture — I
      // had committed the demo's own mutation into it with `git add -A`
      // mid-run — so "do the work" wrote the same bytes back, git reported
      // no change, no line was annotated, and the verdict scene rendered a
      // file with nothing marked while narrating what the marks meant.
      //
      // Every layer said success. Only the screenshot disagreed.
      if (after === before) {
        ctx.flag(`edit to ${relative} changed nothing — the fixture may already contain the edit`);
        return;
      }

      fs.writeFileSync(abs, after);
    },
    async agent(name, binding?: AgentBinding) {
      const extra = createMcpClient({
        mcpPort: opts.mcpPort, capabilityToken: token, clientName: name,
        roots: binding?.roots, cwd: binding?.cwd,
      });
      await extra.connect();
      // A bound agent is placed by its folder, as a person's agent is; naming
      // it through register_session as well is what an unbound one needs.
      if (!binding) await extra.callTool('register_session', { agent_type: name, model: 'demo' });
      extraAgents.push(extra);
      return extra;
    },
    async api(pathAndQuery, body, method) {
      const verb = method ?? (body === undefined ? 'GET' : 'POST');
      try {
        const res = await fetch(`${deps.apiBase}${pathAndQuery}`, {
          method: verb,
          headers: { 'x-codetrellis-token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) { ctx.flag(`${verb} ${pathAndQuery} -> ${res.status}`); return null; }
        const text = await res.text();
        try { return text ? JSON.parse(text) : {}; } catch { return {}; }
      } catch (err) {
        // A packaged build serves the renderer over IPC and binds no TCP
        // port, so there is simply nothing to call. That is the Phase 19
        // posture working, not a fault — flagging it would train us to
        // ignore flags.
        const msg = err instanceof Error ? err.message : String(err);
        if (/fetch failed|ECONNREFUSED/i.test(msg)) {
          console.log(`    (no HTTP API at ${deps.apiBase} — packaged builds are IPC-only; skipping this check)`);
          return null;
        }
        ctx.flag(`${verb} ${pathAndQuery} failed: ${msg}`);
        return null;
      }
    },
    async bridge(clientName, cwd) {
      // The connector reads the port and the token from the data dir on
      // every connect, exactly as it does for Claude Desktop — so this is
      // the path a person's own agent takes, not the demo's shortcut.
      // tsx by absolute path: from a worktree, `--import tsx` cannot find it.
      const tsx = path.join(opts.repo, 'node_modules/tsx/dist/loader.mjs');
      const args = opts.connector
        ? [path.resolve(opts.connector), '--data-dir', opts.dataDir]
        : ['--import', fs.existsSync(tsx) ? tsx : 'tsx', path.join(opts.repo, 'src/backend/mcp/connector/main.ts'), '--data-dir', opts.dataDir];
      const bridged = new Client({ name: clientName, version: 'demo' }, { capabilities: {} });
      await bridged.connect(new StdioClientTransport({ command: process.execPath, args, cwd: cwd ?? opts.repo, stderr: 'pipe' }));
      bridges.push(bridged);
      const call: Bridge['call'] = async (tool, a = {}) => {
        const r = await bridged.callTool({ name: tool, arguments: a }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
        const texts = (r.content ?? []).filter((x) => x.type === 'text').map((x) => x.text ?? '');
        const text = texts.join('\n');
        if (r.isError) ctx.flag(`${clientName} ${tool}: ${collapse(text)}`);
        return { ok: !r.isError, text, answer: texts[0] ?? '' };
      };
      return {
        call,
        async json(tool, a) {
          const r = await call(tool, a);
          try { return JSON.parse(r.answer); } catch { return null; }
        },
      };
    },
    defer(label, run) {
      undo.push({ label, run });
    },
    async until(probe, seconds, what) {
      const deadline = Date.now() + seconds * 1000;
      for (;;) {
        const value = await probe();
        if (value) return value;
        if (Date.now() >= deadline) {
          if (what) ctx.flag(`waited ${seconds}s for ${what}; it never came`);
          return null;
        }
        await sleep(500);
      }
    },
    async person(step: PersonStep) {
      // A person's step: something only the window can do (set a breakpoint,
      // mark an overlap intended). With --decide (or in check mode) the demo
      // stands in through the desktop's own HTTP route; otherwise it asks,
      // and waits for the result to show.
      if ((opts.decide || mode === 'check') && step.decide) {
        await step.decide();
      } else {
        await ctx.say('Your turn', `${step.ask} Waiting up to ${opts.personWaitS}s.`, 'question');
      }
      const done = await ctx.until(step.done, mode === 'check' ? 30 : opts.personWaitS);
      if (!done) ctx.flag(`nobody did "${step.ask}" — run again and do it in the window, or pass --decide on a dev build`);
      return Boolean(done);
    },
  };

  async function archive(uid: string) {
    // A plan cannot be deleted by an agent (a person types its name), so
    // the demo archives what it made. `delete_plan` was removed in Phase 32
    // §0.4c, and calling it here failed silently, leaving every run's plans.
    await client.callTool('update_plan', { plan_uid: uid, status: 'archived' }).catch(() => {});
  }

  return {
    ctx,
    flags,
    restoreFiles() {
      for (const [abs, original] of edited) fs.writeFileSync(abs, original);
    },
    async tidy() {
      console.log(`${'─'.repeat(66)}\nTidying up`);
      for (const step of undo.reverse()) {
        try { await step.run(); console.log(`   ${step.label}`); } catch (err) {
          console.log(`   ${step.label}: ${err instanceof Error ? err.message : err}`);
        }
      }
      for (const [abs, original] of edited) {
        fs.writeFileSync(abs, original);
        console.log('   restored', path.relative(opts.project, abs));
      }
      if (ctx.state.term) await client.callTool('terminal_kill', { session_id: ctx.state.term }).catch(() => {});
      for (const key of ['plan', 'historyPlan', 'briefPlan'] as const) {
        if (ctx.state[key]) { await archive(ctx.state[key]); console.log(`   archived the ${key === 'plan' ? 'demo' : key === 'briefPlan' ? 'brief' : 'history'} plan`); }
      }
      for (const b of bridges) await b.close().catch(() => {});
      if (ctx.state.doc) {
        await client.callTool('delete_system_doc', { uid: ctx.state.doc }).catch(() => {});
        console.log('   deleted the demo system doc');
      }
      for (const extra of extraAgents) await extra.disconnect().catch(() => {});
      if (mode === 'watch') await client.callTool('dismiss_presence', {}).catch(() => {});
      // Some journeys open a throwaway repo. Put the user back where they
      // started before the fixtures are deleted underneath the app.
      await client.callTool('open_project', { path: opts.project }).catch(() => {});
      await client.callTool('rescan_project', { project_path: opts.project }).catch(() => {});
      // And forget them. The folders are deleted below, and each run used to
      // leave a recent project pointing at one — three runs, three dead
      // `q3-regional-review` entries in the list a person opens projects from.
      const throwaway = fixtureRoot();
      for (const p of opened) {
        if (throwaway && p.startsWith(throwaway)) await client.callTool('remove_recent_project', { project_path: p }).catch(() => {});
      }
      if (fixtureRoot()) console.log('   removed the throwaway fixtures');
      cleanupFixtures();
    },
  };
}
