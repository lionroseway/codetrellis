/**
 * Mobile RPC client — sends JSON-RPC requests to the desktop over the
 * WebRTC control data channel and correlates responses by request ID.
 *
 * Usage:
 *   const plan = await rpc('plan.get', { uid: 'abc123' });
 *
 * Wire protocol (same envelope as desktop mobile-rpc-service):
 *   Request:  { method: string, params: object, id: string, rpc: true }
 *   Response: { result: object, id: string, rpc: true }
 *          or { error: string, id: string, rpc: true }
 */

import { webrtc } from './webrtc';
import { getRpcTimeoutMs } from './prefs';
import { log as diagLog } from './diagnostics';

// --- Types -------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// --- State -------------------------------------------------------------------

const pending = new Map<string, PendingRequest>();
let nextId = 1;

// The default timeout is user-configurable (Settings → Connection) and read
// fresh per call from prefs, so people on slow/VPN links can raise it without
// a new build. Generous by default (30s) so RPCs survive a higher-latency link
// — e.g. connecting over a VPN like Tailscale, where the WebRTC data path can
// be relayed and round-trips are far slower than on a LAN. Dead-peer detection
// doesn't rely on this (the connection liveness heartbeat handles that), so a
// longer ceiling only prevents false timeouts.

// --- Public API --------------------------------------------------------------

/**
 * Send an RPC request to the connected desktop and await the response.
 *
 * @param method  RPC method name (e.g. 'plan.get', 'terminal.write')
 * @param params  Parameters object
 * @param timeoutMs  Max time to wait for response (default 30s; generous so
 *                   RPCs survive a high-latency VPN/relayed link)
 * @returns The result from the desktop
 * @throws Error if the desktop returns an error, the request times out,
 *         or the control channel is not open
 */
export function rpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = getRpcTimeoutMs(),
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = `rpc-${nextId++}-${Date.now()}`;
    const envelope = { method, params, id, rpc: true };

    const armTimeoutAndPending = (): void => {
      const timer = setTimeout(() => {
        pending.delete(id);
        diagLog('rpc-error', `timeout ${method}`, { id, timeoutMs });
        reject(new Error(
          `Request timed out after ${Math.round(timeoutMs / 1000)}s (${method}). ` +
          `On a slow or VPN connection this can happen — increase the request ` +
          `timeout in Settings → Connection and try again.`,
        ));
      }, timeoutMs);
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
    };

    // Send the request on the control channel
    const sent = webrtc.sendControl(envelope);
    if (sent) {
      armTimeoutAndPending();
      return;
    }

    // Plan item 8.2 — auto-retry once on transport-not-open. The most
    // common cause of `sent === false` is a just-reconnected session
    // whose control data channel hasn't fully re-opened yet. A 500ms
    // beat is enough to clear that race in practice. We don't retry
    // *successful sends that later time out* — that's a different
    // failure mode and the mobile-side polling layers (e.g.
    // terminal-detail) already do their own retries.
    setTimeout(() => {
      if (webrtc.sendControl(envelope)) {
        armTimeoutAndPending();
        return;
      }
      reject(new Error('Control channel not open — cannot send RPC'));
    }, 500);
  });
}

/**
 * Handle an incoming control message that might be an RPC response.
 * Called by ConnectionManager.handleControlMessage().
 *
 * @returns true if the message was handled as an RPC response
 */
export function handleRpcResponse(data: string | ArrayBuffer): boolean {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const msg = JSON.parse(text);

    // Only handle messages with rpc marker and an id
    if (!msg.rpc || !msg.id) return false;

    const req = pending.get(msg.id);
    if (!req) return false; // No matching pending request (already timed out?)

    // Clean up
    clearTimeout(req.timer);
    pending.delete(msg.id);

    // Resolve or reject
    if (msg.error) {
      diagLog('rpc-error', `server error`, { id: msg.id, error: String(msg.error).slice(0, 200) });
      req.reject(new Error(msg.error));
    } else {
      req.resolve(msg.result);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Cancel all pending RPC requests (e.g. on disconnect).
 */
export function cancelAllPendingRpc(): void {
  for (const [, req] of pending) {
    clearTimeout(req.timer);
    req.reject(new Error('Connection lost — RPC cancelled'));
  }
  pending.clear();
}
