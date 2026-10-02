/**
 * Many agents at once (Phase 32 Track A): each in its own line of work,
 * told when their work collides, quiet when it is meant, and stopped where a
 * person asked to be asked. Mirrors the harness tests `workstreams`,
 * `awareness`, `awareness-notices`, `declare-intent`, `awareness-m3` and
 * `code-breakpoints`, against the running app. Catalogued in
 * `docs/DEMO-JOURNEYS.md`, section `parallel`.
 */
import fs from 'node:fs';
import type { ScriptedMcp } from '../../../tests/harness/mcp-client';
import { sampleAppRepo, type ParallelFixture } from '../../demo-fixtures';
import { runHook } from '../lib/hook';
import type { Ctx, Group } from '../types';

const V = 'packages/shared/src/validators.ts';
const UL = 'packages/web/src/UserList.tsx';
const NOTICE = '── CodeTrellis awareness ──';
const BREAKPOINT_NOTICE = 'CodeTrellis breakpoint';

interface Signal {
  id: string; kind: string; severity: string; summary: string; state: string;
  subject: { file?: string; symbol?: string };
  told?: Array<{ agentType: string; note?: string }>;
}

let fx: ParallelFixture;
/** Works in `billing-v2`. */
let codex: ScriptedMcp;
/** Works in `checkout-fix`, whose page imports the shared validators. */
let claude: ScriptedMcp;

const same = (a: string, b: string) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return a === b; }
};

async function signals(c: Ctx): Promise<Signal[]> {
  const body = await c.json('get_awareness', { project_path: fx.path });
  return Array.isArray(body?.signals) ? body.signals : [];
}

/** An ordinary call an agent would make anyway, and everything that came back with it. */
async function ordinary(agent: ScriptedMcp): Promise<string> {
  return (await agent.callTool('list_plans', {})).text;
}

export const parallelGroup: Group = {
  id: 'parallel',
  title: 'Many agents at once',
  async setup(c) {
    fx = sampleAppRepo('parallel', ['auth-refresh', 'billing-v2', 'checkout-fix']);
    await c.say('A repository with three lines of work', 'auth-refresh, billing-v2 and checkout-fix, each a worktree of the same app.');
    await c.call('open_project', { path: fx.path });
    // Listing them is what starts their watchers, as the window's strip does.
    await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
    codex = await c.agent('codex', { roots: [fx.trees['billing-v2']] });
    claude = await c.agent('claude-code', { roots: [fx.trees['checkout-fix']] });
  },
  scenes: [
    {
      id: 'lines',
      title: 'Two agents, each in its own line of work',
      watch: 'two chips in the top bar, each with its branch and its agent',
      async run(c) {
        await c.call('navigate_to', { target: 'graph' });
        await c.say('Each agent in its own worktree', 'Codex works in billing-v2, Claude Code in checkout-fix. Each chip names its branch and its agent.');
        const seen = await c.until(async () => {
          const body = await c.json('list_workstreams', { project_path: fx.path, include_idle: true });
          const ws: Array<{ root: string; agents: unknown[] }> = body?.workstreams ?? [];
          const billing = ws.find((w) => same(w.root, fx.trees['billing-v2']));
          const checkout = ws.find((w) => same(w.root, fx.trees['checkout-fix']));
          return billing?.agents.length && checkout?.agents.length ? ws : null;
        }, 15, 'both agents to show in their lines of work');
        if (seen) console.log(`    ${seen.length} lines of work, an agent in each of billing-v2 and checkout-fix`);
        const own = JSON.parse((await codex.callTool('list_workstreams', {})).answer) as { workstreams: Array<{ root: string; yours?: boolean }> };
        const yours = own.workstreams.filter((w) => w.yours);
        if (yours.length !== 1 || !same(yours[0].root, fx.trees['billing-v2'])) c.flag(`codex should see billing-v2 as its own line of work; it sees ${yours.map((w) => w.root).join(', ') || 'none'}`);
        await c.shot('p1-lines');
      },
    },
    {
      id: 'overlap',
      title: 'Two lines of work change the same function',
      watch: 'one high overlap in Awareness naming isValidEmail; it clears when one side reverts',
      async run(c) {
        fx.edit('auth-refresh', V, 'return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());');
        fx.edit('billing-v2', V, 'return EMAIL_RE.test(email);', 'return email.length > 3 && EMAIL_RE.test(email);');
        await c.call('navigate_to', { target: 'awareness' });
        await c.say('Both change isValidEmail', 'auth-refresh and billing-v2 edit the same function. Awareness says so, once, naming it.');
        const hit = await c.until(async () => (await signals(c)).find((s) => s.kind === 'collision' && s.subject.symbol === 'isValidEmail'), 20, 'the overlap on isValidEmail');
        if (hit && hit.severity !== 'high') c.flag(`the same function in two lines of work should be high; it is ${hit.severity}`);
        const fp = JSON.parse((await codex.callTool('check_footprint', { paths: [V] })).answer) as { paths: Array<{ changed_in: Array<{ branch: string }> }> };
        const others = fp.paths[0]?.changed_in.map((x) => x.branch) ?? [];
        if (!others.includes('auth-refresh')) c.flag(`codex's check_footprint should name auth-refresh; it names ${others.join(', ') || 'nobody'}`);
        if (hit) await c.call('navigate_to', { target: 'awareness', signal_id: hit.id });
        await c.shot('p2-overlap', hit ? { highlighted: hit.id } : {});

        await c.say('One side reverts', 'auth-refresh puts the function back. The overlap goes on its own.');
        fx.reset('auth-refresh');
        await c.until(async () => !(await signals(c)).some((s) => s.kind === 'collision' && s.subject.symbol === 'isValidEmail'), 20, 'the overlap to clear');
        fx.reset('billing-v2');
      },
    },
    {
      id: 'contract',
      title: 'Told without asking, once',
      watch: 'Claude Code is told on its next call that billing-v2 changed a function its page uses; nothing on the call after',
      async run(c) {
        // checkout-fix's work touches the page that imports the validator.
        fx.edit('checkout-fix', UL, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
        await c.say('A change inside a function', 'billing-v2 changes only the body of validateCreateUser. Nobody else needs to know.');
        fx.edit('billing-v2', V, "errors.push('name is required');", "errors.push('name is required (billing)');");
        for (let i = 0; i < 4; i += 1) {
          if ((await ordinary(claude)).includes(NOTICE)) { c.flag('a body-only change told another agent; it should tell nobody'); break; }
          await c.beat(0.3);
        }
        await c.say('A change to what it takes', 'Now billing-v2 adds a parameter. Claude Code is told on its very next call, without asking.');
        fx.edit('billing-v2', V, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
        const told = await c.until(async () => {
          const text = await ordinary(claude);
          return text.includes(NOTICE) ? text : null;
        }, 20, 'Claude Code to be told about the changed signature');
        if (told) {
          console.log(`    told: ${told.slice(told.indexOf(NOTICE)).split('\n').slice(1, 3).join(' ').slice(0, 140)}`);
          if (!told.includes('not an instruction')) c.flag('the notice should say it is information, not an instruction');
          if ((await ordinary(claude)).includes(NOTICE)) c.flag('the same notice came twice');
        }
        const contract = (await signals(c)).find((s) => s.kind === 'contract');
        if (!contract) { c.flag('no contract signal in Awareness'); return; }
        c.state.contract = contract.id;
        const ack = await claude.callTool('acknowledge_signal', { id: contract.id, note: 'Seen. I will pass strict: false until billing-v2 merges.' });
        if (ack.isError) c.flag(`acknowledge_signal: ${ack.text.slice(0, 120)}`);
        await c.call('navigate_to', { target: 'awareness', signal_id: contract.id });
        await c.say('The agent answers', 'Its note sits beside the overlap for you to read. It changes nothing you decide.');
        await c.shot('p3-contract', { highlighted: contract.id });
      },
    },
    {
      id: 'intended',
      title: 'Yes, that is on purpose',
      watch: 'marked Intended, the overlap goes quiet and stays quiet',
      async run(c) {
        const id = c.state.contract;
        if (!id) { c.flag('no contract signal to mark'); return; }
        await c.call('navigate_to', { target: 'awareness', signal_id: id });
        await c.person({
          ask: 'In Awareness, mark the validateCreateUser overlap "Intended".',
          decide: () => c.api(`/api/awareness/${id}/state?project=${encodeURIComponent(fx.path)}`, { state: 'intended' }),
          done: async () => (await signals(c)).find((s) => s.id === id)?.state === 'intended',
        });
        // A body edit on either side is not a change of shape: still quiet.
        fx.edit('billing-v2', V, "errors.push('email is invalid');", "errors.push('email is invalid (billing)');");
        await c.beat();
        if ((await ordinary(claude)).includes(NOTICE)) c.flag('an intended overlap spoke again without changing shape');
        fx.reset('billing-v2');
        fx.reset('checkout-fix');
      },
    },
    {
      id: 'intent',
      title: 'Flagged before any edit',
      watch: 'Codex says what it is about to change; the overlap with auth-refresh appears before a file changes',
      async run(c) {
        fx.edit('auth-refresh', V, 'return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());');
        await c.say('Saying what it will do', 'Before editing, Codex declares: "Tighten email validation", isValidEmail. auth-refresh is already there.');
        const r = await c.until(async () => {
          const answer = JSON.parse((await codex.callTool('declare_intent', { summary: 'Tighten email validation for billing contacts', paths: [V], symbols: ['isValidEmail'] })).answer) as { signals?: Signal[] };
          return (answer.signals ?? []).find((s) => s.kind === 'collision' && s.subject.symbol === 'isValidEmail');
        }, 20, 'the declared overlap with auth-refresh');
        if (r && !r.summary.includes('(declared)')) c.flag(`a declared overlap should say so; it reads "${r.summary}"`);
        await c.call('navigate_to', { target: 'awareness', ...(r ? { signal_id: r.id } : {}) });
        await c.shot('p4-intent', r ? { highlighted: r.id } : {});
        await codex.callTool('declare_intent', { summary: 'done', clear: true });
        fx.reset('auth-refresh');
      },
    },
    {
      id: 'breakpoint',
      title: 'Ask me before this changes',
      watch: 'Claude Code\'s edit pauses on a breakpoint; a steer lets it through; an agent without the hook is told it breached',
      async run(c) {
        await c.call('graph_set_depth', { depth: 'file' });
        await c.person({
          ask: 'On the graph, right-click packages/shared and choose "Ask me before this changes".',
          decide: async () => {
            const bp = await c.api('/api/breakpoints', { kind: 'code', path: 'packages/shared', note: 'Ask me before touching shared' });
            if (bp?.breakpoint?.id) c.state.breakpoint = bp.breakpoint.id;
          },
          done: async () => (await runHook(c.opts, fx.trees['billing-v2'], V))?.permissionDecision === 'deny',
        });
        if (c.state.breakpoint) c.defer('cleared the breakpoint', () => c.api(`/api/breakpoints/${c.state.breakpoint}`, undefined, 'DELETE'));

        await c.say('Claude Code tries to edit', 'With the hook, its edit to validators.ts waits for you. Nothing is written.');
        const held = await runHook(c.opts, fx.trees['billing-v2'], V);
        const ref = /ref "(bp-[0-9a-f]+)"/.exec(held?.permissionDecisionReason ?? '')?.[1];
        if (!ref || !held?.permissionDecisionReason?.includes('paused: waiting for a decision')) { c.flag(`the hook should pause the edit; it said ${JSON.stringify(held).slice(0, 160)}`); return; }
        await c.call('navigate_to', { target: 'awareness', breakpoint_ref: ref });
        await c.shot('p5-paused', { highlighted: ref });

        await c.person({
          ask: 'In Needs you, answer the paused edit with "Steer" and the note "Only the email rule".',
          decide: () => c.api(`/api/breakpoint-hits/${ref}/answer`, { decision: 'steer', note: 'Only the email rule' }),
          done: async () => JSON.parse((await codex.callTool('await_decision', { ref, wait_seconds: 2 })).answer)?.status === 'answered',
        });
        const through = await runHook(c.opts, fx.trees['billing-v2'], V);
        if (through?.permissionDecision) c.flag(`after the steer the edit should go through; the hook said ${through.permissionDecision}`);
        else if (!(through?.additionalContext ?? '').includes('Only the email rule')) c.flag('the steer note did not reach the edit');

        await c.say('An agent with no hook', 'Claude Code in checkout-fix edits shared code directly. Its next call says it breached the breakpoint, and you see it.');
        fs.appendFileSync(`${fx.trees['checkout-fix']}/${V}`, '\n// checkout-fix, past the breakpoint\n');
        const breach = await c.until(async () => {
          const text = await ordinary(claude);
          return text.includes(BREAKPOINT_NOTICE) ? text : null;
        }, 20, 'the breach to be told');
        if (breach && !breach.includes('recorded as a breach')) c.flag('the breach notice should say it was recorded as a breach');
        await c.call('navigate_to', { target: 'awareness' });
        await c.shot('p5-breakpoint');
        fx.reset('checkout-fix');
      },
    },
  ],
};
