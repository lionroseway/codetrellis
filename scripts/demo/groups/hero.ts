/**
 * The hero video's own scenes (docs/website/hero-video.md): the moments the
 * other groups do not stage. Agents connecting one after another, a burst of
 * work from three at once, a teammate's branch in the same picture as the
 * agents, a serious overlap holding an agent's next step, a freeze, and
 * catching up: the digest, then the app taking you to what happened.
 * Recorded by `video/capture/demo.sh hero-hd --group=hero`. Catalogued in
 * `docs/DEMO-JOURNEYS.md`, section `hero`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ScriptedMcp } from '../../../tests/harness/mcp-client';
import { sampleAppRepo, type ParallelFixture } from '../../demo-fixtures';
import type { Ctx, Group } from '../types';

const V = 'packages/shared/src/validators.ts';
const UL = 'packages/web/src/UserList.tsx';
const NOTICE = '── CodeTrellis awareness ──';
/** The teammate's branch: a person's committed work, in no worktree here. */
const TEAMMATE = 'dana/signup-copy';

interface Signal {
  id: string; kind: string; severity: string; summary: string; state: string;
  workstreams?: string[];
  subject: { file?: string; symbol?: string };
}

let fx: ParallelFixture;
let codex: ScriptedMcp;
let claude: ScriptedMcp;
let cursor: ScriptedMcp;
let planUid = '';

/** The three agents, connected in `connect`; connected here if a scene runs alone. */
async function agents(c: Ctx): Promise<void> {
  codex ??= await c.agent('codex', { roots: [fx.trees['billing-v2']] });
  claude ??= await c.agent('claude-code', { roots: [fx.trees['checkout-fix']] });
  cursor ??= await c.agent('cursor', { roots: [fx.trees['auth-refresh']] });
}

const same = (a: string, b: string) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return a === b; }
};

async function signals(c: Ctx): Promise<Signal[]> {
  const body = await c.json('get_awareness', { project_path: fx.path });
  return Array.isArray(body?.signals) ? body.signals : [];
}

function first(text: string): Record<string, unknown> {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
}

async function addItem(c: Ctx, title: string, file: string): Promise<string> {
  const item = await c.json('add_item', { plan_uid: planUid, kind: 'action', title, file_specs: [{ path: file, action: 'modify' }] });
  if (!item?.uid) c.flag(`add_item "${title}" returned no uid`);
  return item?.uid ?? '';
}

export const heroGroup: Group = {
  id: 'hero',
  title: 'The hero video\'s moments',
  async setup(c) {
    fx = sampleAppRepo('hero', ['auth-refresh', 'billing-v2', 'checkout-fix']);
    await c.call('open_project', { path: fx.path });
    await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
    const plan = await c.json('create_plan', { title: 'Signup and billing', project_path: fx.path });
    planUid = plan?.uid ?? '';
    if (!planUid) c.flag('create_plan returned no uid');
    else c.defer('archived the hero plan', () => c.call('update_plan', { plan_uid: planUid, status: 'archived' }));
  },
  scenes: [
    {
      id: 'connect',
      title: 'Any agent connects',
      watch: 'Codex, Claude Code and Cursor connect one after another; each lands in the top bar with its branch',
      async run(c) {
        await c.call('navigate_to', { target: 'graph' });
        await c.say('Connect any agent', 'Anything that speaks MCP: Codex, Claude Code, Cursor. Each one shows up with the work it is in.');
        codex = await c.agent('codex', { roots: [fx.trees['billing-v2']] });
        await c.beat(0.5);
        claude = await c.agent('claude-code', { roots: [fx.trees['checkout-fix']] });
        await c.beat(0.5);
        cursor = await c.agent('cursor', { roots: [fx.trees['auth-refresh']] });
        const seen = await c.until(async () => {
          const ws: Array<{ root: string; agents: unknown[] }> = (await c.json('list_workstreams', { project_path: fx.path, include_idle: true }))?.workstreams ?? [];
          const has = (tree: string) => ws.find((w) => same(w.root, fx.trees[tree]))?.agents.length;
          return has('billing-v2') && has('checkout-fix') && has('auth-refresh');
        }, 15, 'all three agents in their lines of work');
        if (seen) console.log('    three agents, one in each line of work');
        await c.beat();
      },
    },
    {
      id: 'map',
      title: 'The map, however complex the system',
      watch: 'the graph from packages down to files, the web app\'s calls drawn to the Python routes they reach, then one file opened into its symbols',
      async run(c) {
        await c.call('navigate_to', { target: 'graph' });
        await c.call('graph_set_scope', { scope_path: fx.path });
        await c.say('One map of the whole system', 'Packages, files and symbols in thirteen languages, and the HTTP and SQL that join services written in different ones.');
        for (const depth of ['package', 'file'] as const) {
          await c.call('graph_set_depth', { depth });
          await c.beat();
        }
        await c.call('graph_focus', { path: path.join(fx.path, 'packages/web/src/api.ts'), highlight: true });
        await c.beat(1.5);
        await c.call('graph_set_depth', { depth: 'file' });
      },
    },
    {
      id: 'flood',
      title: 'Three agents at once, faster than anyone reads',
      watch: 'the Timeline fills with calls from three agents and files change in three worktrees, faster than you could read them',
      async run(c) {
        await agents(c);
        // The graph in Live mode: nodes light up where the three agents edit.
        await c.call('navigate_to', { target: 'graph' });
        await c.call('graph_set_mode', { mode: 'live' });
        const work: Array<[ScriptedMcp, string, string[]]> = [
          [codex, 'billing-v2', ['services/billing', V, 'packages/shared/src/types.ts']],
          [claude, 'checkout-fix', [UL, 'packages/web/src/OrderList.tsx', 'packages/web/src/api.ts']],
          [cursor, 'auth-refresh', ['packages/shared/src/index.ts', 'packages/web/src/main.tsx', V]],
        ];
        // Ordinary calls an agent makes while it works, interleaved, with
        // small edits landing in each worktree as it goes.
        for (let round = 0; round < 6; round += 1) {
          await Promise.all(work.map(async ([agent, tree, files]) => {
            const file = files[round % files.length];
            await agent.callTool('check_footprint', { paths: [file] });
            await agent.callTool('list_plans', {});
            const abs = path.join(fx.trees[tree], file);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) fs.appendFileSync(abs, `\n// ${tree}: pass ${round + 1}\n`);
            await agent.callTool('get_awareness', { project_path: fx.path });
          }));
          await c.beat(0.15);
        }
        await c.say('Faster than you can read it', 'Three agents, three lines of work, a call every few hundred milliseconds. This is what keeping up means.');
        fx.resetAll();
      },
    },
    {
      id: 'teammate',
      title: 'A teammate\'s branch beside the agents',
      watch: 'Dana\'s branch shows as a line of work with no agent; Codex changing the same function overlaps it, and Codex is told on its next call',
      async run(c) {
        await agents(c);
        // Dana committed on her own branch: no worktree here, just the commit.
        const tmp = `${fx.path}-dana`;
        execFileSync('git', ['-C', fx.path, 'worktree', 'add', '-q', tmp, '-b', TEAMMATE]);
        const vAbs = path.join(tmp, V);
        fs.writeFileSync(vAbs, fs.readFileSync(vAbs, 'utf-8').replace('return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim().toLowerCase());'));
        execFileSync('git', ['-C', tmp, '-c', 'user.name=Dana Kim', '-c', 'user.email=dana@example.test', 'commit', '-qam', 'Accept emails with stray spaces']);
        execFileSync('git', ['-C', fx.path, 'worktree', 'remove', '--force', tmp]);
        c.defer(`removed ${TEAMMATE}`, () => execFileSync('git', ['-C', fx.path, 'branch', '-D', TEAMMATE]));

        await c.call('navigate_to', { target: 'graph' });
        await c.call('navigate_to', { target: 'awareness' });
        await c.say('Your teammates too', 'Dana is a person, on her own branch. Her work is a line of work like any agent\'s.');
        fx.edit('billing-v2', V, 'return EMAIL_RE.test(email);', 'return email.length > 3 && EMAIL_RE.test(email);');
        const dana = (s: Signal) => JSON.stringify(s).includes('signup-copy');
        const hit = await c.until(async () => (await signals(c)).find((s) => s.kind === 'collision' && s.subject.symbol === 'isValidEmail' && dana(s)), 25, `the overlap between billing-v2 and ${TEAMMATE}`);
        if (hit) console.log(`    overlap: ${hit.summary.slice(0, 140)}`);
        if (hit) {
          await c.call('navigate_to', { target: 'awareness', signal_id: hit.id });
          const told = await c.until(async () => {
            const text = (await codex.callTool('list_plans', {})).text;
            return text.includes(NOTICE) ? text : null;
          }, 15, 'Codex to be told about the overlap');
          if (told) console.log(`    codex told: ${told.slice(told.indexOf(NOTICE)).split('\n').slice(1, 2).join(' ').slice(0, 120)}`);
          await c.say('Everyone knows', 'You see it here. Codex was told on its next call. Dana sees it when she opens CodeTrellis.');
        }
        fx.reset('billing-v2');
      },
    },
    {
      id: 'hold',
      title: 'A serious overlap holds the next step',
      watch: 'with "ask me when there is a contract change" set, Codex\'s next claim waits in Needs you until you answer',
      async run(c) {
        await agents(c);
        const signup = await addItem(c, 'Signup form validation', UL);
        await c.person({
          ask: 'In Awareness, add the rule "Ask me when there is a contract change".',
          decide: async () => {
            const r = await c.api('/api/breakpoints', { kind: 'signal', signal: 'contract', note: 'Contract changes need me' });
            if (r?.breakpoint?.id) c.state.signalRule = r.breakpoint.id;
          },
          done: async () => Boolean(c.state.signalRule) || ((await c.api('/api/breakpoints'))?.breakpoints ?? []).some((b: { kind: string }) => b.kind === 'signal'),
        });
        if (c.state.signalRule) c.defer('removed the contract rule', () => c.api(`/api/breakpoints/${c.state.signalRule}`, undefined, 'DELETE'));

        // checkout-fix's page imports the validator; billing-v2 changes what it takes.
        fx.edit('checkout-fix', UL, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
        fx.edit('billing-v2', V, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
        await c.say('A contract change', 'billing-v2 adds a parameter to validateCreateUser. checkout-fix\'s page calls it.');
        const contract = await c.until(async () => (await signals(c)).find((s) => s.kind === 'contract' && s.severity === 'high'), 25, 'the high contract signal');
        if (!contract) { fx.resetAll(); return; }

        await c.call('navigate_to', { target: 'graph' });
        const held = first((await claude.callTool('claim_item', { uid: signup })).answer);
        const ref = typeof held.ref === 'string' ? held.ref : '';
        if (!held.paused || !ref) { c.flag(`claude's claim should wait on the contract rule; it said ${JSON.stringify(held).slice(0, 160)}`); fx.resetAll(); return; }
        await c.call('navigate_to', { target: 'awareness', breakpoint_ref: ref });
        await c.say('It waits for you', 'Claude Code\'s next step waits in Needs you, with why. Nothing is claimed until you answer.');
        await c.person({
          ask: 'In Needs you, answer the held claim with "Continue with steer" and "Pass strict: false until billing merges".',
          decide: () => c.api(`/api/breakpoint-hits/${ref}/answer`, { decision: 'steer', note: 'Pass strict: false until billing merges' }),
          done: async () => !(((await c.api('/api/breakpoint-hits'))?.hits ?? []) as Array<{ ref: string }>).some((h) => h.ref === ref),
        });
        fx.resetAll();
      },
    },
    {
      id: 'freeze',
      title: 'Release week: freeze',
      watch: 'the freeze bar across the plan; Cursor checks before starting and is told this plan is frozen',
      async run(c) {
        await agents(c);
        await c.call('set_freeze', { project_path: fx.path, active: true, reason: 'Release 2.3: fixes only' });
        c.defer('lifted the freeze', () => c.call('set_freeze', { project_path: fx.path, active: false }));
        await c.call('navigate_to', { target: 'plan', plan_uid: planUid });
        await c.say('Release week', 'Freeze the project and exempt the plans that matter. Agents check before they start anything new.');
        // The freeze is the agents' to respect: the guide tells them to check
        // before claiming, and this is that check.
        const r = first((await cursor.callTool('check_freeze', { project_path: fx.path, plan_uid: planUid })).answer);
        if (r.allowed !== false || r.freezeActive !== true) c.flag(`check_freeze during a freeze should say not allowed; it said ${JSON.stringify(r).slice(0, 160)}`);
        else console.log(`    cursor checked: frozen (${String(r.reason)})`);
        await c.beat();
      },
    },
    {
      id: 'catch-up',
      title: 'Catch up, and be shown',
      watch: 'the digest in Awareness, then the window moves on its own: the overlap, the line in the code, the last few minutes replayed',
      async run(c) {
        fx.edit('auth-refresh', V, 'return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());');
        fx.edit('billing-v2', V, 'return EMAIL_RE.test(email);', 'return email.length > 3 && EMAIL_RE.test(email);');
        const hit = await c.until(async () => (await signals(c)).find((s) => s.kind === 'collision' && s.subject.symbol === 'isValidEmail'), 25, 'an overlap to catch up on');
        await c.call('navigate_to', { target: 'graph' });
        await c.call('navigate_to', { target: 'awareness' });
        await c.say('What happened while I was away?', 'The digest first: who overlaps, what changed, whether the agents were told, what you are asked.');
        if (hit) {
          await c.say('Show me', 'Your agent takes you there. The overlap…', 'neutral');
          await c.call('navigate_to', { target: 'awareness', signal_id: hit.id });
          await c.beat();
          await c.say('…the line…', 'The function both lines of work changed, in the code.');
          // The opened project's own copy: a worktree's path is outside it.
          await c.call('navigate_to', { target: 'code', file_path: path.join(fx.path, V), line: 5 });
          await c.beat();
        }
        await c.say('…and the last few minutes', 'Replayed at four times speed, then back to now. Showing only: nothing here decides anything for you.');
        await c.call('navigate_to', { target: 'replay', from: Date.now() - 4 * 60_000, speed: 4 });
        await c.beat(2);
        await c.call('navigate_to', { target: 'live' });
        await c.call('navigate_to', { target: 'graph' });
        fx.resetAll();
      },
    },
  ],
};
