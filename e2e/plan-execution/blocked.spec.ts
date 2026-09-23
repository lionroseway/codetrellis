/**
 * Blocked status — marking tasks blocked via API, UI indicator.
 *
 * Covers: blocked endpoint, status change, reason text visible,
 * blocked banner in canvas, unblocking.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Blocked status', () => {
  const PLAN_TITLE = 'E2E Blocked Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Blocked');
  });

  test('marking a task blocked via API changes status', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Blockable Task', body: 'Body' }],
    });

    const res = await request.post(`${API}/items/${plan.actionUids[0]}/blocked`, {
      data: { reason: 'Waiting for API key from ops' },
    });
    expect(res.ok()).toBeTruthy();

    const itemRes = await request.get(`${API}/items/${plan.actionUids[0]}`);
    const item = await itemRes.json();
    expect(item.status).toBe('blocked');
  });

  test('blocked reason is visible in UI canvas', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Blocked UI Task', body: 'Body' }],
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/blocked`, {
      data: { reason: 'Dependency not deployed yet' },
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Scoped to the tree: a blocked plan also shows the review panel, which
    // lists every item as a button — disabled when it touches no files — and
    // comes first in the page, so an unscoped `.first()` waited on that.
    await page.getByTestId('plan-item-tree').getByText('Blocked UI Task').first().click();
    await page.waitForTimeout(1000);

    // The blocked reason should be visible as a banner
    await expect(page.getByText('Dependency not deployed yet').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('unblocking a task by setting status to in_progress', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Unblock Task', body: 'Body' }],
    });

    // Block
    await request.post(`${API}/items/${plan.actionUids[0]}/blocked`, {
      data: { reason: 'Temporary block' },
    });

    // Unblock by updating status
    const res = await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'in_progress' },
    });
    expect(res.ok()).toBeTruthy();

    const itemRes = await request.get(`${API}/items/${plan.actionUids[0]}`);
    const item = await itemRes.json();
    expect(item.status).toBe('in_progress');
  });
});
