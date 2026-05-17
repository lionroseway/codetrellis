/**
 * Plan event service — Phase 15 §15.A.
 *
 * Append-only structural-mutation log for plans. Every move /
 * rename / parent change / sort change / status flip / kind
 * transmute on a `plan_item` writes one row here. Drives:
 *
 *  - Activity drawer (S8) — chronological newest-first stream
 *  - Plan timeline scrubber (S7) — compressed density strip with
 *    time-travel
 *  - Per-item shift drawer (S9) — events filtered to one item
 *
 * The log is append-only by design. Restoring a prior state still
 * writes a new event (`item_restored`); we never delete history.
 *
 * See `docs/PLAN-WORKSPACE-DESIGN.md` (v0.5) §Architecture for the
 * full event-type taxonomy and §UI surfaces for how the data is
 * rendered.
 */

import { getDb } from './database';
import { markDirty } from './persistence';
import type { PlanEvent, PlanEventType } from '../../shared/types';

export interface AppendPlanEventInput {
  planUid: string;
  /** Nullable for plan-scope events that aren't about a specific item. */
  itemUid?: string | null;
  eventType: PlanEventType;
  /** "Before" snapshot — JSON-serializable. Optional. */
  beforeState?: unknown;
  /** "After" snapshot — JSON-serializable. */
  afterState?: unknown;
  /** Human-readable summary for the activity rail. */
  summary: string;
  author: string;
  authorType: string;
  /** Optional override — when backfilling, e.g. during 15.B migration. */
  createdAt?: number;
}

export function appendPlanEvent(input: AppendPlanEventInput): PlanEvent {
  const db = getDb();
  const now = input.createdAt ?? Date.now();
  const beforeJson = input.beforeState !== undefined
    ? JSON.stringify(input.beforeState)
    : null;
  const afterJson = input.afterState !== undefined
    ? JSON.stringify(input.afterState)
    : null;

  db.run(
    `INSERT INTO plan_events
       (plan_uid, item_uid, event_type, before_state, after_state, summary, author, author_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.planUid,
      input.itemUid ?? null,
      input.eventType,
      beforeJson,
      afterJson,
      input.summary,
      input.author,
      input.authorType,
      now,
    ],
  );

  // sql.js doesn't expose lastInsertRowid as a callable on db; fetch
  // via a separate query. Cheap, single-row.
  const idResult = db.exec(`SELECT last_insert_rowid()`);
  const id = (idResult[0]?.values[0]?.[0] as number) ?? -1;

  markDirty();

  return {
    id,
    planUid: input.planUid,
    itemUid: input.itemUid ?? null,
    eventType: input.eventType,
    beforeState: input.beforeState,
    afterState: input.afterState,
    summary: input.summary,
    author: input.author,
    authorType: input.authorType,
    createdAt: now,
  };
}

export interface ListPlanEventsOptions {
  /** Cutoff (exclusive). Events with `created_at >= sinceMs` are returned. */
  sinceMs?: number;
  /** Filter by event type. Omit for all. */
  eventTypes?: PlanEventType[];
  /** Cap. Default 500 — enough for the activity drawer + scrubber. */
  limit?: number;
  /** Pagination cursor (offset). Default 0. */
  offset?: number;
}

/**
 * List events for a whole plan, newest-first.
 */
export function listPlanEvents(
  planUid: string,
  options: ListPlanEventsOptions = {},
): PlanEvent[] {
  const db = getDb();
  const params: Array<string | number> = [planUid];
  let where = `plan_uid = ?`;

  if (options.sinceMs !== undefined) {
    where += ` AND created_at >= ?`;
    params.push(options.sinceMs);
  }
  if (options.eventTypes && options.eventTypes.length > 0) {
    where += ` AND event_type IN (${options.eventTypes.map(() => '?').join(', ')})`;
    for (const t of options.eventTypes) params.push(t);
  }

  const limit = options.limit ?? 500;
  const offset = options.offset ?? 0;
  params.push(limit, offset);

  const result = db.exec(
    `SELECT id, plan_uid, item_uid, event_type, before_state, after_state, summary, author, author_type, created_at
     FROM plan_events
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );
  if (!result[0]) return [];
  return result[0].values.map(rowToEvent);
}

/**
 * List events scoped to a single item — feeds the per-item shift
 * drawer (S9). Newest-first.
 */
export function listItemEvents(
  itemUid: string,
  options: { limit?: number; offset?: number } = {},
): PlanEvent[] {
  const db = getDb();
  const limit = options.limit ?? 200;
  const offset = options.offset ?? 0;
  const result = db.exec(
    `SELECT id, plan_uid, item_uid, event_type, before_state, after_state, summary, author, author_type, created_at
     FROM plan_events
     WHERE item_uid = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [itemUid, limit, offset],
  );
  if (!result[0]) return [];
  return result[0].values.map(rowToEvent);
}

/**
 * Newest event timestamp on a plan. Used by the workspace's
 * "since-last-visit" banner: if the user's `lastSeenAt` is older
 * than this, we render the "X events while you were away" prompt.
 */
export function getNewestEventTimestamp(planUid: string): number | null {
  const db = getDb();
  const result = db.exec(
    `SELECT MAX(created_at) FROM plan_events WHERE plan_uid = ?`,
    [planUid],
  );
  const v = result[0]?.values[0]?.[0];
  return typeof v === 'number' ? v : null;
}

function rowToEvent(r: any[]): PlanEvent {
  return {
    id: r[0] as number,
    planUid: r[1] as string,
    itemUid: (r[2] as string | null) ?? null,
    eventType: r[3] as PlanEventType,
    beforeState: parseJsonSafe(r[4] as string | null),
    afterState: parseJsonSafe(r[5] as string | null),
    summary: r[6] as string,
    author: r[7] as string,
    authorType: r[8] as string,
    createdAt: r[9] as number,
  };
}

function parseJsonSafe(s: string | null): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
