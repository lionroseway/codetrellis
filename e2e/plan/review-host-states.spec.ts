/**
 * What the review host adds, from the window (Phase 32 C2.2b).
 *
 * Sam turned GitHub on for the project. The tree shows Billing "in review",
 * Exports "merged" by its pull request and Refunds "closed", each "from
 * GitHub" on hover; Docs has no pull request, so it keeps git's "building",
 * and the hover says GitHub has none. Opening a task under Billing shows its
 * pull request as a link, the checks and approval, and the source.
 *
 * The states are given (the backend's side, against a stand-in GitHub, is
 * `tests/e2e/review-host-github.test.ts`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';
import type { Workstream } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C2.2b review host plan';

const ws = (root: string, branch: string, main = false): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main, shape: 'worktree', agents: [],
  changes: { base: null, files: [], truncated: false }, idle: true,
} as unknown as Workstream);
const ROOM = [ws('/work/acme', 'main', true), ws('/work/acme-billing', 'billing'), ws('/work/acme-exports', 'exports'), ws('branch:refunds', 'refunds'), ws('branch:docs', 'docs')];

async function openRouting(page: Page, title: string) {
  await page.getByText(title, { exact: true }).first().click();
  const worked = page.getByTestId('worked-in');
  await expect(async () => {
    if (!(await worked.isVisible())) await page.getByRole('button', { name: /Routing & Execution/i }).click();
    await expect(worked).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return worked;
}

test.describe('What the review host adds', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('in review, merged and closed from GitHub on the tree; a task shows its pull request, checks and source', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [] });
    const at = Date.now();
    const item = (uid: string, parentUid: string | null, kind: 'object' | 'action', title: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
      uid, planUid: plan.uid, parentUid, sortOrder, kind, title, body: '', template: null,
      status: kind === 'action' ? 'pending' : null, assignee: null, assigneeType: null, assigneeModel: null,
      progressPercent: null, blockedReason: null, scopePath: null, fileSpecs: [], symbolSpecs: [], newConnections: [],
      removedConnections: [], dependencies: [], skills: [], skillsMode: 'inherit', claimPolicy: null, claimPolicyMode: 'inherit',
      executionConfig: null, executionConfigMode: 'inherit', constraints: null, constraintsMode: 'inherit', requiresApproval: false,
      author: 'Sam', authorType: 'human', createdAt: at, updatedAt: at, migratedFrom: null, visibility: 'shared',
      overrideParentVisibility: false, assigneeSession: null, workstream: null, ...extra,
    });
    const ITEMS = [
      item('c21-billing', null, 'object', 'Billing', 0, { workstream: 'billing' }),
      item('c21-currency', 'c21-billing', 'action', 'Charge in the right currency', 0),
      item('c21-exports', null, 'object', 'Exports', 1, { workstream: 'exports' }),
      item('c21-refunds', null, 'object', 'Refunds', 2, { workstream: 'refunds' }),
      item('c21-docs', null, 'object', 'Docs', 3, { workstream: 'docs' }),
    ];
    const review = { number: 118, url: 'https://github.com/acme/app/pull/118', checks: 'passing', approvals: 1, changesRequested: false };
    const inReview = { state: 'in-review', source: 'github', branch: 'billing', base: 'main', commit: '1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d', at: 1_790_000_000, review, words: 'in review (#118), checks passing, 1 approval' };
    const STATES = {
      base: 'main',
      items: [
        { ...inReview, itemUid: 'c21-billing', fromUid: 'c21-billing' },
        { ...inReview, itemUid: 'c21-currency', fromUid: 'c21-billing' },
        { itemUid: 'c21-exports', fromUid: 'c21-exports', state: 'merged', source: 'github', how: 'pull-request', branch: 'exports', base: 'main', commit: '9c1e5b2a7d3f4e8a1b6c0d9e2f3a4b5c6d7e8f90', at: 1_790_000_000, review: { ...review, number: 119, url: 'https://github.com/acme/app/pull/119' }, words: 'merged into main (#119, 22 Sept)' },
        { itemUid: 'c21-refunds', fromUid: 'c21-refunds', state: 'closed', source: 'github', branch: 'refunds', base: 'main', commit: 'b6c0d9e2f3a4b5c6d7e8f909c1e5b2a7d3f4e8a1', at: 1_790_100_000, review: { ...review, number: 120, url: 'https://github.com/acme/app/pull/120' }, words: 'closed without merging (#120, 23 Sept)' },
        { itemUid: 'c21-docs', fromUid: 'c21-docs', state: 'building', source: 'git', branch: 'docs', base: 'main', commit: 'd0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5', at: 1_790_000_000, hostNote: 'GitHub has no pull request for this branch.', words: 'building on docs, not pushed' },
      ],
    };
    let asked = 0;
    await page.route(`**/api/plans/${plan.uid}/items`, (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ITEMS) })
      : route.fallback()));
    await page.route(`**/api/plans/${plan.uid}/git-state`, (route) => { asked++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATES) }); });
    await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOM) }));
    await page.route('**/api/awareness?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals: [] }) }));
    await page.route((url) => /^\/api\/items\/[^/]+\/workstream$/.test(url.pathname), (route) => {
      const uid = new URL(route.request().url()).pathname.split('/')[3];
      const section = uid === 'c21-currency' || uid === 'c21-billing' ? { branch: 'billing', fromUid: 'c21-billing', fromTitle: 'Billing' } : null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ own: uid === 'c21-billing' ? 'billing' : null, section, where: section ? 'billing in /work/acme-billing' : null }) });
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN);

    const tree = page.getByTestId('plan-item-tree');
    const row = (title: string) => tree.locator('[aria-current], div.group').filter({ hasText: title }).first();
    const chip = (title: string) => row(title).getByTestId('item-git-state');
    await expect(chip('Billing')).toHaveText('in review');
    await expect(chip('Billing')).toHaveAttribute('data-source', 'github');
    await expect(chip('Billing')).toHaveAttribute('title', 'in review (#118), checks passing, 1 approval — from GitHub, 1c2d3e4');
    await expect(chip('Exports')).toHaveText('merged');
    await expect(chip('Exports')).toHaveAttribute('title', 'merged into main (#119, 22 Sept) — from GitHub, 9c1e5b2');
    await expect(chip('Refunds')).toHaveText('closed');
    await expect(chip('Docs')).toHaveText('building');
    await expect(chip('Docs')).toHaveAttribute('title', 'building on docs, not pushed — from git, d0c5d0c. GitHub has no pull request for this branch.');
    expect(asked).toBeGreaterThan(0);
    fs.mkdirSync(OUT, { recursive: true });
    await tree.screenshot({ path: path.join(OUT, 'review-host-tree.png') });

    // A task under Billing: its pull request as a link, what GitHub says, and that GitHub said it.
    const worked = await openRouting(page, 'Charge in the right currency');
    const line = worked.getByTestId('worked-in-git');
    await expect(line).toHaveAttribute('data-state', 'in-review');
    await expect(line).toHaveAttribute('data-source', 'github');
    await expect(line).toContainText('in review (#118), checks passing, 1 approval');
    await expect(line).toContainText('from GitHub');
    await expect(line.getByTestId('worked-in-pr')).toHaveAttribute('href', 'https://github.com/acme/app/pull/118');
    await worked.screenshot({ path: path.join(OUT, 'review-host-worked-in.png') });
  });
});
