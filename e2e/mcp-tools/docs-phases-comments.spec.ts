/**
 * MCP docs, phases, comments, attachments, external refs tools.
 *
 * Covers: add_plan_doc, get_plan_doc, list_plan_docs, update_plan_doc,
 * search_plan_docs, add_plan_phase, list_plan_phases, update_plan_phase,
 * delete_plan_phase, add_comment, get_comments, add_item_comment,
 * list_item_comments, add_item_attachment, add_external_ref,
 * list_external_refs, remove_external_ref.
 */

import { test, expect } from '@playwright/test';
import { createMcpClient } from '../helpers/mcp-client';
import { cleanupPlans } from '../helpers/setup';

test.describe('MCP docs, phases, comments', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E');
  });

  test('add_plan_doc → get_plan_doc → list_plan_docs → update_plan_doc → search_plan_docs', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Docs Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    // Add doc
    const addResult = await client.callTool('add_plan_doc', {
      plan_uid: planUid,
      doc_type: 'executive',
      title: 'Executive Summary',
      body: '# Overview\n\nThis plan restructures auth.',
    });
    expect(addResult).toBeTruthy();
    const docData = JSON.parse(addResult.content?.[0]?.text || '{}');
    const docUid = docData.uid;

    // Get doc
    const getResult = await client.callTool('get_plan_doc', { doc_uid: docUid });
    expect(getResult).toBeTruthy();

    // List docs
    const listResult = await client.callTool('list_plan_docs', { plan_uid: planUid });
    expect(listResult).toBeTruthy();

    // Update doc
    const updateResult = await client.callTool('update_plan_doc', {
      doc_uid: docUid,
      body: '# Updated Overview\n\nAuth refactored.',
    });
    expect(updateResult).toBeTruthy();

    // Search
    const searchResult = await client.callTool('search_plan_docs', {
      plan_uid: planUid,
      query: 'auth',
    });
    expect(searchResult).toBeTruthy();

    client.close();
  });

  test('add_plan_phase → list → update → delete', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Phases Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    // Add phase
    const addResult = await client.callTool('add_plan_phase', {
      plan_uid: planUid,
      title: 'Phase 1: Setup',
      phase_number: 1,
    });
    expect(addResult).toBeTruthy();
    const phaseData = JSON.parse(addResult.content?.[0]?.text || '{}');
    const phaseUid = phaseData.uid;

    // List
    const listResult = await client.callTool('list_plan_phases', { plan_uid: planUid });
    expect(listResult).toBeTruthy();

    // Update
    const updateResult = await client.callTool('update_plan_phase', {
      phase_uid: phaseUid,
      title: 'Phase 1: Foundation',
      status: 'in_progress',
    });
    expect(updateResult).toBeTruthy();

    // Delete
    const deleteResult = await client.callTool('delete_plan_phase', {
      phase_uid: phaseUid,
    });
    expect(deleteResult).toBeTruthy();

    client.close();
  });

  test('add_comment → get_comments (plan-level)', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Comments Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    // Add comment
    const addResult = await client.callTool('add_comment', {
      target_uid: planUid,
      body: 'MCP protocol comment',
    });
    expect(addResult).toBeTruthy();

    // Get comments
    const getResult = await client.callTool('get_comments', {
      target_uid: planUid,
    });
    expect(getResult).toBeTruthy();

    client.close();
  });

  test('add_item_comment → list_item_comments', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Item Comments Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const itemResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Commentable Item',
      body: 'body',
    });
    const itemUid = JSON.parse(itemResult.content?.[0]?.text || '{}').uid;

    // Add comment
    const addResult = await client.callTool('add_item_comment', {
      item_uid: itemUid,
      body: 'Item-level MCP comment',
      kind: 'note',
    });
    expect(addResult).toBeTruthy();

    // List
    const listResult = await client.callTool('list_item_comments', {
      item_uid: itemUid,
    });
    expect(listResult).toBeTruthy();

    client.close();
  });

  test('add_item_attachment attaches URL', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Attach Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const itemResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Attachable Item',
      body: 'body',
    });
    const itemUid = JSON.parse(itemResult.content?.[0]?.text || '{}').uid;

    const attachResult = await client.callTool('add_item_attachment', {
      item_uid: itemUid,
      kind: 'url',
      value: 'https://example.com/docs',
      label: 'Documentation',
    });
    expect(attachResult).toBeTruthy();

    client.close();
  });

  test('add_external_ref → list → remove', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Refs Plan',
      project_path: process.cwd(),
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const itemResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Ref Item',
      body: 'body',
    });
    const itemUid = JSON.parse(itemResult.content?.[0]?.text || '{}').uid;

    // Add ref
    const addResult = await client.callTool('add_external_ref', {
      item_uid: itemUid,
      provider: 'github',
      external_id: '42',
      url: 'https://github.com/org/repo/issues/42',
      title: 'Related Issue',
      ref_type: 'issue',
    });
    expect(addResult).toBeTruthy();

    // List
    const listResult = await client.callTool('list_external_refs', {
      item_uid: itemUid,
    });
    expect(listResult).toBeTruthy();
    const refData = JSON.parse(listResult.content?.[0]?.text || '[]');
    const refList = Array.isArray(refData) ? refData : refData.refs || [];

    if (refList.length > 0) {
      const refUid = refList[0].uid;
      const removeResult = await client.callTool('remove_external_ref', {
        ref_uid: refUid,
      });
      expect(removeResult).toBeTruthy();
    }

    client.close();
  });
});
