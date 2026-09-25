/**
 * Global comments API — the plan-level comments endpoint.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Global comments API', () => {
  const PLAN_TITLE = 'E2E Global Comments Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Global Comments');
  });

  test('POST /api/comments creates a plan comment', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const res = await request.post(`${API}/comments`, {
      data: {
        targetType: 'plan',
        targetUid: plan.uid,
        body: 'Top-level plan comment',
      },
    });
    expect(res.ok()).toBeTruthy();
    const comment = await res.json();
    expect(comment.uid).toBeTruthy();
  });

  test('GET /api/comments lists comments for a plan', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    await request.post(`${API}/comments`, {
      data: { targetType: 'plan', targetUid: plan.uid, body: 'Comment 1' },
    });
    await request.post(`${API}/comments`, {
      data: { targetType: 'plan', targetUid: plan.uid, body: 'Comment 2' },
    });

    const res = await request.get(`${API}/comments?target=${plan.uid}`);
    expect(res.ok()).toBeTruthy();
    const comments = await res.json();
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThanOrEqual(2);
  });

  test('DELETE /api/comments/:uid removes a comment', async ({ request }) => {
    const plan = await seedPlan(request, { title: PLAN_TITLE });

    const addRes = await request.post(`${API}/comments`, {
      data: { targetType: 'plan', targetUid: plan.uid, body: 'Delete me' },
    });
    const comment = await addRes.json();

    const delRes = await request.delete(`${API}/comments/${comment.uid}`);
    expect(delRes.ok()).toBeTruthy();
  });
});
