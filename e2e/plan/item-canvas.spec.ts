/**
 * Item canvas — the main content area for plan items.
 *
 * Covers: title input, body editor, status dropdown, file specs display,
 * breadcrumb navigation.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan item canvas', () => {
  const PLAN_TITLE = 'E2E Item Canvas Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Item Canvas');
  });

  test('clicking an action shows title input with correct value', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Canvas Test Action', body: 'Action body text' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Canvas Test Action').first().click();
    await page.waitForTimeout(500);

    const titleInput = page.locator('input[placeholder="Untitled"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(titleInput).toHaveValue('Canvas Test Action');
  });

  test('title input is editable', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Editable Title', body: 'Some body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Editable Title').first().click();
    await page.waitForTimeout(500);

    const titleInput = page.locator('input[placeholder="Untitled"]');
    await titleInput.clear();
    await titleInput.fill('Renamed Title');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);

    // Title should update in the tree
    await expect(page.getByText('Renamed Title').first()).toBeVisible({ timeout: 3000 });
  });

  test('status dropdown shows 6 status options for actions', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Status Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Status Action').first().click();
    await page.waitForTimeout(500);

    const statusSelect = page.locator('select[title="Change status"]');
    await expect(statusSelect).toBeVisible({ timeout: 5000 });

    // Verify all 6 status options
    await expect(statusSelect.locator('option').filter({ hasText: 'Pending' })).toBeAttached();
    await expect(statusSelect.locator('option').filter({ hasText: 'Assigned' })).toBeAttached();
    await expect(statusSelect.locator('option').filter({ hasText: 'In progress' })).toBeAttached();
    await expect(statusSelect.locator('option').filter({ hasText: 'Done' })).toBeAttached();
    await expect(statusSelect.locator('option').filter({ hasText: 'Blocked' })).toBeAttached();
    await expect(statusSelect.locator('option').filter({ hasText: 'Skipped' })).toBeAttached();
  });

  test('changing status via dropdown persists', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Status Change Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Status Change Action').first().click();
    await page.waitForTimeout(500);

    const statusSelect = page.locator('select[title="Change status"]');
    await statusSelect.selectOption('in_progress');
    await page.waitForTimeout(1000);

    // Verify via API
    const res = await page.request.get(`${API}/items/${plan.actionUids[0]}`);
    const item = await res.json();
    expect(item.status).toBe('in_progress');
  });

  test('file specs display for actions with file targets', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{
        title: 'FileSpec Action',
        body: 'Body',
        fileSpecs: [
          { path: 'src/backend/server.ts', action: 'modify' },
          { path: 'src/frontend/App.tsx', action: 'modify' },
        ],
      }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByTestId('plan-item-tree').getByText('FileSpec Action').first().click();
    await page.waitForTimeout(500);

    // File targets should be visible in the canvas
    await expect(page.getByText('server.ts').first()).toBeVisible({ timeout: 5000 });
  });

  test('action shows "Task" type badge', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Badge Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Badge Action').first().click();
    await page.waitForTimeout(500);

    // Should show "Task" type indicator
    await expect(page.getByText('Task').first()).toBeVisible({ timeout: 5000 });
  });

  test('copy context button is present', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Copy Context Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Copy Context Action').first().click();
    await page.waitForTimeout(500);

    const copyBtn = page.locator('button[title*="Copy item context"]');
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
  });
});
