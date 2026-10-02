/**
 * The evolution view's clock (Phase 32 E3): where each side stood at a
 * moment, so two sides can scrub locked together in time.
 */

/** A position on one side: a commit with its time, or the working copy (now). */
export interface TimedPosition { at: number | null }

/** The time a position stands for: a working copy is now. */
export const timeOf = (p: TimedPosition | undefined, now: number): number => (p ? p.at ?? now : now);

/**
 * The position on a side (newest first) that stood at a time: the newest at
 * or before it, or the oldest when the side's history starts later.
 */
export function positionAt(positions: readonly TimedPosition[], at: number, now = Date.now()): number {
  const i = positions.findIndex((p) => timeOf(p, now) <= at);
  return i < 0 ? Math.max(positions.length - 1, 0) : i;
}
