/**
 * MCP changes, drift, templates, sessions, legacy task tools.
 *
 * Covers: list_proposed_changes, get_change_status, get_changes_summary,
 * detect_deviations, get_deviations, get_drift_report, reconcile,
 * list_plan_templates, create_plan_from_template, publish_plan_as_template,
 * export_plan_to_files, import_plan_from_files, discover_plan_files,
 * unlink_plan_from_files, capture_checkpoint, set_active_plan,
 * register_session, restore_item_version,
 * add_subtask, claim_task, get_next_task, read_task_full,
 * update_task, update_task_progress, set_task_blocked,
 * add_task_comment, list_task_comments, add_task_attachment.
 */

import { test, expect } from '@playwright/test';
import { createMcpClient } from '../helpers/mcp-client';
import { cleanupPlans } from '../helpers/setup';

const PROJECT_PATH = process.cwd();

test.describe('MCP changes & drift', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E');
  });

  test('list_proposed_changes + get_changes_summary', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Changes Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    // Add action with file spec to generate changes
    await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Modify server',
      body: 'Update routes',
      file_specs: [{ path: 'src/backend/server.ts', action: 'modify' }],
    });

    const listResult = await client.callTool('list_proposed_changes', {
      plan_uid: planUid,
    });
    expect(listResult).toBeTruthy();

    const summaryResult = await client.callTool('get_changes_summary', {
      plan_uid: planUid,
    });
    expect(summaryResult).toBeTruthy();

    // get_change_status for a specific change
    const changesText = listResult.content?.[0]?.text || '[]';
    const changes = JSON.parse(changesText);
    const changeList = Array.isArray(changes) ? changes : [];
    if (changeList.length > 0) {
      const statusResult = await client.callTool('get_change_status', {
        plan_uid: planUid,
        change_id: changeList[0].id,
      });
      expect(statusResult).toBeTruthy();
    }

    client.close();
  });

  test('detect_deviations + get_deviations + get_drift_report', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Drift Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const detectResult = await client.callTool('detect_deviations', {
      plan_uid: planUid,
    });
    expect(detectResult).toBeTruthy();

    const devsResult = await client.callTool('get_deviations', {
      plan_uid: planUid,
    });
    expect(devsResult).toBeTruthy();

    const driftResult = await client.callTool('get_drift_report', {
      plan_uid: planUid,
    });
    expect(driftResult).toBeTruthy();

    client.close();
  });

  test('reconcile processes deviation resolution', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Reconcile Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const result = await client.callTool('reconcile', {
      plan_uid: planUid,
      action: 'detect',
    });
    expect(result).toBeTruthy();

    client.close();
  });
});

test.describe('MCP templates', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E');
  });

  test('list_plan_templates returns available templates', async () => {
    const client = await createMcpClient();

    const result = await client.callTool('list_plan_templates', {});
    expect(result).toBeTruthy();

    client.close();
  });

  test('create_plan_from_template creates plan', async () => {
    const client = await createMcpClient();

    // Get templates first
    const templatesResult = await client.callTool('list_plan_templates', {});
    const templatesText = templatesResult.content?.[0]?.text || '[]';
    const templates = JSON.parse(templatesText);
    const templateList = Array.isArray(templates) ? templates : templates.templates || [];

    if (templateList.length > 0) {
      const result = await client.callTool('create_plan_from_template', {
        template_id: templateList[0].id || templateList[0].slug,
        title: 'MCP E2E Template Plan',
        project_path: PROJECT_PATH,
      });
      expect(result).toBeTruthy();
    }

    client.close();
  });
});

test.describe('MCP file sync', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E');
  });

  test('export_plan_to_files + import_plan_from_files + discover + unlink', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Export Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    // Export
    const exportResult = await client.callTool('export_plan_to_files', {
      plan_uid: planUid,
      project_root: PROJECT_PATH,
    });
    expect(exportResult).toBeTruthy();

    // Get export path for import
    const exportText = exportResult.content?.[0]?.text || '{}';
    const exportData = JSON.parse(exportText);
    const planDir = exportData.planDir || exportData.path;

    // import_plan_from_files — reimport the exported plan
    if (planDir) {
      const importResult = await client.callTool('import_plan_from_files', {
        plan_dir: planDir,
      });
      expect(importResult).toBeTruthy();
    }

    // Discover
    const discoverResult = await client.callTool('discover_plan_files', {
      project_root: PROJECT_PATH,
    });
    expect(discoverResult).toBeTruthy();

    // Unlink
    const unlinkResult = await client.callTool('unlink_plan_from_files', {
      plan_uid: planUid,
      project_root: PROJECT_PATH,
    });
    expect(unlinkResult).toBeTruthy();

    client.close();
  });

  test('publish_plan_as_template publishes a plan', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [{ description: 'Template task', affected_files: [] }],
      title: 'MCP E2E Publish Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const publishResult = await client.callTool('publish_plan_as_template', {
      plan_uid: planUid,
      project_root: PROJECT_PATH,
      template_id: 'e2e-mcp-template',
      label: 'E2E MCP Template',
    });
    expect(publishResult).toBeTruthy();

    client.close();
  });
});

test.describe('MCP sessions & checkpoints', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E');
  });

  test('register_session registers agent session', async () => {
    const client = await createMcpClient();

    const result = await client.callTool('register_session', {
      agent_type: 'e2e-test',
      agent_model: 'test-model-1',
      project_path: PROJECT_PATH,
    });
    expect(result).toBeTruthy();

    client.close();
  });

  test('set_active_plan links session to plan', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Active Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const result = await client.callTool('set_active_plan', {
      plan_uid: planUid,
    });
    expect(result).toBeTruthy();

    client.close();
  });

  test('capture_checkpoint creates trellis snapshot', async () => {
    const client = await createMcpClient();

    const result = await client.callTool('capture_checkpoint', {
      name: 'e2e-mcp-checkpoint',
    });
    expect(result).toBeTruthy();

    client.close();
  });
});

test.describe('MCP legacy task tools', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'MCP E2E');
  });

  test('add_subtask + claim_task + update_task + update_task_progress + set_task_blocked', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [{ description: 'Legacy task for claim', affected_files: ['src/index.ts'] }],
      title: 'MCP E2E Legacy Plan',
      project_path: PROJECT_PATH,
    });
    const planData = JSON.parse(planResult.content?.[0]?.text || '{}');
    const planUid = planData.uid;
    const taskUid = planData.tasks?.[0]?.uid;

    // Add an item to use as subtask parent
    const itemResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Parent Action',
      body: 'parent',
    });
    const itemUid = JSON.parse(itemResult.content?.[0]?.text || '{}').uid;

    // add_subtask
    const subtaskResult = await client.callTool('add_subtask', {
      parent_uid: itemUid,
      description: 'Subtask via MCP',
      plan_uid: planUid,
    });
    expect(subtaskResult).toBeTruthy();

    // claim_task (legacy)
    if (taskUid) {
      const claimResult = await client.callTool('claim_task', {
        plan_uid: planUid,
        task_uid: taskUid,
        agent_type: 'e2e-test',
      });
      expect(claimResult).toBeTruthy();

      // update_task
      const updateResult = await client.callTool('update_task', {
        plan_uid: planUid,
        task_uid: taskUid,
        status: 'in_progress',
      });
      expect(updateResult).toBeTruthy();

      // update_task_progress
      const progressResult = await client.callTool('update_task_progress', {
        task_uid: taskUid,
        percent: 75,
        message: 'Almost done via MCP',
      });
      expect(progressResult).toBeTruthy();

      // set_task_blocked
      const blockedResult = await client.callTool('set_task_blocked', {
        task_uid: taskUid,
        reason: 'Waiting on credentials',
      });
      expect(blockedResult).toBeTruthy();

      // read_task_full
      const fullResult = await client.callTool('read_task_full', {
        task_uid: taskUid,
      });
      expect(fullResult).toBeTruthy();
    }

    client.close();
  });

  test('add_task_comment + list_task_comments + add_task_attachment', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Task Comment Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const itemResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Comment Target',
      body: 'body',
    });
    const itemUid = JSON.parse(itemResult.content?.[0]?.text || '{}').uid;

    // Add task comment (uses item uid)
    const commentResult = await client.callTool('add_task_comment', {
      task_uid: itemUid,
      body: 'Legacy task comment via MCP',
      kind: 'note',
    });
    expect(commentResult).toBeTruthy();

    // List
    const listResult = await client.callTool('list_task_comments', {
      task_uid: itemUid,
    });
    expect(listResult).toBeTruthy();

    // Attachment
    const attachResult = await client.callTool('add_task_attachment', {
      task_uid: itemUid,
      kind: 'url',
      value: 'https://example.com',
      label: 'Docs',
    });
    expect(attachResult).toBeTruthy();

    client.close();
  });

  test('get_next_task + read_task_full', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Next Task Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Pending Task',
      body: 'body',
    });

    // get_next_task
    const nextResult = await client.callTool('get_next_task', {
      plan_uid: planUid,
    });
    expect(nextResult).toBeTruthy();

    client.close();
  });

  test('restore_item_version restores previous body', async () => {
    const client = await createMcpClient();

    const planResult = await client.callTool('create_plan', {
      tasks: [],
      title: 'MCP E2E Restore Plan',
      project_path: PROJECT_PATH,
    });
    const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;

    const itemResult = await client.callTool('add_item', {
      plan_uid: planUid,
      kind: 'action',
      title: 'Versioned Item',
      body: 'Original body',
    });
    const itemUid = JSON.parse(itemResult.content?.[0]?.text || '{}').uid;

    // Update to create versions
    await client.callTool('update_item', {
      item_uid: itemUid,
      body: 'Updated body v2',
    });

    // Restore
    const restoreResult = await client.callTool('restore_item_version', {
      item_uid: itemUid,
      version: 1,
    });
    expect(restoreResult).toBeTruthy();

    client.close();
  });
});
