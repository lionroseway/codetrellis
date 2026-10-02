/**
 * The state at a moment (Phase 32 B5.2, observability doc §6.2).
 *
 * Replay shows the graph, the stack and the inbox as they were at a
 * recorded moment. This answers "as they were at `at`" for one project,
 * from what is already kept; nothing is recorded here:
 *
 *  - **the graph**: the replay frame at or before `at` (B5.1), and what
 *    differs between it and the graph now, when the server holds this
 *    project (otherwise the difference would be against another project's
 *    files, so it is not given);
 *  - **each task's status**: from `plan_events`, which keep every status
 *    change with its before and after. A task made after `at` is left out;
 *    one never changed has the status it has now;
 *  - **what was waiting on the person**: breakpoint hits made by then and
 *    not yet answered by then;
 *  - **the signals open then**: from `awareness_signal_spans` (each opening
 *    of a signal, kept from B5.2 on), and for a signal open since before
 *    spans were kept, its row's first sighting and resolution;
 *  - **the stack then** (B6.5): every plan under way, each task as it was
 *    (who was on it, its branch, what it waited on), from the version every
 *    create and update writes to `plan_item_versions`. An item deleted since
 *    is gone from that table too, so it is not shown.
 *
 * The lanes up to `at` are already `/api/agent-events?before=`; they are
 * not repeated here.
 */

import { getDb } from './database';
import { computeTrellisDiff, type TrellisDiff } from './trellis-service';
import { listFrames, type ReplayFrame } from './replay-frames';
import { getHit } from './breakpoint-service';
import { listAllItems } from './plan-item-service';
import { stackThen, type PlanThen } from './stack-service';
import type { AwarenessSignal, BreakpointHit, Plan, PlanItem } from '../../shared/types';
import type { Stack } from '../../shared/types/stack';

export interface TaskAt {
  uid: string;
  planUid: string;
  planTitle: string;
  title: string;
  /** Its status at the moment. */
  status: string | null;
  /** Its status now, when that differs. */
  statusNow?: string | null;
  /** Who was on it then (B6.5). */
  assignee: string | null;
  /** The branch it was worked on then, its own or a section's above it. */
  workstream: string | null;
  /** What it depended on then. */
  dependencies: string[];
}

/** A hit as the inbox shows one; `answeredAt` says when it was answered, if it has been since. */
export type WaitingAt = BreakpointHit;

export interface SignalAt {
  id: string;
  kind: string;
  /** What it is about, from its row (the id is derived from it, so it does not change). */
  subject: AwarenessSignal['subject'];
  severity: string;
  summary: string;
  workstreams: string[];
  openedAt: number;
  /** When it closed, if it has since. */
  closedAt: number | null;
}

export interface StateAt {
  at: number;
  projectPath: string;
  /** The frame at or before `at`; null when none was taken by then. */
  frame: ReplayFrame | null;
  /**
   * How the graph now differs from the frame's: files and edges added,
   * removed or changed since. Null without a frame, or when the server
   * holds another project's graph.
   */
  sinceFrame: TrellisDiff | null;
  tasks: TaskAt[];
  waiting: WaitingAt[];
  signals: SignalAt[];
  /** Every plan under way then, as the Stack tab shows it (B6.5). */
  stack: Stack;
}

const trimRoot = (p: string): string => p.replace(/[\\/]+$/, '');
const rows = (sql: string, params: unknown[] = []): unknown[][] => getDb().exec(sql, params)[0]?.values ?? [];
const parse = <T>(s: unknown, fallback: T): T => {
  try { return JSON.parse(String(s)) as T; } catch { return fallback; }
};

/** The project's frame at or before `at`. */
function frameAt(projectPath: string, at: number): ReplayFrame | null {
  return listFrames(projectPath, { to: at, limit: 1, newestFirst: true })[0] ?? null;
}

/** The fields a version keeps that the stack reads, and what each is when the version left it out. */
const KEPT: Array<[keyof PlanItem, unknown]> = [
  ['title', ''], ['assignee', null], ['assigneeType', null], ['dependencies', []], ['workstream', null],
  ['fileSpecs', []], ['symbolSpecs', []], ['parentUid', null],
];

/**
 * Each item of the project's plans made by `at`, as it was then. Every
 * create and update writes the item's fields to `plan_item_versions`, so
 * the last version by `at` says who was on it, its branch and what it
 * waited on; the status comes from the status changes in `plan_events`,
 * which are kept with their before and after. `assigneeSession` is not
 * versioned: it is kept only while the assignee is the one there now.
 */
export function itemsAt(projectPath: string, at: number): PlanThen[] {
  const plans = rows(
    // The plan list's order, so rows keep their places as the cursor moves.
    'SELECT uid, title, status FROM plans WHERE (project_path = ? OR project_path = ?) AND created_at <= ? ORDER BY updated_at DESC',
    [projectPath, trimRoot(projectPath), at],
  );
  if (plans.length === 0) return [];
  const uids = plans.map((r) => r[0] as string);
  const marks = uids.map(() => '?').join(',');

  // Each item's status changes, oldest first.
  const changes = new Map<string, Array<{ when: number; before: string | null; after: string | null }>>();
  for (const r of rows(
    `SELECT item_uid, created_at, before_state, after_state FROM plan_events
     WHERE plan_uid IN (${marks}) AND event_type = 'status_changed' ORDER BY created_at, id`,
    uids,
  )) {
    const list = changes.get(r[0] as string) ?? [];
    list.push({
      when: r[1] as number,
      before: parse<{ status?: string | null }>(r[2], {}).status ?? null,
      after: parse<{ status?: string | null }>(r[3], {}).status ?? null,
    });
    changes.set(r[0] as string, list);
  }
  const statusThen = (uid: string, now: string | null): string | null => {
    const list = changes.get(uid) ?? [];
    const lastBy = [...list].reverse().find((c) => c.when <= at);
    const firstAfter = list.find((c) => c.when > at);
    return lastBy ? lastBy.after : firstAfter ? firstAfter.before : now;
  };

  // The last version of each item by `at`.
  const snapshot = new Map<string, Record<string, unknown>>();
  for (const r of rows(
    `SELECT v.item_uid, v.meta_snapshot FROM plan_item_versions v JOIN plan_items i ON i.uid = v.item_uid
     WHERE i.plan_uid IN (${marks}) AND v.created_at <= ? ORDER BY v.item_uid, v.version`,
    [...uids, at],
  )) snapshot.set(r[0] as string, parse<Record<string, unknown>>(r[1], {}));

  const out: PlanThen[] = [];
  for (const r of plans) {
    const planUid = r[0] as string;
    const items = listAllItems(planUid).filter((i) => i.createdAt <= at).map((now) => {
      const then: PlanItem = { ...now };
      const snap = snapshot.get(now.uid);
      if (snap) {
        for (const [key, missing] of KEPT) (then as unknown as Record<string, unknown>)[key] = snap[key] ?? missing;
      }
      if (then.assignee !== now.assignee) then.assigneeSession = null;
      if (now.kind === 'action') then.status = statusThen(now.uid, now.status ?? null) as PlanItem['status'];
      return then;
    });
    const status = r[2] as Plan['status'];
    // A plan finished since, with a task still open then, was under way then;
    // plan status changes are not kept, so that is the one sign of it.
    const finishedNow = status === 'completed' || status === 'archived';
    const openThen = items.some((i) => i.kind === 'action' && i.status !== 'done' && i.status !== 'skipped');
    out.push({ plan: { uid: planUid, title: r[1] as string, status: finishedNow && openThen ? 'in_progress' : status }, items });
  }
  return out;
}

/** Each action's status at `at`, and who was on it, for the project's plans; taken from the stack then. */
function tasksAt(then: PlanThen[], stack: Stack): TaskAt[] {
  const rowOf = new Map(stack.plans.flatMap((p) => p.tasks.map((t) => [t.uid, t] as const)));
  const nowStatus = new Map<string, string | null>();
  for (const p of then) for (const i of listAllItems(p.plan.uid)) nowStatus.set(i.uid, i.status ?? null);
  return then.flatMap((p) => p.items.filter((i) => i.kind === 'action').map((i) => {
    const row = rowOf.get(i.uid);
    const status = i.status ?? null;
    const now = nowStatus.get(i.uid) ?? null;
    const task: TaskAt = {
      uid: i.uid, planUid: p.plan.uid, planTitle: p.plan.title, title: i.title, status,
      assignee: i.assignee ?? null,
      workstream: row?.workstream ?? null,
      dependencies: i.dependencies ?? [],
    };
    if (status !== now) task.statusNow = now;
    return task;
  }));
}

/** Breakpoint hits in the project made by `at` and not answered by then. */
function waitingAt(projectPath: string, at: number): WaitingAt[] {
  return rows(
    `SELECT h.ref FROM breakpoint_hits h JOIN breakpoints b ON b.id = h.breakpoint_id
     LEFT JOIN plans p ON p.uid = COALESCE(h.plan_uid, b.plan_uid)
     WHERE (b.project_root IN (?, ?) OR p.project_path IN (?, ?))
       AND h.hit_at <= ? AND (h.answered_at IS NULL OR h.answered_at > ?)
     ORDER BY h.hit_at`,
    [projectPath, trimRoot(projectPath), projectPath, trimRoot(projectPath), at, at],
  ).map((r) => getHit(r[0] as string)).filter((h): h is BreakpointHit => h !== null);
}

/** The project's signals open at `at`. */
function signalsAt(projectPath: string, at: number): SignalAt[] {
  const roots = [projectPath, trimRoot(projectPath)];
  const spans = rows(
    `SELECT p.signal_id, p.kind, p.severity, p.summary, p.workstreams, p.opened_at, p.closed_at, s.subject
     FROM awareness_signal_spans p LEFT JOIN awareness_signals s ON s.id = p.signal_id
     WHERE p.project_root IN (?, ?) AND p.opened_at <= ? AND (p.closed_at IS NULL OR p.closed_at > ?)`,
    [...roots, at, at],
  ).map((r) => ({
    id: r[0] as string, kind: r[1] as string, subject: parse<AwarenessSignal['subject']>(r[7], {}), severity: r[2] as string,
    summary: r[3] as string, workstreams: parse<string[]>(r[4], []), openedAt: r[5] as number, closedAt: (r[6] as number | null) ?? null,
  }));
  // A signal with no span at all opened before spans were kept: its row's
  // first sighting and resolution are the one span known.
  const older = rows(
    `SELECT s.id, s.kind, s.severity, s.summary, s.workstreams, s.first_seen, s.resolved_at, s.subject FROM awareness_signals s
     WHERE s.project_root IN (?, ?) AND s.first_seen <= ? AND (s.resolved_at IS NULL OR s.resolved_at > ?)
       AND NOT EXISTS (SELECT 1 FROM awareness_signal_spans p WHERE p.signal_id = s.id)`,
    [...roots, at, at],
  ).map((r) => ({
    id: r[0] as string, kind: r[1] as string, subject: parse<AwarenessSignal['subject']>(r[7], {}), severity: r[2] as string,
    summary: r[3] as string, workstreams: parse<string[]>(r[4], []), openedAt: r[5] as number, closedAt: (r[6] as number | null) ?? null,
  }));
  return [...spans, ...older].sort((a, b) => a.openedAt - b.openedAt);
}

/**
 * The project as it was at `at`. `holdsProject` says whether the server's
 * graph is this project's, which the difference from now needs.
 */
export function stateAt(projectPath: string, at: number, holdsProject: boolean): StateAt {
  const frame = frameAt(projectPath, at);
  const waiting = waitingAt(projectPath, at);
  const signals = signalsAt(projectPath, at);
  const then = itemsAt(projectPath, at);
  const stack = stackThen(
    projectPath,
    then.filter((p) => p.plan.status !== 'completed' && p.plan.status !== 'archived'),
    // Open then, whatever became of them since.
    signals.map((sig) => ({ ...sig, kind: sig.kind as AwarenessSignal['kind'], severity: sig.severity as AwarenessSignal['severity'], state: 'open' as const })),
    waiting,
    at,
  );
  return {
    at,
    projectPath: trimRoot(projectPath),
    frame,
    sinceFrame: frame && holdsProject ? computeTrellisDiff(frame.id) : null,
    tasks: tasksAt(then, stack),
    waiting,
    signals,
    stack,
  };
}
