/**
 * A task shows what it inherits without its parent being opened first.
 *
 * The routing panel used to work inheritance out from the plan tree in the
 * window, which holds item summaries without claim policy, execution
 * settings or guardrails. So a parent's "Human only" read as "Anyone
 * (default)" on its tasks until the parent had been opened. Agents were
 * gated correctly all along; the person's view was wrong.
 */
import { test, expect } from '@playwright/test';
import { gotoWithProject, openPlan, cleanupPlans, API, authHeaders, PROJECT_PATH } from '../helpers/setup';
import type { PlanItem } from '../../src/shared/types';

const PLAN = 'E2E Routing Inherited Plan';

test.describe('Routing: what a task inherits', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('a parent\'s claim policy, model and guardrails show on its task, said to be inherited', async ({ page, request }) => {
    const plan = (await (await request.post(`${API}/plans`, { headers: authHeaders(), data: { title: PLAN, projectPath: PROJECT_PATH } })).json()) as { uid: string };
    const parent = (await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'object', title: 'Ledger' } })).json()) as PlanItem;
    const put = await request.put(`${API}/items/${parent.uid}`, {
      headers: authHeaders(),
      data: {
        claimPolicy: { mode: 'human-only' }, claimPolicyMode: 'replace',
        executionConfig: { model: 'ledger-model' }, executionConfigMode: 'replace',
        constraints: { requireTests: true },
      },
    });
    expect(put.ok(), await put.text()).toBe(true);
    await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'action', title: 'Post entries', template: 'action', status: 'pending', parentUid: parent.uid } });

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    // Straight to the task: the parent is never opened.
    await page.getByText('Post entries').first().click();

    // Collapsed, the summary already says it.
    const toggle = page.getByRole('button', { name: /Routing & Execution/i });
    // The task loads after the plan's tree; its routing after that.
    await expect(toggle).toContainText('Human only', { timeout: 15_000 });
    await expect(toggle).toContainText('ledger-model');
    await expect(toggle).toContainText('guardrails');

    // Open, each says where it comes from. The item view settles after the
    // plan's items load, which can re-render the panel closed: open it until it stays open.
    const claim = page.getByTestId('claim-inherited');
    await expect(async () => {
      if (!(await claim.isVisible())) await toggle.click();
      await expect(claim).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(claim).toHaveText('(inherited from Ledger)');
    await expect(page.getByTestId('exec-inherited')).toHaveText('(inherited from Ledger)');
    await expect(page.getByTestId('guardrails-inherited')).toHaveText('(inherited from Ledger)');
    await expect(page.locator('select').filter({ has: page.locator('option[value="human-only"]') }).first()).toHaveValue('human-only');
  });
});
