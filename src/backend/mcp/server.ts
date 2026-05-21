import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { searchSymbols, getDependencyEdges, getFileDependencies, getDbStats } from '../services/database';
import { broadcast } from '../server';
import { z } from 'zod';
import * as planService from '../services/plan-service';
import * as commentService from '../services/comment-service';
import * as sessionService from '../services/session-service';
import * as taskAttachmentsService from '../services/task-attachments-service';
// Phase 15 §C — unified Object/Action MCP surface. V1 task/phase/doc
// tools retired; agents use add_item / bulk_add_items / update_item etc.
import * as planItemService from '../services/plan-item-service';
import * as planEventService from '../services/plan-event-service';
import { applyTemplate } from '../services/plan-templates-service';
import { listTemplates } from '../services/plan-templates';
import * as planChangesService from '../services/plan-changes-service';
import { getDeviations, resolveDeviation, detectDeviations } from '../services/deviation-service';
import { captureCurrentTrellis, listSnapshots, computeTrellisDiff } from '../services/trellis-service';
import { saveNow } from '../services/persistence';
import { exportDatabase } from '../services/database';
import { buildSkillGuide } from './skill-guide';
// Top-of-file imports for everything we used to lazy-require. Vite's
// Electron-main bundler doesn't preserve `require('../services/foo')`
// relative paths correctly (the bundled main.js lives at
// `.vite/build/main.js` but Vite emits the literal relative path),
// so the runtime `require` fails with MODULE_NOT_FOUND. Static
// imports get bundled cleanly. The original lazy-require pattern
// existed to dodge a circular dependency that no longer applies.
import { listCrossSystemEdges, getCrossSystemStats } from '../services/cross-system-service';
import * as planFileService from '../services/plan-file-service';
import { publishPlanAsTemplate } from '../services/plan-template-publish-service';
import { getSettings } from '../services/settings-service';
import * as externalRefsService from '../services/external-refs-service';

/**
 * Default + max-attempt range. The user-configured port comes from
 * settings (`mcp.port`); if `mcp.autodetectOnCollision` is true and
 * that port is in use, we walk forward up to MAX_PORT_ATTEMPTS slots.
 * The actually-bound port is reported via getMcpStatus() and broadcast
 * over WS so the frontend's "Copy MCP config" buttons stay accurate.
 */
const DEFAULT_MCP_PORT = 19432;
const MAX_PORT_ATTEMPTS = 10;
const MAX_MCP_CONNECTIONS = 20;

// Per-session McpServer instances, keyed by transport sessionId.
// Each agent connection gets its own McpServer object — sharing a
// singleton would re-bind the underlying Protocol's single
// `_transport` slot when a second agent connects, severing the first
// agent's stream. Same-process, same-port, just per-conversation
// bookkeeping (no new ports / no new processes).
let connectedServers = new Map<string, McpServer>();
let httpServer: http.Server | null = null;
let boundPort: number = DEFAULT_MCP_PORT;
let connectedTransports = new Map<string, SSEServerTransport>();
// Maps MCP transport sessionId → registered agent sessionId
let transportToAgent = new Map<string, string>();

let toolEventCounter = 0;

interface ToolEventPayload {
  tool: string;
  args: string;
  phase: 'complete' | 'error';
  durationMs: number;
  sessionId: string | null;
  agentType: string | null;
  agentModel: string | null;
  error?: string;
}

function broadcastToolEvent(payload: ToolEventPayload): void {
  broadcast('agent-event', {
    id: `mcp-tool-${++toolEventCounter}`,
    timestamp: Date.now(),
    source: 'mcp',
    type: payload.phase === 'error' ? 'tool_error' : 'tool_call',
    payload,
  });
}

/**
 * Compact JSON of the tool args for the Timeline. Truncated so a giant
 * `body` field on a spec-doc create doesn't drown the event log.
 */
function summarizeArgs(args: any): string {
  if (args == null) return '';
  try {
    const json = JSON.stringify(args);
    return json.length > 240 ? json.slice(0, 240) + '…' : json;
  } catch {
    return '[unserializable]';
  }
}

/**
 * Build a tool result with broadcast metadata so agents know the UI
 * was notified. `subscribers` is the number of WS + IPC clients that
 * received the message (0 means no UI is connected).
 */
function resultWithMeta(data: any, subscribers: number) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ ...data, _meta: { broadcast: true, subscribers } }, null, 2),
    }],
  };
}

/**
 * Look up agent metadata for an MCP transport session id, if it has
 * registered itself via `register_session`. We match by the most
 * recent active session for the transport — agents that never call
 * register_session show up as 'mcp-agent'.
 */
function inferAgentFromSession(sessionId: string | null): { type: string | null; model: string | null } {
  if (!sessionId) return { type: 'mcp-agent', model: null };
  // The session-service indexes by its OWN sessionId. The transport
  // session id is different. For now, fall back to the most recent
  // active session and assume it's the caller. Better wiring later.
  const sessions = sessionService.getActiveSessions();
  if (sessions.length === 0) return { type: 'mcp-agent', model: null };
  const latest = sessions[sessions.length - 1];
  return { type: latest.agentType ?? 'mcp-agent', model: latest.model ?? null };
}

/**
 * Build a fresh `McpServer` instance with all tools + resources
 * registered. Called **once per agent connection** — the SDK's
 * `Server.connect(transport)` is single-transport, so multi-agent
 * support requires one server instance per session. All instances
 * share the same module-level state (database, plan service,
 * sessionService, etc.); only the MCP transport binding is
 * per-session.
 *
 * Same process, same port — no ports / processes / network surface
 * are added by spawning multiple instances. This is purely an
 * in-memory bookkeeping refactor.
 */
function setupMcpServerInstance(): McpServer {
  const mcpServer = new McpServer(
    { name: 'codetrellis', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: 'CodeTrellis provides codebase architecture analysis. Use these tools to understand how files connect, search for symbols, and report your plans.',
    }
  );

  // Generic per-tool-call broadcast: every MCP tool invocation, from
  // any agent (Claude Code, Codex, Cursor, aider, custom) flows into
  // the same `agent-event` channel that the file-watcher and the
  // Claude Code session watcher use. Without this, the Agent Timeline
  // is silent for any agent that isn't Claude Code, even though the
  // MCP work is happening.
  const originalRegisterTool = (mcpServer.registerTool as any).bind(mcpServer);
  (mcpServer as any).registerTool = (name: string, config: any, handler: any) => {
    return originalRegisterTool(name, config, async (args: any, extra: any) => {
      const start = Date.now();
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const agentInfo = inferAgentFromSession(sessionId);
      try {
        const result = await handler(args, extra);
        broadcastToolEvent({
          tool: name,
          args: summarizeArgs(args),
          phase: 'complete',
          durationMs: Date.now() - start,
          sessionId,
          agentType: agentInfo.type,
          agentModel: agentInfo.model,
        });
        return result;
      } catch (err) {
        broadcastToolEvent({
          tool: name,
          args: summarizeArgs(args),
          phase: 'error',
          durationMs: Date.now() - start,
          sessionId,
          agentType: agentInfo.type,
          agentModel: agentInfo.model,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    });
  };

  // --- Tools ---

  mcpServer.registerTool(
    'search_symbols',
    {
      description: 'Search for functions, classes, interfaces, and other symbols across the codebase by name',
      inputSchema: {
        query: z.string().describe('Symbol name to search for (substring match)'),
      },
    },
    async ({ query }) => {
      const results = searchSymbols(query);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(results, null, 2),
        }],
      };
    }
  );

  mcpServer.registerTool(
    'get_dependencies',
    {
      description: 'Get what a file imports and what imports it. Returns incoming and outgoing dependency edges.',
      inputSchema: {
        file_path: z.string().describe('Absolute path to the file'),
      },
    },
    async ({ file_path }) => {
      const deps = getFileDependencies(file_path);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(deps, null, 2),
        }],
      };
    }
  );

  mcpServer.registerTool(
    'check_architecture',
    {
      description: 'Query the codebase dependency graph. Returns all file-to-file import edges, showing how the codebase is connected.',
      inputSchema: {
        query: z.string().optional().describe('Optional: filter edges by file path substring'),
      },
    },
    async ({ query }) => {
      let edges = getDependencyEdges();
      if (query) {
        edges = edges.filter(
          (e) => e.sourceRelative.includes(query) || e.targetRelative.includes(query)
        );
      }
      const stats = getDbStats();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ stats, edges }, null, 2),
        }],
      };
    }
  );

  mcpServer.registerTool(
    'list_cross_system_edges',
    {
      description: 'Cross-system edges — non-import couplings between files inferred from runtime patterns. Today: HTTP fetches in TS/JS matched against FastAPI/Flask routes in Python (more protocols coming: SQL refs, subprocess, env-configured URLs, OpenAPI contracts). Use this to see how the frontend talks to the backend even when no import edges exist.',
      inputSchema: {},
    },
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ stats: getCrossSystemStats(), edges: listCrossSystemEdges() }, null, 2),
        }],
      };
    }
  );

  // --- Plan Management Tools ---

  mcpServer.registerTool(
    'create_plan',
    {
      description: 'Create a new plan in CodeTrellis. Returns the plan UID. Use add_item or bulk_add_items to populate it with Objects (context pages) and Actions (work items).',
      inputSchema: {
        title: z.string().describe('Brief title of the plan'),
        description: z.string().optional().describe('Detailed description of what this plan achieves'),
        project_path: z.string().describe('Absolute path to the project this plan is for'),
      },
    },
    async ({ title, description, project_path }) => {
      const plan = planService.createPlan(
        { title, description: description || '', tasks: [] },
        'agent', 'mcp', project_path,
      );
      const n = broadcast('plan-created', { plan });
      saveNow(() => exportDatabase());
      return resultWithMeta({
        uid: plan.uid, title: plan.title, status: plan.status, projectPath: plan.projectPath,
      }, n);
    }
  );

  mcpServer.registerTool(
    'get_plan',
    {
      description: 'Read a plan by its UID. Returns plan metadata and a summary of its items (count by kind, status breakdown). Use list_items to browse the item tree.',
      inputSchema: { plan_uid: z.string().describe('Plan UID') },
    },
    async ({ plan_uid }) => {
      const plan = planService.getPlan(plan_uid);
      if (!plan) return { content: [{ type: 'text' as const, text: 'Plan not found' }] };
      const items = planItemService.listItemSummaries(plan_uid);
      const objectCount = items.filter((i) => i.kind === 'object').length;
      const actionCount = items.filter((i) => i.kind === 'action').length;
      const statusCounts: Record<string, number> = {};
      for (const i of items) {
        if (i.status) statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        uid: plan.uid, title: plan.title, description: plan.description,
        status: plan.status, projectPath: plan.projectPath,
        createdAt: plan.createdAt, updatedAt: plan.updatedAt,
        items: { total: items.length, objects: objectCount, actions: actionCount, byStatus: statusCounts },
      }, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'update_plan',
    {
      description: 'Update a plan (title, description, or status). Creates a new version snapshot.',
      inputSchema: {
        plan_uid: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['draft', 'review', 'approved', 'in_progress', 'completed', 'archived']).optional(),
      },
    },
    async ({ plan_uid, title, description, status }) => {
      planService.updatePlan(plan_uid, { title, description, status }, 'agent');
      const n = broadcast('plan-updated', { planUid: plan_uid });
      saveNow(() => exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid }, n);
    }
  );

  mcpServer.registerTool(
    'list_plans',
    {
      description: 'List plans, optionally filtered by project path or status. Returns lightweight summaries with V2 item counts. Use limit/offset for pagination.',
      inputSchema: {
        project_path: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Max plans to return (default 20)'),
        offset: z.number().int().min(0).optional().describe('Skip this many plans (default 0)'),
      },
    },
    async ({ project_path, status, limit, offset }) => {
      const all = planService.listPlans(project_path, status);
      const start = offset ?? 0;
      const end = start + (limit ?? 20);
      const page = all.slice(start, end);
      const summaries = page.map((p: any) => ({
        uid: p.uid, title: p.title, status: p.status, projectPath: p.projectPath,
        itemCount: planItemService.listItemSummaries(p.uid).length,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        total: all.length, offset: start, limit: limit ?? 20, plans: summaries,
      }, null, 2) }] };
    }
  );

  // V1 task/phase/doc tools removed — see docs/V2-MCP-MIGRATION.md.
  // Agents use add_item / update_item / bulk_add_items (Phase 15 §C) instead.

  // --- Plan File Sync (Phase 13 §A) ---

  mcpServer.registerTool(
    'export_plan_to_files',
    {
      description: 'Round-trip a plan to disk as YAML under `<projectRoot>/.codetrellis/plans/<slug>/`. Plans with V2 items export a nested `items/` tree (version 2); legacy plans export the old phases/tasks/docs layout. Idempotent — re-exporting overwrites the same files. Use this so plans can be committed to git and shared across devices / agents.',
      inputSchema: {
        plan_uid: z.string(),
        project_root: z.string().describe('Absolute path to the project repo root. The .codetrellis/ directory will be created inside it.'),
      },
    },
    async ({ plan_uid, project_root }) => {
      const { exportPlan } = planFileService;
      try {
        const result = exportPlan(plan_uid, project_root);
        broadcast('plan-exported', { planUid: plan_uid, planDir: result.planDir, files: result.files.length });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ planDir: result.planDir, fileCount: result.files.length }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    }
  );

  mcpServer.registerTool(
    'import_plan_from_files',
    {
      description: 'Read a plan directory (`.codetrellis/plans/<slug>/`) from disk and upsert it into the DB. Detects V2 format (version:2 or items/ directory) automatically — V2 imports create plan_items, V1 imports create legacy tasks/phases/docs. UID-based upsert is idempotent. Use after `git pull` to sync external changes.',
      inputSchema: {
        plan_dir: z.string().describe('Absolute path to the plan directory (or directly to plan.yaml).'),
      },
    },
    async ({ plan_dir }) => {
      const { importPlan } = planFileService;
      try {
        const result = importPlan(plan_dir);
        broadcast('plan-imported', { planUid: result.plan.uid, source: plan_dir });
        // Broadcast V2 item events so the UI updates in real time
        if (result.version === 2) {
          for (const item of result.items) {
            broadcast('plan-item-created', { item });
          }
        }
        saveNow(() => exportDatabase());
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              plan: { uid: result.plan.uid, title: result.plan.title },
              version: result.version,
              ...(result.version === 2
                ? { itemCount: result.items.length }
                : { phaseCount: result.phases.length, taskCount: result.tasks.length, docCount: result.docs.length }),
              warnings: result.warnings,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    }
  );

  mcpServer.registerTool(
    'discover_plan_files',
    {
      description: 'List every plan directory under `<project_root>/.codetrellis/plans/`. Used to find plans that came in via `git pull` or that another tool authored. Returns absolute paths.',
      inputSchema: { project_root: z.string() },
    },
    async ({ project_root }) => {
      const { discoverPlanDirs } = planFileService;
      const dirs = discoverPlanDirs(project_root);
      return { content: [{ type: 'text' as const, text: JSON.stringify(dirs, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'unlink_plan_from_files',
    {
      description: 'Remove a plan\'s on-disk directory under `.codetrellis/plans/<slug>/`. The DB rows survive — this is the "Shared → Local" toggle. Use this to stop write-through-syncing a plan to the project repo (e.g. for a private brainstorm you don\'t want committed).',
      inputSchema: {
        plan_uid: z.string(),
        project_root: z.string(),
      },
    },
    async ({ plan_uid, project_root }) => {
      const { unlinkPlan } = planFileService;
      try {
        const result = unlinkPlan(plan_uid, project_root);
        broadcast('plan-unlinked', { planUid: plan_uid });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    }
  );

  mcpServer.registerTool(
    'publish_plan_as_template',
    {
      description: 'Snapshot a plan as a reusable template under `<project_root>/.codetrellis/templates/<template_id>/`. Plans with V2 items produce a template with a nested `items` tree; legacy plans produce the old phases/docs shape. Strips runtime fields (statuses, assignees). The result can be shared via git.',
      inputSchema: {
        plan_uid: z.string(),
        project_root: z.string(),
        template_id: z.string().describe('Lowercase slug, alphanumeric + hyphens (e.g. "company-mass-refactor").'),
        label: z.string().optional().describe('Human-readable name shown in the picker. Defaults to the plan title.'),
        short_description: z.string().optional(),
        long_description: z.string().optional(),
        default_title: z.string().optional().describe('Default plan title when the template is applied. May contain `{{name}}` etc. for placeholder substitution.'),
        default_plan_description: z.string().optional(),
      },
    },
    async ({ plan_uid, project_root, template_id, label, short_description, long_description, default_title, default_plan_description }) => {
      // publishPlanAsTemplate already imported at top of file
      try {
        const result = publishPlanAsTemplate({
          planUid: plan_uid,
          projectRoot: project_root,
          templateId: template_id,
          label,
          shortDescription: short_description,
          longDescription: long_description,
          defaultTitle: default_title,
          defaultPlanDescription: default_plan_description,
        });
        broadcast('plan-template-published', { templateId: template_id, templateDir: result.templateDir });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    }
  );

  // --- Plan Templates (Phase 12 §G) ---

  mcpServer.registerTool(
    'list_plan_templates',
    {
      description: 'List the available plan templates. Includes built-ins, user-global templates from `~/.codetrellis/templates/`, and project-local templates from `<project_root>/.codetrellis/templates/` when project_root is provided. Each template seeds a plan + phases + spec docs in one go.',
      inputSchema: {
        project_root: z.string().optional().describe('Project root for picking up team-published templates from `.codetrellis/templates/`. Optional — without it, only built-ins + user-global templates are returned.'),
      },
    },
    async ({ project_root }) => {
      return { content: [{ type: 'text' as const, text: JSON.stringify(listTemplates(project_root), null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'create_plan_from_template',
    {
      description: 'Create a new plan from a template in one call. V2 templates (with items tree) create V2 plan_items directly; legacy templates create phases + docs. Use list_plan_templates to pick a template_id. Pass `placeholder_values` for templates with `{{key}}` placeholders.',
      inputSchema: {
        template_id: z.string().describe('e.g. "mass-refactor"'),
        project_path: z.string(),
        title: z.string().optional().describe('Override the template default title'),
        description: z.string().optional().describe('Override the template default description'),
        placeholder_values: z.record(z.string(), z.string()).optional().describe('Values for `{{key}}` placeholders declared by the template (Phase 13 §C). Missing keys fall back to the placeholder default.'),
      },
    },
    async ({ template_id, project_path, title, description, placeholder_values }, extra: any) => {
      // Attribute the seeded plan to the actual caller when we know
      // who they are. This shows up in the human's plan list as
      // "authored by claude-code" instead of "agent".
      const sessions = sessionService.getActiveSessions();
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const session = sessionId ? sessions.find((s) => s.sessionId === sessionId) : null;
      const author = session?.agentType ?? 'agent';

      try {
        const result = applyTemplate({
          templateId: template_id,
          projectPath: project_path,
          title,
          description,
          author,
          authorType: 'mcp',
          placeholderValues: placeholder_values,
        });
        broadcast('plan-created', { plan: result.plan });
        if (result.version === 2) {
          for (const item of result.items) broadcast('plan-item-created', { item });
        } else {
          for (const phase of result.phases) broadcast('plan-phase-created', { phase });
          for (const doc of result.docs) broadcast('plan-doc-created', { doc });
        }
        saveNow(() => exportDatabase());
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              plan: result.plan,
              version: result.version,
              ...(result.version === 2
                ? { itemCount: result.items.length, hint: 'Use list_items(plan_uid) to browse the plan tree.' }
                : { phaseCount: result.phases.length, docCount: result.docs.length, taskCount: result.tasks.length }),
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to apply template: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  // --- Comment Tools ---

  mcpServer.registerTool(
    'add_comment',
    {
      description: 'Leave a comment on a plan or task. Use this to communicate with the user or other agents.',
      inputSchema: {
        target_uid: z.string().describe('Plan UID or Task UID to comment on'),
        body: z.string().describe('Comment text (markdown supported)'),
        comment_type: z.enum(['comment', 'suggestion', 'approval', 'concern', 'status_update']).optional(),
        parent_uid: z.string().optional().describe('Parent comment UID for threading'),
      },
    },
    async ({ target_uid, body, comment_type, parent_uid }) => {
      const comment = commentService.addComment('plan', target_uid, 'agent', 'mcp', body, comment_type || 'comment', parent_uid);
      broadcast('comment-added', { comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Comment added to ${target_uid}` }] };
    }
  );

  mcpServer.registerTool(
    'get_comments',
    {
      description: 'Read all comments on a plan or task.',
      inputSchema: { target_uid: z.string() },
    },
    async ({ target_uid }) => {
      const comments = commentService.getComments(target_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }] };
    }
  );

  // --- Session Tools ---

  mcpServer.registerTool(
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
      // Prefer the caller's actual transport sessionId so multiple
      // simultaneous agents stay attributed correctly. Fall back to a
      // synthetic id only if the transport context is missing.
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? `mcp-${Date.now()}`;
      sessionService.registerSession(sessionId, agent_type, model, capabilities);
      broadcast('session-registered', { sessionId, agentType: agent_type, model, capabilities });
      broadcast('mcp-session-changed', { reason: 'register', sessionId });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Session registered: ${sessionId} (${agent_type}${model ? ` / ${model}` : ''}${capabilities?.length ? ` with ${capabilities.length} capabilities` : ''})` }] };
    }
  );

  mcpServer.registerTool(
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
        sessionService.setActivePlan(sessionId, plan_uid);
        broadcast('mcp-session-changed', { reason: 'set_active_plan', sessionId, planUid: plan_uid });
      } else {
        const sessions = sessionService.getActiveSessions();
        if (sessions.length > 0) {
          sessionService.setActivePlan(sessions[sessions.length - 1].sessionId, plan_uid);
          broadcast('mcp-session-changed', { reason: 'set_active_plan', planUid: plan_uid });
        }
      }
      const n = broadcast('ui-navigate', { target: 'plan', planUid: plan_uid });
      return resultWithMeta({ ok: true, planUid: plan_uid, navigated: true }, n);
    }
  );

  // --- Deviation Tools ---

  mcpServer.registerTool(
    'get_deviations',
    {
      description: 'Get all deviations between a plan and the actual codebase state. Shows where reality diverges from the plan.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const devs = getDeviations(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(devs, null, 2) }] };
    }
  );

  mcpServer.registerTool(
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
        resolveDeviation(d.id, d.action);
      }
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Resolved ${deviations.length} deviations for plan ${plan_uid}` }] };
    }
  );

  mcpServer.registerTool(
    'detect_deviations',
    {
      description: 'Run deviation detection for a plan — compares plan expectations against actual codebase state.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const devs = detectDeviations(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ detected: devs.length, deviations: devs }, null, 2) }] };
    }
  );

  // --- Proposed Changes Tools (Phase 12 §B) ---

  mcpServer.registerTool(
    'list_proposed_changes',
    {
      description: 'Granular CRUD feed projected from a plan\'s tasks: every affected file, symbol_spec, new_connection, and removed_connection becomes one ProposedChange row with operation (add/modify/remove/move), kind (file/symbol/connection), target, and a drift status (planned / in_progress / satisfied / missing / unexpected). Use this instead of walking task fields by hand to ask "what\'s left in this plan?".',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const changes = planChangesService.listProposedChanges(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(changes, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'get_changes_summary',
    {
      description: 'Aggregate counts for a plan\'s proposed changes — total + breakdown by drift status, kind, and operation. Use this to get a one-line "12/18 satisfied" picture without pulling every change row.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const summary = planChangesService.summarizeChanges(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'get_change_status',
    {
      description: 'Fetch a single ProposedChange (by id from list_proposed_changes) with its current drift status freshly computed against the live database.',
      inputSchema: {
        plan_uid: z.string(),
        change_id: z.string(),
      },
    },
    async ({ plan_uid, change_id }) => {
      const change = planChangesService.getChange(plan_uid, change_id);
      if (!change) return { content: [{ type: 'text' as const, text: `Change ${change_id} not found in plan ${plan_uid}` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(change, null, 2) }] };
    }
  );

  // --- Trellis Tools ---

  mcpServer.registerTool(
    'get_drift_report',
    {
      description: 'Check if you are still following the plan. Compares the baseline snapshot (captured at plan approval) against the current live state. Returns what has changed, what is on track, and what has drifted. Phase 14 §A also surfaces task comment activity since `since_ms` (or since the baseline snapshot when omitted) so a returning agent can see what humans / other agents have said while it was away.',
      inputSchema: {
        plan_uid: z.string(),
        since_ms: z.number().int().optional().describe('Epoch ms cutoff for "comment activity since". Defaults to the baseline snapshot timestamp.'),
      },
    },
    async ({ plan_uid, since_ms }) => {
      // Find the baseline snapshot for this plan
      const snapshots = listSnapshots(plan_uid);
      if (snapshots.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No baseline snapshot found for this plan. Approve the plan first to capture a baseline.' }] };
      }
      const diff = computeTrellisDiff(snapshots[0].id);
      if (!diff) {
        return { content: [{ type: 'text' as const, text: 'Could not compute diff.' }] };
      }

      // V2 item progress + fallback to V1 tasks for legacy plans
      const plan = planService.getPlan(plan_uid);
      const items = planItemService.listItemSummaries(plan_uid);
      const v2Actions = items.filter((i) => i.kind === 'action');
      const completedItems = v2Actions.filter((i) => i.status === 'done').length;
      const totalItems = v2Actions.length;
      // Fall back to V1 task counts if no V2 items exist
      const completedTasks = totalItems > 0 ? completedItems : (plan?.tasks.filter((t) => t.status === 'done').length || 0);
      const totalTasks = totalItems > 0 ? totalItems : (plan?.tasks.length || 0);

      // Phase 14 §A: comment activity since `since_ms` (or the baseline
      // snapshot's createdAt when not supplied). Surfaces blockers /
      // progress / questions a returning agent shouldn't miss.
      const since = since_ms ?? snapshots[0].createdAt;
      const recentComments = commentService.listCommentsForPlanSince(plan_uid, since);
      const blockers = recentComments.filter((c) => c.kind === 'blocker');
      const questions = recentComments.filter((c) => c.kind === 'question');
      const progressUpdates = recentComments.filter((c) => c.kind === 'progress');

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
    }
  );

  mcpServer.registerTool(
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
      const snapshot = captureCurrentTrellis(project_path, plan_uid, name);
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Checkpoint "${name}" captured (snapshot #${snapshot.id}, ${snapshot.filesJson ? JSON.parse(snapshot.filesJson).length : 0} files)` }] };
    }
  );

  // Legacy tool — kept for backward compatibility
  mcpServer.registerTool(
    'report_plan',
    {
      description: '[Legacy] Report a plan. Creates plan metadata and V2 Actions for each step. Prefer create_plan + bulk_add_items.',
      inputSchema: {
        title: z.string(),
        steps: z.array(z.object({
          description: z.string(),
          files: z.array(z.string()).optional(),
        })),
      },
    },
    async ({ title, steps }) => {
      const plan = planService.createPlan(
        { title, description: '', tasks: [] },
        'agent', 'mcp', '',
      );
      // Create V2 items for each step
      for (const step of steps) {
        planItemService.createItem({
          planUid: plan.uid,
          kind: 'action',
          parentUid: null,
          title: step.description,
          body: '',
          template: null,
          status: 'pending',
          scopePath: null,
          fileSpecs: step.files?.map((f) => ({ path: f, action: 'modify' as const })),
          author: 'agent',
          authorType: 'mcp',
        });
      }
      const n = broadcast('plan-created', { plan });
      saveNow(() => exportDatabase());
      return resultWithMeta({ uid: plan.uid, title, steps: steps.length }, n);
    }
  );

  mcpServer.registerTool(
    'check_conformity',
    {
      description: 'Check if proposed imports would violate architectural boundaries (circular dependencies, layer violations)',
      inputSchema: {
        proposed_imports: z.array(z.object({
          from: z.string().describe('File that would contain the import'),
          importing: z.string().describe('File being imported'),
        })).describe('List of proposed import relationships to check'),
      },
    },
    async ({ proposed_imports }) => {
      const edges = getDependencyEdges();
      const edgeSet = new Set(edges.map((e) => `${e.sourceRelative}->${e.targetRelative}`));
      const violations: Array<{ rule: string; message: string }> = [];

      for (const imp of proposed_imports) {
        // Check for circular dependency
        const reverse = `${imp.importing}->${imp.from}`;
        if (edgeSet.has(reverse)) {
          violations.push({
            rule: 'circular-dependency',
            message: `Adding ${imp.from} -> ${imp.importing} would create a circular dependency (${imp.importing} already imports ${imp.from})`,
          });
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            conformant: violations.length === 0,
            violations,
            checkedImports: proposed_imports.length,
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================================================
  // Phase 15 §C — unified Object/Action MCP surface.
  //
  // These tools talk to `plan-item-service` and treat Objects (context)
  // and Actions (graph-anchored work items) as siblings in one tree.
  // V1 task/phase/doc tools have been retired — this is the canonical
  // surface for all plan item operations.
  // ===========================================================================

  // Reusable schema for the new file-edit (M2: line/symbol-precision).
  const fileEditSchema = z.object({
    lineRange: z.object({
      start: z.number().int().min(1),
      end: z.number().int().min(1),
    }).optional(),
    symbol: z.string().optional().describe('AST symbol name; resolves via the symbols table.'),
    instruction: z.string().describe('Free-form natural language for the agent.'),
    intent: z.enum(['add', 'modify', 'remove', 'replace']).optional(),
  });

  const itemFileSpecSchema = z.object({
    path: z.string(),
    action: z.enum(['create', 'modify', 'delete', 'move']),
    moveTo: z.string().optional(),
    isDir: z.boolean().optional(),
    description: z.string().optional(),
    edits: z.array(fileEditSchema).optional().describe('M2 per-file granular edits (line/symbol-pinned).'),
  });

  const planItemEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
  });

  const planItemKindEnum = z.enum(['object', 'action']);
  const taskStatusEnum = z.enum(['pending', 'assigned', 'in_progress', 'done', 'blocked', 'skipped']);
  const itemCommentKindEnum = z.enum(['note', 'blocker', 'progress', 'question']);
  const attachmentKindEnum = z.enum(['url', 'image', 'file_ref', 'code_block', 'transcript']);

  // Tiny utility — pull author identity from the MCP transport's session.
  function authorFromExtra(extra: any): { author: string; authorType: string } {
    const sessionId = extra?.sessionInfo?.sessionId
      ?? extra?.requestInfo?.headers?.['mcp-session-id']
      ?? null;
    const sessions = sessionService.getActiveSessions();
    const session = sessionId ? sessions.find((s) => s.sessionId === sessionId) : null;
    const author = session?.agentType ?? 'agent';
    return { author, authorType: 'mcp' };
  }

  // --- add_item ---------------------------------------------------------
  mcpServer.registerTool(
    'add_item',
    {
      description:
        'Create an Object (durable context) or Action (graph-anchored work item) inside a plan. ' +
        'Trees mix freely: Action can have an Object child (its references), Object can have an Action child (an embedded todo). ' +
        'Action-only fields (status, fileSpecs, scope_path, …) are silently ignored on Objects. Phase 15 §C unified surface.',
      inputSchema: {
        plan_uid: z.string(),
        kind: planItemKindEnum,
        parent_uid: z.string().optional().describe('Omit for top-level. Trees mix Object + Action.'),
        title: z.string(),
        body: z.string().optional().describe('Markdown body.'),
        template: z.string().optional().describe(
          'Object: executive_summary | references | ux_journey | competitor_analysis | architecture | patterns | …'
          + ' Action: phase | leaf | custom.'
        ),
        sort_order: z.number().int().optional().describe('Pinned position; auto-derived if omitted.'),
        // Action-only
        status: taskStatusEnum.optional(),
        scope_path: z.string().optional(),
        file_specs: z.array(itemFileSpecSchema).optional(),
        new_connections: z.array(planItemEdgeSchema).optional(),
        removed_connections: z.array(planItemEdgeSchema).optional(),
        dependencies: z.array(z.string()).optional().describe('Other Action uids that must complete first.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.createItem({
        planUid: args.plan_uid,
        kind: args.kind,
        parentUid: args.parent_uid ?? null,
        sortOrder: args.sort_order,
        title: args.title,
        body: args.body ?? '',
        template: args.template ?? null,
        status: args.status,
        scopePath: args.scope_path ?? null,
        fileSpecs: args.file_specs,
        newConnections: args.new_connections,
        removedConnections: args.removed_connections,
        dependencies: args.dependencies,
        author: id.author,
        authorType: id.authorType,
      });
      const n = broadcast('plan-item-created', { planUid: item.planUid, item });
      saveNow(() => exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  // --- bulk_add_items ---------------------------------------------------
  mcpServer.registerTool(
    'bulk_add_items',
    {
      description:
        'Create multiple Objects and/or Actions in one call. Items are created in array order. ' +
        'Use _temp_uid in an item and reference it as parent_uid in later items to build nested trees in a single call. ' +
        'Returns the created items with their real UIDs.',
      inputSchema: {
        plan_uid: z.string(),
        items: z.array(z.object({
          _temp_uid: z.string().optional().describe('Temporary ID for referencing as parent_uid in later items in this batch'),
          kind: planItemKindEnum,
          parent_uid: z.string().optional().describe('Real UID or _temp_uid of a preceding item in this batch'),
          title: z.string(),
          body: z.string().optional(),
          template: z.string().optional(),
          sort_order: z.number().int().optional(),
          status: taskStatusEnum.optional(),
          scope_path: z.string().optional(),
          file_specs: z.array(itemFileSpecSchema).optional(),
          new_connections: z.array(planItemEdgeSchema).optional(),
          removed_connections: z.array(planItemEdgeSchema).optional(),
          dependencies: z.array(z.string()).optional(),
        })),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const tempToReal = new Map<string, string>();
      const created: any[] = [];
      let lastN = 0;
      for (const raw of args.items) {
        let parentUid = raw.parent_uid ?? null;
        if (parentUid && tempToReal.has(parentUid)) {
          parentUid = tempToReal.get(parentUid)!;
        }
        const item = planItemService.createItem({
          planUid: args.plan_uid,
          kind: raw.kind,
          parentUid,
          sortOrder: raw.sort_order,
          title: raw.title,
          body: raw.body ?? '',
          template: raw.template ?? null,
          status: raw.status,
          scopePath: raw.scope_path ?? null,
          fileSpecs: raw.file_specs,
          newConnections: raw.new_connections,
          removedConnections: raw.removed_connections,
          dependencies: raw.dependencies,
          author: id.author,
          authorType: id.authorType,
        });
        if (raw._temp_uid) tempToReal.set(raw._temp_uid, item.uid);
        const n = broadcast('plan-item-created', { planUid: item.planUid, item });
        created.push({ _temp_uid: raw._temp_uid ?? null, uid: item.uid, title: item.title, kind: item.kind });
        lastN = n;
      }
      saveNow(() => exportDatabase());
      return resultWithMeta({ created: created.length, items: created }, lastN);
    },
  );

  // --- get_item ---------------------------------------------------------
  mcpServer.registerTool(
    'get_item',
    {
      description: 'Fetch a single plan_items row without children / attachments / comments. Lightweight. Use read_item_full for the bundle.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const item = planItemService.getItem(uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${uid} not found` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
    },
  );

  // --- read_item_full ---------------------------------------------------
  mcpServer.registerTool(
    'read_item_full',
    {
      description:
        'One round-trip context bundle: item + parent (if any) + immediate children + attachments + comments + recent versions. ' +
        'Use this when picking up an Action so you don\'t need separate calls for context. Replaces read_task_full for V2.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const item = planItemService.getItem(uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${uid} not found` }] };
      const parent = item.parentUid ? planItemService.getItem(item.parentUid) : null;
      const children = planItemService.getChildren(item.planUid, uid);
      const attachments = taskAttachmentsService.listItemAttachments(uid);
      const comments = commentService.listItemComments(uid);
      const versions = planItemService.listItemVersions(uid).slice(0, 10);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ item, parent, children, attachments, comments, versions }, null, 2),
        }],
      };
    },
  );

  // --- update_item ------------------------------------------------------
  mcpServer.registerTool(
    'update_item',
    {
      description:
        'Update any field on an Object or Action. Content edits (body, title, status, fileSpecs, …) write a row to plan_item_versions; ' +
        'structural edits (parent_uid, sort_order) emit plan_events but skip the version log. ' +
        'Pass empty string for nullable fields (parent_uid, scope_path, blocked_reason) to clear.',
      inputSchema: {
        uid: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        template: z.string().optional(),
        // Action-only
        status: taskStatusEnum.optional(),
        assignee: z.string().optional(),
        progress_percent: z.number().int().min(0).max(100).optional(),
        blocked_reason: z.string().optional(),
        scope_path: z.string().optional(),
        file_specs: z.array(itemFileSpecSchema).optional(),
        new_connections: z.array(planItemEdgeSchema).optional(),
        removed_connections: z.array(planItemEdgeSchema).optional(),
        dependencies: z.array(z.string()).optional(),
        // Structural
        parent_uid: z.string().optional().describe('Re-parent. Empty string detaches to top-level.'),
        sort_order: z.number().int().optional(),
        change_summary: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.updateItem(args.uid, {
        title: args.title,
        body: args.body,
        template: args.template,
        status: args.status,
        assignee: args.assignee,
        progressPercent: args.progress_percent,
        blockedReason: args.blocked_reason === '' ? null : args.blocked_reason,
        scopePath: args.scope_path === '' ? null : args.scope_path,
        fileSpecs: args.file_specs,
        newConnections: args.new_connections,
        removedConnections: args.removed_connections,
        dependencies: args.dependencies,
        parentUid: args.parent_uid === undefined ? undefined : (args.parent_uid === '' ? null : args.parent_uid),
        sortOrder: args.sort_order,
        changeSummary: args.change_summary,
        author: id.author,
        authorType: id.authorType,
      });
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      const n = broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: args });
      saveNow(() => exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  // --- move_item --------------------------------------------------------
  mcpServer.registerTool(
    'move_item',
    {
      description: 'Re-parent and/or reorder an item. Single plan_events row written for the combined move.',
      inputSchema: {
        uid: z.string(),
        new_parent_uid: z.string().optional().describe('Empty string detaches to top-level.'),
        new_sort_order: z.number().int().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.moveItem(args.uid, {
        newParentUid: args.new_parent_uid === undefined ? undefined : (args.new_parent_uid === '' ? null : args.new_parent_uid),
        newSortOrder: args.new_sort_order,
        author: id.author,
        authorType: id.authorType,
      });
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      const n = broadcast('plan-item-moved', {
        planUid: item.planUid,
        itemUid: item.uid,
        toParentUid: item.parentUid,
        sortOrder: item.sortOrder,
      });
      saveNow(() => exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  // --- delete_item ------------------------------------------------------
  mcpServer.registerTool(
    'delete_item',
    {
      description:
        'Delete an item. Default cascades to descendants. The full subtree is snapshotted in the plan_events row\'s ' +
        'before_state so a future restore_item can put it back. Append-only soft-delete.',
      inputSchema: {
        uid: z.string(),
        cascade: z.boolean().optional().describe('Default true. Pass false to fail the call when children exist.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const target = planItemService.getItem(args.uid);
      if (!target) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      if (args.cascade === false) {
        const children = planItemService.getChildren(target.planUid, target.uid);
        if (children.length > 0) {
          return { content: [{ type: 'text' as const, text: `Item has ${children.length} children; pass cascade=true to remove the subtree.` }] };
        }
      }
      const cascadedUids = planItemService.deleteItem(args.uid, {
        cascade: args.cascade !== false,
        author: id.author,
        authorType: id.authorType,
      });
      const n = broadcast('plan-item-deleted', { planUid: target.planUid, itemUid: args.uid, cascadedUids });
      saveNow(() => exportDatabase());
      return resultWithMeta({ ok: true, deleted: cascadedUids }, n);
    },
  );

  // --- claim_item -------------------------------------------------------
  mcpServer.registerTool(
    'claim_item',
    {
      description:
        'Atomically claim an Action (only succeeds if status=pending and unclaimed). Errors politely on Objects. ' +
        'Returns full item context (item + parent + children + attachments + comments) in the success payload, ' +
        'plus a `conflicts` list when other in-progress Actions touch overlapping files. Replaces claim_task for V2. ' +
        'Respects claim policies (human-only, assigned, agent-type restrictions) and skill requirements.',
      inputSchema: {
        uid: z.string(),
        agent_type: z.string().optional(),
        model: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      // Fetch agent capabilities from the session for skill matching
      const capabilities = sessionId ? sessionService.getSessionCapabilities(sessionId) : undefined;
      const result = planItemService.claimItem(
        args.uid,
        args.agent_type ?? id.author,
        args.agent_type ?? 'mcp',
        args.model,
        capabilities,
      );
      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }
      const item = planItemService.getItem(args.uid);
      const parent = item?.parentUid ? planItemService.getItem(item.parentUid) : null;
      const children = item ? planItemService.getChildren(item.planUid, item.uid) : [];
      const attachments = taskAttachmentsService.listItemAttachments(args.uid);
      const comments = commentService.listItemComments(args.uid);
      let n = 0;
      if (item) {
        n = broadcast('plan-item-claimed', {
          planUid: item.planUid,
          itemUid: item.uid,
          agentId: args.agent_type ?? id.author,
          agentType: args.agent_type ?? 'mcp',
        });
        if (result.conflicts) {
          broadcast('conflict-detected', { planUid: item.planUid, itemUid: item.uid, message: result.conflicts.join('; ') });
        }
      }
      saveNow(() => exportDatabase());
      const message = result.conflicts
        ? `Item claimed. WARNING: ${result.conflicts.join('; ')}`
        : `Item ${args.uid} claimed.`;
      return resultWithMeta({ ok: true, message, conflicts: result.conflicts ?? null, item, parent, children, attachments, comments }, n);
    },
  );

  // --- get_next_item (17.K) ---------------------------------------------
  mcpServer.registerTool(
    'get_next_item',
    {
      description:
        'Get the next claimable Action from a plan (V2). Respects dependency order and approval gates. ' +
        'When an approval gate blocks the next item, returns a `gated` payload telling you to wait.',
      inputSchema: {
        plan_uid: z.string(),
        parent_uid: z.string().optional().describe('Scope to children of a specific item. Omit for all.'),
      },
    },
    async (args) => {
      const parentFilter = args.parent_uid === undefined
        ? undefined
        : (args.parent_uid === '' ? null : args.parent_uid);
      const result = planItemService.getNextItem(args.plan_uid, parentFilter);
      if (result.gated) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              available: false,
              reason: result.gated.reason,
              gated_item_uid: result.gated.itemUid,
              gated_item_title: result.gated.itemTitle,
            }, null, 2),
          }],
        };
      }
      if (!result.item) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No items available — all claimed, completed, or blocked by dependencies.',
          }],
        };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.item, null, 2) }] };
    },
  );

  // --- approve_gate (17.K) ----------------------------------------------
  mcpServer.registerTool(
    'approve_gate',
    {
      description:
        'Human-only: approve an approval gate on a completed item, allowing the next sibling to be claimed. ' +
        'This clears the gate by marking the item as approved (sets requiresApproval to false after review).',
      inputSchema: {
        uid: z.string().describe('The uid of the completed item whose gate should be cleared.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: 'Item not found.' }] };
      if (!item.requiresApproval) {
        return { content: [{ type: 'text' as const, text: 'This item does not have an approval gate.' }] };
      }
      planItemService.updateItem(args.uid, {
        requiresApproval: false,
        author: id.author,
        authorType: id.authorType,
        changeSummary: 'Approval gate cleared',
      });
      const n = broadcast('plan-item-updated', { planUid: item.planUid, itemUid: args.uid, changes: { requiresApproval: false } });
      saveNow(() => exportDatabase());
      return resultWithMeta({ ok: true, itemUid: args.uid, title: item.title, gateCleared: true }, n);
    },
  );

  // --- list_items -------------------------------------------------------
  mcpServer.registerTool(
    'list_items',
    {
      description:
        'Query items in a plan. Returns title + kind + status + sortOrder + childCount per item (no bodies). ' +
        'Filter by parent_uid (one level), kind, status, or title substring. Use limit/offset for large plans.',
      inputSchema: {
        plan_uid: z.string(),
        parent_uid: z.string().optional().describe('Pass empty string for top-level only. Omit to get the whole plan.'),
        kind: planItemKindEnum.optional(),
        status: taskStatusEnum.optional().describe('Filter to items with this status'),
        title_contains: z.string().optional().describe('Case-insensitive substring match on title'),
        limit: z.number().int().min(1).max(500).optional().describe('Max items to return (default 100)'),
        offset: z.number().int().min(0).optional().describe('Skip this many items (default 0)'),
      },
    },
    async (args) => {
      let all = planItemService.listItemSummaries(args.plan_uid);
      if (args.parent_uid !== undefined) {
        const targetParent = args.parent_uid === '' ? null : args.parent_uid;
        all = all.filter((i) => i.parentUid === targetParent);
      }
      if (args.kind) all = all.filter((i) => i.kind === args.kind);
      if (args.status) all = all.filter((i) => i.status === args.status);
      if (args.title_contains) {
        const q = args.title_contains.toLowerCase();
        all = all.filter((i) => i.title.toLowerCase().includes(q));
      }
      const total = all.length;
      const start = args.offset ?? 0;
      const end = start + (args.limit ?? 100);
      const page = all.slice(start, end);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ total, offset: start, limit: args.limit ?? 100, items: page }, null, 2) }] };
    },
  );

  // --- search_items -----------------------------------------------------
  mcpServer.registerTool(
    'search_items',
    {
      description:
        'Search item titles and bodies within a plan. Returns matches with a short excerpt around the hit. ' +
        'Case-insensitive substring match.',
      inputSchema: {
        plan_uid: z.string(),
        query: z.string().describe('Search string (case-insensitive substring)'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      },
    },
    async ({ plan_uid, query, limit }) => {
      const db = (await import('../services/database')).getDb();
      const q = `%${query}%`;
      const r = db.exec(
        `SELECT uid, title, body, kind, status, parent_uid FROM plan_items
         WHERE plan_uid = ? AND (title LIKE ? COLLATE NOCASE OR body LIKE ? COLLATE NOCASE)
         ORDER BY updated_at DESC
         LIMIT ?`,
        [plan_uid, q, q, limit ?? 20],
      );
      if (!r[0]) return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results: [] }, null, 2) }] };
      const results = r[0].values.map((row: any[]) => {
        const body = (row[2] as string) || '';
        const lowerBody = body.toLowerCase();
        const idx = lowerBody.indexOf(query.toLowerCase());
        const excerptStart = Math.max(0, idx - 60);
        const excerptEnd = Math.min(body.length, idx + query.length + 60);
        const excerpt = idx >= 0
          ? (excerptStart > 0 ? '...' : '') + body.slice(excerptStart, excerptEnd) + (excerptEnd < body.length ? '...' : '')
          : '';
        return { uid: row[0], title: row[1], excerpt, kind: row[3], status: row[4], parentUid: row[5] };
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results }, null, 2) }] };
    },
  );

  // --- get_plan_timeline ------------------------------------------------
  mcpServer.registerTool(
    'get_plan_timeline',
    {
      description:
        'Read the plan_events log — every structural mutation (item created/moved/deleted/renamed/reparented/reordered/status_changed/restored). ' +
        'Drives the activity rail and the timeline scrubber. Filter with since_ms / kinds / limit.',
      inputSchema: {
        plan_uid: z.string(),
        since_ms: z.number().int().optional(),
        kinds: z.array(z.string()).optional().describe('Filter to specific event types.'),
        limit: z.number().int().min(1).max(2000).optional(),
      },
    },
    async (args) => {
      const events = planEventService.listPlanEvents(args.plan_uid, {
        sinceMs: args.since_ms,
        eventTypes: args.kinds as any,
        limit: args.limit,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(events, null, 2) }] };
    },
  );

  // --- restore_item_version --------------------------------------------
  mcpServer.registerTool(
    'restore_item_version',
    {
      description:
        'Restore an item to a prior version from plan_item_versions. Writes a new version row and emits a plan_events: item_restored event.',
      inputSchema: {
        uid: z.string(),
        version: z.number().int().min(1),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.restoreItemVersion(args.uid, args.version, id.author, id.authorType);
      if (!item) {
        return { content: [{ type: 'text' as const, text: `Could not restore — item or version not found.` }] };
      }
      const n = broadcast('plan-item-version-saved', { planUid: item.planUid, itemUid: item.uid, restoredFrom: args.version });
      saveNow(() => exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  // --- Item-context tools (renamed from task-context) ------------------
  // These wrap the same underlying surface (commentService / progress
  // updates / blocker flag / attachments) but write with target_type='item'
  // and broadcast plan-item-comment-added / plan-item-progress events.

  mcpServer.registerTool(
    'list_item_comments',
    {
      description:
        'Read all comments on an item, ordered chronologically. Each comment carries kind (note/blocker/progress/question) + source (agent/human) + optional metadata (e.g. progressPercent). ' +
        'Replaces list_task_comments for V2.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const comments = commentService.listItemComments(uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'add_item_comment',
    {
      description:
        'Leave a structured comment on an item. kind=note/blocker/progress/question; source=agent (auto-set). ' +
        'For blockers prefer set_item_blocked (which also flips status); for progress prefer update_item_progress (which also stamps progressPercent on the item).',
      inputSchema: {
        uid: z.string(),
        kind: itemCommentKindEnum,
        body: z.string(),
        parent_comment_uid: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      const legacyType =
        args.kind === 'progress' ? 'status_update' :
        args.kind === 'blocker' ? 'concern' :
        args.kind === 'question' ? 'suggestion' : 'comment';
      const comment = commentService.addComment('item', args.uid, id.author, id.authorType, args.body, {
        kind: args.kind,
        source: 'agent',
        commentType: legacyType,
        parentUid: args.parent_comment_uid,
      });
      const n = broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      saveNow(() => exportDatabase());
      return resultWithMeta(comment, n);
    },
  );

  mcpServer.registerTool(
    'update_item_progress',
    {
      description:
        'Mid-task progress heartbeat. Updates the Action\'s progressPercent column AND emits a kind=progress comment with metadata.progressPercent. ' +
        'Call frequently during long Actions so the human sees movement.',
      inputSchema: {
        uid: z.string(),
        percent: z.number().int().min(0).max(100),
        message: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      if (item.kind !== 'action') {
        return { content: [{ type: 'text' as const, text: 'Progress only applies to Actions (not Objects).' }] };
      }
      planItemService.updateItem(args.uid, {
        progressPercent: args.percent,
        author: id.author,
        authorType: id.authorType,
      });
      const body = args.message?.trim() || `Progress: ${args.percent}%`;
      const comment = commentService.addComment('item', args.uid, id.author, id.authorType, body, {
        kind: 'progress',
        source: 'agent',
        commentType: 'status_update',
        metadata: { progressPercent: args.percent },
      });
      const n = broadcast('plan-item-progress', { planUid: item.planUid, itemUid: args.uid, percent: args.percent, message: body, commentUid: comment.uid });
      broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      saveNow(() => exportDatabase());
      return resultWithMeta({ uid: args.uid, percent: args.percent, message: body }, n);
    },
  );

  mcpServer.registerTool(
    'set_item_blocked',
    {
      description:
        'Mark an Action blocked with a reason. Sets status=blocked, stores blockedReason on the row, and emits a kind=blocker comment so the activity rail surfaces it. ' +
        'Prefer this over silently stopping — humans see blockers prominently and can intervene.',
      inputSchema: {
        uid: z.string(),
        reason: z.string(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      if (item.kind !== 'action') {
        return { content: [{ type: 'text' as const, text: 'Only Actions can be blocked (not Objects).' }] };
      }
      planItemService.updateItem(args.uid, {
        status: 'blocked',
        blockedReason: args.reason,
        author: id.author,
        authorType: id.authorType,
      });
      const comment = commentService.addComment('item', args.uid, id.author, id.authorType, args.reason, {
        kind: 'blocker',
        source: 'agent',
        commentType: 'concern',
      });
      const n = broadcast('plan-item-blocked', { planUid: item.planUid, itemUid: args.uid, reason: args.reason, commentUid: comment.uid });
      broadcast('plan-item-updated', { planUid: item.planUid, itemUid: args.uid, kind: 'action', changes: { status: 'blocked' } });
      broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      saveNow(() => exportDatabase());
      return resultWithMeta({ uid: args.uid, status: 'blocked', reason: args.reason }, n);
    },
  );

  mcpServer.registerTool(
    'add_item_attachment',
    {
      description:
        'Pin a URL / image / file_ref / code_block / transcript to an item. For images with raw bytes, pass data_base64 + content_type + project_root and the file lands under <project_root>/.codetrellis/attachments/<item_uid>/<uid>.<ext>.',
      inputSchema: {
        uid: z.string(),
        kind: attachmentKindEnum,
        value: z.string(),
        label: z.string().optional(),
        content_type: z.string().optional(),
        data_base64: z.string().optional(),
        project_root: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      try {
        const attachment = taskAttachmentsService.addAttachment({
          targetType: 'item',
          targetUid: args.uid,
          kind: args.kind,
          value: args.value,
          label: args.label,
          contentType: args.content_type,
          dataBase64: args.data_base64,
          projectRoot: args.project_root,
          author: id.author,
          authorType: id.authorType,
        });
        const n = broadcast('plan-item-attachment-added', { planUid: item.planUid, itemUid: args.uid, attachment });
        saveNow(() => exportDatabase());
        return resultWithMeta(attachment, n);
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // --- External References (17.R) ----------------------------------------

  mcpServer.registerTool(
    'list_external_refs',
    {
      description:
        'List external references (GitHub issues, PRs, Jira tickets, Figma frames, etc.) linked to a plan item.',
      inputSchema: {
        item_uid: z.string().describe('The plan item uid to list refs for.'),
      },
    },
    async (args) => {
      const refs = externalRefsService.getExternalRefs(args.item_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(refs, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'add_external_ref',
    {
      description:
        'Link an external resource (GitHub issue, PR, Jira ticket, Figma frame, any URL) to a plan item. ' +
        'The kind is auto-detected from the URL pattern.',
      inputSchema: {
        item_uid: z.string().describe('The plan item uid to link the ref to.'),
        url: z.string().describe('The URL of the external resource.'),
        title: z.string().optional().describe('Display title. Auto-extracted from URL if omitted.'),
        kind: z.enum([
          'github_issue', 'github_pr', 'github_commit',
          'jira', 'linear', 'figma', 'notion', 'slack', 'url',
        ] as const).optional().describe('Reference kind. Auto-detected if omitted.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(extra);
      const item = planItemService.getItem(args.item_uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.item_uid} not found` }] };
      try {
        const ref = externalRefsService.createExternalRef({
          itemUid: args.item_uid,
          url: args.url,
          title: args.title,
          kind: args.kind,
          author: id.author,
          authorType: id.authorType,
        });
        broadcast('external-ref-added', { ref });
        saveNow(() => exportDatabase());
        return { content: [{ type: 'text' as const, text: JSON.stringify(ref, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  mcpServer.registerTool(
    'remove_external_ref',
    {
      description: 'Remove an external reference from a plan item.',
      inputSchema: {
        uid: z.string().describe('The external ref uid to remove.'),
      },
    },
    async (args) => {
      externalRefsService.deleteExternalRef(args.uid);
      broadcast('external-ref-deleted', { uid: args.uid });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Removed external ref ${args.uid}` }] };
    },
  );

  // --- Plan Deletion Tools ---

  mcpServer.registerTool(
    'delete_plan',
    {
      description: 'Delete (archive) a plan from CodeTrellis. Removes it from the plan list. Use list_plans first to find the uid.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to delete'),
      },
    },
    async ({ plan_uid }) => {
      planService.deletePlan(plan_uid);
      const n = broadcast('plan-deleted', { planUid: plan_uid });
      saveNow(() => exportDatabase());
      return resultWithMeta({ ok: true, planUid: plan_uid }, n);
    },
  );

  mcpServer.registerTool(
    'bulk_delete_plans',
    {
      description: 'Delete multiple plans at once. Useful for cleaning up test/demo plans. Pass "all" to delete every plan, or a list of uids.',
      inputSchema: {
        plan_uids: z.union([
          z.literal('all'),
          z.array(z.string()),
        ]).describe('"all" to delete every plan, or an array of plan UIDs to delete'),
      },
    },
    async ({ plan_uids }) => {
      let uids: string[];
      if (plan_uids === 'all') {
        const allPlans = planService.listPlans();
        uids = allPlans.map((p: any) => p.uid);
      } else {
        uids = plan_uids;
      }
      let deleted = 0;
      let lastN = 0;
      for (const uid of uids) {
        try {
          planService.deletePlan(uid);
          lastN = broadcast('plan-deleted', { planUid: uid });
          deleted++;
        } catch {
          // skip plans that don't exist
        }
      }
      saveNow(() => exportDatabase());
      return resultWithMeta({ ok: true, deleted }, lastN);
    },
  );

  // --- UI Navigation Tools ---
  // These broadcast events to the frontend, which drives the UI state.
  // Agents can use these to navigate the CodeTrellis interface — open
  // a plan, switch to graph view, toggle panels, refresh state.

  mcpServer.registerTool(
    'navigate_to',
    {
      description: 'Navigate the CodeTrellis UI to a specific view. Use this to show the user what you are working on — open the plan workspace, switch to graph view, or enable split view.',
      inputSchema: {
        target: z.enum(['plan', 'graph', 'split', 'timeline']).describe('"plan" = plan workspace, "graph" = dependency graph, "split" = plan + graph side-by-side, "timeline" = plan workspace with timeline'),
        plan_uid: z.string().optional().describe('If navigating to plan/split/timeline, which plan to show. If omitted, keeps the current active plan.'),
      },
    },
    async ({ target, plan_uid }) => {
      broadcast('ui-navigate', { target, planUid: plan_uid });
      return { content: [{ type: 'text' as const, text: `Navigated to ${target}${plan_uid ? ` (plan ${plan_uid})` : ''}` }] };
    },
  );

  mcpServer.registerTool(
    'open_plan',
    {
      description: 'Open a specific plan in the CodeTrellis UI. Switches to plan workspace mode and loads the plan. The user will see the plan immediately.',
      inputSchema: {
        plan_uid: z.string().describe('UID of the plan to open'),
        split_view: z.boolean().optional().describe('Also enable split view (plan + graph side-by-side)'),
      },
    },
    async ({ plan_uid, split_view }) => {
      broadcast('ui-navigate', { target: split_view ? 'split' : 'plan', planUid: plan_uid });
      return { content: [{ type: 'text' as const, text: `Opened plan ${plan_uid}${split_view ? ' in split view' : ''}` }] };
    },
  );

  mcpServer.registerTool(
    'toggle_panel',
    {
      description: 'Toggle a UI panel on or off in the CodeTrellis interface.',
      inputSchema: {
        panel: z.enum(['sidebar', 'inspector', 'terminal', 'split']).describe('Which panel to toggle'),
      },
    },
    async ({ panel }) => {
      broadcast('ui-toggle', { panel });
      return { content: [{ type: 'text' as const, text: `Toggled ${panel} panel` }] };
    },
  );

  mcpServer.registerTool(
    'refresh_ui',
    {
      description: 'Force the CodeTrellis UI to refresh its plan list and active plan. Use this after making changes that the UI might not have picked up.',
      inputSchema: {},
    },
    async () => {
      broadcast('ui-refresh', {});
      return { content: [{ type: 'text' as const, text: 'UI refresh triggered' }] };
    },
  );

  // --- Resources ---

  // Agent skill / "how to use this product" guides. Agents can fetch
  // these on connect so they don't need out-of-band briefing on what
  // CodeTrellis is or how to operate it. Three flavors:
  //   - codetrellis://skill              → project-state-tailored summary
  //   - codetrellis://skill/quickstart   → first-time agent flow
  //   - codetrellis://skill/power-user   → deep usage (phases, drift, multi-agent)

  mcpServer.registerResource(
    'codetrellis://skill',
    'codetrellis://skill',
    {
      description: 'How to use CodeTrellis — tailored summary of plans, spec docs, systems, and active sessions in this project.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://skill',
        mimeType: 'text/markdown',
        text: buildSkillGuide('summary'),
      }],
    }),
  );

  mcpServer.registerResource(
    'codetrellis://skill/quickstart',
    'codetrellis://skill/quickstart',
    {
      description: 'CodeTrellis quickstart for AI coding agents — basic flow: read the active plan, claim a task, do the work, mark it done.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://skill/quickstart',
        mimeType: 'text/markdown',
        text: buildSkillGuide('quickstart'),
      }],
    }),
  );

  mcpServer.registerResource(
    'codetrellis://skill/power-user',
    'codetrellis://skill/power-user',
    {
      description: 'CodeTrellis power-user guide for AI coding agents — spec docs, drift verification, multi-agent coordination, granular task fields.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://skill/power-user',
        mimeType: 'text/markdown',
        text: buildSkillGuide('power-user'),
      }],
    }),
  );

  mcpServer.registerResource(
    'project://graph',
    'project://graph',
    {
      description: 'Current dependency graph as JSON — all file-to-file import edges',
      mimeType: 'application/json',
    },
    async () => {
      const edges = getDependencyEdges();
      const stats = getDbStats();
      return {
        contents: [{
          uri: 'project://graph',
          mimeType: 'application/json',
          text: JSON.stringify({ stats, edges }, null, 2),
        }],
      };
    }
  );

  mcpServer.registerResource(
    'codetrellis://plans',
    'codetrellis://plans',
    {
      description: 'List of all plans in CodeTrellis',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://plans',
        mimeType: 'application/json',
        text: JSON.stringify(planService.listPlans(), null, 2),
      }],
    })
  );

  mcpServer.registerResource(
    'codetrellis://sessions',
    'codetrellis://sessions',
    {
      description: 'Active agent sessions connected to CodeTrellis',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'codetrellis://sessions',
        mimeType: 'application/json',
        text: JSON.stringify(sessionService.getActiveSessions(), null, 2),
      }],
    })
  );

  mcpServer.registerResource(
    'project://stats',
    'project://stats',
    {
      description: 'Database statistics — file count, symbol count, import count',
      mimeType: 'application/json',
    },
    async () => {
      return {
        contents: [{
          uri: 'project://stats',
          mimeType: 'application/json',
          text: JSON.stringify(getDbStats(), null, 2),
        }],
      };
    }
  );

  return mcpServer;
}

/**
 * Boot the MCP HTTP/SSE server. Called once at backend startup.
 * Per-connection server *instances* are built lazily inside the
 * `/sse` handler via `setupMcpServerInstance()` — the HTTP server is
 * a singleton, the McpServer objects are per-agent.
 */
export async function startMcpServer(): Promise<void> {
  if (httpServer) return; // already started

  // --- HTTP Server with SSE ---

  const app = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/sse' && req.method === 'GET') {
      // Guard against resource exhaustion from runaway retry loops or
      // too many simultaneous agents.
      if (connectedTransports.size >= MAX_MCP_CONNECTIONS) {
        console.warn(`[MCP] Connection limit reached (${MAX_MCP_CONNECTIONS}), rejecting new SSE client`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many MCP connections' }));
        return;
      }

      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      connectedTransports.set(sessionId, transport);

      // Build a fresh MCP server *instance* for this agent
      // connection. The SDK's `Server.connect(transport)` is
      // single-transport — sharing one server across multiple SSE
      // connections re-binds its internal `_transport` slot and
      // severs whichever transport was bound first. Each agent
      // gets its own server object; all instances share the same
      // module-level state (database, plan service, etc.) so the
      // app's data is still single-source-of-truth.
      const mcpServer = setupMcpServerInstance();
      connectedServers.set(sessionId, mcpServer);

      // Auto-register a session on connect so EVERY connected agent
      // shows up in the active-sessions list (and per-tool events get
      // attribution) even if the agent never calls register_session
      // explicitly. Agents that DO call register_session will upgrade
      // this record with their real type/model.
      const inferredAgentType = req.headers['user-agent']?.toString().split(' ')[0]?.toLowerCase().includes('claude')
        ? 'claude-code'
        : 'mcp-client';
      sessionService.registerSession(sessionId, inferredAgentType);

      res.on('close', () => {
        connectedTransports.delete(sessionId);
        const sessionServer = connectedServers.get(sessionId);
        if (sessionServer) {
          // Best-effort close — ignore errors so a cleanup failure
          // for one agent doesn't take down the whole process.
          sessionServer.close().catch(() => { /* ignore */ });
          connectedServers.delete(sessionId);
        }
        sessionService.disconnectSession(sessionId);
        console.log(`[MCP] Client disconnected: ${sessionId}`);
        broadcast('agent-event', {
          id: `mcp-disconnect-${Date.now()}`,
          timestamp: Date.now(),
          source: 'mcp',
          type: 'session_end',
          payload: { sessionId },
        });
        broadcast('mcp-session-changed', { reason: 'disconnect' });
      });

      console.log(`[MCP] Client connected: ${sessionId} (${inferredAgentType})`);
      broadcast('agent-event', {
        id: `mcp-connect-${Date.now()}`,
        timestamp: Date.now(),
        source: 'mcp',
        type: 'session_start',
        payload: { sessionId, source: 'mcp', agentType: inferredAgentType },
      });
      broadcast('mcp-session-changed', { reason: 'connect' });

      await mcpServer.connect(transport);
      return;
    }

    if (req.url?.startsWith('/messages') && req.method === 'POST') {
      const sessionId = new URL(req.url, `http://localhost:${boundPort}`).searchParams.get('sessionId');
      if (!sessionId || !connectedTransports.has(sessionId)) {
        res.writeHead(404);
        res.end('Session not found');
        return;
      }
      const transport = connectedTransports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    // Health check
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'codetrellis-mcp',
        version: '0.1.0',
        connectedClients: connectedTransports.size,
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer = app;

  // Resolve the configured port from settings; allow env override for
  // the E2E harness; fall back to the historical default. Then walk
  // forward up to MAX_PORT_ATTEMPTS slots on EADDRINUSE if autodetect
  // is enabled.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // getSettings imported at top of file
  const settings = getSettings();
  const envPort = process.env.CODETRELLIS_MCP_PORT;
  const requestedPort = envPort ? Number(envPort) : (settings.mcp.port ?? DEFAULT_MCP_PORT);
  const autodetect = settings.mcp.autodetectOnCollision !== false && !envPort;

  return new Promise<void>((resolve, reject) => {
    const tryPort = (candidate: number, attemptsLeft: number) => {
      // Use the `listening` event explicitly (instead of the listen()
      // callback) so we can pair it with a single `error` handler and
      // remove BOTH on whichever fires first. Otherwise the callback
      // registered on a failing `listen(port-in-use)` call is still
      // attached when a later `listen(other-port)` succeeds, and node
      // fires *both* listen callbacks — leading to a duplicate
      // "Server running on…" log line on the wrong port.
      const onListening = () => {
        app.removeListener('error', onError);
        boundPort = candidate;
        console.log(`[MCP] Server running on http://127.0.0.1:${boundPort}${candidate !== requestedPort ? ` (requested ${requestedPort}, autodetected)` : ''}`);
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { broadcast: bc } = require('../server');
          bc('mcp-port-changed', { port: boundPort, requested: requestedPort });
        } catch { /* server module may not yet be registered for broadcast in tests */ }
        resolve();
      };
      const onError = (err: NodeJS.ErrnoException) => {
        app.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && autodetect && attemptsLeft > 0) {
          console.warn(`[MCP] Port ${candidate} in use; trying ${candidate + 1}…`);
          tryPort(candidate + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      };
      app.once('listening', onListening);
      app.once('error', onError);
      app.listen(candidate, '127.0.0.1');
    };
    tryPort(requestedPort, autodetect ? MAX_PORT_ATTEMPTS : 0);
  });
}

export function getMcpStatus(): {
  running: boolean;
  port: number;
  connectedAgents: number;
} {
  return {
    running: httpServer !== null,
    port: boundPort,
    connectedAgents: connectedTransports.size,
  };
}

/**
 * MCP config for agents to copy into their settings.
 */
export function getMcpConfig(): Record<string, unknown> {
  return {
    codetrellis: {
      type: 'sse',
      url: `http://127.0.0.1:${boundPort}/sse`,
    },
  };
}

export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  // Close every per-session server instance. We don't `await` on
  // each one in a loop — close() can take a moment and we'd rather
  // surface "server stopped" promptly than block on every agent's
  // teardown.
  await Promise.allSettled(
    Array.from(connectedServers.values()).map((s) => s.close()),
  );
  connectedServers.clear();
  connectedTransports.clear();
}
