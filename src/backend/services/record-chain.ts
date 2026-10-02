/**
 * The record (Phase 32 B10.1, observability doc §11): the agent event log
 * made tamper-evident.
 *
 * Every event the log keeps (B1: tool calls, watcher events, and the app's
 * own decisions: spec edits, criterion decisions, check runs, breakpoint
 * hits and answers, signal answers, spec decisions, rule changes) gets one
 * link in `record_chain`:
 *
 *   digest = sha256 of the event as written (id, time, source, type,
 *            session, agent, payload)
 *   hash   = sha256(previous hash, seq, event id, digest)
 *
 * so changing an event's content, removing one, or changing a link breaks
 * the chain from that point, and `verifyRecord` says where.
 *
 *  - **Links are numbered as they are written.** Each carries a time that
 *    never goes backwards: the event's own, but no earlier than the link
 *    before it (a watcher event is stamped when the agent acted, which can
 *    be earlier) and no later than now. Retention trims the oldest links by
 *    that time as one block and moves the anchor (`record_anchor`) to the
 *    last one trimmed, so what is kept still verifies from there.
 *  - **The workstream is not in the digest.** It is stamped later when a
 *    session binds after its first events (`adoptSessionEvents`); that is
 *    derived, not what was done.
 *  - **What this does not prove.** Someone who can rewrite the database can
 *    recompute the whole chain. A signed pack or evidence export (B10.3,
 *    B10.4) carries the head hash, which pins everything before it.
 */

import { createHash } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { RecordCheck, RecordProblem, RecordProblemKind } from '../../shared/types/record';

export const GENESIS = '0'.repeat(64);

interface EventRow { id: string; at: number; source: string; type: string; session_id: string | null; agent_type: string | null; payload: string }
interface LinkRow { seq: number; event_id: string; linked_at: number; digest: string; prev: string; hash: string }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The digest of an event as written. */
export function digestOf(e: EventRow): string {
  return sha256(JSON.stringify([e.id, e.at, e.source, e.type, e.session_id, e.agent_type, e.payload]));
}

/** A link's hash: over the one before it, its number, its event and that event's digest. */
export function linkHash(prev: string, seq: number, eventId: string, digest: string): string {
  return sha256(`${prev}\n${seq}\n${eventId}\n${digest}`);
}

function rowsOf<T>(sql: string, params: Array<string | number> = []): T[] {
  const res = getDb().exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

const EVENT_COLS = 'id, at, source, type, session_id, agent_type, payload';

interface Anchor { seq: number; hash: string; at: number }

function anchor(): Anchor {
  const a = rowsOf<{ through_seq: number; hash: string; at: number }>('SELECT through_seq, hash, at FROM record_anchor WHERE id = 1')[0];
  return a ? { seq: Number(a.through_seq), hash: a.hash, at: Number(a.at) } : { seq: 0, hash: GENESIS, at: 0 };
}

/** The last link: its number and hash (the anchor's, when every link was trimmed). */
export function recordHead(): { seq: number; hash: string } {
  const last = rowsOf<{ seq: number; hash: string }>('SELECT seq, hash FROM record_chain ORDER BY seq DESC LIMIT 1')[0];
  if (last) return { seq: Number(last.seq), hash: last.hash };
  const a = anchor();
  return { seq: a.seq, hash: a.hash };
}

/** Link one stored event, if it has no link yet. Returns its link number, or null. */
export function linkEvent(eventId: string, now = Date.now()): number | null {
  const db = getDb();
  if (rowsOf('SELECT 1 FROM record_chain WHERE event_id = ?', [eventId]).length) return null;
  const e = rowsOf<EventRow>(`SELECT ${EVENT_COLS} FROM agent_events WHERE id = ?`, [eventId])[0];
  if (!e) return null;
  const head = recordHead();
  const seq = head.seq + 1;
  const digest = digestOf(e);
  const last = Number(rowsOf<{ t: number | null }>('SELECT MAX(linked_at) AS t FROM record_chain')[0]?.t ?? 0);
  const linkedAt = Math.max(last, Math.min(Number(e.at), now));
  db.run('INSERT INTO record_chain (seq, event_id, linked_at, digest, prev, hash) VALUES (?, ?, ?, ?, ?, ?)',
    [seq, eventId, linkedAt, digest, head.hash, linkHash(head.hash, seq, eventId, digest)]);
  markDirty();
  return seq;
}

/**
 * The record begins: link every event kept before it, oldest first. Only
 * once, while the record has never had a link; after that an event with no
 * link is one written around the record, and `verifyRecord` says so rather
 * than this taking it in. Returns how many were linked.
 */
export function beginRecord(now = Date.now()): number {
  if (rowsOf('SELECT 1 FROM record_chain LIMIT 1').length || anchor().seq > 0) return 0;
  const ids = rowsOf<{ id: string }>(
    'SELECT e.id FROM agent_events e LEFT JOIN record_chain c ON c.event_id = e.id WHERE c.event_id IS NULL ORDER BY e.at ASC, e.rowid ASC',
  ).map((r) => r.id);
  let n = 0;
  for (const id of ids) if (linkEvent(id, now) !== null) n++;
  return n;
}

/**
 * Retention (B10.2 sets the window): drop the oldest links, and their
 * events, as one block: every link written before `cutoff`, and the oldest
 * past `maxRows`. The anchor moves to the last link dropped. Returns events
 * removed.
 */
export function trimRecord(cutoff: number, maxRows: number, now = Date.now()): number {
  const db = getDb();
  const count = Number(rowsOf<{ n: number }>('SELECT COUNT(*) AS n FROM record_chain')[0]?.n ?? 0);
  const byTime = Number(rowsOf<{ s: number | null }>('SELECT MAX(seq) AS s FROM record_chain WHERE linked_at < ?', [cutoff])[0]?.s ?? 0);
  const over = count - maxRows;
  const byCount = over > 0
    ? Number(rowsOf<{ seq: number }>('SELECT seq FROM record_chain ORDER BY seq ASC LIMIT 1 OFFSET ?', [over - 1])[0]?.seq ?? 0)
    : 0;
  const through = Math.max(byTime, byCount);
  if (through <= 0) return 0;
  const last = rowsOf<{ hash: string }>('SELECT hash FROM record_chain WHERE seq = ?', [through])[0];
  if (!last) return 0;
  const before = Number(rowsOf<{ n: number }>('SELECT COUNT(*) AS n FROM agent_events')[0]?.n ?? 0);
  db.run('DELETE FROM agent_events WHERE id IN (SELECT event_id FROM record_chain WHERE seq <= ?)', [through]);
  db.run('DELETE FROM record_chain WHERE seq <= ?', [through]);
  db.run('INSERT INTO record_anchor (id, through_seq, hash, at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET through_seq = excluded.through_seq, hash = excluded.hash, at = excluded.at',
    [through, last.hash, now]);
  markDirty();
  return before - Number(rowsOf<{ n: number }>('SELECT COUNT(*) AS n FROM agent_events')[0]?.n ?? 0);
}

export type { RecordCheck, RecordProblem, RecordProblemKind };

const MAX_PROBLEMS = 50;

const PROBLEM_WORDS: Record<RecordProblemKind, string> = {
  changed: 'its content changed after it was written',
  removed: 'it was removed',
  relinked: 'its link in the chain was changed',
  unlinked: 'it was added to the log outside the record',
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Walk the chain from the anchor, and say whether everything kept still matches it. */
export function verifyRecord(): RecordCheck {
  const a = anchor();
  const links = rowsOf<LinkRow>('SELECT seq, event_id, linked_at, digest, prev, hash FROM record_chain ORDER BY seq ASC');
  const events = new Map(rowsOf<EventRow>(`SELECT ${EVENT_COLS} FROM agent_events`).map((e) => [e.id, e]));
  const problems: RecordProblem[] = [];
  const say = (p: RecordProblem) => { if (problems.length < MAX_PROBLEMS) problems.push(p); };
  const info = (id: string) => {
    const e = events.get(id);
    return { at: e ? Number(e.at) : null, type: e?.type ?? null, agentType: e?.agent_type ?? null };
  };

  let prev = a.hash;
  let expected = a.seq + 1;
  for (const l of links) {
    const seq = Number(l.seq);
    if (seq !== expected) {
      // Links missing between: their events are gone with them.
      say({ seq: expected, eventId: '', kind: 'removed', at: null, type: null, agentType: null });
    }
    if (l.prev !== prev || linkHash(l.prev, seq, l.event_id, l.digest) !== l.hash) {
      say({ seq, eventId: l.event_id, kind: 'relinked', ...info(l.event_id) });
    }
    const e = events.get(l.event_id);
    if (!e) say({ seq, eventId: l.event_id, kind: 'removed', at: null, type: null, agentType: null });
    else if (digestOf(e) !== l.digest) say({ seq, eventId: l.event_id, kind: 'changed', ...info(l.event_id) });
    events.delete(l.event_id);
    prev = l.hash;
    expected = seq + 1;
  }
  // What is left was never linked: written around the record.
  for (const e of events.values()) say({ seq: null, eventId: e.id, kind: 'unlinked', at: Number(e.at), type: e.type, agentType: e.agent_type });

  const head = links.length ? { seq: Number(links[links.length - 1].seq), hash: links[links.length - 1].hash } : { seq: a.seq, hash: a.hash };
  const since = links.length ? Number(links[0].linked_at) : null;
  const ok = problems.length === 0;
  const kept = `${links.length.toLocaleString('en-GB')} entr${links.length === 1 ? 'y' : 'ies'}${since ? ` since ${day(since)}` : ''}`;
  const words = ok
    ? links.length === 0 ? 'Nothing is in the record yet.' : `Intact: ${kept} match the chain${a.seq ? `; older entries were removed by retention on ${day(a.at)}` : ''}.`
    : `Changed after it was written: ${problems.length}${problems.length === MAX_PROBLEMS ? '+' : ''} of ${kept}. ` +
      problems.slice(0, 3).map((p) => `${p.seq !== null ? `#${p.seq}` : 'an event'}${p.type ? ` (${p.type.replace(/_/g, ' ')}${p.agentType ? ` by ${p.agentType}` : ''}${p.at ? `, ${day(p.at)}` : ''})` : ''}: ${PROBLEM_WORDS[p.kind]}`).join('; ') + '.';
  return { ok, entries: links.length, since, trimmedThrough: a.seq, head, problems, words };
}
