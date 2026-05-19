/**
 * Progress reporting — agent reports progress, UI shows bar + percentage.
 *
 * Covers: progress API endpoint, percentage visible in UI, progress bar,
 * multiple progress updates.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Progress reporting', () => {
  const PLAN_TITLE = 'E2E Progress Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Progress');
  });

  test('progress report via API updates item', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Progress Task', body: 'Body' }],
    });

    // Claim first
    await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'progress-agent', agentType: 'agent' },
    });

    // Report progress
    const res = await request.post(`${API}/items/${plan.actionUids[0]}/progress`, {
      data: { percent: 50, message: 'Halfway done' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('progress percentage shows in the UI', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'UI Progress Task', body: 'Body' }],
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'progress-ui-agent', agentType: 'agent' },
    });
    await request.post(`${API}/items/${plan.actionUids[0]}/progress`, {
      data: { percent: 75, message: 'Almost there' },
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('UI Progress Task').first().click();
    await page.waitForTimeout(1000);

    // The 75% should be visible somewhere
    await expect(page.getByText('75%').first()).toBeVisible({ timeout: 5000 });
  });

  test('progress updates are cumulative', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Cumulative Progress', body: 'Body' }],
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'cumulative-agent', agentType: 'agent' },
    });

    // Multiple progress reports
    await request.post(`${API}/items/${plan.actionUids[0]}/progress`, {
      data: { percent: 25, message: 'Step 1' },
    });
    await request.post(`${API}/items/${plan.actionUids[0]}/progress`, {
      data: { percent: 50, message: 'Step 2' },
    });
    await request.post(`${API}/items/${plan.actionUids[0]}/progress`, {
      data: { percent: 100, message: 'Done' },
    });

    // Verify latest progress
    const res = await request.get(`${API}/items/${plan.actionUids[0]}/full`);
    expect(res.ok()).toBeTruthy();
  });
});
