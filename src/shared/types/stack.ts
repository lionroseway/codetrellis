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
  /** The branch this task is worked on, its own or inherited from a section above it. */
  workstream: string | null;
  ticketKey: string | null;
  dependencies: StackDependency[];
  /** `"Deploy" waits on "Migrate" in plan "Billing v2".` — `null` when nothing holds it. */
  waits: string | null;
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
}

export interface Stack {
  project: string;
  plans: StackPlan[];
}
