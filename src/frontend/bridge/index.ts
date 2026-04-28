import type { BridgeAPI } from './types';
import { httpBridge } from './http-bridge';
import { electronBridge } from './electron-bridge';

function isElectron(): boolean {
  // Preload exposes `window.electronAPI` via contextBridge. Its
  // presence is the runtime signal that we're in an Electron
  // renderer (vs a regular browser tab in dev mode).
  return typeof window !== 'undefined' && 'electronAPI' in window;
}

let _api: BridgeAPI | null = null;

/**
 * Returns the bridge API — Electron IPC if running in Electron,
 * HTTP/WebSocket if running in a browser. Both bridges are
 * statically imported (and so always bundled) — the previous
 * `require('./electron-bridge')` at runtime worked in dev but
 * broke in the packaged renderer (Vite's renderer bundle has no
 * `require`, so the call threw and `getAPI()` returned never;
 * "Open Project" fell through silently).
 */
export function getAPI(): BridgeAPI {
  if (_api) return _api;
  _api = isElectron() ? electronBridge : httpBridge;
  return _api;
}

export type { BridgeAPI } from './types';
