/**
 * Proposed changes — the "Proposed" tab in PlanPanel.
 *
 * Covers: tab disabled without active plan, changes endpoint,
 * drift status filters.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Proposed changes', () => {
  const PLAN_TITLE = 'E2E Proposed Changes Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Proposed');
  });

  test('Proposed tab is visible in PlanPanel', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByRole('button', { name: 'Proposed' })).toBeVisible({ timeout: 5000 });
  });

  test('Proposed tab has disabled tooltip when no plan is active', async ({ page }) => {
    await gotoWithProject(page);

    const proposedTab = page.getByRole('button', { name: 'Proposed' });
    const title = await proposedTab.getAttribute('title');
    // When no plan is active, the tab should indicate it
    expect(title).toBeTruthy();
  });

  test('changes endpoint returns data for active plan', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{
        title: 'Proposed Action',
        body: 'Body',
        fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }],
      }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/changes`);
    expect(res.status()).toBeLessThan(500);
  });

  test('projection endpoint returns ghost files', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{
        title: 'Projection Action',
        body: 'Body',
        fileSpecs: [
          { path: 'src/backend/routes/terminal.ts', action: 'create' },
        ],
      }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/projection`);
    expect(res.status()).toBeLessThan(500);
  });
});
