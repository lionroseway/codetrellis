/**
 * How breakpoints read to a person (Phase 32 B4.3): a pause says what the
 * agent wanted and why it waits; a breach says what happened and is never
 * worded as a pause.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Breakpoint, BreakpointHit } from '@shared/types';
import { agentName, hitHeadline, hitWhy, decisionLabels, breakpointLabel, nodeBreakpoints, nodeBreakpointTitle, symbolNodeTarget, changedLines } from './breakpoint-view';

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

test('a held edit to a page others rely on says so, and that the agent was told to propose (B7.5a)', () => {
  const edit = hit({ kind: 'spec', action: 'edit', tool: 'update_item', itemTitle: 'Invoice format' });
  assert.equal(hitWhy(edit), 'You asked to be asked before an agent changes this description.');
  assert.equal(
    hitWhy({ ...edit, reliedOn: { tasks: 3, plans: 2 } }),
    'You asked to be asked before an agent changes this description. 3 tasks in 2 plans rely on this page; the agent was told a proposal would let their agents weigh in.',
  );
  assert.match(hitWhy({ ...edit, reliedOn: { tasks: 1, plans: 1 } }), /1 task in 1 plan relies on this page;/);
  // Nothing relying is said as nothing.
  assert.equal(hitWhy({ ...edit, reliedOn: { tasks: 0, plans: 0 } }), hitWhy(edit));
});

test('a plan document changed on disk: no agent named, and the answers say what they do (B7.5b)', () => {
  const disk = hit({ kind: 'spec', action: 'disk', tool: 'plan-file', agent: null, itemTitle: 'Invoice format' });
  assert.equal(hitHeadline(disk), '“Invoice format” changed on disk');
  assert.match(hitWhy(disk), /Its file changed on disk, and the app kept its own version until you decide/);
  assert.match(hitWhy(disk), /apply the file to take its version, or keep the app's and it is written back/);
  assert.deepEqual(decisionLabels(disk), { continue: 'Apply the file', steer: 'Apply the file, with a note', stop: 'Keep the app\'s version' });
});

test('only the lines that changed, with a line either side', () => {
  const before = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n';
  assert.deepEqual(changedLines(before, `${before}- currency\n`), { before: '- amount', after: '- amount\n- currency', from: 7 });
  assert.deepEqual(changedLines('a\nb\nc\nd', 'a\nB\nc\nd'), { before: 'a\nb\nc', after: 'a\nB\nc', from: 1 });
  assert.deepEqual(changedLines('a\nb', 'a\nb\n'), { before: '', after: '', from: 1 });
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

test('the graph: which breakpoints hold a node, and its ⏸ in words (B4.3b)', () => {
  const file = bp({ id: 'f', kind: 'code', target: 'src/pay/refund.ts', targetTitle: null });
  const folder = bp({ id: 'd', kind: 'code', target: 'src/pay/', targetTitle: null });
  const fn = bp({ id: 'fn', kind: 'code', target: 'src/pay/charge.ts#settle', targetTitle: null });
  const task = bp({ id: 't', kind: 'task', target: 'src/pay/refund.ts' });
  const all = [file, folder, fn, task];
  const ids = (n: Parameters<typeof nodeBreakpoints>[1]) => nodeBreakpoints(all, n).map((b) => b.id).sort();

  assert.deepEqual(ids({ nodeType: 'file', path: 'src/pay/refund.ts' }), ['d', 'f']);
  assert.deepEqual(ids({ nodeType: 'file', path: 'src/pay/charge.ts' }), ['d', 'fn']);
  assert.deepEqual(ids({ nodeType: 'file', path: 'src/payroll.ts' }), []);
  assert.deepEqual(ids({ nodeType: 'directory', path: 'src/pay/sub' }), ['d']);
  assert.deepEqual(ids({ nodeType: 'directory', path: 'src' }), []);
  // A function node: its own breakpoint, or its whole file's or folder's; not a sibling's.
  assert.deepEqual(ids({ nodeType: 'symbol', path: 'src/pay/charge.ts::function:settle' }), ['d', 'fn']);
  assert.deepEqual(nodeBreakpoints([fn], { nodeType: 'symbol', path: 'src/pay/charge.ts::function:refund' }), []);

  assert.deepEqual(symbolNodeTarget('src/pay/charge.ts::method:Ledger.post'), { file: 'src/pay/charge.ts', kind: 'method', name: 'Ledger.post' });
  assert.equal(symbolNodeTarget('src/pay/charge.ts'), null);
  assert.equal(nodeBreakpointTitle([fn]), 'Ask me first: settle in src/pay/charge.ts, before an edit touches it');
  assert.equal(nodeBreakpointTitle([file, folder]), 'Ask me first: src/pay/refund.ts, before it changes; Everything in src/pay/, before it changes');
});
