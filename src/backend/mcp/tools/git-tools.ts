/**
 * Git tools — Phase 1.2 of the CDev target architecture.
 *
 * Compose and execute git commits for manifest changes the application
 * has made on the user's (or an agent's) behalf. Today: one tool —
 * `commit_manifest_changes`. Grows as additional git operations land
 * (branch creation for plan-as-PR, signed-commit helpers, etc.).
 *
 * See docs/cdev/06-agent-identity-and-attribution.md for the commit
 * message convention.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { commitManifestChanges, type AgentAttribution } from '../../services/git-commit-service';

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
}
