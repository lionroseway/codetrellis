/**
 * Phase 32 B4.2 — breakpoints on code (observability doc §10.3).
 *
 * A person marks a file, a folder, or a function's file "ask me before this
 * changes". CodeTrellis cannot stop an agent's own editor, so it is honest
 * about the two cases:
 *
 *  - **Claude Code with the hook** (A3.4). Before each edit the hook calls
 *    `check_breakpoint`; a covered file is held: the edit is denied as
 *    "paused: waiting for a decision" with a ref, and the agent waits with
 *    `await_decision`. A person's "continue" opens that file to that
 *    workstream for as long as the breakpoint stands, because an agent edits
 *    one file in several steps; "stop" keeps refusing it.
 *  - **Everyone else.** The change is only seen after it is made, in the
 *    workstream's changed files. It is recorded as a **breach**, never as a
 *    pause, and the agent is told on its next tool call to stop and wait.
 *    A file changed before the breakpoint was set is not a breach (its
 *    modification time says so), nor is a change the hook let through.
 *    A deleted file leaves nothing to date, so a deletion is not detected.
 *
 * Hits are keyed by the workstream, not the agent: the hook asks as its own
 * short session, so the workstream is what the edit and the answer share.
 *
 * **A function breakpoint** (`path#name`, B4.2c) holds only what touches that
 * function. The hook sends the text each edit replaces; it is found in the
 * workstream's copy of the file, and held when it overlaps the function's
 * lines. A breach counts only when the function is among the workstream's
 * changed functions. Whatever cannot be told (a whole-file write, text not
 * found, a file the parser cannot read, the function not in the file) is
 * held, or counted, as the whole file: the safe side.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getDb } from './database';
import { recordBreakpointEvent } from './agent-event-log';
import { getActiveSessions } from './session-service';
import { listWorkstreams, getSymbolParser } from './workstream-service';
import type { ParsedSymbol } from '../../shared/types';
import {
  ACTIVE_SELECT, HIT_SELECT, rowsOf, toBreakpointRow, toHitRow, getHit, hitPayload, codeCovers,
  type Breakpoint, type BreakpointHit,
} from './breakpoint-service';
import { pushForBreakpoint } from './push-notification-service';

export const HOOK_AGENT = 'claude-code-hook';

export interface CodeCaller {
  agent: string;
  sessionId: string | null;
  /** The workstream the call comes from; nothing is held for a call from no known workstream. */
  workstreamRoot: string | null;
}

export type CodeEnforcement =
  | { kind: 'pass' }
  | { kind: 'continue'; hit: BreakpointHit; steer: string | null }
  | { kind: 'stop'; hit: BreakpointHit }
  | { kind: 'paused'; hit: BreakpointHit; fresh: boolean };

/** Code breakpoints still set in this project, oldest first. */
export function codeBreakpoints(projectRoot: string): Breakpoint[] {
  return rowsOf(`${ACTIVE_SELECT} AND b.kind = 'code' AND b.project_root = ? ORDER BY b.created_at`, [projectRoot]).map(toBreakpointRow);
}

/** A function breakpoint's name (`refund`, `Session.renew`), or null for a file or folder. */
export function functionOf(target: string): string | null {
  const i = target.indexOf('#');
  return i === -1 ? null : target.slice(i + 1) || null;
}

/** Already qualified by the language (`(Ledger).Post`, `Invoice#post`, `A.b`). */
const QUALIFIED = /[.#)]/;

/** The last part of a qualified name: `renew` of `Session.renew`, `Post` of `(Ledger).Post`. */
const lastPart = (name: string) => name.split(/[.#)]/).filter(Boolean).pop() ?? name;

/** A symbol answers to a wanted name: the same qualified name, or a bare name that is its last part. */
export function nameMatches(symbol: string, wanted: string): boolean {
  if (symbol === wanted) return true;
  return !QUALIFIED.test(wanted) && lastPart(symbol) === wanted;
}

/** Every symbol with a name unique in its file (members qualified, as the footprint names them) and its lines. */
export function symbolRanges(symbols: readonly ParsedSymbol[]): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = [];
  const visit = (list: readonly ParsedSymbol[], parent: string | null) => {
    for (const s of list) {
      const name = parent && !QUALIFIED.test(s.name) ? `${parent}.${s.name}` : s.name;
      out.push({ name, start: s.startLine, end: s.endLine });
      if (s.children?.length) visit(s.children, name);
    }
  };
  visit(symbols, null);
  return out;
}

/** The 1-based line a character offset falls on. */
function lineAt(content: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Whether edits replacing `oldTexts` in `content` touch the function `name`:
 * true or false when that can be told, null when it cannot (no replaced text
 * means the whole file; text not found; the function not in the file). Pure.
 */
export function editTouches(
  content: string, oldTexts: readonly string[] | undefined, ranges: ReadonlyArray<{ name: string; start: number; end: number }>, name: string,
): boolean | null {
  const targets = ranges.filter((r) => nameMatches(r.name, name));
  if (!targets.length || !oldTexts?.length) return null;
  for (const text of oldTexts) {
    if (!text) return null;
    let at = content.indexOf(text);
    if (at === -1) return null;
    while (at !== -1) {
      const start = lineAt(content, at);
      const end = lineAt(content, at + text.length - 1);
      if (targets.some((r) => start <= r.end && end >= r.start)) return true;
      at = content.indexOf(text, at + 1);
    }
  }
  return false;
}

/** Whether an edit of `file` in this workstream touches function `name`; null when it cannot be told. */
function touchesFunction(workstreamRoot: string, file: string, name: string, oldTexts: readonly string[] | undefined): boolean | null {
  if (!oldTexts?.length) return null;
  const parse = getSymbolParser();
  const abs = insideFolder(workstreamRoot, file);
  if (!parse || !abs) return null;
  let content: string;
  try { content = fs.readFileSync(abs, 'utf-8'); } catch { return null; }
  const symbols = parse(file, content);
  if (!symbols) return null;
  return editTouches(content, oldTexts, symbolRanges(symbols), name);
}

/** Repository-relative, forward slashes, no leading `./`. */
function relOf(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function newHit(input: {
  bp: Breakpoint; tool: string; action: 'edit_code' | 'breach'; file: string; caller: CodeCaller; breach: boolean; now: number;
}): BreakpointHit {
  const ref = `bp-${randomBytes(5).toString('hex')}`;
  getDb().run(
    `INSERT INTO breakpoint_hits (ref, breakpoint_id, tool, action, item_uid, path, breach, plan_uid, agent, session_id, workstream_root, hit_at)
     VALUES (?, ?, ?, ?, '', ?, ?, NULL, ?, ?, ?, ?)`,
    [ref, input.bp.id, input.tool, input.action, input.file, input.breach ? 1 : 0, input.caller.agent, input.caller.sessionId, input.caller.workstreamRoot, input.now],
  );
  const hit = getHit(ref)!;
  recordBreakpointEvent('breakpoint_hit', { ...hitPayload(hit), breakpointId: input.bp.id, on: input.bp.target }, input.caller.agent);
  void pushForBreakpoint(hit).catch(() => {}); // a person away from the desk is told (B4.4)
  return hit;
}

/**
 * Whether an edit of `file` from this workstream may go ahead: the hook's
 * question. Anything unexpected lets it through, as the hook itself fails
 * open: a breakpoint that cannot be read is not one that was set.
 */
export function enforceEdit(
  projectRoot: string, rawFile: string, caller: CodeCaller, now = Date.now(),
  /** The text each edit replaces, when the hook knows it: a function breakpoint holds only an edit that touches it. */
  oldTexts?: readonly string[],
): CodeEnforcement {
  if (!caller.workstreamRoot) return { kind: 'pass' };
  const file = relOf(rawFile);
  let continued: { hit: BreakpointHit; steer: string | null } | null = null;
  try {
    for (const bp of codeBreakpoints(projectRoot).filter((b) => codeCovers(b.target, file))) {
      const fn = functionOf(bp.target);
      if (fn && touchesFunction(caller.workstreamRoot, file, fn, oldTexts) === false) continue;
      const latest = rowsOf(
        `${HIT_SELECT} WHERE h.breakpoint_id = ? AND h.path = ? AND h.workstream_root = ? AND h.action = 'edit_code' ORDER BY h.hit_at DESC LIMIT 1`,
        [bp.id, file, caller.workstreamRoot],
      ).map(toHitRow)[0];
      if (!latest) return { kind: 'paused', hit: newHit({ bp, tool: 'check_breakpoint', action: 'edit_code', file, caller, breach: false, now }), fresh: true };
      if (latest.answeredAt === null) return { kind: 'paused', hit: latest, fresh: false };
      if (latest.decision === 'stop') return { kind: 'stop', hit: latest };
      // Continue: the file is open to this workstream. A steer is told once.
      const untold = rowsOf<{ consumed_at: number | null }>('SELECT consumed_at FROM breakpoint_hits WHERE ref = ?', [latest.ref])[0]?.consumed_at === null;
      if (untold) getDb().run('UPDATE breakpoint_hits SET consumed_at = ? WHERE ref = ?', [now, latest.ref]);
      continued = { hit: latest, steer: untold ? latest.note : null };
    }
  } catch {
    return { kind: 'pass' };
  }
  return continued ? { kind: 'continue', ...continued } : { kind: 'pass' };
}

/** Where `file` is in the workstream folder, only if it resolves inside it (no link out). */
function insideFolder(folder: string, file: string): string | null {
  try {
    const base = fs.realpathSync.native(folder);
    const real = fs.realpathSync.native(path.join(folder, file));
    return real === base || real.startsWith(base + path.sep) ? real : null;
  } catch {
    return null;
  }
}

/**
 * Record a breach for each file this workstream changed under a code
 * breakpoint since it was set, that nobody allowed and that is not recorded
 * already. Returns the breaches recorded now.
 */
export function recordBreaches(
  projectRoot: string,
  caller: CodeCaller,
  changed: ReadonlyArray<{ path: string; status?: string; symbols?: ReadonlyArray<{ name: string }> | null }>,
  now = Date.now(),
  mtimeOf: (abs: string) => number | null = (abs) => { try { return fs.statSync(abs).mtimeMs; } catch { return null; } },
): BreakpointHit[] {
  if (!caller.workstreamRoot || caller.agent === HOOK_AGENT) return [];
  const bps = codeBreakpoints(projectRoot);
  if (!bps.length) return [];
  const out: BreakpointHit[] = [];
  for (const change of changed) {
    if (change.status === 'deleted') continue;
    const file = relOf(change.path);
    for (const bp of bps.filter((b) => codeCovers(b.target, file))) {
      // A function breakpoint: a breach only when that function is among the
      // changed ones. A file the parser did not read counts as the whole file.
      const fn = functionOf(bp.target);
      if (fn && Array.isArray(change.symbols) && !change.symbols.some((x) => nameMatches(x.name, fn))) continue;
      const known = rowsOf<{ n: number }>(
        `SELECT COUNT(*) AS n FROM breakpoint_hits WHERE breakpoint_id = ? AND path = ? AND workstream_root = ?
           AND (breach = 1 OR (action = 'edit_code' AND decision IN ('continue', 'steer')))`,
        [bp.id, file, caller.workstreamRoot],
      )[0];
      if (Number(known?.n) > 0) continue;
      const abs = insideFolder(caller.workstreamRoot, file);
      const mtime = abs ? mtimeOf(abs) : null;
      if (mtime === null || mtime <= bp.createdAt) continue;
      out.push(newHit({ bp, tool: 'edit', action: 'breach', file, caller, breach: true, now }));
    }
  }
  return out;
}

// Which sessions have been told of which breach, this launch. A breach is
// told once to each session in its workstream; a restart tells them again,
// which is the safer way to be wrong.
const told = new Map<string, Set<string>>();

/** The breaches in this workstream still waiting for a person that this session has not been told of. Marks them told. */
export function untoldBreaches(workstreamRoot: string, sessionId: string): BreakpointHit[] {
  const waiting = rowsOf(`${HIT_SELECT} WHERE h.breach = 1 AND h.workstream_root = ? AND h.answered_at IS NULL ORDER BY h.hit_at`, [workstreamRoot]).map(toHitRow);
  const fresh = waiting.filter((h) => !told.get(h.ref)?.has(sessionId));
  for (const h of fresh) told.set(h.ref, (told.get(h.ref) ?? new Set()).add(sessionId));
  return fresh;
}

/** Test seam. */
export function resetBreachNotices(): void { told.clear(); }

export const BREAKPOINT_MARKER = '── CodeTrellis breakpoint ──';

/** What a code hit is about, in words: the function in its file, or the file. */
export function codeSubject(hit: Pick<BreakpointHit, 'path' | 'breakpointTarget'>): string {
  const fn = hit.breakpointTarget ? functionOf(hit.breakpointTarget) : null;
  return fn ? `${fn} in ${hit.path}` : String(hit.path);
}

/** What an agent is told of breaches in its workstream. Marked as the person's request, not information about other work. */
export function breachText(hits: readonly BreakpointHit[]): string {
  return [
    BREAKPOINT_MARKER,
    ...hits.map((h) => `You changed ${codeSubject(h)}, which has a breakpoint: a person asked to be asked before it changes. ` +
      `CodeTrellis could not pause your editor, so this is recorded as a breach. Stop changing it and call await_decision with ref "${h.ref}" for their answer.` +
      (h.breakpointNote ? ` Their note on the breakpoint: ${h.breakpointNote}` : '')),
    'This is the person\'s request, not information about other work.',
  ].join('\n');
}

/**
 * The breach notice for this session's tool result, or null: its
 * workstream's changes are checked against the project's code breakpoints
 * (only when there are any), breaches recorded, and each told once. Never
 * throws: a notice must not break the call it rides on.
 */
export async function breachNoticeFor(sessionId: string, projectRoot: string | null): Promise<string | null> {
  if (!projectRoot) return null;
  try {
    const session = getActiveSessions().find((s) => s.sessionId === sessionId);
    if (!session?.workstreamRoot || session.agentType === HOOK_AGENT) return null;
    if (!codeBreakpoints(projectRoot).length) return null;
    const canon = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
    const mine = canon(session.workstreamRoot);
    const w = (await listWorkstreams(projectRoot, { fresh: true })).find((x) => canon(x.root) === mine);
    const caller = { agent: session.agentType ?? 'mcp-agent', sessionId, workstreamRoot: session.workstreamRoot };
    if (w) recordBreaches(projectRoot, caller, w.changes.files);
    const hits = untoldBreaches(session.workstreamRoot, sessionId);
    return hits.length ? breachText(hits) : null;
  } catch (err) {
    console.warn('[Breakpoints] breach check failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** What the hook tells Claude Code when it holds an edit: the reason the edit was not made. */
export function heldEditText(result: CodeEnforcement & { kind: 'paused' | 'stop' }): string {
  const h = result.hit;
  const on = h.breakpointNote ? ` Their note: ${h.breakpointNote}` : '';
  if (result.kind === 'stop') {
    return [
      BREAKPOINT_MARKER,
      `A person answered the breakpoint on ${codeSubject(h)}: stop. The edit was not made. Do not change ${codeSubject(h)}.${h.note ? ` Their answer: ${h.note}` : ''}`,
      'Tell the person what you will do instead.',
    ].join('\n');
  }
  return [
    BREAKPOINT_MARKER,
    `paused: waiting for a decision. A person set a breakpoint and wants to be asked before ${codeSubject(h)} changes.${on} The edit was not made.`,
    `Call the CodeTrellis await_decision tool with ref "${h.ref}", and call it again while it says it is still waiting (this can take a long time; do not work around it). ` +
      'If they answer continue, make the edit again.',
  ].join('\n');
}

/** What check_breakpoint returns, for the hook to act on. */
export function editView(result: CodeEnforcement): Record<string, unknown> {
  switch (result.kind) {
    case 'pass': return { status: 'pass' };
    case 'continue': return { status: 'continue', ref: result.hit.ref, steer: result.steer };
    case 'stop': return { status: 'stop', ref: result.hit.ref, message: heldEditText(result) };
    case 'paused': return { status: 'paused', ref: result.hit.ref, message: heldEditText(result) };
  }
}

