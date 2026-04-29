import { contextBridge, ipcRenderer } from 'electron';

// =============================================================
// Public renderer API — bridge between renderer (sandboxed) and
// main process. Two surfaces:
//
//   1. `window.codetrellisIpc` — the catch-all backend bridge.
//      Replaces the old "fetch over TCP" path with an IPC channel.
//      Used by the frontend's `electron-ipc-shim.ts` to monkey-
//      patch fetch() and WebSocket so the rest of the app sees no
//      change. This is the path that eliminates the backend's
//      TCP port entirely.
//
//   2. `window.electronAPI` — Electron-specific surfaces that
//      can't be served by the backend (native dialogs, file-system
//      reveal). Same shape it had before.
// =============================================================

interface IpcRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}

interface IpcResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface BroadcastMessage {
  type: string;
  payload: unknown;
}

const codetrellisIpc = {
  /**
   * Dispatch an HTTP-shaped request through the in-process Express
   * app via IPC. The shim layer in the renderer rewrites `fetch()`
   * calls to land here.
   */
  api: (req: IpcRequest): Promise<IpcResponse> =>
    ipcRenderer.invoke('codetrellis:api', req),

  /**
   * Subscribe to backend broadcast events (the equivalent of
   * receiving a WebSocket message). Returns an unsubscribe fn.
   */
  onWsEvent: (callback: (msg: BroadcastMessage) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: BroadcastMessage) => callback(msg);
    ipcRenderer.on('codetrellis:ws-event', handler);
    return () => ipcRenderer.removeListener('codetrellis:ws-event', handler);
  },
};

const electronAPI = {
  openProjectDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-project'),

  // Reveal the current day's log file in Finder / Explorer.
  revealLogs: (): Promise<string> => ipcRenderer.invoke('logs:reveal'),
  getLogPath: (): Promise<string> => ipcRenderer.invoke('logs:get-path'),
};

contextBridge.exposeInMainWorld('codetrellisIpc', codetrellisIpc);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
