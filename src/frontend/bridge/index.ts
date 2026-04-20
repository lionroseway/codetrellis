import type { BridgeAPI } from './types';
import { httpBridge } from './http-bridge';

function isElectron(): boolean {
  return typeof window !== 'undefined' && 'electronAPI' in window;
}

let _api: BridgeAPI | null = null;

/**
 * Returns the bridge API — Electron IPC if running in Electron,
 * HTTP/WebSocket if running in a browser.
 */
export function getAPI(): BridgeAPI {
  if (_api) return _api;

  if (isElectron()) {
    // Dynamic import to avoid bundling electron-bridge in web mode
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { electronBridge } = require('./electron-bridge');
    _api = electronBridge;
  } else {
    _api = httpBridge;
  }

  return _api;
}

export type { BridgeAPI } from './types';
