/**
 * Agent claim — claim a task via API, verify "assigned" status in UI.
 *
 * Covers: claim endpoint, status change to "assigned", agent name visible,
 * assignee chip in canvas.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Agent claim', () => {
  const PLAN_TITLE = 'E2E Agent Claim Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Agent Claim');
  });

  test('claiming a task via API changes status to assigned', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Claimable Task', body: 'Body' }],
    });

    const res = await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'e2e-claim-agent', agentType: 'agent' },
    });
    expect(res.ok()).toBeTruthy();

    // Verify status changed
    const itemRes = await request.get(`${API}/items/${plan.actionUids[0]}`);
    const item = await itemRes.json();
    expect(item.status).toBe('assigned');
  });

  test('claimed task shows agent name in UI', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Claimed UI Task', body: 'Body' }],
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'e2e-ui-agent', agentType: 'agent' },
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Claimed UI Task').first().click();
    await page.waitForTimeout(1000);

    // Agent name should appear somewhere in the canvas
    await expect(page.getByText('e2e-ui-agent').first()).toBeVisible({ timeout: 5000 });
  });

  test('claiming twice with same agent is idempotent', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Double Claim Task', body: 'Body' }],
    });

    // First claim
    await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'e2e-double-agent', agentType: 'agent' },
    });

    // Second claim — should not error
    const res = await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'e2e-double-agent', agentType: 'agent' },
    });
    expect(res.status()).toBeLessThan(500);
  });
});
