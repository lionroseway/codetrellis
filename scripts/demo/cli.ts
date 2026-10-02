/**
 * The demo's runner: connect to the running app, check the window can be
 * watched, play the picked scenes, then put everything back. The scenes
 * themselves live in `groups/`, one module per group, listed in
 * `registry.ts`; the entry point is `scripts/demo.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpClient, type ScriptedMcp } from '../../tests/harness/mcp-client';
import { cleanupFixtures, fixtureRoot } from '../demo-fixtures';
import type { DemoOptions } from './options';
import type { Bridge, Ctx, Group, Scene } from './types';
import { collapse, describeSeen, describeWant, meets, seenFrom } from './shots';
import { DEFAULT_GROUP, GROUPS } from './registry';

const flagged: string[] = [];
const edited = new Map<string, string>();
/** Projects the demo opened, so the throwaway ones leave the recent list with their folders. */
const opened = new Set<string>();
const extraAgents: ScriptedMcp[] = [];
const bridges: Client[] = [];

/**
 * The scenes a run will play. `--scene` looks in every group (or the named
 * ones); `--group` plays those groups in registry order; `--all` plays every
 * group; nothing plays the default group, which is what `npm run demo`
 * always did.
 */
export function pickScenes(opts: DemoOptions): { scenes: Scene[] } | { error: string } {
  const all = opts.argv.includes('--all');
  let groups: Group[];
  if (opts.groups) {
    const unknown = opts.groups.filter((id) => !GROUPS.some((g) => g.id === id));
    if (unknown.length) return { error: `No group called ${unknown.map((u) => `"${u}"`).join(', ')}.` };
    groups = GROUPS.filter((g) => opts.groups!.includes(g.id));
  } else if (all || opts.scene) {
    groups = GROUPS;
  } else {
    groups = GROUPS.filter((g) => g.id === DEFAULT_GROUP);
  }
  const scenes = groups.flatMap((g) => g.scenes).filter((s) => !opts.scene || s.id === opts.scene);
  if (scenes.length === 0) return { error: opts.scene ? `No scene called "${opts.scene}".` : 'Those groups have no scenes.' };
  return { scenes };
}

export async function main(opts: DemoOptions): Promise<void> {
  if (opts.list) {
    for (const g of GROUPS) {
      console.log(`\n${g.id}${g.id === DEFAULT_GROUP ? ' (the default)' : ''} — ${g.title}\n`);
      for (const s of g.scenes) console.log(`  ${s.id.padEnd(10)} ${s.title}`);
    }
    console.log('\n  npm run demo -- --group=<id>[,<id>] | --all | --scene=<id>\n');
    return;
  }

  // Which scenes, before anything connects: a typo should not need the app.
  const picked = pickScenes(opts);
  if ('error' in picked) {
    console.error(`\n${picked.error} Try --list.\n`);
    process.exit(1);
  }
  const scenes = picked.scenes;

  const tokenPath = path.join(opts.dataDir, 'capability-token');
  if (!fs.existsSync(tokenPath)) {
    console.error(`\nNo capability token at ${tokenPath}.`);
    console.error('Is CodeTrellis running? Point at its data dir with --data-dir=…\n');
    process.exit(1);
  }
  const token = fs.readFileSync(tokenPath, 'utf-8').trim();

  let mcp: ScriptedMcp | null = null;
  try {
    mcp = createMcpClient({ mcpPort: opts.mcpPort, capabilityToken: token, clientName: 'codetrellis-demo' });
    await mcp.connect();
  } catch (err) {
    console.error(`\nCould not reach the MCP server on :${opts.mcpPort} — is the app running?`);
    console.error(String(err instanceof Error ? err.message : err), '\n');
    process.exit(1);
  }

  const client = mcp;
  await client.callTool('register_session', { agent_type: 'codetrellis-demo', model: 'demo' });

  const ctx: Ctx = {
    state: {},
    opts,
    edits: () => edited,
    flag: (m) => { flagged.push(m); console.log(`    ⚠  ${m}`); },
    beat: (mult = 1) => new Promise((r) => setTimeout(r, opts.beat * mult)),
    async call(tool, args = {}) {
      if (tool === 'open_project' && typeof args.path === 'string') opened.add(args.path);
      const r = await client.callTool(tool, args);
      // Collapse rather than take the first line: an error whose body is
      // pretty-printed JSON has "{" as its first line, and a flag reading
      // `review_plan: {` says nothing at all.
      if (r.isError) ctx.flag(`${tool}: ${collapse(r.text)}`);
      return { ok: !r.isError, text: r.text };
    },
    async refuse(tool, args = {}) {
      const r = await client.callTool(tool, args);
      return { ok: !r.isError, text: r.text };
    },
    async json(tool, args = {}) {
      const r = await ctx.call(tool, args);
      try { return JSON.parse(r.text); } catch { return null; }
    },
    async say(title, text, tone = 'neutral') {
      await client.callTool('present', { title, text, tone }).catch(() => {});
      await ctx.beat();
    },
    async shot(label, want = {}) {
      if (!opts.shots) return;

      // Wait for the window to actually be showing the subject, rather
      // than photographing whatever happens to be there when the beat
      // elapses. Navigation is async and a fixed pause is a guess.
      if (Object.keys(want).length > 0) {
        let seen = seenFrom('');
        for (let attempt = 0; attempt < 16; attempt += 1) {
          seen = seenFrom((await client.callTool('ui_ready', {})).text);
          if (meets(want, seen)) break;
          await new Promise((r) => setTimeout(r, 500));
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
    async agent(name) {
      const extra = createMcpClient({ mcpPort: opts.mcpPort, capabilityToken: token, clientName: name });
      await extra.connect();
      await extra.callTool('register_session', { agent_type: name, model: 'demo' });
      extraAgents.push(extra);
      return extra;
    },
    async api(pathAndQuery, body) {
      const method = body === undefined ? 'GET' : 'POST';
      try {
        const res = await fetch(`http://127.0.0.1:${opts.apiPort}${pathAndQuery}`, body === undefined
          ? { headers: { 'x-codetrellis-token': token } }
          : {
            method,
            headers: { 'x-codetrellis-token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        if (!res.ok) { ctx.flag(`${method} ${pathAndQuery} -> ${res.status}`); return null; }
        return await res.json();
      } catch (err) {
        // A packaged build serves the renderer over IPC and binds no TCP
        // port, so there is simply nothing to call. That is the Phase 19
        // posture working, not a fault — flagging it would train us to
        // ignore flags.
        const msg = err instanceof Error ? err.message : String(err);
        if (/fetch failed|ECONNREFUSED/i.test(msg)) {
          console.log(`    (no HTTP API on :${opts.apiPort} — packaged builds are IPC-only; skipping this check)`);
          return null;
        }
        ctx.flag(`${method} ${pathAndQuery} failed: ${msg}`);
        return null;
      }
    },
    async bridge(clientName) {
      // The connector reads the port and the token from the data dir on
      // every connect, exactly as it does for Claude Desktop — so this is
      // the path a person's own agent takes, not the demo's shortcut.
      const args = opts.connector
        ? [path.resolve(opts.connector), '--data-dir', opts.dataDir]
        : ['--import', 'tsx', path.join(opts.repo, 'src/backend/mcp/connector/main.ts'), '--data-dir', opts.dataDir];
      const bridged = new Client({ name: clientName, version: 'demo' }, { capabilities: {} });
      await bridged.connect(new StdioClientTransport({ command: process.execPath, args, cwd: opts.repo, stderr: 'pipe' }));
      bridges.push(bridged);
      const call: Bridge['call'] = async (tool, a = {}) => {
        const r = await bridged.callTool({ name: tool, arguments: a }) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
        const text = (r.content ?? []).filter((x) => x.type === 'text').map((x) => x.text ?? '').join('\n');
        if (r.isError) ctx.flag(`${clientName} ${tool}: ${collapse(text)}`);
        return { ok: !r.isError, text };
      };
      return {
        call,
        async json(tool, a) {
          const r = await call(tool, a);
          try { return JSON.parse(r.text); } catch { return null; }
        },
      };
    },
  };

  // ── Preflight: is anyone actually looking at the product? ──────────
  //
  // This exists because a full run once reported "Nothing looked wrong"
  // across twenty-four scenes against an app that had never mounted. The
  // first-run wizard rendered in place of the shell, the backend answered
  // every call correctly, and every screenshot was of a sign-up form.
  //
  // A demo that cannot tell the window is blocked is worth less than no
  // demo, because it converts "unverified" into "verified" without doing
  // any verifying. So this refuses to start rather than producing a green
  // run nobody should trust.
  const readyRaw = await client.callTool('ui_ready', {});
  let ready: { ready?: boolean; shellMounted?: boolean; blockedBy?: string[]; projectOpen?: boolean } | null = null;
  try { ready = JSON.parse(readyRaw.text); } catch { /* reported below */ }

  if (!ready || ready.ready !== true) {
    console.error('\n  The window is not in a state anyone could watch.\n');
    if (!ready) {
      console.error(`  ${readyRaw.text.replace(/\s+/g, ' ').slice(0, 160)}`);
    } else if (!ready.shellMounted) {
      console.error('  The app shell is not mounted — something is rendering instead of it.');
    } else if (ready.blockedBy?.length) {
      console.error(`  A dialog is covering it: ${ready.blockedBy.join(', ')}`);
    }
    console.error('\n  Nothing was run. Clear the window and try again.\n');
    await client.disconnect().catch(() => {});
    process.exit(1);
  }

  console.log(`\n  CodeTrellis demo · ${opts.project}`);
  console.log(`  pace: ${opts.pace} · scenes: ${scenes.map((s) => s.id).join(', ')}\n`);

  try {
    for (const [i, scene] of scenes.entries()) {
      console.log(`${'─'.repeat(66)}\n${i + 1}. ${scene.title}\n   watch: ${scene.watch}`);
      await scene.run(ctx);
    }
  } finally {
    console.log(`${'─'.repeat(66)}\nTidying up`);
    for (const [abs, original] of edited) {
      fs.writeFileSync(abs, original);
      console.log('   restored', path.relative(opts.project, abs));
    }
    if (ctx.state.term) await client.callTool('terminal_kill', { session_id: ctx.state.term }).catch(() => {});
    if (ctx.state.plan) {
      await client.callTool('delete_plan', { plan_uid: ctx.state.plan }).catch(() => {});
      console.log('   deleted the demo plan');
    }
    if (ctx.state.historyPlan) {
      await client.callTool('delete_plan', { plan_uid: ctx.state.historyPlan }).catch(() => {});
    }
    if (ctx.state.briefPlan) {
      await client.callTool('delete_plan', { plan_uid: ctx.state.briefPlan }).catch(() => {});
      console.log('   deleted the brief plan');
    }
    for (const b of bridges) await b.close().catch(() => {});
    if (ctx.state.doc) {
      await client.callTool('delete_system_doc', { uid: ctx.state.doc }).catch(() => {});
      console.log('   deleted the demo system doc');
    }
    for (const extra of extraAgents) await extra.disconnect().catch(() => {});
    await client.callTool('dismiss_presence', {}).catch(() => {});
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
    await client.disconnect().catch(() => {});
    if (fixtureRoot()) console.log('   removed the throwaway fixtures');
    cleanupFixtures();

    console.log('\n' + '='.repeat(66));
    if (flagged.length === 0) console.log('Nothing looked wrong.');
    else {
      console.log(`${flagged.length} thing(s) worth a look:`);
      flagged.forEach((f, i) => console.log(` ${i + 1}. ${f}`));
    }
    console.log('');
  }
}

/** If the run dies, put back what it changed before saying so. */
export function onCrash(err: unknown): never {
  for (const [abs, original] of edited) fs.writeFileSync(abs, original);
  cleanupFixtures();
  console.error('\nDemo stopped:', err instanceof Error ? err.message : err);
  console.error('Any edited files were restored.\n');
  process.exit(1);
}
