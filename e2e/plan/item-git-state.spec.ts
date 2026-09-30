/**
 * Each item's state from git, from the window (Phase 32 C2.1).
 *
 * Sam's plan has three sections on three branches. With no host turned on,
 * the tree shows what git proves on each section: "merged", "pushed",
 * "building", with the words and the commit on hover. Opening a task shows
 * its section's state in words, the commit that proves it, and "from git".
 *
 * The items and the states are given (CI's checkout has no such branches);
 * the backend's side, on real repositories, is
 * `tests/e2e/item-git-state.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';
import type { Workstream } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C2.1 git state plan';

const ws = (root: string, branch: string, main = false): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main, shape: 'worktree', agents: [],
  changes: { base: null, files: [], truncated: false }, idle: true,
} as unknown as Workstream);
const ROOM = [ws('/work/acme', 'main', true), ws('/work/acme-billing', 'billing'), ws('/work/acme-exports', 'exports'), ws('branch:refunds', 'refunds')];

async function openRouting(page: Page, title: string) {
  await page.getByText(title, { exact: true }).first().click();
  const worked = page.getByTestId('worked-in');
  await expect(async () => {
    if (!(await worked.isVisible())) await page.getByRole('button', { name: /Routing & Execution/i }).click();
    await expect(worked).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return worked;
}

test.describe('Each item\'s state from git', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('the tree shows what git proves on each section; a task shows its section\'s, with the commit', async ({ page, request }) => {
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
      item('c21-docs', null, 'action', 'Write the docs', 3),
    ];
    const merged = { state: 'merged', source: 'git', branch: 'billing', base: 'main', commit: '9c1e5b2a7d3f4e8a1b6c0d9e2f3a4b5c6d7e8f90', at: 1_790_000_000, how: 'squash-or-rebase', words: 'merged into main (squash or rebase, 22 Sept)' };
    const STATES = {
      base: 'main',
      items: [
        { ...merged, itemUid: 'c21-billing', fromUid: 'c21-billing' },
        { ...merged, itemUid: 'c21-currency', fromUid: 'c21-billing' },
        { itemUid: 'c21-exports', fromUid: 'c21-exports', state: 'pushed', source: 'git', branch: 'exports', base: 'main', commit: 'a7d3f4e8a1b6c0d9e2f3a4b5c6d7e8f909c1e5b2', at: 1_790_000_000, remote: 'origin', words: 'pushed, not merged' },
        { itemUid: 'c21-refunds', fromUid: 'c21-refunds', state: 'building', source: 'git', branch: 'refunds', base: 'main', commit: 'b6c0d9e2f3a4b5c6d7e8f909c1e5b2a7d3f4e8a1', at: 1_790_000_000, words: 'building on refunds, not pushed' },
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
    await expect(row('Billing').getByTestId('item-git-state')).toHaveText('merged');
    await expect(row('Billing').getByTestId('item-git-state')).toHaveAttribute('title', 'merged into main (squash or rebase, 22 Sept) — from git, 9c1e5b2');
    await expect(row('Exports').getByTestId('item-git-state')).toHaveText('pushed');
    await expect(row('Refunds').getByTestId('item-git-state')).toHaveText('building');
    // Only on the sections that name a branch: a task inherits it without repeating it, and a task on no branch has none.
    await expect(tree.getByTestId('item-git-state')).toHaveCount(3);
    expect(asked).toBeGreaterThan(0);
    fs.mkdirSync(OUT, { recursive: true });
    await tree.screenshot({ path: path.join(OUT, 'item-git-state-tree.png') });

    // A task under Billing: its section's state, the commit, and where it came from.
    const worked = await openRouting(page, 'Charge in the right currency');
    const line = worked.getByTestId('worked-in-git');
    await expect(line).toHaveAttribute('data-state', 'merged');
    await expect(line).toContainText('merged into main (squash or rebase, 22 Sept)');
    await expect(line).toContainText('9c1e5b2');
    await expect(line).toContainText('from git');
    await worked.screenshot({ path: path.join(OUT, 'item-git-state-worked-in.png') });
  });
});
