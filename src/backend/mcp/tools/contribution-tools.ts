/**
 * MCP tools for Phase 7 — external contributors.
 *
 * Tools:
 *   - resolve_pantry_references (7.1) — check which attachments exist locally
 *   - promote_to_contribution (7.2) — stage an item for PR inclusion
 *   - list_contributions (7.2) — list staged contributions on current branch
 *   - accept_contributions (7.2) — accept contributions into the plan
 *   - prepare_contributor_branch (7.3) — create a filtered branch for a contractor
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  resolveReferences,
  scanPlanReferences,
} from '../../services/pantry-resolution-service';
import {
  promoteItemToContribution,
  listContributions,
  acceptContributions,
  prepareContributorBranch,
} from '../../services/contribution-service';

export function registerContributionTools(server: McpServer): void {
  // --- 7.1: Pantry resolution ------------------------------------------------

  server.tool(
    'resolve_pantry_references',
    'Check which attachment references can be resolved locally. Returns "resolved" or "external" for each, enabling placeholder display for team-only content that external contributors cannot access.',
    {
      project_path: z.string().describe('Absolute path to project root'),
      references: z.array(z.string()).optional().describe('Specific references to resolve. If omitted, scans the plan for all references.'),
      plan_slug: z.string().optional().describe('Plan slug to scan for references (used when references is omitted)'),
    },
    async ({ project_path, references, plan_slug }) => {
      try {
        if (references?.length) {
          const results = resolveReferences(references, project_path);
          const resolved = results.filter((r) => r.status === 'resolved').length;
          const external = results.filter((r) => r.status === 'external').length;
          return {
            content: [{ type: 'text', text: JSON.stringify({ total: results.length, resolved, external, results }) }],
          };
        }

        if (plan_slug) {
          const scan = scanPlanReferences(project_path, plan_slug);
          return {
            content: [{ type: 'text', text: JSON.stringify(scan) }],
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Provide either references[] or plan_slug to scan' }) }],
          isError: true,
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error resolving references: ${err}` }],
          isError: true,
        };
      }
    },
  );

  // --- 7.2: Promote to contribution -----------------------------------------

  server.tool(
    'promote_to_contribution',
    'Promote a local item to the contributions staging area (`.codetrellis/contributions/<branch>/`). The staged content travels as part of the contributor\'s PR for team review.',
    {
      project_path: z.string().describe('Absolute path to project root'),
      item_uid: z.string().describe('UID of the item to promote'),
      title: z.string().describe('Title of the item'),
      kind: z.string().describe('Item kind (action, object, etc.)'),
      status: z.string().optional().describe('Item status'),
      body: z.string().optional().describe('Item body/description content'),
      description: z.string().optional().describe('Brief description of the contribution for reviewers'),
      attachments: z.array(z.object({
        uid: z.string(),
        kind: z.string(),
        value: z.string(),
        label: z.string().optional(),
      })).optional().describe('Attachments to include with the promoted item'),
    },
    async ({ project_path, item_uid, title, kind, status, body, description, attachments }) => {
      try {
        const result = promoteItemToContribution(project_path, {
          uid: item_uid,
          title,
          kind,
          status,
          body,
          description,
          attachments,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            message: `Promoted "${title}" to contributions staging area`,
            contribution: result,
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error promoting to contribution: ${err}` }],
          isError: true,
        };
      }
    },
  );

  // --- 7.2: List contributions -----------------------------------------------

  server.tool(
    'list_contributions',
    'List items currently staged in the contributions area for the current branch. Shows what will be included in the next PR.',
    {
      project_path: z.string().describe('Absolute path to project root'),
    },
    async ({ project_path }) => {
      try {
        const summary = listContributions(project_path);
        return {
          content: [{ type: 'text', text: JSON.stringify(summary) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error listing contributions: ${err}` }],
          isError: true,
        };
      }
    },
  );

  // --- 7.2: Accept contributions ---------------------------------------------

  server.tool(
    'accept_contributions',
    'Accept contributed items from a branch\'s staging area into a plan\'s manifest. Moves items from contributions/ into the plan, cleans up the staging area. Called after reviewing a contributor\'s PR.',
    {
      project_path: z.string().describe('Absolute path to project root'),
      branch: z.string().describe('Branch name whose contributions to accept'),
      plan_slug: z.string().describe('Plan slug to accept contributions into'),
    },
    async ({ project_path, branch, plan_slug }) => {
      try {
        const result = acceptContributions(project_path, branch, plan_slug);
        const msg = result.errors.length > 0
          ? `Accepted ${result.accepted} contributions with ${result.errors.length} error(s)`
          : `Accepted ${result.accepted} contributions into plan "${plan_slug}"`;

        return {
          content: [{ type: 'text', text: JSON.stringify({ message: msg, ...result }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error accepting contributions: ${err}` }],
          isError: true,
        };
      }
    },
  );

  // --- 7.3: Prepare contributor branch ---------------------------------------

  server.tool(
    'prepare_contributor_branch',
    'Create a filtered git branch containing only the plan content the team wants to share with an external contributor. Omits local items, team-only attachments, and private comments. The contributor can fork from this branch.',
    {
      project_path: z.string().describe('Absolute path to project root'),
      plan_slug: z.string().describe('Plan slug to export'),
      branch_name: z.string().describe('Name for the new contributor branch'),
      include_items: z.array(z.string()).optional().describe('Specific item UIDs to include (omit for all shared items)'),
    },
    async ({ project_path, plan_slug, branch_name, include_items }) => {
      try {
        const result = prepareContributorBranch(project_path, plan_slug, branch_name, {
          includeItems: include_items,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            message: `Created contributor branch "${branch_name}" with ${result.itemCount} shared items`,
            ...result,
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error preparing contributor branch: ${err}` }],
          isError: true,
        };
      }
    },
  );
}
