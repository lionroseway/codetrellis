/**
 * Review and comparison tools — Phase 25.
 *
 * See [docs/PHASE-25-REVIEW-AND-PLAYBACK.md](../../../../docs/PHASE-25-REVIEW-AND-PLAYBACK.md).
 *
 * Two things an agent could not previously ask for: the architectural
 * delta between *any* two points, and whether a change did what its plan
 * said it would.
 *
 * `review_plan` is shaped so an agent can post its markdown straight
 * into a PR with its own GitHub credentials. CodeTrellis holds none —
 * same reasoning as Phase 24.
 */

import { architectureMarkdown, architectureOf } from '../../services/review-architecture';
import { lastMark, markReviewed, sinceLastLook } from '../../services/review-marks';
import { taskMarkdown, taskOutcome } from '../../services/review-task';
import { authorFromExtra } from '../helpers';
import { isSafeGitRef } from '../../services/git-safety';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { compareSnapshots, comparandBranches, listComparands } from '../../services/snapshot-compare-service';
import { reviewPlan, renderReviewMarkdown, withArchitecture } from '../../services/plan-review-service';
import { draftArchitecture, buildPrDraft } from '../../services/pr-draft-service';
import { reviewQueue } from '../../services/review-queue-service';

const COMPARAND_HELP =
  'One of: "live" (working tree), "baseline" (the pinned baseline), "checkpoint:<id>", or ' +
  '"commit:<ref>" (a sha or a branch; list_comparands offers each line of work\'s branch). A commit ' +
  'carries its dependency edges, so dependencies nobody planned are found for branch reviews too.';

export function register(server: McpServer, deps: ToolDeps): void {
  // --- list_comparands ---

  server.registerTool(
    'list_comparands',
    {
      description:
        'Every point you can compare against: the live working tree, the pinned baseline, stored ' +
        'checkpoints, and recent commits. Use these values with compare_snapshots or review_plan.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
      },
    },
    async ({ project_path }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(listComparands(project_path, undefined, await comparandBranches(project_path)), null, 2) }],
    }),
  );

  // --- compare_snapshots ---

  server.registerTool(
    'compare_snapshots',
    {
      description:
        'Architectural delta between any two points: files added / removed / modified, edges added and ' +
        'removed, and the blast radius of what changed. ' +
        COMPARAND_HELP,
      inputSchema: {
        project_path: z.string(),
        before: z.string().describe(COMPARAND_HELP),
        after: z.string().describe(COMPARAND_HELP),
      },
    },
    async ({ project_path, before, after }) => {
      const result = compareSnapshots(before, after, project_path);
      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.result, null, 2) }] };
    },
  );

  // --- review_plan ---

  server.registerTool(
    'review_plan',
    {
      description:
        'Does this change do what the plan said? Reports items fully landed, partially landed and ' +
        'untouched — plus the two things a textual diff cannot show: files that changed with NO item ' +
        'claiming them, and dependencies that appeared with no item planning them. A new cross-module ' +
        'dependency is one import line in a diff and a new coupling in the architecture; this is where ' +
        'it becomes visible. Set format="markdown" to get a block you can post as a PR comment with ' +
        'your own GitHub credentials — CodeTrellis holds none.',
      inputSchema: {
        plan_uid: z.string(),
        project_path: z.string(),
        before: z.string().optional().describe(`Defaults to the newest commit (so the review covers what changed since it); "baseline" when the project has no commits. ${COMPARAND_HELP}`),
        after: z.string().optional().describe(`Defaults to "live". ${COMPARAND_HELP}`),
        format: z.enum(['json', 'markdown']).optional().describe('Defaults to json.'),
      },
    },
    async ({ plan_uid, project_path, before, after, format }) => {
      const reviewed = reviewPlan({ planUid: plan_uid, projectPath: project_path, before, after });
      if (!reviewed.ok) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(reviewed, null, 2) }], isError: true };
      }
      // V1 — what the change does to the architecture, at the top.
      const result = { ok: true as const, review: await withArchitecture(reviewed.review, project_path) };

      if (format === 'markdown') {
        const plan = deps.planService.getPlan(plan_uid);
        return {
          content: [{
            type: 'text' as const,
            text: renderReviewMarkdown(result.review, (plan as { title?: string } | null)?.title),
          }],
        };
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(result.review, null, 2) }] };
    },
  );

  // --- get_pr_draft ---

  server.registerTool(
    'get_pr_draft',
    {
      description:
        'The title and body for a pull request describing this plan: what it set out to do, the tickets ' +
        'it came from, and the review — what landed, what did not, and what changed that nobody asked ' +
        'for. YOU do the git and open the PR with your own credentials; this supplies the part you ' +
        'cannot write, because the plan, its ticket lineage and the architectural delta exist nowhere ' +
        'else. Nothing here touches the repository. Check `warnings` before opening: they are the things ' +
        'a reviewer will ask about.',
      inputSchema: {
        plan_uid: z.string(),
        project_path: z.string(),
        before: z.string().optional().describe(`Defaults to the newest commit (so the review covers what changed since it); "baseline" when the project has no commits. ${COMPARAND_HELP}`),
        after: z.string().optional().describe(`Defaults to "live". ${COMPARAND_HELP}`),
      },
    },
    async ({ plan_uid, project_path, before, after }) => {
      const result = buildPrDraft({ planUid: plan_uid, projectPath: project_path, before, after, architecture: await draftArchitecture(project_path, before, after) });
      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.draft, null, 2) }] };
    },
  );

  // --- get_review_queue (Phase 32 A5.4) ---

  server.registerTool(
    'get_review_queue',
    {
      description:
        'The review queue: every line of work (a branch) that has plan items, reviewed against the main checkout\'s ' +
        'branch, with where its criteria stand, its blast radius, dependencies nobody planned, open overlaps with ' +
        'other work, whether it is ready, and a suggested merge order with the reason for each place. A line that ' +
        'changes something another imports goes first, so the other updates to it rather than breaking. The order is ' +
        'a suggestion, never enforced. Use it to answer "what should merge next, and why".',
      inputSchema: {
        project_path: z.string(),
      },
    },
    async ({ project_path }) => {
      const queue = reviewQueue(project_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(queue, null, 2) }] };
    },
  );
  // --- review_change (Phase 33 V1) ---
  server.registerTool(
    'review_change',
    {
      description:
        'What a change does to the architecture, with no plan needed: between two commits (a branch and its base), the imports added and ' +
        'removed between folders, outside packages added or dropped (package.json, requirements.txt, go.mod), HTTP calls, routes and SQL ' +
        'added or dropped, imports across the team\'s rules, and what it does to the rulebook. Read it before the text diff. ' +
        'When head is a branch a plan item names, it also says whether the change did what the task said (task): each criterion with where it ' +
        'stands, the planned files touched and not, and the changed files nobody planned. Without a linked task there is no task section. ' +
        'format="markdown" gives the section for a pull request comment.',
      inputSchema: {
        base: z.string().max(200).describe('The commit or branch the change started from, e.g. origin/main.'),
        head: z.string().max(200).optional().describe('The change: a commit or branch. Defaults to HEAD.'),
        project_path: z.string().optional().describe('An opened project. Omit for the one open in the app.'),
        format: z.enum(['json', 'markdown']).optional().describe('Defaults to json.'),
        mark_reviewed: z.boolean().optional().describe(
          'Remember that you reviewed it at its head now. Your next review_change of the same head says what moved since, and which of these findings the pushes addressed.'),
      },
    },
    async ({ base, head, project_path, format, mark_reviewed }, extra: any) => {
      const root = project_path ?? deps.getActiveProjectPath();
      if (!root) return { isError: true, content: [{ type: 'text' as const, text: 'No project is open.' }] };
      if (!isSafeGitRef(base) || (head !== undefined && !isSafeGitRef(head))) {
        return { isError: true, content: [{ type: 'text' as const, text: 'base and head must be commits or branch names.' }] };
      }
      const a = await architectureOf(root, base, head ?? 'HEAD');
      if ('error' in a) return { isError: true, content: [{ type: 'text' as const, text: a.error }] };
      // V3 — since this agent's last look at the same head, then (if asked) remember this one.
      const who = authorFromExtra(deps, extra);
      const target = head ?? 'HEAD';
      const mark = lastMark(root, target, who.author);
      const since = mark ? sinceLastLook(root, mark, a.head, a.words) : null;
      if (mark_reviewed) markReviewed(root, { target, reviewer: who.author, reviewerType: who.authorType, base: a.base, commit: a.head, findings: a.words });
      // V6 — only when the head is a task's branch; otherwise absent.
      const task = taskOutcome(root, base, target);
      if (format === 'markdown') {
        return { content: [{ type: 'text' as const, text: `${since ? `${since.words}\n\n` : ''}${architectureMarkdown(a)}${task ? `\n\n${taskMarkdown(task)}` : ''}` }] };
      }
      return {
        _meta: { summary: `${a.words.length} architecture finding${a.words.length === 1 ? '' : 's'} between ${base} and ${head ?? 'HEAD'}` },
        content: [{ type: 'text' as const, text: JSON.stringify({ ...a, ...(since ? { since } : {}), ...(task ? { task } : {}) }, null, 2) }],
      };
    },
  );
}
