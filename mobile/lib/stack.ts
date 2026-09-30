/**
 * The stack, on the phone (Phase 32 B6.6, over B6.2's `stack.summary`).
 *
 * The desktop computes it: every plan under way, with who is on each task,
 * what waits on what across plans, and where plans meet. The phone shows it
 * summarised: each plan's progress, its overlaps in words, who is on what,
 * and what is waiting.
 */

import { rpc } from './rpc';

export interface StackDependency {
  uid: string;
  met: boolean;
  problem: 'unfinished' | 'missing' | 'page' | null;
  title: string | null;
  planUid: string | null;
  planTitle: string | null;
  words: string | null;
}

export interface StackTask {
  uid: string;
  parentUid: string | null;
  kind: 'object' | 'action';
  title: string;
  status: string | null;
  assignee: string | null;
  workstream: string | null;
  ticketKey: string | null;
  dependencies: StackDependency[];
  waits: string | null;
}

export interface StackOverlap {
  withPlanUid: string;
  withLabel: string;
  high: boolean;
  words: string;
  detail: string;
}

export interface StackPlan {
  uid: string;
  title: string;
  ticketKey: string | null;
  label: string;
  progress: { done: number; total: number };
  needsYou: number;
  tasks: StackTask[];
  overlaps: StackOverlap[];
}

export interface Stack {
  project: string;
  plans: StackPlan[];
}

export async function getStack(): Promise<Stack> {
  return rpc<Stack>('stack.summary', {});
}

const SETTLED = new Set(['done', 'skipped']);

/** Who is on what: each unfinished task someone has, as "codex · Migrate schema · ⎇ billing-v2". */
export function whoIsOn(plan: StackPlan): string[] {
  return plan.tasks
    .filter((t) => t.kind === 'action' && t.assignee && !SETTLED.has(t.status ?? ''))
    .map((t) => [t.assignee, t.title, t.workstream ? `⎇ ${t.workstream}` : null].filter(Boolean).join(' · '));
}

/** What is waiting, in the desktop's own words: `"Deploy" waits on "Migrate" in plan "Billing v2".` */
export function waitsIn(plan: StackPlan): string[] {
  return plan.tasks.map((t) => t.waits).filter((w): w is string => !!w);
}
