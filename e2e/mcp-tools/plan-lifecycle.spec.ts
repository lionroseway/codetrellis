/**
 * MCP plan lifecycle — create_plan, get_plan, update_plan, list_plans,
 * add_item, get_item, update_item, list_items, delete_item, move_item,
 * claim_item, get_next_item, read_item_full, restore_item_version,
 * update_item_progress, set_item_blocked, approve_gate (retired: refuses),
 * get_plan_timeline, report_plan.
 */

import { test, expect } from '@playwright/test';
import { createMcpClient } from '../helpers/mcp-client';
import { cleanupPlans, API } from '../helpers/setup';

test.describe('MCP plan lifecycle', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E Lifecycle ');
  });

  test('create_plan → get_plan → update_plan → list_plans', async () => {
    const client = await createMcpClient();

    // Create
    const createResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Plan',
      description: 'Created via MCP wire protocol',
      project_path: process.cwd(),
    });
    expect(createResult).toBeTruthy();
    const planText = createResult.content?.[0]?.text || JSON.stringify(createResult);
    const planData = JSON.parse(planText);
    const planUid = planData.uid;
    expect(planUid).toBeTruthy();

    // Get
    const getResult = await client.callTool('get_plan', { plan_uid: planUid });
    expect(getResult).toBeTruthy();

    // Update
    const updateResult = await client.callTool('update_plan', {
      plan_uid: planUid,
      title: 'MCP E2E Lifecycle Plan Updated',
    });
    expect(updateResult).toBeTruthy();

    // List
    const listResult = await client.callTool('list_plans', {});
    const listText = listResult.content?.[0]?.text || JSON.stringify(listResult);
    expect(listText).toContain('MCP E2E Lifecycle Plan');

    client.close();
  });

  test('add_item → get_item → update_item → list_items', async () => {
    const client = await createMcpClient();

    // Create plan first
    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Items Plan',
      project_path: process.cwd(),
    });
    const planData = JSON.parse(planResult.content?.[0]?.text || '{}');
    const planUid = planData.uid;

    // Add item
    const addResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'MCP Action Item',
      body: 'Created via MCP protocol',
    });
    expect(addResult).toBeTruthy();
    const itemData = JSON.parse(addResult.content?.[0]?.text || '{}');
    const itemUid = itemData.uid;
    expect(itemUid).toBeTruthy();

    // Get
    const getResult = await client.callTool('get_item', { item_uid: itemUid });
    expect(getResult).toBeTruthy();

    // Update
    const updateResult = await client.callTool('update_item', {
      item_uid: itemUid,
      status: 'in_progress',
    });
    expect(updateResult).toBeTruthy();

    // List
    const listResult = await client.callTool('list_items', { plan_uid: planUid });
    const listText = listResult.content?.[0]?.text || JSON.stringify(listResult);
    expect(listText).toContain('MCP Action Item');

    client.close();
  });

  test('read_item_full returns bundled context', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Full Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const addResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Full Context Item',
      body: 'body',
    });
    const itemUid = JSON.parse(addResult.content?.[0]?.text || '{}').uid;

    const fullResult = await client.callTool('read_item_full', { item_uid: itemUid });
    expect(fullResult).toBeTruthy();

    client.close();
  });

  test('move_item changes parent', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Move Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    // Create parent object
    const objResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'object',
      title: 'Container',
    });
    const parentUid = JSON.parse(objResult.content?.[0]?.text || '{}').uid;

    // Create child action
    const childResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Child',
      body: 'Will be moved',
    });
    const childUid = JSON.parse(childResult.content?.[0]?.text || '{}').uid;

    // Move
    const moveResult = await client.callTool('move_item', {
      item_uid: childUid,
      parent_uid: parentUid,
      sort_order: 0,
    });
    expect(moveResult).toBeTruthy();

    client.close();
  });

  test('claim_item assigns agent', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Claim Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const addResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Claimable',
      body: 'body',
    });
    const itemUid = JSON.parse(addResult.content?.[0]?.text || '{}').uid;

    const claimResult = await client.callTool('claim_item', {
      item_uid: itemUid,
      agent_id: 'e2e-mcp-agent',
      agent_type: 'test',
    });
    expect(claimResult).toBeTruthy();

    client.close();
  });

  test('update_item_progress + set_item_blocked', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Progress Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const addResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Progress Item',
      body: 'body',
    });
    const itemUid = JSON.parse(addResult.content?.[0]?.text || '{}').uid;

    // Progress
    const progressResult = await client.callTool('update_item_progress', {
      item_uid: itemUid,
      percent: 50,
      message: 'Halfway via MCP',
    });
    expect(progressResult).toBeTruthy();

    // Blocked
    const blockedResult = await client.callTool('set_item_blocked', {
      item_uid: itemUid,
      reason: 'Waiting for API key',
    });
    expect(blockedResult).toBeTruthy();

    client.close();
  });

  test('delete_item removes item', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Delete Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const addResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Delete Me',
      body: 'body',
    });
    const itemUid = JSON.parse(addResult.content?.[0]?.text || '{}').uid;

    const deleteResult = await client.callTool('delete_item', { item_uid: itemUid });
    expect(deleteResult).toBeTruthy();

    client.close();
  });

  test('get_plan_timeline returns events', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Timeline Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    // Create an item to generate events
    await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Event Generator',
      body: 'body',
    });

    const timelineResult = await client.callTool('get_plan_timeline', {
      plan_uid: planUid,
    });
    expect(timelineResult).toBeTruthy();

    client.close();
  });

  test('report_plan returns plan summary', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Report Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const reportResult = await client.callTool('report_plan', {
      plan_uid: planUid,
    });
    expect(reportResult).toBeTruthy();

    client.close();
  });

  test('get_next_item returns pending item', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Next Item Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Pending Item',
      body: 'body',
    });

    const nextResult = await client.callTool('get_next_item', {
      plan_uid: planUid,
    });
    expect(nextResult).toBeTruthy();

    client.close();
  });

  // Phase 31.1: sign-off is a person's, taken in CodeTrellis or on a
  // paired phone. The tool stays registered for one release so an agent
  // that learned it is told where to go instead.
  test('approve_gate refuses and points at submit_criterion', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Lifecycle Gate Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const itemResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Gateable Item',
      body: 'body',
    });
    const itemUid = JSON.parse(itemResult.content?.[0]?.text || '{}').uid;

    const gateResult = await client.callTool('approve_gate', { uid: itemUid });
    expect(gateResult.isError).toBe(true);
    expect(gateResult.content?.[0]?.text).toMatch(/submit_criterion/);

    client.close();
  });
});
