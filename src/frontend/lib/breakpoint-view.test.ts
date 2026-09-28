/**
 * How breakpoints read to a person (Phase 32 B4.3): a pause says what the
 * agent wanted and why it waits; a breach says what happened and is never
 * worded as a pause.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Breakpoint, BreakpointHit } from '@shared/types';
import { agentName, hitHeadline, hitWhy, decisionLabels, breakpointLabel } from './breakpoint-view';

const hit = (over: Partial<BreakpointHit> = {}): BreakpointHit => ({
  ref: 'bp-1', breakpointId: 'bp_1', kind: 'task', breakpointNote: null, breakpointTarget: 'i1', tool: 'claim_item', action: 'claim',
  itemUid: 'i1', itemTitle: 'Partial refunds', path: null, breach: false, signalId: null, planUid: 'p1',
  agent: 'codex', sessionId: 's', workstreamRoot: '/w/app-billing', hitAt: 1, decision: null, note: null,
  answeredAt: null, answeredBy: null, answeredByType: null, ...over,
});
const bp = (over: Partial<Breakpoint>): Breakpoint => ({
  id: 'bp_1', kind: 'task', target: 'i1', targetTitle: 'Payments', planUid: 'p1', projectRoot: null, note: null,
  createdAt: 1, createdBy: 'Sam', createdByType: 'human', ...over,
});

test('agents by the names people know', () => {
  assert.equal(agentName('claude-code-hook'), 'Claude Code');
  assert.equal(agentName('codex'), 'codex');
  assert.equal(agentName(null), 'An agent');
});

test('a pause: who wants to do what, where, and why it waits', () => {
  assert.equal(hitHeadline(hit(), 'billing-v2'), 'codex in billing-v2 wants to claim “Partial refunds”');
  assert.equal(hitHeadline(hit({ action: 'done' })), 'codex wants to mark done “Partial refunds”');
  assert.equal(hitHeadline(hit({ kind: 'code', action: 'edit_code', path: 'payments/refund.ts', agent: 'claude-code-hook' })), 'Claude Code wants to change “payments/refund.ts”');
  assert.match(hitWhy(hit()), /before an agent claims or finishes this task/);
  assert.match(hitWhy(hit({ kind: 'code' })), /The edit was not made/);
  assert.match(hitWhy(hit({ kind: 'signal' })), /A serious signal names this workstream/);
  assert.deepEqual(decisionLabels(hit()), { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' });
});

test('a breach: what already happened, never a pause', () => {
  const b = hit({ kind: 'code', action: 'breach', breach: true, path: 'payments/refund.ts' });
  assert.equal(hitHeadline(b, 'exports'), 'codex in exports changed payments/refund.ts past a breakpoint');
  assert.match(hitWhy(b), /could not be paused/);
  assert.ok(!/wants to|paus(ed|e) /i.test(hitHeadline(b)));
  assert.deepEqual(decisionLabels(b), { continue: 'Carry on', steer: 'Carry on with this note', stop: 'Stop' });
});

test('what is set, in a person\'s words', () => {
  assert.deepEqual(breakpointLabel(bp({})), { what: 'Task “Payments”', when: 'before an agent claims or finishes it, or anything under it' });
  assert.deepEqual(breakpointLabel(bp({ kind: 'spec' })).what, 'Description of “Payments”');
  assert.deepEqual(breakpointLabel(bp({ kind: 'code', target: 'packages/shared/' })), { what: 'Everything in packages/shared/', when: 'before it changes' });
  assert.deepEqual(breakpointLabel(bp({ kind: 'code', target: 'src/a.ts#refund' })), { what: 'refund in src/a.ts', when: 'before an edit touches it' });
  assert.deepEqual(breakpointLabel(bp({ kind: 'signal', target: 'contract' })), { what: 'Any serious contract signal', when: 'while one names a workstream' });
});

test('a function breakpoint names the function in its file (B4.2c)', () => {
  const h = hit({ kind: 'code', action: 'edit_code', path: 'payments/refund.ts', breakpointTarget: 'payments/refund.ts#calculateRefund', agent: 'claude-code-hook' });
  assert.equal(hitHeadline(h), 'Claude Code wants to change “calculateRefund in payments/refund.ts”');
  const breach = hit({ kind: 'code', action: 'breach', breach: true, path: 'payments/refund.ts', breakpointTarget: 'payments/refund.ts#calculateRefund' });
  assert.equal(hitHeadline(breach), 'codex changed calculateRefund in payments/refund.ts past a breakpoint');
});
