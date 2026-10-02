/**
 * How the work stacks up (Phase 32 Track B): the lead's morning view of
 * every plan and who is on what, the same view as it was at a past moment,
 * the review that knows what else is in flight, and two plans that will
 * meet, seen and settled before either starts. Mirrors the harness tests
 * `awareness-h1`, `replay-state`, `awareness-m5` and `play-forward-g3`,
 * against the running app. Catalogued in `docs/DEMO-JOURNEYS.md`, section
 * `observe`.
 */
import type { ScriptedMcp } from '../../../tests/harness/mcp-client';
import type { Stack, StackTask } from '../../../src/shared/types/stack';
import type { PlayForward } from '../../../src/shared/types/play-forward';
import { sampleAppRepo, type ParallelFixture } from '../../demo-fixtures';
import type { Ctx, Group } from '../types';

const V = 'packages/shared/src/validators.ts';
const UL = 'packages/web/src/UserList.tsx';
const WAITS = '"Export form" waits on "Strict validation" in plan "Billing v2".';
const MERGE_LINE = 'Merging this changes validateCreateUser; exports imports it and will need updating.';
const FIRST = 'Before exports: it imports validateCreateUser, which this changes, and will need updating after.';
const HELD_WARNING = '1 high overlap(s) with other work are still open; see "Other work in flight".';
const PLANNED = /^◇ planned overlap: JIRA-1(42|51) and JIRA-1(42|51) both plan to change packages\/shared\/src\/validators\.ts$/;

interface StateAt {
  tasks: Array<{ uid: string; status: string | null; status_now?: string | null; assignee: string | null }>;
  signals: Array<{ kind: string; closed_at: string | null }>;
  stack: Stack;
}
interface OtherWork { workstream: { name: string }; openHigh: number; entries: Array<{ kind: string; merge?: string; outcome: string }> }
interface Queue { base: string | null; lines: Array<{ branch: string; position: number; reason: string; status: string }> }

let fx: ParallelFixture;
/** Works in `billing-v2`, which changes `validateCreateUser`'s signature. */
let codex: ScriptedMcp;
/** Works in `exports`, whose page imports it. */
let claude: ScriptedMcp;
let billing = '';
let exportsPlan = '';
let migrate = '';
let deploy = '';

/** A moment strictly between what happened before and what happens next: two timestamps apart, not a wait. */
const gap = () => new Promise((r) => setTimeout(r, 30));

const taskIn = (s: Stack | null | undefined, uid: string): StackTask | undefined =>
  s?.plans.flatMap((p) => p.tasks).find((t) => t.uid === uid);

async function stack(c: Ctx): Promise<Stack | null> {
  return c.json('get_stack', { project_path: fx.path });
}

async function signalKinds(c: Ctx): Promise<string[]> {
  const body = await c.json('get_awareness', { project_path: fx.path });
  return Array.isArray(body?.signals) ? body.signals.map((s: { kind: string }) => s.kind) : [];
}

/** A plan this group made, and its undo. */
async function plan(c: Ctx, title: string): Promise<string> {
  const made = await c.json('create_plan', { title, project_path: fx.path });
  const uid: string = made?.uid ?? '';
  if (!uid) { c.flag(`create_plan "${title}" gave no uid`); return ''; }
  c.defer(`archived "${title}"`, () => c.call('update_plan', { plan_uid: uid, status: 'archived' }));
  return uid;
}

async function task(c: Ctx, planUid: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const item = await c.json('add_item', { plan_uid: planUid, kind: 'action', title, ...extra });
  if (!item?.uid) c.flag(`add_item "${title}" gave no uid`);
  return item?.uid ?? '';
}

async function claim(c: Ctx, agent: ScriptedMcp, uid: string, who: string): Promise<string> {
  const r = await agent.callTool('claim_item', { uid });
  if (r.isError || r.answer.includes('"ok": false')) c.flag(`${who} could not claim its task: ${r.text.slice(0, 160)}`);
  return r.answer;
}

export const observeGroup: Group = {
  id: 'observe',
  title: 'How the work stacks up',
  async setup(c) {
    fx = sampleAppRepo('observe', ['billing-v2', 'exports']);
    // Billing's work is already committed: validateCreateUser takes a second argument.
    fx.edit('billing-v2', V, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    fx.commit('billing-v2', 'billing: strict validation');
    await c.say('Two lines of work', 'billing-v2 and exports, each a worktree of the same app, each with its own agent.');
    await c.call('open_project', { path: fx.path });
    // Listing them is what starts their watchers, as the window's strip does.
    await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
    codex = await c.agent('codex', { roots: [fx.trees['billing-v2']] });
    claude = await c.agent('claude-code', { roots: [fx.trees.exports] });
  },
  scenes: [
    {
      id: 'stack',
      title: 'The lead\'s morning view',
      watch: 'Stack: Billing v2 and JIRA-150, who is on each task and where, "⚠ overlaps JIRA-150", and Export form waiting on Billing',
      async run(c) {
        await c.say('Billing first, alone', 'A plan for Billing v2: one task, "Strict validation", worked on billing-v2.');
        billing = await plan(c, 'Billing v2');
        migrate = await task(c, billing, 'Strict validation', { file_specs: [{ path: V, action: 'modify' }] });
        await c.call('assign_workstream', { item_uid: migrate, workstream: 'billing-v2' });

        await gap();
        c.state.beforeExports = String(Date.now());
        await gap();

        await c.say('Then Exports, by its ticket', 'Exports is JIRA-150. Its task, "Export form", waits on Billing\'s, and its page imports the function Billing changes.');
        fx.edit('exports', UL, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// exports: the export form");
        fx.commit('exports', 'exports: export form');
        exportsPlan = await plan(c, 'Exports');
        deploy = await task(c, exportsPlan, 'Export form', { dependencies: [migrate] });
        await c.call('assign_workstream', { item_uid: deploy, workstream: 'exports' });
        const ref = await codex.callTool('set_plan_external_ref', { plan_uid: exportsPlan, url: 'https://example.atlassian.net/browse/JIRA-150', key: 'JIRA-150' });
        if (ref.isError) c.flag(`set_plan_external_ref: ${ref.text.slice(0, 160)}`);

        await c.say('Each agent takes its task', 'Codex takes Strict validation; Claude Code takes Export form and is told what it waits on.');
        await claim(c, codex, migrate, 'codex');
        const waiting = await claim(c, claude, deploy, 'claude-code');
        if (!waiting.includes('Strict validation')) c.flag(`claiming a task that waits should say what it waits on; it said ${waiting.slice(0, 160)}`);

        await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
        await c.until(async () => (await signalKinds(c)).includes('contract'), 20, 'the contract between billing-v2 and exports to open');

        await c.call('navigate_to', { target: 'stack' });
        await c.say('One view of the morning', 'Every plan by its ticket, who is on each task and in which worktree, where plans meet, and what waits on what.');
        const s = await stack(c);
        if (!s) return;
        const labels = s.plans.map((p) => p.label).sort();
        if (labels.join(',') !== 'Billing v2,JIRA-150') c.flag(`the stack should show "Billing v2" and "JIRA-150"; it shows ${labels.join(', ') || 'nothing'}`);
        const m = taskIn(s, migrate);
        const d = taskIn(s, deploy);
        if (m?.assignee !== 'codex' || m?.workstream !== 'billing-v2') c.flag(`Strict validation should be codex's on billing-v2; it is ${m?.assignee} on ${m?.workstream}`);
        if (d?.assignee !== 'claude-code' || d?.workstream !== 'exports') c.flag(`Export form should be claude-code's on exports; it is ${d?.assignee} on ${d?.workstream}`);
        const overlap = s.plans.find((p) => p.uid === billing)?.overlaps.find((o) => o.withPlanUid === exportsPlan);
        if (overlap?.words !== '⚠ overlaps JIRA-150') c.flag(`Billing v2 should say "⚠ overlaps JIRA-150"; it says ${JSON.stringify(overlap?.words ?? null)}`);
        else if (!overlap.actual.some((x) => x.kind === 'contract')) c.flag('the overlap should rest on the open contract signal');
        const back = s.plans.find((p) => p.uid === exportsPlan)?.overlaps.find((o) => o.withPlanUid === billing);
        if (back?.words !== '⚠ overlaps Billing v2') c.flag(`JIRA-150 should say "⚠ overlaps Billing v2"; it says ${JSON.stringify(back?.words ?? null)}`);
        if (d?.waits !== WAITS) c.flag(`Export form should wait across plans: ${WAITS} It says ${JSON.stringify(d?.waits ?? null)}`);
        else console.log(`    ${d.waits}`);
        await c.shot('o1-stack');
      },
    },
    {
      id: 'replay',
      title: 'The state at a past moment',
      watch: 'replay from the moment before Exports existed, at 4×: Billing alone, nobody on its task, nothing overlapping; then live',
      async run(c) {
        const at = Number(c.state.beforeExports);
        if (!at || !migrate) { c.flag('no earlier moment to ask about: run the stack scene first'); return; }
        // The window plays the project from that moment at 4×, so a person
        // watches Exports arrive; the checks below ask the same question by tool.
        await c.call('navigate_to', { target: 'replay', from: at, speed: 4 });
        c.defer('back to live', () => c.call('navigate_to', { target: 'live' }));
        await c.say('What was it like then?', `Asked about ${new Date(at).toLocaleTimeString()}, before Exports existed, the answer is what was true then, not now.`);
        await c.shot('o2-replay', { view: 'replay' });
        const then = await c.json('get_state_at', { at, project_path: fx.path }) as StateAt | null;
        if (!then) return;
        const labels = then.stack.plans.map((p) => p.label);
        if (labels.join(',') !== 'Billing v2') c.flag(`the stack then should be Billing v2 alone; it is ${labels.join(', ') || 'empty'}`);
        const m = then.tasks.find((t) => t.uid === migrate);
        if (!m) c.flag('Strict validation is missing from the state then');
        else {
          if (m.status !== 'pending' || m.assignee !== null) c.flag(`then, Strict validation should be pending with nobody on it; it was ${m.status}, ${m.assignee}`);
          if (!m.status_now || m.status_now === 'pending') c.flag(`the state then should say Strict validation's status has moved on since; status_now is ${m.status_now}`);
        }
        if (then.tasks.some((t) => t.uid === deploy)) c.flag('Export form did not exist then, but the state then lists it');
        if (then.signals.length) c.flag(`nothing overlapped then; the state then has ${then.signals.map((x) => x.kind).join(', ')}`);

        await c.say('And now', 'Asked about now: two plans, both tasks taken, and the contract between them open.');
        const now = await c.json('get_state_at', { at: new Date().toISOString(), project_path: fx.path }) as StateAt | null;
        if (!now) return;
        if (!now.signals.some((x) => x.kind === 'contract' && x.closed_at === null)) c.flag(`now the contract should be open; signals now: ${now.signals.map((x) => x.kind).join(', ') || 'none'}`);
        const dNow = now.tasks.find((t) => t.uid === deploy);
        if (dNow?.assignee !== 'claude-code') c.flag(`now Export form should be claude-code's; it is ${dNow?.assignee}`);
        await c.call('navigate_to', { target: 'live' });
        await c.call('navigate_to', { target: 'stack' });
        await c.shot('o2-now');
      },
    },
    {
      id: 'review-queue',
      title: 'Review knows what else is in flight',
      watch: 'Review: "Other work in flight" says exports will need updating; billing-v2 first in the merge order, both held',
      async run(c) {
        if (!billing) { c.flag('no plan to review: run the stack scene first'); return; }
        const range = { before: 'commit:main', after: 'commit:billing-v2' };
        await c.say('Reviewing billing-v2', 'The review of Billing\'s branch says what it means for the other line of work.');
        const review = await c.json('review_plan', { plan_uid: billing, project_path: fx.path, ...range });
        const other = review?.otherWork as OtherWork | undefined;
        if (!other) c.flag('review_plan gave no "Other work in flight"');
        else {
          if (other.workstream?.name !== 'billing-v2') c.flag(`the review should be of billing-v2; it is of ${other.workstream?.name}`);
          if (other.openHigh !== 1) c.flag(`one high overlap should be open; the review counts ${other.openHigh}`);
          const contract = other.entries.find((e) => e.kind === 'contract');
          if (contract?.merge !== MERGE_LINE || contract.outcome !== 'open') c.flag(`the review should say "${MERGE_LINE}" (open); it says ${JSON.stringify(contract ?? null)}`);
        }
        const md = await c.call('review_plan', { plan_uid: billing, project_path: fx.path, ...range, format: 'markdown' });
        if (!md.answer.includes('### Other work in flight') || !md.answer.includes(MERGE_LINE)) c.flag('the markdown review should carry "### Other work in flight" with the merge line');

        await c.say('And so does the PR body', 'The draft carries the same section, and warns while the overlap is open.');
        const draft = await c.json('get_pr_draft', { plan_uid: billing, project_path: fx.path, ...range }) as { body: string; warnings: string[] } | null;
        if (draft) {
          if (!draft.body.includes('### Other work in flight') || !draft.body.includes(MERGE_LINE)) c.flag('the PR body should carry "Other work in flight" with the merge line');
          if (!draft.warnings.includes(HELD_WARNING)) c.flag(`the PR draft should warn "${HELD_WARNING}"; it warns ${JSON.stringify(draft.warnings)}`);
        }

        await c.call('navigate_to', { target: 'review' });
        await c.say('What merges first', 'billing-v2 goes first, so exports updates to it rather than breaking. Both are held while the overlap is open.');
        const queue = await c.json('get_review_queue', { project_path: fx.path }) as Queue | null;
        if (queue) {
          const order = queue.lines.map((l) => `${l.position}:${l.branch}:${l.status}`).join(', ');
          if (queue.base !== 'main') c.flag(`the queue should be against main; it is against ${queue.base}`);
          if (order !== '1:billing-v2:held, 2:exports:held') c.flag(`the queue should be billing-v2 then exports, both held; it is ${order || 'empty'}`);
          if (queue.lines[0]?.reason !== FIRST) c.flag(`billing-v2's place should read "${FIRST}"; it reads ${JSON.stringify(queue.lines[0]?.reason ?? null)}`);
          else console.log(`    1. billing-v2 — ${FIRST}`);
        }
        await c.shot('o3-review-queue');

        await c.say('Billing\'s task is done', 'Codex finishes Strict validation. Export form no longer waits, in the stack and for every agent at once.');
        const done = await codex.callTool('update_item', { uid: migrate, status: 'done' });
        if (done.isError) c.flag(`codex could not finish its task: ${done.text.slice(0, 160)}`);
        const freed = taskIn(await stack(c), deploy);
        if (freed?.waits !== null) c.flag(`with Strict validation done, Export form should wait on nothing; it says ${JSON.stringify(freed?.waits)}`);
        else if (!freed.dependencies.every((x) => x.met)) c.flag('Export form\'s dependency should read as met');
        await c.call('navigate_to', { target: 'stack' });
      },
    },
    {
      id: 'play-forward',
      title: 'Two plans that will meet, settled before either starts',
      watch: 'play-forward: "◇ planned overlap: JIRA-142 and JIRA-151 both plan to change validators.ts"; then in Stack, resequenced, JIRA-151 waits on JIRA-142',
      async run(c) {
        await c.say('Two new tickets', 'VAT rounding (JIRA-142) and Currency (JIRA-151) both plan to change validators.ts. Nothing is written yet.');
        const make = async (title: string, key: string, taskTitle: string) => {
          const uid = await plan(c, title);
          await c.call('set_plan_external_ref', { plan_uid: uid, url: `https://example.atlassian.net/browse/${key}`, key });
          return [uid, await task(c, uid, taskTitle, { file_specs: [{ path: V, action: 'modify' }] })];
        };
        const [vat, vatTask] = await make('VAT rounding', 'JIRA-142', 'Round VAT per line');
        const [currency, currencyTask] = await make('Currency', 'JIRA-151', 'Add a currency field');
        if (!vat || !currency) return;
        await claim(c, claude, vatTask, 'claude-code');
        await claim(c, codex, currencyTask, 'codex');

        // The window and the phone have no Approve control for a plan yet, so the demo sets it (to fix before 0.2.0).
        await c.say('Both approved', 'The lead approves both plans. Nothing has been written yet.');
        for (const uid of [vat, currency]) await c.call('update_plan', { plan_uid: uid, status: 'approved' });
        for (const uid of [vat, currency]) {
          const p = await c.json('get_plan', { plan_uid: uid });
          if (p?.status !== 'approved') c.flag(`"${p?.title}" should be approved; it is ${p?.status}`);
        }
        await c.call('navigate_to', { target: 'play-forward' });
        c.defer('back to live', () => c.call('navigate_to', { target: 'live' }));

        await c.say('Played forward', 'Before either starts: one file both plan to change, and nothing yet says which goes first.');
        const before = await c.json('get_play_forward', { project_path: fx.path }) as PlayForward | null;
        const o = before?.overlaps.find((x) => x.kind === 'file' && x.subject === V);
        if (!before || !o) { c.flag(`play-forward should find the planned overlap on ${V}; it found ${before?.overlaps.map((x) => x.subject).join(', ') || 'none'}`); return; }
        if (before.overlaps.length !== 1) c.flag(`exactly one planned overlap expected; there are ${before.overlaps.length}: ${before.overlaps.map((x) => x.words).join(' | ')}`);
        if (!PLANNED.test(o.words)) c.flag(`the planned overlap should read "◇ planned overlap: JIRA-142 and JIRA-151 both plan to change ${V}"; it reads "${o.words}"`);
        if (o.sequenced || o.serious) c.flag(`the overlap should be neither sequenced nor serious yet; sequenced ${o.sequenced}, serious ${o.serious}`);
        if (!/· 1 file to change · 1 planned overlap$/.test(before.words)) c.flag(`play-forward should sum up "… · 1 file to change · 1 planned overlap"; it says "${before.words}"`);
        else console.log(`    ${before.words}`);
        if (taskIn(await stack(c), currencyTask)?.waits !== null) c.flag('nothing should wait yet: the two tasks would meet at once');
        await c.shot('o4-play-forward', { view: 'play-forward' });

        // The choice is made in Stack, so the person is shown it there.
        await c.call('navigate_to', { target: 'live' });
        await c.call('navigate_to', { target: 'stack' });
        await c.person({
          ask: 'In Stack, on the planned overlap, choose "Re-sequence these plans", then "JIRA-142 first".',
          decide: () => c.api(`/api/play-forward/overlaps/${encodeURIComponent(o.id)}/resequence?project=${encodeURIComponent(fx.path)}`, { first: vat }),
          done: async () => (await c.json('get_play_forward', { project_path: fx.path }) as PlayForward | null)?.overlaps.find((x) => x.id === o.id)?.sequenced,
        });
        const after = await c.json('get_play_forward', { project_path: fx.path }) as PlayForward | null;
        const seq = after?.overlaps.find((x) => x.id === o.id);
        if (seq && !/ · sequenced: JIRA-151 waits on JIRA-142$/.test(seq.words)) c.flag(`the overlap should end "· sequenced: JIRA-151 waits on JIRA-142"; it reads "${seq.words}"`);
        if (after && !after.words.endsWith('1 planned overlap (1 sequenced)')) c.flag(`play-forward should now count it sequenced; it says "${after.words}"`);
        const s = await stack(c);
        const waits = taskIn(s, currencyTask)?.waits ?? null;
        if (!waits || !/^"Add a currency field" waits on "Round VAT per line" in plan /.test(waits)) c.flag(`Add a currency field should now wait on Round VAT per line; it says ${JSON.stringify(waits)}`);
        else console.log(`    ${waits}`);
        if (taskIn(s, vatTask)?.waits !== null) c.flag('Round VAT per line goes first and should wait on nothing');
        await c.say('Settled before either starts', 'JIRA-151 waits on JIRA-142, in the stack and for both agents.', 'success');
        await c.shot('o5-resequenced');
      },
    },
  ],
};
