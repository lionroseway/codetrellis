/**
 * Navigation — item switching and workspace re-entry.
 *
 * Covers: clicking between items, minimize + restore via chip,
 * workspace re-entry from graph mode.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

test.describe('Plan navigation', () => {
  const PLAN_TITLE = 'E2E Navigation Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Navigation');
  });

  test('clicking different items in tree switches canvas content', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [
        { title: 'Nav Item One', body: 'First item body' },
        { title: 'Nav Item Two', body: 'Second item body' },
      ],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Click first item
    await page.getByText('Nav Item One').first().click();
    await page.waitForTimeout(500);
    const titleInput = page.locator('input[placeholder="Untitled"]');
    await expect(titleInput).toHaveValue('Nav Item One');

    // Click second item
    await page.getByText('Nav Item Two').first().click();
    await page.waitForTimeout(500);
    await expect(titleInput).toHaveValue('Nav Item Two');
  });

  test('minimizing and restoring workspace via chip works', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Chip Restore Item', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Minimize workspace with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 5000 });

    // Click the minimized chip to restore
    const chip = page.locator('button[title*="Restore plan workspace"]');
    await expect(chip).toBeVisible({ timeout: 5000 });
    await chip.click();
    await page.waitForTimeout(1000);

    // Workspace should be back with the plan title
    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 5000 });
  });

  test('workspace renders items correctly after restore', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Restore Item', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Minimize
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Restore via chip
    const chip = page.locator('button[title*="Restore plan workspace"]');
    await chip.click();
    await page.waitForTimeout(1000);

    // Item should still be visible in the tree
    await expect(page.getByText('Restore Item').first()).toBeVisible({ timeout: 5000 });
  });
});
