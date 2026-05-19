/**
 * Plan Phases CRUD API tests.
 *
 * Exercises the structural containers that group work items and define
 * sequencing within a plan:
 *
 *  - POST   /api/plans/:uid/phases      — create a phase
 *  - GET    /api/plans/:uid/phases      — list phases for a plan
 *  - PUT    /api/plan-phases/:phaseUid  — update a phase
 *  - DELETE /api/plan-phases/:phaseUid  — delete a phase
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

interface Phase {
  uid: string;
  planUid: string;
  phaseNumber: number;
  title: string;
  scope: string;
  prerequisites: string;
  acceptanceCriteria: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

test.describe.serial('Plan Phases CRUD', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let planUid: string;
  let phase1Uid: string;
  let phase2Uid: string;

  test.beforeAll(async () => {
    h = await setupHarness('plan-phases-crud');
    await h.client.scanProject(h.fixture.projectPath);

    const plan = await h.client.createPlan({
      title: 'Phase test plan',
      projectPath: h.fixture.projectPath,
    });
    planUid = plan.uid;
  });

  test.afterAll(async () => {
    await h.teardown();
  });

  test('create two phases with different phaseNumbers', async () => {
    const res1 = await h.client.raw('POST', `/api/plans/${planUid}/phases`, {
      title: 'Phase 1: Setup',
      scope: 'Initial project scaffolding',
      prerequisites: 'Node 18+',
      acceptanceCriteria: 'All deps install cleanly',
      status: 'pending',
      phaseNumber: 1,
    });
    expect(res1.ok).toBe(true);
    const p1: Phase = await res1.json();
    expect(p1.uid).toBeTruthy();
    expect(p1.planUid).toBe(planUid);
    expect(p1.title).toBe('Phase 1: Setup');
    expect(p1.scope).toBe('Initial project scaffolding');
    expect(p1.prerequisites).toBe('Node 18+');
    expect(p1.acceptanceCriteria).toBe('All deps install cleanly');
    expect(p1.status).toBe('pending');
    expect(p1.phaseNumber).toBe(1);
    phase1Uid = p1.uid;

    const res2 = await h.client.raw('POST', `/api/plans/${planUid}/phases`, {
      title: 'Phase 2: Implementation',
      scope: 'Core feature build-out',
      prerequisites: 'Phase 1 complete',
      acceptanceCriteria: 'All tests pass',
      status: 'pending',
      phaseNumber: 2,
    });
    expect(res2.ok).toBe(true);
    const p2: Phase = await res2.json();
    expect(p2.uid).toBeTruthy();
    expect(p2.planUid).toBe(planUid);
    expect(p2.title).toBe('Phase 2: Implementation');
    expect(p2.phaseNumber).toBe(2);
    expect(p2.uid).not.toBe(phase1Uid);
    phase2Uid = p2.uid;
  });

  test('list phases returns both in order', async () => {
    const res = await h.client.raw('GET', `/api/plans/${planUid}/phases`);
    expect(res.ok).toBe(true);
    const phases: Phase[] = await res.json();
    expect(phases).toHaveLength(2);
    expect(phases[0].uid).toBe(phase1Uid);
    expect(phases[0].phaseNumber).toBe(1);
    expect(phases[1].uid).toBe(phase2Uid);
    expect(phases[1].phaseNumber).toBe(2);
  });

  test('update a phase changes title and status', async () => {
    const res = await h.client.raw('PUT', `/api/plan-phases/${phase1Uid}`, {
      title: 'Updated Phase 1',
      status: 'in_progress',
    });
    expect(res.ok).toBe(true);
    const updated: Phase = await res.json();
    expect(updated.uid).toBe(phase1Uid);
    expect(updated.title).toBe('Updated Phase 1');
    expect(updated.status).toBe('in_progress');
    // Unchanged fields should persist.
    expect(updated.scope).toBe('Initial project scaffolding');
    expect(updated.prerequisites).toBe('Node 18+');
    expect(updated.acceptanceCriteria).toBe('All deps install cleanly');
  });

  test('delete a phase removes it from the list', async () => {
    const res = await h.client.raw('DELETE', `/api/plan-phases/${phase2Uid}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify the list now has only one phase.
    const listRes = await h.client.raw('GET', `/api/plans/${planUid}/phases`);
    expect(listRes.ok).toBe(true);
    const remaining: Phase[] = await listRes.json();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].uid).toBe(phase1Uid);
  });
});
