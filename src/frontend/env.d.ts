/// <reference types="vite/client" />

/**
 * As of v0.1.2 the bulk of "Electron-vs-web" routing is handled by
 * the IPC shim (`lib/electron-ipc-shim.ts`) — fetch and WebSocket
 * are monkey-patched in Electron and routed through IPC, and the
 * bridge layer just calls `fetch('/api/...')` regardless of mode.
 * Only a couple of Electron-only surfaces remain on
 * `window.electronAPI` (native dialogs, log file reveal).
 */
interface ElectronAPI {
  /** Native open-folder dialog. */
  openProjectDialog: () => Promise<string | null>;
  /**
   * Phase 15 §15.D — generic file/folder picker for attachments.
   * Returns absolute paths array, or null on cancel.
   */
  openFilePicker: (options?: {
    multiSelect?: boolean;
    allowFolders?: boolean;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
    title?: string;
  }) => Promise<string[] | null>;
  /** Reveal the current day's log file in Finder / Explorer. */
  revealLogs: () => Promise<string>;
  revealUpdateDownload?: () => Promise<string | null>;
  /** Phase 31 §7.4 — reveal an attachment's file by uid; there is no "open". */
  revealArtefact?: (uid: string) => Promise<boolean>;
  /** Absolute path of the current day's log file. */
  getLogPath: () => Promise<string>;
}

declare global {
  interface Window {
    /**
     * Present only inside the Electron preload context. Most callers
     * shouldn't need to touch this directly — `getAPI()` from
     * `bridge/index.ts` and the IPC shim handle the common cases.
     */
    electronAPI?: ElectronAPI;
  }
}

export {};
