/**
 * Signal breakpoints (Phase 32 B4.2b): a project rule on a kind of serious
 * signal holds the named workstreams' next guarded call while the signal is
 * open. The signals are given; the rules and hits are real rows.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AwarenessSignal } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-signal-bp-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let bp: typeof import('./breakpoint-service');
let sig: typeof import('./signal-breakpoints');

const project = '/w/app';
const billing = '/w/app-billing';
const checkout = '/w/app-checkout';
const sam = { by: 'Sam', byType: 'human' };
const codex = { agent: 'codex', sessionId: 's-codex', workstreamRoot: checkout };
const claim = { tool: 'claim_item', action: 'claim' as const, itemUid: 'i1' };

const signal = (over: Partial<AwarenessSignal> = {}): AwarenessSignal => ({
  id: 'sig-contract-1', kind: 'contract', severity: 'high', state: 'open',
  subject: { file: 'src/billing/invoice.ts', symbol: 'createInvoice' },
  workstreams: [billing, checkout], summary: '`billing-v2` changed createInvoice; `checkout-fix` imports it',
  firstSeen: 1, lastSeen: 1, ...over,
} as AwarenessSignal);

let current: AwarenessSignal[] = [];
const signalsOf = (_root: string, ws: string) => current.filter((s) => s.workstreams.includes(ws));
const enforce = (caller = codex, attempt: import('./signal-breakpoints').Attempt = claim) => sig.enforceSignals(project, caller, attempt, Date.now(), signalsOf);

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  bp = await import('./breakpoint-service');
  sig = await import('./signal-breakpoints');
});

beforeEach(() => {
  for (const t of ['breakpoint_hits', 'breakpoints']) db.getDb().run(`DELETE FROM ${t}`);
  current = [signal()];
});

test('a rule is on a kind that can be serious, for the opened project; twice is one', () => {
  const a = bp.setBreakpoint({ kind: 'signal', signal: 'contract', note: 'contract changes need me', projectRoot: project, ...sam });
  assert.equal(a.created, true);
  assert.deepEqual([a.breakpoint.kind, a.breakpoint.target, a.breakpoint.projectRoot], ['signal', 'contract', project]);
  assert.equal(bp.setBreakpoint({ kind: 'signal', signal: 'contract', projectRoot: project, ...sam }).breakpoint.id, a.breakpoint.id);
  assert.throws(() => bp.setBreakpoint({ kind: 'signal', signal: 'stale-base', projectRoot: project, ...sam }), /signal must be one of collision, contract, drift/);
  assert.throws(() => bp.setBreakpoint({ kind: 'signal', signal: 'contract', projectRoot: null, ...sam }), /No project is open/);
});

test('no rule, nothing held; a rule holds a named workstream\'s guarded call while its high signal is open', () => {
  assert.equal(enforce().kind, 'pass');
  bp.setBreakpoint({ kind: 'signal', signal: 'contract', projectRoot: project, ...sam });
  const held = enforce();
  assert.ok(held.kind === 'paused' && held.fresh && held.signal.id === 'sig-contract-1');
  assert.equal(held.hit.signalId, 'sig-contract-1');
  // Asking again, or making another guarded call, is the same wait.
  const again = enforce(codex, { tool: 'update_item', action: 'done', itemUid: 'i2' });
  assert.ok(again.kind === 'paused' && !again.fresh && again.hit.ref === held.hit.ref);
  // The other named side is held on its own; a workstream not named, or none, is not.
  const other = enforce({ agent: 'claude-code', sessionId: 's-b', workstreamRoot: billing });
  assert.ok(other.kind === 'paused' && other.hit.ref !== held.hit.ref);
  assert.equal(enforce({ ...codex, workstreamRoot: '/w/app-exports' }).kind, 'pass');
  assert.equal(enforce({ ...codex, workstreamRoot: null }).kind, 'pass');
  assert.match(sig.signalHeldText(held), /paused: waiting for a decision\. Your workstream is named in a serious contract signal: `billing-v2` changed createInvoice/);
});

test('only high and open signals of the rule\'s kind hold', () => {
  bp.setBreakpoint({ kind: 'signal', signal: 'contract', projectRoot: project, ...sam });
  for (const over of [{ severity: 'medium' as const }, { state: 'acknowledged' as const }, { state: 'intended' as const }, { kind: 'collision' as const }]) {
    current = [signal(over)];
    assert.equal(enforce().kind, 'pass', JSON.stringify(over));
  }
});

test('continue releases that workstream from that signal, the steer told once; stop keeps refusing', () => {
  bp.setBreakpoint({ kind: 'signal', signal: 'contract', projectRoot: project, ...sam });
  const held = enforce();
  assert.ok(held.kind === 'paused');
  bp.answerHit({ ref: held.hit.ref, decision: 'steer', note: 'keep the old signature as a default', ...sam });
  const first = enforce();
  assert.ok(first.kind === 'continue' && first.steer === 'keep the old signature as a default');
  const second = enforce();
  assert.ok(second.kind === 'continue' && second.steer === null);

  const b = enforce({ agent: 'claude-code', sessionId: 's-b', workstreamRoot: billing });
  assert.ok(b.kind === 'paused');
  bp.answerHit({ ref: b.hit.ref, decision: 'stop', note: 'wait for the billing merge', ...sam });
  for (let i = 0; i < 2; i++) {
    const s = enforce({ agent: 'claude-code', sessionId: 's-b', workstreamRoot: billing });
    assert.ok(s.kind === 'stop');
    assert.match(sig.signalHeldText(s), /stop\. Nothing was done\. Their answer: wait for the billing merge/);
  }
});

test('the person answering the signal in Awareness lets a waiting call through, recorded as CodeTrellis, not as a person', () => {
  bp.setBreakpoint({ kind: 'signal', signal: 'contract', projectRoot: project, ...sam });
  const held = enforce();
  assert.ok(held.kind === 'paused');
  assert.deepEqual(sig.releaseSettled(project, current), [], 'still open: nothing released');
  current = [signal({ state: 'intended' })];
  const released = sig.releaseSettled(project, current);
  assert.deepEqual(released.map((h) => [h.ref, h.decision, h.answeredByType, h.note]), [[held.hit.ref, 'continue', 'system', 'The signal was answered in Awareness.']]);
  assert.equal(enforce().kind, 'pass');
});

test('the attempt of an MCP call: the guarded calls only', () => {
  assert.deepEqual(sig.attemptOf('claim_item', { uid: 'i1' }), { tool: 'claim_item', action: 'claim', itemUid: 'i1' });
  assert.deepEqual(sig.attemptOf('update_item', { uid: 'i1', body: 'x' }), { tool: 'update_item', action: 'edit', itemUid: 'i1' });
  assert.equal(sig.attemptOf('list_plans', {}), null);
});
