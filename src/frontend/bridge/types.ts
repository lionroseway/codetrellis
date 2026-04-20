import type { MonorepoConfig, FileTreeNode } from '../../shared/types';

export interface ScanResult {
  monorepoConfig: MonorepoConfig;
  fileTree: FileTreeNode[];
  fileCount: number;
}

/**
 * Bridge API interface — implemented by both HTTP and Electron IPC bridges.
 * The frontend calls these methods without knowing the transport.
 */
export interface BridgeAPI {
  openProjectDialog: () => Promise<string | null>;
  scanProject: (projectPath: string) => Promise<ScanResult>;
  searchSymbols: (query: string) => Promise<unknown[]>;
  getMcpStatus: () => Promise<{ running: boolean; port: number; connectedAgents: number }>;

  // Event subscriptions (return unsubscribe function)
  onScanProgress: (callback: (progress: { phase: string; progress: number }) => void) => () => void;
  onAgentEvent: (callback: (event: unknown) => void) => () => void;
}
