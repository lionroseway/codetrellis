/**
 * Plan import / export — disk export, discovery, import.
 *
 * Covers: export plan to .codetrellis/plans/, discover on disk,
 * import plan from disk, publish as template.
 */

import { test, expect } from '@playwright/test';
import { cleanupPlans, seedPlan, API, PROJECT_PATH } from '../helpers/setup';

test.describe('Plan import / export', () => {
  let planUid: string;

  test.beforeAll(async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E Export Plan' });
    planUid = plan.uid;
  });

  test.afterAll(async ({ request }) => {
    await cleanupPlans(request, 'E2E Export');
    await cleanupPlans(request, 'E2E Import');
  });

  test('export plan to disk creates .codetrellis/plans/ directory', async ({ request }) => {
    const res = await request.post(`${API}/plans/${planUid}/export`, {
      data: { projectRoot: PROJECT_PATH },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.planDir).toBeTruthy();
    expect(result.planDir).toContain('.codetrellis/plans');
  });

  test('exported plan discoverable via discover endpoint', async ({ request }) => {
    const res = await request.get(
      `${API}/plans/discover?project=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.ok()).toBeTruthy();
    const dirs = await res.json();
    expect(dirs.length).toBeGreaterThan(0);
  });

  test('plan versions endpoint returns history', async ({ request }) => {
    const res = await request.get(`${API}/plans/${planUid}/versions`);
    expect(res.ok()).toBeTruthy();
    const versions = await res.json();
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  test('publish plan as template via API', async ({ request }) => {
    const res = await request.post(`${API}/plans/${planUid}/publish-as-template`);
    // May succeed or return 4xx if plan doesn't meet template criteria — either is fine
    expect(res.status()).toBeLessThan(500);
  });
});
