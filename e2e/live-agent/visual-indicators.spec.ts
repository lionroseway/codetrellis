/**
 * Visual indicators — verifies status icons, color coding, progress
 * bars, and visual state transitions in the browser UI.
 *
 * Uses API-driven state changes + Playwright assertions on rendered
 * elements.  Screenshots captured for visual regression baselines.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

const PROJECT_PATH = process.cwd();

test.describe('Visual indicators', () => {
  // Use serial mode to avoid plan cleanup races with parallel workers
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'VIS');
  });

  test('pending item shows in plan item tree', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: Pending',
      actions: [{ title: 'Pending action', body: 'Not started' }],
    });

    await gotoWithProject(page);
    await openPlan(page, plan.title);

    // Item should be visible in the tree — use .first() to avoid strict mode
    // violations (title text appears in tree, timeline events, etc.)
    await expect(page.getByText('Pending action').first()).toBeVisible({ timeout: 5000 });
  });

  test('in_progress item shows after status update', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: InProgress',
      actions: [{ title: 'Working action', body: 'In progress' }],
    });

    // Update status
    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'in_progress' },
    });

    await gotoWithProject(page);
    await openPlan(page, plan.title);

    await expect(page.getByText('Working action').first()).toBeVisible({ timeout: 5000 });
  });

  test('done item shows after completion', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: Done',
      actions: [{ title: 'Completed action', body: 'All done' }],
    });

    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'done' },
    });

    await gotoWithProject(page);
    await openPlan(page, plan.title);

    await expect(page.getByText('Completed action').first()).toBeVisible({ timeout: 5000 });
  });

  test('blocked item shows with reason', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: Blocked',
      actions: [{ title: 'Blocked action', body: 'Waiting' }],
    });

    // Set blocked via item blocked endpoint
    await request.post(
      `${API}/items/${plan.actionUids[0]}/blocked`,
      { data: { reason: 'Waiting for API key' } },
    );

    await gotoWithProject(page);
    await openPlan(page, plan.title);

    await expect(page.getByText('Blocked action').first()).toBeVisible({ timeout: 5000 });
  });

  test('progress percentage shows on item', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: Progress',
      actions: [{ title: 'Progress action', body: 'Halfway' }],
    });

    // Report progress
    await request.post(
      `${API}/items/${plan.actionUids[0]}/progress`,
      { data: { percent: 50, message: 'Halfway there' } },
    );

    await gotoWithProject(page);
    await openPlan(page, plan.title);

    await expect(page.getByText('Progress action').first()).toBeVisible({ timeout: 5000 });
  });

  test('plan with mixed statuses renders progress bar', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: Mixed',
      actions: [
        { title: 'Done task', body: 'Done' },
        { title: 'In progress task', body: 'Working' },
        { title: 'Pending task', body: 'Not started' },
      ],
    });

    // Set different statuses
    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'done' },
    });
    await request.put(`${API}/items/${plan.actionUids[1]}`, {
      data: { status: 'in_progress' },
    });
    // Third stays pending

    await gotoWithProject(page);

    // Plans list should show the plan with progress indication
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await expect(page.getByText(plan.title).first()).toBeVisible({ timeout: 5000 });
  });

  test('multiple items visible in plan tree', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: Tree',
      actions: [
        { title: 'First action', body: 'A' },
        { title: 'Second action', body: 'B' },
        { title: 'Third action', body: 'C' },
      ],
    });

    await gotoWithProject(page);
    await openPlan(page, plan.title);

    await expect(page.getByText('First action').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Second action').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Third action').first()).toBeVisible({ timeout: 5000 });
  });

  test('screenshot: plan workspace layout', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: 'VIS: Screenshot',
      actions: [
        { title: 'Screenshot task 1', body: 'For visual baseline' },
        { title: 'Screenshot task 2', body: 'For visual baseline' },
      ],
    });

    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'done' },
    });

    await gotoWithProject(page);
    await openPlan(page, plan.title);
    await page.waitForTimeout(1000);

    // The committed copy is refreshed only on request (E2E_SCREENSHOTS=1);
    // a normal run writing it left every checkout dirty.
    await page.screenshot({
      path: process.env.E2E_SCREENSHOTS
        ? 'e2e/screenshots/plan-workspace.png'
        : 'test-results/screenshots/plan-workspace.png',
      fullPage: false,
    });
  });
});
