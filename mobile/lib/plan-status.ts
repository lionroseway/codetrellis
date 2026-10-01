/**
 * A plan's status, on the phone (Phase 32 C2.4, over `plan.status`).
 *
 * The desktop reads it, never writes it: every item's state with its source
 * (git or the review host for an item on a branch, the plan itself for
 * everything else), and the one view — progress, what waits on someone,
 * what is under way, and the lineage. The same answer the window shows and
 * an agent's get_plan returns.
 */

import { rpc } from './rpc';

export type StateSource = 'plan' | 'git' | 'github' | 'gitlab' | 'bitbucket';

export interface StatusLine {
  itemUid: string;
  title: string;
  words: string;
  source: StateSource;
  from: string;
}

export interface PhonePlanStatus {
  planUid: string;
  title: string;
  progress: { done: number; total: number; words: string };
  waiting: StatusLine[];
  inProgress: StatusLine[];
  lineage: string[];
  updatedAt: number | null;
  items: Array<StatusLine & { itemUid: string; state: string; recorded: { by: string; at: number } | null }>;
}

export function fetchPlanStatus(planUid: string): Promise<PhonePlanStatus> {
  return rpc<PhonePlanStatus>('plan.status', { planUid });
}
