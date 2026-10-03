/**
 * One run at a time per key, and one more after it for everyone who asked
 * meanwhile. Pure: no timers, no I/O.
 *
 * For work whose answer must be as new as the request: a caller that asks
 * while a run is going may have just changed something that run already read
 * past, so it waits for the run after. Every caller in that window shares the
 * same next run, so a burst of N requests costs two runs, not N.
 */
export interface Coalesced<K, T> {
  /** Settles with a run that started after this call. */
  (key: K): Promise<T>;
  /** The run going now for `key`, if any; for a caller that changed nothing and can take it. */
  running(key: K): Promise<T> | null;
}

export function coalesced<K, T>(run: (key: K) => Promise<T>): Coalesced<K, T> {
  const state = new Map<K, { running: Promise<T> | null; next: Promise<T> | null }>();
  const call = (key: K): Promise<T> => {
    let s = state.get(key);
    if (!s) state.set(key, (s = { running: null, next: null }));
    const slot = s;
    if (!slot.running) {
      const started = (async () => run(key))();
      slot.running = started;
      // Cleared as it settles, before anyone queued after it starts the next.
      started.then(() => { if (slot.running === started) slot.running = null; }, () => { if (slot.running === started) slot.running = null; });
      return started;
    }
    slot.next ??= slot.running.then(() => undefined, () => undefined).then(() => {
      slot.next = null;
      return call(key);
    });
    return slot.next;
  };
  return Object.assign(call, { running: (key: K) => state.get(key)?.running ?? null });
}
