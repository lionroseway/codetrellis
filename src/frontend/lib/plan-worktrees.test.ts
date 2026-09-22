/**
 * Which plan belongs to which checkout. The switcher and the Plans tab
 * both group through `groupPlansByWorktree`, so its rules are pinned here.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { groupPlansByWorktree, worktreeLabel, type WorktreeInfo } from './plan-worktrees';

const wt = (path: string, branch: string | null, extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  path, branch, head: null, isMain: false, isCurrent: false, plans: [], ...extra,
});
const plan = (uid: string, projectPath: string) => ({ uid, title: uid, status: 'draft' as const, projectPath });

const WORKTREES = [
  wt('/r/main', 'main', { isMain: true }),
  wt('/r/feat', 'feat/x', { isCurrent: true }),
  wt('/r/fix', 'fix/y', { plans: [{ uid: 'disk-only', title: 'Written by an agent there', status: 'draft' }, { uid: 'p-fix', title: 'p-fix', status: 'draft' }] }),
];

describe('groupPlansByWorktree', () => {
  const g = groupPlansByWorktree(
    [plan('p-main', '/r/main'), plan('p-feat', '/r/feat/'), plan('p-fix', '/r/fix'), plan('p-else', '/elsewhere')],
    WORKTREES,
    '/r/feat',
  );

  test('the open checkout gets its own plans, trailing slash or not', () => {
    assert.deepEqual(g.current?.plans.map((p) => p.uid), ['p-feat']);
    assert.deepEqual(g.here.map((p) => p.uid), ['p-feat']);
  });

  test('sibling worktrees list their plans, main checkout first', () => {
    assert.deepEqual(g.otherWorktrees.map((x) => x.worktree.branch), ['main', 'fix/y']);
    assert.deepEqual(g.otherWorktrees[1].plans.map((p) => p.uid), ['p-fix']);
  });

  test('a plan on a worktree disk but not in the app is offered, and only once imported is it a plan', () => {
    assert.deepEqual(g.otherWorktrees[1].onDiskOnly.map((p) => p.uid), ['disk-only']);
  });

  test('plans for unrelated projects are kept apart, not dropped', () => {
    assert.deepEqual(g.otherProjects.map((p) => p.uid), ['p-else']);
  });

  test('without worktree info (not a repo, or loading) this root\'s plans are still "here"', () => {
    const bare = groupPlansByWorktree([plan('a', '/p'), plan('b', '/q')], [], '/p');
    assert.equal(bare.current, null);
    assert.deepEqual(bare.here.map((p) => p.uid), ['a']);
    assert.deepEqual(bare.otherProjects.map((p) => p.uid), ['b']);
  });

  test('a worktree is named by its branch, else its folder', () => {
    assert.equal(worktreeLabel({ branch: 'feat/x', path: '/r/feat' }), 'feat/x');
    assert.equal(worktreeLabel({ branch: null, path: '/r/detached-one' }), 'detached-one');
  });
});
