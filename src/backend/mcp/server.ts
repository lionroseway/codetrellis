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
import { getDeviations, resolveDeviation, detectDeviations } from '../services/deviation-service';
import { captureCurrentTrellis, listSnapshots, computeTrellisDiff } from '../services/trellis-service';
import { saveNow } from '../services/persistence';
import { exportDatabase } from '../services/database';
import { buildSkillGuide } from './skill-guide';

const MCP_PORT = 19432;

let mcpServer: McpServer | null = null;
let httpServer: http.Server | null = null;
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

export async function startMcpServer(): Promise<void> {
  if (mcpServer) return;

  mcpServer = new McpServer(
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

  // --- Plan Management Tools ---

  const symbolSpecSchema = z.object({
    name: z.string().describe('Symbol name (e.g. "verifyToken")'),
    kind: z.enum(['function', 'class', 'interface', 'type', 'method', 'enum']),
    action: z.enum(['add', 'modify', 'remove', 'move']),
    description: z.string().optional().describe('What the symbol does or why it changes'),
    signature: z.string().optional().describe('Type signature, e.g. "verifyToken(token: string, secret: string): JwtPayload"'),
    moveTo: z.string().optional().describe('Target file path if action is "move"'),
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
          affected_files: z.array(z.string()).optional().describe('Files this task will create/modify/delete'),
          affected_symbols: z.array(z.string()).optional().describe('Functions/classes this task will add/change (names only — use symbol_specs for richer intent)'),
          new_connections: z.array(z.object({ from: z.string(), to: z.string() })).optional().describe('New import relationships'),
          removed_connections: z.array(z.object({ from: z.string(), to: z.string() })).optional().describe('Import relationships to remove'),
          dependencies: z.array(z.string()).optional().describe('Task UIDs that must complete before this one starts'),
          file_spec: z.string().optional().describe('Markdown describing what the file should do, its responsibility, exports, etc.'),
          symbol_specs: z.array(symbolSpecSchema).optional().describe('Per-symbol intent: name, kind, action, signature, etc. Richer than affected_symbols.'),
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

  mcpServer.registerTool(
    'claim_task',
    {
      description: 'Claim a task from a plan. Only succeeds if the task is unclaimed and pending.',
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
      }
      const msg = result.ok
        ? (result.conflicts ? `Task claimed. WARNING: ${result.conflicts.join('; ')}` : `Task ${task_uid} claimed.`)
        : 'Task already claimed or not pending.';
      return { content: [{ type: 'text' as const, text: msg }] };
    }
  );

  mcpServer.registerTool(
    'update_task',
    {
      description: 'Update task status. Use this to report progress: pending → in_progress → done.',
      inputSchema: {
        plan_uid: z.string(),
        task_uid: z.string(),
        status: z.enum(['pending', 'assigned', 'in_progress', 'done', 'blocked', 'skipped']),
      },
    },
    async ({ plan_uid, task_uid, status }) => {
      planService.updateTask(task_uid, { status });
      broadcast('task-updated', { planUid: plan_uid, taskUid: task_uid, status });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Task ${task_uid} → ${status}` }] };
    }
  );

  mcpServer.registerTool(
    'get_next_task',
    {
      description: 'Get the next available unclaimed task from a plan, respecting dependency order.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      const task = planService.getNextTask(plan_uid);
      if (!task) return { content: [{ type: 'text' as const, text: 'No tasks available — all claimed, completed, or blocked by dependencies.' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
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
      description: 'Register this agent connection with CodeTrellis. Identifies who you are and what model you use.',
      inputSchema: {
        agent_type: z.string().describe('Agent type, e.g. claude-code, cursor, aider'),
        model: z.string().optional().describe('Model name, e.g. claude-opus-4, gpt-4o'),
      },
    },
    async ({ agent_type, model }) => {
      const sessionId = `mcp-${Date.now()}`;
      sessionService.registerSession(sessionId, agent_type, model);
      broadcast('session-registered', { sessionId, agentType: agent_type, model });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Session registered: ${sessionId}` }] };
    }
  );

  mcpServer.registerTool(
    'set_active_plan',
    {
      description: 'Associate this agent session with a plan, indicating you are working on it.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      // Find the most recent session for this transport
      const sessions = sessionService.getActiveSessions();
      if (sessions.length > 0) {
        sessionService.setActivePlan(sessions[sessions.length - 1].sessionId, plan_uid);
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
      description: 'Attach a spec document to a plan — patterns to follow, security considerations, test strategy, examples, research notes, etc. Doc body is markdown. Use this instead of stuffing everything into the plan description.',
      inputSchema: {
        plan_uid: z.string(),
        doc_type: z.string().describe(docTypeDescription),
        title: z.string().describe('Short human-readable title for the doc'),
        body: z.string().describe('Markdown body — the actual spec content'),
      },
    },
    async ({ plan_uid, doc_type, title, body }) => {
      const doc = planDocsService.createPlanDocument({
        planUid: plan_uid,
        docType: doc_type,
        title,
        body,
        author: 'agent',
        authorType: 'mcp',
      });
      broadcast('plan-doc-created', { doc });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: JSON.stringify(doc, null, 2) }] };
    }
  );

  mcpServer.registerTool(
    'update_plan_doc',
    {
      description: 'Update the body, title, or type of an existing spec doc. Body changes increment the version and snapshot the previous body for traceability.',
      inputSchema: {
        doc_uid: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        doc_type: z.string().optional().describe(docTypeDescription),
        change_summary: z.string().optional().describe('Why this update was made — shows up in the version history'),
      },
    },
    async ({ doc_uid, title, body, doc_type, change_summary }) => {
      const doc = planDocsService.updatePlanDocument(doc_uid, {
        title, body, docType: doc_type, changeSummary: change_summary, author: 'agent',
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

  // --- Trellis Tools ---

  mcpServer.registerTool(
    'get_drift_report',
    {
      description: 'Check if you are still following the plan. Compares the baseline snapshot (captured at plan approval) against the current live state. Returns what has changed, what is on track, and what has drifted.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
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

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        planTitle: plan?.title,
        taskProgress: `${completedTasks}/${totalTasks}`,
        filesChanged: diff.addedFiles.length + diff.modifiedFiles.length,
        addedFiles: diff.addedFiles,
        modifiedFiles: diff.modifiedFiles,
        removedFiles: diff.removedFiles,
        addedEdges: diff.addedEdges.length,
        removedEdges: diff.removedEdges.length,
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

      await mcpServer!.connect(transport);
      return;
    }

    if (req.url?.startsWith('/messages') && req.method === 'POST') {
      const sessionId = new URL(req.url, `http://localhost:${MCP_PORT}`).searchParams.get('sessionId');
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

  return new Promise<void>((resolve) => {
    app.listen(MCP_PORT, '127.0.0.1', () => {
      console.log(`[MCP] Server running on http://127.0.0.1:${MCP_PORT}`);
      resolve();
    });
  });
}

export function getMcpStatus(): {
  running: boolean;
  port: number;
  connectedAgents: number;
} {
  return {
    running: httpServer !== null,
    port: MCP_PORT,
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
      url: `http://127.0.0.1:${MCP_PORT}/sse`,
    },
  };
}

export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (mcpServer) {
    await mcpServer.close();
    mcpServer = null;
  }
  connectedTransports.clear();
}
