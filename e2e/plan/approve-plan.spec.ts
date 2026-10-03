/**
 * Approving a plan from its header.
 *
 * Neither the window nor the phone could approve a plan, so the only way one
 * became approved was an agent's `update_plan`, which skipped what an approval
 * does. The agent is refused now and sets "review" to ask; the person approves
 * here, on the window's own path, which records the approval as theirs.
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupPlans, gotoWithProject, openPlan, seedPlan } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const TITLE = 'E2E Approve From Header';

test.describe('Approve on the plan header', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, TITLE); });

  test('an agent asks with "review"; the person approves, and the header says so', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE });
    const agent = await createMcpClient();
    try {
      const refused = await agent.callTool('update_plan', { plan_uid: plan.uid, status: 'approved' });
      expect(refused.isError).toBe(true);
      await agent.callTool('update_plan', { plan_uid: plan.uid, status: 'review' });
    } finally {
      agent.close();
    }

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    const approve = page.getByTestId('approve-plan');
    await expect(approve).toBeVisible({ timeout: 10_000 });
    await approve.click();
    await expect(approve).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();

    const stored = await (await request.get(`${API}/plans/${plan.uid}`, { headers: authHeaders() })).json();
    expect(stored.status ?? stored.plan?.status).toBe('approved');
    // The approval is the person's in the plan's history, not the agent's: the
    // window in Electron is `human`; this browser is plain HTTP, `unverified`.
    const versions = await (await request.get(`${API}/plans/${plan.uid}/versions`, { headers: authHeaders() })).json() as Array<{ authorType: string | null }>;
    expect(['human', 'unverified']).toContain(versions[0].authorType);
  });
});
