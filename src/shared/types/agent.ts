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
 * need no consent: a git worktree (the main checkout is one too), and a
 * shared checkout — two or more agents in one folder. A1.7a adds `branch`:
 * committed work on a branch with no checkout on this machine. A1.7c adds
 * `clone`: another checkout of the same repository in its own folder, once
 * the person has included it.
 */
export type WorkstreamShape = 'worktree' | 'shared' | 'branch' | 'clone';

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
  /**
   * The working tree's folder, as git lists it. Also its id. A branch
   * workstream has no folder: its id is `branch:<name>`.
   */
  root: string;
  /** For a branch workstream, its full ref (`refs/heads/x`, `refs/remotes/origin/x`). */
  ref?: string;
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
  /**
   * What agents in it have said they are about to change (A2.4), one per
   * session. Part of its footprint, so overlaps show before files change.
   */
  intents?: WorkstreamIntent[];
}

/**
 * An agent's declared intent (A2.4). `summary` is the agent's own words: shown
 * to the person and to that agent, never to another agent.
 */
export interface WorkstreamIntent {
  sessionId: string;
  agentType: string;
  summary: string;
  /** Relative to the repository root. */
  paths: string[];
  /** Bare names (apply to every path) or `path#name`. */
  symbols: string[];
  declaredAt: number;
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
  /** `modified` means its own source text changed. */
  change: 'added' | 'removed' | 'modified';
  /** 1-based line in the current version, or in the base when removed. */
  line: number;
  /**
   * Set on a `modified` symbol whose shape changed too — parameters, return
   * type, a type's members (A2.1). Absent for a body-only edit, and for a
   * language whose parser gives no signatures.
   */
  signature?: { before: string; after: string };
  /**
   * Another file can import it (A2.3): it, or for a member the type it
   * belongs to, is exported. TS/JS: marked `export`. Python: no leading
   * underscore, or listed in `__all__`. Absent where the language marks
   * nothing, so no contract signal can come from it.
   */
  exported?: true;
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
 * The kinds built so far. `collision`, `contract` (A2.3) and `stale-base`
 * come from the footprints; `drift`, `rule`, `duplicate` and `decision`
 * follow (awareness spec §4.3).
 */
export type SignalKind = 'collision' | 'contract' | 'stale-base';
export type SignalSeverity = 'high' | 'medium' | 'low';
/**
 * Where a signal stands (A1.6, set by a person from A1.8):
 *  - `open`: nobody has looked at it;
 *  - `acknowledged`: seen, still true, nothing to do yet;
 *  - `intended`: the overlap is on purpose ("both tickets change this");
 *  - `dismissed`: not worth attention;
 *  - `resolved`: its cause is gone. Set by the engine, never by a person.
 */
export type SignalState = 'open' | 'acknowledged' | 'intended' | 'dismissed' | 'resolved';

/** The states a person may set. `resolved` belongs to the engine. */
export const SETTABLE_SIGNAL_STATES = ['open', 'acknowledged', 'intended', 'dismissed'] as const;
export type SettableSignalState = typeof SETTABLE_SIGNAL_STATES[number];

/** Who set a signal's state, as the call arrived (see `actorFrom` in server.ts). */
export interface SignalStateBy {
  actor: string;
  actorType: 'human' | 'unverified';
  channel: 'desktop' | 'local-api';
}

export interface AwarenessSignal {
  /** Stable for the same (kind, subject, workstreams): a signal that keeps firing is updated, not re-sent. */
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  /**
   * What it is about: a file, and for a symbol collision the symbol.
   * Stale-base lists its files. A contract names the file and symbol that
   * changed, which workstream changed it (`by`), how (`change`, with the
   * signature before and after), and the other side's files that import it
   * (`importers`; `possibly` when they only import the module as a namespace).
   */
  subject: {
    file?: string;
    symbol?: string;
    files?: string[];
    by?: string;
    change?: 'signature' | 'removed';
    signature?: { before: string; after: string };
    importers?: string[];
    possibly?: boolean;
    /** A collision whose side (by root) has only declared it, not changed anything yet (A2.4). */
    intended?: string[];
  };
  /** The workstreams it names, by folder, sorted. */
  workstreams: string[];
  /** One line a person can read. Describes the change; never quotes an agent. */
  summary: string;
  firstSeen: number;
  lastSeen: number;
  state: SignalState;
  /** Who last set the state, and when; absent while nobody has (A1.8). */
  stateBy?: SignalStateBy;
  stateAt?: number;
}
