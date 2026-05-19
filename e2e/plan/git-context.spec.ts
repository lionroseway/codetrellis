/**
 * Git context chip — base/target branch config on plans.
 *
 * Covers: chip display, API persistence (flat fields: baseRef, targetBranch).
 * Note: The API stores git context as flat fields on the plan, NOT nested
 * in a `gitContext` object.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Git context chip', () => {
  const PLAN_TITLE = 'E2E Git Context Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Git Context');
  });

  test('git context chip is visible on plan home page', async ({ page, request }) => {
    await seedPlan(request, { title: PLAN_TITLE });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Git context chip shows "Set git context" when unconfigured
    await expect(page.getByText('Set git context').first()).toBeVisible({ timeout: 5000 });
  });

  test('git context round-trip via API (flat fields)', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    // Set git context — API uses flat fields on PUT /api/plans/:uid
    const res = await request.put(`${API}/plans/${plan.uid}`, {
      data: {
        baseRef: 'main',
        targetBranch: 'feat/e2e-test',
        targetWorktree: '/tmp/test-worktree',
        autoCreateBranch: true,
      },
    });
    expect(res.ok()).toBeTruthy();

    // Read back — fields are flat on the plan object
    const getRes = await request.get(`${API}/plans/${plan.uid}`);
    const updated = await getRes.json();
    expect(updated.baseRef).toBe('main');
    expect(updated.targetBranch).toBe('feat/e2e-test');
  });

  test('git context shows configured state after API update', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    // Set git context via API
    await request.put(`${API}/plans/${plan.uid}`, {
      data: {
        baseRef: 'main',
        targetBranch: 'feat/git-ctx-test',
      },
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Chip should show the configured branch info (not "Set git context")
    await page.waitForTimeout(1500);
    // Look for branch-related text — the chip shows "main → feat/..."
    const chipArea = page.locator('button').filter({ hasText: /main|feat/i }).first();
    await expect(chipArea).toBeVisible({ timeout: 5000 });
  });
});
