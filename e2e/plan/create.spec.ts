/**
 * Plan creation — quick-create via "New plan" button.
 *
 * Covers: quick-create opens workspace, title input editable,
 * title save propagates, plan appears in list after creation.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan creation', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Create');
  });

  test('"New plan" button is visible in Plans tab', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('button:has-text("New plan")')).toBeVisible({ timeout: 3000 });
  });

  test('clicking "New plan" opens workspace with Untitled placeholder', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();

    // Three requests on a busy backend: create, open, and the list after.
    await expect(page.locator('textarea[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('typing a title and tabbing away saves it', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();

    // Waited for, not slept on: on a busy runner the new plan's workspace
    // took longer than the 1 s this used to allow, and the save longer than
    // the 1.5 s after it (#197, Browser suite 2/3).
    const title = page.locator('textarea[placeholder="Untitled plan"]');
    await expect(title).toBeEditable({ timeout: 10_000 });
    await title.fill('E2E Create Title Test');
    await page.keyboard.press('Tab');

    // Verify via API that the plan was saved with the correct title
    await expect.poll(async () => {
      const plans = (await (await page.request.get(`${API}/plans`)).json()) as Array<{ title: string; status: string }>;
      return plans.some((p) => p.title === 'E2E Create Title Test' && p.status !== 'archived');
    }, { timeout: 10_000 }).toBe(true);
  });

  test('newly created plan appears in plan list', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();
    await page.waitForTimeout(1000);

    await page.fill('textarea[placeholder="Untitled plan"]', 'E2E Create Listed Plan');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);

    // Minimize workspace back to graph
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Click Plans tab again
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('E2E Create Listed Plan').first()).toBeVisible({ timeout: 5000 });
  });

  test('plan body textarea is editable after creation', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();
    await page.waitForTimeout(1000);

    // The body textarea should be visible for a new plan
    const textarea = page.locator('textarea:not([placeholder^="Untitled"])').first();
    await expect(textarea).toBeVisible({ timeout: 3000 });
  });
});
