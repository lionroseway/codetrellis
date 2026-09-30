/**
 * Phase 32 B4 — breakpoints: places a person has said "stop and ask me",
 * and the agent calls held at them. Shared by the backend
 * (`services/breakpoint-service.ts`) and the window (the waiting list).
 */

/**
 * `proposal` (B7.4) is never set by a person: the service raises one when an
 * agent proposes a spec change, so the decision waits in the same inbox.
 */
export const BREAKPOINT_KINDS = ['task', 'spec', 'code', 'signal', 'proposal'] as const;
export type BreakpointKind = typeof BREAKPOINT_KINDS[number];
/** The signal kinds a signal breakpoint can be on: the ones that can be serious. */
export const SIGNAL_BREAK_KINDS = ['collision', 'contract', 'drift'] as const;
export const BREAKPOINT_DECISIONS = ['continue', 'steer', 'stop'] as const;
export type BreakpointDecision = typeof BREAKPOINT_DECISIONS[number];
/** What the held call would have done. */
export type BreakpointAction = 'claim' | 'done' | 'edit' | 'delete' | 'edit_code' | 'breach' | 'propose';

export interface Breakpoint {
  id: string;
  kind: BreakpointKind;
  /** The item it is on; for a code breakpoint, the repository-relative path (a folder ends in `/`, a function is `path#name`). */
  target: string;
  targetTitle: string | null;
  planUid: string | null;
  /** A code breakpoint's project. */
  projectRoot: string | null;
  note: string | null;
  createdAt: number;
  createdBy: string;
  createdByType: string;
}

export interface BreakpointHit {
  ref: string;
  breakpointId: string;
  kind: BreakpointKind | null;
  /** The note the person left on the breakpoint. */
  breakpointNote: string | null;
  /** What the breakpoint is on (for code, a path, or `path#name` for a function). */
  breakpointTarget: string | null;
  tool: string;
  action: BreakpointAction;
  itemUid: string;
  itemTitle: string | null;
  /** A code hit's file, repository-relative. */
  path: string | null;
  /** A change seen only after it was made: recorded, never paused. */
  breach: boolean;
  /** The serious signal that held the call, for a signal breakpoint. */
  signalId: string | null;
  planUid: string | null;
  agent: string | null;
  sessionId: string | null;
  workstreamRoot: string | null;
  hitAt: number;
  decision: BreakpointDecision | null;
  note: string | null;
  answeredAt: number | null;
  answeredBy: string | null;
  answeredByType: string | null;
}
