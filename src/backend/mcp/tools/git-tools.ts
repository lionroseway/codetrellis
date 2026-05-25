/**
 * Git tools — Phase 1.2 + Phase 6 of the CDev target architecture.
 *
 * Phase 1.2: commit_manifest_changes.
 * Phase 6.1: get_team_activity — git-projected team activity feed.
 * Phase 6.2: get_plan_history, get_plan_at_commit — plan history rail.
 * Phase 6.3: search_plan_history — decision archaeology.
 * Phase 6.4: detect_conflicts, resolve_conflict — conflict resolution.
 *
 * See docs/cdev/06-agent-identity-and-attribution.md for the commit
 * message convention.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { commitManifestChanges, type AgentAttribution } from '../../services/git-commit-service';
import { getTeamActivity, getPlanCommitHistory, searchPlanHistory } from '../../services/git-activity-service';
import { getPlanAtCommit, diffPlanBetweenCommits } from '../../services/plan-history-service';
import { detectManifestConflicts, resolveFileConflict, resolveFileConflictBySide } from '../../services/plan-conflict-service';

export function register(server: McpServer, deps: ToolDeps): void {
  // --- commit_manifest_changes ---

  server.registerTool(
    'commit_manifest_changes',
    {
      description:
        'Create a git commit in the project for the given paths, with a CDev-formatted message. ' +
        'Stages the supplied paths, composes a "[cdev] <subject>" commit message, and runs git commit. ' +
        'When agent attribution is supplied, appends a Co-Authored-By trailer and an agent/model metadata line ' +
        'so the commit history shows that an agent acted on the user\'s behalf. ' +
        'The git user identity (from `git config`) is always the commit author — accountability rests with the human. ' +
        'The Co-Authored-By possessive ("<human>\'s <agent>") reads `settings.identity.displayName ?? .email` — ' +
        'not git config directly — so if the user has edited their CodeTrellis identity the trailer reflects that. ' +
        'Use this when you (the agent) have completed work the user has authorised you to commit, ' +
        'or when the user has explicitly asked you to commit their pending manifest changes.',
      inputSchema: {
        project_root: z.string().describe(
          'Absolute path to the project root (must contain a .git directory).',
        ),
        subject: z.string().describe(
          'Imperative-mood subject line. Will be prefixed with "[cdev] " automatically. Keep under 72 characters.',
        ),
        paths: z.array(z.string()).describe(
          'File paths to stage and commit, relative to project_root. The commit fails if this is empty or the paths produce no staged changes.',
        ),
        body: z.array(z.string()).optional().describe(
          'Optional commit message body paragraphs. Each entry becomes its own paragraph.',
        ),
        agent: z
          .object({
            agent_type: z.string().describe('Runtime identifier — e.g., "claude-code", "cursor", "codex".'),
            model: z.string().nullable().optional().describe('Specific model — e.g., "opus-4". Optional.'),
          })
          .optional()
          .describe(
            'When set, attributes the commit to an agent acting on the user\'s behalf. Adds Co-Authored-By trailer + agent/model metadata line. Omit for direct human commits.',
          ),
        signed: z.boolean().optional().describe(
          'Sign the commit with the user\'s configured signing key (git commit -S). Requires the user to have signing set up.',
        ),
      },
    },
    async ({ project_root, subject, paths, body, agent, signed }) => {
      // Build the agent attribution, pulling humanIdentity from settings
      // so the Co-Authored-By trailer reads "<human>'s <agent>".
      let agentAttribution: AgentAttribution | undefined;
      if (agent) {
        const settings = deps.getSettings();
        const humanIdentity = settings.identity.displayName || settings.identity.email || null;
        agentAttribution = {
          agentType: agent.agent_type,
          model: agent.model ?? null,
          humanIdentity,
        };
      }

      const result = commitManifestChanges({
        projectRoot: project_root,
        subject,
        body,
        paths,
        agent: agentAttribution,
        signed,
      });

      deps.broadcast('git-commit-created', {
        projectRoot: project_root,
        sha: result.sha,
        subject,
        agentAttributed: !!agent,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ sha: result.sha, message: result.message }, null, 2),
          },
        ],
      };
    },
  );

  // --- Phase 6.1: get_team_activity ---

  server.registerTool(
    'get_team_activity',
    {
      description:
        'Get the team activity feed for a project — a "what happened recently" view drawn entirely from ' +
        'the git history of the .codetrellis/ manifest directory. Shows who created, updated, or deleted ' +
        'plans, items, channel events, system docs, and config. Each entry is attributed and timestamped. ' +
        'Complementary to the DB-driven plan_events (which tracks in-session mutations).',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        since: z.string().optional().describe('ISO date — only include commits after this point. Default: last 7 days.'),
        limit: z.number().optional().describe('Max entries to return (default 50).'),
      },
    },
    async ({ project_path, since, limit }) => {
      const sinceVal = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const entries = getTeamActivity({ projectRoot: project_path, since: sinceVal, limit });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ total: entries.length, entries }, null, 2),
        }],
      };
    },
  );

  // --- Phase 6.2: get_plan_history ---

  server.registerTool(
    'get_plan_history',
    {
      description:
        'List commits that touched a specific plan\'s manifest directory. Returns commit metadata ' +
        '(hash, timestamp, author, subject) in reverse-chronological order. Use the commit hashes ' +
        'with get_plan_at_commit to reconstruct the plan\'s state at any point in history.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        plan_slug: z.string().describe('Slug of the plan directory under .codetrellis/plans/.'),
        limit: z.number().optional().describe('Max commits to return (default 30).'),
        since: z.string().optional().describe('ISO date — only include commits after this point.'),
      },
    },
    async ({ project_path, plan_slug, limit, since }) => {
      const commits = getPlanCommitHistory(project_path, plan_slug, { limit, since });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ total: commits.length, commits }, null, 2),
        }],
      };
    },
  );

  // --- Phase 6.2: get_plan_at_commit ---

  server.registerTool(
    'get_plan_at_commit',
    {
      description:
        'Reconstruct the full state of a plan at a specific git commit. Returns the plan metadata ' +
        'and all items as they existed at that point in time. Use this with get_plan_history to ' +
        'implement a "time machine" for plans — view any historical snapshot.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        plan_slug: z.string().describe('Slug of the plan directory under .codetrellis/plans/.'),
        commit_hash: z.string().describe('Git commit hash to read the plan state from.'),
      },
    },
    async ({ project_path, plan_slug, commit_hash }) => {
      const state = getPlanAtCommit(project_path, plan_slug, commit_hash);
      if (!state) {
        return { content: [{ type: 'text' as const, text: `Could not read plan "${plan_slug}" at commit ${commit_hash}. The plan or commit may not exist.` }], isError: true };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(state, null, 2),
        }],
      };
    },
  );

  // --- Phase 6.2: diff_plan_between_commits ---

  server.registerTool(
    'diff_plan_between_commits',
    {
      description:
        'Compare a plan\'s state between two commits. Shows what items were added, removed, and ' +
        'which fields changed. Useful for understanding what happened between two points in time.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        plan_slug: z.string().describe('Slug of the plan directory.'),
        base_commit: z.string().describe('Earlier commit hash (the "before").'),
        head_commit: z.string().describe('Later commit hash (the "after"). Use "HEAD" for current.'),
      },
    },
    async ({ project_path, plan_slug, base_commit, head_commit }) => {
      const diff = diffPlanBetweenCommits(project_path, plan_slug, base_commit, head_commit);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(diff, null, 2),
        }],
      };
    },
  );

  // --- Phase 6.3: search_plan_history ---

  server.registerTool(
    'search_plan_history',
    {
      description:
        'Search a plan\'s git history for commits where specific text was added or removed. ' +
        '"Why did we choose this approach?" — find the commit where a decision was recorded ' +
        'and view the plan\'s state at that moment. Uses git log -G for content-level search.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        plan_slug: z.string().describe('Slug of the plan directory.'),
        query: z.string().describe('Text to search for in plan file content (case-insensitive).'),
        since: z.string().optional().describe('ISO date — only include commits after this point.'),
        until: z.string().optional().describe('ISO date — only include commits before this point.'),
        limit: z.number().optional().describe('Max results (default 20).'),
      },
    },
    async ({ project_path, plan_slug, query, since, until, limit }) => {
      const results = searchPlanHistory(project_path, plan_slug, query, { since, until, limit });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ total: results.length, results }, null, 2),
        }],
      };
    },
  );

  // --- Phase 6.4: detect_conflicts ---

  server.registerTool(
    'detect_conflicts',
    {
      description:
        'Detect merge conflicts in .codetrellis/ manifest files. Returns a summary of all conflicted ' +
        'files with field-level details where possible (structured fields like status, assignee, ' +
        'visibility can be auto-resolved; free-text fields need manual resolution). Only returns ' +
        'results when git is in a merge state.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
      },
    },
    async ({ project_path }) => {
      const summary = detectManifestConflicts(project_path);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(summary, null, 2),
        }],
      };
    },
  );

  // --- Phase 6.4: resolve_conflict ---

  server.registerTool(
    'resolve_conflict',
    {
      description:
        'Resolve a merge conflict in a specific .codetrellis/ file. Two modes: ' +
        '"by_side" picks the entire ours or theirs version; "by_field" allows ' +
        'field-level resolution where each conflicting field can independently ' +
        'use ours, theirs, or a custom value. The resolved file is written and staged.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root.'),
        file_path: z.string().describe('Path to the conflicted file (relative to project root).'),
        mode: z.enum(['by_side', 'by_field']).describe('"by_side" to pick ours/theirs entirely, "by_field" for per-field resolution.'),
        side: z.enum(['ours', 'theirs']).optional().describe('Required for by_side mode. Which side to pick.'),
        resolutions: z.array(z.object({
          field: z.string().describe('Field name to resolve.'),
          pick: z.enum(['ours', 'theirs', 'custom']).describe('Which side to pick for this field.'),
          custom_value: z.unknown().optional().describe('Custom value when pick is "custom".'),
        })).optional().describe('Required for by_field mode. Per-field resolutions.'),
      },
    },
    async ({ project_path, file_path, mode, side, resolutions }) => {
      if (mode === 'by_side') {
        if (!side) {
          return { content: [{ type: 'text' as const, text: 'Side is required for by_side mode.' }], isError: true };
        }
        const result = resolveFileConflictBySide(project_path, file_path, side);
        return {
          content: [{
            type: 'text' as const,
            text: result.resolved
              ? `Resolved ${file_path} using "${side}" version.`
              : `Failed to resolve: ${result.error}`,
          }],
          isError: !result.resolved,
        };
      }

      if (!resolutions || resolutions.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Resolutions are required for by_field mode.' }], isError: true };
      }

      const result = resolveFileConflict(
        project_path,
        file_path,
        resolutions.map((r) => ({
          field: r.field,
          pick: r.pick,
          customValue: r.custom_value,
        })),
      );

      return {
        content: [{
          type: 'text' as const,
          text: result.resolved
            ? `Resolved ${file_path} with ${resolutions.length} field-level resolutions.`
            : `Failed to resolve: ${result.error}`,
        }],
        isError: !result.resolved,
      };
    },
  );
}
