import type { ArchitectureDiff } from './graph';
import type { SymbolKind } from './ast';

/** `app`: something recorded by the app itself, e.g. a spec body edited (Phase 32 B1.2). */
export type AgentEventSource = 'mcp' | 'claude-code-watcher' | 'file-watcher' | 'app';

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
  | 'tool_error'
  /** A spec document's or a plan item's body changed (Phase 32 B1.2). */
  | 'spec_edited'
  /** Claude Code loaded a skill (Phase 32 C1.3): proof of use for the tasks it is working. */
  | 'skill_used'
  /** A person approved or sent back a criterion (Phase 32 B2.2). */
  | 'criterion_decided'
  /** A plan's criteria were checked (Phase 32 B2.2), per workstream of the items checked. */
  | 'check_run'
  /** An agent's call held at a breakpoint (Phase 32 B4): it waits for a person. */
  | 'breakpoint_hit'
  /** A person answered a breakpoint: continue, continue with a steer, or stop (Phase 32 B4). */
  | 'breakpoint_answered';

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

/** One of a workstream's own commits, for its Timeline lane (Phase 32 B2.2). */
export interface WorkstreamCommit {
  sha: string;
  /** When it was committed, ms. */
  at: number;
  author: string;
  subject: string;
  /** More than one parent. */
  merge: boolean;
  /** The agent named by an `agent: <type>` line in the message, when there is one. */
  agent: string | null;
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
  /**
   * Phase 32 B3.3 — lines added and removed against the merge base, as
   * `git diff --numstat` counts them. Absent for a binary file and for one
   * git does not track yet.
   */
  added?: number;
  removed?: number;
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
   * type, a type's members (A2.1). Absent for a body-only edit.
   */
  signature?: { before: string; after: string };
  /**
   * Set on a `modified` symbol when its shape cannot be compared (A2.7): the
   * parser gives none for it (a Go struct, a Kotlin class). Then it is not
   * known whether its signature changed, which is never read as "unchanged".
   */
  signatureUnknown?: true;
  /**
   * Another file can import it (A2.3): it, or for a member the type it
   * belongs to, is exported. TS/JS: marked `export`. Python: no leading
   * underscore, or listed in `__all__`. The other languages by their own
   * rule (A2.7, `isExported` in workstream-symbols.ts). Absent where the
   * language marks nothing, so no contract signal can come from it.
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
  /**
   * Phase 32 C5.3b — how far it is from main: commits it has that main does
   * not (`ahead`), commits main has that it does not (`behind`), and files
   * not yet committed. Absent when git could not say, which is not zero.
   */
  ahead?: number;
  behind?: number;
  uncommitted?: number;
}

// ── Line changes (Phase 32 B3.1) ─────────────────────────────────────

/**
 * One run of changed lines in a workstream's copy of a file, against its
 * merge base with main. From git, never from an agent's report.
 */
export interface LineHunk {
  /** `added`: no base lines replaced; `removed`: no lines in its copy; else `changed`. */
  kind: 'added' | 'changed' | 'removed';
  /** In the base version: first line and how many (0 for `added`; start is the line before). */
  old: { start: number; lines: number };
  /** In its copy: first line and how many (0 for `removed`; start is the line before). */
  new: { start: number; lines: number };
  /** The innermost functions, methods or types the lines fall in (base side for `removed`). */
  functions: string[];
  /** False when any of it is not committed yet. */
  committed: boolean;
}

/** One workstream's changed lines in one file (B3.1). */
export interface WorkstreamLineChanges {
  /** The workstream's id (its folder, or `branch:<name>`). */
  workstream: string;
  branch: string | null;
  /** Relative to the repository root. */
  path: string;
  /**
   * `changed` with hunks; `unchanged` when it does not change the file;
   * `binary` and `too-large` say so instead of lines; `unreadable` when the
   * copy could not be read inside its folder (a link out of it, say).
   */
  status: 'changed' | 'unchanged' | 'binary' | 'too-large' | 'unreadable';
  hunks: LineHunk[];
  /** Lines added and removed, as `git diff --numstat` counts them. */
  added: number;
  removed: number;
  /** The unified diff, only when asked for. */
  diff?: string;
  /** The diff was cut short. */
  diffTruncated?: boolean;
}

// ── Awareness signals (Phase 32 A1.6) ────────────────────────────────

/**
 * The kinds built so far. `collision`, `contract` (A2.3), `drift` (A2.5) and
 * `stale-base` come from the footprints; `rule`, `duplicate` and `decision`
 * follow (awareness spec §4.3). Tasks' materials (A6.3) raise the same kinds
 * with `subject.material` set, and one of their own: `version-split`, two
 * tasks that read different versions of one file.
 */
export type SignalKind = 'collision' | 'contract' | 'drift' | 'stale-base' | 'version-split';
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

/**
 * Who set a signal's state or replied about it, as the call arrived (see
 * `actorFrom` in server.ts; `phone` is a paired phone, from A4.2).
 */
export interface SignalStateBy {
  actor: string;
  actorType: 'human' | 'unverified';
  channel: 'desktop' | 'local-api' | 'phone';
}

/**
 * A person's message to the agents about a signal (A4.1), and the agent
 * sessions that have read it: each reads it once, on its next tool call.
 */
export interface SignalReply {
  id: number;
  message: string;
  by: SignalStateBy;
  at: number;
  readBy: Array<{ sessionId: string; agentType: string; readAt: number }>;
}

/** An agent session that was told about a signal, and what it said (A2.6). */
export interface SignalTold {
  sessionId: string;
  agentType: string;
  /** When its tool result carried the notice, or it read the signal; null if it only left a note. */
  toldAt: number | null;
  /** The agent's own words, from acknowledge_signal. */
  note?: string;
  notedAt?: number;
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
    /** Drift: the claimed items whose scope the files fall outside (A2.5). */
    items?: string[];
    /**
     * A material signal (A6.3): the file several tasks use, project-relative.
     * Its workstreams are tasks (`task:<uid>`), named in `labels`.
     */
    material?: string;
    /** Each task workstream's title, by id, so every surface names it the same. */
    labels?: Record<string, string>;
    /** Contract: the parts of the material the tasks cite, in words ("Summary!B2:F9"). */
    parts?: string[];
    /** Contract: the tasks that cite it. */
    citedBy?: string[];
    /** Contract: the tasks whose citation of it was already signed off. */
    signedOff?: string[];
    /** Version split: which version each task read last. */
    readVersions?: Record<string, 'current' | 'earlier'>;
  };
  /** The workstreams it names, by folder, sorted. */
  workstreams: string[];
  /** One line a person can read. Describes the change; never quotes an agent. */
  summary: string;
  firstSeen: number;
  lastSeen: number;
  state: SignalState;
  /**
   * The agent sessions told about it, and the note each left (A2.6). Shown
   * to the person; an agent sees only its own.
   */
  told?: SignalTold[];
  /** Fingerprint of what it is about (A3.2): an answer holds while this does. */
  shape?: string;
  /** It had been acknowledged or marked intended, and opened again when its shape changed (A3.2). */
  reopened?: { from: 'acknowledged' | 'intended'; at: number };
  /** Who last set the state, and when; absent while nobody has (A1.8). */
  stateBy?: SignalStateBy;
  stateAt?: number;
  /** The person's messages to the agents about it (A4.1), oldest first. */
  replies?: SignalReply[];
}
