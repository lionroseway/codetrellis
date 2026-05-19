/**
 * Plan archive / delete — archiving removes from active list.
 *
 * Covers: archive via API, verify removed from active list,
 * archived plan still accessible via direct API.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan archive / delete', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Archive');
  });

  test('archiving a plan changes its status', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E Archive Status Plan' });

    const res = await request.delete(`${API}/plans/${plan.uid}`);
    expect(res.ok()).toBeTruthy();

    // Verify archived status
    const getRes = await request.get(`${API}/plans/${plan.uid}`);
    const archived = await getRes.json();
    expect(archived.status).toBe('archived');
  });

  test('archived plan does not appear in active plan list UI', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: 'E2E Archive Hidden Plan' });
    await request.delete(`${API}/plans/${plan.uid}`);

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(1000);

    // Archived plan should NOT be visible in the list
    await expect(page.getByText('E2E Archive Hidden Plan')).not.toBeVisible({ timeout: 3000 });
  });

  test('archived plan still accessible via direct API call', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E Archive Accessible Plan' });
    await request.delete(`${API}/plans/${plan.uid}`);

    const res = await request.get(`${API}/plans/${plan.uid}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.uid).toBe(plan.uid);
    expect(data.title).toBe('E2E Archive Accessible Plan');
  });

  test('multiple plans can be archived independently', async ({ request }) => {
    const planA = await seedPlan(request, { title: 'E2E Archive Plan A' });
    const planB = await seedPlan(request, { title: 'E2E Archive Plan B' });

    // Archive only plan A
    await request.delete(`${API}/plans/${planA.uid}`);

    // Plan B should still be active
    const resB = await request.get(`${API}/plans/${planB.uid}`);
    const dataB = await resB.json();
    expect(dataB.status).not.toBe('archived');

    // Plan A should be archived
    const resA = await request.get(`${API}/plans/${planA.uid}`);
    const dataA = await resA.json();
    expect(dataA.status).toBe('archived');
  });
});
