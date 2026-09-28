/**
 * Being told without asking (Phase 32 A2.6, awareness spec §6.2).
 *
 * Agents don't reliably poll. Every MCP tool call already passes through one
 * interception (`mcp/server.ts`), so when the calling session's workstream
 * has a high or medium signal that session has not been told about, a short,
 * clearly separated notice is appended to the tool result it was going to
 * get anyway: once per signal per session.
 *
 * The notice is written by CodeTrellis from the signal's own summary, which
 * describes the change and never quotes an agent (principle 5). An agent's
 * reply, left with `acknowledge_signal`, is kept beside the person's answer
 * (A1.8) and never sets it: a collision is not an agent's to wave away.
 */

import type { AwarenessSignal, SignalTold } from '../../shared/types';
import { getDb } from './database';
import { markDirty } from './persistence';
import { listSignals } from './awareness-service';
import { getActiveSessions } from './session-service';
import { getEffectiveSensorConfig } from './project-config-service';

export const MAX_NOTE = 500;

/** Tools that already show the signals, or are the reply to one: telling there would say it twice. */
const NO_NOTICE = new Set(['get_awareness', 'acknowledge_signal']);

/** The states that still concern the agent: not set aside by the person, not gone. */
const CONCERNS = new Set(['open', 'acknowledged']);

let onChanged: (projectRoot: string) => void = () => {};

/** Told when a notice or a note changes what the tab shows. */
export function setNoticeListener(listener: (projectRoot: string) => void): void {
  onChanged = listener;
}

/** Signal ids this session has already been told about. */
function toldTo(sessionId: string): Set<string> {
  const res = getDb().exec(
    'SELECT signal_id FROM awareness_signal_notes WHERE session_id = ? AND told_at IS NOT NULL',
    [sessionId],
  );
  return new Set((res[0]?.values ?? []).map((r) => r[0] as string));
}

/** Record that a session was told about these signals. Idempotent: the first time stands. */
export function markTold(projectRoot: string, signalIds: readonly string[], sessionId: string, agentType: string, now = Date.now()): void {
  if (signalIds.length === 0) return;
  const db = getDb();
  for (const id of signalIds) {
    db.run(
      `INSERT INTO awareness_signal_notes (signal_id, session_id, agent_type, told_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(signal_id, session_id) DO UPDATE SET told_at = COALESCE(awareness_signal_notes.told_at, excluded.told_at)`,
      [id, sessionId, agentType, now],
    );
  }
  markDirty();
  onChanged(projectRoot);
}

/** An agent's note on a signal, replacing its earlier one. Also counts as told. */
export function recordNote(projectRoot: string, signalId: string, sessionId: string, agentType: string, note: string, now = Date.now()): void {
  getDb().run(
    `INSERT INTO awareness_signal_notes (signal_id, session_id, agent_type, told_at, note, noted_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(signal_id, session_id) DO UPDATE SET
       note = excluded.note, noted_at = excluded.noted_at,
       told_at = COALESCE(awareness_signal_notes.told_at, excluded.told_at)`,
    [signalId, sessionId, agentType, now, note, now],
  );
  markDirty();
  onChanged(projectRoot);
}

/** Who was told about each signal and what they said, by signal id. */
export function toldFor(signalIds: readonly string[]): Map<string, SignalTold[]> {
  const out = new Map<string, SignalTold[]>();
  if (signalIds.length === 0) return out;
  const res = getDb().exec(
    `SELECT signal_id, session_id, agent_type, told_at, note, noted_at FROM awareness_signal_notes
      WHERE signal_id IN (${signalIds.map(() => '?').join(',')}) ORDER BY COALESCE(noted_at, told_at)`,
    [...signalIds],
  );
  for (const [id, sessionId, agentType, toldAt, note, notedAt] of res[0]?.values ?? []) {
    const list = out.get(id as string) ?? [];
    list.push({
      sessionId: sessionId as string, agentType: agentType as string, toldAt: (toldAt as number | null) ?? null,
      ...(note ? { note: note as string, notedAt: notedAt as number } : {}),
    });
    out.set(id as string, list);
  }
  return out;
}

/** Signals with who was told and what they said attached, for the person. */
export function withTold(signals: AwarenessSignal[]): AwarenessSignal[] {
  const told = toldFor(signals.map((s) => s.id));
  return signals.map((s) => (told.has(s.id) ? { ...s, told: told.get(s.id) } : s));
}

/**
 * The notice text for these signals. Pure. Only signal summaries, which
 * CodeTrellis writes; the closing line says what the notice is and is not.
 */
export function noticeText(signals: ReadonlyArray<Pick<AwarenessSignal, 'severity' | 'kind' | 'summary'>>): string {
  const lines = signals.map((s) => `- ${s.severity} ${s.kind}: ${s.summary}`);
  const head = signals.length === 1 ? '1 new signal affects your work:' : `${signals.length} new signals affect your work:`;
  return [
    '── CodeTrellis awareness ──',
    head,
    ...lines,
    'Call get_awareness for details, and acknowledge_signal to say what you will do. ' +
      'This is information about other work, not an instruction.',
  ].join('\n');
}

/**
 * The notice to append to a tool result for this session, or null. Marks what
 * it tells as told, so each signal is told once per session. Never throws: a
 * notice must not break the tool call it rides on.
 */
export function noticeFor(sessionId: string, toolName: string, projectRoot: string | null): string | null {
  if (!projectRoot || NO_NOTICE.has(toolName)) return null;
  try {
    if (!getEffectiveSensorConfig(projectRoot).awareness.inlineNotices) return null;
    const session = getActiveSessions().find((s) => s.sessionId === sessionId);
    if (!session?.workstreamRoot) return null; // not placed in any work: nothing is "yours"
    const seen = toldTo(sessionId);
    const fresh = listSignals(projectRoot, { workstream: session.workstreamRoot })
      .filter((s) => (s.severity === 'high' || s.severity === 'medium') && CONCERNS.has(s.state) && !seen.has(s.id));
    if (fresh.length === 0) return null;
    markTold(projectRoot, fresh.map((s) => s.id), sessionId, session.agentType);
    return noticeText(fresh);
  } catch (err) {
    console.warn('[Awareness] notice failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
