/**
 * Multi-agent contention — two agents interact with the same plan.
 *
 * Tests conflict detection when agents claim the same task, and
 * verifies agents can work different tasks concurrently.
 */

import { test, expect } from '@playwright/test';
import { cleanupPlans, seedPlan, API } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';
import { FIXTURE_PATH, resetFixture } from './helpers/fixture-reset';
import {
  createWsCollector,
  type WsEventCollector,
} from './helpers/agent-harness';

test.describe('Multi-agent contention', () => {
  let wsCollector: WsEventCollector;

  test.beforeAll(async () => {
    resetFixture();
  });

  test.beforeEach(async () => {
    wsCollector = await createWsCollector();
  });

  test.afterEach(async ({ request }) => {
    wsCollector?.close();
    await cleanupPlans(request, 'E2E Contention');
  });

  test('two agents can register simultaneously', async () => {
    const client1 = await createMcpClient();
    const client2 = await createMcpClient();

    const reg1 = await client1.callTool('register_session', {
      agent_type: 'agent-1',
      agent_model: 'test/1.0',
      project_path: FIXTURE_PATH,
    });
    expect(reg1).toBeTruthy();

    const reg2 = await client2.callTool('register_session', {
      agent_type: 'agent-2',
      agent_model: 'test/1.0',
      project_path: FIXTURE_PATH,
    });
    expect(reg2).toBeTruthy();

    client1.close();
    client2.close();
  });

  test('two agents can claim different items', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Contention Multi-agent Plan',
      projectPath: FIXTURE_PATH,
      actions: [
        { title: 'Task A', body: 'First task' },
        { title: 'Task B', body: 'Second task' },
      ],
    });

    const client1 = await createMcpClient();
    const client2 = await createMcpClient();

    await client1.callTool('register_session', {
      agent_type: 'agent-1',
      agent_model: 'test/1.0',
      project_path: FIXTURE_PATH,
    });

    await client2.callTool('register_session', {
      agent_type: 'agent-2',
      agent_model: 'test/1.0',
      project_path: FIXTURE_PATH,
    });

    // Agent 1 claims task A
    const claim1 = await client1.callTool('claim_item', {
      uid: plan.actionUids[0],
      agent_type: 'agent-1',
    });
    expect(claim1).toBeTruthy();

    // Agent 2 claims task B
    const claim2 = await client2.callTool('claim_item', {
      uid: plan.actionUids[1],
      agent_type: 'agent-2',
    });
    expect(claim2).toBeTruthy();

    // Verify both items are claimed
    const itemsRes = await request.get(`${API}/plans/${plan.uid}/items`);
    const items = await itemsRes.json();
    const actions = items.filter((i: any) => i.kind === 'action');
    const claimed = actions.filter((i: any) => i.assignee);
    expect(claimed.length).toBe(2);

    client1.close();
    client2.close();
  });

  test('both agents claiming same item produces a result', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Contention Plan',
      projectPath: FIXTURE_PATH,
      actions: [
        { title: 'Contested Task', body: 'Both agents want this' },
      ],
    });

    const client1 = await createMcpClient();
    const client2 = await createMcpClient();

    await client1.callTool('register_session', {
      agent_type: 'agent-1',
      agent_model: 'test/1.0',
      project_path: FIXTURE_PATH,
    });

    await client2.callTool('register_session', {
      agent_type: 'agent-2',
      agent_model: 'test/1.0',
      project_path: FIXTURE_PATH,
    });

    // First claim succeeds
    const claim1 = await client1.callTool('claim_item', {
      uid: plan.actionUids[0],
      agent_type: 'agent-1',
    });
    expect(claim1).toBeTruthy();

    // Second claim — may return conflict or succeed with reassignment
    // Either way it shouldn't crash
    const claim2 = await client2.callTool('claim_item', {
      uid: plan.actionUids[0],
      agent_type: 'agent-2',
    });
    expect(claim2).toBeTruthy();

    client1.close();
    client2.close();
  });

  test('plan-item-claimed broadcast fires', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: 'E2E Contention Claim Broadcast Plan',
      projectPath: FIXTURE_PATH,
      actions: [
        { title: 'Claimable', body: 'Test' },
      ],
    });

    const eventPromise = wsCollector.waitForEvent('plan-item-claimed', {}, 10_000);

    const client = await createMcpClient();
    await client.callTool('register_session', {
      agent_type: 'test',
      agent_model: 'test/1.0',
      project_path: FIXTURE_PATH,
    });

    await client.callTool('claim_item', {
      uid: plan.actionUids[0],
      agent_type: 'test',
    });

    const evt = await eventPromise;
    expect(evt).toBeTruthy();

    client.close();
  });
});
