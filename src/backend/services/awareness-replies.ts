/**
 * A person's message to the agents about a signal (Phase 32 A4.1).
 *
 * Awareness spec §7 promised "message the agent" beside acknowledge, intended
 * and dismiss; §8 promised the same from the phone. A signal names
 * workstreams, not plans, and an agent reads its plan's channel only when it
 * asks, so the message is kept beside the signal and reaches each agent
 * session placed in one of its workstreams the way a notice does (A2.6): once,
 * appended to the next tool result it was going to get anyway. Where an agent
 * there holds a task, the server also posts it as a `steer` on that task's
 * plan, so it shows where plan messages do.
 *
 * Unlike a notice, these are the person's own words, and the block says so,
 * with who sent them as the call arrived: a message sent over plain HTTP says
 * it was not verified as the person.
 */

import fs from 'node:fs';
import type { AwarenessSignal, SignalReply, SignalStateBy } from '../../shared/types';
import { getDb } from './database';
import { markDirty } from './persistence';
import { loadSignals } from './awareness-service';
import { getActiveSessions } from './session-service';

export const MAX_REPLY = 1000;

/** The words, trimmed; null when there are none or too many. */
export function cleanReply(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const m = message.trim();
  return m && m.length <= MAX_REPLY ? m : null;
}

function canon(p: string): string {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

/** The sessions placed in one of these workstreams, compared by real path. */
function sessionsIn(workstreams: readonly string[]): Array<{ sessionId: string; agentType: string }> {
  const roots = new Set(workstreams.map(canon));
  return getActiveSessions()
    .filter((s) => s.workstreamRoot && roots.has(canon(s.workstreamRoot)))
    .map((s) => ({ sessionId: s.sessionId, agentType: s.agentType }));
}

/**
 * Keep a person's message about a live signal of this project. Returns the
 * reply and the tasks agents in its workstreams hold (for the plan steer), or
 * null when there is no such live signal. `by` comes from how the call
 * arrived, never from what was sent.
 */
export function recordReply(
  projectRoot: string, signalId: string, message: string, by: SignalStateBy, now = Date.now(),
): { signal: AwarenessSignal; reply: SignalReply; tasks: Array<{ planUid: string; itemUid: string }> } | null {
  const signal = loadSignals(projectRoot).find((s) => s.id === signalId && s.state !== 'resolved');
  if (!signal) return null;
  const db = getDb();
  db.run(
    `INSERT INTO awareness_signal_replies (signal_id, project_root, message, actor, actor_type, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [signalId, projectRoot, message, by.actor, by.actorType, by.channel, now],
  );
  const id = Number(db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0);
  markDirty();
  return { signal, reply: { id, message, by, at: now, readBy: [] }, tasks: tasksHeldIn(signal.workstreams) };
}

/** The unfinished tasks that agents in these workstreams have claimed. */
export function tasksHeldIn(workstreams: readonly string[]): Array<{ planUid: string; itemUid: string }> {
  const sessions = sessionsIn(workstreams).map((s) => s.sessionId);
  if (sessions.length === 0) return [];
  const res = getDb().exec(
    `SELECT plan_uid, uid FROM plan_items
      WHERE assignee_session IN (${sessions.map(() => '?').join(',')})
        AND status IN ('assigned', 'in_progress')
      ORDER BY plan_uid, uid`,
    sessions,
  );
  return (res[0]?.values ?? []).map(([planUid, itemUid]) => ({ planUid: planUid as string, itemUid: itemUid as string }));
}

/** Each signal's replies, oldest first, with which sessions have read each. */
export function repliesFor(signalIds: readonly string[]): Map<string, SignalReply[]> {
  const out = new Map<string, SignalReply[]>();
  if (signalIds.length === 0) return out;
  const db = getDb();
  const res = db.exec(
    `SELECT id, signal_id, message, actor, actor_type, channel, created_at FROM awareness_signal_replies
      WHERE signal_id IN (${signalIds.map(() => '?').join(',')}) ORDER BY created_at, id`,
    [...signalIds],
  );
  const byId = new Map<number, SignalReply>();
  for (const [id, signalId, message, actor, actorType, channel, at] of res[0]?.values ?? []) {
    const reply: SignalReply = {
      id: id as number,
      message: message as string,
      by: { actor: actor as string, actorType: actorType as SignalStateBy['actorType'], channel: channel as SignalStateBy['channel'] },
      at: at as number,
      readBy: [],
    };
    byId.set(reply.id, reply);
    const list = out.get(signalId as string) ?? [];
    list.push(reply);
    out.set(signalId as string, list);
  }
  if (byId.size > 0) {
    const reads = db.exec(
      `SELECT reply_id, session_id, agent_type, read_at FROM awareness_signal_reply_reads
        WHERE reply_id IN (${[...byId.keys()].map(() => '?').join(',')}) ORDER BY read_at`,
      [...byId.keys()],
    );
    for (const [replyId, sessionId, agentType, readAt] of reads[0]?.values ?? []) {
      byId.get(replyId as number)?.readBy.push({ sessionId: sessionId as string, agentType: agentType as string, readAt: readAt as number });
    }
  }
  return out;
}

/** Signals with the person's replies attached. */
export function withReplies(signals: AwarenessSignal[]): AwarenessSignal[] {
  const replies = repliesFor(signals.map((s) => s.id));
  return signals.map((s) => (replies.has(s.id) ? { ...s, replies: replies.get(s.id) } : s));
}

/** Who sent it, in words for the agent. */
function sender(by: SignalStateBy): string {
  if (by.actorType === 'unverified') return 'sent through the local API, not verified as the person';
  return by.channel === 'phone' ? 'the person, from their phone' : 'the person, from the CodeTrellis window';
}

/**
 * The block for these replies. Pure. The person's words are quoted as they
 * wrote them, under the signal they are about.
 */
export function replyText(items: ReadonlyArray<{ signal: Pick<AwarenessSignal, 'id' | 'severity' | 'kind' | 'summary'>; reply: Pick<SignalReply, 'message' | 'by'> }>): string {
  const lines: string[] = ['── CodeTrellis: a message about other work ──'];
  for (const { signal, reply } of items) {
    lines.push(`About ${signal.severity} ${signal.kind} ${signal.id}: ${signal.summary}`);
    lines.push(`From ${sender(reply.by)}:`);
    lines.push(...reply.message.split('\n').map((l) => `> ${l}`));
  }
  lines.push('Answer with acknowledge_signal(id, note) to say what you will do.');
  return lines.join('\n');
}

/**
 * The replies to append to a tool result for this session, or null. Marks
 * what it delivers as read, so each reply reaches each session once. Never
 * throws: a message must not break the tool call it rides on.
 */
export function replyNoticeFor(sessionId: string, projectRoot: string | null, now = Date.now()): string | null {
  if (!projectRoot) return null;
  try {
    const session = getActiveSessions().find((s) => s.sessionId === sessionId);
    if (!session?.workstreamRoot) return null; // not placed in any work: no signal is about it
    const mine = canon(session.workstreamRoot);
    const signals = loadSignals(projectRoot).filter((s) => s.workstreams.some((w) => canon(w) === mine));
    if (signals.length === 0) return null;
    const db = getDb();
    const res = db.exec(
      `SELECT r.id, r.signal_id, r.message, r.actor, r.actor_type, r.channel FROM awareness_signal_replies r
        WHERE r.project_root = ? AND r.signal_id IN (${signals.map(() => '?').join(',')})
          AND NOT EXISTS (SELECT 1 FROM awareness_signal_reply_reads d WHERE d.reply_id = r.id AND d.session_id = ?)
        ORDER BY r.created_at, r.id`,
      [projectRoot, ...signals.map((s) => s.id), sessionId],
    );
    const rows = res[0]?.values ?? [];
    if (rows.length === 0) return null;
    const byId = new Map(signals.map((s) => [s.id, s]));
    const items = rows.map(([, signalId, message, actor, actorType, channel]) => ({
      signal: byId.get(signalId as string)!,
      reply: { message: message as string, by: { actor: actor as string, actorType: actorType as SignalStateBy['actorType'], channel: channel as SignalStateBy['channel'] } },
    }));
    for (const [id] of rows) {
      db.run(
        'INSERT OR IGNORE INTO awareness_signal_reply_reads (reply_id, session_id, agent_type, read_at) VALUES (?, ?, ?, ?)',
        [id as number, sessionId, session.agentType, now],
      );
    }
    markDirty();
    onRead(projectRoot);
    return replyText(items);
  } catch (err) {
    console.warn('[Awareness] reply delivery failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

let onRead: (projectRoot: string) => void = () => {};

/** Told when an agent reads a reply, so the tab can say it was read. */
export function setReplyReadListener(listener: (projectRoot: string) => void): void {
  onRead = listener;
}
