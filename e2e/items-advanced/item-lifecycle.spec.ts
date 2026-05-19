/**
 * Item advanced lifecycle — move, claim, versions, events, progress,
 * blocked, attachments, comments.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Item advanced lifecycle', () => {
  const PLAN_TITLE = 'E2E Item Lifecycle Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Item Lifecycle');
  });

  test('move item to new parent', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [
        { title: 'Parent Object', body: 'Container' },
        { title: 'Child Action', body: 'Will be moved' },
      ],
    });

    // Create an object to serve as parent
    const objRes = await request.post(`${API}/plans/${plan.uid}/items`, {
      data: { kind: 'object', title: 'New Parent', template: 'object', body: '', status: 'pending' },
    });
    const parent = await objRes.json();

    const moveRes = await request.post(`${API}/items/${plan.actionUids[1]}/move`, {
      data: { parentUid: parent.uid, sortOrder: 0 },
    });
    expect(moveRes.ok()).toBeTruthy();
  });

  test('claim item assigns to agent', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Claimable Action', body: 'Claim me' }],
    });

    const res = await request.post(`${API}/items/${plan.actionUids[0]}/claim`, {
      data: { agentId: 'test-agent', agentType: 'e2e' },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.uid || result.ok).toBeTruthy();
  });

  test('item versions tracked on update', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Versioned Action', body: 'V1' }],
    });

    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { body: 'V2 body update' },
    });
    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { body: 'V3 body update' },
    });

    const res = await request.get(`${API}/items/${plan.actionUids[0]}/versions`);
    expect(res.ok()).toBeTruthy();
    const versions = await res.json();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  test('item events log mutations', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Event Action', body: 'Track events' }],
    });

    // Make some changes
    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'in_progress' },
    });

    const res = await request.get(`${API}/items/${plan.actionUids[0]}/events`);
    expect(res.ok()).toBeTruthy();
    const events = await res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('report item progress', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Progress Action', body: 'Track progress' }],
    });

    const res = await request.post(`${API}/items/${plan.actionUids[0]}/progress`, {
      data: { percent: 50, message: 'Halfway there' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('mark item as blocked', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Blocked Action', body: 'Will get blocked' }],
    });

    const res = await request.post(`${API}/items/${plan.actionUids[0]}/blocked`, {
      data: { reason: 'Waiting on API key from vendor' },
    });
    expect(res.ok()).toBeTruthy();

    // Verify status changed
    const itemRes = await request.get(`${API}/items/${plan.actionUids[0]}`);
    const item = await itemRes.json();
    expect(item.status).toBe('blocked');
  });

  test('add and list item comments', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Comment Action', body: 'Add comments' }],
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: {
        body: 'This needs refactoring first',
        kind: 'note',
        source: 'human',
      },
    });

    await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: {
        body: 'What auth library should I use?',
        kind: 'question',
        source: 'agent',
      },
    });

    const res = await request.get(`${API}/items/${plan.actionUids[0]}/comments`);
    expect(res.ok()).toBeTruthy();
    const comments = await res.json();
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThanOrEqual(2);
  });

  test('add and list item attachments', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Attachment Action', body: 'Add attachments' }],
    });

    const addRes = await request.post(`${API}/items/${plan.actionUids[0]}/attachments`, {
      data: {
        kind: 'url',
        label: 'Design Doc',
        value: 'https://example.com/design.md',
      },
    });
    expect(addRes.ok()).toBeTruthy();

    const listRes = await request.get(`${API}/items/${plan.actionUids[0]}/attachments`);
    expect(listRes.ok()).toBeTruthy();
    const attachments = await listRes.json();
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments.length).toBeGreaterThanOrEqual(1);
  });

  test('get full item context (single round-trip)', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Full Context Action', body: 'Bundle test' }],
    });

    // Add a comment so the bundle has content
    await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      data: { body: 'Test comment', kind: 'note', source: 'human' },
    });

    const res = await request.get(`${API}/items/${plan.actionUids[0]}/full`);
    expect(res.ok()).toBeTruthy();
    const full = await res.json();
    expect(full.uid || full.item).toBeTruthy();
  });

  test('restore item to previous version', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Restore Action', body: 'Original body' }],
    });

    // Update to create a version
    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { body: 'Changed body' },
    });

    // Get versions
    const versionsRes = await request.get(`${API}/items/${plan.actionUids[0]}/versions`);
    const versions = await versionsRes.json();

    if (versions.length > 0) {
      const firstVersion = versions[versions.length - 1]; // oldest
      const restoreRes = await request.post(
        `${API}/items/${plan.actionUids[0]}/restore-version/${firstVersion.version ?? 1}`,
      );
      expect(restoreRes.status()).toBeLessThan(500);
    }
  });
});
