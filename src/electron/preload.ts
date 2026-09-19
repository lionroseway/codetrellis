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

  // --- Terminal IPC (bidirectional) ---

  /** Send data (keyboard input / resize) to a terminal PTY. */
  terminalSend: (termId: string, data: { type: string; [key: string]: unknown }): void => {
    ipcRenderer.send('codetrellis:terminal-send', termId, data);
  },

  /** Subscribe to output from a specific terminal. Returns unsubscribe fn. */
  onTerminalData: (
    termId: string,
    callback: (msg: { type: string; data?: string; code?: number }) => void,
  ): (() => void) => {
    const channel = `codetrellis:terminal-data:${termId}`;
    const handler = (_e: Electron.IpcRendererEvent, msg: { type: string; data?: string; code?: number }) => callback(msg);
    ipcRenderer.on(channel, handler);
    ipcRenderer.send('codetrellis:terminal-connect', termId);
    return () => {
      ipcRenderer.removeListener(channel, handler);
      ipcRenderer.send('codetrellis:terminal-disconnect', termId);
    };
  },
};

/**
 * Phase 15 §15.D — native file picker. Multi-select + folders +
 * file-type filters. Returns absolute paths or null on cancel.
 */
interface OpenFilePickerOptions {
  /** Allow picking multiple files / folders. */
  multiSelect?: boolean;
  /** Allow picking directories alongside files. */
  allowFolders?: boolean;
  /** File-type filters (Electron `dialog.showOpenDialog` shape). */
  filters?: Array<{ name: string; extensions: string[] }>;
  /** Default starting path. */
  defaultPath?: string;
  /** Dialog window title. */
  title?: string;
}

const electronAPI = {
  openProjectDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-project'),

  /** Phase 15 §15.D — generic file/folder picker for attachments. */
  openFilePicker: (options?: OpenFilePickerOptions): Promise<string[] | null> =>
    ipcRenderer.invoke('dialog:open-files', options ?? {}),

  // Reveal the current day's log file in Finder / Explorer.
  revealLogs: (): Promise<string> => ipcRenderer.invoke('logs:reveal'),
  /**
   * Reveal a verified update download. Takes no path — the main process
   * reads it from the download service's state, so this cannot be used
   * to reveal an arbitrary file. Resolves null when nothing is ready.
   */
  revealUpdateDownload: (): Promise<string | null> => ipcRenderer.invoke('updates:reveal'),
  getLogPath: (): Promise<string> => ipcRenderer.invoke('logs:get-path'),
};

contextBridge.exposeInMainWorld('codetrellisIpc', codetrellisIpc);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
