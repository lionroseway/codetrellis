import type { MonorepoConfig, FileTreeNode } from '../../shared/types';

export interface ScanResult {
  monorepoConfig: MonorepoConfig;
  fileTree: FileTreeNode[];
  fileCount: number;
  /**
   * Non-fatal: the AST/DB pass failed (corrupt DB, parser fault, scan
   * already in progress) but the file tree was still served. The UI keeps
   * the tree and surfaces this rather than blanking the explorer.
   */
  astError?: string | null;
  /** Set only on a hard, filesystem-level failure (bad/unreadable path). */
  error?: string;
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
