import type { ArchitectureDiff } from './graph';

export type AgentEventSource = 'mcp' | 'claude-code-watcher' | 'file-watcher';

export type AgentEventType =
  | 'plan_reported'
  | 'architecture_query'
  | 'conformity_check'
  | 'file_changed'
  | 'session_start'
  | 'session_end'
  // Phase 11+ — every MCP tool call broadcasts on this channel with
  // a normalized `{ tool, args, agentType, durationMs }` payload.
  | 'tool_call'
  | 'tool_error';

export interface AgentEvent {
  id: string;
  timestamp: number;
  source: AgentEventSource;
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface AgentPlanStep {
  description: string;
  status: PlanStepStatus;
  files: string[];
}

/**
 * Status of an *inferred* AgentPlan (the lightweight plan derived
 * from a Claude Code session's chat heuristics — not the canonical
 * persisted Plan from `./plan.ts`, which has its own richer status).
 */
export type AgentPlanStatus = 'proposed' | 'in_progress' | 'completed' | 'abandoned';

export interface AgentPlan {
  id: string;
  title: string;
  steps: AgentPlanStep[];
  status: AgentPlanStatus;
  affectedFiles: string[];
  estimatedImpact: ArchitectureDiff | null;
}

export type AgentStatus = 'idle' | 'active' | 'paused';

// ── Workstreams (Phase 32 A1.3) ──────────────────────────────────────

/**
 * How a line of parallel work is isolated. A1.3 finds the two shapes that
 * need no consent and no refs watcher: a git worktree (the main checkout is
 * one too), and a shared checkout — two or more agents in one folder. Clones
 * and branch-only work are A1.7.
 */
export type WorkstreamShape = 'worktree' | 'shared';

export interface WorkstreamAgent {
  sessionId: string;
  agentType: string;
  model: string | null;
  /**
   * How we know it is there: an MCP connection, or only Claude Code's own
   * session log (a Claude session that never connected to CodeTrellis).
   */
  source: 'mcp' | 'claude-log';
  /** Last activity, for MCP sessions. The log gives no liveness beat. */
  lastSeen: number | null;
}

export interface Workstream {
  /** The working tree's folder, as git lists it. Also its id. */
  root: string;
  /** Short branch name, or null when detached. */
  branch: string | null;
  /** The commit checked out, when git reports one. */
  head: string | null;
  /** The repository's main working tree, rather than a linked one. */
  main: boolean;
  shape: WorkstreamShape;
  agents: WorkstreamAgent[];
  /** No agent in it. Hidden unless asked for (it has no changes to show yet — A1.4). */
  idle: boolean;
}
