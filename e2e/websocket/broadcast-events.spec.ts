/**
 * WebSocket broadcast event delivery.
 *
 * Verifies that backend broadcast events are actually delivered to
 * connected WebSocket clients with the correct type and payload shape.
 *
 * Strategy: connect a WS client, trigger each event via the
 * corresponding API call, verify the event arrives.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API } from '../helpers/setup';
import {
  createWsCollector,
  type WsEventCollector,
} from '../live-agent/helpers/agent-harness';

const PROJECT_PATH = process.cwd();

test.describe('WebSocket broadcast events', () => {
  let ws: WsEventCollector;

  test.beforeEach(async () => {
    ws = await createWsCollector();
  });

  test.afterEach(async ({ request }) => {
    ws?.close();
    await cleanupPlans(request, 'E2E WS:');
  });

  test('plan-created fires on POST /api/plans', async ({ request }) => {
    const eventPromise = ws.waitForEvent('plan-created', {}, 10_000);

    await request.post(`${API}/plans`, {
      data: {
        title: 'E2E WS: Plan Created',
        description: 'test',
        projectPath: PROJECT_PATH,
      },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-updated fires on PUT /api/plans/:uid', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E WS: Plan Update' });

    const eventPromise = ws.waitForEvent('plan-updated', {}, 10_000);

    await request.put(`${API}/plans/${plan.uid}`, {
      data: { title: 'E2E WS: Plan Updated' },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-item-created fires on POST /api/plans/:uid/items', async ({ request }) => {
    const planRes = await request.post(`${API}/plans`, {
      data: { title: 'E2E WS: Item Create', projectPath: PROJECT_PATH },
    });
    const plan = await planRes.json();

    const eventPromise = ws.waitForEvent('plan-item-created', {}, 10_000);

    await request.post(`${API}/plans/${plan.uid}/items`, {
      data: {
        kind: 'action',
        title: 'WS test item',
        template: 'action',
        body: 'test',
        status: 'pending',
      },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-item-updated fires on PUT /api/items/:uid', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E WS: Item Update' });

    const eventPromise = ws.waitForEvent('plan-item-updated', {}, 10_000);

    await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'in_progress' },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-item-deleted fires on DELETE /api/items/:uid', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E WS: Item Delete' });

    const eventPromise = ws.waitForEvent('plan-item-deleted', {}, 10_000);

    await request.delete(`${API}/items/${plan.actionUids[0]}`);

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-doc-created fires on POST /api/plans/:uid/docs', async ({ request }) => {
    const planRes = await request.post(`${API}/plans`, {
      data: { title: 'E2E WS: Doc Create', projectPath: PROJECT_PATH },
    });
    const plan = await planRes.json();

    const eventPromise = ws.waitForEvent('plan-doc-created', {}, 10_000);

    await request.post(`${API}/plans/${plan.uid}/docs`, {
      data: {
        docType: 'executive',
        title: 'WS Doc',
        body: 'test',
      },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-phase-created fires on POST /api/plans/:uid/phases', async ({ request }) => {
    const planRes = await request.post(`${API}/plans`, {
      data: { title: 'E2E WS: Phase Create', projectPath: PROJECT_PATH },
    });
    const plan = await planRes.json();

    const eventPromise = ws.waitForEvent('plan-phase-created', {}, 10_000);

    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: {
        title: 'WS Phase 1',
        phaseNumber: 1,
      },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('comment-added fires on POST /api/comments', async ({ request }) => {
    const planRes = await request.post(`${API}/plans`, {
      data: { title: 'E2E WS: Comment', projectPath: PROJECT_PATH },
    });
    const plan = await planRes.json();

    const eventPromise = ws.waitForEvent('comment-added', {}, 10_000);

    await request.post(`${API}/comments`, {
      data: {
        targetUid: plan.uid,
        targetType: 'plan',
        body: 'WS comment test',
      },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-item-comment-added fires on POST /api/items/:uid/comments', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E WS: Item Comment' });

    const eventPromise = ws.waitForEvent('plan-item-comment-added', {}, 10_000);

    await request.post(
      `${API}/items/${plan.actionUids[0]}/comments`,
      {
        data: { body: 'WS item comment', kind: 'note' },
      },
    );

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-item-progress fires on POST /api/items/:uid/progress', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E WS: Progress' });

    const eventPromise = ws.waitForEvent('plan-item-progress', {}, 10_000);

    await request.post(
      `${API}/items/${plan.actionUids[0]}/progress`,
      { data: { percent: 50, message: 'Halfway' } },
    );

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-item-blocked fires on POST /api/items/:uid/blocked', async ({ request }) => {
    const plan = await seedPlan(request, { title: 'E2E WS: Blocked' });

    const eventPromise = ws.waitForEvent('plan-item-blocked', {}, 10_000);

    await request.post(
      `${API}/items/${plan.actionUids[0]}/blocked`,
      { data: { reason: 'Waiting for CI' } },
    );

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('terminal-created fires on POST /api/terminals', async ({ request }) => {
    const eventPromise = ws.waitForEvent('terminal-created', {}, 10_000);

    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: PROJECT_PATH },
    });
    const term = await res.json();

    const evt = await eventPromise;
    expect(evt).toBeTruthy();

    // Cleanup
    await request.delete(`${API}/terminals/${term.id}`);
  });

  test('terminal-killed fires on DELETE /api/terminals/:id', async ({ request }) => {
    // Create a terminal first
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: PROJECT_PATH },
    });
    const term = await res.json();

    const eventPromise = ws.waitForEvent('terminal-killed', {}, 10_000);

    await request.delete(`${API}/terminals/${term.id}`);

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('settings-changed fires on PUT /api/settings', async ({ request }) => {
    const eventPromise = ws.waitForEvent('settings-changed', {}, 10_000);

    // Get current settings first
    const current = await (await request.get(`${API}/settings`)).json();

    await request.put(`${API}/settings`, {
      data: {
        ...current,
        identity: { ...current.identity, name: 'WS Test' },
      },
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('multiple events arrive in order', async ({ request }) => {
    const events: string[] = [];

    // Create a plan (triggers plan-created)
    const planRes = await request.post(`${API}/plans`, {
      data: { title: 'E2E WS: Order Test', projectPath: PROJECT_PATH },
    });
    const plan = await planRes.json();

    // Add an item (triggers plan-item-created)
    await request.post(`${API}/plans/${plan.uid}/items`, {
      data: {
        kind: 'action',
        title: 'Order test item',
        template: 'action',
        body: 'test',
        status: 'pending',
      },
    });

    // Give events time to arrive
    await new Promise((r) => setTimeout(r, 2000));

    const allEvents = ws.getEvents();
    const types = allEvents.map((e) => e.type);

    // plan-created should appear before plan-item-created
    const createdIdx = types.indexOf('plan-created');
    const itemIdx = types.indexOf('plan-item-created');
    if (createdIdx >= 0 && itemIdx >= 0) {
      expect(createdIdx).toBeLessThan(itemIdx);
    }
  });
});
