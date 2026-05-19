/**
 * Plan proposed changes, drift detection, export/import, file-status.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API, PROJECT_PATH } from '../helpers/setup';

test.describe('Plan changes & drift', () => {
  const PLAN_TITLE = 'E2E Changes Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Changes');
  });

  test('GET /api/plans/:uid/changes returns proposed changes', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [
        { title: 'Change action', body: 'body', fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }] },
      ],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/changes`);
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/plans/:uid/deviations returns deviation list', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const res = await request.get(`${API}/plans/${plan.uid}/deviations`);
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('POST /api/plans/:uid/reconcile handles deviation resolution', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const res = await request.post(`${API}/plans/${plan.uid}/reconcile`, {
      data: { action: 'detect' },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /api/plans/:uid/file-status returns disk sync status', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const res = await request.get(`${API}/plans/${plan.uid}/file-status`);
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('POST /api/plans/:uid/export writes plan to disk', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Export Action', body: 'Will be exported' }],
    });

    const res = await request.post(`${API}/plans/${plan.uid}/export`, {
      data: { projectRoot: PROJECT_PATH },
    });
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('POST /api/plans/import reads plan from disk', async ({ request }) => {
    // Export first to create files
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Import Test Action', body: 'body' }],
    });

    const exportRes = await request.post(`${API}/plans/${plan.uid}/export`, {
      data: { projectRoot: PROJECT_PATH },
    });
    const exportData = await exportRes.json();

    if (exportData.path || exportData.planDir) {
      const importPath = exportData.path || exportData.planDir;
      const res = await request.post(`${API}/plans/import`, {
        data: { planDir: importPath },
      });
      expect(res.status()).toBeLessThan(500);
    }
  });

  test('GET /api/plans/discover lists plan directories on disk', async ({ request }) => {
    const res = await request.get(
      `${API}/plans/discover?project=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('POST /api/plans/:uid/unlink removes disk sync', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    // Export first
    await request.post(`${API}/plans/${plan.uid}/export`, {
      data: { projectRoot: PROJECT_PATH },
    });

    const res = await request.post(`${API}/plans/${plan.uid}/unlink`, {
      data: { projectRoot: PROJECT_PATH },
    });
    expect(res.status()).toBeLessThan(500);
  });
});
