/**
 * Phase 33 S1 — a burst of changes is handled once (design §6.1, principle 7).
 * Shared: the backend gathers a plan's file changes with it (S1), the window
 * its plan-imported broadcasts (S2).
 *
 * Things that arrive in a burst (a `git pull` touching 40 files of one plan)
 * are gathered per key and handed over together: once nothing new has
 * arrived for `quietMs`, or `maxWaitMs` after the burst's first item when it
 * keeps going, so a long burst is still handled at a steady pace rather than
 * never. Each key has its own burst; items within one are de-duplicated.
 *
 * Pure apart from the timers, which are injectable for tests.
 */

export interface BurstTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

const realTimers: BurstTimers = {
  set: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface Burst<K, T> {
  /** Add an item to `key`'s burst, starting one if none is open. */
  add(key: K, item: T): void;
  /** Hand over every open burst now (or just `key`'s). */
  flush(key?: K): void;
  /** Drop every open burst without handing anything over. */
  cancel(): void;
  /** Keys with a burst open. */
  pending(): K[];
}

export function burst<K, T>(
  onFlush: (key: K, items: T[]) => void,
  opts: { quietMs: number; maxWaitMs: number; timers?: BurstTimers },
): Burst<K, T> {
  const timers = opts.timers ?? realTimers;
  const open = new Map<K, { items: Set<T>; firstAt: number; handle: unknown }>();

  const fire = (key: K): void => {
    const b = open.get(key);
    if (!b) return;
    timers.clear(b.handle);
    open.delete(key);
    onFlush(key, [...b.items]);
  };

  const arm = (key: K): void => {
    const b = open.get(key)!;
    timers.clear(b.handle);
    const untilQuiet = opts.quietMs;
    const untilMax = Math.max(0, b.firstAt + opts.maxWaitMs - timers.now());
    b.handle = timers.set(() => fire(key), Math.min(untilQuiet, untilMax));
  };

  return {
    add(key, item) {
      let b = open.get(key);
      if (!b) open.set(key, (b = { items: new Set(), firstAt: timers.now(), handle: null }));
      b.items.add(item);
      arm(key);
    },
    flush(key) {
      for (const k of key === undefined ? [...open.keys()] : [key]) fire(k);
    },
    cancel() {
      for (const b of open.values()) timers.clear(b.handle);
      open.clear();
    },
    pending: () => [...open.keys()],
  };
}
