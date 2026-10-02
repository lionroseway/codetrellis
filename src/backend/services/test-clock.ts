/**
 * A test's clock, moved forward (Phase 32 B10.5).
 *
 * The G2 done-when happens months later: a reviewer replays the week a
 * change was built, long after. The harness cannot wait months, so a
 * backend started with `CODETRELLIS_CLOCK_OFFSET_MS` runs that far ahead:
 * `Date.now()` and `new Date()` both read the moved clock, so everything it
 * stamps, prunes or compares is as it would be then. Unset, nothing changes.
 *
 * Test-only, like the harness's other knobs: nothing in the app sets it.
 * Imported first in `server.ts`, before anything reads the time.
 */

export function clockOffsetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODETRELLIS_CLOCK_OFFSET_MS;
  if (!raw || !/^-?\d+$/.test(raw)) return 0;
  return Number(raw);
}

/** Move this process's clock by `offset` milliseconds. Returns a function that puts it back. */
export function moveClock(offset: number): () => void {
  if (!offset) return () => {};
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  class MovedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(realNow() + offset);
      else super(...(args as [string | number | Date]));
    }
    static now(): number { return realNow() + offset; }
  }
  globalThis.Date = MovedDate as DateConstructor;
  return () => { globalThis.Date = RealDate; };
}

moveClock(clockOffsetMs());
