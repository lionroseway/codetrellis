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

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { compareSnapshots, listComparands } from '../../services/snapshot-compare-service';
import { reviewPlan, renderReviewMarkdown } from '../../services/plan-review-service';

const COMPARAND_HELP =
  'One of: "live" (working tree), "baseline" (the pinned baseline), "checkpoint:<id>", or ' +
  '"commit:<ref>". A commit contributes its FILE LIST only — reconstructing its edges would mean ' +
  'checking the tree out and re-parsing it — so edge findings need a checkpoint on both sides.';

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
      content: [{ type: 'text' as const, text: JSON.stringify(listComparands(project_path), null, 2) }],
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
        before: z.string().optional().describe(`Defaults to "baseline". ${COMPARAND_HELP}`),
        after: z.string().optional().describe(`Defaults to "live". ${COMPARAND_HELP}`),
        format: z.enum(['json', 'markdown']).optional().describe('Defaults to json.'),
      },
    },
    async ({ plan_uid, project_path, before, after, format }) => {
      const result = reviewPlan({ planUid: plan_uid, projectPath: project_path, before, after });
      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: true };
      }

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
}
