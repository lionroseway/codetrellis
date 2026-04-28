/**
 * Time abstraction so the E2E harness can control "now" in tests.
 *
 * Production: `now()` returns `Date.now()` and `nowIso()` returns
 * `new Date().toISOString()` — identical to the calls they replace.
 *
 * Tests: the harness can swap in a fake clock that ticks 1000 ms per
 * call (see `tests/harness/clock.ts`) so timestamps are
 * deterministic and `created_at` / `updated_at` ordering can be
 * asserted without flakiness.
 *
 * **Migration policy.** Don't bulk-replace every `Date.now()` site at
 * once — that's a high-risk codemod. Route new code through this
 * module, and migrate existing call-sites opportunistically when
 * they show up in tests that need deterministic time. The default
 * implementation is byte-identical to `Date.now()`, so a partial
 * migration is safe.
 */

let _now: () => number = () => Date.now();

/**
 * Current epoch ms. Use this in place of `Date.now()` anywhere a
 * test might want to assert ordering, freshness, or "before/after"
 * relationships on the value.
 */
export function now(): number {
  return _now();
}

/** Current time as ISO 8601. Equivalent to `new Date(now()).toISOString()`. */
export function nowIso(): string {
  return new Date(_now()).toISOString();
}

/**
 * Replace the clock — only for tests. Pass a function that returns
 * the next epoch ms each time it's called. Calling without args
 * resets to the real wall clock.
 */
export function _setClockForTesting(fn?: () => number): void {
  _now = fn ?? (() => Date.now());
}

/**
 * Convenience: a controllable clock that starts at `start` and
 * advances by `tickMs` on every read. Returns `{ tick, reset, set }`
 * for finer control. Used by the harness's per-test setup.
 */
export interface ControllableClock {
  /** Advance the clock by `tickMs` (default 1000) and return the new value. */
  tick(ms?: number): number;
  /** Set the clock to an exact epoch ms. */
  set(epochMs: number): void;
  /** Read the current value without advancing. */
  read(): number;
}

export function createControllableClock(start = Date.UTC(2026, 0, 1)): ControllableClock {
  let value = start;
  return {
    tick(ms = 1000) {
      value += ms;
      return value;
    },
    set(epochMs: number) {
      value = epochMs;
    },
    read() {
      return value;
    },
  };
}
