/**
 * Plan progress tracker — closes step 9 of the front-to-back loop.
 *
 * Today, a task only advances to `in_progress` when an agent
 * explicitly calls `update_task`. Many agents forget. The human is
 * left guessing what's actually happening from the file watcher and
 * the diff badge.
 *
 * This service watches the same `file_changed` events the watcher
 * broadcasts and, for every active plan whose task lists (V1 tasks) or
 * Action file specs (V2 plan_items) include the changed file:
 *
 *   - Auto-advances matching `pending` / `assigned` tasks to
 *     `in_progress` and broadcasts `task-updated` (so the UI lights
 *     up in real time).
 *   - For tasks already `in_progress`, checks whether every
 *     ProposedChange the task owns is now `satisfied` (via
 *     plan-changes-service). If so, broadcasts a one-off
 *     `task-completion-suggested` event — the agent or human still
 *     decides whether to mark the task done. We do NOT auto-mark
 *     done because false positives (the file changed for an
 *     unrelated reason; the agent isn't finished) would erode
 *     trust quickly.
 *
 * Suggestions are deduped per (planUid, taskUid) so we don't spam
 * the UI on every keystroke.
 */

import * as planService from './plan-service';
import * as planItemService from './plan-item-service';
import * as planChangesService from './plan-changes-service';
import { broadcast } from '../server';
import type { Plan } from '../../shared/types';

// --- Module state ---

const suggestedDone = new Set<string>(); // `${planUid}:${taskUid}`

/**
 * Inject a plan-list provider so we don't depend on the import order
 * between plan-service and this service. Default uses planService
 * directly; tests can swap it.
 */
let listPlansProvider: () => Plan[] = () => planService.listPlans();

export function _setListPlansProviderForTest(fn: () => Plan[]): void {
  listPlansProvider = fn;
}

/**
 * Called by the file watcher on every parsed `file_changed` event.
 * Cheap to call: pulls active plans, walks their tasks once.
 */
export function recordFileChange(relativePath: string): void {
  if (!relativePath) return;

  const plans = listPlansProvider().filter(
    (p) => p.status === 'approved' || p.status === 'in_progress' || p.status === 'draft' || p.status === 'review',
  );
  if (plans.length === 0) return;

  for (const plan of plans) {
    const planWithTasks = planService.getPlan(plan.uid);
    if (!planWithTasks) continue;

    const tasks = planWithTasks.tasks;
    let advanced = false;

    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'skipped' || task.status === 'blocked') continue;
      if (!touchesTask(task.affectedFiles, relativePath)) continue;

      // (a) Auto-advance pending/assigned → in_progress
      if (task.status === 'pending' || task.status === 'assigned') {
        planService.updateTask(task.uid, { status: 'in_progress' });
        broadcast('task-updated', {
          planUid: plan.uid,
          taskUid: task.uid,
          status: 'in_progress',
          source: 'auto-progress',
        });
        advanced = true;
        // Reset any prior "completion suggestion" — we're back in flight.
        suggestedDone.delete(`${plan.uid}:${task.uid}`);
      }
    }

    // V2 Actions (plan_items) are what the workspace renders since the V2
    // migration, and until Phase 32 §0.3b this service only knew V1 tasks —
    // so an agent editing an Action's files never lit that Action up. Same
    // rule as above: a touched pending/assigned Action moves to in_progress.
    // Completion is still never automatic.
    for (const item of planItemService.listAllItems(plan.uid)) {
      if (item.kind !== 'action') continue;
      if (item.status !== 'pending' && item.status !== 'assigned') continue;
      const paths = (item.fileSpecs ?? []).flatMap((spec) => [spec.path, spec.moveTo].filter((p): p is string => !!p));
      if (!touchesTask(paths, relativePath)) continue;
      if (!planItemService.updateItem(item.uid, { status: 'in_progress', author: 'auto-progress', authorType: 'system' })) continue;
      broadcast('plan-item-updated', {
        planUid: plan.uid,
        itemUid: item.uid,
        kind: 'action',
        changes: { status: 'in_progress' },
        source: 'auto-progress',
      });
    }

    // (b) For tasks already in_progress, check if every ProposedChange
    // the task owns is now satisfied. We compute changes once per
    // plan (not per task) since the projection is plan-scoped.
    if (advanced || tasks.some((t) => t.status === 'in_progress')) {
      maybeSuggestCompletions(plan.uid);
    }
  }
}

function maybeSuggestCompletions(planUid: string): void {
  const allChanges = planChangesService.listProposedChanges(planUid);
  if (allChanges.length === 0) return;

  const byTask = new Map<string, typeof allChanges>();
  for (const c of allChanges) {
    const bucket = byTask.get(c.taskUid) ?? [];
    bucket.push(c);
    byTask.set(c.taskUid, bucket);
  }

  for (const [taskUid, taskChanges] of byTask) {
    const key = `${planUid}:${taskUid}`;
    if (suggestedDone.has(key)) continue;

    // Only suggest for tasks currently in progress; otherwise we'd
    // suggest "done" for tasks the agent is about to start.
    if (taskChanges.some((c) => c.taskStatus !== 'in_progress')) continue;

    const allSatisfied = taskChanges.every((c) => c.driftStatus === 'satisfied');
    if (!allSatisfied) continue;

    suggestedDone.add(key);
    broadcast('task-completion-suggested', {
      planUid,
      taskUid,
      changeCount: taskChanges.length,
    });
  }
}

function touchesTask(affectedFiles: string[], changedRelative: string): boolean {
  if (!affectedFiles.length) return false;
  for (const f of affectedFiles) {
    if (f === changedRelative) return true;
    // affectedFiles is sometimes stored as relative, sometimes
    // absolute, sometimes a leaf — accept suffix / prefix match too
    // so the auto-progress doesn't silently miss obvious cases.
    if (changedRelative.endsWith(f) || f.endsWith(changedRelative)) return true;
  }
  return false;
}

/** Reset suggestion memory — useful in tests or when a plan is archived. */
export function clearSuggestionMemory(planUid?: string): void {
  if (!planUid) {
    suggestedDone.clear();
    return;
  }
  for (const key of suggestedDone) {
    if (key.startsWith(`${planUid}:`)) suggestedDone.delete(key);
  }
}
