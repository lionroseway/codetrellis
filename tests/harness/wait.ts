/**
 * Polling helpers for harness assertions that depend on async
 * backend state (file watcher debounce, autosave timer, etc.).
 *
 * The pattern: each helper takes a predicate and re-checks it on a
 * short interval until it's true or the timeout fires. Errors thrown
 * by the predicate during early polls are swallowed (the resource
 * may not exist yet); only the final attempt's error surfaces.
 */

export interface WaitForOptions {
  /** Total time to wait before giving up. Default 5s. */
  timeoutMs?: number;
  /** Interval between checks. Default 100 ms. */
  intervalMs?: number;
  /** Description used in the error message. Default 'condition'. */
  description?: string;
}

/**
 * Repeatedly call `check()` until it returns truthy or the timeout
 * fires. The truthy value is returned; on timeout, throws with the
 * last error or a generic timeout message.
 */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined> | T | null | undefined,
  opts: WaitForOptions = {},
): Promise<T> {
  const { timeoutMs = 5000, intervalMs = 100, description = 'condition' } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result as T;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  if (lastError instanceof Error) {
    throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms — last error: ${lastError.message}`);
  }
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
