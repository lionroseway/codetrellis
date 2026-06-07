/**
 * Local (on-device) app preferences — client-side settings that live on the
 * phone, not the desktop. Persisted in SecureStore.
 *
 * Values are cached in memory so hot paths (e.g. the RPC timeout, read on every
 * request) can access them synchronously. Call `initPrefs()` once at app
 * startup to hydrate the cache from storage; until then, defaults apply.
 */

import * as SecureStore from 'expo-secure-store';

const RPC_TIMEOUT_KEY = 'codetrellis_rpc_timeout_ms';

/** Default request timeout — generous so RPCs survive a high-latency VPN link. */
export const RPC_TIMEOUT_DEFAULT_MS = 30_000;
/** Clamp bounds for the user-configurable timeout. */
export const RPC_TIMEOUT_MIN_MS = 5_000;
export const RPC_TIMEOUT_MAX_MS = 120_000;

// In-memory cache (hydrated by initPrefs).
let rpcTimeoutMs = RPC_TIMEOUT_DEFAULT_MS;

function clampTimeout(ms: number): number {
  if (!Number.isFinite(ms)) return RPC_TIMEOUT_DEFAULT_MS;
  return Math.min(RPC_TIMEOUT_MAX_MS, Math.max(RPC_TIMEOUT_MIN_MS, Math.round(ms)));
}

/** Hydrate cached prefs from storage. Safe to call once at app startup. */
export async function initPrefs(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(RPC_TIMEOUT_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) rpcTimeoutMs = clampTimeout(n);
    }
  } catch {
    /* keep default */
  }
}

/** Current RPC timeout (ms). Synchronous — reads the in-memory cache. */
export function getRpcTimeoutMs(): number {
  return rpcTimeoutMs;
}

/**
 * Update + persist the RPC timeout (ms). Clamps to [MIN, MAX] and returns the
 * value actually stored.
 */
export async function setRpcTimeoutMs(ms: number): Promise<number> {
  rpcTimeoutMs = clampTimeout(ms);
  try {
    await SecureStore.setItemAsync(RPC_TIMEOUT_KEY, String(rpcTimeoutMs));
  } catch {
    /* best-effort */
  }
  return rpcTimeoutMs;
}
