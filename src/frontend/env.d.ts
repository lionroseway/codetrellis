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
  /** Phase 31 §13 — save a plan's sign-off pack as a PDF (desktop only). */
  exportSignoffPdf?: (planUid: string) => Promise<{ ok: boolean; path?: string; reason?: string }>;
  /** Phase 31 §6.1 — add the connector to Claude Desktop's config (desktop only). */
  claudeDesktop?: {
    preview: () => Promise<ClaudeDesktopPreview>;
    apply: (shownHash: string) => Promise<ClaudeDesktopApplied>;
  };
  /** Phase 31 §7.3 — an HTML report in its own sandboxed view (desktop only). */
  htmlReport?: {
    show: (uid: string, bounds: { x: number; y: number; width: number; height: number }, scripts: boolean) => Promise<{ ok: boolean; reason?: string }>;
    move: (bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
    hide: () => Promise<boolean>;
  };
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

type ClaudeDesktopDiffLine = { op: ' ' | '+' | '-'; text: string };
type ClaudeDesktopPreview =
  | { ok: true; path: string; status: 'add' | 'update' | 'unchanged'; diff: ClaudeDesktopDiffLine[]; beforeHash: string; exists: boolean }
  | { ok: false; reason: string };
type ClaudeDesktopApplied =
  | { ok: true; path: string; backupPath: string | null; status: 'add' | 'update' | 'unchanged' }
  | { ok: false; reason: string; changed?: boolean };
