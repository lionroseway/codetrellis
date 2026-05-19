/**
 * Deviations / Drift detection API — E2E tests.
 *
 * Exercises the deviation endpoints that detect when agents go
 * off-plan. Because real deviations require a full agent loop
 * modifying files outside the plan's scope, these tests focus on the
 * API surface: correct response shapes, empty arrays for fresh plans,
 * and graceful handling of non-existent plan UIDs.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Deviations API', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let planUid: string;

  test.beforeAll(async () => {
    h = await setupHarness('deviations');
    await h.client.scanProject(h.fixture.projectPath);
    const plan = await h.client.createPlan({
      title: 'Deviation test plan',
      projectPath: h.fixture.projectPath,
    });
    planUid = plan.uid;
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('list deviations for a fresh plan returns an empty array', async () => {
    const res = await h.client.raw('GET', `/api/plans/${planUid}/deviations`);
    expect(res.ok).toBe(true);

    const deviations = await res.json();
    expect(Array.isArray(deviations)).toBe(true);
    expect(deviations).toHaveLength(0);
  });

  test('list deviations for a non-existent plan returns an empty array', async () => {
    const bogusUid = 'nonexistent-plan-00000000';
    const res = await h.client.raw('GET', `/api/plans/${bogusUid}/deviations`);

    // The endpoint returns 200 with [] when the plan has no deviations
    // (the query simply finds no rows). Either 200-with-empty or 404
    // is acceptable — assert whichever the server actually does.
    if (res.ok) {
      const deviations = await res.json();
      expect(Array.isArray(deviations)).toBe(true);
      expect(deviations).toHaveLength(0);
    } else {
      expect(res.status).toBe(404);
    }
  });
});
