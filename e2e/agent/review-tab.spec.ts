/**
 * The Review tab (Phase 32 A5.5): what is in review, in a suggested merge
 * order with its reasons, and one line's review with the other work in
 * flight around it.
 *
 * What the backend builds is proven by tests/e2e/review-queue.test.ts and
 * review-other-work.test.ts against real branches. This drives the app with
 * fixed answers so each state is shown and photographed: the queue, a line
 * opened, and nothing in review.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { ReviewQueue } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const QUEUE: ReviewQueue = {
  base: 'main',
  lines: [
    {
      planUid: 'p1', planTitle: 'Q4 checkout', branch: 'billing-v2', workstream: '/work/acme-billing', items: 1,
      criteria: { total: 2, met: 1, waiting: 1, sentBack: 0 }, filesChanged: 2, blastRadius: 3, unplannedEdges: 1,
      openSignals: 1, openHigh: 1, ready: false, status: 'held', statusWords: 'A high overlap with other work is still open.',
      position: 1, reason: 'Before checkout-fix: it imports validateCreateUser, which this changes, and will need updating after.',
    },
    {
      planUid: 'p1', planTitle: 'Q4 checkout', branch: 'checkout-fix', workstream: '/work/acme-checkout', items: 1,
      criteria: { total: 1, met: 1, waiting: 0, sentBack: 0 }, filesChanged: 1, blastRadius: 0, unplannedEdges: 0,
      openSignals: 1, openHigh: 1, ready: false, status: 'held', statusWords: 'A high overlap with other work is still open.',
      position: 2, reason: 'After billing-v2: it changes validateCreateUser, which this imports, so update to it first.',
    },
    {
      planUid: 'p2', planTitle: 'Docs refresh', branch: 'docs-tidy', workstream: 'branch:docs-tidy', items: 2,
      criteria: { total: 0, met: 0, waiting: 0, sentBack: 0 }, filesChanged: 4, blastRadius: 0, unplannedEdges: 0,
      openSignals: 0, openHigh: 0, ready: true, status: 'ready', statusWords: 'No criteria, and nothing high overlaps.',
      position: 3, reason: 'No other line of work depends on this one.',
    },
  ],
};

const BILLING_REVIEW = {
  unplannedEdges: [{ source: 'packages/web/src/Extra.ts', target: 'packages/web/src/api.ts' }],
  comparison: { diff: { addedFiles: ['packages/web/src/Extra.ts'], modifiedFiles: ['packages/shared/src/validators.ts'], removedFiles: [] } },
  otherWork: {
    workstream: { root: '/work/acme-billing', name: 'billing-v2' },
    openHigh: 1,
    entries: [{
      signalId: 'k1', kind: 'contract', severity: 'high', heading: 'Changed signature',
      sides: [
        { name: 'billing-v2', words: "billing-v2 changed validateCreateUser's signature in packages/shared/src/validators.ts." },
        { name: 'checkout-fix', words: 'checkout-fix imports it, in 1 file: packages/web/src/UserList.tsx.' },
      ],
      outcome: 'acknowledged', outcomeWords: 'Acknowledged by the person.',
      notes: ['codex: I will pass strict=false until billing-v2 merges.'],
      merge: 'Merging this changes validateCreateUser; checkout-fix imports it and will need updating.',
    }],
  },
};

async function serve(page: Page, queue: ReviewQueue) {
  const reviews: string[] = [];
  await page.route('**/api/review-queue?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(queue) }));
  await page.route('**/api/plans/*/review?*', (route) => {
    const url = new URL(route.request().url());
    reviews.push(`${url.searchParams.get('before')}..${url.searchParams.get('after')}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BILLING_REVIEW) });
  });
  return reviews;
}

const tabButton = (page: Page) => page.getByRole('button', { name: /^Review$/ });
const expandPanel = (page: Page) => tabButton(page).locator('..').getByRole('button', { name: 'Expand panel' }).click();

test.describe('Review tab', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the queue in order, each line with where it stands and why it goes there', async ({ page }) => {
    await serve(page, QUEUE);
    await gotoWithProject(page);
    await tabButton(page).click();

    const tab = page.getByTestId('review-tab');
    await expect(tab).toContainText('A suggested merge order, each line reviewed against main. It is a suggestion; nothing is enforced.');
    const lines = tab.getByTestId('review-line');
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toContainText('billing-v2');
    await expect(lines.nth(0).getByTestId('review-line-status')).toHaveText('Held');
    await expect(lines.nth(0).getByTestId('review-line-reason')).toHaveText('Before checkout-fix: it imports validateCreateUser, which this changes, and will need updating after.');
    await expect(lines.nth(0)).toContainText('1/2 criteria met · 2 files changed · 3 files affected · 1 unplanned dependency · 1 open overlap');
    await expect(lines.nth(1).getByTestId('review-line-reason')).toHaveText(/^After billing-v2/);
    await expect(lines.nth(2).getByTestId('review-line-status')).toHaveText('Ready');
    await expect(lines.nth(2)).toContainText('No criteria, and nothing high overlaps. · 4 files changed');

    await expandPanel(page);
    await shot(page, 'review-tab');
  });

  test('opening a line reviews its branch against main, with the other work in flight', async ({ page }) => {
    const reviews = await serve(page, QUEUE);
    await gotoWithProject(page);
    await tabButton(page).click();
    await page.getByTestId('review-line').first().getByRole('button').first().click();

    const detail = page.getByTestId('review-line-detail');
    await expect(detail).toBeVisible();
    // The branch is reviewed against main (React's development mode may ask twice).
    expect([...new Set(reviews)]).toEqual(['commit:main..commit:billing-v2']);
    const other = detail.getByTestId('review-other-work');
    await expect(other).toContainText("HIGH · Changed signature. billing-v2 changed validateCreateUser's signature");
    await expect(other).toContainText('Merging this changes validateCreateUser; checkout-fix imports it and will need updating.');
    await expect(other).toContainText('Acknowledged by the person.');
    await expect(other).toContainText('“codex: I will pass strict=false until billing-v2 merges.”');
    await expect(detail).toContainText('packages/web/src/Extra.ts → packages/web/src/api.ts');
    await expect(detail).toContainText('Mpackages/shared/src/validators.ts');

    await expandPanel(page);
    await shot(page, 'review-tab-line');
  });

  test('since your last look: what moved, and marking the line reviewed (V3)', async ({ page }) => {
    await serve(page, QUEUE);
    let marked = false;
    const posts: unknown[] = [];
    await page.route('**/api/review/architecture?*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(marked
        ? { words: [], since: { words: 'Nothing changed since you looked at a1b2c3d.', changed: [], addressed: [], added: [] } }
        : { words: [], since: {
            words: 'Since you looked at 9f8e7d6: 2 files changed, 1 finding addressed, 1 new.',
            changed: ['packages/web/src/Extra.ts', 'packages/shared/src/validators.ts'],
            addressed: ['✗ packages/web/src/Extra.ts now imports packages/shared/src/validators.ts, which it forbids (web-through-shared-index)'],
            added: ['Adds an HTTP call to POST /api/refunds (packages/web/src/Extra.ts:9)'],
          } }),
    }));
    await page.route('**/api/review/seen?*', (route) => {
      posts.push(route.request().postDataJSON());
      marked = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ target: 'billing-v2', commit: 'a1b2c3d4e5f6', reviewerType: 'human', findings: [] }) });
    });
    await gotoWithProject(page);
    await tabButton(page).click();
    await page.getByTestId('review-line').first().getByRole('button').first().click();

    const since = page.getByTestId('review-since');
    await expect(since.getByTestId('review-since-words')).toHaveText('Since you looked at 9f8e7d6: 2 files changed, 1 finding addressed, 1 new.');
    await expect(since.getByTestId('review-since-addressed')).toHaveText(/^✗ packages\/web\/src\/Extra\.ts now imports/);
    await expect(since.getByTestId('review-since-added')).toHaveText('New: Adds an HTTP call to POST /api/refunds (packages/web/src/Extra.ts:9)');
    await expandPanel(page);
    await shot(page, 'review-tab-since');

    await since.getByTestId('review-mark-reviewed').click();
    await expect(since.getByTestId('review-since-marked')).toHaveText('Marked reviewed at a1b2c3d.');
    await expect(since.getByTestId('review-since-words')).toHaveText('Nothing changed since you looked at a1b2c3d.');
    expect(posts).toEqual([{ base: 'main', head: 'billing-v2' }]);
  });

  test('nothing in review says how a line gets there', async ({ page }) => {
    await serve(page, { base: 'main', lines: [] });
    await gotoWithProject(page);
    await tabButton(page).click();
    await expect(page.getByTestId('review-empty')).toHaveText('Nothing is in review. A line of work shows here once a plan’s items name its branch.');
    await shot(page, 'review-tab-empty');
  });
});
