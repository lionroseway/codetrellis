/**
 * Handoff button — hand off plan to agent.
 *
 * Covers: button visibility when pending actions exist, dropdown options,
 * hidden when no pending actions.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Handoff button', () => {
  const PLAN_TITLE = 'E2E Handoff Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Handoff');
  });

  test('Hand off button visible when plan has pending actions', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Pending Handoff Task', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // HandoffButton renders when pending actions exist
    const handoff = page.getByText('Hand off').first();
    await expect(handoff).toBeVisible({ timeout: 5000 });
  });

  test('Hand off button not visible when all actions are done', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Done Handoff Task', body: 'Body' }],
    });

    // Mark task done
    await request.put(`${API}/items/${plan.actionUids[0]}`, { data: { status: 'done' } });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.waitForTimeout(2000);

    // Handoff button should not be visible
    await expect(page.getByText('Hand off').first()).not.toBeVisible({ timeout: 3000 });
  });

  test('clicking Hand off shows dropdown options', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Dropdown Handoff Task', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const handoff = page.getByText('Hand off').first();
    await handoff.click();
    await page.waitForTimeout(500);

    // Dropdown should show "Copy plan as prompt" option
    await expect(page.getByText('Copy plan as prompt').first()).toBeVisible({ timeout: 3000 });
  });
});
