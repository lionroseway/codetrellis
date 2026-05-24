/**
 * Session & navigation tools — register, set_active_plan, navigate, toggle, refresh, rescan, baseline, recent projects.
 */

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { resultWithMeta } from '../helpers';

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'register_session',
    {
      description:
        'Register this agent connection with CodeTrellis. Identifies who you are, what model you use, and what capabilities you have. ' +
        'Capabilities are used for skill-matching when claiming Actions — declare your MCP servers, language proficiencies, and skills so CodeTrellis can route the right work to you.\n\n' +
        'If you are running inside a CodeTrellis terminal, the environment variable CODETRELLIS_HOST_TERMINAL will be set to your ' +
        'host terminal\'s session ID. Pass it as host_terminal_id so CodeTrellis can prevent you from accidentally writing to your ' +
        'own terminal via terminal_write (which would create a feedback loop).',
      inputSchema: {
        agent_type: z.string().describe('Agent type, e.g. claude-code, cursor, aider'),
        model: z.string().optional().describe('Model name, e.g. claude-opus-4, gpt-4o'),
        capabilities: z.array(z.object({
          name: z.string().describe('Capability name, e.g. "playwright", "typescript", "@refactor"'),
          source: z.enum(['mcp', 'skill', 'lang', 'plugin']).describe('Where this capability comes from'),
        })).optional().describe('Capabilities this agent has — MCP servers, skills, languages, plugins'),
        host_terminal_id: z.string().optional().describe(
          'If you are running inside a CodeTrellis terminal, pass the value of the CODETRELLIS_HOST_TERMINAL ' +
          'environment variable here. This enables self-write protection — terminal_write will reject writes ' +
          'to your own host terminal to prevent feedback loops.',
        ),
      },
    },
    async ({ agent_type, model, capabilities, host_terminal_id }) => {
      // Use the McpServer-instance-bound session id (Bugfix A). This
      // is stable per SSE connection, so re-registration is idempotent
      // (INSERT OR REPLACE updates the existing row).
      const sessionId = deps.sessionId;
      deps.sessionService.registerSession(sessionId, agent_type, model, capabilities, host_terminal_id);
      deps.broadcast('session-registered', { sessionId, agentType: agent_type, model, capabilities });
      deps.broadcast('mcp-session-changed', { reason: 'register', sessionId });
      deps.saveNow(() => deps.exportDatabase());
      const parts = [
        `Session registered: ${sessionId} (${agent_type}${model ? ` / ${model}` : ''}${capabilities?.length ? ` with ${capabilities.length} capabilities` : ''})`,
      ];
      if (host_terminal_id) {
        parts.push(`Self-write protection enabled: writes to terminal ${host_terminal_id} will be blocked from this session.`);
      }
      return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
    },
  );

  server.registerTool(
    'set_active_plan',
    {
      description: 'Associate this agent session with a plan and navigate the UI to show it. Other connected agents see your active plan in the Connected Agents widget.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const sessionId = deps.sessionId;
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
        const stats = await deps.scanProject(project_path ?? process.cwd());
        return { content: [{ type: 'text' as const, text: `Rescan complete${project_path ? ` for ${project_path}` : ''} — ${stats.fileCount} files, ${stats.symbolCount} symbols, ${stats.importCount} imports (${stats.resolvedImports} resolved)` }] };
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

  server.registerTool(
    'pin_project',
    {
      description: 'Pin a project in the recent projects list so it stays at the top and is never pruned.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of the project to pin'),
      },
    },
    async ({ project_path }) => {
      deps.setRecentProjectPinned(project_path, true);
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Pinned project: ${project_path}` }] };
    },
  );

  server.registerTool(
    'unpin_project',
    {
      description: 'Unpin a project from the recent projects list. It will still appear in recents but can be pruned when the list is full.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of the project to unpin'),
      },
    },
    async ({ project_path }) => {
      deps.setRecentProjectPinned(project_path, false);
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Unpinned project: ${project_path}` }] };
    },
  );

  server.registerTool(
    'remove_recent_project',
    {
      description: 'Remove a project from the recent projects list entirely.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of the project to remove'),
      },
    },
    async ({ project_path }) => {
      deps.removeRecentProject(project_path);
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Removed from recents: ${project_path}` }] };
    },
  );

  server.registerTool(
    'close_project',
    {
      description:
        'Close a project tab in the CodeTrellis UI. The human will see the tab disappear. ' +
        'Use list_recent_projects to find paths, or open_project to open a new one.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of the project to close'),
      },
    },
    async ({ project_path }) => {
      deps.broadcast('ui-close-project', { path: project_path });
      return { content: [{ type: 'text' as const, text: `Closed project tab: ${project_path}` }] };
    },
  );

  // --- Repo identity (CDev Phase 3.1) ---

  server.registerTool(
    'get_repo_identity',
    {
      description:
        'Read CodeTrellis\' identity record for the project at the given path: the local user-facing alias ' +
        '(display name), the normalised git origin URL (the cross-machine identifier used to match the same ' +
        'repo across teammates and devices), the current branch, and recency / pinned flags. Returns null ' +
        'if the project isn\'t in the recent list.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of the project'),
      },
    },
    async ({ project_path }) => {
      const project = deps.getRecentProject(project_path);
      if (!project) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(null) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(project, null, 2) }] };
    },
  );

  server.registerTool(
    'set_repo_alias',
    {
      description:
        'Set a per-device user-facing label for the project at `project_path`. The alias is local-only — ' +
        'it never travels in the manifest, so different teammates and even different machines of the same ' +
        'user can show different labels for the same repository. Pass an empty string to reset to the path\'s ' +
        'basename. The repo\'s canonical identity for cross-machine matching is its git origin URL, which is ' +
        'unaffected.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of the project'),
        alias: z.string().describe('New label to show in the UI. Empty string resets to the default.'),
      },
    },
    async ({ project_path, alias }) => {
      const updated = deps.setProjectAlias(project_path, alias);
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Project not in recents: ${project_path}` }],
        };
      }
      deps.broadcast('project-alias-changed', { path: project_path, alias: updated.displayName });
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.registerTool(
    'refresh_repo_origin',
    {
      description:
        'Re-read the git origin URL for the project at `project_path` and update CodeTrellis\' cached value. ' +
        'Useful when the user has just run `git remote set-url origin <new>` and wants cross-repo pointer ' +
        'resolution to pick up the change without re-opening the project.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of the project'),
      },
    },
    async ({ project_path }) => {
      const updated = deps.refreshProjectOriginUrl(project_path);
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Project not in recents: ${project_path}` }],
        };
      }
      deps.broadcast('project-origin-changed', { path: project_path, originUrl: updated.originUrl });
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
    },
  );

  // --- Item Navigation ---

  server.registerTool(
    'navigate_item_back',
    {
      description:
        'Navigate backward in the item selection history (like Cmd+[). The history stack records every ' +
        'select_item call and every user click on a plan item. Switching plans (open_plan / set_active_plan) ' +
        'resets the stack. Back pops the last entry; the current item is pushed onto the forward stack. ' +
        'Deterministic: three back calls after select A → B → C → D will land on C, B, A in that order.',
      inputSchema: {},
    },
    async () => {
      deps.broadcast('ui-navigate-item-back', {});
      return { content: [{ type: 'text' as const, text: 'Navigated back in item history' }] };
    },
  );

  server.registerTool(
    'navigate_item_forward',
    {
      description:
        'Navigate forward in the item selection history (like Cmd+]). Pops the forward stack ' +
        '(populated by navigate_item_back) and pushes the current item onto the back stack. ' +
        'Any new select_item call clears the forward stack (same as browser navigation).',
      inputSchema: {},
    },
    async () => {
      deps.broadcast('ui-navigate-item-forward', {});
      return { content: [{ type: 'text' as const, text: 'Navigated forward in item history' }] };
    },
  );

  // --- UI Drawers & Modals ---

  server.registerTool(
    'toggle_activity_drawer',
    {
      description: 'Toggle the activity drawer in the plan workspace. Shows the activity/comment feed for the current plan.',
      inputSchema: {},
    },
    async () => {
      deps.broadcast('ui-toggle-activity-drawer', {});
      return { content: [{ type: 'text' as const, text: 'Toggled activity drawer' }] };
    },
  );

  server.registerTool(
    'open_history_drawer',
    {
      description: 'Open the version history drawer for a specific item. Shows all prior versions with diffs.',
      inputSchema: {
        item_uid: z.string().describe('UID of the item to show history for'),
      },
    },
    async ({ item_uid }) => {
      deps.broadcast('ui-open-history-drawer', { itemUid: item_uid });
      return { content: [{ type: 'text' as const, text: `Opened history drawer for item ${item_uid}` }] };
    },
  );

  server.registerTool(
    'open_settings',
    {
      description: 'Open the settings modal in the CodeTrellis UI.',
      inputSchema: {},
    },
    async () => {
      deps.broadcast('ui-open-settings', {});
      return { content: [{ type: 'text' as const, text: 'Opened settings modal' }] };
    },
  );

  server.registerTool(
    'open_mcp_guide',
    {
      description: 'Open the MCP connection guide modal. Shows how to connect agents to CodeTrellis.',
      inputSchema: {},
    },
    async () => {
      deps.broadcast('ui-open-mcp-guide', {});
      return { content: [{ type: 'text' as const, text: 'Opened MCP guide modal' }] };
    },
  );

  // --- Agent permission setup ---

  server.registerTool(
    'setup_agent_permissions',
    {
      description:
        'Write a .claude/settings.local.json file in the project directory that auto-approves all ' +
        'CodeTrellis MCP tools. Without this, Claude Code prompts for permission on every MCP tool ' +
        'call, which breaks the flow when the agent is driving the UI. Call this once per project ' +
        'during onboarding. The file is .local (gitignored) so it stays per-user.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the project root directory.'),
      },
    },
    async ({ project_path: projectPath }) => {
      const claudeDir = path.join(projectPath, '.claude');
      const settingsPath = path.join(claudeDir, 'settings.local.json');

      try {
        // Ensure .claude/ directory exists
        if (!fs.existsSync(claudeDir)) {
          fs.mkdirSync(claudeDir, { recursive: true });
        }

        // Read existing settings if any — merge rather than clobber
        let settings: any = {};
        if (fs.existsSync(settingsPath)) {
          try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          } catch {
            // Malformed JSON — overwrite
          }
        }

        // Ensure permissions.allow exists and contains the wildcard
        if (!settings.permissions) settings.permissions = {};
        if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

        const wildcard = 'mcp__codetrellis__*';
        if (!settings.permissions.allow.includes(wildcard)) {
          // Remove any individual codetrellis tool entries — the wildcard covers them all
          settings.permissions.allow = settings.permissions.allow.filter(
            (entry: string) => !entry.startsWith('mcp__codetrellis__'),
          );
          settings.permissions.allow.push(wildcard);
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

        return {
          content: [{
            type: 'text' as const,
            text: `Auto-approve permissions written to ${settingsPath}\n` +
              `All CodeTrellis MCP tools are now auto-approved for this project.\n` +
              `Note: The agent needs to restart the session for this to take effect.`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to write permissions: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
