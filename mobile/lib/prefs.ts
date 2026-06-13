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
const TERMINAL_FONT_KEY = 'codetrellis_terminal_font_px';

/** Default request timeout — generous so RPCs survive a high-latency VPN link. */
export const RPC_TIMEOUT_DEFAULT_MS = 30_000;
/** Clamp bounds for the user-configurable timeout. */
export const RPC_TIMEOUT_MIN_MS = 5_000;
export const RPC_TIMEOUT_MAX_MS = 120_000;

/** Default terminal font size (px). Matches the in-bundle xterm default. */
export const TERMINAL_FONT_DEFAULT_PX = 12;
/** Clamp bounds — below 8 is unreadable, above 24 wastes screen on a phone. */
export const TERMINAL_FONT_MIN_PX = 8;
export const TERMINAL_FONT_MAX_PX = 24;

// In-memory cache (hydrated by initPrefs).
let rpcTimeoutMs = RPC_TIMEOUT_DEFAULT_MS;
let terminalFontPx = TERMINAL_FONT_DEFAULT_PX;

function clampTimeout(ms: number): number {
  if (!Number.isFinite(ms)) return RPC_TIMEOUT_DEFAULT_MS;
  return Math.min(RPC_TIMEOUT_MAX_MS, Math.max(RPC_TIMEOUT_MIN_MS, Math.round(ms)));
}

function clampFont(px: number): number {
  if (!Number.isFinite(px)) return TERMINAL_FONT_DEFAULT_PX;
  return Math.min(TERMINAL_FONT_MAX_PX, Math.max(TERMINAL_FONT_MIN_PX, Math.round(px)));
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
  try {
    const raw = await SecureStore.getItemAsync(TERMINAL_FONT_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) terminalFontPx = clampFont(n);
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

/** Plan item 10.5 — current terminal font size (px). */
export function getTerminalFontPx(): number {
  return terminalFontPx;
}

/** Plan item 10.5 — update + persist terminal font size. Clamps to bounds. */
export async function setTerminalFontPx(px: number): Promise<number> {
  terminalFontPx = clampFont(px);
  try {
    await SecureStore.setItemAsync(TERMINAL_FONT_KEY, String(terminalFontPx));
  } catch {
    /* best-effort */
  }
  return terminalFontPx;
}
