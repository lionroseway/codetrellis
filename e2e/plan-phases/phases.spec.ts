/**
 * Plan phases — CRUD lifecycle for phase checkpoints.
 *
 * Covers: POST /api/plans/:uid/phases, GET list,
 * PUT /api/plan-phases/:phaseUid, DELETE.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan phases', () => {
  const PLAN_TITLE = 'E2E Phases Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Phases');
  });

  test('create a phase', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const res = await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: {
        title: 'Phase 1: Foundation',
        scope: 'Set up base infrastructure',
        prerequisites: 'None',
        acceptanceCriteria: 'All base modules compile',
        phaseNumber: 1,
      },
    });
    expect(res.ok()).toBeTruthy();
    const phase = await res.json();
    expect(phase.uid).toBeTruthy();
    expect(phase.title).toBe('Phase 1: Foundation');
  });

  test('list phases for a plan', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 1', phaseNumber: 1 },
    });
    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 2', phaseNumber: 2 },
    });

    const res = await request.get(`${API}/plans/${plan.uid}/phases`);
    expect(res.ok()).toBeTruthy();
    const phases = await res.json();
    expect(Array.isArray(phases)).toBe(true);
    expect(phases.length).toBeGreaterThanOrEqual(2);
  });

  test('update a phase', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const createRes = await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 1', phaseNumber: 1 },
    });
    const phase = await createRes.json();

    const updateRes = await request.put(`${API}/plan-phases/${phase.uid}`, {
      data: {
        title: 'Phase 1: Updated',
        scope: 'Updated scope',
        status: 'in_progress',
        gitCheckpoint: 'abc123',
      },
    });
    expect(updateRes.ok()).toBeTruthy();

    // Verify update
    const listRes = await request.get(`${API}/plans/${plan.uid}/phases`);
    const phases = await listRes.json();
    const updated = phases.find((p: any) => p.uid === phase.uid);
    expect(updated.title).toBe('Phase 1: Updated');
  });

  test('delete a phase', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const createRes = await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Delete Me Phase', phaseNumber: 99 },
    });
    const phase = await createRes.json();

    const delRes = await request.delete(`${API}/plan-phases/${phase.uid}`);
    expect(delRes.ok()).toBeTruthy();

    const listRes = await request.get(`${API}/plans/${plan.uid}/phases`);
    const phases = await listRes.json();
    const found = phases.find((p: any) => p.uid === phase.uid);
    expect(found).toBeFalsy();
  });

  test('phase ordering respects phase_number', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 3', phaseNumber: 3 },
    });
    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 1', phaseNumber: 1 },
    });
    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 2', phaseNumber: 2 },
    });

    const res = await request.get(`${API}/plans/${plan.uid}/phases`);
    const phases = await res.json();
    expect(phases[0].title).toContain('Phase 1');
    expect(phases[1].title).toContain('Phase 2');
    expect(phases[2].title).toContain('Phase 3');
  });
});
