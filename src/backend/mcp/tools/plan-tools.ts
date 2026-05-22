/**
 * Plan management tools — CRUD, file sync, templates, import/export, comments.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta } from '../helpers';
import { buildPlanPrompt, buildItemPrompt } from '../prompt-builders';

export function register(server: McpServer, deps: ToolDeps): void {
  // --- Plan CRUD ---

  server.registerTool(
    'create_plan',
    {
      description: 'Create a new plan in CodeTrellis. Returns the plan UID. Use add_item or bulk_add_items to populate it with Objects (context pages) and Actions (work items).',
      inputSchema: {
        title: z.string().describe('Brief title of the plan'),
        description: z.string().optional().describe('Detailed description of what this plan achieves'),
        project_path: z.string().describe('Absolute path to the project this plan is for'),
      },
    },
    async ({ title, description, project_path }) => {
      const plan = deps.planService.createPlan(
        { title, description: description || '', tasks: [] },
        'agent', 'mcp', project_path,
      );
      const n = deps.broadcast('plan-created', { plan });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({
        uid: plan.uid, title: plan.title, status: plan.status, projectPath: plan.projectPath,
      }, n);
    },
  );

  server.registerTool(
    'get_plan',
    {
      description: 'Read a plan by its UID. Returns plan metadata and a summary of its items (count by kind, status breakdown). Use list_items to browse the item tree.',
      inputSchema: { plan_uid: z.string().describe('Plan UID') },
    },
    async ({ plan_uid }) => {
      const plan = deps.planService.getPlan(plan_uid);
      if (!plan) return { content: [{ type: 'text' as const, text: 'Plan not found' }] };
      const items = deps.planItemService.listItemSummaries(plan_uid);
      const objectCount = items.filter((i: any) => i.kind === 'object').length;
      const actionCount = items.filter((i: any) => i.kind === 'action').length;
      const statusCounts: Record<string, number> = {};
      for (const i of items) {
        if ((i as any).status) statusCounts[(i as any).status] = (statusCounts[(i as any).status] || 0) + 1;
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        uid: plan.uid, title: plan.title, description: plan.description,
        status: plan.status, projectPath: plan.projectPath,
        createdAt: plan.createdAt, updatedAt: plan.updatedAt,
        items: { total: items.length, objects: objectCount, actions: actionCount, byStatus: statusCounts },
      }, null, 2) }] };
    },
  );

  server.registerTool(
    'update_plan',
    {
      description: 'Update a plan (title, description, or status). Creates a new version snapshot.',
      inputSchema: {
        plan_uid: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['draft', 'review', 'approved', 'in_progress', 'completed', 'archived']).optional(),
      },
    },
    async ({ plan_uid, title, description, status }) => {
      deps.planService.updatePlan(plan_uid, { title, description, status }, 'agent');
      const n = deps.broadcast('plan-updated', { planUid: plan_uid });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid }, n);
    },
  );

  server.registerTool(
    'list_plans',
    {
      description: 'List plans, optionally filtered by project path or status. Returns lightweight summaries with V2 item counts. Use limit/offset for pagination.',
      inputSchema: {
        project_path: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Max plans to return (default 20)'),
        offset: z.number().int().min(0).optional().describe('Skip this many plans (default 0)'),
      },
    },
    async ({ project_path, status, limit, offset }) => {
      const all = deps.planService.listPlans(project_path, status);
      const start = offset ?? 0;
      const end = start + (limit ?? 20);
      const page = all.slice(start, end);
      const summaries = page.map((p: any) => ({
        uid: p.uid, title: p.title, status: p.status, projectPath: p.projectPath,
        itemCount: deps.planItemService.listItemSummaries(p.uid).length,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        total: all.length, offset: start, limit: limit ?? 20, plans: summaries,
      }, null, 2) }] };
    },
  );

  server.registerTool(
    'delete_plan',
    {
      description: 'Delete (archive) a plan from CodeTrellis. Removes it from the plan list. Use list_plans first to find the uid.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to delete'),
      },
    },
    async ({ plan_uid }) => {
      deps.planService.deletePlan(plan_uid);
      const n = deps.broadcast('plan-deleted', { planUid: plan_uid });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid }, n);
    },
  );

  server.registerTool(
    'bulk_delete_plans',
    {
      description: 'Delete multiple plans at once. Useful for cleaning up test/demo plans. Pass "all" to delete every plan, or a list of uids.',
      inputSchema: {
        plan_uids: z.union([
          z.literal('all'),
          z.array(z.string()),
        ]).describe('"all" to delete every plan, or an array of plan UIDs to delete'),
      },
    },
    async ({ plan_uids }) => {
      let uids: string[];
      if (plan_uids === 'all') {
        const allPlans = deps.planService.listPlans();
        uids = allPlans.map((p: any) => p.uid);
      } else {
        uids = plan_uids;
      }
      let deleted = 0;
      let lastN = 0;
      for (const uid of uids) {
        try {
          deps.planService.deletePlan(uid);
          lastN = deps.broadcast('plan-deleted', { planUid: uid });
          deleted++;
        } catch {
          // skip plans that don't exist
        }
      }
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, deleted }, lastN);
    },
  );

  // Legacy tool — kept for backward compatibility
  server.registerTool(
    'report_plan',
    {
      description: '[Legacy] Report a plan. Creates plan metadata and V2 Actions for each step. Prefer create_plan + bulk_add_items.',
      inputSchema: {
        title: z.string(),
        steps: z.array(z.object({
          description: z.string(),
          files: z.array(z.string()).optional(),
        })),
      },
    },
    async ({ title, steps }) => {
      const plan = deps.planService.createPlan(
        { title, description: '', tasks: [] },
        'agent', 'mcp', '',
      );
      for (const step of steps) {
        deps.planItemService.createItem({
          planUid: plan.uid,
          kind: 'action',
          parentUid: null,
          title: step.description,
          body: '',
          template: null,
          status: 'pending',
          scopePath: null,
          fileSpecs: step.files?.map((f) => ({ path: f, action: 'modify' as const })),
          author: 'agent',
          authorType: 'mcp',
        });
      }
      const n = deps.broadcast('plan-created', { plan });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ uid: plan.uid, title, steps: steps.length }, n);
    },
  );

  // --- Plan File Sync ---

  server.registerTool(
    'export_plan_to_files',
    {
      description: 'Round-trip a plan to disk as YAML under `<projectRoot>/.codetrellis/plans/<slug>/`. Plans with V2 items export a nested `items/` tree (version 2); legacy plans export the old phases/tasks/docs layout. Idempotent — re-exporting overwrites the same files. Use this so plans can be committed to git and shared across devices / agents.',
      inputSchema: {
        plan_uid: z.string(),
        project_root: z.string().describe('Absolute path to the project repo root. The .codetrellis/ directory will be created inside it.'),
      },
    },
    async ({ plan_uid, project_root }) => {
      try {
        const result = deps.planFileService.exportPlan(plan_uid, project_root);
        deps.broadcast('plan-exported', { planUid: plan_uid, planDir: result.planDir, files: result.files.length });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ planDir: result.planDir, fileCount: result.files.length }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.registerTool(
    'import_plan_from_files',
    {
      description: 'Read a plan directory (`.codetrellis/plans/<slug>/`) from disk and upsert it into the DB. Detects V2 format (version:2 or items/ directory) automatically — V2 imports create plan_items, V1 imports create legacy tasks/phases/docs. UID-based upsert is idempotent. Use after `git pull` to sync external changes.',
      inputSchema: {
        plan_dir: z.string().describe('Absolute path to the plan directory (or directly to plan.yaml).'),
      },
    },
    async ({ plan_dir }) => {
      try {
        const result = deps.planFileService.importPlan(plan_dir);
        deps.broadcast('plan-imported', { planUid: result.plan.uid, source: plan_dir });
        if (result.version === 2) {
          for (const item of result.items) {
            deps.broadcast('plan-item-created', { item });
          }
        }
        deps.saveNow(() => deps.exportDatabase());
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              plan: { uid: result.plan.uid, title: result.plan.title },
              version: result.version,
              ...(result.version === 2
                ? { itemCount: result.items.length }
                : { phaseCount: result.phases.length, taskCount: result.tasks.length, docCount: result.docs.length }),
              warnings: result.warnings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.registerTool(
    'discover_plan_files',
    {
      description: 'List every plan directory under `<project_root>/.codetrellis/plans/`. Used to find plans that came in via `git pull` or that another tool authored. Returns absolute paths.',
      inputSchema: { project_root: z.string() },
    },
    async ({ project_root }) => {
      const dirs = deps.planFileService.discoverPlanDirs(project_root);
      return { content: [{ type: 'text' as const, text: JSON.stringify(dirs, null, 2) }] };
    },
  );

  server.registerTool(
    'unlink_plan_from_files',
    {
      description: 'Remove a plan\'s on-disk directory under `.codetrellis/plans/<slug>/`. The DB rows survive — this is the "Shared → Local" toggle. Use this to stop write-through-syncing a plan to the project repo (e.g. for a private brainstorm you don\'t want committed).',
      inputSchema: {
        plan_uid: z.string(),
        project_root: z.string(),
      },
    },
    async ({ plan_uid, project_root }) => {
      try {
        const result = deps.planFileService.unlinkPlan(plan_uid, project_root);
        deps.broadcast('plan-unlinked', { planUid: plan_uid });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // --- Plan Templates ---

  server.registerTool(
    'publish_plan_as_template',
    {
      description: 'Snapshot a plan as a reusable template under `<project_root>/.codetrellis/templates/<template_id>/`. Plans with V2 items produce a template with a nested `items` tree; legacy plans produce the old phases/docs shape. Strips runtime fields (statuses, assignees). The result can be shared via git.',
      inputSchema: {
        plan_uid: z.string(),
        project_root: z.string(),
        template_id: z.string().describe('Lowercase slug, alphanumeric + hyphens (e.g. "company-mass-refactor").'),
        label: z.string().optional().describe('Human-readable name shown in the picker. Defaults to the plan title.'),
        short_description: z.string().optional(),
        long_description: z.string().optional(),
        default_title: z.string().optional().describe('Default plan title when the template is applied. May contain `{{name}}` etc. for placeholder substitution.'),
        default_plan_description: z.string().optional(),
      },
    },
    async ({ plan_uid, project_root, template_id, label, short_description, long_description, default_title, default_plan_description }) => {
      try {
        const result = deps.publishPlanAsTemplate({
          planUid: plan_uid,
          projectRoot: project_root,
          templateId: template_id,
          label,
          shortDescription: short_description,
          longDescription: long_description,
          defaultTitle: default_title,
          defaultPlanDescription: default_plan_description,
        });
        deps.broadcast('plan-template-published', { templateId: template_id, templateDir: result.templateDir });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.registerTool(
    'list_plan_templates',
    {
      description: 'List the available plan templates. Includes built-ins, user-global templates from `~/.codetrellis/templates/`, and project-local templates from `<project_root>/.codetrellis/templates/` when project_root is provided. Each template seeds a plan + phases + spec docs in one go.',
      inputSchema: {
        project_root: z.string().optional().describe('Project root for picking up team-published templates from `.codetrellis/templates/`. Optional — without it, only built-ins + user-global templates are returned.'),
      },
    },
    async ({ project_root }) => {
      return { content: [{ type: 'text' as const, text: JSON.stringify(deps.listTemplates(project_root), null, 2) }] };
    },
  );

  server.registerTool(
    'create_plan_from_template',
    {
      description: 'Create a new plan from a template in one call. V2 templates (with items tree) create V2 plan_items directly; legacy templates create phases + docs. Use list_plan_templates to pick a template_id. Pass `placeholder_values` for templates with `{{key}}` placeholders.',
      inputSchema: {
        template_id: z.string().describe('e.g. "mass-refactor"'),
        project_path: z.string(),
        title: z.string().optional().describe('Override the template default title'),
        description: z.string().optional().describe('Override the template default description'),
        placeholder_values: z.record(z.string(), z.string()).optional().describe('Values for `{{key}}` placeholders declared by the template (Phase 13 §C). Missing keys fall back to the placeholder default.'),
      },
    },
    async ({ template_id, project_path, title, description, placeholder_values }, extra: any) => {
      const sessions = deps.sessionService.getActiveSessions();
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const session = sessionId ? sessions.find((s: any) => s.sessionId === sessionId) : null;
      const author = (session as any)?.agentType ?? 'agent';

      try {
        const result = deps.applyTemplate({
          templateId: template_id,
          projectPath: project_path,
          title,
          description,
          author,
          authorType: 'mcp',
          placeholderValues: placeholder_values,
        });
        deps.broadcast('plan-created', { plan: result.plan });
        if (result.version === 2) {
          for (const item of result.items) deps.broadcast('plan-item-created', { item });
        } else {
          for (const phase of result.phases) deps.broadcast('plan-phase-created', { phase });
          for (const doc of result.docs) deps.broadcast('plan-doc-created', { doc });
        }
        deps.saveNow(() => deps.exportDatabase());
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              plan: result.plan,
              version: result.version,
              ...(result.version === 2
                ? { itemCount: result.items.length, hint: 'Use list_items(plan_uid) to browse the plan tree.' }
                : { phaseCount: result.phases.length, docCount: result.docs.length, taskCount: result.tasks.length }),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to apply template: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  // --- Import / Export ---

  server.registerTool(
    'import_external',
    {
      description:
        'Import a plan from external text — a conversation transcript, markdown notes, ' +
        'GitHub issue body, or any structured text. Extracts action items, file references, ' +
        'and creates a plan with items automatically. Good for turning chat discussions or ' +
        'issue descriptions into actionable CodeTrellis plans.',
      inputSchema: {
        text: z.string().describe('The text content to import (markdown, conversation, issue body, etc.).'),
        title: z.string().optional().describe('Optional title for the new plan. Auto-generated if omitted.'),
      },
    },
    async ({ text, title }) => {
      try {
        const result = deps.planImportService.importFromConversation({ text, title });

        const plan = deps.planService.createPlan(
          { title: result.title, description: result.description, tasks: [] },
          'mcp-agent', 'mcp', '',
        );

        let itemCount = 0;
        for (const imported of result.items) {
          deps.planItemService.createItem({
            planUid: plan.uid,
            kind: imported.kind,
            title: imported.title,
            body: imported.body,
            fileSpecs: imported.fileSpecs,
            scopePath: imported.scopePath,
            author: 'mcp-agent',
            authorType: 'mcp',
          });
          itemCount++;
        }

        deps.broadcast('plan-imported', { planUid: plan.uid, source: 'mcp-import' });
        return {
          content: [{
            type: 'text' as const,
            text: `Imported plan "${plan.title}" (${plan.uid}) with ${itemCount} items`,
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Import failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'copy_plan_as_prompt',
    {
      description:
        'Serialise a plan (or a single item) as a markdown prompt suitable for handing off to an AI agent. ' +
        'Returns the formatted prompt text that includes tasks, file targets, constraints, and git context. ' +
        'Equivalent to the "Copy as prompt" handoff button in the UI.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to serialise.'),
        item_uid: z.string().optional().describe('If provided, serialise only this item instead of the full plan.'),
      },
    },
    async ({ plan_uid, item_uid }) => {
      const plan = deps.planService.getPlan(plan_uid);
      if (!plan) {
        return { content: [{ type: 'text' as const, text: `Plan ${plan_uid} not found` }], isError: true };
      }

      const items = deps.planItemService.listAllItems(plan_uid);

      if (item_uid) {
        const item = items.find((i: any) => i.uid === item_uid);
        if (!item) {
          return { content: [{ type: 'text' as const, text: `Item ${item_uid} not found in plan ${plan_uid}` }], isError: true };
        }
        const prompt = buildItemPrompt(item, plan);
        return { content: [{ type: 'text' as const, text: prompt }] };
      }

      const refs = deps.externalRefsService.getExternalRefsByPlan(plan_uid);
      const prompt = buildPlanPrompt(plan, items, refs);
      return { content: [{ type: 'text' as const, text: prompt }] };
    },
  );

  // --- Legacy Comment Tools ---

  server.registerTool(
    'add_comment',
    {
      description: 'Leave a comment on a plan or task. Use this to communicate with the user or other agents.',
      inputSchema: {
        target_uid: z.string().describe('Plan UID or Task UID to comment on'),
        body: z.string().describe('Comment text (markdown supported)'),
        comment_type: z.enum(['comment', 'suggestion', 'approval', 'concern', 'status_update']).optional(),
        parent_uid: z.string().optional().describe('Parent comment UID for threading'),
      },
    },
    async ({ target_uid, body, comment_type, parent_uid }) => {
      const comment = deps.commentService.addComment('plan', target_uid, 'agent', 'mcp', body, comment_type || 'comment', parent_uid);
      deps.broadcast('comment-added', { comment });
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Comment added to ${target_uid}` }] };
    },
  );

  server.registerTool(
    'get_comments',
    {
      description: 'Read all comments on a plan or task.',
      inputSchema: { target_uid: z.string() },
    },
    async ({ target_uid }) => {
      const comments = deps.commentService.getComments(target_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }] };
    },
  );
}
