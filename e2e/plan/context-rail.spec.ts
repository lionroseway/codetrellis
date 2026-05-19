/**
 * Context rail — file specs, targets strip, routing panel.
 *
 * Covers: file spec display, target paths, "Add context" button,
 * routing panel section.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

test.describe('Context rail', () => {
  const PLAN_TITLE = 'E2E Context Rail Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Context Rail');
  });

  test('action with file specs shows file paths in canvas', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{
        title: 'File Spec Action',
        body: 'Body',
        fileSpecs: [
          { path: 'src/backend/server.ts', action: 'modify' },
          { path: 'src/frontend/App.tsx', action: 'create' },
        ],
      }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('File Spec Action').first().click();
    await page.waitForTimeout(500);

    // File names should be visible
    await expect(page.getByText('server.ts').first()).toBeVisible({ timeout: 5000 });
  });

  test('action without file specs still renders canvas', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'No Files Action', body: 'Body with no file specs' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('No Files Action').first().click();
    await page.waitForTimeout(500);

    // Canvas should render without errors
    const titleInput = page.locator('input[placeholder="Untitled"]');
    await expect(titleInput).toHaveValue('No Files Action');
  });

  test('history button is present on items', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'History Item', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('History Item').first().click();
    await page.waitForTimeout(500);

    const historyBtn = page.locator('button[title*="History"]');
    await expect(historyBtn).toBeVisible({ timeout: 5000 });
  });
});
