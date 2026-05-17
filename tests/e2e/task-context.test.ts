/**
 * Phase 14 §A — task-as-context MCP regression tests.
 *
 * Covers the new MCP tools end-to-end through the same SSE wire that
 * Claude Code / Codex / Cursor use:
 *
 *  - `create_plan` accepts the rich task shape (body / prompt /
 *    scope_path / file_specs / parent_task_uid)
 *  - `claim_task` returns the full task context in one round-trip
 *  - `read_task_full` returns task + parent + subtasks + phase +
 *    attachments + comments
 *  - `add_task_comment` (kind: blocker / progress / question / note)
 *  - `update_task_progress` updates the percent column AND stores a
 *    `kind: 'progress'` comment with `metadata.progressPercent`
 *  - `set_task_blocked` flips status + comment
 *  - `add_subtask` creates a child task whose `parent_task_uid` is set
 *  - `add_task_attachment` (URL kind, no disk write)
 *  - `update_task` with body / prompt / scope_path / file_specs and
 *    `affected_files` derived from `file_specs`
 *  - Plan export round-trip preserves the new fields + comments +
 *    attachments
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { setupHarness } from '../harness';

interface TaskJson {
  uid: string;
  description: string;
  status: string;
  body?: string | null;
  prompt?: string | null;
  scopePath?: string | null;
  fileSpecs?: Array<{ path: string; action: string; moveTo?: string }>;
  affectedFiles?: string[];
  parentTaskUid?: string | null;
  progressPercent?: number | null;
  blockedReason?: string | null;
}

function parseToolJson<T = unknown>(text: string): T {
  return JSON.parse(text) as T;
}

test.describe('Phase 14 §A — task-as-context MCP tools', () => {
  test.setTimeout(120_000);

  test('create_plan + claim_task returns the full task context blob', async () => {
    const h = await setupHarness('task-context-claim-full');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-claim' });

      const create = await agent.callTool('create_plan', {
        title: 'Rich plan',
        description: 'Plan with one rich task',
        project_path: h.fixture.projectPath,
        tasks: [
          {
            description: 'Build the login form',
            body: '## Why\nUsers need to log in.\n\n## Approach\nStandard email + password.',
            prompt: 'Read the design doc, then create the form.',
            scope_path: 'packages/web/src/',
            file_specs: [
              { path: 'auth/LoginForm.tsx', action: 'create', description: 'New form component' },
              { path: 'api.ts', action: 'modify' },
            ],
          },
        ],
      });
      expect(create.isError).toBeFalsy();

      const plans = await h.client.listPlans();
      const planSummary = plans.find((p) => p.title === 'Rich plan');
      expect(planSummary).toBeDefined();
      const detail = await h.client.getPlan(planSummary!.uid);
      expect(detail.tasks).toHaveLength(1);
      const taskUid = detail.tasks[0].uid;

      // The DB-side task should already carry the new fields.
      const task = detail.tasks[0] as unknown as TaskJson;
      expect(task.body).toContain('## Why');
      expect(task.prompt).toContain('Read the design doc');
      expect(task.scopePath).toBe('packages/web/src/');
      expect(task.fileSpecs).toEqual([
        { path: 'auth/LoginForm.tsx', action: 'create', description: 'New form component' },
        { path: 'api.ts', action: 'modify' },
      ]);
      // affectedFiles derived from fileSpecs.
      expect(task.affectedFiles).toEqual(
        expect.arrayContaining(['auth/LoginForm.tsx', 'api.ts']),
      );

      // claim_task returns the full context.
      const claim = await agent.callTool('claim_task', {
        plan_uid: planSummary!.uid,
        task_uid: taskUid,
        agent_type: 'harness-claim',
      });
      expect(claim.isError).toBeFalsy();
      const claimResult = parseToolJson<{
        ok: boolean;
        task: TaskJson;
        parent: unknown;
        subtasks: unknown[];
        phase: unknown;
        attachments: unknown[];
        comments: unknown[];
      }>(claim.text);
      expect(claimResult.ok).toBe(true);
      expect(claimResult.task.uid).toBe(taskUid);
      expect(claimResult.task.body).toContain('## Why');
      expect(claimResult.subtasks).toEqual([]);
      expect(claimResult.attachments).toEqual([]);
      // Auto-created session_start broadcast doesn't seed comments.
      expect(claimResult.comments).toEqual([]);
    } finally {
      await h.teardown();
    }
  });

  test('update_task_progress + set_task_blocked + add_task_comment round-trip', async () => {
    const h = await setupHarness('task-context-progress-block');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-prog' });

      await agent.callTool('create_plan', {
        title: 'Progress plan',
        project_path: h.fixture.projectPath,
        tasks: [{ description: 'Long task' }],
      });
      const plans = await h.client.listPlans();
      const plan = plans.find((p) => p.title === 'Progress plan')!;
      const taskUid = (await h.client.getPlan(plan.uid)).tasks[0].uid;

      // Heartbeat at 25%, 50%.
      const r1 = await agent.callTool('update_task_progress', {
        task_uid: taskUid,
        percent: 25,
        message: 'Set up scaffold',
      });
      expect(r1.isError).toBeFalsy();
      const r2 = await agent.callTool('update_task_progress', {
        task_uid: taskUid,
        percent: 50,
        message: 'Backend wired',
      });
      expect(r2.isError).toBeFalsy();

      // Read comments back — should have two progress entries.
      const list = await agent.callTool('list_task_comments', { task_uid: taskUid });
      const comments = parseToolJson<Array<{ kind: string; body: string; metadata?: { progressPercent?: number } }>>(list.text);
      const progress = comments.filter((c) => c.kind === 'progress');
      expect(progress).toHaveLength(2);
      expect(progress.map((p) => p.metadata?.progressPercent)).toEqual([25, 50]);

      // Add a question comment.
      const q = await agent.callTool('add_task_comment', {
        task_uid: taskUid,
        kind: 'question',
        body: 'Should we redirect to /home or /dashboard after login?',
      });
      expect(q.isError).toBeFalsy();

      // Set blocked — status flips, blockedReason persists.
      const block = await agent.callTool('set_task_blocked', {
        task_uid: taskUid,
        reason: 'Waiting on copy from design.',
      });
      expect(block.isError).toBeFalsy();

      // The DB row should reflect status + blockedReason + progress.
      const detail = await h.client.getPlan(plan.uid);
      const t = detail.tasks[0] as unknown as TaskJson;
      expect(t.status).toBe('blocked');
      expect(t.blockedReason).toBe('Waiting on copy from design.');
      expect(t.progressPercent).toBe(50);

      // Final comment list: 2 progress + 1 question + 1 blocker.
      const list2 = await agent.callTool('list_task_comments', { task_uid: taskUid });
      const all = parseToolJson<Array<{ kind: string }>>(list2.text);
      expect(all.filter((c) => c.kind === 'progress')).toHaveLength(2);
      expect(all.filter((c) => c.kind === 'question')).toHaveLength(1);
      expect(all.filter((c) => c.kind === 'blocker')).toHaveLength(1);
    } finally {
      await h.teardown();
    }
  });

  test('add_subtask creates a child task with parent_task_uid set', async () => {
    const h = await setupHarness('task-context-subtask');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-sub' });

      await agent.callTool('create_plan', {
        title: 'Sub plan',
        project_path: h.fixture.projectPath,
        tasks: [{ description: 'Parent task', scope_path: 'src/auth/' }],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Sub plan')!;
      const parentUid = (await h.client.getPlan(plan.uid)).tasks[0].uid;

      const sub = await agent.callTool('add_subtask', {
        parent_task_uid: parentUid,
        description: 'Validate inputs',
        body: 'Check email format before submit.',
        file_specs: [{ path: 'validate.ts', action: 'create' }],
      });
      expect(sub.isError).toBeFalsy();
      const subtask = parseToolJson<TaskJson>(sub.text);
      expect(subtask.parentTaskUid).toBe(parentUid);
      // scope_path should inherit from the parent when not overridden.
      expect(subtask.scopePath).toBe('src/auth/');
      expect(subtask.fileSpecs).toEqual([{ path: 'validate.ts', action: 'create' }]);

      // read_task_full on the parent shows the subtask.
      const full = await agent.callTool('read_task_full', { task_uid: parentUid });
      const parentFull = parseToolJson<{ subtasks: TaskJson[] }>(full.text);
      expect(parentFull.subtasks).toHaveLength(1);
      expect(parentFull.subtasks[0].uid).toBe(subtask.uid);
    } finally {
      await h.teardown();
    }
  });

  test('add_task_attachment (URL kind) + update_task with file_specs', async () => {
    const h = await setupHarness('task-context-attach-update');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-attach' });

      await agent.callTool('create_plan', {
        title: 'Attach plan',
        project_path: h.fixture.projectPath,
        tasks: [{ description: 'Implement feature' }],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Attach plan')!;
      const taskUid = (await h.client.getPlan(plan.uid)).tasks[0].uid;

      // Pin a URL.
      const att = await agent.callTool('add_task_attachment', {
        task_uid: taskUid,
        kind: 'url',
        value: 'https://design.example/spec',
        label: 'Design spec',
      });
      expect(att.isError).toBeFalsy();

      // update_task with body + prompt + scope_path + file_specs.
      const upd = await agent.callTool('update_task', {
        plan_uid: plan.uid,
        task_uid: taskUid,
        body: 'New body content',
        prompt: 'Implement the feature using the design spec',
        scope_path: 'packages/web/src/',
        file_specs: [
          { path: 'feature.ts', action: 'create' },
          { path: 'feature.test.ts', action: 'create' },
        ],
      });
      expect(upd.isError).toBeFalsy();

      const full = await agent.callTool('read_task_full', { task_uid: taskUid });
      const ctx = parseToolJson<{
        task: TaskJson;
        attachments: Array<{ kind: string; value: string; label?: string }>;
      }>(full.text);
      expect(ctx.task.body).toBe('New body content');
      expect(ctx.task.prompt).toBe('Implement the feature using the design spec');
      expect(ctx.task.scopePath).toBe('packages/web/src/');
      expect(ctx.task.fileSpecs).toHaveLength(2);
      expect(ctx.task.affectedFiles).toEqual(
        expect.arrayContaining(['feature.ts', 'feature.test.ts']),
      );
      expect(ctx.attachments).toHaveLength(1);
      expect(ctx.attachments[0].kind).toBe('url');
      expect(ctx.attachments[0].value).toBe('https://design.example/spec');
      expect(ctx.attachments[0].label).toBe('Design spec');
    } finally {
      await h.teardown();
    }
  });

  test('plan export YAML round-trips body / prompt / fileSpecs / attachments / comments', async () => {
    const h = await setupHarness('task-context-export-roundtrip');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-export' });

      // Build a richly-described plan via MCP.
      await agent.callTool('create_plan', {
        title: 'Export round-trip plan',
        project_path: h.fixture.projectPath,
        tasks: [
          {
            description: 'Rich task',
            body: 'Body text',
            prompt: 'Prompt text',
            scope_path: 'src/',
            file_specs: [{ path: 'a.ts', action: 'create' }],
          },
        ],
      });
      const plan = (await h.client.listPlans()).find((p) => p.title === 'Export round-trip plan')!;
      const taskUid = (await h.client.getPlan(plan.uid)).tasks[0].uid;

      // Add an attachment + a couple of comments.
      await agent.callTool('add_task_attachment', {
        task_uid: taskUid,
        kind: 'url',
        value: 'https://example.com/ref',
        label: 'Reference',
      });
      await agent.callTool('add_task_comment', {
        task_uid: taskUid,
        kind: 'note',
        body: 'Reminder: cover edge cases.',
      });
      await agent.callTool('update_task_progress', {
        task_uid: taskUid,
        percent: 33,
        message: 'A third of the way.',
      });

      // Export to disk.
      const exported = await h.client.exportPlan(plan.uid, h.fixture.projectPath);
      const taskFiles = fs
        .readdirSync(path.join(exported.planDir, 'tasks'))
        .filter((f) => f.endsWith('.yaml'));
      expect(taskFiles).toHaveLength(1);
      const yamlText = fs.readFileSync(
        path.join(exported.planDir, 'tasks', taskFiles[0]),
        'utf-8',
      );
      const parsed = yaml.parse(yamlText);
      expect(parsed.body).toBe('Body text');
      expect(parsed.prompt).toBe('Prompt text');
      expect(parsed.scopePath).toBe('src/');
      expect(parsed.fileSpecs).toEqual([{ path: 'a.ts', action: 'create' }]);
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].value).toBe('https://example.com/ref');
      expect(parsed.comments.length).toBeGreaterThanOrEqual(2);
      const kinds = parsed.comments.map((c: { kind: string }) => c.kind);
      expect(kinds).toContain('note');
      expect(kinds).toContain('progress');
      const progressComment = parsed.comments.find((c: { kind: string }) => c.kind === 'progress');
      expect(progressComment.metadata?.progressPercent).toBe(33);

      // Re-import (round-trip) — fields should survive.
      // Copy the exported dir aside FIRST (before the unlink wipes
      // it), then drop the in-DB plan, then re-import from the copy.
      const transitDir = path.join(h.fixture.tmpDir, 'plan-transit-14a');
      fs.cpSync(exported.planDir, transitDir, { recursive: true });
      await h.client.unlinkPlan(plan.uid, h.fixture.projectPath);
      await h.client.raw('DELETE', `/api/plans/${plan.uid}`);

      const reimported = await h.client.importPlan(transitDir);
      expect(reimported.plan.uid).toBe(plan.uid);
      const fresh = await h.client.getPlan(plan.uid);
      const t = fresh.tasks[0] as unknown as TaskJson;
      expect(t.body).toBe('Body text');
      expect(t.prompt).toBe('Prompt text');
      expect(t.scopePath).toBe('src/');
      expect(t.fileSpecs).toEqual([{ path: 'a.ts', action: 'create' }]);
      expect(t.progressPercent).toBe(33);
    } finally {
      await h.teardown();
    }
  });

  test('REST task-context endpoints (Phase 14 §B) round-trip the same way the MCP tools do', async () => {
    const h = await setupHarness('task-context-rest-mirror');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Build a plan with one rich task via REST.
      const plan = await h.client.createPlan({
        title: 'REST mirror plan',
        projectPath: h.fixture.projectPath,
      });
      const detail = await h.client.getPlan(plan.uid);
      // No tasks initially — append one with the new fields via REST.
      const taskRes = await h.client.raw('POST', `/api/plans/${plan.uid}/tasks`, {
        description: 'Implement feature',
        body: 'Why this matters',
        prompt: 'Run the implementation',
        scopePath: 'src/',
        fileSpecs: [{ path: 'feature.ts', action: 'create' }],
      });
      expect(taskRes.ok).toBe(true);
      const newTask = await taskRes.json();
      expect(newTask.body).toBe('Why this matters');
      expect(newTask.prompt).toBe('Run the implementation');
      expect(newTask.scopePath).toBe('src/');
      expect(newTask.fileSpecs).toEqual([{ path: 'feature.ts', action: 'create' }]);

      // /api/tasks/:taskUid/full
      const fullRes = await h.client.raw('GET', `/api/tasks/${newTask.uid}/full`);
      expect(fullRes.ok).toBe(true);
      const full = await fullRes.json();
      expect(full.task.uid).toBe(newTask.uid);
      expect(full.subtasks).toEqual([]);
      expect(full.attachments).toEqual([]);
      expect(full.comments).toEqual([]);

      // POST attachment
      const attRes = await h.client.raw('POST', `/api/tasks/${newTask.uid}/attachments`, {
        kind: 'url',
        value: 'https://example.com/spec',
        label: 'Spec link',
      });
      expect(attRes.ok).toBe(true);

      // POST comment
      const commentRes = await h.client.raw('POST', `/api/tasks/${newTask.uid}/comments`, {
        kind: 'note',
        body: 'A reminder.',
      });
      expect(commentRes.ok).toBe(true);

      // POST progress
      const progressRes = await h.client.raw('POST', `/api/tasks/${newTask.uid}/progress`, {
        percent: 42,
        message: 'Almost halfway',
      });
      expect(progressRes.ok).toBe(true);

      // POST blocked
      const blockedRes = await h.client.raw('POST', `/api/tasks/${newTask.uid}/blocked`, {
        reason: 'Need design approval',
      });
      expect(blockedRes.ok).toBe(true);

      // POST subtask
      const subRes = await h.client.raw('POST', `/api/tasks/${newTask.uid}/subtasks`, {
        description: 'Validate inputs',
      });
      expect(subRes.ok).toBe(true);

      // /full now contains everything
      const fullAfter = await (await h.client.raw('GET', `/api/tasks/${newTask.uid}/full`)).json();
      expect(fullAfter.task.status).toBe('blocked');
      expect(fullAfter.task.blockedReason).toBe('Need design approval');
      expect(fullAfter.task.progressPercent).toBe(42);
      expect(fullAfter.attachments).toHaveLength(1);
      expect(fullAfter.subtasks).toHaveLength(1);
      // Comments include the explicit note + auto-generated progress + auto-generated blocker.
      const commentKinds = (fullAfter.comments as Array<{ kind: string }>).map((c) => c.kind);
      expect(commentKinds).toEqual(expect.arrayContaining(['note', 'progress', 'blocker']));

      // Sanity: getPlan still returns the parent task with the new fields.
      const finalPlan = await h.client.getPlan(plan.uid);
      expect(finalPlan.tasks.length).toBe(2); // parent + subtask
      const parent = finalPlan.tasks.find((t: { uid: string }) => t.uid === newTask.uid)!;
      expect(parent.status).toBe('blocked');
      expect((parent as unknown as { progressPercent: number }).progressPercent).toBe(42);

      // Use original detail to ensure the test compiles even if listed.
      void detail;
    } finally {
      await h.teardown();
    }
  });

  test('lists every new tool in the MCP tool registry', async () => {
    const h = await setupHarness('task-context-tool-registry');
    try {
      const agent = await h.spawnAgent({ agentType: 'harness-tools' });
      const tools = await agent.mcp.listTools();
      const names = new Set(tools.map((t) => t.name));
      for (const expected of [
        'read_task_full',
        'list_task_comments',
        'add_task_comment',
        'update_task_progress',
        'set_task_blocked',
        'add_subtask',
        'add_task_attachment',
      ]) {
        expect(names.has(expected), `missing tool: ${expected}`).toBe(true);
      }
    } finally {
      await h.teardown();
    }
  });
});
