/**
 * Diagnostics ring buffer — Session-persistence plan items 9.2 + 10.7.
 *
 * A bounded in-memory log of recent lifecycle / network / RPC / touch
 * events. When a user reports something like "the terminal went blank"
 * or "the scroll stuck," we attach the last N events so the cause is
 * grep-able instead of guesswork.
 *
 * Two sources today:
 *   - `log('lifecycle' | 'netinfo' | 'rpc-error', text, data?)` from
 *     ConnectionManager + rpc layer (9.2)
 *   - `logTouch(...)` from the xterm WebView bridge (10.7)
 *
 * The buffer is in-memory only — survives screen changes, dies on app
 * relaunch. That's fine for "last 60s before X happened" repro.
 */

export type DiagnosticsKind =
  | 'lifecycle'   // AppState change, screen mount/unmount
  | 'netinfo'     // network type / reachability transition
  | 'connection'  // WebRTC state change
  | 'rpc-error'   // RPC call failure
  | 'touch'       // WebView touch event (from xterm-bundle)
  | 'note';       // free-form, useful for ad-hoc tracing

export interface DiagnosticsEntry {
  /** ms since epoch. */
  ts: number;
  kind: DiagnosticsKind;
  /** Short human-readable description. */
  text: string;
  /** Optional structured payload (kept small — JSON.stringify-friendly). */
  data?: Record<string, unknown>;
}

/** Buffer cap — ~10 seconds at busy touch rates, or many minutes for slower
 *  event classes. Tradeoff: bigger = better post-mortem context but more
 *  retained-string memory. 500 covers most bug-report timelines. */
const RING_CAP = 500;

const ring: DiagnosticsEntry[] = [];

function push(entry: DiagnosticsEntry): void {
  ring.push(entry);
  if (ring.length > RING_CAP) ring.shift();
}

/** Append a single diagnostic event. */
export function log(kind: DiagnosticsKind, text: string, data?: Record<string, unknown>): void {
  push({ ts: Date.now(), kind, text, data });
}

/** Append a touch event (kept separate so the call site is obvious + cheap). */
export function logTouch(text: string, data?: Record<string, unknown>): void {
  push({ ts: Date.now(), kind: 'touch', text, data });
}

/** Read a copy of the buffer. Used by bug-report attach + on-device viewer. */
export function snapshot(): DiagnosticsEntry[] {
  return ring.slice();
}

/** Filter by kind(s) — convenience for the on-device viewer. */
export function snapshotWhere(kinds: DiagnosticsKind[]): DiagnosticsEntry[] {
  const set = new Set(kinds);
  return ring.filter((e) => set.has(e.kind));
}

/** Format the buffer as text — for sharing via clipboard or attaching to a
 *  bug report. Newest events at the bottom (chronological). */
export function format(): string {
  return ring.map((e) => {
    const t = new Date(e.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
    const d = e.data ? ' ' + JSON.stringify(e.data) : '';
    return `${t} [${e.kind}] ${e.text}${d}`;
  }).join('\n');
}

/** Test / reset helper. */
export function _reset(): void {
  ring.length = 0;
}

/**
 * Plan 11.2 — ship the current ring to the desktop logger via the
 * `diagnostics.flush` RPC. Each entry lands in the desktop's daily
 * rotated log file (logger.ts captures all console.log calls), tagged
 * `[mobile:<fp>] [<isoTs>] [Lifecycle][<kind>] <text> <data>` so a
 * single grep on the desktop log shows the cross-side narrative.
 *
 * Returns the number of entries the desktop accepted, or 0 on RPC
 * failure. Does NOT clear the local ring on success — keeping the
 * recent buffer around lets a second flush call (or an on-device
 * viewer) see the same window. If the buffer grows past the cap,
 * older entries fall off via the existing ring-buffer eviction.
 */
export async function flushDiagnosticsToDesktop(): Promise<number> {
  // Lazy require to avoid a circular import: rpc.ts → diagnostics.ts
  // for its own error logging.
  const { rpc } = await import('./rpc');
  const entries = snapshot();
  if (entries.length === 0) return 0;
  try {
    const r = await rpc<{ wrote: number }>('diagnostics.flush', { entries });
    return r?.wrote ?? 0;
  } catch {
    return 0;
  }
}
