/**
 * Plan Documents CRUD — spec docs that define what agents should build.
 *
 * Exercises the full lifecycle through the REST API:
 *   - POST   /api/plans/:uid/docs           (create)
 *   - GET    /api/plans/:uid/docs            (list full)
 *   - GET    /api/plans/:uid/docs?summary=1  (list summaries)
 *   - GET    /api/plan-docs/:docUid          (get single)
 *   - PUT    /api/plan-docs/:docUid          (update)
 *   - GET    /api/plan-docs/:docUid/versions (version history)
 *   - GET    /api/plans/:uid/docs/by-type/:docType (get by type)
 *   - DELETE /api/plan-docs/:docUid          (delete)
 *
 * Uses `test.describe.serial` so the tests build on each other:
 * the plan + first doc are created in test 1, then referenced
 * by UID in subsequent tests.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

interface PlanDoc {
  uid: string;
  planUid: string;
  docType: string;
  title: string;
  body: string;
  version: number;
  [k: string]: unknown;
}

interface DocVersion {
  version: number;
  changeSummary?: string;
  [k: string]: unknown;
}

test.describe.serial('Plan Docs CRUD', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let planUid: string;
  let docUid: string;

  test.beforeAll(async () => {
    h = await setupHarness('plan-docs-serial');
    await h.client.scanProject(h.fixture.projectPath);
  });

  test.afterAll(async () => {
    await h.teardown();
  });

  test('create a doc and get it by uid', async () => {
    // Seed a plan first.
    const plan = await h.client.createPlan({
      title: 'Doc test plan',
      projectPath: h.fixture.projectPath,
    });
    planUid = plan.uid;

    // POST /api/plans/:uid/docs — create a spec doc.
    const createRes = await h.client.raw('POST', `/api/plans/${planUid}/docs`, {
      docType: 'spec',
      title: 'Auth Spec',
      body: '# Auth\nRequirements here.',
    });
    expect(createRes.ok).toBe(true);
    const doc: PlanDoc = await createRes.json();

    expect(doc.uid).toBeTruthy();
    expect(doc.docType).toBe('spec');
    expect(doc.title).toBe('Auth Spec');
    expect(doc.body).toBe('# Auth\nRequirements here.');
    expect(typeof doc.version).toBe('number');
    docUid = doc.uid;

    // GET /api/plan-docs/:docUid — fetch the same doc back.
    const getRes = await h.client.raw('GET', `/api/plan-docs/${docUid}`);
    expect(getRes.ok).toBe(true);
    const fetched: PlanDoc = await getRes.json();

    expect(fetched.uid).toBe(docUid);
    expect(fetched.title).toBe('Auth Spec');
    expect(fetched.body).toBe('# Auth\nRequirements here.');
  });

  test('list docs (full and summary)', async () => {
    // GET /api/plans/:uid/docs — full listing.
    const fullRes = await h.client.raw('GET', `/api/plans/${planUid}/docs`);
    expect(fullRes.ok).toBe(true);
    const fullList: PlanDoc[] = await fullRes.json();

    expect(fullList.length).toBeGreaterThanOrEqual(1);
    const match = fullList.find((d) => d.uid === docUid);
    expect(match).toBeDefined();
    expect(match!.body).toBe('# Auth\nRequirements here.');

    // GET /api/plans/:uid/docs?summary=1 — summaries omit the body.
    const summaryRes = await h.client.raw('GET', `/api/plans/${planUid}/docs?summary=1`);
    expect(summaryRes.ok).toBe(true);
    const summaryList: Array<{ uid: string; title: string; body?: string }> = await summaryRes.json();

    expect(summaryList.length).toBeGreaterThanOrEqual(1);
    const summaryMatch = summaryList.find((d) => d.uid === docUid);
    expect(summaryMatch).toBeDefined();
    expect(summaryMatch!.title).toBe('Auth Spec');
    // Summary should not include the body field.
    expect(summaryMatch!.body).toBeUndefined();
  });

  test('update a doc and check version history', async () => {
    // PUT /api/plan-docs/:docUid — update title + body.
    const updateRes = await h.client.raw('PUT', `/api/plan-docs/${docUid}`, {
      title: 'Updated Auth Spec',
      body: '# Auth\nRevised requirements.',
      changeSummary: 'fixed typo',
    });
    expect(updateRes.ok).toBe(true);
    const updated: PlanDoc = await updateRes.json();

    expect(updated.uid).toBe(docUid);
    expect(updated.title).toBe('Updated Auth Spec');
    expect(updated.body).toBe('# Auth\nRevised requirements.');

    // Verify through a fresh GET.
    const getRes = await h.client.raw('GET', `/api/plan-docs/${docUid}`);
    const refetched: PlanDoc = await getRes.json();
    expect(refetched.title).toBe('Updated Auth Spec');
    expect(refetched.body).toBe('# Auth\nRevised requirements.');

    // GET /api/plan-docs/:docUid/versions — should have 2+ entries
    // (one for creation, one for the update).
    const versionsRes = await h.client.raw('GET', `/api/plan-docs/${docUid}/versions`);
    expect(versionsRes.ok).toBe(true);
    const versions: DocVersion[] = await versionsRes.json();

    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  test('get doc by type', async () => {
    // GET /api/plans/:uid/docs/by-type/:docType
    const byTypeRes = await h.client.raw('GET', `/api/plans/${planUid}/docs/by-type/spec`);
    expect(byTypeRes.ok).toBe(true);
    const byType: PlanDoc = await byTypeRes.json();

    expect(byType.uid).toBe(docUid);
    expect(byType.docType).toBe('spec');
    expect(byType.title).toBe('Updated Auth Spec');
  });

  test('delete a doc and verify it is gone', async () => {
    // DELETE /api/plan-docs/:docUid
    const deleteRes = await h.client.raw('DELETE', `/api/plan-docs/${docUid}`);
    expect(deleteRes.ok).toBe(true);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.ok).toBe(true);

    // GET should now return 404.
    const getRes = await h.client.raw('GET', `/api/plan-docs/${docUid}`);
    expect(getRes.status).toBe(404);
  });
});
