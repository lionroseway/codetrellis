/**
 * Session & navigation tools — register, set_active_plan, navigate, toggle, refresh, rescan, baseline, recent projects.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta } from '../helpers';

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'register_session',
    {
      description: 'Register this agent connection with CodeTrellis. Identifies who you are, what model you use, and what capabilities you have. Capabilities are used for skill-matching when claiming tasks — declare your MCP servers, language proficiencies, and skills so CodeTrellis can route the right tasks to you.',
      inputSchema: {
        agent_type: z.string().describe('Agent type, e.g. claude-code, cursor, aider'),
        model: z.string().optional().describe('Model name, e.g. claude-opus-4, gpt-4o'),
        capabilities: z.array(z.object({
          name: z.string().describe('Capability name, e.g. "playwright", "typescript", "@refactor"'),
          source: z.enum(['mcp', 'skill', 'lang', 'plugin']).describe('Where this capability comes from'),
        })).optional().describe('Capabilities this agent has — MCP servers, skills, languages, plugins'),
      },
    },
    async ({ agent_type, model, capabilities }, extra: any) => {
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? `mcp-${Date.now()}`;
      deps.sessionService.registerSession(sessionId, agent_type, model, capabilities);
      deps.broadcast('session-registered', { sessionId, agentType: agent_type, model, capabilities });
      deps.broadcast('mcp-session-changed', { reason: 'register', sessionId });
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Session registered: ${sessionId} (${agent_type}${model ? ` / ${model}` : ''}${capabilities?.length ? ` with ${capabilities.length} capabilities` : ''})` }] };
    },
  );

  server.registerTool(
    'set_active_plan',
    {
      description: 'Associate this agent session with a plan and navigate the UI to show it. Other connected agents see your active plan in the Connected Agents widget.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }, extra: any) => {
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      if (sessionId) {
        deps.sessionService.setActivePlan(sessionId, plan_uid);
        deps.broadcast('mcp-session-changed', { reason: 'set_active_plan', sessionId, planUid: plan_uid });
      } else {
        const sessions = deps.sessionService.getActiveSessions();
        if (sessions.length > 0) {
          deps.sessionService.setActivePlan(sessions[sessions.length - 1].sessionId, plan_uid);
          deps.broadcast('mcp-session-changed', { reason: 'set_active_plan', planUid: plan_uid });
        }
      }
      const n = deps.broadcast('ui-navigate', { target: 'plan', planUid: plan_uid });
      return resultWithMeta({ ok: true, planUid: plan_uid, navigated: true }, n);
    },
  );

  // --- UI Navigation ---

  server.registerTool(
    'navigate_to',
    {
      description: 'Navigate the CodeTrellis UI to a specific view. Use this to show the user what you are working on — open the plan workspace, switch to graph view, or enable split view.',
      inputSchema: {
        target: z.enum(['plan', 'graph', 'split', 'timeline']).describe('"plan" = plan workspace, "graph" = dependency graph, "split" = plan + graph side-by-side, "timeline" = plan workspace with timeline'),
        plan_uid: z.string().optional().describe('If navigating to plan/split/timeline, which plan to show. If omitted, keeps the current active plan.'),
      },
    },
    async ({ target, plan_uid }) => {
      deps.broadcast('ui-navigate', { target, planUid: plan_uid });
      return { content: [{ type: 'text' as const, text: `Navigated to ${target}${plan_uid ? ` (plan ${plan_uid})` : ''}` }] };
    },
  );

  server.registerTool(
    'open_plan',
    {
      description: 'Open a specific plan in the CodeTrellis UI. Switches to plan workspace mode and loads the plan. The user will see the plan immediately.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to open'),
        split_view: z.boolean().optional().describe('Also enable split view (plan + graph side-by-side)'),
      },
    },
    async ({ plan_uid, split_view }) => {
      deps.broadcast('ui-navigate', { target: split_view ? 'split' : 'plan', planUid: plan_uid });
      return { content: [{ type: 'text' as const, text: `Opened plan ${plan_uid}${split_view ? ' in split view' : ''}` }] };
    },
  );

  server.registerTool(
    'toggle_panel',
    {
      description: 'Toggle a UI panel on or off in the CodeTrellis interface.',
      inputSchema: {
        panel: z.enum(['sidebar', 'inspector', 'terminal', 'split']).describe('Which panel to toggle'),
      },
    },
    async ({ panel }) => {
      deps.broadcast('ui-toggle', { panel });
      return { content: [{ type: 'text' as const, text: `Toggled ${panel} panel` }] };
    },
  );

  server.registerTool(
    'refresh_ui',
    {
      description: 'Force the CodeTrellis UI to refresh its plan list and active plan. Use this after making changes that the UI might not have picked up.',
      inputSchema: {},
    },
    async () => {
      deps.broadcast('ui-refresh', {});
      return { content: [{ type: 'text' as const, text: 'UI refresh triggered' }] };
    },
  );

  // --- Project Tools ---

  server.registerTool(
    'rescan_project',
    {
      description:
        'Trigger a fresh AST re-parse of the currently open project. Use this after making changes to ensure ' +
        'the dependency graph and symbol index are up to date. Equivalent to hitting the "Rescan" button in the UI.',
      inputSchema: {
        project_path: z.string().optional().describe(
          'Absolute path of the project to scan. If omitted, rescans the currently open project.',
        ),
      },
    },
    async ({ project_path }) => {
      try {
        const port = deps.getBoundBackendPort();
        const res = await fetch(`http://localhost:${port}/api/project/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: project_path }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { content: [{ type: 'text' as const, text: `Rescan failed: ${(body as any).error || res.statusText}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `Rescan complete${project_path ? ` for ${project_path}` : ''}` }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Rescan failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'set_baseline',
    {
      description:
        'Set the baseline commit hash for diff mode. The graph\'s "diff" and "baseline" modes compare ' +
        'the current state against this reference point. Pass null to clear.',
      inputSchema: {
        commit_hash: z.string().nullable().describe('Full or short git commit hash to use as the baseline. Null to clear.'),
      },
    },
    async ({ commit_hash }) => {
      deps.broadcast('ui-set-baseline', { commitHash: commit_hash });
      const msg = commit_hash
        ? `Set baseline to commit ${commit_hash}`
        : 'Cleared baseline reference';
      return { content: [{ type: 'text' as const, text: msg }] };
    },
  );

  server.registerTool(
    'list_recent_projects',
    {
      description:
        'List recently opened projects with their paths, display names, branches, and pinned status. ' +
        'Useful for discovering available projects to open.',
      inputSchema: {},
    },
    async () => {
      const projects = deps.listRecentProjects();
      if (projects.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No recent projects found.' }] };
      }
      const lines = projects.map((p: any) =>
        `- ${p.pinned ? '📌 ' : ''}**${p.displayName}** — \`${p.path}\`${p.branch ? ` (${p.branch})` : ''}`
      );
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
