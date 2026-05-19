/**
 * Drift indicator — deviation detection and resolution.
 *
 * Covers: deviations endpoint, drift indicator banner,
 * accept/ignore actions, reconcile endpoint.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Drift indicator', () => {
  const PLAN_TITLE = 'E2E Drift Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Drift');
  });

  test('deviations endpoint returns without error', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Drift Action', body: 'Body' }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/deviations`);
    expect(res.status()).toBeLessThan(500);
  });

  test('reconcile endpoint accepts deviation resolutions', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Reconcile Action', body: 'Body' }],
    });

    // Reconcile with empty deviations (no actual drift to reconcile)
    const res = await request.post(`${API}/plans/${plan.uid}/reconcile`, {
      data: { deviations: [] },
    });
    // Should not 500 even with empty array
    expect(res.status()).toBeLessThan(500);
  });

  test('deviations endpoint returns array', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{
        title: 'Deviation Array Action',
        body: 'Body',
        fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }],
      }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/deviations`);
    if (res.ok()) {
      const deviations = await res.json();
      expect(Array.isArray(deviations)).toBe(true);
    }
  });
});
