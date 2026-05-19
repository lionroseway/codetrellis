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

    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('typing a title and tabbing away saves it', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();
    await page.waitForTimeout(1000);

    await page.fill('input[placeholder="Untitled plan"]', 'E2E Create Title Test');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);

    // Verify via API that the plan was saved with the correct title
    const res = await page.request.get(`${API}/plans`);
    const plans = await res.json();
    const created = plans.find(
      (p: any) => p.title === 'E2E Create Title Test' && p.status !== 'archived',
    );
    expect(created).toBeTruthy();
  });

  test('newly created plan appears in plan list', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();
    await page.waitForTimeout(1000);

    await page.fill('input[placeholder="Untitled plan"]', 'E2E Create Listed Plan');
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
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 3000 });
  });
});
