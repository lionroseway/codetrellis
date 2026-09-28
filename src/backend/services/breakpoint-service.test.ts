/**
 * Breakpoints (Phase 32 B4.1): which calls a breakpoint holds, on what, and
 * how a person's answer is spent. Against a real database, because the wait
 * is only as durable as the rows it is kept in.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-breakpoints-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let svc: typeof import('./breakpoint-service');
let log: typeof import('./agent-event-log');
const published: Array<{ type: string; payload: Record<string, unknown> }> = [];

const codex = { agent: 'codex', sessionId: 's-codex' };
const claude = { agent: 'claude-code', sessionId: 's-claude' };
const sam = { by: 'Sam', byType: 'human' };

function item(uid: string, parent: string | null = null, plan = 'p1') {
  db.getDb().run(
    `INSERT OR REPLACE INTO plan_items (uid, plan_uid, parent_uid, kind, title, author, created_at, updated_at) VALUES (?, ?, ?, 'action', ?, 'Sam', 1, 1)`,
    [uid, plan, parent, `Task ${uid}`],
  );
}

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  svc = await import('./breakpoint-service');
  log = await import('./agent-event-log');
  log.setEventPublisher((type, payload) => {
    const evt = payload as { type: string; payload: Record<string, unknown> };
    if (type === 'agent-event') published.push({ type: evt.type, payload: evt.payload });
  });
});

beforeEach(() => {
  for (const t of ['breakpoint_hits', 'breakpoints', 'plan_items', 'agent_sessions']) db.getDb().run(`DELETE FROM ${t}`);
  for (const p of ['p1', 'p2']) {
    db.getDb().run(`INSERT OR REPLACE INTO plans (uid, title, author, project_path, created_at, updated_at) VALUES (?, 'Plan', 'Sam', '/w/app', 1, 1)`, [p]);
  }
  // payments ▸ refunds ▸ partial; currency is elsewhere in the plan.
  item('payments'); item('refunds', 'payments'); item('partial', 'refunds'); item('currency');
  published.length = 0;
});

test('which calls a breakpoint can hold, and what each would do', () => {
  assert.deepEqual(svc.guardedCall('claim_item', { uid: 'a' }), { itemUid: 'a', actions: [{ action: 'claim', kind: 'task' }] });
  assert.deepEqual(svc.guardedCall('update_item', { uid: 'a', status: 'done' })?.actions, [{ action: 'done', kind: 'task' }]);
  assert.deepEqual(svc.guardedCall('update_item', { uid: 'a', status: 'in_progress', body: 'x' })?.actions,
    [{ action: 'claim', kind: 'task' }, { action: 'edit', kind: 'spec' }]);
  assert.deepEqual(svc.guardedCall('restore_item_version', { uid: 'a', version: 2 })?.actions, [{ action: 'edit', kind: 'spec' }]);
  assert.equal(svc.guardedCall('delete_item', { uid: 'a' })?.actions.length, 2);
  // Not held: reading, progress, a status that is neither, a call with no item.
  for (const [tool, args] of [['get_item', { uid: 'a' }], ['update_item_progress', { uid: 'a', percent: 50 }], ['update_item', { uid: 'a', status: 'blocked' }], ['claim_item', {}]] as const) {
    assert.equal(svc.guardedCall(tool, args), null, tool);
  }
});

test('a task breakpoint pauses claiming and finishing the task and anything under it, and nothing else', () => {
  svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', ...sam });
  assert.equal(svc.enforce('claim_item', { uid: 'refunds' }, codex).kind, 'paused');
  assert.equal(svc.enforce('update_item', { uid: 'partial', status: 'done' }, codex).kind, 'paused');
  // Its parent, a sibling, and an edit of its description are not held by a task breakpoint.
  assert.equal(svc.enforce('claim_item', { uid: 'payments' }, codex).kind, 'pass');
  assert.equal(svc.enforce('claim_item', { uid: 'currency' }, codex).kind, 'pass');
  assert.equal(svc.enforce('update_item', { uid: 'refunds', body: 'new' }, codex).kind, 'pass');
});

test('a spec breakpoint pauses changing the description, not claiming', () => {
  svc.setBreakpoint({ kind: 'spec', itemUid: 'payments', ...sam });
  assert.equal(svc.enforce('update_item', { uid: 'refunds', title: 'Refunds v2' }, codex).kind, 'paused');
  assert.equal(svc.enforce('restore_item_version', { uid: 'payments', version: 1 }, codex).kind, 'paused');
  assert.equal(svc.enforce('claim_item', { uid: 'payments' }, codex).kind, 'pass');
});

test('deleting a parent is held by a breakpoint underneath it', () => {
  svc.setBreakpoint({ kind: 'task', itemUid: 'partial', ...sam });
  assert.equal(svc.enforce('delete_item', { uid: 'payments' }, codex).kind, 'paused');
  assert.equal(svc.enforce('delete_item', { uid: 'currency' }, codex).kind, 'pass');
});

test('the same call again while waiting gets the same ref, and one hit is recorded and published', () => {
  const { breakpoint } = svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', note: 'ask me first', ...sam });
  const first = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  const again = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  assert.ok(first.kind === 'paused' && again.kind === 'paused');
  assert.equal(first.fresh, true);
  assert.equal(again.fresh, false);
  assert.equal(again.hit.ref, first.hit.ref);
  assert.equal(svc.listHits().length, 1);
  assert.equal(first.hit.breakpointNote, 'ask me first');
  assert.equal(first.hit.breakpointId, breakpoint.id);
  assert.deepEqual(published.map((e) => e.type), ['breakpoint_hit']);
  assert.equal(published[0].payload.itemTitle, 'Task refunds');
  // Another agent making the same call is held on its own.
  const other = svc.enforce('claim_item', { uid: 'refunds' }, claude);
  assert.ok(other.kind === 'paused' && other.hit.ref !== first.hit.ref);
});

test('continue lets the next matching call through once, with the steer; the one after pauses again', () => {
  svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', ...sam });
  const held = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  assert.ok(held.kind === 'paused');
  const answered = svc.answerHit({ ref: held.hit.ref, decision: 'steer', note: 'go ahead, but leave the refund path alone', ...sam });
  assert.equal(answered?.decision, 'steer');
  const through = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  assert.ok(through.kind === 'continue');
  assert.match(svc.steerText(through.hit) ?? '', /A person answered your breakpoint .*leave the refund path alone/);
  const next = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  assert.ok(next.kind === 'paused' && next.fresh && next.hit.ref !== held.hit.ref);
  // A continue answer is for the agent it held: another agent is still paused.
  assert.equal(svc.enforce('claim_item', { uid: 'refunds' }, claude).kind, 'paused');
});

test('stop refuses the next matching call once, with the note', () => {
  svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', ...sam });
  const held = svc.enforce('update_item', { uid: 'refunds', status: 'done' }, codex);
  assert.ok(held.kind === 'paused');
  svc.answerHit({ ref: held.hit.ref, decision: 'stop', note: 'not until review', ...sam });
  const refused = svc.enforce('update_item', { uid: 'refunds', status: 'done' }, codex);
  assert.ok(refused.kind === 'stop');
  const text = svc.stoppedResult(refused.hit).content[0].text;
  assert.match(text, /stop\. Nothing was done\. Their note: not until review/);
});

test('the first answer stands; an answer is published with who and how long it waited', () => {
  svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', ...sam });
  const held = svc.enforce('claim_item', { uid: 'refunds' }, codex, 1_000);
  assert.ok(held.kind === 'paused');
  assert.ok(svc.answerHit({ ref: held.hit.ref, decision: 'continue', ...sam, now: 61_000 }));
  assert.equal(svc.answerHit({ ref: held.hit.ref, decision: 'stop', ...sam }), null);
  assert.equal(svc.getHit(held.hit.ref)?.decision, 'continue');
  assert.equal(svc.answerHit({ ref: 'bp-nope', decision: 'continue', ...sam }), null);
  const answer = published.find((e) => e.type === 'breakpoint_answered');
  assert.deepEqual([answer?.payload.decision, answer?.payload.byType, answer?.payload.waitedMs], ['continue', 'human', 60_000]);
});

test('await_decision\'s view: waiting says call again; answered says what to do', () => {
  svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', ...sam });
  const held = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  assert.ok(held.kind === 'paused');
  assert.equal(svc.decisionView(held.hit).status, 'waiting');
  svc.answerHit({ ref: held.hit.ref, decision: 'stop', ...sam });
  const view = svc.decisionView(svc.getHit(held.hit.ref)!);
  assert.deepEqual([view.status, view.decision, view.by], ['answered', 'stop', 'human']);
  assert.match(String(view.message), /Do not make the paused call/);
});

test('setting: a known kind on an item that exists; the plan from the item; the same one twice is one', () => {
  assert.throws(() => svc.setBreakpoint({ kind: 'code', itemUid: 'refunds', ...sam }), /kind must be/);
  assert.throws(() => svc.setBreakpoint({ kind: 'task', itemUid: 'nope', ...sam }), /Item not found/);
  item('elsewhere', null, 'p2');
  const a = svc.setBreakpoint({ kind: 'task', itemUid: 'elsewhere', ...sam });
  assert.equal(a.breakpoint.planUid, 'p2');
  assert.equal(a.breakpoint.createdByType, 'human');
  const b = svc.setBreakpoint({ kind: 'task', itemUid: 'elsewhere', ...sam });
  assert.equal(b.created, false);
  assert.equal(b.breakpoint.id, a.breakpoint.id);
  assert.deepEqual(svc.listBreakpoints('p2').map((x) => x.id), [a.breakpoint.id]);
  assert.deepEqual(svc.listBreakpoints('p1'), []);
});

test('clearing lets waiting calls through and stops holding new ones', () => {
  const { breakpoint } = svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', ...sam });
  const held = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  assert.ok(held.kind === 'paused');
  const { cleared, released } = svc.clearBreakpoint({ id: breakpoint.id, ...sam });
  assert.equal(cleared, true);
  assert.deepEqual(released.map((h) => h.ref), [held.hit.ref]);
  assert.equal(svc.getHit(held.hit.ref)?.decision, 'continue');
  assert.equal(svc.enforce('claim_item', { uid: 'refunds' }, codex).kind, 'pass');
  assert.equal(svc.clearBreakpoint({ id: breakpoint.id, ...sam }).cleared, false);
  assert.deepEqual(svc.listHits(), []);
  assert.equal(svc.listHits({ state: 'all' }).length, 1);
});

test('a note is one bounded piece of text: control characters dropped, newlines kept', () => {
  assert.equal(svc.cleanNote('  go\u0007 ahead\r\nbut carefully  '), 'go  ahead\nbut carefully');
  assert.equal(svc.cleanNote('x'.repeat(2000))?.length, svc.MAX_NOTE);
  assert.equal(svc.cleanNote('   '), null);
  assert.equal(svc.cleanNote(7), null);
});

test('the hit records the agent\'s workstream from its session', () => {
  db.getDb().run(
    `INSERT INTO agent_sessions (session_id, agent_type, connected_at, last_seen, workstream_root) VALUES ('s-codex', 'codex', 1, 1, '/w/app-currency')`,
  );
  svc.setBreakpoint({ kind: 'task', itemUid: 'refunds', ...sam });
  const held = svc.enforce('claim_item', { uid: 'refunds' }, codex);
  assert.ok(held.kind === 'paused');
  assert.equal(held.hit.workstreamRoot, '/w/app-currency');
  assert.equal(published[0].payload.workstreamRoot, '/w/app-currency');
});
