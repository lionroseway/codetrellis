import type { BridgeAPI } from './types';
import { httpBridge } from './http-bridge';

/**
 * Returns the bridge API.
 *
 * **One bridge for both modes** as of v0.1.2. The Electron renderer
 * has a `fetch` / `WebSocket` monkey-patch installed by
 * `lib/electron-ipc-shim.ts` that transparently routes `/api/...`
 * fetches and `new WebSocket(...)` constructions through IPC to the
 * in-process Express app. So this bridge can do `fetch('/api/...')`
 * everywhere — in dev / web mode it hits the dev backend over HTTP,
 * in Electron it goes through IPC.
 *
 * The only Electron-specific UX is the native open-folder dialog,
 * which `httpBridge.openProjectDialog` handles internally by checking
 * for `window.electronAPI?.openProjectDialog`.
 */
export function getAPI(): BridgeAPI {
  return httpBridge;
}

export type { BridgeAPI } from './types';
