/**
 * Mock agent for CI — scripted MCP tool calls that replicate what
 * real Claude would do.  Two modes:
 *
 * - runMockAgentAuthored: Authors a plan via MCP, then executes it
 * - runMockAgentPreseeded: Executes a pre-seeded plan found by UID
 * - runMockAgentDeviation: Authors a plan, then deviates during execution
 */

import fs from 'node:fs';
import path from 'node:path';
import { createMcpClient } from '../../helpers/mcp-client';

type McpClient = Awaited<ReturnType<typeof createMcpClient>>;

// ─────────────────────────────────────────────────
// Authored flow (mirrors Prompt B)
// ─────────────────────────────────────────────────

export async function runMockAgentAuthored(fixture: string): Promise<string> {
  const client = await createMcpClient();

  await client.callTool('register_session', {
    agent_type: 'mock-test',
    agent_model: 'harness/1.0',
    project_path: fixture,
  });

  // Author the plan
  const planResult = await client.callTool('create_plan', {
    tasks: [],
    title: 'E2E Agent-Authored: Error Handling',
    project_path: fixture,
  });
  const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

  await client.callTool('set_active_plan', { plan_uid: planUid });

  const item1 = await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'action',
    title: 'Add try-catch to API fetch calls',
    body: 'Wrap the fetch() calls in api.ts with try-catch blocks',
    file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
  });
  const item1Uid = JSON.parse(item1.content?.[0]?.text || '{}').uid;

  const item2 = await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'action',
    title: 'Add error boundary to UserList',
    body: 'Add error handling to UserList.tsx',
    file_specs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
  });
  const item2Uid = JSON.parse(item2.content?.[0]?.text || '{}').uid;

  // A summary page and a phase — Object items, which replaced the old
  // add_plan_doc / add_plan_phase tools.
  await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'object',
    title: 'Error Handling Improvement',
    body: 'This plan adds error handling to the web frontend.',
  });

  await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'object',
    title: 'Phase 1: Core error handling',
  });

  // Execute
  await executePlanItems(client, fixture, [item1Uid, item2Uid]);

  client.close();
  return planUid;
}

// ─────────────────────────────────────────────────
// Pre-seeded flow (mirrors Prompt A)
// ─────────────────────────────────────────────────

export async function runMockAgentPreseeded(
  fixture: string,
  planUid: string,
): Promise<void> {
  const client = await createMcpClient();

  await client.callTool('register_session', {
    agent_type: 'mock-test',
    agent_model: 'harness/1.0',
    project_path: fixture,
  });

  await client.callTool('set_active_plan', { plan_uid: planUid });

  // Work through items using get_next_item (same loop as Prompt A)
  let hasMore = true;
  while (hasMore) {
    const next = await client.callTool('get_next_item', { plan_uid: planUid });
    const text = next?.content?.[0]?.text || '';
    let item: any;
    try {
      item = JSON.parse(text);
    } catch {
      // get_next_item returns plain text like "No items available" when done
      hasMore = false;
      break;
    }
    if (!item?.uid) {
      hasMore = false;
      break;
    }
    await executeSingleItem(client, fixture, item.uid);
  }

  client.close();
}

// ─────────────────────────────────────────────────
// Deviation flow (mirrors Prompt C)
// ─────────────────────────────────────────────────

export async function runMockAgentDeviation(fixture: string): Promise<string> {
  const client = await createMcpClient();

  await client.callTool('register_session', {
    agent_type: 'mock-test',
    agent_model: 'harness/1.0',
    project_path: fixture,
  });

  // Author the same plan
  const planResult = await client.callTool('create_plan', {
    tasks: [],
    title: 'E2E Agent-Authored: Error Handling',
    project_path: fixture,
  });
  const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

  await client.callTool('set_active_plan', { plan_uid: planUid });

  const item1 = await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'action',
    title: 'Add try-catch to API fetch calls',
    body: 'Wrap the fetch() calls in api.ts with try-catch blocks',
    file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
  });
  const item1Uid = JSON.parse(item1.content?.[0]?.text || '{}').uid;

  await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'action',
    title: 'Add error boundary to UserList',
    body: 'Add error handling to UserList.tsx',
    file_specs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
  });
  // Note: we get item2Uid but deliberately DON'T execute it

  // Execute ONLY item 1 (deviation: skip item 2)
  await executeSingleItem(client, fixture, item1Uid);

  // Edit an unplanned file (deviation: unexpected change)
  const dbPath = path.join(fixture, 'services/api/app/db.py');
  fs.appendFileSync(dbPath, '\n# modified outside plan scope\n');

  client.close();
  return planUid;
}

/**
 * Pre-seeded deviation (mirrors Prompt D).
 * Executes only the first item, skips the rest, edits an unplanned file.
 */
export async function runMockAgentPreseededDeviation(
  fixture: string,
  planUid: string,
): Promise<void> {
  const client = await createMcpClient();

  await client.callTool('register_session', {
    agent_type: 'mock-test',
    agent_model: 'harness/1.0',
    project_path: fixture,
  });

  await client.callTool('set_active_plan', { plan_uid: planUid });

  // Get the first item and execute it
  const next = await client.callTool('get_next_item', { plan_uid: planUid });
  const text = next?.content?.[0]?.text || '';
  let item: any;
  try {
    item = JSON.parse(text);
  } catch {
    // Plain text response — no items
  }
  if (item?.uid) {
    await executeSingleItem(client, fixture, item.uid);
  }

  // Skip remaining items — edit an unplanned file instead
  const dbPath = path.join(fixture, 'services/api/app/db.py');
  fs.appendFileSync(dbPath, '\n# modified outside plan scope\n');

  client.close();
}

// ─────────────────────────────────────────────────
// Shared execution helpers
// ─────────────────────────────────────────────────

async function executeSingleItem(
  client: McpClient,
  fixture: string,
  itemUid: string,
): Promise<void> {
  await client.callTool('claim_item', {
    uid: itemUid,
    agent_type: 'mock-agent',
  });

  // Get file specs from the item
  const itemResult = await client.callTool('get_item', { uid: itemUid });
  const parsed = JSON.parse(itemResult?.content?.[0]?.text || '{}');
  const fileSpecs = parsed.fileSpecs || parsed.file_specs || [];

  // Simulate file edit (triggers file watcher)
  for (const spec of fileSpecs) {
    const filePath = path.join(fixture, spec.path);
    if (fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, `\n// Modified by mock agent at ${Date.now()}\n`);
    }
  }

  await client.callTool('update_item_progress', {
    uid: itemUid,
    percent: 100,
    message: 'Complete',
  });

  await client.callTool('update_item', {
    uid: itemUid,
    status: 'done',
  });
}

async function executePlanItems(
  client: McpClient,
  fixture: string,
  uids: string[],
): Promise<void> {
  for (const uid of uids) {
    await executeSingleItem(client, fixture, uid);
  }
}
