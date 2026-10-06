/**
 * Workspace shell — the 3-region plan workspace layout.
 *
 * Covers: layout renders, header elements, minimize/restore,
 * Escape key, minimized chip.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API, PROJECT_PATH, authHeaders } from '../helpers/setup';

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

    await expect(page.locator('textarea[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('workspace header shows plan title', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 5000 });
  });

  // It showed a "V2" badge, an internal version name that meant nothing
  // to anyone reading the plan (Phase 32 §0.5). The header's own reference
  // chip is what identifies it now.
  test('workspace header shows the plan reference', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await expect(page.getByTestId('copy-ref-plan').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('V2', { exact: true })).toHaveCount(0);
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

    await expect(page.locator('textarea[placeholder="Untitled plan"]')).toBeVisible({
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
    await expect(page.locator('textarea[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
  });

  // Phase 33 G6 — the owner's report: opening a plan that was minimised left
  // it minimised, because the workspace opens only when the active plan
  // CHANGES. Opening it again from the plan list shows it.
  test('opening the minimised plan again from the plan list shows it', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);
    const title = page.locator('textarea[placeholder="Untitled plan"]');
    await expect(title).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('button[title*="Restore plan workspace"]')).toBeVisible({ timeout: 5000 });
    await expect(title).toBeHidden();

    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.getByTitle('Click to open the plan workspace').filter({ hasText: PLAN_TITLE }).first().click();
    await expect(title).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button[title*="Restore plan workspace"]')).toBeHidden();
  });

  // A stack of notifications sat over the minimised-plan chip and took the
  // click meant for "restore" - intermittently on CI, where other specs'
  // plan broadcasts pile toasts up. Here the pile-up is made on purpose:
  // each plan created raises a "New plan created" toast.
  test('the chip stays clickable under a stack of notifications', async ({ page, request }) => {
    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);
    await page.keyboard.press('Escape');
    const chip = page.locator('button[title*="Restore plan workspace"]');
    await expect(chip).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 5; i++) {
      await request.post(`${API}/plans`, {
        headers: authHeaders(),
        data: { title: `E2E Workspace Toast ${i}`, projectPath: PROJECT_PATH },
      });
    }
    await expect(page.getByTestId('toast-stack')).toBeVisible({ timeout: 5000 });

    // No toast may cover the chip: whatever is on top at its centre is the chip.
    const box = await chip.boundingBox();
    expect(box).toBeTruthy();
    const onTop = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el?.closest('[data-minimized-plan-chip]'));
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
    expect(onTop, 'a toast covers the minimised-plan chip').toBe(true);

    await chip.click({ timeout: 5000 });
    await expect(page.locator('textarea[placeholder="Untitled plan"]')).toBeVisible({ timeout: 5000 });
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
