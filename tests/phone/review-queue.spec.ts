/**
 * The review queue, on the phone (Phase 32 A5.6), journey C3.
 *
 * Sam is away and two lines of work are ready to land. The queue says which
 * goes first and why: checkout-fix imports what billing-v2 changes, so
 * billing-v2 first. Each line opens to its review, compared commit to commit
 * against main, with the other work in flight beside it. A line waiting for a
 * sign-off opens the approvals; one held by an overlap opens the lines of work.
 *
 * The desktop's side (`review.queue`, `review.get`) is served here as the RPC
 * answers; tests/e2e/review-queue.test.ts checks them against a real backend
 * and a paired phone.
 */
import { test, expect } from '@playwright/test';
import { openScreen, calls, navigations, shot } from './helpers';

const line = (over: Record<string, unknown>) => ({
  planUid: 'p1', planTitle: 'Q4 checkout', workstream: 'branch:x', items: 1,
  criteria: { total: 0, met: 0, waiting: 0, sentBack: 0 }, filesChanged: 1, blastRadius: 0, unplannedEdges: 0,
  openSignals: 0, openHigh: 0, ready: true, status: 'ready', statusWords: 'No criteria, and nothing high overlaps.', position: 1,
  reason: 'No other line of work depends on this one.', ...over,
});

const QUEUE = {
  base: 'main',
  lines: [
    line({ branch: 'billing-v2', workstream: 'branch:billing-v2', filesChanged: 1, blastRadius: 3, openSignals: 1,
      reason: 'Before checkout-fix: it imports validateCreateUser, which this changes, and will need updating after.' }),
    line({ branch: 'checkout-fix', workstream: 'branch:checkout-fix', position: 2, openSignals: 1,
      reason: 'After billing-v2: it changes validateCreateUser, which this imports, so update to it first.' }),
    line({ planUid: 'p2', planTitle: 'Refunds', branch: 'refunds', position: 3, ready: false, status: 'waiting',
      criteria: { total: 2, met: 1, waiting: 1, sentBack: 0 }, filesChanged: 4,
      statusWords: '1 criterion is waiting for sign-off.' }),
    line({ planUid: 'p3', planTitle: 'Auth', branch: 'auth-refresh', position: 4, ready: false, status: 'held', openSignals: 1, openHigh: 1,
      statusWords: 'A high overlap with other work is still open.' }),
  ],
};

test.describe('The review queue', () => {
  test('each line with its place and the reason; a line opens to its review, main against its branch', async ({ page }) => {
    await openScreen(page, 'review-queue', { rpc: { 'review.queue': QUEUE } });
    const lines = page.getByTestId('queue-line');
    await expect(lines).toHaveCount(4);
    await expect(page.getByText(/Each line is reviewed against main/)).toBeVisible();
    await expect(lines.first()).toContainText('billing-v2');
    await expect(lines.first()).toContainText('Ready');
    await expect(lines.first().getByTestId('queue-line-reason')).toHaveText('Before checkout-fix: it imports validateCreateUser, which this changes, and will need updating after.');
    await expect(lines.first().getByTestId('queue-line-facts')).toHaveText('1 file changed · 3 files affected · 1 open overlap');
    await expect(lines.nth(3)).toContainText('A high overlap with other work is still open.');
    await expect(lines.nth(2)).toContainText('Waiting for sign-off');
    await expect(lines.nth(2)).toContainText('1/2 criteria met');
    await expect(lines.nth(3)).toContainText('Held');
    await shot(page, 'review-queue');

    await lines.first().getByTestId('queue-line-reason').click();
    await lines.nth(2).getByText('Sign-offs waiting on you ›').click();
    await lines.nth(3).getByText('See the overlap ›').click();
    expect(await navigations(page)).toEqual([
      { action: 'push', to: '/plan-review?planUid=p1&planTitle=billing-v2&before=commit%3Amain&after=commit%3Abilling-v2' },
      { action: 'push', to: '/approvals' },
      { action: 'push', to: '/workstreams' },
    ]);
  });

  test('nothing assigned to a branch says what would show here', async ({ page }) => {
    await openScreen(page, 'review-queue', { rpc: { 'review.queue': { base: 'main', lines: [] } } });
    await expect(page.getByText('Nothing to review yet')).toBeVisible();
    await expect(page.getByText(/When plan items are assigned to a branch/)).toBeVisible();
  });

  test('an error is shown, not a blank', async ({ page }) => {
    await openScreen(page, 'review-queue', { rpc: { 'review.queue': { __error: 'No active project on the desktop' } } });
    await expect(page.getByText('No active project on the desktop')).toBeVisible();
  });
});

test('the review a line opens compares main to its branch, with the other work in flight', async ({ page }) => {
  await openScreen(page, 'plan-review', {
    rpc: {
      'review.get': {
        planUid: 'p1', items: [{ uid: 'i1', title: 'Strict validation', status: 'done', landed: ['packages/shared/src/validators.ts'], missing: [], verdict: 'landed' }],
        unclaimedChanges: [], unplannedEdges: [],
        otherWork: {
          workstream: { root: 'branch:billing-v2', name: 'billing-v2' },
          entries: [{
            signalId: 'k1', severity: 'high', heading: 'Changed signature',
            sides: [
              { name: 'billing-v2', words: "billing-v2 changed validateCreateUser's signature in packages/shared/src/validators.ts." },
              { name: 'checkout-fix', words: 'checkout-fix imports it, in 1 file: packages/web/src/UserList.tsx.' },
            ],
            merge: 'Merge billing-v2 first; checkout-fix will need updating after.',
            outcomeWords: 'Marked intended: a decision, not an accident.', notes: ['checkout-fix moves its callers next.'],
          }],
        },
        summary: { itemsLanded: 1, itemsPartial: 0, itemsUntouched: 0, filesChanged: 1, unclaimedCount: 0, unplannedEdgeCount: 0 },
      },
      'plan.nextItem': { none: true },
      'review.comparands': [],
    },
  }, { planUid: 'p1', planTitle: 'billing-v2', before: 'commit:main', after: 'commit:billing-v2' });
  await expect(page.getByText('1 file changed between commit:main and commit:billing-v2')).toBeVisible();
  await expect(page.getByTestId('review-other-work')).toContainText('HIGH · Changed signature');
  await expect(page.getByTestId('review-other-work')).toContainText('Merge billing-v2 first; checkout-fix will need updating after.');
  await expect(page.getByTestId('review-other-work')).toContainText('Marked intended: a decision, not an accident.');
  await shot(page, 'review-queue-line');
  expect((await calls(page)).find((c) => c.method === 'review.get')?.params).toEqual({ planUid: 'p1', before: 'commit:main', after: 'commit:billing-v2' });
});
