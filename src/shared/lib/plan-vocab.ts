/**
 * The values a plan's and an item's status may take, at runtime.
 *
 * The types say it for the compiler; these say it to a request. MCP checked
 * with its own zod enums, while REST and the phone wrote whatever arrived — so
 * a status of "finished-ish" was stored, and every reader that switches on
 * the value then treated the plan as nothing it knew (Phase 32 §0.4j).
 */

import type { PlanStatus, TaskStatus } from '../types/plan';

export const PLAN_STATUSES: readonly PlanStatus[] = ['draft', 'review', 'approved', 'in_progress', 'completed', 'archived'];
export const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'assigned', 'in_progress', 'done', 'blocked', 'skipped'];

export function isPlanStatus(v: unknown): v is PlanStatus {
  return typeof v === 'string' && (PLAN_STATUSES as readonly string[]).includes(v);
}

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
}
