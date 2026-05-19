/**
 * Plan docs (spec room) — full CRUD, search, versioning.
 *
 * Covers: POST /api/plans/:uid/docs, GET list, GET by-type,
 * GET search, GET /api/plan-docs/:docUid, PUT update,
 * DELETE, GET versions.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan spec docs', () => {
  const PLAN_TITLE = 'E2E Spec Docs Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Spec Docs');
  });

  test('create a spec doc', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const res = await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: {
        docType: 'executive',
        title: 'Executive Overview',
        body: '# Overview\n\nThis plan restructures the auth module.',
        orderHint: '00',
      },
    });
    expect(res.ok()).toBeTruthy();
    const doc = await res.json();
    expect(doc.uid).toBeTruthy();
    expect(doc.title).toBe('Executive Overview');
  });

  test('list spec docs for a plan', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'testing', title: 'Test Strategy', body: '# Tests', orderHint: '01' },
    });
    await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'security', title: 'Security Review', body: '# Security', orderHint: '02' },
    });

    const res = await request.get(`${API}/plans/${plan.uid}/docs`);
    expect(res.ok()).toBeTruthy();
    const docs = await res.json();
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThanOrEqual(2);
  });

  test('get spec doc by type', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'patterns', title: 'Patterns Guide', body: '# Patterns', orderHint: '03' },
    });

    const res = await request.get(`${API}/plans/${plan.uid}/docs/by-type/patterns`);
    expect(res.ok()).toBeTruthy();
    const doc = await res.json();
    expect(doc.title).toBe('Patterns Guide');
  });

  test('search spec docs', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'testing', title: 'Test Plan', body: 'Use vitest for unit tests and playwright for E2E.', orderHint: '01' },
    });

    const res = await request.get(`${API}/plans/${plan.uid}/docs/search?q=playwright`);
    expect(res.ok()).toBeTruthy();
    const results = await res.json();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('read a single spec doc by uid', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const createRes = await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'executive', title: 'Read Test Doc', body: '# Content here', orderHint: '00' },
    });
    const created = await createRes.json();

    const res = await request.get(`${API}/plan-docs/${created.uid}`);
    expect(res.ok()).toBeTruthy();
    const doc = await res.json();
    expect(doc.uid).toBe(created.uid);
    expect(doc.body).toContain('Content here');
  });

  test('update a spec doc body', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const createRes = await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'executive', title: 'Update Test', body: '# V1', orderHint: '00' },
    });
    const created = await createRes.json();

    const updateRes = await request.put(`${API}/plan-docs/${created.uid}`, {
      data: { body: '# V2\n\nUpdated content.' },
    });
    expect(updateRes.ok()).toBeTruthy();

    const readRes = await request.get(`${API}/plan-docs/${created.uid}`);
    const updated = await readRes.json();
    expect(updated.body).toContain('V2');
  });

  test('delete a spec doc', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const createRes = await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'testing', title: 'Delete Me', body: '# Gone', orderHint: '01' },
    });
    const created = await createRes.json();

    const delRes = await request.delete(`${API}/plan-docs/${created.uid}`);
    expect(delRes.ok()).toBeTruthy();

    // Verify deleted
    const listRes = await request.get(`${API}/plans/${plan.uid}/docs`);
    const docs = await listRes.json();
    const found = docs.find((d: any) => d.uid === created.uid);
    expect(found).toBeFalsy();
  });

  test('spec doc versions are tracked on update', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const createRes = await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: { docType: 'executive', title: 'Versioned Doc', body: '# Original', orderHint: '00' },
    });
    const created = await createRes.json();

    // Update twice
    await request.put(`${API}/plan-docs/${created.uid}`, { data: { body: '# Edit 1' } });
    await request.put(`${API}/plan-docs/${created.uid}`, { data: { body: '# Edit 2' } });

    const versionsRes = await request.get(`${API}/plan-docs/${created.uid}/versions`);
    expect(versionsRes.ok()).toBeTruthy();
    const versions = await versionsRes.json();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });
});
