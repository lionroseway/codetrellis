/**
 * External References CRUD — links to external resources (URLs, PRs,
 * docs) attached to plan items.
 *
 * Exercises the full lifecycle through the REST API:
 *   - POST   /api/items/:itemUid/refs   (create)
 *   - GET    /api/items/:itemUid/refs   (list for item)
 *   - GET    /api/plans/:uid/refs       (list for plan)
 *   - PUT    /api/refs/:uid             (update)
 *   - DELETE /api/refs/:uid             (delete)
 *
 * Uses `test.describe.serial` so the tests build on each other:
 * the plan + item + first ref are created in beforeAll / test 1,
 * then referenced by UID in subsequent tests.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('References CRUD', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let planUid: string;
  let itemUid: string;
  let refUid: string;

  test.beforeAll(async () => {
    h = await setupHarness('references');
    await h.client.scanProject(h.fixture.projectPath);
    const plan = await h.client.createPlan({
      title: 'Refs test plan',
      projectPath: h.fixture.projectPath,
    });
    planUid = plan.uid;
    // Create an action item to attach refs to.
    const itemRes = await h.client.raw('POST', `/api/plans/${planUid}/items`, {
      kind: 'action',
      title: 'Task with refs',
    });
    const item = await itemRes.json();
    itemUid = item.uid;
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('create a reference on the item', async () => {
    const res = await h.client.raw('POST', `/api/items/${itemUid}/refs`, {
      url: 'https://github.com/org/repo/pull/42',
      title: 'PR #42',
      kind: 'pull_request',
      metadata: { state: 'open' },
    });
    expect(res.ok).toBe(true);
    const ref = await res.json();

    expect(ref.uid).toBeTruthy();
    expect(ref.url).toBe('https://github.com/org/repo/pull/42');
    expect(ref.title).toBe('PR #42');
    expect(ref.kind).toBe('pull_request');
    refUid = ref.uid;
  });

  test('list refs for the item', async () => {
    const res = await h.client.raw('GET', `/api/items/${itemUid}/refs`);
    expect(res.ok).toBe(true);
    const refs: Array<{ uid: string; url: string; title: string; kind: string }> =
      await res.json();

    expect(refs.length).toBeGreaterThanOrEqual(1);
    const match = refs.find((r) => r.uid === refUid);
    expect(match).toBeDefined();
    expect(match!.url).toBe('https://github.com/org/repo/pull/42');
    expect(match!.title).toBe('PR #42');
    expect(match!.kind).toBe('pull_request');
  });

  test('list refs for the plan', async () => {
    const res = await h.client.raw('GET', `/api/plans/${planUid}/refs`);
    expect(res.ok).toBe(true);
    const refs: Array<{ uid: string; url: string }> = await res.json();

    expect(refs.length).toBeGreaterThanOrEqual(1);
    const match = refs.find((r) => r.uid === refUid);
    expect(match).toBeDefined();
    expect(match!.url).toBe('https://github.com/org/repo/pull/42');
  });

  test('update the ref and verify changes', async () => {
    const updateRes = await h.client.raw('PUT', `/api/refs/${refUid}`, {
      title: 'Updated PR #42',
      metadata: { state: 'merged' },
    });
    expect(updateRes.ok).toBe(true);
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);

    // Verify via a fresh list on the item.
    const listRes = await h.client.raw('GET', `/api/items/${itemUid}/refs`);
    expect(listRes.ok).toBe(true);
    const refs: Array<{
      uid: string;
      title: string;
      metadata?: { state?: string };
    }> = await listRes.json();

    const updated = refs.find((r) => r.uid === refUid);
    expect(updated).toBeDefined();
    expect(updated!.title).toBe('Updated PR #42');
    expect(updated!.metadata?.state).toBe('merged');
  });

  test('delete the ref and verify it is gone', async () => {
    const deleteRes = await h.client.raw('DELETE', `/api/refs/${refUid}`);
    expect(deleteRes.ok).toBe(true);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.ok).toBe(true);

    // The item's ref list should no longer contain the deleted ref.
    const listRes = await h.client.raw('GET', `/api/items/${itemUid}/refs`);
    expect(listRes.ok).toBe(true);
    const refs: Array<{ uid: string }> = await listRes.json();

    expect(refs.find((r) => r.uid === refUid)).toBeUndefined();
  });
});
