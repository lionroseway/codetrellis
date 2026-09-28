/**
 * One plan across several worktrees, as a person reads it (Phase 32 C5.3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskStatus } from '@shared/types';
import { worktreeOf, progressByWorktree, progressLine, sectionsByBranch } from './section-worktrees';

const item = (uid: string, parentUid: string | null, kind: 'object' | 'action', title: string, extra: { status?: string; workstream?: string | null } = {}) =>
  ({ uid, parentUid, kind, title, status: (extra.status ?? (kind === 'action' ? 'pending' : null)) as TaskStatus | null, workstream: extra.workstream ?? null });

const PLAN = Object.fromEntries([
  item('billing', null, 'object', 'Billing', { workstream: 'checkout-v2-billing' }),
  item('r1', 'billing', 'action', 'Partial refunds', { status: 'done' }),
  item('r2', 'billing', 'action', 'Refund emails'),
  item('r3', 'billing', 'action', 'Old flow', { status: 'skipped' }),
  item('exports', null, 'object', 'Exports', { workstream: 'exports' }),
  item('e1', 'exports', 'action', 'CSV export'),
  item('sub', 'exports', 'object', 'Formats'),
  item('e2', 'sub', 'action', 'XLSX', { status: 'done' }),
  item('docs', null, 'action', 'Write the docs'),
].map((i) => [i.uid, i]));

test('a task is worked where its nearest section says, or anywhere', () => {
  assert.equal(worktreeOf('r1', PLAN), 'checkout-v2-billing');
  assert.equal(worktreeOf('e2', PLAN), 'exports');
  assert.equal(worktreeOf('docs', PLAN), null);
  assert.equal(worktreeOf('missing', PLAN), null);
});

test('progress per worktree, skipped not counted, "any worktree" last', () => {
  assert.deepEqual(progressByWorktree(PLAN), [
    { branch: 'checkout-v2-billing', done: 1, total: 2 },
    { branch: 'exports', done: 1, total: 2 },
    { branch: null, done: 0, total: 1 },
  ]);
  assert.equal(progressLine(progressByWorktree(PLAN)), 'checkout-v2-billing: 1 of 2 · exports: 1 of 2 · any worktree: 0 of 1');
});

test('a plan in one place is not split', () => {
  const single = Object.fromEntries([item('a', null, 'action', 'A'), item('b', null, 'action', 'B', { status: 'done' })].map((i) => [i.uid, i]));
  assert.deepEqual(progressByWorktree(single), []);
});

test('the sections kept to each branch, for the lanes', () => {
  assert.deepEqual([...sectionsByBranch(PLAN)], [['checkout-v2-billing', ['Billing']], ['exports', ['Exports']]]);
});
