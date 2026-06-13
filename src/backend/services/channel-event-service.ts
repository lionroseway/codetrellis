/**
 * Channel event service — Phase 1.3 of the CDev target architecture.
 *
 * Channel events form the peer-to-peer team coordination surface for
 * each plan: `stuck`, `need-decision`, `need-context`, `handing-off`,
 * `steer`, `weigh-in`. Both humans and agents can post; both can
 * respond.
 *
 * Events live in the `channel_events` table and are exported to the
 * manifest under `<projectRoot>/.codetrellis/plans/<slug>/channels/
 * <event-uid>.yaml` (see plan-file-service for export wiring).
 *
 * See docs/cdev/08-agent-collaboration.md for the design.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import {
  CHANNEL_EVENT_TYPES,
  CHANNEL_EVENT_STATUSES,
  type ChannelEvent,
  type ChannelEventType,
  type ChannelEventStatus,
  type ChannelEventPayload,
} from '../../shared/types';

export interface PostChannelEventInput {
  planUid: string;
  /** Optional anchor to a specific plan item. */
  itemUid?: string | null;
  eventType: ChannelEventType;
  payload: ChannelEventPayload;
  author: string;
  authorType: string;
  /** Model in use when the author is an agent. */
  agentModel?: string | null;
  /** UID of the event this one responds to, when threaded. */
  respondsTo?: string | null;
  /** Override the generated UID. Used by manifest re-import to preserve identity. */
  uid?: string;
  /** Override timestamps. Used by manifest re-import. */
  createdAt?: number;
  updatedAt?: number;
  /** Override the default 'open' status. Used by manifest re-import. */
  status?: ChannelEventStatus;
}

export interface ListChannelEventsOptions {
  /** Cutoff (exclusive). Events with `created_at >= sinceMs` are returned. */
  sinceMs?: number;
  /** Filter by event type. Omit for all. */
  eventTypes?: ChannelEventType[];
  /** Filter by status. Omit for all. */
  status?: ChannelEventStatus | ChannelEventStatus[];
  /** Scope to a single item (and its responses). */
  itemUid?: string;
  /** Cap. Default 200. */
  limit?: number;
  /** Pagination cursor (offset). Default 0. */
  offset?: number;
}

// --- In-memory seqnum / replay ring ---------------------------------------
//
// Session-persistence plan / Track B §7.3+7.4 — monotonic per-process
// sequence numbers + a per-plan ring of recent events so a reconnecting
// client can ask "give me everything since seq N" and get a gap-or-replay
// answer without scanning the whole `channel_events` table.
//
// Why in-memory (not a DB column): channel events already carry a stable
// `createdAt` that satisfies "give me events since a wall-clock time".
// Seqnums add monotonic-within-process ordering for the live reconnect
// case (where wall-clock isn't quite enough — multiple events in the same
// millisecond would collide), without a schema migration. On backend
// restart the ring resets and clients fall back to a full refresh.

const PER_PLAN_RING_SIZE = 500;
let nextSeq = 1;
const seqRings = new Map<string, Array<{ seq: number; event: ChannelEvent }>>();
/**
 * First seq ever assigned per plan. Used to distinguish "this plan
 * has only ever had events from seq X onward" (sinceSeq < X is fine,
 * no gap) from "the ring evicted older events" (sinceSeq < oldest →
 * real gap). Without this distinction, a plan whose first event lands
 * at a high global seq (because other plans were busy) would falsely
 * report a gap for any sinceSeq below its first event.
 */
const firstSeqByPlan = new Map<string, number>();

function recordSeq(event: ChannelEvent): number {
  const seq = nextSeq++;
  let ring = seqRings.get(event.planUid);
  if (!ring) {
    ring = [];
    seqRings.set(event.planUid, ring);
    firstSeqByPlan.set(event.planUid, seq);
  }
  ring.push({ seq, event });
  if (ring.length > PER_PLAN_RING_SIZE) ring.shift();
  return seq;
}

/**
 * Replay-since-seqnum: return all events with seq > sinceSeq for this
 * plan, capped at `limit`. `gap: true` tells the caller to drop their
 * cache and do a fresh `listChannelEvents` by createdAt cutoff
 * (because we evicted history from this plan's ring that the caller
 * may have wanted). `latestSeq` lets the caller record where it
 * caught up to.
 */
export function getChannelEventsSinceSeq(
  planUid: string,
  sinceSeq: number,
  limit = 200,
): { events: ChannelEvent[]; latestSeq: number; gap: boolean } {
  const ring = seqRings.get(planUid) ?? [];
  const firstSeq = firstSeqByPlan.get(planUid) ?? null;
  const latestSeq = ring.length > 0
    ? ring[ring.length - 1].seq
    : (firstSeq === null ? nextSeq - 1 : firstSeq - 1);

  if (ring.length === 0) {
    return { events: [], latestSeq, gap: false };
  }

  const oldestRingSeq = ring[0].seq;
  // Eviction occurred *for this plan* iff its ring's oldest seq is now
  // newer than the first seq we ever assigned to it. If never evicted,
  // no sinceSeq value can be a gap — the caller just gets the full
  // available history.
  const evicted = firstSeq !== null && oldestRingSeq > firstSeq;
  if (evicted && sinceSeq < oldestRingSeq - 1) {
    return { events: [], latestSeq, gap: true };
  }

  const newer = ring.filter((r) => r.seq > sinceSeq).slice(0, limit);
  return { events: newer.map((r) => r.event), latestSeq, gap: false };
}

/** Read-only — for diagnostics + tests. */
export function getCurrentSeqHead(): number {
  return nextSeq - 1;
}

/**
 * Test-only — push a synthetic event into the in-memory seqnum ring so
 * unit tests can exercise `getChannelEventsSinceSeq` (including the
 * gap-marker path) without booting the DB. Underscored to signal
 * "test surface, not API."
 */
export function _recordSeqForTests(event: ChannelEvent): number {
  return recordSeq(event);
}

/** Test-only — reset the ring + counter to a clean state. */
export function _resetSeqForTests(): void {
  nextSeq = 1;
  seqRings.clear();
  firstSeqByPlan.clear();
}

// --- Posting ----------------------------------------------------------------

export function postChannelEvent(input: PostChannelEventInput): ChannelEvent {
  if (!CHANNEL_EVENT_TYPES.includes(input.eventType)) {
    throw new Error(`Unknown channel event type: ${input.eventType}`);
  }
  if (input.status && !CHANNEL_EVENT_STATUSES.includes(input.status)) {
    throw new Error(`Unknown channel event status: ${input.status}`);
  }
  if (!input.payload || typeof input.payload.message !== 'string' || !input.payload.message.trim()) {
    throw new Error('Channel event payload must include a non-empty `message`.');
  }
  if (input.respondsTo) {
    // Refuse to thread against a non-existent or wrong-plan parent.
    const parent = getChannelEvent(input.respondsTo);
    if (!parent) {
      throw new Error(`Cannot respond to unknown channel event: ${input.respondsTo}`);
    }
    if (parent.planUid !== input.planUid) {
      throw new Error('Cannot thread across plans (`respondsTo` is on a different plan).');
    }
  }

  const db = getDb();
  const now = input.createdAt ?? Date.now();
  const uid = input.uid ?? randomUUID();
  const status: ChannelEventStatus = input.status ?? 'open';

  db.run(
    `INSERT INTO channel_events
       (uid, plan_uid, item_uid, event_type, payload, author, author_type, agent_model, responds_to, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       payload = excluded.payload,
       status = excluded.status,
       updated_at = excluded.updated_at`,
    [
      uid,
      input.planUid,
      input.itemUid ?? null,
      input.eventType,
      JSON.stringify(input.payload),
      input.author,
      input.authorType,
      input.agentModel ?? null,
      input.respondsTo ?? null,
      status,
      now,
      input.updatedAt ?? now,
    ],
  );

  markDirty();
  const created = getChannelEvent(uid);
  if (!created) throw new Error('Channel event vanished immediately after insert');
  // Record into the in-memory seqnum ring (7.3) so reconnecting
  // clients can replay-since-seqnum (7.4) without scanning the DB.
  // Stamping happens AFTER the DB insert succeeds — we only enroll
  // events that are durably persisted.
  recordSeq(created);
  return created;
}

// --- Reading ----------------------------------------------------------------

export function getChannelEvent(uid: string): ChannelEvent | null {
  const db = getDb();
  const result = db.exec(
    `SELECT uid, plan_uid, item_uid, event_type, payload, author, author_type, agent_model, responds_to, status, created_at, updated_at
       FROM channel_events
      WHERE uid = ?`,
    [uid],
  );
  if (!result[0] || result[0].values.length === 0) return null;
  return rowToEvent(result[0].values[0]);
}

export function listChannelEvents(planUid: string, options: ListChannelEventsOptions = {}): ChannelEvent[] {
  const db = getDb();
  const params: Array<string | number> = [planUid];
  let where = `plan_uid = ?`;

  if (options.sinceMs !== undefined) {
    where += ` AND created_at >= ?`;
    params.push(options.sinceMs);
  }
  if (options.itemUid) {
    where += ` AND item_uid = ?`;
    params.push(options.itemUid);
  }
  if (options.eventTypes && options.eventTypes.length > 0) {
    where += ` AND event_type IN (${options.eventTypes.map(() => '?').join(', ')})`;
    for (const t of options.eventTypes) params.push(t);
  }
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    if (statuses.length > 0) {
      where += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
      for (const s of statuses) params.push(s);
    }
  }

  const limit = options.limit ?? 200;
  const offset = options.offset ?? 0;
  params.push(limit, offset);

  const result = db.exec(
    `SELECT uid, plan_uid, item_uid, event_type, payload, author, author_type, agent_model, responds_to, status, created_at, updated_at
       FROM channel_events
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    params,
  );
  if (!result[0]) return [];
  return result[0].values.map(rowToEvent);
}

/**
 * Return events scoped to a thread root — the root itself plus any
 * descendants (responses, responses-to-responses). Newest-last so the
 * UI can render top-to-bottom chronologically.
 */
export function listThread(rootUid: string): ChannelEvent[] {
  const db = getDb();
  // Walk the responds_to graph breadth-first. Channels are small, so
  // a recursive walk is fine without CTEs.
  const collected: ChannelEvent[] = [];
  const queue: string[] = [rootUid];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const uid = queue.shift()!;
    if (seen.has(uid)) continue;
    seen.add(uid);
    const ev = getChannelEvent(uid);
    if (ev) collected.push(ev);

    const childRes = db.exec(
      `SELECT uid FROM channel_events WHERE responds_to = ? ORDER BY created_at ASC`,
      [uid],
    );
    if (childRes[0]) {
      for (const row of childRes[0].values) {
        queue.push(row[0] as string);
      }
    }
  }

  return collected.sort((a, b) => a.createdAt - b.createdAt);
}

// --- Status changes ---------------------------------------------------------

export function setChannelEventStatus(uid: string, status: ChannelEventStatus): ChannelEvent {
  if (!CHANNEL_EVENT_STATUSES.includes(status)) {
    throw new Error(`Unknown channel event status: ${status}`);
  }
  const db = getDb();
  const now = Date.now();
  db.run(
    `UPDATE channel_events SET status = ?, updated_at = ? WHERE uid = ?`,
    [status, now, uid],
  );
  markDirty();
  const updated = getChannelEvent(uid);
  if (!updated) throw new Error(`Channel event not found: ${uid}`);
  return updated;
}

// --- Manifest serialization -------------------------------------------------

/**
 * Shape used when serialising a channel event to YAML. Keys match the
 * disk format exactly — caller passes this to a YAML serializer.
 */
export interface ChannelEventManifestRecord {
  uid: string;
  itemUid: string | null;
  eventType: ChannelEventType;
  payload: ChannelEventPayload;
  author: string;
  authorType: string;
  agentModel: string | null;
  respondsTo: string | null;
  status: ChannelEventStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export function eventToManifest(event: ChannelEvent): ChannelEventManifestRecord {
  return {
    uid: event.uid,
    itemUid: event.itemUid,
    eventType: event.eventType,
    payload: event.payload,
    author: event.author,
    authorType: event.authorType,
    agentModel: event.agentModel,
    respondsTo: event.respondsTo,
    status: event.status,
    createdAt: new Date(event.createdAt).toISOString(),
    updatedAt: new Date(event.updatedAt).toISOString(),
  };
}

/**
 * Inverse of `eventToManifest`. Used by the manifest importer to
 * recreate events from disk. Returns the input shape for
 * `postChannelEvent` with the planUid filled in by the caller.
 */
export function manifestToEventInput(planUid: string, record: ChannelEventManifestRecord): PostChannelEventInput {
  return {
    uid: record.uid,
    planUid,
    itemUid: record.itemUid,
    eventType: record.eventType,
    payload: record.payload,
    author: record.author,
    authorType: record.authorType,
    agentModel: record.agentModel,
    respondsTo: record.respondsTo,
    status: record.status,
    createdAt: Date.parse(record.createdAt) || Date.now(),
    updatedAt: Date.parse(record.updatedAt) || Date.now(),
  };
}

// --- internals --------------------------------------------------------------

function rowToEvent(row: any[]): ChannelEvent {
  const [
    uid, planUid, itemUid, eventType, payloadJson, author, authorType, agentModel, respondsTo, status, createdAt, updatedAt,
  ] = row;
  let payload: ChannelEventPayload = { message: '' };
  try {
    payload = JSON.parse(payloadJson) ?? { message: '' };
  } catch {
    // Malformed payload in DB — surface as empty message rather than crashing.
    payload = { message: '[unparseable payload]' };
  }
  return {
    uid: String(uid),
    planUid: String(planUid),
    itemUid: itemUid ? String(itemUid) : null,
    eventType: String(eventType) as ChannelEventType,
    payload,
    author: String(author),
    authorType: String(authorType),
    agentModel: agentModel ? String(agentModel) : null,
    respondsTo: respondsTo ? String(respondsTo) : null,
    status: String(status) as ChannelEventStatus,
    createdAt: Number(createdAt),
    updatedAt: Number(updatedAt),
  };
}
