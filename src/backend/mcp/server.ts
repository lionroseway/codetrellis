import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { searchSymbols, getDependencyEdges, getFileDependencies, getDbStats } from '../services/database';
import { broadcast } from '../server';
import { z } from 'zod';
import * as planService from '../services/plan-service';
import * as commentService from '../services/comment-service';
import * as sessionService from '../services/session-service';
import * as planDocsService from '../services/plan-documents-service';
import * as planPhasesService from '../services/plan-phases-service';
import * as taskAttachmentsService from '../services/task-attachments-service';
// Phase 15 §C — unified Object/Action surface. New canonical tools
// register against `plan-item-service` + `plan-event-service` and
// emit `plan-item-*` WS events. Old tools (claim_task, add_subtask,
// add_plan_doc, …) keep working unchanged in parallel during the
// 15.C → 15.F cutover; aliases / deprecation are 15.F's job.
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

/**
 * Default + max-attempt range. The user-configured port comes from
 * settings (`mcp.port`); if `mcp.autodetectOnCollision` is true and
 * that port is in use, we walk forward up to MAX_PORT_ATTEMPTS slots.
 * The actually-bound port is reported via getMcpStatus() and broadcast
 * over WS so the frontend's "Copy MCP config" buttons stay accurate.
 */
const DEFAULT_MCP_PORT = 19432;
const MAX_PORT_ATTEMPTS = 10;

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

  const symbolSpecSchema = z.object({
    name: z.string().describe('Symbol name (e.g. "verifyToken")'),
    kind: z.enum(['function', 'class', 'interface', 'type', 'method', 'enum']),
    action: z.enum(['add', 'modify', 'remove', 'move']),
    description: z.string().optional().describe('What the symbol does or why it changes'),
    signature: z.string().optional().describe('Type signature, e.g. "verifyToken(token: string, secret: string): JwtPayload"'),
    moveTo: z.string().optional().describe('Target file path if action is "move"'),
  });

  // Phase 14 §A — explicit CRUD intent on file ops. Mirrors symbol_specs.
  // Paths resolve relative to the parent task's `scope_path` if set.
  const fileSpecSchema = z.object({
    path: z.string().describe('Path the spec applies to. Relative to the task\'s scope_path (or project root if unset).'),
    action: z.enum(['create', 'modify', 'delete', 'move']),
    moveTo: z.string().optional().describe('Destination path when action is "move".'),
    isDir: z.boolean().optional().describe('Marker for directory-level intent.'),
    description: z.string().optional().describe('Why / how this file changes.'),
  });

  mcpServer.registerTool(
    'create_plan',
    {
      description: 'Create a structured plan in CodeTrellis describing what you intend to do. Express architectural intent at the file, symbol, and edge level — agents and humans both read this as the spec. Returns the plan UID.',
      inputSchema: {
        title: z.string().describe('Brief title of the plan'),
        description: z.string().optional().describe('Detailed description of what this plan achieves'),
        project_path: z.string().describe('Absolute path to the project this plan is for'),
        tasks: z.array(z.object({
          description: z.string().describe('What this task does'),
          affected_files: z.array(z.string()).optional().describe('Files this task will create/modify/delete (legacy — prefer file_specs for CRUD intent)'),
          affected_symbols: z.array(z.string()).optional().describe('Functions/classes this task will add/change (names only — use symbol_specs for richer intent)'),
          new_connections: z.array(z.object({ from: z.string(), to: z.string() })).optional().describe('New import relationships'),
          removed_connections: z.array(z.object({ from: z.string(), to: z.string() })).optional().describe('Import relationships to remove'),
          dependencies: z.array(z.string()).optional().describe('Task UIDs that must complete before this one starts'),
          file_spec: z.string().optional().describe('Markdown describing what the file should do, its responsibility, exports, etc.'),
          symbol_specs: z.array(symbolSpecSchema).optional().describe('Per-symbol intent: name, kind, action, signature, etc. Richer than affected_symbols.'),
          // --- Phase 14 §A task-as-context fields ---
          body: z.string().optional().describe('Markdown design notes / rationale for this task. Read by agents picking up the task.'),
          prompt: z.string().optional().describe('Markdown literally ready to paste at an agent. Use this when the task carries a precise prompt instead of free-form context.'),
          scope_path: z.string().optional().describe('Folder this task is rooted at (e.g. "src/auth/"). Relative paths in file_specs resolve from here. Empty = project root.'),
          file_specs: z.array(fileSpecSchema).optional().describe('Phase 14 §A — explicit CRUD intent on file ops. Mirrors symbol_specs. affected_files is derived from these.'),
          parent_task_uid: z.string().optional().describe('Mark this task as a subtask of another task in the same plan.'),
        })).describe('Ordered list of tasks'),
      },
    },
    async ({ title, description, project_path, tasks }) => {
      const plan = planService.createPlan(
        { title, description: description || '', tasks: tasks.map((t: any) => ({
          description: t.description,
          affectedFiles: t.affected_files,
          affectedSymbols: t.affected_symbols,
          newConnections: t.new_connections,
          removedConnections: t.removed_connections,
          dependencies: t.dependencies,
          fileSpec: t.file_spec,
          symbolSpecs: t.symbol_specs,
          body: t.body,
          prompt: t.prompt,
          scopePath: t.scope_path ?? null,
          fileSpecs: t.file_specs,
          parentTaskUid: t.parent_task_uid ?? null,
        })) },
        'agent', 'mcp', project_path,
      );
      broadcast('plan-created', { plan });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(plan, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'get_plan',
    {
      description: 'Read a plan by its UID. Returns the full plan with all tasks, status, and metadata.',
      inputSchema: { plan_uid: z.string().describe('Plan UID') },
    },
    async ({ plan_uid }) => {
      const plan = planService.getPlan(plan_uid);
      if (!plan) return { content: [{ type: 'text' as const, text: 'Plan not found' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(plan, null, 2) }] };
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
      broadcast('plan-updated', { planUid: plan_uid });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Plan ${plan_uid} updated.` }] };
    }
  );

  mcpServer.registerTool(
    'list_plans',
    {
      description: 'List all plans, optionally filtered by project path or status.',
      inputSchema: {
        project_path: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async ({ project_path, status }) => {
      const plans = planService.listPlans(project_path, status);
      return { content: [{ type: 'text' as const, text: JSON.stringify(plans, null, 2) }] };
    }
  );

  // --- Task Management Tools ---

  /**
   * Build a full-context payload for a task: the task row, its phase
   * (if any), its parent task (if any), subtasks, attachments, and
   * comments. Shared between `read_task_full` and the post-claim
   * payload returned by `claim_task` — agents that pick up a task
   * shouldn't need a follow-up read to know what they're doing.
   */
  function readTaskFull(taskUid: string): {
    task: ReturnType<typeof planService.getTaskByUid>;
    parent: ReturnType<typeof planService.getTaskByUid> | null;
    subtasks: ReturnType<typeof planService.getSubtasks>;
    phase: ReturnType<typeof planPhasesService.getPhase> | null;
    attachments: ReturnType<typeof taskAttachmentsService.listTaskAttachments>;
    comments: ReturnType<typeof commentService.listCommentsFlat>;
    plan: { uid: string; title: string; status: string } | null;
  } | null {
    const task = planService.getTaskByUid(taskUid);
    if (!task) return null;
    const parent = task.parentTaskUid ? planService.getTaskByUid(task.parentTaskUid) : null;
    const subtasks = planService.getSubtasks(taskUid);
    const phase = task.phaseUid ? planPhasesService.getPhase(task.phaseUid) : null;
    const attachments = taskAttachmentsService.listTaskAttachments(taskUid);
    const comments = commentService.listCommentsFlat(taskUid);
    const planRow = planService.getPlan(task.planUid);
    const plan = planRow ? { uid: planRow.uid, title: planRow.title, status: planRow.status } : null;
    return { task, parent, subtasks, phase, attachments, comments, plan };
  }

  mcpServer.registerTool(
    'claim_task',
    {
      description: 'Claim a task from a plan. Only succeeds if the task is unclaimed and pending. Returns the full task context (body / prompt / fileSpecs / attachments / comments / subtasks) in one round-trip — no follow-up `read_task_full` needed.',
      inputSchema: {
        plan_uid: z.string(),
        task_uid: z.string(),
        agent_type: z.string().optional().describe('e.g. claude-code, cursor'),
        model: z.string().optional().describe('e.g. claude-opus-4'),
      },
    },
    async ({ plan_uid, task_uid, agent_type, model }) => {
      const result = planService.claimTask(task_uid, agent_type || 'mcp-agent', agent_type || 'mcp', model);
      if (result.ok) {
        broadcast('task-claimed', { planUid: plan_uid, taskUid: task_uid, agentId: agent_type || 'mcp-agent' });
        if (result.conflicts) {
          broadcast('conflict-detected', { planUid: plan_uid, taskUid: task_uid, message: result.conflicts.join('; ') });
        }
        saveNow(() => exportDatabase());
        const fullContext = readTaskFull(task_uid);
        const message = result.conflicts
          ? `Task claimed. WARNING: ${result.conflicts.join('; ')}`
          : `Task ${task_uid} claimed.`;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            ok: true,
            message,
            conflicts: result.conflicts ?? null,
            ...fullContext,
          }, null, 2) }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          ok: false,
          message: 'Task already claimed or not pending.',
          reason: 'Task already claimed or not pending.',
        }, null, 2) }],
      };
    }
  );

  mcpServer.registerTool(
    'update_task',
    {
      description: 'Update any field on a task. Common: status (pending → in_progress → done). Phase 14 §A also accepts body / prompt / scope_path / file_specs / parent_task_uid for task-as-context updates. Pass empty string for parent_task_uid to detach.',
      inputSchema: {
        plan_uid: z.string(),
        task_uid: z.string(),
        status: z.enum(['pending', 'assigned', 'in_progress', 'done', 'blocked', 'skipped']).optional(),
        phase_uid: z.string().optional().describe('Bind this task to a phase. Empty string clears the binding.'),
        description: z.string().optional(),
        body: z.string().optional().describe('Phase 14 §A — markdown design notes / rationale.'),
        prompt: z.string().optional().describe('Phase 14 §A — markdown ready to paste at an agent.'),
        scope_path: z.string().optional().describe('Phase 14 §A — folder the task is rooted at. Empty string = project root.'),
        file_specs: z.array(fileSpecSchema).optional().describe('Phase 14 §A — replace the task\'s file_specs (and recompute affected_files).'),
        parent_task_uid: z.string().optional().describe('Phase 14 §A — bind this task as a subtask. Empty string detaches.'),
      },
    },
    async ({ plan_uid, task_uid, status, phase_uid, description, body, prompt, scope_path, file_specs, parent_task_uid }) => {
      const updates: Parameters<typeof planService.updateTask>[1] = {};
      if (status !== undefined) updates.status = status;
      if (phase_uid !== undefined) updates.phaseUid = phase_uid === '' ? null : phase_uid;
      if (description !== undefined) updates.description = description;
      if (body !== undefined) updates.body = body;
      if (prompt !== undefined) updates.prompt = prompt;
      if (scope_path !== undefined) updates.scopePath = scope_path === '' ? null : scope_path;
      if (file_specs !== undefined) updates.fileSpecs = file_specs;
      if (parent_task_uid !== undefined) updates.parentTaskUid = parent_task_uid === '' ? null : parent_task_uid;
      planService.updateTask(task_uid, updates);
      if (status !== undefined) {
        broadcast('task-updated', { planUid: plan_uid, taskUid: task_uid, status });
      } else {
        broadcast('task-updated', { planUid: plan_uid, taskUid: task_uid });
      }
      saveNow(() => exportDatabase());
      const summary = [
        status && `status → ${status}`,
        phase_uid !== undefined && `phase → ${phase_uid || 'none'}`,
        description !== undefined && 'description updated',
        body !== undefined && 'body updated',
        prompt !== undefined && 'prompt updated',
        scope_path !== undefined && `scope_path → ${scope_path || 'none'}`,
        file_specs !== undefined && `file_specs (${file_specs.length})`,
        parent_task_uid !== undefined && `parent → ${parent_task_uid || 'none'}`,
      ].filter(Boolean).join(', ');
      return { content: [{ type: 'text' as const, text: `Task ${task_uid} ${summary || 'unchanged'}` }] };
    }
  );

  mcpServer.registerTool(
    'get_next_task',
    {
      description: 'Get the next available unclaimed task from a plan, respecting dependency order. Pass phase_uid to scope to a single phase (use empty string to scope to "no phase" tasks only).',
      inputSchema: {
        plan_uid: z.string(),
        phase_uid: z.string().optional().describe('Restrict to a phase. Empty string = unphased tasks only. Omit = any phase.'),
      },
    },
    async ({ plan_uid, phase_uid }) => {
      const phaseFilter = phase_uid === undefined ? undefined : (phase_uid === '' ? null : phase_uid);
      const task = planService.getNextTask(plan_uid, phaseFilter);
      if (!task) return { content: [{ type: 'text' as const, text: 'No tasks available — all claimed, completed, or blocked by dependencies.' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  // --- Phase 14 §A: task-as-context tools ---
  // Treat a task as a context blob (body / prompt / fileSpecs /
  // attachments / comments / subtasks), not just a thin todo. Agents
  // call `read_task_full` to get everything in one round-trip; humans
  // and agents both leave structured chatter via `add_task_comment`,
  // `update_task_progress`, and `set_task_blocked`; agents break work
  // down via `add_subtask`; and rich inputs flow in via
  // `add_task_attachment`.

  mcpServer.registerTool(
    'read_task_full',
    {
      description: 'One round-trip: returns task row + parent task (if subtask) + subtasks + bound phase (if any) + attachments + comments + minimal plan info. Use this when picking up a task instead of stitching together get_plan / get_comments / list_task_attachments.',
      inputSchema: { task_uid: z.string() },
    },
    async ({ task_uid }) => {
      const full = readTaskFull(task_uid);
      if (!full) return { content: [{ type: 'text' as const, text: `Task ${task_uid} not found` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(full, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'list_task_comments',
    {
      description: 'Read all comments on a task, ordered by creation time. Each comment carries `kind` (note / blocker / progress / question), `source` (agent / human), and optional `metadata` (e.g. `progressPercent` for `kind: "progress"`). Use this before continuing a task to see if a human or another agent left context.',
      inputSchema: { task_uid: z.string() },
    },
    async ({ task_uid }) => {
      const comments = commentService.listCommentsFlat(task_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'add_task_comment',
    {
      description: 'Leave a structured comment on a task. `kind` is the first-class taxonomy (note / blocker / progress / question). When you hit a blocker, prefer this over silently stopping — the human sees blockers in the activity rail and can intervene. For progress, prefer `update_task_progress` so the percent + message land in one tool call.',
      inputSchema: {
        plan_uid: z.string().optional().describe('Plan uid (only used for the broadcast event).'),
        task_uid: z.string(),
        kind: z.enum(['note', 'blocker', 'progress', 'question']),
        body: z.string().describe('Markdown body. Be specific — this becomes durable context.'),
        parent_comment_uid: z.string().optional().describe('Reply to another comment.'),
      },
    },
    async ({ plan_uid, task_uid, kind, body, parent_comment_uid }, extra: any) => {
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const sessions = sessionService.getActiveSessions();
      const session = sessionId ? sessions.find((s) => s.sessionId === sessionId) : null;
      const author = session?.agentType ?? 'agent';
      // Map the new `kind` taxonomy onto the legacy `commentType`
      // chip so old UI keeps showing something sensible:
      //   progress → status_update,  blocker → concern,
      //   question → suggestion,     note    → comment.
      const legacyType: 'status_update' | 'concern' | 'suggestion' | 'comment' =
        kind === 'progress' ? 'status_update'
        : kind === 'blocker' ? 'concern'
        : kind === 'question' ? 'suggestion'
        : 'comment';
      const comment = commentService.addComment('task', task_uid, author, 'mcp', body, {
        kind,
        source: 'agent',
        commentType: legacyType,
        parentUid: parent_comment_uid,
      });
      const planUid = plan_uid ?? planService.getTaskByUid(task_uid)?.planUid ?? null;
      broadcast('task-comment-added', { planUid, taskUid: task_uid, comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(comment, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'update_task_progress',
    {
      description: 'Report mid-task progress: a 0–100 percent + free-form message. Stored as a `kind: "progress"` comment with `metadata.progressPercent`, and the task\'s `progress_percent` column is updated so the UI can render an inline progress bar. Use frequently during long tasks so the human sees movement.',
      inputSchema: {
        task_uid: z.string(),
        percent: z.number().int().min(0).max(100),
        message: z.string().optional().describe('What you just did or are about to do.'),
      },
    },
    async ({ task_uid, percent, message }, extra: any) => {
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const sessions = sessionService.getActiveSessions();
      const session = sessionId ? sessions.find((s) => s.sessionId === sessionId) : null;
      const author = session?.agentType ?? 'agent';

      planService.updateTask(task_uid, { progressPercent: percent });
      const body = message?.trim() || `Progress: ${percent}%`;
      const comment = commentService.addComment('task', task_uid, author, 'mcp', body, {
        kind: 'progress',
        source: 'agent',
        commentType: 'status_update',
        metadata: { progressPercent: percent },
      });
      const planUid = planService.getTaskByUid(task_uid)?.planUid ?? null;
      broadcast('task-progress', { planUid, taskUid: task_uid, percent, message: body, commentUid: comment.uid });
      broadcast('task-comment-added', { planUid, taskUid: task_uid, comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify({ task_uid, percent, message: body }, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'set_task_blocked',
    {
      description: 'Mark a task as blocked with an explicit reason. Sets status → blocked, stores the reason on the task, and adds a `kind: "blocker"` comment so the human sees it in the activity rail. Prefer this over silently stopping or claiming you "couldn\'t finish".',
      inputSchema: {
        task_uid: z.string(),
        reason: z.string().describe('Why you\'re blocked, in markdown. Be specific so the human can unblock without a back-and-forth.'),
      },
    },
    async ({ task_uid, reason }, extra: any) => {
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const sessions = sessionService.getActiveSessions();
      const session = sessionId ? sessions.find((s) => s.sessionId === sessionId) : null;
      const author = session?.agentType ?? 'agent';

      planService.updateTask(task_uid, { status: 'blocked', blockedReason: reason });
      const comment = commentService.addComment('task', task_uid, author, 'mcp', reason, {
        kind: 'blocker',
        source: 'agent',
        commentType: 'concern',
      });
      const planUid = planService.getTaskByUid(task_uid)?.planUid ?? null;
      broadcast('task-blocked', { planUid, taskUid: task_uid, reason, commentUid: comment.uid });
      broadcast('task-updated', { planUid, taskUid: task_uid, status: 'blocked' });
      broadcast('task-comment-added', { planUid, taskUid: task_uid, comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify({ task_uid, status: 'blocked', reason }, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'add_subtask',
    {
      description: 'Break a task down by adding a subtask under it. Subtasks share the parent\'s plan (and inherit nothing else automatically — pass body / prompt / file_specs / scope_path explicitly when relevant). One level deep for v1; tree later. Returns the new subtask.',
      inputSchema: {
        parent_task_uid: z.string(),
        description: z.string(),
        body: z.string().optional(),
        prompt: z.string().optional(),
        scope_path: z.string().optional(),
        file_specs: z.array(fileSpecSchema).optional(),
      },
    },
    async ({ parent_task_uid, description, body, prompt, scope_path, file_specs }) => {
      const parent = planService.getTaskByUid(parent_task_uid);
      if (!parent) return { content: [{ type: 'text' as const, text: `Parent task ${parent_task_uid} not found` }] };
      const subtask = planService.appendTaskToPlan(parent.planUid, {
        description,
        body,
        prompt,
        scopePath: scope_path ?? parent.scopePath ?? null,
        fileSpecs: file_specs,
        parentTaskUid: parent_task_uid,
      });
      if (!subtask) return { content: [{ type: 'text' as const, text: 'Failed to create subtask' }] };
      broadcast('task-created', { planUid: parent.planUid, task: subtask, parentTaskUid: parent_task_uid });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(subtask, null, 2) }] };
    },
  );

  mcpServer.registerTool(
    'add_task_attachment',
    {
      description: 'Pin a URL / image / file_ref / code_block / transcript to a task. For images with raw bytes, pass `data_base64` + `content_type` and `project_root` — CodeTrellis writes the file under `<project_root>/.codetrellis/attachments/<task_uid>/<uid>.<ext>` and stores the project-relative path. For everything else (URLs, project-file refs, snippets), `value` is stored as-is.',
      inputSchema: {
        task_uid: z.string(),
        kind: z.enum(['url', 'image', 'file_ref', 'code_block', 'transcript']),
        value: z.string().describe('URL / file path / inline content depending on kind.'),
        label: z.string().optional().describe('Short label shown in the UI rail.'),
        content_type: z.string().optional().describe('MIME hint, e.g. image/png.'),
        data_base64: z.string().optional().describe('For kind="image": raw image bytes encoded as base64. Requires project_root.'),
        project_root: z.string().optional().describe('Required when data_base64 is set so the file lands in <project_root>/.codetrellis/attachments/.'),
      },
    },
    async ({ task_uid, kind, value, label, content_type, data_base64, project_root }, extra: any) => {
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? null;
      const sessions = sessionService.getActiveSessions();
      const session = sessionId ? sessions.find((s) => s.sessionId === sessionId) : null;
      const author = session?.agentType ?? 'agent';
      try {
        const attachment = taskAttachmentsService.addAttachment({
          targetType: 'task',
          targetUid: task_uid,
          kind,
          value,
          label,
          contentType: content_type,
          dataBase64: data_base64,
          projectRoot: project_root,
          author,
          authorType: 'mcp',
        });
        const planUid = planService.getTaskByUid(task_uid)?.planUid ?? null;
        broadcast('task-attachment-added', { planUid, taskUid: task_uid, attachment });
        saveNow(() => exportDatabase());
        return { content: [{ type: 'text' as const, text: JSON.stringify(attachment, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  // --- Plan Phase Tools ---

  const phaseStatusEnum = z.enum(['pending', 'in_progress', 'done', 'blocked']);

  mcpServer.registerTool(
    'add_plan_phase',
    {
      description: 'Add a phase to a plan. A phase is a first-class checkpoint with its own scope, prerequisites, git checkpoint, and acceptance criteria — modelled on the swf "01-PHASE-1-FOUNDATION" pattern. phase_number auto-picks the next slot if omitted. Tasks bind to a phase via update_task(..., phase_uid).',
      inputSchema: {
        plan_uid: z.string(),
        title: z.string(),
        phase_number: z.number().int().optional(),
        scope: z.string().optional().describe('Markdown describing what this phase covers'),
        prerequisites: z.string().optional().describe('Markdown — what must be done before this phase starts'),
        git_checkpoint: z.string().optional().describe('Commit hash, tag, or label captured at phase start'),
        acceptance_criteria: z.string().optional().describe('Markdown — ideally a checklist of "- [ ] …" items'),
        status: phaseStatusEnum.optional(),
      },
    },
    async ({ plan_uid, title, phase_number, scope, prerequisites, git_checkpoint, acceptance_criteria, status }) => {
      const phase = planPhasesService.createPhase({
        planUid: plan_uid,
        phaseNumber: phase_number,
        title,
        scope,
        prerequisites,
        gitCheckpoint: git_checkpoint ?? null,
        acceptanceCriteria: acceptance_criteria,
        status,
      });
      broadcast('plan-phase-created', { phase });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(phase, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'list_plan_phases',
    {
      description: 'List all phases for a plan, ordered by phase_number. Returns the full phase rows (small payload, no need for a summary variant).',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const phases = planPhasesService.listPhases(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(phases, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'update_plan_phase',
    {
      description: 'Update any field on a phase — title, scope, prerequisites, git checkpoint, acceptance criteria, status, or phase_number. Pass empty string for git_checkpoint to clear.',
      inputSchema: {
        phase_uid: z.string(),
        title: z.string().optional(),
        phase_number: z.number().int().optional(),
        scope: z.string().optional(),
        prerequisites: z.string().optional(),
        git_checkpoint: z.string().optional(),
        acceptance_criteria: z.string().optional(),
        status: phaseStatusEnum.optional(),
      },
    },
    async ({ phase_uid, title, phase_number, scope, prerequisites, git_checkpoint, acceptance_criteria, status }) => {
      const phase = planPhasesService.updatePhase(phase_uid, {
        title,
        phaseNumber: phase_number,
        scope,
        prerequisites,
        gitCheckpoint: git_checkpoint === '' ? null : git_checkpoint,
        acceptanceCriteria: acceptance_criteria,
        status,
      });
      if (!phase) return { content: [{ type: 'text' as const, text: `Phase ${phase_uid} not found` }] };
      broadcast('plan-phase-updated', { phase });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(phase, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'delete_plan_phase',
    {
      description: 'Delete a phase. Tasks that reference it have their phase_uid cleared (they survive, just become unphased).',
      inputSchema: { phase_uid: z.string() },
    },
    async ({ phase_uid }) => {
      planPhasesService.deletePhase(phase_uid);
      broadcast('plan-phase-deleted', { phaseUid: phase_uid });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Phase ${phase_uid} deleted` }] };
    }
  );

  // --- Plan File Sync (Phase 13 §A) ---

  mcpServer.registerTool(
    'export_plan_to_files',
    {
      description: 'Round-trip a plan to disk: writes plan + phases + tasks + spec docs as YAML / markdown under `<projectRoot>/.codetrellis/plans/<slug>/`. Idempotent — re-exporting overwrites the same files. Use this so plans can be committed to git and shared across devices / agents (see codetrellis://skill/power-user for the multi-device flow).',
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
      description: 'Read a plan directory (`.codetrellis/plans/<slug>/`) from disk and upsert it into the DB. UID is the canonical id — re-importing the same directory is idempotent. Returns the plan + phase + task + doc counts. Use after `git pull` to sync external changes.',
      inputSchema: {
        plan_dir: z.string().describe('Absolute path to the plan directory (or directly to plan.yaml).'),
      },
    },
    async ({ plan_dir }) => {
      const { importPlan } = planFileService;
      try {
        const result = importPlan(plan_dir);
        broadcast('plan-imported', { planUid: result.plan.uid, source: plan_dir });
        saveNow(() => exportDatabase());
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              plan: { uid: result.plan.uid, title: result.plan.title },
              phaseCount: result.phases.length,
              taskCount: result.tasks.length,
              docCount: result.docs.length,
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
      description: 'Snapshot a plan as a reusable template under `<project_root>/.codetrellis/templates/<template_id>/`. Strips project-specific bits (statuses, assignees, git checkpoints) and produces a `template.yaml` + `docs/<order>-<slug>.md` shape that other projects can `git clone` into their own `.codetrellis/templates/`. Phase 13 §C.',
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
      description: 'Create a new plan from a template — seeds the plan, phases (with scope / prereqs / acceptance), and spec docs (with orderHint / parent refs) in one transactional sweep. Use list_plan_templates first to pick a template_id. Most common: "mass-refactor" (swf-style 6 phases + executive overview + per-phase docs + cross-cutting patterns/testing/security). For Phase 13 §C disk templates that declare `placeholders`, pass `placeholder_values` to fill them in.',
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
        for (const phase of result.phases) broadcast('plan-phase-created', { phase });
        for (const doc of result.docs) broadcast('plan-doc-created', { doc });
        saveNow(() => exportDatabase());
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              plan: result.plan,
              phaseCount: result.phases.length,
              docCount: result.docs.length,
              taskCount: result.tasks.length,
              hint: 'Read get_plan_doc(plan_uid, doc_type=\"executive_summary\") first, then list_plan_phases(plan_uid).',
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
      description: 'Associate this agent session with a plan, indicating you are working on it. Other connected agents see your active plan in the Connected Agents widget.',
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
        // Fall back to most-recent if the transport context isn't
        // available (rare — only if the SDK ever calls without extra).
        const sessions = sessionService.getActiveSessions();
        if (sessions.length > 0) {
          sessionService.setActivePlan(sessions[sessions.length - 1].sessionId, plan_uid);
          broadcast('mcp-session-changed', { reason: 'set_active_plan', planUid: plan_uid });
        }
      }
      return { content: [{ type: 'text' as const, text: `Active plan set to ${plan_uid}` }] };
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

  // --- Plan Spec Document Tools ---
  // Spec docs let agents attach structured context (architecture, patterns,
  // testing strategy, security notes, examples, research, etc.) to a plan
  // without bloating the agent's context window. Fetch only what you need.

  const docTypeDescription =
    'One of: executive_summary, architecture, patterns, examples, research, testing, security, ux_ui, constraints, acceptance_criteria, rollout, custom. Custom strings are accepted.';

  mcpServer.registerTool(
    'add_plan_doc',
    {
      description: 'Attach a spec document to a plan — patterns to follow, security considerations, test strategy, examples, research notes, etc. Doc body is markdown. Use this instead of stuffing everything into the plan description. Use order_hint ("00", "01", "01.5") to control sort order in the spec room (matches the swf "00-EXECUTIVE / 01-PHASE-1 / …" file convention). Use parent_doc_uid to nest the doc under another doc (e.g. per-phase test docs under one "testing" parent).',
      inputSchema: {
        plan_uid: z.string(),
        doc_type: z.string().describe(docTypeDescription),
        title: z.string().describe('Short human-readable title for the doc'),
        body: z.string().describe('Markdown body — the actual spec content'),
        order_hint: z.string().optional().describe('Sortable string like "00", "01", "01.5". Lex compare; nulls sort last.'),
        parent_doc_uid: z.string().optional().describe('UID of a parent doc this nests under.'),
      },
    },
    async ({ plan_uid, doc_type, title, body, order_hint, parent_doc_uid }) => {
      const doc = planDocsService.createPlanDocument({
        planUid: plan_uid,
        docType: doc_type,
        title,
        body,
        author: 'agent',
        authorType: 'mcp',
        orderHint: order_hint ?? null,
        parentDocUid: parent_doc_uid ?? null,
      });
      broadcast('plan-doc-created', { doc });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(doc, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'update_plan_doc',
    {
      description: 'Update the body, title, type, ordering, or nesting of an existing spec doc. Body changes increment the version and snapshot the previous body for traceability.',
      inputSchema: {
        doc_uid: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        doc_type: z.string().optional().describe(docTypeDescription),
        order_hint: z.string().optional().describe('New sort hint (e.g. "01.5"). Pass empty string to clear.'),
        parent_doc_uid: z.string().optional().describe('New parent doc uid. Pass empty string to clear.'),
        change_summary: z.string().optional().describe('Why this update was made — shows up in the version history'),
      },
    },
    async ({ doc_uid, title, body, doc_type, order_hint, parent_doc_uid, change_summary }) => {
      const doc = planDocsService.updatePlanDocument(doc_uid, {
        title, body, docType: doc_type, changeSummary: change_summary, author: 'agent',
        orderHint: order_hint === '' ? null : order_hint,
        parentDocUid: parent_doc_uid === '' ? null : parent_doc_uid,
      });
      if (!doc) {
        return { content: [{ type: 'text' as const, text: `Doc ${doc_uid} not found` }] };
      }
      broadcast('plan-doc-updated', { doc });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(doc, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'get_plan_doc',
    {
      description: 'Fetch a single spec doc, either by its uid or by (plan_uid + doc_type). Returns the full markdown body. Use list_plan_docs first if you need to know what is available.',
      inputSchema: {
        doc_uid: z.string().optional().describe('Direct uid of the doc to fetch'),
        plan_uid: z.string().optional().describe('Plan uid (required if doc_uid not given)'),
        doc_type: z.string().optional().describe('Doc type to fetch from the plan (required if doc_uid not given). ' + docTypeDescription),
      },
    },
    async ({ doc_uid, plan_uid, doc_type }) => {
      let doc = null;
      if (doc_uid) {
        doc = planDocsService.getPlanDocument(doc_uid);
      } else if (plan_uid && doc_type) {
        doc = planDocsService.getPlanDocumentByType(plan_uid, doc_type);
      } else {
        return { content: [{ type: 'text' as const, text: 'Provide either doc_uid or (plan_uid + doc_type).' }] };
      }
      if (!doc) {
        return { content: [{ type: 'text' as const, text: 'Document not found' }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(doc, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'list_plan_docs',
    {
      description: 'List the spec docs attached to a plan. Returns a lightweight index (uid, type, title, length) — fetch full bodies separately with get_plan_doc to keep context small.',
      inputSchema: {
        plan_uid: z.string(),
      },
    },
    async ({ plan_uid }) => {
      const summaries = planDocsService.listPlanDocumentSummaries(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(summaries, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'search_plan_docs',
    {
      description: 'Substring search across the title and body of all spec docs in a plan. Returns matches with a short excerpt around the hit. Use this to find guidance on a specific topic without reading every doc.',
      inputSchema: {
        plan_uid: z.string(),
        query: z.string(),
      },
    },
    async ({ plan_uid, query }) => {
      const results = planDocsService.searchPlanDocuments(plan_uid, query);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
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

      // Also get plan tasks for context
      const plan = planService.getPlan(plan_uid);
      const completedTasks = plan?.tasks.filter((t) => t.status === 'done').length || 0;
      const totalTasks = plan?.tasks.length || 0;

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
      description: '[Legacy] Report a plan. Prefer create_plan instead.',
      inputSchema: {
        title: z.string(),
        steps: z.array(z.object({
          description: z.string(),
          files: z.array(z.string()).optional(),
        })),
      },
    },
    async ({ title, steps }) => {
      // Delegate to create_plan
      const plan = planService.createPlan(
        { title, description: '', tasks: steps.map((s: any) => ({ description: s.description, affectedFiles: s.files })) },
        'agent', 'mcp', '',
      );
      broadcast('plan-created', { plan });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Plan "${title}" created with UID: ${plan.uid}` }] };
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
  // Replaces (eventually) `add_plan_doc` / `add_plan_phase` /
  // `add_subtask` / `claim_task` / `read_task_full` / `update_task` /
  // `add_task_*` / `set_task_blocked` / `update_task_progress`.
  //
  // The old tools stay registered alongside and keep writing to legacy
  // tables for 15.C → 15.F. After the V1 frontend retires, alias the
  // old tools to forwarders (15.F).
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
      broadcast('plan-item-created', { planUid: item.planUid, item });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
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
      broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: args });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
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
      broadcast('plan-item-moved', {
        planUid: item.planUid,
        itemUid: item.uid,
        toParentUid: item.parentUid,
        sortOrder: item.sortOrder,
      });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
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
      broadcast('plan-item-deleted', { planUid: target.planUid, itemUid: args.uid, cascadedUids });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, deleted: cascadedUids }, null, 2) }] };
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
      if (item) {
        broadcast('plan-item-claimed', {
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
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: true, message, conflicts: result.conflicts ?? null, item, parent, children, attachments, comments }, null, 2),
        }],
      };
    },
  );

  // --- list_items -------------------------------------------------------
  mcpServer.registerTool(
    'list_items',
    {
      description:
        'Cheap tree query — returns title + kind + status + sortOrder + childCount per item, no bodies. ' +
        'Use as the sidebar/navigation read. Filter by parent_uid to fetch one nesting level at a time.',
      inputSchema: {
        plan_uid: z.string(),
        parent_uid: z.string().optional().describe('Pass empty string for top-level only. Omit to get the whole plan.'),
        kind: planItemKindEnum.optional(),
      },
    },
    async (args) => {
      const all = planItemService.listItemSummaries(args.plan_uid);
      let filtered = all;
      if (args.parent_uid !== undefined) {
        const targetParent = args.parent_uid === '' ? null : args.parent_uid;
        filtered = filtered.filter((i) => i.parentUid === targetParent);
      }
      if (args.kind) filtered = filtered.filter((i) => i.kind === args.kind);
      return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }] };
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
      broadcast('plan-item-version-saved', { planUid: item.planUid, itemUid: item.uid, restoredFrom: args.version });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
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
      broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(comment, null, 2) }] };
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
      broadcast('plan-item-progress', { planUid: item.planUid, itemUid: args.uid, percent: args.percent, message: body, commentUid: comment.uid });
      broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify({ uid: args.uid, percent: args.percent, message: body }, null, 2) }] };
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
      broadcast('plan-item-blocked', { planUid: item.planUid, itemUid: args.uid, reason: args.reason, commentUid: comment.uid });
      broadcast('plan-item-updated', { planUid: item.planUid, itemUid: args.uid, kind: 'action', changes: { status: 'blocked' } });
      broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify({ uid: args.uid, status: 'blocked', reason: args.reason }, null, 2) }] };
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
        broadcast('plan-item-attachment-added', { planUid: item.planUid, itemUid: args.uid, attachment });
        saveNow(() => exportDatabase());
        return { content: [{ type: 'text' as const, text: JSON.stringify(attachment, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
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
