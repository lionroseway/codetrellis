/**
 * Phase 32 B4 — breakpoints: places a person has said "stop and ask me"
 * (observability doc §10).
 *
 * Enforced at the one MCP interception point, before a tool acts, so it
 * holds for every agent and every tool that does the thing:
 *
 *   - **task**: an agent claims the task (claim_item, or update_item to
 *     in_progress), marks it done (update_item to done), or deletes it; on
 *     the task itself or anything under it.
 *   - **spec**: an agent changes an item's description (update_item with a
 *     title, body or template, restore_item_version), or deletes it; on the
 *     item itself or anything under it.
 *
 * A deletion also fires a breakpoint set on anything underneath, since
 * deleting a parent deletes it.
 *
 * When one fires, the call does nothing and returns "paused: waiting for a
 * decision" with a ref. The agent waits with `await_decision(ref)`, which
 * reads the database, so a wait survives the call timing out and the app
 * restarting. A person answers continue, continue with a steer (a note the
 * agent reads), or stop. The answer is spent by the agent's next matching
 * call: continue lets it through once, with the steer attached; stop refuses
 * it once, with the note. A call made again while the hit is still waiting
 * gets the same ref, not a second hit. Nobody answering means it keeps
 * waiting: a breakpoint never turns into a yes by itself.
 *
 * Plan documents are not covered: no agent tool edits one, so a breakpoint
 * there would guard nothing. Code and signal breakpoints are B4.2.
 */

import { randomBytes } from 'node:crypto';
import { getDb } from './database';
import { recordBreakpointEvent } from './agent-event-log';

export const BREAKPOINT_KINDS = ['task', 'spec'] as const;
export type BreakpointKind = typeof BREAKPOINT_KINDS[number];
export const DECISIONS = ['continue', 'steer', 'stop'] as const;
export type Decision = typeof DECISIONS[number];
/** What the held call would have done. */
export type BreakpointAction = 'claim' | 'done' | 'edit' | 'delete';

export const MAX_NOTE = 1000;
/** How deep a parent chain is walked; plans are never this deep. */
const MAX_DEPTH = 50;

export interface Breakpoint {
  id: string;
  kind: BreakpointKind;
  /** The item it is on. */
  target: string;
  targetTitle: string | null;
  planUid: string | null;
  note: string | null;
  createdAt: number;
  createdBy: string;
  createdByType: string;
}

export interface BreakpointHit {
  ref: string;
  breakpointId: string;
  kind: BreakpointKind | null;
  /** The note the person left on the breakpoint. */
  breakpointNote: string | null;
  tool: string;
  action: BreakpointAction;
  itemUid: string;
  itemTitle: string | null;
  planUid: string | null;
  agent: string | null;
  sessionId: string | null;
  workstreamRoot: string | null;
  hitAt: number;
  decision: Decision | null;
  note: string | null;
  answeredAt: number | null;
  answeredBy: string | null;
  answeredByType: string | null;
}

function rowsOf<T>(sql: string, params: Array<string | number | null> = []): T[] {
  const res = getDb().exec(sql, params as Array<string | number>);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

/** A person's note: control characters other than newlines removed, trimmed, at most MAX_NOTE. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  const s = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim();
  return s ? s.slice(0, MAX_NOTE) : null;
}

// ── What a call would do ───────────────────────────────────────────

export interface GuardedCall {
  itemUid: string;
  /** The actions this call would take, each with the breakpoint kind it answers to, most specific first. */
  actions: Array<{ action: BreakpointAction; kind: BreakpointKind }>;
}

/**
 * The item a tool call would act on and what it would do to it, or null
 * when the call is not one a breakpoint can hold. Arguments are as the tool
 * received them, after references were resolved.
 */
export function guardedCall(tool: string, args: unknown): GuardedCall | null {
  const a = (args ?? {}) as Record<string, unknown>;
  const uid = typeof a.uid === 'string' && a.uid ? a.uid : null;
  if (!uid) return null;
  const actions: GuardedCall['actions'] = [];
  switch (tool) {
    case 'claim_item':
      actions.push({ action: 'claim', kind: 'task' });
      break;
    case 'update_item':
      if (a.status === 'in_progress') actions.push({ action: 'claim', kind: 'task' });
      if (a.status === 'done') actions.push({ action: 'done', kind: 'task' });
      if (a.title !== undefined || a.body !== undefined || a.template !== undefined) actions.push({ action: 'edit', kind: 'spec' });
      break;
    case 'restore_item_version':
      actions.push({ action: 'edit', kind: 'spec' });
      break;
    case 'delete_item':
      actions.push({ action: 'delete', kind: 'task' }, { action: 'delete', kind: 'spec' });
      break;
    default:
      return null;
  }
  return actions.length ? { itemUid: uid, actions } : null;
}

// ── Breakpoints ────────────────────────────────────────────────────

interface ItemRow { uid: string; parent_uid: string | null; plan_uid: string; title: string }

function itemRow(uid: string): ItemRow | null {
  return rowsOf<ItemRow>('SELECT uid, parent_uid, plan_uid, title FROM plan_items WHERE uid = ?', [uid])[0] ?? null;
}

/** The item and its parents, nearest first. */
function lineage(uid: string): ItemRow[] {
  const out: ItemRow[] = [];
  const seen = new Set<string>();
  let at: string | null = uid;
  while (at && !seen.has(at) && out.length < MAX_DEPTH) {
    seen.add(at);
    const row = itemRow(at);
    if (!row) break;
    out.push(row);
    at = row.parent_uid;
  }
  return out;
}

interface BreakpointRow {
  id: string; kind: string; target: string; plan_uid: string | null; note: string | null;
  created_at: number; created_by: string; created_by_type: string; title?: string | null;
}

function toBreakpoint(r: BreakpointRow): Breakpoint {
  return {
    id: r.id, kind: r.kind as BreakpointKind, target: r.target, targetTitle: r.title ?? null, planUid: r.plan_uid,
    note: r.note, createdAt: Number(r.created_at), createdBy: r.created_by, createdByType: r.created_by_type,
  };
}

const ACTIVE_SELECT = `SELECT b.id, b.kind, b.target, b.plan_uid, b.note, b.created_at, b.created_by, b.created_by_type, i.title
  FROM breakpoints b LEFT JOIN plan_items i ON i.uid = b.target WHERE b.cleared_at IS NULL`;

/** Breakpoints still set, oldest first; on one plan's items when `planUid` is given. */
export function listBreakpoints(planUid?: string): Breakpoint[] {
  const rows = planUid
    ? rowsOf<BreakpointRow>(`${ACTIVE_SELECT} AND b.plan_uid = ? ORDER BY b.created_at`, [planUid])
    : rowsOf<BreakpointRow>(`${ACTIVE_SELECT} ORDER BY b.created_at`);
  return rows.map(toBreakpoint);
}

export function getBreakpoint(id: string): Breakpoint | null {
  const r = rowsOf<BreakpointRow>(`${ACTIVE_SELECT} AND b.id = ?`, [id])[0];
  return r ? toBreakpoint(r) : null;
}

export class BreakpointError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * A person sets a breakpoint on an item. The plan comes from the item,
 * never the request. Setting one that is already set returns it.
 */
export function setBreakpoint(input: { kind: unknown; itemUid: unknown; note?: unknown; by: string; byType: string; now?: number }): { breakpoint: Breakpoint; created: boolean } {
  if (!BREAKPOINT_KINDS.includes(input.kind as BreakpointKind)) throw new BreakpointError(`kind must be one of ${BREAKPOINT_KINDS.join(', ')}`, 400);
  const item = typeof input.itemUid === 'string' ? itemRow(input.itemUid) : null;
  if (!item) throw new BreakpointError('Item not found', 404);
  const kind = input.kind as BreakpointKind;
  const existing = rowsOf<BreakpointRow>(`${ACTIVE_SELECT} AND b.kind = ? AND b.target = ?`, [kind, item.uid])[0];
  if (existing) return { breakpoint: toBreakpoint(existing), created: false };
  const id = `bp_${randomBytes(6).toString('hex')}`;
  getDb().run(
    'INSERT INTO breakpoints (id, kind, target, plan_uid, note, created_at, created_by, created_by_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, kind, item.uid, item.plan_uid, cleanNote(input.note), input.now ?? Date.now(), input.by, input.byType],
  );
  return { breakpoint: getBreakpoint(id)!, created: true };
}

/**
 * A person clears a breakpoint. Calls still waiting on it are answered
 * "continue" by the same person: the reason to wait has gone. False when
 * no such breakpoint is set.
 */
export function clearBreakpoint(input: { id: string; by: string; byType: string; now?: number }): { cleared: boolean; released: BreakpointHit[] } {
  const bp = getBreakpoint(input.id);
  if (!bp) return { cleared: false, released: [] };
  const now = input.now ?? Date.now();
  getDb().run('UPDATE breakpoints SET cleared_at = ?, cleared_by = ?, cleared_by_type = ? WHERE id = ?', [now, input.by, input.byType, bp.id]);
  const released: BreakpointHit[] = [];
  for (const hit of listHits({ state: 'waiting' }).filter((h) => h.breakpointId === bp.id)) {
    const answered = answerHit({ ref: hit.ref, decision: 'continue', note: 'The breakpoint was cleared.', by: input.by, byType: input.byType, now });
    if (answered) released.push(answered);
  }
  return { cleared: true, released };
}

/** The breakpoint of `kind` that holds a call on `itemUid`: the nearest, on it or a parent; for a deletion, also one underneath. */
function breakpointFor(kind: BreakpointKind, action: BreakpointAction, chain: ItemRow[]): Breakpoint | null {
  const set = rowsOf<BreakpointRow>(`${ACTIVE_SELECT} AND b.kind = ? AND b.plan_uid = ? ORDER BY b.created_at`, [kind, chain[0].plan_uid]).map(toBreakpoint);
  if (!set.length) return null;
  for (const row of chain) {
    const bp = set.find((b) => b.target === row.uid);
    if (bp) return bp;
  }
  if (action === 'delete') {
    const deleted = chain[0].uid;
    return set.find((b) => lineage(b.target).some((r) => r.uid === deleted)) ?? null;
  }
  return null;
}

// ── Hits ───────────────────────────────────────────────────────────

interface HitRow {
  ref: string; breakpoint_id: string; tool: string; action: string; item_uid: string; plan_uid: string | null;
  agent: string | null; session_id: string | null; workstream_root: string | null; hit_at: number;
  decision: string | null; note: string | null; answered_at: number | null; answered_by: string | null;
  answered_by_type: string | null; kind: string | null; bp_note: string | null; title: string | null;
}

const HIT_SELECT = `SELECT h.*, b.kind, b.note AS bp_note, i.title
  FROM breakpoint_hits h LEFT JOIN breakpoints b ON b.id = h.breakpoint_id LEFT JOIN plan_items i ON i.uid = h.item_uid`;

function toHit(r: HitRow): BreakpointHit {
  return {
    ref: r.ref, breakpointId: r.breakpoint_id, kind: (r.kind as BreakpointKind) ?? null, breakpointNote: r.bp_note ?? null,
    tool: r.tool, action: r.action as BreakpointAction, itemUid: r.item_uid, itemTitle: r.title ?? null, planUid: r.plan_uid,
    agent: r.agent, sessionId: r.session_id, workstreamRoot: r.workstream_root, hitAt: Number(r.hit_at),
    decision: (r.decision as Decision) ?? null, note: r.note, answeredAt: r.answered_at === null ? null : Number(r.answered_at),
    answeredBy: r.answered_by, answeredByType: r.answered_by_type,
  };
}

export function getHit(ref: string): BreakpointHit | null {
  const r = rowsOf<HitRow>(`${HIT_SELECT} WHERE h.ref = ?`, [ref])[0];
  return r ? toHit(r) : null;
}

/** Hits, oldest first: those still waiting for a person, or every one (newest 200). */
export function listHits(q: { state?: 'waiting' | 'all'; planUid?: string } = {}): BreakpointHit[] {
  const where: string[] = [];
  const params: string[] = [];
  if ((q.state ?? 'waiting') === 'waiting') where.push('h.answered_at IS NULL');
  if (q.planUid) { where.push('h.plan_uid = ?'); params.push(q.planUid); }
  const sql = `${HIT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY h.hit_at DESC LIMIT 200`;
  return rowsOf<HitRow>(sql, params).map(toHit).reverse();
}

function hitPayload(hit: BreakpointHit): Record<string, unknown> {
  return {
    ref: hit.ref, kind: hit.kind, action: hit.action, tool: hit.tool, itemUid: hit.itemUid, itemTitle: hit.itemTitle,
    planUid: hit.planUid, agent: hit.agent, ...(hit.workstreamRoot ? { workstreamRoot: hit.workstreamRoot } : {}),
  };
}

/**
 * A person answers a waiting hit. Null when there is no such hit, or it has
 * been answered already (the first answer stands).
 */
export function answerHit(input: { ref: string; decision: Decision; note?: unknown; by: string; byType: string; now?: number }): BreakpointHit | null {
  const hit = getHit(input.ref);
  if (!hit || hit.answeredAt !== null) return null;
  const note = cleanNote(input.note);
  getDb().run(
    'UPDATE breakpoint_hits SET decision = ?, note = ?, answered_at = ?, answered_by = ?, answered_by_type = ? WHERE ref = ? AND answered_at IS NULL',
    [input.decision, note, input.now ?? Date.now(), input.by, input.byType, input.ref],
  );
  const answered = getHit(input.ref)!;
  recordBreakpointEvent('breakpoint_answered', {
    ...hitPayload(answered), decision: answered.decision, note: answered.note, waitedMs: (answered.answeredAt ?? 0) - answered.hitAt,
    by: input.by, byType: input.byType,
  }, input.byType);
  return answered;
}

// ── At the interception ────────────────────────────────────────────

export interface Caller {
  /** The agent, as the session names it: who a held call belongs to, across reconnects and restarts. */
  agent: string;
  sessionId: string | null;
}

export type Enforcement =
  | { kind: 'pass' }
  /** Answered continue (or steer): the call goes through, once. */
  | { kind: 'continue'; hit: BreakpointHit }
  /** Answered stop: the call is refused, once. */
  | { kind: 'stop'; hit: BreakpointHit }
  | { kind: 'paused'; hit: BreakpointHit; fresh: boolean };

function workstreamOf(sessionId: string | null): string | null {
  if (!sessionId) return null;
  try {
    return rowsOf<{ root: string | null }>('SELECT workstream_root AS root FROM agent_sessions WHERE session_id = ?', [sessionId])[0]?.root ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a tool call may act. Called at the MCP interception before the
 * handler runs. Anything unexpected lets the call through: a breakpoint
 * that cannot be read is not one that was set.
 */
export function enforce(tool: string, args: unknown, caller: Caller, now = Date.now()): Enforcement {
  let call: GuardedCall | null;
  let chain: ItemRow[];
  try {
    call = guardedCall(tool, args);
    if (!call) return { kind: 'pass' };
    chain = lineage(call.itemUid);
    if (!chain.length) return { kind: 'pass' };
  } catch {
    return { kind: 'pass' };
  }
  for (const { action, kind } of call.actions) {
    let bp: Breakpoint | null;
    try { bp = breakpointFor(kind, action, chain); } catch { bp = null; }
    if (!bp) continue;

    const open = rowsOf<HitRow>(
      `${HIT_SELECT} WHERE h.breakpoint_id = ? AND h.item_uid = ? AND h.action = ? AND h.agent = ? AND h.consumed_at IS NULL ORDER BY h.hit_at`,
      [bp.id, call.itemUid, action, caller.agent],
    ).map(toHit);
    const answered = open.find((h) => h.answeredAt !== null);
    if (answered) {
      getDb().run('UPDATE breakpoint_hits SET consumed_at = ? WHERE ref = ?', [now, answered.ref]);
      if (answered.decision === 'stop') return { kind: 'stop', hit: answered };
      continue; // this breakpoint lets it through; another may still hold it
    }
    const waiting = open.find((h) => h.answeredAt === null);
    if (waiting) return { kind: 'paused', hit: waiting, fresh: false };

    const ref = `bp-${randomBytes(5).toString('hex')}`;
    getDb().run(
      `INSERT INTO breakpoint_hits (ref, breakpoint_id, tool, action, item_uid, plan_uid, agent, session_id, workstream_root, hit_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref, bp.id, tool, action, call.itemUid, chain[0].plan_uid, caller.agent, caller.sessionId, workstreamOf(caller.sessionId), now],
    );
    const hit = getHit(ref)!;
    recordBreakpointEvent('breakpoint_hit', { ...hitPayload(hit), breakpointId: bp.id, on: bp.target, onTitle: bp.targetTitle }, caller.agent);
    return { kind: 'paused', hit, fresh: true };
  }
  // Every breakpoint that held it has answered continue: the last answer's steer rides along.
  const spent = rowsOf<HitRow>(
    `${HIT_SELECT} WHERE h.item_uid = ? AND h.agent = ? AND h.consumed_at = ? ORDER BY h.answered_at DESC`,
    [call.itemUid, caller.agent, now],
  ).map(toHit)[0];
  return spent ? { kind: 'continue', hit: spent } : { kind: 'pass' };
}

// ── What the agent reads ───────────────────────────────────────────

const DOING: Record<BreakpointAction, string> = {
  claim: 'claiming', done: 'marking done', edit: 'changing the description of', delete: 'deleting',
};

function said(hit: BreakpointHit): string {
  return hit.answeredByType === 'human' ? 'A person' : `Someone (${hit.answeredByType ?? 'unknown'})`;
}

/** The result a held call returns instead of acting. */
export function pausedResult(hit: BreakpointHit): { content: Array<{ type: 'text'; text: string }>; _meta: { summary: string } } {
  const what = `${DOING[hit.action]} “${hit.itemTitle ?? hit.itemUid}”`;
  const body = {
    paused: true,
    status: 'paused: waiting for a decision',
    ref: hit.ref,
    breakpoint: { kind: hit.kind, note: hit.breakpointNote },
    message:
      `paused: waiting for a decision. A person set a breakpoint and wants to be asked before ${what}. ` +
      'Nothing was done. Call await_decision with this ref and wait for their answer, calling it again while it says it is still waiting ' +
      '(this can take a long time; do not work around it). If they say continue, make the same call again.',
  };
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], _meta: { summary: `Paused at a breakpoint before ${what}` } };
}

/** The result a call refused by a "stop" answer returns. */
export function stoppedResult(hit: BreakpointHit): { content: Array<{ type: 'text'; text: string }>; _meta: { summary: string } } {
  const body = {
    stopped: true,
    ref: hit.ref,
    note: hit.note,
    message: `${said(hit)} answered your breakpoint: stop. Nothing was done.${hit.note ? ` Their note: ${hit.note}` : ''} Do not make this call again unless they ask you to.`,
  };
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], _meta: { summary: 'Stopped at a breakpoint' } };
}

/** The line added to a call a "continue" answer let through, when the person left a steer. */
export function steerText(hit: BreakpointHit): string | null {
  if (!hit.note) return null;
  return `${said(hit)} answered your breakpoint (${hit.ref}): continue, with this steer: ${hit.note}`;
}

/** What await_decision returns for a hit. */
export function decisionView(hit: BreakpointHit): Record<string, unknown> {
  if (hit.answeredAt === null) {
    return {
      status: 'waiting', ref: hit.ref, waitingSince: new Date(hit.hitAt).toISOString(),
      message: 'Still waiting for a person. Call await_decision again with the same ref. Do not make the paused call again until they answer.',
    };
  }
  const next = hit.decision === 'stop'
    ? 'Do not make the paused call. Stop that work, and tell the person what you will do instead.'
    : 'Make the paused call again; it will go through once.';
  return {
    status: 'answered', ref: hit.ref, decision: hit.decision, note: hit.note,
    by: hit.answeredByType, at: new Date(hit.answeredAt).toISOString(), message: next,
  };
}
