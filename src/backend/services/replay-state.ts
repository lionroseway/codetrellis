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
 *    spans were kept, its row's first sighting and resolution.
 *
 * The lanes up to `at` are already `/api/agent-events?before=`; they are
 * not repeated here.
 */

import { getDb } from './database';
import { computeTrellisDiff, type TrellisDiff } from './trellis-service';
import { listFrames, type ReplayFrame } from './replay-frames';
import { getHit } from './breakpoint-service';
import type { AwarenessSignal, BreakpointHit } from '../../shared/types';

export interface TaskAt {
  uid: string;
  planUid: string;
  planTitle: string;
  title: string;
  /** Its status at the moment. */
  status: string | null;
  /** Its status now, when that differs. */
  statusNow?: string | null;
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

/** Each action's status at `at`, for the project's plans. */
function tasksAt(projectPath: string, at: number): TaskAt[] {
  const plans = rows('SELECT uid, title FROM plans WHERE project_path = ? OR project_path = ?', [projectPath, trimRoot(projectPath)]);
  if (plans.length === 0) return [];
  const titles = new Map(plans.map((r) => [r[0] as string, r[1] as string]));
  const marks = plans.map(() => '?').join(',');
  const items = rows(
    `SELECT uid, plan_uid, title, status FROM plan_items
     WHERE plan_uid IN (${marks}) AND kind = 'action' AND created_at <= ? ORDER BY plan_uid, created_at`,
    [...titles.keys(), at],
  );
  if (items.length === 0) return [];

  // Each item's status changes, oldest first.
  const changes = new Map<string, Array<{ when: number; before: string | null; after: string | null }>>();
  for (const r of rows(
    `SELECT item_uid, created_at, before_state, after_state FROM plan_events
     WHERE plan_uid IN (${marks}) AND event_type = 'status_changed' ORDER BY created_at, id`,
    [...titles.keys()],
  )) {
    const list = changes.get(r[0] as string) ?? [];
    list.push({
      when: r[1] as number,
      before: parse<{ status?: string | null }>(r[2], {}).status ?? null,
      after: parse<{ status?: string | null }>(r[3], {}).status ?? null,
    });
    changes.set(r[0] as string, list);
  }

  return items.map((r) => {
    const uid = r[0] as string;
    const now = (r[3] as string | null) ?? null;
    const list = changes.get(uid) ?? [];
    const lastBy = [...list].reverse().find((c) => c.when <= at);
    const firstAfter = list.find((c) => c.when > at);
    const status = lastBy ? lastBy.after : firstAfter ? firstAfter.before : now;
    const task: TaskAt = { uid, planUid: r[1] as string, planTitle: titles.get(r[1] as string) ?? '', title: r[2] as string, status };
    if (status !== now) task.statusNow = now;
    return task;
  });
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
  return {
    at,
    projectPath: trimRoot(projectPath),
    frame,
    sinceFrame: frame && holdsProject ? computeTrellisDiff(frame.id) : null,
    tasks: tasksAt(projectPath, at),
    waiting: waitingAt(projectPath, at),
    signals: signalsAt(projectPath, at),
  };
}
