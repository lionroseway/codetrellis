/**
 * Breakpoints on the phone (Phase 32 B4.4) — the calls, and their shapes.
 *
 * Mirrors `src/backend/services/mobile-breakpoints.ts` on the desktop. The
 * words (`headline`, `why`, the three answers) are the desktop's own, so a
 * held call reads the same on both. An answer given here is the person's,
 * only for a pairing confirmed on the desktop; the desktop enforces that and
 * says so in the error when it refuses. The first answer stands, wherever
 * it was given.
 */

import { rpc } from './rpc';

export type BreakpointDecision = 'continue' | 'steer' | 'stop';

export interface PhoneHit {
  ref: string;
  /** It happened and could not be stopped; the agent was told to stop and wait. */
  breach: boolean;
  headline: string;
  why: string;
  labels: Record<BreakpointDecision, string>;
  /** The person's own note on the breakpoint, when they left one. */
  breakpointNote: string | null;
  agent: string | null;
  planUid: string | null;
  itemUid: string | null;
  path: string | null;
  hitAt: number;
  decision: BreakpointDecision | null;
  note: string | null;
  answeredAt: number | null;
}

/** What is held for the person, oldest first. */
export async function listWaitingBreakpoints(): Promise<PhoneHit[]> {
  const { hits } = await rpc<{ hits: PhoneHit[] }>('breakpoint.waiting', {});
  return Array.isArray(hits) ? hits : [];
}

/**
 * Answer a held call. `alreadyAnswered` means someone answered first; `hit`
 * then carries the answer that stood.
 */
export function answerBreakpoint(
  ref: string,
  decision: BreakpointDecision,
  note?: string,
): Promise<{ hit: PhoneHit; alreadyAnswered?: true }> {
  return rpc('breakpoint.answer', { ref, decision, ...(note ? { note } : {}) });
}

/** "4 min", "2 h": how long it has been held. */
export function heldFor(hitAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - hitAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}
