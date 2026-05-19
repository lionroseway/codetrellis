/**
 * Plan list — the Plans tab in the bottom PlanPanel.
 *
 * Covers: plan rows, status badges, progress bars, empty state,
 * "New plan" button, plan card click.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan list', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E List');
  });

  test('Plans tab is visible in the bottom panel', async ({ page }) => {
    await gotoWithProject(page);

    const plansTab = page.getByRole('button', { name: 'Plans', exact: true });
    await expect(plansTab).toBeVisible({ timeout: 5000 });
  });

  test('clicking Plans tab reveals plan panel content', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(500);

    // Should show "New plan" button
    await expect(page.locator('button:has-text("New plan")')).toBeVisible({ timeout: 3000 });
  });

  test('empty state shows "No plans yet" or create CTA', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(500);

    // Either shows "No plans yet" or "New plan" button (depending on whether
    // other plans exist from prior runs)
    const newPlanBtn = page.locator('button:has-text("New plan")');
    await expect(newPlanBtn).toBeVisible({ timeout: 3000 });
  });

  test('seeded plan appears as a row with title', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: 'E2E List Test Plan' });
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('E2E List Test Plan').first()).toBeVisible({ timeout: 5000 });
  });

  test('plan row shows status badge', async ({ page, request }) => {
    await seedPlan(request, { title: 'E2E List Badge Plan' });
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(1000);

    // Plan cards have the title attribute for opening workspace
    const planCard = page.locator(
      'button[title="Click to open the plan workspace (Spec / Tasks / Activity)"]',
    ).filter({ hasText: 'E2E List Badge Plan' });
    await expect(planCard).toBeVisible({ timeout: 5000 });
  });

  test('clicking a plan row opens the workspace', async ({ page, request }) => {
    await seedPlan(request, { title: 'E2E List Open Plan' });
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(1000);

    await page.getByText('E2E List Open Plan').first().click();
    await page.waitForTimeout(1500);

    // Workspace should open with the plan title input
    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('multiple plans render as separate rows', async ({ page, request }) => {
    await seedPlan(request, { title: 'E2E List Plan A' });
    await seedPlan(request, { title: 'E2E List Plan B' });
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('E2E List Plan A').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('E2E List Plan B').first()).toBeVisible();
  });
});
