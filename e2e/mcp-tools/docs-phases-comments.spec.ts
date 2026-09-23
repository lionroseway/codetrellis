/**
 * MCP pages, nesting, comments, attachments, external refs tools.
 *
 * Plan docs, phases and plan-level comments used to have their own tools
 * (`add_plan_doc`, `add_plan_phase`, `add_comment`, …). The unified item
 * model replaced them: a doc is an Object item, a phase is an Object with
 * children, and comments live on items. This spec exercises the tools that
 * replaced them, so what it covers is what an agent can actually call.
 *
 * Covers: add_item (object + nested action), get_item, list_items,
 * update_item, search_items, move_item, delete_item, add_item_comment,
 * list_item_comments, delete_item_comment, add_item_attachment,
 * add_external_ref, list_external_refs, remove_external_ref.
 *
 * Every call goes through `ok()`, which fails on an error result. The
 * earlier version only asserted that SOME result came back — an MCP error
 * is a result — so it passed against tools that no longer existed and
 * against arguments the tools rejected.
 */

import { test, expect } from '@playwright/test';
import { createMcpClient } from '../helpers/mcp-client';
import { cleanupPlans } from '../helpers/setup';

type Client = Awaited<ReturnType<typeof createMcpClient>>;

async function ok(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool(name, args);
  const text: string = result?.content?.[0]?.text ?? '';
  expect(result?.isError, `${name} returned an error: ${text}`).toBeFalsy();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function newPlan(client: Client, title: string): Promise<string> {
  const plan = await ok(client, 'create_plan', { tasks: [], title, project_path: process.cwd() });
  expect(plan.uid).toBeTruthy();
  return plan.uid;
}

async function newItem(
  client: Client,
  planUid: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  const item = await ok(client, 'add_item', { plan_uid: planUid, kind: 'action', body: 'body', ...fields });
  expect(item.uid).toBeTruthy();
  return item.uid;
}

test.describe('MCP pages, comments, attachments, refs', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E Items ');
  });

  test('page (object item): add → get → list → update → search', async () => {
    const client = await createMcpClient();
    const planUid = await newPlan(client, 'MCP E2E Items Docs Plan');

    const docUid = await newItem(client, planUid, {
      kind: 'object',
      title: 'Executive Summary',
      body: '# Overview\n\nThis plan restructures auth.',
    });

    const got = await ok(client, 'get_item', { uid: docUid });
    expect(JSON.stringify(got)).toContain('Executive Summary');

    const listed = await ok(client, 'list_items', { plan_uid: planUid, kind: 'object' });
    expect(JSON.stringify(listed)).toContain(docUid);

    await ok(client, 'update_item', { uid: docUid, body: '# Updated Overview\n\nAuth refactored.' });
    const updated = await ok(client, 'get_item', { uid: docUid });
    expect(JSON.stringify(updated)).toContain('Auth refactored.');

    const found = await ok(client, 'search_items', { plan_uid: planUid, query: 'executive' });
    expect(JSON.stringify(found)).toContain(docUid);

    client.close();
  });

  test('phase (object with children): nest → list children → move out → delete', async () => {
    const client = await createMcpClient();
    const planUid = await newPlan(client, 'MCP E2E Items Phases Plan');

    const phaseUid = await newItem(client, planUid, { kind: 'object', title: 'Phase 1: Setup' });
    const stepUid = await newItem(client, planUid, { title: 'Install deps', parent_uid: phaseUid });

    const children = await ok(client, 'list_items', { plan_uid: planUid, parent_uid: phaseUid });
    expect(JSON.stringify(children)).toContain(stepUid);

    await ok(client, 'update_item', { uid: phaseUid, title: 'Phase 1: Foundation' });

    // Detach the step to top level, then delete the now-empty phase.
    await ok(client, 'move_item', { uid: stepUid, new_parent_uid: '' });
    const after = await ok(client, 'list_items', { plan_uid: planUid, parent_uid: phaseUid });
    expect(JSON.stringify(after)).not.toContain(stepUid);

    await ok(client, 'delete_item', { uid: phaseUid, cascade: false });
    const remaining = await ok(client, 'list_items', { plan_uid: planUid });
    expect(JSON.stringify(remaining)).not.toContain(phaseUid);
    expect(JSON.stringify(remaining)).toContain(stepUid);

    client.close();
  });

  test('add_item_comment → list_item_comments → delete_item_comment', async () => {
    const client = await createMcpClient();
    const planUid = await newPlan(client, 'MCP E2E Items Item Comments Plan');
    const itemUid = await newItem(client, planUid, { title: 'Commentable Item' });

    const comment = await ok(client, 'add_item_comment', {
      uid: itemUid,
      body: 'Item-level MCP comment',
      kind: 'note',
    });
    expect(comment.uid).toBeTruthy();

    const listed = await ok(client, 'list_item_comments', { uid: itemUid });
    expect(JSON.stringify(listed)).toContain('Item-level MCP comment');

    await ok(client, 'delete_item_comment', { comment_uid: comment.uid });
    const after = await ok(client, 'list_item_comments', { uid: itemUid });
    expect(JSON.stringify(after)).not.toContain('Item-level MCP comment');

    client.close();
  });

  test('add_item_attachment attaches URL', async () => {
    const client = await createMcpClient();
    const planUid = await newPlan(client, 'MCP E2E Items Attach Plan');
    const itemUid = await newItem(client, planUid, { title: 'Attachable Item' });

    await ok(client, 'add_item_attachment', {
      uid: itemUid,
      kind: 'url',
      value: 'https://example.com/docs',
      label: 'Documentation',
    });
    const full = await ok(client, 'read_item_full', { uid: itemUid });
    expect(JSON.stringify(full)).toContain('https://example.com/docs');

    client.close();
  });

  test('add_external_ref → list → remove', async () => {
    const client = await createMcpClient();
    const planUid = await newPlan(client, 'MCP E2E Items Refs Plan');
    const itemUid = await newItem(client, planUid, { title: 'Ref Item' });

    const ref = await ok(client, 'add_external_ref', {
      item_uid: itemUid,
      url: 'https://github.com/org/repo/issues/42',
      title: 'Related Issue',
      kind: 'github_issue',
    });

    const listed = await ok(client, 'list_external_refs', { item_uid: itemUid });
    const refs: Array<{ uid: string }> = Array.isArray(listed) ? listed : listed.refs ?? [];
    const refUid = ref.uid ?? refs[0]?.uid;
    expect(refs.map((r) => r.uid)).toContain(refUid);

    await ok(client, 'remove_external_ref', { uid: refUid });
    const after = await ok(client, 'list_external_refs', { item_uid: itemUid });
    const afterRefs: Array<{ uid: string }> = Array.isArray(after) ? after : after.refs ?? [];
    expect(afterRefs.map((r) => r.uid)).not.toContain(refUid);

    client.close();
  });
});
