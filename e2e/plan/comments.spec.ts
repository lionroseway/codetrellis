/**
 * Comments — comment thread on plan items.
 *
 * Covers: comment kind selector, posting comments, viewing threads,
 * comment body visible in UI, API round-trip.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan comments', () => {
  const PLAN_TITLE = 'E2E Comments Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Comments');
  });

  test('add a comment via API and see it in UI', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Commented Action', body: 'Body' }],
    });

    // Add comment via API
    await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: { body: 'This looks great, approved!', kind: 'note' },
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Commented Action').first().click();
    await page.waitForTimeout(1000);

    // Comment should be visible in the item canvas
    await expect(page.getByText('This looks great, approved!').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('comments endpoint returns posted comments', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'API Comment Action', body: 'Body' }],
    });

    // Post a note comment
    const postRes = await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: { body: 'E2E test note comment', kind: 'note' },
    });
    expect(postRes.ok()).toBeTruthy();

    // Post a blocker comment
    const postRes2 = await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: { body: 'This is blocked by dependency', kind: 'blocker' },
    });
    expect(postRes2.ok()).toBeTruthy();

    // Read back
    const getRes = await request.get(`${API}/items/${plan.actionUids[0]}/comments`);
    expect(getRes.ok()).toBeTruthy();
    const comments = await getRes.json();
    expect(comments.length).toBeGreaterThanOrEqual(2);
  });

  test('multiple comments render as a thread', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Thread Action', body: 'Body' }],
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: { body: 'First comment in thread', kind: 'note' },
    });
    await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: { body: 'Second comment in thread', kind: 'progress' },
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    await page.getByText('Thread Action').first().click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('First comment in thread').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Second comment in thread').first()).toBeVisible();
  });
});
