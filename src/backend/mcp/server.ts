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
import { applyTemplate } from '../services/plan-templates-service';
import { listTemplates } from '../services/plan-templates';
import * as planChangesService from '../services/plan-changes-service';
import { getDeviations, resolveDeviation, detectDeviations } from '../services/deviation-service';
import { captureCurrentTrellis, listSnapshots, computeTrellisDiff } from '../services/trellis-service';
import { saveNow } from '../services/persistence';
import { exportDatabase } from '../services/database';
import { buildSkillGuide } from './skill-guide';

/**
 * Default + max-attempt range. The user-configured port comes from
 * settings (`mcp.port`); if `mcp.autodetectOnCollision` is true and
 * that port is in use, we walk forward up to MAX_PORT_ATTEMPTS slots.
 * The actually-bound port is reported via getMcpStatus() and broadcast
 * over WS so the frontend's "Copy MCP config" buttons stay accurate.
 */
const DEFAULT_MCP_PORT = 19432;
const MAX_PORT_ATTEMPTS = 10;

let mcpServer: McpServer | null = null;
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

  mcpServer.registerTool(
    'list_cross_system_edges',
    {
      description: 'Cross-system edges — non-import couplings between files inferred from runtime patterns. Today: HTTP fetches in TS/JS matched against FastAPI/Flask routes in Python (more protocols coming: SQL refs, subprocess, env-configured URLs, OpenAPI contracts). Use this to see how the frontend talks to the backend even when no import edges exist.',
      inputSchema: {},
    },
    async () => {
      const { listCrossSystemEdges, getCrossSystemStats } = require('../services/cross-system-service');
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
      description: 'Update task status, or assign / reassign it to a phase. Use this to report progress: pending → in_progress → done. Pass phase_uid to bind the task to a phase, or empty string to clear.',
      inputSchema: {
        plan_uid: z.string(),
        task_uid: z.string(),
        status: z.enum(['pending', 'assigned', 'in_progress', 'done', 'blocked', 'skipped']).optional(),
        phase_uid: z.string().optional().describe('Bind this task to a phase. Empty string clears the binding.'),
      },
    },
    async ({ plan_uid, task_uid, status, phase_uid }) => {
      const updates: Parameters<typeof planService.updateTask>[1] = {};
      if (status !== undefined) updates.status = status;
      if (phase_uid !== undefined) updates.phaseUid = phase_uid === '' ? null : phase_uid;
      planService.updateTask(task_uid, updates);
      if (status !== undefined) {
        broadcast('task-updated', { planUid: plan_uid, taskUid: task_uid, status });
      } else {
        broadcast('task-updated', { planUid: plan_uid, taskUid: task_uid });
      }
      saveNow(() => exportDatabase());
      const summary = [status && `status → ${status}`, phase_uid !== undefined && `phase → ${phase_uid || 'none'}`]
        .filter(Boolean).join(', ');
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
      const { exportPlan } = require('../services/plan-file-service');
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
      const { importPlan } = require('../services/plan-file-service');
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
      const { discoverPlanDirs } = require('../services/plan-file-service');
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
      const { unlinkPlan } = require('../services/plan-file-service');
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
      const { publishPlanAsTemplate } = require('../services/plan-template-publish-service');
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
      description: 'Register this agent connection with CodeTrellis. Identifies who you are and what model you use. Upgrades the auto-registered session for this transport so the human can tell agents apart in the Connected Agents list.',
      inputSchema: {
        agent_type: z.string().describe('Agent type, e.g. claude-code, cursor, aider'),
        model: z.string().optional().describe('Model name, e.g. claude-opus-4, gpt-4o'),
      },
    },
    async ({ agent_type, model }, extra: any) => {
      // Prefer the caller's actual transport sessionId so multiple
      // simultaneous agents stay attributed correctly. Fall back to a
      // synthetic id only if the transport context is missing.
      const sessionId = extra?.sessionInfo?.sessionId
        ?? extra?.requestInfo?.headers?.['mcp-session-id']
        ?? `mcp-${Date.now()}`;
      sessionService.registerSession(sessionId, agent_type, model);
      broadcast('session-registered', { sessionId, agentType: agent_type, model });
      broadcast('mcp-session-changed', { reason: 'register', sessionId });
      saveNow(() => exportDatabase());
      return { content: [{ type: 'text' as const, text: `Session registered: ${sessionId} (${agent_type}${model ? ` / ${model}` : ''})` }] };
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
  const { getSettings } = require('../services/settings-service');
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
  if (mcpServer) {
    await mcpServer.close();
    mcpServer = null;
  }
  connectedTransports.clear();
}
