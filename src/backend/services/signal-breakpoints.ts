/**
 * Phase 32 B4.2b — signal breakpoints: a project rule that makes a serious
 * signal a breakpoint (observability doc §10.1, "On a signal").
 *
 * A person sets a rule on a kind of signal ("ask me when there is a contract
 * change"). While a **high** signal of that kind is **open** (the person has
 * not acknowledged, marked intended or dismissed it in Awareness) and names a
 * workstream, the agents in that workstream are held at their next call that
 * changes work: a claim, marking done, a spec edit or deletion (B4.1's
 * guarded calls) and, with the Claude Code hook, a file edit (B4.2).
 *
 *  - The hold is one hit per signal and workstream; asking again is the
 *    same wait. The agent waits with `await_decision`.
 *  - Continue releases that workstream from that signal (a steer told
 *    once); stop keeps refusing its guarded calls while the signal is open.
 *  - When the person answers the signal itself in Awareness, it is no
 *    longer open: nothing more is held, and a call still waiting on it is
 *    let through ("the signal was answered in Awareness").
 *
 * The rule lives in the database with the other breakpoints, never in
 * `.codetrellis/config.json`: that file is committed and agents can edit it,
 * so an agent could switch the person's rule off.
 */

import { randomBytes } from 'node:crypto';
import { getDb } from './database';
import { recordBreakpointEvent } from './agent-event-log';
import { getActiveSessions } from './session-service';
import { listSignals } from './awareness-service';
import {
  ACTIVE_SELECT, HIT_SELECT, rowsOf, toBreakpointRow, toHitRow, getHit, hitPayload, answerHit, guardedCall,
  type Breakpoint, type BreakpointHit, type BreakpointAction,
} from './breakpoint-service';
import type { AwarenessSignal } from '../../shared/types';
import { pushForBreakpoint } from './push-notification-service';

export type SignalEnforcement =
  | { kind: 'pass' }
  | { kind: 'continue'; hit: BreakpointHit; steer: string | null }
  | { kind: 'stop'; hit: BreakpointHit; signal: AwarenessSignal | null }
  | { kind: 'paused'; hit: BreakpointHit; signal: AwarenessSignal; fresh: boolean };

/** What the held call would have done, and to what. */
export interface Attempt {
  tool: string;
  action: BreakpointAction;
  itemUid?: string;
  path?: string;
}

/** Signal rules still set in this project, oldest first. */
export function signalRules(projectRoot: string): Breakpoint[] {
  return rowsOf(`${ACTIVE_SELECT} AND b.kind = 'signal' AND b.project_root = ? ORDER BY b.created_at`, [projectRoot]).map(toBreakpointRow);
}

/** The signals a rule applies to now: high, open, of its kind. */
function holding(signals: readonly AwarenessSignal[], rule: Breakpoint): AwarenessSignal[] {
  return signals.filter((s) => s.kind === rule.target && s.severity === 'high' && s.state === 'open');
}

/**
 * Let through any call still waiting on a signal that is no longer open: the
 * person answered it in Awareness, or its cause went away.
 */
export function releaseSettled(projectRoot: string, signals: readonly AwarenessSignal[] = listSignals(projectRoot), now = Date.now()): BreakpointHit[] {
  const open = new Set(signals.filter((s) => s.severity === 'high' && s.state === 'open').map((s) => s.id));
  const waiting = rowsOf(
    `${HIT_SELECT} WHERE b.kind = 'signal' AND b.project_root = ? AND h.answered_at IS NULL AND h.signal_id IS NOT NULL`,
    [projectRoot],
  ).map(toHitRow);
  const released: BreakpointHit[] = [];
  for (const hit of waiting) {
    if (hit.signalId && open.has(hit.signalId)) continue;
    const r = answerHit({ ref: hit.ref, decision: 'continue', note: 'The signal was answered in Awareness.', by: 'CodeTrellis', byType: 'system', now });
    if (r) released.push(r);
  }
  return released;
}

/**
 * Whether a call from this workstream may act, as far as signal rules go.
 * Anything unexpected lets it through: a rule that cannot be read is not
 * one that was set.
 */
export function enforceSignals(
  projectRoot: string | null,
  caller: { agent: string; sessionId: string | null; workstreamRoot: string | null },
  attempt: Attempt,
  now = Date.now(),
  signalsOf: (root: string, workstream: string) => AwarenessSignal[] = (root, ws) => listSignals(root, { workstream: ws }),
): SignalEnforcement {
  if (!projectRoot || !caller.workstreamRoot) return { kind: 'pass' };
  let continued: { hit: BreakpointHit; steer: string | null } | null = null;
  try {
    const rules = signalRules(projectRoot);
    if (!rules.length) return { kind: 'pass' };
    const mine = signalsOf(projectRoot, caller.workstreamRoot);
    for (const rule of rules) {
      for (const signal of holding(mine, rule)) {
        const latest = rowsOf(
          `${HIT_SELECT} WHERE h.breakpoint_id = ? AND h.signal_id = ? AND h.workstream_root = ? ORDER BY h.hit_at DESC LIMIT 1`,
          [rule.id, signal.id, caller.workstreamRoot],
        ).map(toHitRow)[0];
        if (!latest) {
          const ref = `bp-${randomBytes(5).toString('hex')}`;
          getDb().run(
            `INSERT INTO breakpoint_hits (ref, breakpoint_id, tool, action, item_uid, path, breach, signal_id, agent, session_id, workstream_root, hit_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
            [ref, rule.id, attempt.tool, attempt.action, attempt.itemUid ?? '', attempt.path ?? null, signal.id,
              caller.agent, caller.sessionId, caller.workstreamRoot, now],
          );
          const hit = getHit(ref)!;
          recordBreakpointEvent('breakpoint_hit', {
            ...hitPayload(hit), breakpointId: rule.id, signalKind: signal.kind, signalSummary: signal.summary.slice(0, 300),
          }, caller.agent);
          void pushForBreakpoint(hit).catch(() => {}); // a person away from the desk is told (B4.4)
          return { kind: 'paused', hit, signal, fresh: true };
        }
        if (latest.answeredAt === null) return { kind: 'paused', hit: latest, signal, fresh: false };
        if (latest.decision === 'stop') return { kind: 'stop', hit: latest, signal };
        const untold = rowsOf<{ consumed_at: number | null }>('SELECT consumed_at FROM breakpoint_hits WHERE ref = ?', [latest.ref])[0]?.consumed_at === null;
        if (untold) getDb().run('UPDATE breakpoint_hits SET consumed_at = ? WHERE ref = ?', [now, latest.ref]);
        continued = { hit: latest, steer: untold ? latest.note : null };
      }
    }
  } catch {
    return { kind: 'pass' };
  }
  return continued ? { kind: 'continue', ...continued } : { kind: 'pass' };
}

/** The attempt an MCP tool call makes, when it is one a breakpoint can hold. */
export function attemptOf(tool: string, args: unknown): Attempt | null {
  const call = guardedCall(tool, args);
  if (!call) return null;
  return { tool, action: call.actions[0].action, itemUid: call.itemUid };
}

/** Enforce signal rules for an MCP session's call. */
export function enforceSignalsForSession(projectRoot: string | null, sessionId: string, attempt: Attempt, now = Date.now()): SignalEnforcement {
  if (!projectRoot) return { kind: 'pass' };
  const session = getActiveSessions().find((s) => s.sessionId === sessionId);
  if (!session?.workstreamRoot) return { kind: 'pass' };
  try { releaseSettled(projectRoot); } catch { /* never breaks the call */ }
  return enforceSignals(projectRoot, { agent: session.agentType ?? 'mcp-agent', sessionId, workstreamRoot: session.workstreamRoot }, attempt, now);
}

export const SIGNAL_MARKER = '── CodeTrellis breakpoint ──';

/** What a call held by a signal rule is told instead of acting. */
export function signalHeldText(result: SignalEnforcement & { kind: 'paused' | 'stop' }): string {
  const h = result.hit;
  const about = result.signal ? `a serious ${result.signal.kind} signal: ${result.signal.summary}` : 'a serious signal';
  const rule = h.breakpointNote ? ` Their note on the rule: ${h.breakpointNote}` : '';
  if (result.kind === 'stop') {
    return [
      SIGNAL_MARKER,
      `A person answered the breakpoint on ${about} — stop. Nothing was done.${h.note ? ` Their answer: ${h.note}` : ''}`,
      'Do not go on with work this signal touches while it is open. Tell the person what you will do instead.',
    ].join('\n');
  }
  return [
    SIGNAL_MARKER,
    `paused: waiting for a decision. Your workstream is named in ${about}. A person asked to be asked before work goes on while a signal like this is open.${rule} Nothing was done.`,
    `Call await_decision with ref "${h.ref}", calling it again while it says it is still waiting (this can take a long time; do not work around it). If they answer continue, make the same call again.`,
  ].join('\n');
}

/** An MCP tool result for a held call. */
export function signalHeldResult(result: SignalEnforcement & { kind: 'paused' | 'stop' }): { content: Array<{ type: 'text'; text: string }>; _meta: { summary: string } } {
  const body = {
    ...(result.kind === 'paused' ? { paused: true, status: 'paused: waiting for a decision' } : { stopped: true }),
    ref: result.hit.ref,
    signal: result.signal ? { kind: result.signal.kind, summary: result.signal.summary } : null,
    message: signalHeldText(result),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    _meta: { summary: result.kind === 'paused' ? `Paused at a breakpoint on a serious ${result.signal?.kind ?? ''} signal`.replace('  ', ' ') : 'Stopped at a signal breakpoint' },
  };
}

/** The line added to a call a continue answer let through, when the person left a steer. */
export function signalSteerText(hit: BreakpointHit): string | null {
  return hit.note ? `A person answered the signal breakpoint (${hit.ref}): continue, with this steer: ${hit.note}` : null;
}
