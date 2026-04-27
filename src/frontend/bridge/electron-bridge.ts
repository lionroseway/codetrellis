import type { BridgeAPI } from './types';

/**
 * Electron IPC bridge — delegates to `window.electronAPI` exposed by
 * the preload script. Only constructed when `isElectron()` is true
 * (see `./index.ts`), so `window.electronAPI` is guaranteed defined
 * at call time. The `!` assertions exist purely for the typechecker.
 */
export const electronBridge: BridgeAPI = {
  openProjectDialog: () => window.electronAPI!.openProjectDialog(),
  scanProject: (path) => window.electronAPI!.scanProject(path),
  searchSymbols: (query) => window.electronAPI!.searchSymbols(query),
  getMcpStatus: () => window.electronAPI!.getMcpStatus(),
  onScanProgress: (cb) => window.electronAPI!.onScanProgress(cb),
  onAgentEvent: (cb) => window.electronAPI!.onAgentEvent(cb),
};
