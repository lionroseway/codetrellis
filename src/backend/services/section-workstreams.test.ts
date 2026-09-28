/**
 * One plan, several worktrees (Phase 32 C5.1): a section's branch is
 * inherited, an agent elsewhere is not offered or given its tasks, and is
 * told where they are worked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanItem, Workstream } from '@shared/types';
import { cleanBranch, resolveSection, workstreamOfBranch, branchOfRoot, whereWorked, claimRefusal, offeredTo, elsewhereLine } from './section-workstreams';

const item = (uid: string, parentUid: string | null, title: string, workstream: string | null = null): PlanItem =>
  ({ uid, parentUid, title, workstream, planUid: 'p', kind: parentUid ? 'action' : 'object' } as PlanItem);

const PLAN = [
  item('checkout', null, 'Checkout v2'),
  item('billing', 'checkout', 'Billing', 'checkout-v2-billing'),
  item('refunds', 'billing', 'Partial refunds'),
  item('exports', 'checkout', 'Exports', 'exports'),
  item('csv', 'exports', 'CSV export'),
  item('docs', 'checkout', 'Write the docs'),
];
const byUid = new Map(PLAN.map((i) => [i.uid, i]));
const get = (uid: string) => byUid.get(uid) ?? null;

const ws = (root: string, branch: string | null, main = false): Workstream =>
  ({ root, branch, main, head: null, shape: 'worktree', agents: [], changes: { files: [], truncated: false, base: null }, idle: false } as unknown as Workstream);
const ROOM = [ws('/w/app', 'main', true), ws('/w/app-billing', 'checkout-v2-billing'), ws('/w/app-exports', 'exports'), ws('branch:spike', 'spike')];

test('a branch name, or nothing: a plan file is anyone\'s text', () => {
  assert.equal(cleanBranch(' checkout-v2/billing '), 'checkout-v2/billing');
  assert.equal(cleanBranch('feat/phase-32-c5.1'), 'feat/phase-32-c5.1');
  for (const bad of ['', '../etc', '/abs', 'a//b', 'x.lock', '-rf', 'a b', 'a\nb', 'x'.repeat(101), 42, null]) {
    assert.equal(cleanBranch(bad), null, String(bad));
  }
});

test('a section\'s branch is inherited by everything under it; the nearest wins', () => {
  assert.deepEqual(resolveSection(get('refunds')!, get), { branch: 'checkout-v2-billing', fromUid: 'billing', fromTitle: 'Billing' });
  assert.deepEqual(resolveSection(get('billing')!, get), { branch: 'checkout-v2-billing', fromUid: 'billing', fromTitle: 'Billing' });
  assert.equal(resolveSection(get('docs')!, get), null);
  assert.equal(resolveSection(get('checkout')!, get), null);
});

test('a branch is found as a worktree first, and named with its folder', () => {
  assert.equal(workstreamOfBranch('exports', ROOM)?.root, '/w/app-exports');
  assert.equal(branchOfRoot('/w/app-billing', ROOM), 'checkout-v2-billing');
  assert.equal(branchOfRoot(null, ROOM), null);
  assert.equal(branchOfRoot('/elsewhere', ROOM), null);
  assert.equal(whereWorked('exports', ROOM), 'exports in /w/app-exports');
  assert.equal(whereWorked('spike', ROOM), 'spike (checked out in no worktree yet)');
  assert.equal(whereWorked('gone', ROOM), 'gone (no worktree or branch of that name here yet)');
});

test('an agent in another worktree may not claim, and is told where the section is worked', () => {
  const refunds = get('refunds')!;
  const section = resolveSection(refunds, get);
  assert.equal(claimRefusal(refunds, section, 'checkout-v2-billing', ROOM), null);
  assert.equal(
    claimRefusal(refunds, section, 'exports', ROOM),
    '“Partial refunds” is in “Billing”, which is worked on checkout-v2-billing in /w/app-billing. You are working on exports. Start a session there to claim it, or ask the person to move the section to your worktree.',
  );
  // Set on the task itself: no "is in".
  assert.match(claimRefusal(get('billing')!, section, 'main', ROOM)!, /^“Billing” is worked on checkout-v2-billing in \/w\/app-billing\. You are working on main\./);
  // An agent whose worktree is unknown is not in the section either, and is told why.
  assert.match(claimRefusal(refunds, section, null, ROOM)!, /cannot tell which worktree you are in/);
  // No section: anyone.
  assert.equal(claimRefusal(get('docs')!, null, null, ROOM), null);
});

test('get_next_item offers unassigned sections and the caller\'s own; the rest are counted by branch', () => {
  const sec = (uid: string) => resolveSection(get(uid)!, get);
  assert.equal(offeredTo(sec('docs'), 'exports'), true);
  assert.equal(offeredTo(sec('csv'), 'exports'), true);
  assert.equal(offeredTo(sec('refunds'), 'exports'), false);
  assert.equal(offeredTo(sec('refunds'), null), false);
  assert.equal(elsewhereLine(['a', 'b', 'a', 'a', 'c', 'b']), '3 in a, 2 in b, 1 in c');
  assert.equal(elsewhereLine([]), '');
});
