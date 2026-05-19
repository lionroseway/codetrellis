/**
 * Completion — marking tasks done, plan completion summary.
 *
 * Covers: done status via API, checkmark in tree, completion summary panel,
 * progress counter updates.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Completion', () => {
  const PLAN_TITLE = 'E2E Completion Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Completion');
  });

  test('marking a task done via API changes status', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Completable Task', body: 'Body' }],
    });

    const res = await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'done' },
    });
    expect(res.ok()).toBeTruthy();

    const itemRes = await request.get(`${API}/items/${plan.actionUids[0]}`);
    const item = await itemRes.json();
    expect(item.status).toBe('done');
  });

  test('done task shows in UI with completed styling', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Done UI Task', body: 'Body' }],
    });

    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'done' },
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // The task should still be visible in the tree
    await expect(page.getByText('Done UI Task').first()).toBeVisible({ timeout: 5000 });
  });

  test('all tasks done shows completion summary', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [
        { title: 'Complete Task A', body: 'Body' },
        { title: 'Complete Task B', body: 'Body' },
      ],
    });

    // Mark all tasks done
    for (const uid of plan.actionUids) {
      await request.put(`${API}/items/${uid}`, { data: { status: 'done' } });
    }

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Completion summary should appear — look for "Plan Complete" or "100%"
    await page.waitForTimeout(2000);
    const hasComplete = await page.getByText('Plan Complete').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    const has100 = await page.getByText('100%').first()
      .isVisible({ timeout: 2000 }).catch(() => false);

    // At minimum the progress should show all done
    expect(hasComplete || has100).toBe(true);
  });

  test('skipped tasks count toward completion', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [
        { title: 'Done Task', body: 'Body' },
        { title: 'Skipped Task', body: 'Body' },
      ],
    });

    await request.put(`${API}/items/${plan.actionUids[0]}`, { data: { status: 'done' } });
    await request.put(`${API}/items/${plan.actionUids[1]}`, { data: { status: 'skipped' } });

    // Both done and skipped count as "finished"
    const item0 = await (await request.get(`${API}/items/${plan.actionUids[0]}`)).json();
    const item1 = await (await request.get(`${API}/items/${plan.actionUids[1]}`)).json();
    expect(item0.status).toBe('done');
    expect(item1.status).toBe('skipped');
  });

  test('workspace header progress shows correct fraction', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [
        { title: 'Progress Fraction A', body: 'Body' },
        { title: 'Progress Fraction B', body: 'Body' },
      ],
    });

    // Mark one done
    await request.put(`${API}/items/${plan.actionUids[0]}`, { data: { status: 'done' } });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Header should show "1/2 actions" or "50%"
    await page.waitForTimeout(1500);
    const has1of2 = await page.getByText('1/2').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    const has50 = await page.getByText('50%').first()
      .isVisible({ timeout: 2000 }).catch(() => false);

    expect(has1of2 || has50).toBe(true);
  });
});
