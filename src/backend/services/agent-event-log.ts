/**
 * The agent event log (Phase 32 B1, observability doc §6.4 and §11).
 *
 * Tool calls, Claude Code watcher events and sessions starting and ending
 * were broadcast live and then lost: never written down, and gone from the
 * window on reload. This keeps them.
 *
 *  - **A passive tap.** It listens on `addBroadcastTarget` for every
 *    `agent-event`, like `power-signals` does, so every producer is covered
 *    without touching it, and one that is added later is covered too.
 *  - **Stamped here.** An MCP tool call names its session but not its
 *    workstream; a session that just ended is no longer "active". The row
 *    gets the session, the agent and the workstream from `agent_sessions`,
 *    whatever state the session is in. A watcher event already names its
 *    workstream, and that wins.
 *  - **Unique ids.** Producers number events from 1 on every launch, so ids
 *    carry this launch's tag (`eventId`), and a stored event is never
 *    mistaken for a live one by the window's de-duplication.
 *  - **Not a secret store.** Tool arguments are already cut to 240
 *    characters before they are broadcast; values under key names that mean
 *    secrets, well-known token formats and this launch's capability token
 *    are also masked before anything is written.
 *  - **Kept 14 days**, like the log files, and at most `MAX_ROWS` rows.
 *    Setting retention is the record's job (B10).
 */

import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentEvent, AgentEventSource, AgentEventType } from '../../shared/types';
import { getDb } from './database';
import { markDirty } from './persistence';

export const RETENTION_DAYS = 14;
export const MAX_ROWS = 100_000;
/** A stored payload is a summary; anything longer is cut. */
export const MAX_PAYLOAD_CHARS = 4000;
export const DEFAULT_LIMIT = 400;
export const MAX_LIMIT = 2000;

const LAUNCH = randomBytes(4).toString('hex');
let counter = 0;

/** An event id unique across launches: `<prefix>-<launch>-<n>`. */
export function eventId(prefix: string): string {
  return `${prefix}-${LAUNCH}-${++counter}`;
}

// ── Events the app records itself (B1.2) ────────────────────────────

type Publish = (type: string, payload: unknown) => void;
let publisher: Publish | null = null;

/** server.ts hands over `broadcast`: a published event reaches the window live, and the tap records it. */
export function setEventPublisher(fn: Publish | null): void { publisher = fn; }

/** Who is acting, when an MCP tool handler is running: the tool's session. */
export interface EventContext { sessionId: string; agentType: string | null }
const context = new AsyncLocalStorage<EventContext>();

/** Run `fn` with `ctx` as the acting session, so what it records joins that session's turn. */
export function withEventContext<T>(ctx: EventContext, fn: () => T): T {
  return context.run(ctx, fn);
}

/** The session acting now, inside an MCP tool handler; null anywhere else. */
export function actingSession(): EventContext | null {
  return context.getStore() ?? null;
}

/** Told of every event once it is written (replay's turn ends, B5.1). */
type RecordedListener = (evt: StoredAgentEvent) => void;
let recordedListener: RecordedListener | null = null;
export function setRecordedListener(fn: RecordedListener | null): void { recordedListener = fn; }

export interface BodyEdit {
  kind: 'document' | 'item';
  planUid: string;
  uid: string;
  title: string;
  /** The version the edit made, where the thing has versions. */
  version: number | null;
  /** From how the edit arrived (never a name from the request). */
  author: string | null;
  /** `human`, `agent`, `unverified`…; `file` for a plan file re-read from disk. */
  authorType: string | null;
  changeSummary?: string | null;
}

/** Publish an event the app records itself. Inside an MCP tool it joins that session's turn. Never throws. */
function publishApp(type: 'spec_edited' | 'criterion_decided' | 'check_run' | 'breakpoint_hit' | 'breakpoint_answered', payload: Record<string, unknown>, label: string | null): void {
  if (!publisher) return;
  try {
    const acting = context.getStore();
    publisher('agent-event', {
      id: eventId('app'),
      timestamp: Date.now(),
      source: 'app',
      type,
      payload: {
        ...payload,
        // The turn's label: the acting agent, or who did it.
        ...(acting ? { sessionId: acting.sessionId, agentType: acting.agentType } : { agentType: label }),
      },
    });
  } catch { /* recording must never break what it records */ }
}

/**
 * A spec document's or a plan item's body changed. Published as a
 * `spec_edited` agent event: inside an MCP tool it carries that tool's
 * session, so it joins the agent's turn; from the app window or a plan file
 * on disk it stands alone, saying who.
 */
export function recordBodyEdit(edit: BodyEdit): void {
  publishApp('spec_edited', {
    kind: edit.kind, planUid: edit.planUid, uid: edit.uid, title: edit.title, version: edit.version,
    author: edit.author, authorType: edit.authorType,
    ...(edit.changeSummary ? { changeSummary: edit.changeSummary.slice(0, 200) } : {}),
  }, edit.authorType === 'agent' ? edit.author : edit.authorType);
}

/**
 * The workstream an item is being worked in, now: the one its claiming
 * session is bound to. Read when the event happens, because the claim and
 * the session end later. Null when nobody holds it, or the holder is unbound.
 */
export function workstreamOfItem(itemUid: string): string | null {
  try {
    return rowsOf<{ root: string | null }>(
      `SELECT s.workstream_root AS root FROM plan_items i JOIN agent_sessions s ON s.session_id = i.assignee_session WHERE i.uid = ?`,
      [itemUid],
    )[0]?.root ?? null;
  } catch {
    return null;
  }
}

/** A criterion approved or sent back (B2.2): ✓ or ✗ on its item's workstream lane. */
export function recordCriterionDecision(input: {
  criterionUid: string; decision: 'approved' | 'sent_back'; actor: string; actorType: string; channel: string;
}): void {
  try {
    const row = rowsOf<{ item_uid: string; text: string; plan_uid: string; title: string }>(
      `SELECT c.item_uid, c.text, i.plan_uid, i.title FROM item_criteria c JOIN plan_items i ON i.uid = c.item_uid WHERE c.uid = ?`,
      [input.criterionUid],
    )[0];
    if (!row) return;
    const workstreamRoot = workstreamOfItem(row.item_uid);
    publishApp('criterion_decided', {
      criterionUid: input.criterionUid, itemUid: row.item_uid, itemTitle: row.title, planUid: row.plan_uid,
      text: row.text.slice(0, 200), decision: input.decision, actor: input.actor, actorType: input.actorType, channel: input.channel,
      ...(workstreamRoot ? { workstreamRoot } : {}),
    }, input.actorType === 'agent' ? input.actor : input.actorType);
  } catch { /* never breaks a decision */ }
}

/**
 * A check run (B2.2): one event per workstream its items are worked in, with
 * how many criteria passed and failed there. Items nobody holds share one.
 */
export function recordCheckRun(input: {
  runUid: string; planUid: string; trigger: string; by: string; byType: string;
  outcomes: ReadonlyArray<{ itemUid: string; ok: boolean; state?: string; text: string }>;
}): void {
  try {
    const byRoot = new Map<string | null, Array<{ ok: boolean; text: string }>>();
    const rootOf = new Map<string, string | null>();
    for (const o of input.outcomes) {
      if (!rootOf.has(o.itemUid)) rootOf.set(o.itemUid, workstreamOfItem(o.itemUid));
      const root = rootOf.get(o.itemUid) ?? null;
      // Trouble as the check-run panel counts it: a failing check, or a
      // criterion gone stale. A person's "sent back" is its own event.
      byRoot.set(root, [...(byRoot.get(root) ?? []), { ok: o.ok && o.state !== 'stale', text: o.text }]);
    }
    for (const [root, list] of byRoot) {
      const failed = list.filter((o) => !o.ok);
      publishApp('check_run', {
        runUid: input.runUid, planUid: input.planUid, trigger: input.trigger, by: input.by, byType: input.byType,
        passed: list.length - failed.length, failed: failed.length,
        ...(failed.length ? { failing: failed.slice(0, 3).map((f) => f.text.slice(0, 120)) } : {}),
        ...(root ? { workstreamRoot: root } : {}),
      }, input.byType === 'agent' ? input.by : input.byType);
    }
  } catch { /* never breaks a run */ }
}

/**
 * An agent's call held at a breakpoint, or a person's answer to one (B4).
 * The hit is published inside the MCP tool, so it joins that agent's turn;
 * the answer comes from a person and stands alone, on the same workstream.
 */
export function recordBreakpointEvent(type: 'breakpoint_hit' | 'breakpoint_answered', payload: Record<string, unknown>, label: string | null): void {
  publishApp(type, payload, label);
}

/** Key names whose values are secrets, in JSON (`"apiKey": "…"`) or `key=value` form. */
const SECRET_KEY = /(["']?)([A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|authorization|credential|private[_-]?key)[A-Za-z0-9_-]*)\1(\s*[:=]\s*)("(?:[^"\\]|\\.)*"?|'[^']*'?|[^\s,}&]+)/gi;
/** Token formats that are secrets wherever they appear. */
const TOKEN_FORMATS = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

/** Text with secrets masked. `known` are exact values to mask too (the capability token). */
export function redactSecrets(text: string, known: readonly string[] = []): string {
  let out = text;
  for (const k of known) if (k && k.length >= 8) out = out.split(k).join('[redacted]');
  out = out.replace(SECRET_KEY, (_m, q: string, key: string, sep: string, value: string) => {
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
    return `${q}${key}${q}${sep}${quote}[redacted]${quote}`;
  });
  for (const re of TOKEN_FORMATS) out = out.replace(re, '[redacted]');
  return out;
}

const SECRET_NAME = /token|secret|password|passwd|api[_-]?key|authorization|credential|private[_-]?key/i;

/**
 * A payload with secrets masked, value by value: before it is stringified,
 * so a tool's arguments (themselves a JSON string) are read as written.
 */
export function redactValue(v: unknown, known: readonly string[] = [], depth = 0): unknown {
  if (typeof v === 'string') return redactSecrets(v, known);
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, known, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [
    k, SECRET_NAME.test(k) && (typeof x === 'string' || typeof x === 'number') ? '[redacted]' : redactValue(x, known, depth + 1),
  ]));
}

export interface StoredAgentEvent extends AgentEvent {
  sessionId: string | null;
  agentType: string | null;
  workstreamRoot: string | null;
}

interface SessionRow { agent_type: string; workstream_root: string | null }

/** Rows of a SELECT as objects. */
function rowsOf<T>(sql: string, params: Array<string | number> = []): T[] {
  const res = getDb().exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

function sessionOf(sessionId: string): SessionRow | null {
  try {
    return rowsOf<SessionRow>('SELECT agent_type, workstream_root FROM agent_sessions WHERE session_id = ?', [sessionId])[0] ?? null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Write one broadcast agent event. Never throws: a log that fails must not break what it logs. */
export function recordAgentEvent(evt: AgentEvent, known: readonly string[] = []): StoredAgentEvent | null {
  try {
    if (!evt || typeof evt.id !== 'string' || typeof evt.type !== 'string') return null;
    const payload = (evt.payload && typeof evt.payload === 'object' ? evt.payload : {}) as Record<string, unknown>;
    const sessionId = str(payload.sessionId);
    const session = sessionId ? sessionOf(sessionId) : null;
    const agentType = str(payload.agentType) ?? session?.agent_type ?? (evt.source === 'claude-code-watcher' ? 'claude-code' : null);
    const workstreamRoot = str(payload.workstreamRoot) ?? session?.workstream_root ?? null;
    let json = JSON.stringify(redactValue(payload, known));
    if (json.length > MAX_PAYLOAD_CHARS) json = JSON.stringify({ truncated: true, text: json.slice(0, MAX_PAYLOAD_CHARS) });
    const at = typeof evt.timestamp === 'number' && Number.isFinite(evt.timestamp) ? evt.timestamp : Date.now();
    getDb().run(
      'INSERT OR IGNORE INTO agent_events (id, at, source, type, session_id, agent_type, workstream_root, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [evt.id, at, evt.source, evt.type, sessionId, agentType, workstreamRoot, json],
    );
    markDirty();
    const stored: StoredAgentEvent = { ...evt, timestamp: at, payload: JSON.parse(json), sessionId, agentType, workstreamRoot };
    try { recordedListener?.(stored); } catch { /* a listener must not undo the record */ }
    return stored;
  } catch {
    return null;
  }
}

/**
 * A session was bound to its workstream after some of its events were
 * logged (an MCP client's roots arrive after connect): give those events the
 * workstream. Only rows that have none are touched. Never throws.
 */
export function adoptSessionEvents(sessionId: string, workstreamRoot: string): void {
  try {
    getDb().run('UPDATE agent_events SET workstream_root = ? WHERE session_id = ? AND workstream_root IS NULL', [workstreamRoot, sessionId]);
  } catch { /* the log must never break a binding */ }
}

export interface AgentEventQuery {
  /** Only events after this time (ms). */
  since?: number;
  /** Only events before this time (ms): paging back. */
  before?: number;
  sessionId?: string;
  workstreamRoot?: string;
  limit?: number;
}

interface EventRow { id: string; at: number; source: string; type: string; session_id: string | null; agent_type: string | null; workstream_root: string | null; payload: string }

/** The most recent matching events, oldest first. */
export function listAgentEvents(q: AgentEventQuery = {}): StoredAgentEvent[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.since !== undefined) { where.push('at > ?'); params.push(q.since); }
  if (q.before !== undefined) { where.push('at < ?'); params.push(q.before); }
  if (q.sessionId) { where.push('session_id = ?'); params.push(q.sessionId); }
  if (q.workstreamRoot) { where.push('workstream_root = ?'); params.push(q.workstreamRoot); }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(q.limit ?? DEFAULT_LIMIT)));
  const sql = `SELECT id, at, source, type, session_id, agent_type, workstream_root, payload FROM agent_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, rowid DESC LIMIT ${limit}`;
  return rowsOf<EventRow>(sql, params).reverse().map((r) => {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(r.payload) as Record<string, unknown>; } catch { /* kept as empty */ }
    return {
      id: r.id, timestamp: r.at, source: r.source as AgentEventSource, type: r.type as AgentEventType, payload,
      sessionId: r.session_id, agentType: r.agent_type, workstreamRoot: r.workstream_root,
    };
  });
}

/** Drop what is older than the retention window, and the oldest past `MAX_ROWS`. Returns rows removed. */
export function pruneAgentEvents(now = Date.now(), maxRows = MAX_ROWS): number {
  const db = getDb();
  const count = () => Number(rowsOf<{ n: number }>('SELECT COUNT(*) AS n FROM agent_events')[0]?.n ?? 0);
  const before = count();
  db.run('DELETE FROM agent_events WHERE at < ?', [now - RETENTION_DAYS * 24 * 60 * 60 * 1000]);
  const over = count() - maxRows;
  if (over > 0) db.run('DELETE FROM agent_events WHERE rowid IN (SELECT rowid FROM agent_events ORDER BY at ASC, rowid ASC LIMIT ?)', [over]);
  const removed = before - count();
  if (removed > 0) markDirty();
  return removed;
}

type Tap = (listener: (message: { type: string; payload: unknown }) => void) => () => void;

let stop: (() => void) | null = null;

/**
 * Start keeping agent events: tap the broadcast, prune now and hourly.
 * Idempotent. `known` returns exact values to mask (this launch's token).
 */
export function startAgentEventLog(tap: Tap, known: () => readonly string[] = () => []): () => void {
  if (stop) return stop;
  try { pruneAgentEvents(); } catch { /* the table may not exist yet in an odd boot; the next prune catches up */ }
  const untap = tap(({ type, payload }) => {
    if (type === 'agent-event') recordAgentEvent(payload as AgentEvent, known());
  });
  const timer = setInterval(() => { try { pruneAgentEvents(); } catch { /* next hour */ } }, 60 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  stop = () => { untap(); clearInterval(timer); stop = null; };
  return stop;
}
