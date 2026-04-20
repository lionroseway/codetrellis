/// <reference types="vite/client" />

interface ElectronAPI {
  openProjectDialog: () => Promise<string | null>;
  scanProject: (projectPath: string) => Promise<unknown>;
  searchSymbols: (query: string) => Promise<unknown[]>;
  getMcpStatus: () => Promise<{ running: boolean; port: number; connectedAgents: number }>;
  onScanProgress: (callback: (progress: { phase: string; progress: number }) => void) => () => void;
  onAgentEvent: (callback: (event: unknown) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
