/**
 * Split view — plan workspace + graph side by side.
 *
 * Covers: Graph toggle button, split view shows both workspace and graph,
 * toggling back returns to workspace-only.
 *
 * Note: In split view, TWO ReactFlow instances exist. Use `.first()`
 * or scope to avoid strict-mode violations.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

test.describe('Split view', () => {
  const PLAN_TITLE = 'E2E Split View Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Split View');
  });

  test('Graph toggle button has correct title', async ({ page, request }) => {
    await seedPlan(request, { title: PLAN_TITLE });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const graphBtn = page.locator('button[title*="Toggle split view"]');
    await expect(graphBtn).toBeVisible({ timeout: 5000 });
  });

  test('clicking Graph toggle enables split view with graph', async ({ page, request }) => {
    await seedPlan(request, { title: PLAN_TITLE });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const graphBtn = page.locator('button[title*="Toggle split view"]');
    await graphBtn.click();
    await page.waitForTimeout(2000);

    // Both workspace (plan title) and graph should be visible
    // In split view, there are TWO .react-flow elements — use .first()
    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('.react-flow').first()).toBeVisible({ timeout: 5000 });
  });

  test('toggling split view off returns to workspace-only', async ({ page, request }) => {
    await seedPlan(request, { title: PLAN_TITLE });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const graphBtn = page.locator('button[title*="Toggle split view"]');

    // Enable split view
    await graphBtn.click();
    await page.waitForTimeout(2000);
    await expect(page.locator('.react-flow').first()).toBeVisible({ timeout: 5000 });

    // Disable split view
    await graphBtn.click();
    await page.waitForTimeout(1000);

    // Workspace should still be visible
    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
    // Graph pane should no longer have two instances
    const rfCount = await page.locator('.react-flow').count();
    expect(rfCount).toBeLessThanOrEqual(1);
  });
});
