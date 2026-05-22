/**
 * Drift & deviation tools — detect, reconcile, proposed changes, checkpoints.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_deviations',
    {
      description: 'Get all deviations between a plan and the actual codebase state. Shows where reality diverges from the plan.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const devs = deps.getDeviations(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(devs, null, 2) }] };
    },
  );

  server.registerTool(
    'reconcile',
    {
      description: 'Resolve deviations from a plan. Accept (update plan to match), revert (flag for review), or ignore.',
      inputSchema: {
        plan_uid: z.string(),
        deviations: z.array(z.object({
          id: z.number(),
          action: z.enum(['accepted', 'reverted', 'ignored']),
        })),
      },
    },
    async ({ plan_uid, deviations }) => {
      for (const d of deviations) {
        deps.resolveDeviation(d.id, d.action);
      }
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Resolved ${deviations.length} deviations for plan ${plan_uid}` }] };
    },
  );

  server.registerTool(
    'detect_deviations',
    {
      description: 'Run deviation detection for a plan — compares plan expectations against actual codebase state.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const devs = deps.detectDeviations(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ detected: devs.length, deviations: devs }, null, 2) }] };
    },
  );

  server.registerTool(
    'list_proposed_changes',
    {
      description: 'Granular CRUD feed projected from a plan\'s tasks: every affected file, symbol_spec, new_connection, and removed_connection becomes one ProposedChange row with operation (add/modify/remove/move), kind (file/symbol/connection), target, and a drift status (planned / in_progress / satisfied / missing / unexpected). Use this instead of walking task fields by hand to ask "what\'s left in this plan?".',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const changes = deps.planChangesService.listProposedChanges(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(changes, null, 2) }] };
    },
  );

  server.registerTool(
    'get_changes_summary',
    {
      description: 'Aggregate counts for a plan\'s proposed changes — total + breakdown by drift status, kind, and operation. Use this to get a one-line "12/18 satisfied" picture without pulling every change row.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const summary = deps.planChangesService.summarizeChanges(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.registerTool(
    'get_change_status',
    {
      description: 'Fetch a single ProposedChange (by id from list_proposed_changes) with its current drift status freshly computed against the live database.',
      inputSchema: {
        plan_uid: z.string(),
        change_id: z.string(),
      },
    },
    async ({ plan_uid, change_id }) => {
      const change = deps.planChangesService.getChange(plan_uid, change_id);
      if (!change) return { content: [{ type: 'text' as const, text: `Change ${change_id} not found in plan ${plan_uid}` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(change, null, 2) }] };
    },
  );

  server.registerTool(
    'get_drift_report',
    {
      description:
        'Check if you are still following the plan. Compares the baseline snapshot (captured at plan approval) against the current live state. Returns what has changed, what is on track, and what has drifted. Phase 14 §A also surfaces task comment activity since `since_ms` (or since the baseline snapshot when omitted) so a returning agent can see what humans / other agents have said while it was away.',
      inputSchema: {
        plan_uid: z.string(),
        since_ms: z.number().int().optional().describe('Epoch ms cutoff for "comment activity since". Defaults to the baseline snapshot timestamp.'),
      },
    },
    async ({ plan_uid, since_ms }) => {
      const snapshots = deps.listSnapshots(plan_uid);
      if (snapshots.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No baseline snapshot found for this plan. Approve the plan first to capture a baseline.' }] };
      }
      const diff = deps.computeTrellisDiff(snapshots[0].id);
      if (!diff) {
        return { content: [{ type: 'text' as const, text: 'Could not compute diff.' }] };
      }

      const plan = deps.planService.getPlan(plan_uid);
      const items = deps.planItemService.listItemSummaries(plan_uid);
      const v2Actions = items.filter((i: any) => i.kind === 'action');
      const completedItems = v2Actions.filter((i: any) => i.status === 'done').length;
      const totalItems = v2Actions.length;
      const completedTasks = totalItems > 0 ? completedItems : (plan?.tasks.filter((t: any) => t.status === 'done').length || 0);
      const totalTasks = totalItems > 0 ? totalItems : (plan?.tasks.length || 0);

      const since = since_ms ?? snapshots[0].createdAt;
      const recentComments = deps.commentService.listCommentsForPlanSince(plan_uid, since);
      const blockers = recentComments.filter((c: any) => c.kind === 'blocker');
      const questions = recentComments.filter((c: any) => c.kind === 'question');
      const progressUpdates = recentComments.filter((c: any) => c.kind === 'progress');

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        planTitle: plan?.title,
        taskProgress: `${completedTasks}/${totalTasks}`,
        filesChanged: diff.addedFiles.length + diff.modifiedFiles.length,
        addedFiles: diff.addedFiles,
        modifiedFiles: diff.modifiedFiles,
        removedFiles: diff.removedFiles,
        addedEdges: diff.addedEdges.length,
        removedEdges: diff.removedEdges.length,
        commentActivitySince: since,
        commentSummary: {
          total: recentComments.length,
          blockers: blockers.length,
          questions: questions.length,
          progressUpdates: progressUpdates.length,
        },
        recentBlockers: blockers,
        recentQuestions: questions,
      }, null, 2) }] };
    },
  );

  server.registerTool(
    'capture_checkpoint',
    {
      description: 'Create a named checkpoint of the current codebase state. Useful for marking progress during long plans.',
      inputSchema: {
        plan_uid: z.string(),
        name: z.string().describe('Name for this checkpoint, e.g. "After task 3"'),
        project_path: z.string(),
      },
    },
    async ({ plan_uid, name, project_path }) => {
      const snapshot = deps.captureCurrentTrellis(project_path, plan_uid, name);
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Checkpoint "${name}" captured (snapshot #${snapshot.id}, ${snapshot.filesJson ? JSON.parse(snapshot.filesJson).length : 0} files)` }] };
    },
  );
}
