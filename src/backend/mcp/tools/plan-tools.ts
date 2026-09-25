/**
 * Plan management tools — CRUD, file sync, templates, import/export, comments.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta } from '../helpers';
import { buildPlanPrompt, buildItemPrompt } from '../prompt-builders';
import { getActiveProjectRoot } from '../../services/trusted-roots';

export function register(server: McpServer, deps: ToolDeps): void {
  // --- Plan CRUD ---

  server.registerTool(
    'create_plan',
    {
      description:
        'Create a new plan in CodeTrellis. Returns the plan UID. ' +
        'Use add_item or bulk_add_items to populate it with Objects (context pages) and Actions (work items). ' +
        'The new plan is auto-exported to .codetrellis/plans/<slug>/ on disk when the effective default ' +
        'visibility is "shared" (see get_project_config). When "local", it stays DB-only and you can later ' +
        'export it explicitly with export_plan_to_files.',
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

      // Bugfix D: honour effective default visibility — when 'shared',
      // export immediately so the plan rides in git from creation. When
      // 'local', stay DB-only.
      let exported = false;
      try {
        const visibility = deps.projectConfigService.getEffectiveDefaultVisibility(project_path);
        if (visibility === 'shared') {
          deps.planFileService.exportPlan(plan.uid, project_path);
          exported = true;
        }
      } catch (err) {
        console.warn(`[create_plan] Auto-export failed for ${plan.uid}:`, err);
      }

      const n = deps.broadcast('plan-created', { plan, exported });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({
        uid: plan.uid, title: plan.title, status: plan.status, projectPath: plan.projectPath, exported,
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
      description: 'List plans, optionally filtered by project path or status. Returns lightweight summaries with item counts. Use limit/offset for pagination.',
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
      const plan = deps.planService.getPlan(plan_uid);
      deps.planService.deletePlan(plan_uid);
      // Clean up disk files (parity with REST DELETE /api/plans/:uid)
      let diskRemoved = false;
      if (plan?.projectPath) {
        try {
          const result = deps.planFileService.unlinkPlan(plan_uid, plan.projectPath);
          diskRemoved = result.removed;
        } catch { /* best-effort */ }
      }
      const n = deps.broadcast('plan-deleted', { planUid: plan_uid });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid, diskRemoved }, n);
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
          const plan = deps.planService.getPlan(uid);
          deps.planService.deletePlan(uid);
          // Clean up disk files (parity with REST POST /api/plans/bulk-delete)
          if (plan?.projectPath) {
            try { deps.planFileService.unlinkPlan(uid, plan.projectPath); } catch { /* best-effort */ }
          }
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

  // --- Plan File Sync ---

  server.registerTool(
    'export_plan_to_files',
    {
      description: 'Round-trip a plan to disk as YAML under `<projectRoot>/.codetrellis/plans/<slug>/`. Exports a nested `items/` tree layout. Idempotent — re-exporting overwrites the same files. Use this so plans can be committed to git and shared across devices / agents.',
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
      description: 'Read a plan directory (`.codetrellis/plans/<slug>/`) from disk and upsert it into the DB. Detects format automatically. UID-based upsert is idempotent. Use after `git pull` to sync external changes.',
      inputSchema: {
        plan_dir: z.string().describe('Absolute path to the plan directory (or directly to plan.yaml).'),
      },
    },
    async ({ plan_dir }) => {
      try {
        const result = deps.planFileService.importPlan(plan_dir);
        deps.broadcast('plan-imported', { planUid: result.plan.uid, source: plan_dir });
        if (result.items) {
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
              itemCount: result.items?.length ?? 0,
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
      description: 'Snapshot a plan as a reusable template under `<project_root>/.codetrellis/templates/<template_id>/`. Produces a template with a nested items tree. Strips runtime fields (statuses, assignees). The result can be shared via git.',
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
      description: 'List the available plan templates. Includes built-ins, user-global templates from `~/.codetrellis/templates/`, and project-local templates from `<project_root>/.codetrellis/templates/` when project_root is provided. Each template seeds a full plan tree in one go.',
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
      description: 'Create a new plan from a template in one call. Use list_plan_templates to pick a template_id. Pass `placeholder_values` for templates with `{{key}}` placeholders.',
      inputSchema: {
        template_id: z.string().describe('e.g. "mass-refactor"'),
        project_path: z.string(),
        title: z.string().optional().describe('Override the template default title'),
        description: z.string().optional().describe('Override the template default description'),
        placeholder_values: z.record(z.string(), z.string()).optional().describe('Values for `{{key}}` placeholders declared by the template (Phase 13 §C). Missing keys fall back to the placeholder default.'),
      },
    },
    async ({ template_id, project_path, title, description, placeholder_values }) => {
      const sessions = deps.sessionService.getActiveSessions();
      const session = sessions.find((s: any) => s.sessionId === deps.sessionId) ?? null;
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

        // Bugfix D: same auto-export rule as create_plan.
        let exported = false;
        try {
          const visibility = deps.projectConfigService.getEffectiveDefaultVisibility(project_path);
          if (visibility === 'shared') {
            deps.planFileService.exportPlan(result.plan.uid, project_path);
            exported = true;
          }
        } catch (err) {
          console.warn(`[create_plan_from_template] Auto-export failed for ${result.plan.uid}:`, err);
        }

        deps.broadcast('plan-created', { plan: result.plan, exported });
        if (result.items) {
          for (const item of result.items) deps.broadcast('plan-item-created', { item });
        }
        deps.saveNow(() => deps.exportDatabase());
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              plan: result.plan,
              itemCount: result.items?.length ?? 0,
              exported,
              hint: 'Use list_items(plan_uid) to browse the plan tree.',
            }, null, 2),
          }],
        };
      } catch (err) {
        // A failure is an error. Returned plain, an agent (or the demo) read
        // "Failed to apply template" as a successful call with odd text.
        return { content: [{ type: 'text' as const, text: `Failed to apply template: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
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
        project_path: z.string().optional().describe(
          'Absolute path to the project this plan belongs to. Defaults to the project currently open.',
        ),
      },
    },
    async ({ text, title, project_path }) => {
      try {
        const result = deps.planImportService.importFromConversation({ text, title });

        // Same defect as `create_plan_from_external`: a plan imported from
        // text belongs to the project you are in, not to nowhere.
        const plan = deps.planService.createPlan(
          { title: result.title, description: result.description, tasks: [] },
          'mcp-agent', 'mcp', project_path ?? getActiveProjectRoot() ?? '',
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

  // ───────────────────────────────────────────────────────────────────
  // Phase 3.3 — Cross-repo plan scope + pointer files
  //
  // A plan can be "in scope" for multiple repos. The plan's home repo
  // is captured automatically at create_plan time (its origin URL).
  // Other participating repos can be added via add_plan_scope; each
  // scoped repo gets a thin pointer file written to
  //   <repoRoot>/.codetrellis/external/<plan-uid>.yaml
  // so a developer cloning just that repo sees the plan exists.
  // ───────────────────────────────────────────────────────────────────

  server.registerTool(
    'set_plan_home_repo',
    {
      description:
        'Set the home repo of a plan to a normalised git origin URL. ' +
        'The home repo is captured automatically at create_plan from the project\'s git origin — call this only when ' +
        'you need to override it (e.g. moving a plan between repos, or attaching a previously-orphaned plan). ' +
        'Pass an empty string to clear.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to update'),
        home_repo_url: z.string().describe('Git origin URL — will be normalised. Empty string clears.'),
      },
    },
    async ({ plan_uid, home_repo_url }) => {
      const trimmed = home_repo_url.trim();
      deps.planService.setPlanHomeRepo(plan_uid, trimmed === '' ? null : trimmed);
      const plan = deps.planService.getPlan(plan_uid);
      const n = deps.broadcast('plan-updated', { planUid: plan_uid });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid, homeRepo: plan?.homeRepo ?? null }, n);
    },
  );

  server.registerTool(
    'add_plan_scope',
    {
      description:
        'Add a repository (by git origin URL) to a plan\'s cross-repo scope. ' +
        'When `pointer_project_root` is supplied AND it\'s a clone of the scoped repo on this machine, ' +
        'a pointer file is written to <pointer_project_root>/.codetrellis/external/<plan-uid>.yaml so ' +
        'developers cloning that repo discover the plan. The pointer caches a snapshot of title/status/summary; ' +
        'it round-trips through git. Returns the updated scope list.',
      inputSchema: {
        plan_uid: z.string(),
        repo_url: z.string().describe('Git origin URL of the participating repo — will be normalised'),
        pointer_project_root: z.string().optional().describe('Absolute path on this machine where the pointer file should be written. Skip when not locally available.'),
        contribution: z.string().optional().describe('Short note describing this repo\'s contribution to the plan (e.g. "ships the migration").'),
        summary: z.string().optional().describe('Short prose summary cached into the pointer; defaults to the plan\'s description.'),
      },
    },
    async ({ plan_uid, repo_url, pointer_project_root, contribution, summary }) => {
      const plan = deps.planService.getPlan(plan_uid);
      if (!plan) {
        return { content: [{ type: 'text' as const, text: `Plan ${plan_uid} not found` }], isError: true };
      }
      const scope = deps.planService.addPlanScope(plan_uid, repo_url);

      let pointerPath: string | null = null;
      if (pointer_project_root) {
        try {
          pointerPath = deps.externalPointerService.writePointer({
            planUid: plan_uid,
            projectRoot: pointer_project_root,
            homeRepo: plan.homeRepo ?? '',
            title: plan.title,
            status: plan.status,
            summary: summary ?? plan.description ?? undefined,
            contribution,
          });
        } catch (err) {
          console.warn('[add_plan_scope] pointer write failed:', err);
        }
      }

      const n = deps.broadcast('plan-scope-changed', { planUid: plan_uid, scope, added: repo_url, pointerPath });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid, scope, pointerPath }, n);
    },
  );

  server.registerTool(
    'remove_plan_scope',
    {
      description:
        'Remove a repo from a plan\'s scope. When `pointer_project_root` is supplied, also delete the pointer file ' +
        'at <pointer_project_root>/.codetrellis/external/<plan-uid>.yaml so the scoped repo stops advertising the plan.',
      inputSchema: {
        plan_uid: z.string(),
        repo_url: z.string(),
        pointer_project_root: z.string().optional().describe('Absolute path of the scoped repo on this machine — pointer is removed when supplied.'),
      },
    },
    async ({ plan_uid, repo_url, pointer_project_root }) => {
      const scope = deps.planService.removePlanScope(plan_uid, repo_url);
      let pointerRemoved = false;
      if (pointer_project_root) {
        pointerRemoved = deps.externalPointerService.removePointer(plan_uid, pointer_project_root);
      }
      const n = deps.broadcast('plan-scope-changed', { planUid: plan_uid, scope, removed: repo_url, pointerRemoved });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid, scope, pointerRemoved }, n);
    },
  );

  server.registerTool(
    'list_plan_pointers',
    {
      description:
        'List every external plan pointer found under <project_path>/.codetrellis/external/. ' +
        'Each entry is a thin reference to a plan whose home is another repo — title/status/summary/contribution ' +
        'are cached at the last refresh. Use this to surface "plans from other repos that touch this one" in the UI.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root'),
      },
    },
    async ({ project_path }) => {
      const pointers = deps.externalPointerService.discoverPointers(project_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        projectPath: project_path,
        count: pointers.length,
        pointers: pointers.map((p) => ({ filePath: p.filePath, ...p.pointer })),
      }, null, 2) }] };
    },
  );

  server.registerTool(
    'list_plans_by_repo',
    {
      description:
        'Return every active plan whose home_repo OR scope contains the given git origin URL. ' +
        'Cross-machine safe — URLs are normalised before matching. Useful for "show me every plan that touches this repo" in cross-repo views.',
      inputSchema: {
        repo_url: z.string().describe('Git origin URL — will be normalised before matching'),
      },
    },
    async ({ repo_url }) => {
      const plans = deps.planService.listPlansByRepoUrl(repo_url);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        repoUrl: repo_url,
        count: plans.length,
        plans: plans.map((p) => ({
          uid: p.uid, title: p.title, status: p.status, homeRepo: p.homeRepo,
          scope: p.scope, taskCount: p.taskCount, completedTaskCount: p.completedTaskCount,
          projectPath: p.projectPath,
        })),
      }, null, 2) }] };
    },
  );

}
