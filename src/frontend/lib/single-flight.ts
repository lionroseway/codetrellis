/**
 * A read that runs one at a time (Phase 32 HD4).
 *
 * The backend broadcasts `workstreams-changed`, `awareness-changed` and
 * `stack-changed` on every file change in any watched worktree, so a handler
 * that starts a read per event starts dozens in a burst. Unbounded, they held
 * the server and the browser's six connections long enough that a person's
 * own click waited behind them (E1's awareness store, E2b's source-control
 * store). Wrapped here, a call while the read runs does not start another:
 * it asks for one more, after, with the latest arguments, and its promise
 * settles when that one has.
 *
 * `src/frontend/burst-reads.test.ts` fails when a listener for one of those
 * events is not a function made here.
 */
export function singleFlight<A extends unknown[]>(read: (...args: A) => unknown): (...args: A) => Promise<void> {
  let running: Promise<void> | null = null;
  let again: A | null = null;
  return (...args: A): Promise<void> => {
    if (running) { again = args; return running; }
    running = (async () => {
      let next: A | null = args;
      while (next) {
        again = null;
        // A read says its own failure; the next one still runs.
        try { await read(...next); } catch { /* */ }
        next = again;
      }
    })().finally(() => { running = null; });
    return running;
  };
}
