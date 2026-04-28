import { contextBridge, ipcRenderer } from 'electron';

const api = {
  openProjectDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-project'),

  scanProject: (projectPath: string) =>
    ipcRenderer.invoke('project:scan', projectPath),

  searchSymbols: (query: string) =>
    ipcRenderer.invoke('db:search-symbols', query),

  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),

  onScanProgress: (callback: (progress: { phase: string; progress: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { phase: string; progress: number }) => callback(data);
    ipcRenderer.on('project:scan-progress', handler);
    return () => ipcRenderer.removeListener('project:scan-progress', handler);
  },

  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  },

  // Reveal the current day's log file in Finder / Explorer.
  // Resolves to the file path that was revealed (string).
  revealLogs: (): Promise<string> => ipcRenderer.invoke('logs:reveal'),
  getLogPath: (): Promise<string> => ipcRenderer.invoke('logs:get-path'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
