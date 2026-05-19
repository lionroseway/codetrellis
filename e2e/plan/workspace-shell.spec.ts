/**
 * Workspace shell — the 3-region plan workspace layout.
 *
 * Covers: layout renders, header elements, minimize/restore,
 * Escape key, minimized chip.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

test.describe('Workspace shell', () => {
  const PLAN_TITLE = 'E2E Workspace Shell Plan';

  test.beforeEach(async ({ request }) => {
    await seedPlan(request, { title: PLAN_TITLE });
  });

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Workspace');
  });

  test('opening a plan renders the workspace with title', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('workspace header shows plan title', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 5000 });
  });

  test('workspace header shows V2 badge', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await expect(page.getByText('V2').first()).toBeVisible({ timeout: 5000 });
  });

  test('workspace header shows status badge', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Status badge shows "draft" for new plans
    await expect(page.getByText('draft').first()).toBeVisible({ timeout: 5000 });
  });

  test('minimize button is visible in workspace header', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const minimizeBtn = page.locator('button[title*="Minimize plan workspace"]');
    await expect(minimizeBtn).toBeVisible({ timeout: 5000 });
  });

  test('Escape key minimizes workspace back to graph', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Graph canvas should be visible again
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 5000 });
  });

  test('minimized plan shows floating chip', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Minimized chip should show plan title
    const chip = page.locator('button[title*="Restore plan workspace"]');
    await expect(chip).toBeVisible({ timeout: 5000 });
  });

  test('clicking minimized chip restores workspace', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Click the chip to restore
    const chip = page.locator('button[title*="Restore plan workspace"]');
    await chip.click();
    await page.waitForTimeout(1000);

    // Workspace should be visible again
    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('Graph toggle button is in workspace header', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const graphBtn = page.locator('button[title*="Toggle split view"]');
    await expect(graphBtn).toBeVisible({ timeout: 5000 });
  });

  test('Activity toggle button is in workspace header', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const activityBtn = page.locator('button[title*="Toggle activity drawer"]');
    await expect(activityBtn).toBeVisible({ timeout: 5000 });
  });
});
