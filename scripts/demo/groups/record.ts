/**
 * The record (Phase 32 B10): evidence you can prove, months later. An agent
 * claims a task and offers evidence for its criterion, a person approves it,
 * and the plan's evidence exports with the approval named in it, while the
 * record, every entry hash-chained as it is written, says it is intact before
 * and after. Then the moment the task was under way is asked for again, and
 * it reads as it was then. Mirrors the harness test `record-g2` (the week,
 * the record intact, the evidence naming the approval, the stack then)
 * against the running app. Catalogued in `docs/DEMO-JOURNEYS.md`, section
 * `record`.
 */
import type { ScriptedMcp } from '../../../tests/harness/mcp-client';
import { paymentsRepo } from '../../demo-fixtures';
import type { Ctx, Group } from '../types';

const PLAN = 'Payments: refunds to the cent';
const TASK = 'Round refunds half-even';
const CRITERION = 'Refunds round half-even to the cent';

interface RecordCheck { ok: boolean; words: string; entries: number; problems: Array<{ seq: number; kind: string; type: string | null }> }
interface Evidence {
  window: { words: string; plan: { uid: string; title: string } | null };
  record: { entries: unknown[] };
  decisions: Array<{ seq: number; type: string; words: string }>;
  seal?: unknown;
}

let project: string;
/** Works the refunds task, in the payments repository. */
let codex: ScriptedMcp;

/** The record walked from its anchor: intact, or what changed, by entry. */
async function verify(c: Ctx, when: string): Promise<RecordCheck | null> {
  const r = await c.json('verify_record', {}) as RecordCheck | null;
  if (!r) { c.flag(`verify_record ${when} answered nothing`); return null; }
  if (!r.ok) c.flag(`the record ${when} is not intact: ${r.words}`);
  else if (!/^Intact: [\d,]+ entr(y|ies) since \d{4}-\d{2}-\d{2} match the chain\.$/.test(r.words)) c.flag(`the record ${when} should say it is intact in words; it says "${r.words}"`);
  console.log(`    ${r.words}`);
  return r;
}

/** Codex's answer, parsed; a refusal or an `ok: false` is flagged with what it said. */
async function agentJson(c: Ctx, tool: string, args: Record<string, unknown>): Promise<any> {
  const r = await codex.callTool(tool, args);
  let body: any = null;
  try { body = JSON.parse(r.answer); } catch { /* words, not JSON */ }
  if (r.isError || body?.ok === false) { c.flag(`codex ${tool}: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`); return null; }
  return body;
}

export const recordGroup: Group = {
  id: 'record',
  title: 'The record',
  async setup(c) {
    project = paymentsRepo();
    await c.say('A payments repository', 'Somewhere to build a payment change whose evidence someone will ask for months from now.');
    await c.call('open_project', { path: project });
    codex = await c.agent('codex', { roots: [project] });
  },
  scenes: [
    {
      id: 'evidence',
      title: 'Approved, exported, and proven',
      watch: 'the criterion approved in the Brief; the plan\'s evidence names the approval; the record says intact before and after',
      async run(c) {
        await c.say('The record', 'Everything CodeTrellis keeps is linked into a hash chain as it is written. First: is it intact?');
        const before = await verify(c, 'at the start');

        const plan = await c.json('create_plan', { title: PLAN, project_path: project });
        if (!plan?.uid) { c.flag('create_plan made no plan'); return; }
        c.defer('archived the refunds plan', () => c.call('update_plan', { plan_uid: plan.uid, status: 'archived' }));
        const task = await c.json('add_item', { plan_uid: plan.uid, kind: 'action', title: TASK });
        if (!task?.uid) { c.flag('add_item made no task'); return; }
        c.state.recordTask = task.uid;
        await c.call('navigate_to', { target: 'brief', plan_uid: plan.uid, item_uid: task.uid });

        await c.say('Codex takes the task', `It claims "${TASK}" and writes down what done means, in the requester's words.`);
        if (!(await agentJson(c, 'claim_item', { uid: task.uid }))) return;
        if (!(await agentJson(c, 'update_item', { uid: task.uid, status: 'in_progress' }))) return;
        c.state.recordUnderWay = String(Date.now());
        const criterion = await agentJson(c, 'add_criterion', { item_uid: task.uid, text: CRITERION, kind: 'manual' });
        if (!criterion?.uid) return;
        if (criterion.policy === 'agent') c.flag('a criterion an agent added is agent-approved; only a person may grant that');
        const submitted = await agentJson(c, 'submit_criterion', { criterion_uid: criterion.uid, evidence: [], note: 'Checked against the ledger: 2.675 refunds as 2.68, 2.665 as 2.66.' });
        if (!submitted) return;
        if (submitted.state !== 'submitted') c.flag(`a manual criterion offered by an agent should wait for a person; it is ${submitted.state}`);

        await c.say('A person decides', 'An agent cannot approve its own work. The approval is a person\'s, and the record keeps it with who.');
        const stateOf = async () => {
          const list = await c.json('list_criteria', { item_uid: task.uid });
          return (Array.isArray(list) ? list : []).find((x: { uid: string }) => x.uid === criterion.uid)?.state ?? null;
        };
        const approved = await c.person({
          ask: `In the Brief, approve "${CRITERION}".`,
          decide: () => c.api(`/api/criteria/${criterion.uid}/decide`, { decision: 'approved' }),
          done: async () => (await stateOf()) === 'met',
        });
        if (!approved) return;
        await c.call('navigate_to', { target: 'brief', plan_uid: plan.uid, item_uid: task.uid });
        await c.shot('r1-approved', { criterion: { text: CRITERION, state: 'met' } });

        // Codex finishes: the task is done now, and was in progress then.
        if (!(await agentJson(c, 'update_item', { uid: task.uid, status: 'done' }))) return;

        await c.say('Export the evidence', 'One signed package for the plan: its record entries with how to recompute each link, and the decisions in words.');
        const e = await c.json('export_evidence', { plan_uid: plan.uid }) as Evidence | null;
        if (!e) { c.flag('export_evidence answered nothing'); return; }
        console.log(`    ${e.window.words} · ${e.record.entries.length} entries · ${e.decisions.length} decision(s)`);
        if (!e.seal) c.flag('the evidence came back unsealed; it should be signed with this computer\'s key');
        if (e.window.plan?.uid !== plan.uid) c.flag(`the evidence should be for the plan "${PLAN}"; it is for ${e.window.plan?.title ?? 'a window with no plan'}`);
        const approval = e.decisions.find((d) => d.type === 'criterion_decided');
        if (!approval) c.flag(`the evidence should name the approval; its decisions are ${e.decisions.map((d) => d.words).join('; ') || 'none'}`);
        else if (!approval.words.includes(`Approved “${CRITERION}”`)) c.flag(`the evidence should say Approved “${CRITERION}”; it says "${approval.words}"`);
        else console.log(`    #${approval.seq} ${approval.words}`);

        await c.say('Still intact', 'The record grew by everything that just happened, and every entry still matches the chain.');
        const after = await verify(c, 'after the export');
        if (before && after && after.entries <= before.entries) c.flag(`the record should have grown; it had ${before.entries} entries and has ${after.entries}`);
      },
    },
    {
      id: 'then',
      title: 'What was going on then',
      watch: 'asked for the moment the task was under way, it reads in progress then, done now',
      async run(c) {
        const at = Number(c.state.recordUnderWay);
        if (!at) { c.flag('no moment to go back to: the evidence scene did not reach the claim'); return; }
        await c.call('navigate_to', { target: 'timeline' });
        await c.say('Back to that moment', 'Months later someone asks what was going on while the refunds task was being built. The record answers as it was then.');
        const then = await c.json('get_state_at', { at, project_path: project });
        const task = (then?.tasks ?? []).find((t: { uid: string }) => t.uid === c.state.recordTask) as { status: string; status_now?: string; assignee: string | null } | undefined;
        if (!task) { c.flag(`the state at the claim should hold "${TASK}"; it holds ${(then?.tasks ?? []).map((t: { title: string }) => t.title).join(', ') || 'no tasks'}`); return; }
        if (task.status !== 'in_progress') c.flag(`"${TASK}" should read in progress then; it reads ${task.status}`);
        if (task.status_now !== 'done') c.flag(`"${TASK}" should say it is done now; it says ${task.status_now ?? 'nothing about now'}`);
        console.log(`    then: ${task.status}${task.assignee ? ` (${task.assignee})` : ''}; now: ${task.status_now ?? '?'}`);
        await c.shot('r2-then');
      },
    },
  ],
};
