import type { BridgeAPI } from './types';

/**
 * Electron IPC bridge — delegates to window.electronAPI
 * exposed by the preload script.
 */
export const electronBridge: BridgeAPI = {
  openProjectDialog: () => window.electronAPI.openProjectDialog(),
  scanProject: (path) => window.electronAPI.scanProject(path),
  searchSymbols: (query) => window.electronAPI.searchSymbols(query),
  getMcpStatus: () => window.electronAPI.getMcpStatus(),
  onScanProgress: (cb) => window.electronAPI.onScanProgress(cb),
  onAgentEvent: (cb) => window.electronAPI.onAgentEvent(cb),
};
