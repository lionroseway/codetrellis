/**
 * Drift & deviation tools — detect, reconcile, proposed changes, checkpoints.
 */

import { z } from 'zod';
import fs from 'node:fs';
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
      description: 'Granular CRUD feed projected from a plan\'s Actions: every affected file, symbol_spec, new_connection, and removed_connection becomes one ProposedChange row with operation (add/modify/remove/move), kind (file/symbol/connection), target, and a drift status (planned / in_progress / satisfied / missing / unexpected). Use this instead of walking item fields by hand to ask "what\'s left in this plan?".',
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
        'Check if you are still following the plan. Compares the baseline snapshot (captured at plan approval) against the current live state. Returns what has changed, what is on track, and what has drifted. Also surfaces comment activity since `since_ms` (or since the baseline snapshot when omitted) so a returning agent can see what humans / other agents have said while it was away.',
      inputSchema: {
        plan_uid: z.string(),
        since_ms: z.number().int().optional().describe('Epoch ms cutoff for "comment activity since". Defaults to the baseline snapshot timestamp.'),
      },
    },
    async ({ plan_uid, since_ms }) => {
      const plan = deps.planService.getPlan(plan_uid);
      const projectPath = plan?.projectPath ?? process.cwd();

      // ── Plan-aware classification (primary source of truth) ────
      // plan-changes-service reads the live DB + does suffix matching,
      // giving us granular per-change drift status.
      const changesSummary = deps.planChangesService.summarizeChanges(plan_uid);
      const proposedChanges = deps.planChangesService.listProposedChanges(plan_uid);

      // Build on-track / unexpected / missing from proposed changes
      const onTrack = proposedChanges
        .filter((c) => c.driftStatus === 'satisfied')
        .map((c) => c.target);
      const inProgress = proposedChanges
        .filter((c) => c.driftStatus === 'in_progress')
        .map((c) => c.target);
      const missingChanges = proposedChanges
        .filter((c) => c.driftStatus === 'missing')
        .map((c) => c.target);
      const planned = proposedChanges
        .filter((c) => c.driftStatus === 'planned')
        .map((c) => c.target);

      // ── Snapshot diff (supplementary — what changed since baseline)
      const snapshots = deps.listSnapshots(plan_uid);
      let snapshotDiff: { addedFiles: string[]; modifiedFiles: string[]; removedFiles: string[]; addedEdges: number; removedEdges: number } | null = null;
      if (snapshots.length > 0) {
        const rawDiff = deps.computeTrellisDiff(snapshots[0].id);
        if (rawDiff) {
          // Filter out phantom entries — files the DB thinks exist but
          // the filesystem says are gone (stale watcher state).
          const freshAdded = rawDiff.addedFiles.filter((f) => {
            const abs = f.startsWith('/') ? f : `${projectPath}/${f}`;
            return fs.existsSync(abs);
          });
          const freshModified = rawDiff.modifiedFiles.filter((f) => {
            const abs = f.startsWith('/') ? f : `${projectPath}/${f}`;
            return fs.existsSync(abs);
          });
          snapshotDiff = {
            addedFiles: freshAdded,
            modifiedFiles: freshModified,
            removedFiles: rawDiff.removedFiles,
            addedEdges: rawDiff.addedEdges.length,
            removedEdges: rawDiff.removedEdges.length,
          };
        }
      }

      // Unexpected files: in the snapshot diff but not in any plan item
      const plannedPaths = new Set(proposedChanges.filter((c) => c.kind === 'file').map((c) => c.target));
      const unexpectedFiles: string[] = [];
      if (snapshotDiff) {
        for (const file of [...snapshotDiff.addedFiles, ...snapshotDiff.modifiedFiles]) {
          const isPlanned = [...plannedPaths].some(
            (p) => file === p || file.endsWith('/' + p) || p.endsWith('/' + file),
          );
          if (!isPlanned) unexpectedFiles.push(file);
        }
      }

      const items = deps.planItemService.listItemSummaries(plan_uid);
      const actions = items.filter((i: any) => i.kind === 'action');
      const completedTasks = actions.filter((i: any) => i.status === 'done').length;
      const totalTasks = actions.length;

      const since = since_ms ?? (snapshots.length > 0 ? snapshots[0].createdAt : Date.now() - 3600000);
      const recentComments = deps.commentService.listCommentsForPlanSince(plan_uid, since);
      const blockers = recentComments.filter((c: any) => c.kind === 'blocker');
      const questions = recentComments.filter((c: any) => c.kind === 'question');
      const progressUpdates = recentComments.filter((c: any) => c.kind === 'progress');

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        planTitle: plan?.title,
        taskProgress: `${completedTasks}/${totalTasks}`,
        // Plan-aware classification (from plan-changes-service — always fresh)
        planAlignment: {
          satisfied: onTrack.length,
          inProgress: inProgress.length,
          missing: missingChanges.length,
          planned: planned.length,
          unexpected: unexpectedFiles.length,
          satisfiedTargets: onTrack,
          missingTargets: missingChanges,
          unexpectedFiles,
        },
        changesSummary,
        // Snapshot diff (filesystem-verified, no phantoms)
        snapshotDiff,
        hasBaseline: snapshots.length > 0,
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
