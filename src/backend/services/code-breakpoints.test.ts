/**
 * Breakpoints on code (Phase 32 B4.2): where one may be set, what it covers,
 * how the hook's edit is held and answered, and when a change CodeTrellis
 * could not pause is a breach. Against a real database and real folders.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-code-bp-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

// The opened project, and a second worktree of it.
const project = path.join(tmp, 'app');
const worktree = path.join(tmp, 'app-billing');
for (const root of [project, worktree]) {
  fs.mkdirSync(path.join(root, 'payments'), { recursive: true });
  fs.writeFileSync(path.join(root, 'payments', 'refund.ts'), 'export function refund() {}\n');
  fs.writeFileSync(path.join(root, 'payments', 'rates.ts'), 'export const rate = 1;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# app\n');
}

let db: typeof import('./database');
let bp: typeof import('./breakpoint-service');
let code: typeof import('./code-breakpoints');
let log: typeof import('./agent-event-log');
const published: Array<{ type: string; payload: Record<string, unknown> }> = [];

const sam = { by: 'Sam', byType: 'human' };
const hook = { agent: 'claude-code-hook', sessionId: 's-hook', workstreamRoot: worktree };
const codex = { agent: 'codex', sessionId: 's-codex', workstreamRoot: worktree };
const setCode = (p: string, symbol?: string, now?: number) => bp.setBreakpoint({ kind: 'code', path: p, symbol, projectRoot: project, ...sam, now }).breakpoint;

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  bp = await import('./breakpoint-service');
  code = await import('./code-breakpoints');
  log = await import('./agent-event-log');
  log.setEventPublisher((type, payload) => {
    const evt = payload as { type: string; payload: Record<string, unknown> };
    if (type === 'agent-event') published.push({ type: evt.type, payload: evt.payload });
  });
});

beforeEach(() => {
  for (const t of ['breakpoint_hits', 'breakpoints']) db.getDb().run(`DELETE FROM ${t}`);
  code.resetBreachNotices();
  published.length = 0;
});

test('a code breakpoint is on a path in the opened project that exists: a folder gets a /, a function is on its file', () => {
  assert.equal(bp.codeTarget(project, 'payments'), 'payments/');
  assert.equal(bp.codeTarget(project, './payments/refund.ts'), 'payments/refund.ts');
  assert.equal(bp.codeTarget(project, 'payments/refund.ts', 'refund'), 'payments/refund.ts#refund');
  for (const [p, sym, status] of [
    ['../outside', undefined, 400], ['/etc/passwd', undefined, 400], ['payments/../../x', undefined, 400], ['C:/x', undefined, 400],
    ['nope.ts', undefined, 404], ['payments/refund.ts/', undefined, 400], ['payments', 'refund', 400], ['payments/refund.ts', 'rm -rf', 400], [7, undefined, 400],
  ] as const) {
    assert.throws(() => bp.codeTarget(project, p, sym), (e: unknown) => e instanceof bp.BreakpointError && e.status === status, String(p));
  }
  assert.throws(() => bp.setBreakpoint({ kind: 'code', path: 'payments', projectRoot: null, ...sam }), /No project is open/);
});

test('what a target covers: a folder, everything under it; a file or a function, that file', () => {
  assert.ok(bp.codeCovers('payments/', 'payments/refund.ts'));
  assert.ok(bp.codeCovers('payments/', 'payments/deep/x.ts'));
  assert.ok(!bp.codeCovers('payments/', 'payments-v2/x.ts'));
  assert.ok(bp.codeCovers('payments/refund.ts#refund', 'payments/refund.ts'));
  assert.ok(!bp.codeCovers('payments/refund.ts', 'payments/rates.ts'));
});

test('setting it twice is one; the project is the one given by the app', () => {
  const a = setCode('payments');
  const again = bp.setBreakpoint({ kind: 'code', path: 'payments/', projectRoot: project, ...sam });
  assert.equal(again.created, false);
  assert.equal(again.breakpoint.id, a.id);
  assert.equal(a.projectRoot, project);
  assert.equal(a.planUid, null);
});

test('the hook\'s edit is held until a person answers; asking again is the same wait; another file under it is its own', () => {
  setCode('payments', undefined);
  const first = code.enforceEdit(project, 'payments/refund.ts', hook);
  assert.ok(first.kind === 'paused' && first.fresh);
  const again = code.enforceEdit(project, 'payments/refund.ts', hook);
  assert.ok(again.kind === 'paused' && !again.fresh && again.hit.ref === first.hit.ref);
  const other = code.enforceEdit(project, 'payments/rates.ts', hook);
  assert.ok(other.kind === 'paused' && other.hit.ref !== first.hit.ref);
  assert.equal(code.enforceEdit(project, 'README.md', hook).kind, 'pass');
  assert.match(code.heldEditText(first), /paused: waiting for a decision.*payments\/refund\.ts.*The edit was not made/s);
  assert.match(code.heldEditText(first), new RegExp(`await_decision tool with ref "${first.hit.ref}"`));
  assert.deepEqual(published.map((e) => [e.type, e.payload.action, e.payload.path]), [
    ['breakpoint_hit', 'edit_code', 'payments/refund.ts'], ['breakpoint_hit', 'edit_code', 'payments/rates.ts'],
  ]);
  // A call from no known workstream is not held: nothing is ours to hold.
  assert.equal(code.enforceEdit(project, 'payments/refund.ts', { ...hook, workstreamRoot: null }).kind, 'pass');
});

test('continue opens the file to that workstream for every later edit, the steer told once; stop keeps refusing it', () => {
  setCode('payments/refund.ts');
  const held = code.enforceEdit(project, 'payments/refund.ts', hook);
  assert.ok(held.kind === 'paused');
  bp.answerHit({ ref: held.hit.ref, decision: 'steer', note: 'only the currency lookup', ...sam });
  const first = code.enforceEdit(project, 'payments/refund.ts', hook);
  assert.ok(first.kind === 'continue' && first.steer === 'only the currency lookup');
  const second = code.enforceEdit(project, 'payments/refund.ts', hook);
  assert.ok(second.kind === 'continue' && second.steer === null);
  // Another workstream is held on its own.
  assert.equal(code.enforceEdit(project, 'payments/refund.ts', { ...hook, workstreamRoot: project }).kind, 'paused');

  bp.clearBreakpoint({ id: bp.listBreakpoints()[0].id, ...sam });
  setCode('payments/rates.ts');
  const r = code.enforceEdit(project, 'payments/rates.ts', hook);
  assert.ok(r.kind === 'paused');
  bp.answerHit({ ref: r.hit.ref, decision: 'stop', note: 'rates are frozen', ...sam });
  for (let i = 0; i < 2; i++) {
    const s = code.enforceEdit(project, 'payments/rates.ts', hook);
    assert.ok(s.kind === 'stop');
    assert.match(code.heldEditText(s), /stop\. The edit was not made\. Do not change payments\/rates\.ts\. Their answer: rates are frozen/);
  }
  assert.deepEqual(code.editView(code.enforceEdit(project, 'README.md', hook)), { status: 'pass' });
});

test('a breach: a change made after the breakpoint, that nothing allowed, recorded once and never as a pause', () => {
  const b = setCode('payments', undefined, 1_000);
  const changed = [{ path: 'payments/refund.ts', status: 'modified' }, { path: 'README.md', status: 'modified' }];
  const later = () => 5_000;
  const hits = code.recordBreaches(project, codex, changed, 6_000, later);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].path, hits[0].breach, hits[0].action, hits[0].breakpointId], ['payments/refund.ts', true, 'breach', b.id]);
  assert.equal(code.recordBreaches(project, codex, changed, 7_000, later).length, 0, 'recorded once');
  assert.equal(published.at(-1)?.payload.breach, true);
  assert.match(code.breachText(hits), /You changed payments\/refund\.ts, which has a breakpoint.*recorded as a breach\. Stop changing it and call await_decision/s);
  assert.doesNotMatch(code.breachText(hits), /paused/);
});

test('not a breach: changed before the breakpoint, deleted, let through by the hook, or asked by the hook itself', () => {
  setCode('payments', undefined, 10_000);
  const before = () => 5_000;
  assert.equal(code.recordBreaches(project, codex, [{ path: 'payments/refund.ts' }], 20_000, before).length, 0);
  assert.equal(code.recordBreaches(project, codex, [{ path: 'payments/rates.ts', status: 'deleted' }], 20_000, () => 50_000).length, 0);
  // The hook held it and the person said continue: the change was allowed.
  const held = code.enforceEdit(project, 'payments/refund.ts', hook);
  assert.ok(held.kind === 'paused');
  bp.answerHit({ ref: held.hit.ref, decision: 'continue', ...sam });
  assert.equal(code.recordBreaches(project, codex, [{ path: 'payments/refund.ts' }], 20_000, () => 50_000).length, 0);
  assert.equal(code.recordBreaches(project, hook, [{ path: 'payments/rates.ts' }], 20_000, () => 50_000).length, 0);
  // A path that leaves the workstream through a link is never looked at.
  fs.symlinkSync(os.tmpdir(), path.join(worktree, 'payments', 'escape'));
  try {
    assert.equal(code.recordBreaches(project, codex, [{ path: 'payments/escape' }], 20_000, () => 50_000).length, 0);
  } finally {
    fs.unlinkSync(path.join(worktree, 'payments', 'escape'));
  }
});

test('each session in the workstream is told of a waiting breach once; an answered one is not told', () => {
  setCode('payments', undefined, 1_000);
  const [hit] = code.recordBreaches(project, codex, [{ path: 'payments/refund.ts' }], 6_000, () => 5_000);
  assert.deepEqual(code.untoldBreaches(worktree, 's-codex').map((h) => h.ref), [hit.ref]);
  assert.deepEqual(code.untoldBreaches(worktree, 's-codex'), []);
  assert.deepEqual(code.untoldBreaches(worktree, 's-other').map((h) => h.ref), [hit.ref]);
  code.resetBreachNotices();
  bp.answerHit({ ref: hit.ref, decision: 'stop', ...sam });
  assert.deepEqual(code.untoldBreaches(worktree, 's-codex'), []);
  const view = bp.decisionView(bp.getHit(hit.ref)!);
  assert.match(String(view.message), /Stop changing payments\/refund\.ts\. Tell the person what you changed/);
});
