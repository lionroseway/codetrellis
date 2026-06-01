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

// --- Types -------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// --- State -------------------------------------------------------------------

const pending = new Map<string, PendingRequest>();
let nextId = 1;

const DEFAULT_TIMEOUT_MS = 15_000;

// --- Public API --------------------------------------------------------------

/**
 * Send an RPC request to the connected desktop and await the response.
 *
 * @param method  RPC method name (e.g. 'plan.get', 'terminal.write')
 * @param params  Parameters object
 * @param timeoutMs  Max time to wait for response (default 15s)
 * @returns The result from the desktop
 * @throws Error if the desktop returns an error, the request times out,
 *         or the control channel is not open
 */
export function rpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = `rpc-${nextId++}-${Date.now()}`;

    // Send the request on the control channel
    const sent = webrtc.sendControl({
      method,
      params,
      id,
      rpc: true,
    });

    if (!sent) {
      reject(new Error('Control channel not open — cannot send RPC'));
      return;
    }

    // Set up timeout
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
    }, timeoutMs);

    // Store the pending request
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });
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
  for (const [id, req] of pending) {
    clearTimeout(req.timer);
    req.reject(new Error('Connection lost — RPC cancelled'));
  }
  pending.clear();
}
