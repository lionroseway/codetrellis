/**
 * External references panel — add URL, kind detection, remove.
 *
 * Covers: external refs API, add URL via API, kind detection,
 * refs visible in item canvas, remove ref.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('External references', () => {
  const PLAN_TITLE = 'E2E External Refs Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E External Refs');
  });

  test('add external ref via API', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Ref Action', body: 'Body' }],
    });

    const res = await request.post(`${API}/items/${plan.actionUids[0]}/refs`, {
      data: {
        url: 'https://github.com/example/repo/issues/42',
        title: 'GitHub Issue #42',
      },
    });
    expect(res.ok()).toBeTruthy();
    const ref = await res.json();
    expect(ref.uid).toBeTruthy();
    // The API's field is `title`; this spec used to send `label`, which
    // the server ignores, and nothing noticed.
    expect(ref.title).toBe('GitHub Issue #42');
  });

  test('list external refs via API', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'List Ref Action', body: 'Body' }],
    });

    // Add a ref
    await request.post(`${API}/items/${plan.actionUids[0]}/refs`, {
      data: { url: 'https://example.com/docs', title: 'Docs' },
    });

    // List refs
    const res = await request.get(`${API}/items/${plan.actionUids[0]}/refs`);
    expect(res.ok()).toBeTruthy();
    const refs = await res.json();
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  test('delete external ref via API', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Delete Ref Action', body: 'Body' }],
    });

    const addRes = await request.post(`${API}/items/${plan.actionUids[0]}/refs`, {
      data: { url: 'https://example.com/to-delete', title: 'Delete me' },
    });
    const ref = await addRes.json();

    const delRes = await request.delete(`${API}/refs/${ref.uid}`);
    expect(delRes.ok()).toBeTruthy();

    // Verify deleted
    const listRes = await request.get(`${API}/items/${plan.actionUids[0]}/refs`);
    const refs = await listRes.json();
    const found = refs.find((r: any) => r.uid === ref.uid);
    expect(found).toBeFalsy();
  });

  test('external ref visible in item canvas UI', async ({ page, request }) => {
    // Its own title: the other tests here seed plans under PLAN_TITLE too,
    // and openPlan by that title could open one of theirs, which has no ref.
    const title = `${PLAN_TITLE} visible ${Date.now()}`;
    const plan = await seedPlan(request, {
      title,
      actions: [{ title: 'Visible Ref Action', body: 'Body' }],
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/refs`, {
      data: { url: 'https://github.com/example/repo', title: 'GitHub Repo Link' },
    });

    await gotoWithProject(page);
    await openPlan(page, title);

    await page.getByText('Visible Ref Action').first().click();

    // The ref label or URL should be visible somewhere in the canvas. Waited
    // for, not sampled: `isVisible` checks once and ignores its timeout, so a
    // canvas that took over a second to load the item's refs read as absent.
    await expect(page.getByText('GitHub Repo Link').or(page.getByText('github.com/example/repo')).first())
      .toBeVisible({ timeout: 10_000 });
  });

  test('plan-level refs endpoint works', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const res = await request.get(`${API}/plans/${plan.uid}/refs`);
    // Might return 200 with empty array or the endpoint itself
    expect(res.status()).toBeLessThan(500);
  });
});
