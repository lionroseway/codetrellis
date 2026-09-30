/**
 * Phase 32 B6.2 — the stack: every active plan in a project, and its tasks,
 * in one answer. The window's Stack tab (B6.4), any MCP client (`get_stack`)
 * and the phone (B6.6) read this one shape.
 */

/** One dependency of a task, met or not, wherever it lives. */
export interface StackDependency {
  uid: string;
  met: boolean;
  /** Why it is not met; `null` when it is. */
  problem: 'unfinished' | 'missing' | 'page' | null;
  title: string | null;
  planUid: string | null;
  /** Set only when the dependency is in another plan. */
  planTitle: string | null;
  /** What the task is waiting for, in a phrase; `null` when it is met. */
  words: string | null;
}

export interface StackTask {
  uid: string;
  parentUid: string | null;
  kind: 'object' | 'action';
  title: string;
  /** `null` for a page, which has no status. */
  status: string | null;
  assignee: string | null;
  assigneeType: string | null;
  /** The agent session that claimed it, so the Timeline can follow the plan (B6.4b). */
  assigneeSession: string | null;
  /** The branch this task is worked on, its own or inherited from a section above it. */
  workstream: string | null;
  ticketKey: string | null;
  /** The files it names (its file specs, and the files its symbol specs live in): its footprint on the graph. */
  files: string[];
  dependencies: StackDependency[];
  /** `"Deploy" waits on "Migrate" in plan "Billing v2".` — `null` when nothing holds it. */
  waits: string | null;
  /**
   * The materials its sessions had read, the latest read of each, by then
   * for the stack at a moment (HD3): which version of a spreadsheet the
   * task was working from.
   */
  reads: StackRead[];
}

/** A task's latest read of one material (A6.2's `material_reads`). */
export interface StackRead {
  /** Project-relative: the material's identity across tasks. */
  path: string;
  /** The file's hash when it was read; null when it could not be taken. */
  sha256: string | null;
  /** Epoch ms of the read. */
  at: number;
  /** `read sales-2026.xlsx on 22 Sept (version 3f9c2e1)` */
  words: string;
}

export interface StackPlan {
  uid: string;
  title: string;
  status: string;
  /** The plan's ticket key (`JIRA-142`) when it has one. */
  ticketKey: string | null;
  /** What the row is called: the ticket key when there is one, else the title. */
  label: string;
  progress: { done: number; total: number };
  /** Breakpoint hits in this plan waiting on a person. */
  needsYou: number;
  tasks: StackTask[];
  /** Other plans this one touches (B6.3), declared or actual. */
  overlaps: StackOverlap[];
}

/** An open awareness signal between the two plans' lines of work. */
export interface StackOverlapSignal {
  id: string;
  /** A material's changed or split versions count too (HD3): the business form of two lines of work meeting. */
  kind: 'collision' | 'contract' | 'version-split' | 'stale-base';
  severity: 'high' | 'medium' | 'low';
  summary: string;
}

/**
 * Phase 32 B6.3 — where this plan meets another. Declared: both plans'
 * unfinished tasks name the same files or functions, or list the same
 * material in their briefs (HD3). Actual: an open collision or contract
 * signal between the lines of work their tasks are worked on, or a material
 * signal between two of their tasks (HD3). Either, or both.
 */
export interface StackOverlap {
  withPlanUid: string;
  withLabel: string;
  /** `materials` are project-relative paths of materials both plans' briefs list (HD3). */
  declared: { files: string[]; symbols: string[]; materials: string[] };
  actual: StackOverlapSignal[];
  /** A high signal is open between them. */
  high: boolean;
  /** `⚠ overlaps JIRA-150` */
  words: string;
  /** What they share, in a sentence. */
  detail: string;
}

export interface Stack {
  project: string;
  plans: StackPlan[];
}
