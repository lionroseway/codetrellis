/**
 * Awareness tools — Phase 32, Track A.
 *
 * What an agent should know about the other work going on in the same
 * repository. A1.3 adds `list_workstreams`; `get_awareness`,
 * `check_footprint`, `declare_intent` and `acknowledge_signal` follow as the
 * footprints and signals they report on land (awareness spec §6.1).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { listWorkstreams } from '../../services/workstream-service';

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_workstreams',
    {
      description:
        'Every line of parallel work in the repository: each git worktree (the main checkout included) with the ' +
        'agents working in it. A folder with two or more agents is a "shared" checkout, where their edits cannot be ' +
        'told apart — prefer a worktree of your own. `yours` marks the workstream this connection is bound to. ' +
        'Idle worktrees (no agent) are left out unless include_idle is true.',
      inputSchema: {
        project_path: z.string().optional().describe('Absolute path of an opened project. Defaults to the active project.'),
        include_idle: z.boolean().optional().describe('Also list worktrees with no agent in them.'),
      },
    },
    async ({ project_path, include_idle }) => {
      const root = project_path ?? deps.getActiveProjectPath();
      if (!root) {
        return { isError: true, content: [{ type: 'text' as const, text: 'No project is open, and none was named.' }] };
      }
      const workstreams = listWorkstreams(root, { includeIdle: include_idle === true }).map((w) => ({
        ...w,
        yours: w.agents.some((a) => a.sessionId === deps.sessionId),
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify({ project_path: root, workstreams }, null, 2) }] };
    },
  );
}
