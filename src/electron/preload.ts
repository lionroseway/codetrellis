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
   * Phase 31 §7.1 — a `ct-artefact:` URL's response, body as bytes. The
   * renderer's fetch cannot reach that scheme from its `file://` page.
   */
  artefact: (url: string): Promise<{ status: number; headers: Record<string, string>; body: ArrayBuffer }> =>
    ipcRenderer.invoke('codetrellis:artefact', url),

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
  /**
   * Phase 31 §7.4 — show an attachment's file in Finder / Explorer. Takes
   * the attachment uid, never a path; there is deliberately no "open".
   */
  revealArtefact: (uid: string): Promise<boolean> => ipcRenderer.invoke('artefacts:reveal', uid),
  /**
   * Phase 31 §13 — save a plan's sign-off pack as a PDF, by plan uid. The
   * main process asks where to save it.
   */
  exportSignoffPdf: (planUid: string): Promise<{ ok: boolean; path?: string; reason?: string }> =>
    ipcRenderer.invoke('signoff:export-pdf', planUid),
  /**
   * Phase 31 §7.3 — an HTML report in its own sandboxed view, laid over the
   * given rectangle of this window. By attachment uid; scripts off unless
   * asked. `hide` removes the view and clears its session.
   */
  /**
   * Phase 31 §6.1 — add the connector to Claude Desktop's config. `preview`
   * returns the diff and the hash of the file shown; `apply` writes only if
   * the file is still that one, keeping a backup.
   */
  claudeDesktop: {
    preview: (): Promise<unknown> => ipcRenderer.invoke('claude-desktop:preview'),
    apply: (shownHash: string): Promise<unknown> => ipcRenderer.invoke('claude-desktop:apply', shownHash),
  },
  htmlReport: {
    show: (uid: string, bounds: { x: number; y: number; width: number; height: number }, scripts: boolean): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('artefacts:html:show', uid, bounds, scripts),
    move: (bounds: { x: number; y: number; width: number; height: number }): Promise<boolean> =>
      ipcRenderer.invoke('artefacts:html:bounds', bounds),
    hide: (): Promise<boolean> => ipcRenderer.invoke('artefacts:html:hide'),
  },
};

contextBridge.exposeInMainWorld('codetrellisIpc', codetrellisIpc);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
