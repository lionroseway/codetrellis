/**
 * Plan events — item create/update/delete via API → UI updates.
 *
 * Covers: creating items via API updates the UI, status changes
 * reflect in the workspace, timeline records events.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan events', () => {
  const PLAN_TITLE = 'E2E Plan Events Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Plan Events');
  });

  test('creating an item via API while workspace is open updates tree', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Initial Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Initial action should be visible
    await expect(page.getByText('Initial Action').first()).toBeVisible({ timeout: 10_000 });

    // Add another item via API while workspace is open
    const created = await request.post(`${API}/plans/${plan.uid}/items`, {
      data: {
        kind: 'action',
        title: 'Dynamic New Action',
        template: 'action',
        body: 'Added while workspace is open',
        status: 'pending',
      },
    });
    expect(created.ok(), await created.text()).toBe(true);

    // It arrives in the open tree on its own, with no reload. This used to
    // sample once and ignore the answer, so it passed whether or not the
    // update came; the window has been told of new items live since #340.
    await expect(page.getByTestId('plan-item-tree').getByText('Dynamic New Action').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Initial Action').first()).toBeVisible();
  });

  test('timeline records item creation events', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Timeline Action', body: 'Body' }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/timeline?limit=50`);
    expect(res.ok()).toBeTruthy();
    const events = await res.json();
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Should have an item_created event (field is `eventType`)
    const hasCreated = events.some((e: any) =>
      e.eventType === 'item_created',
    );
    expect(hasCreated).toBe(true);
  });

  test('status change via API creates timeline event', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Status Event Action', body: 'Body' }],
    });

    // Change status
    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'in_progress' },
    });

    const res = await request.get(`${API}/plans/${plan.uid}/timeline?limit=50`);
    const events = await res.json();
    // Should have multiple events (create + status change)
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test('deleting an item via API creates timeline event', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Delete Event Action', body: 'Body' }],
    });

    await request.delete(`${API}/items/${plan.actionUids[0]}`);

    const res = await request.get(`${API}/plans/${plan.uid}/timeline?limit=50`);
    const events = await res.json();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
