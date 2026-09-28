import type { ArchitectureDiff } from './graph';
import type { SymbolKind } from './ast';

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
  /** What it has changed since it branched from the main checkout (A1.4). */
  changes: WorkstreamChanges;
  /** No agent in it and nothing changed. Hidden unless asked for. */
  idle: boolean;
}

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  /** Relative to the workstream's folder, with `/` separators. */
  path: string;
  status: ChangedFileStatus;
  /** The old path, for a rename. */
  from?: string;
  /**
   * The symbols the change touches, against the merge base (A1.5). Absent
   * when the file's language is not parsed, or past the parse limit — which
   * is not the same as an empty list, "changed no symbols".
   */
  symbols?: SymbolChange[];
}

export interface SymbolChange {
  /** Unique in its file: members carry their parent (`Session.renew`, `(Ledger).Post`). */
  name: string;
  kind: SymbolKind;
  /** `modified` means its own source text changed; signatures are A2's. */
  change: 'added' | 'removed' | 'modified';
  /** 1-based line in the current version, or in the base when removed. */
  line: number;
}

/**
 * A workstream's changed files: committed since its merge base with the
 * main checkout, plus uncommitted and untracked work in its folder. The
 * first part of its footprint (awareness spec §4.2).
 */
export interface WorkstreamChanges {
  /** The merge base compared against, or null when there is none (no commits). */
  base: string | null;
  files: ChangedFile[];
  /** More files changed than are listed. */
  truncated: boolean;
}

// ── Awareness signals (Phase 32 A1.6) ────────────────────────────────

/**
 * The kinds built so far. `collision` and `stale-base` come from the
 * footprints; `contract`, `drift`, `rule`, `duplicate` and `decision` follow
 * (awareness spec §4.3).
 */
export type SignalKind = 'collision' | 'stale-base';
export type SignalSeverity = 'high' | 'medium' | 'low';
export type SignalState = 'open' | 'acknowledged' | 'intended' | 'resolved';

export interface AwarenessSignal {
  /** Stable for the same (kind, subject, workstreams): a signal that keeps firing is updated, not re-sent. */
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  /** What it is about: a file, and for a symbol collision the symbol. Stale-base lists its files. */
  subject: { file?: string; symbol?: string; files?: string[] };
  /** The workstreams it names, by folder, sorted. */
  workstreams: string[];
  /** One line a person can read. Describes the change; never quotes an agent. */
  summary: string;
  firstSeen: number;
  lastSeen: number;
  state: SignalState;
}
