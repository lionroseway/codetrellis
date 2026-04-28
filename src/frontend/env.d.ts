/// <reference types="vite/client" />

import type { ScanResult } from './bridge/types';

interface ElectronAPI {
  openProjectDialog: () => Promise<string | null>;
  scanProject: (projectPath: string) => Promise<ScanResult>;
  searchSymbols: (query: string) => Promise<unknown[]>;
  getMcpStatus: () => Promise<{ running: boolean; port: number; connectedAgents: number }>;
  onScanProgress: (callback: (progress: { phase: string; progress: number }) => void) => () => void;
  onAgentEvent: (callback: (event: unknown) => void) => () => void;
  /** Reveal the current day's log file in Finder / Explorer. */
  revealLogs: () => Promise<string>;
  /** Returns the absolute path of the current day's log file. */
  getLogPath: () => Promise<string>;
}

declare global {
  interface Window {
    /**
     * Present only when running inside the Electron preload context.
     * Use `isElectron()` from `bridge/index.ts` to gate access.
     */
    electronAPI?: ElectronAPI;
  }
}

export {};
