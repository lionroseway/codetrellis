import { create } from 'zustand';
import type { MonorepoConfig, ScanStatus, FileTreeNode } from '@shared/types';

export interface ProjectTab {
  id: string;
  root: string;
  name: string;
  branch: string | null;
  monorepoConfig: MonorepoConfig | null;
  fileTree: FileTreeNode[];
  scanStatus: ScanStatus;
  error: string | null;
}

interface ProjectState {
  tabs: ProjectTab[];
  activeTabId: string | null;

  // Computed — the active tab's data (convenience getters used by existing components)
  root: string | null;
  monorepoConfig: MonorepoConfig | null;
  fileTree: FileTreeNode[];
  scanStatus: ScanStatus;
  scanProgress: number;
  error: string | null;

  // Tab management
  addTab: (root: string, branch?: string | null) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  // Active tab mutations (called by existing code)
  setRoot: (path: string) => void;
  setMonorepoConfig: (config: MonorepoConfig) => void;
  setFileTree: (tree: FileTreeNode[]) => void;
  setScanStatus: (status: ScanStatus) => void;
  setScanProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

let tabCounter = 0;

function deriveActiveState(tabs: ProjectTab[], activeTabId: string | null) {
  const active = tabs.find((t) => t.id === activeTabId);
  return {
    root: active?.root || null,
    monorepoConfig: active?.monorepoConfig || null,
    fileTree: active?.fileTree || [],
    scanStatus: (active?.scanStatus || 'idle') as ScanStatus,
    error: active?.error || null,
  };
}

function updateActiveTab(
  tabs: ProjectTab[],
  activeTabId: string | null,
  update: Partial<ProjectTab>,
): ProjectTab[] {
  return tabs.map((t) => (t.id === activeTabId ? { ...t, ...update } : t));
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  root: null,
  monorepoConfig: null,
  fileTree: [],
  scanStatus: 'idle',
  scanProgress: 0,
  error: null,

  addTab: (root, branch = null) => {
    const id = `tab-${++tabCounter}`;
    const name = root.split('/').pop() || 'project';
    const tab: ProjectTab = {
      id, root, name, branch,
      monorepoConfig: null, fileTree: [], scanStatus: 'idle', error: null,
    };
    set((s) => {
      const tabs = [...s.tabs, tab];
      return { tabs, activeTabId: id, ...deriveActiveState(tabs, id) };
    });
    return id;
  },

  removeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId = s.activeTabId === id
        ? (tabs.length > 0 ? tabs[tabs.length - 1].id : null)
        : s.activeTabId;
      return { tabs, activeTabId, ...deriveActiveState(tabs, activeTabId) };
    });
  },

  setActiveTab: (id) => {
    set((s) => ({ activeTabId: id, ...deriveActiveState(s.tabs, id) }));
  },

  setRoot: (path) => {
    const state = get();
    if (state.activeTabId) {
      const tabs = updateActiveTab(state.tabs, state.activeTabId, { root: path, scanStatus: 'idle', error: null });
      set({ tabs, root: path, scanStatus: 'idle', error: null });
    } else {
      // No tabs — create one
      const id = `tab-${++tabCounter}`;
      const name = path.split('/').pop() || 'project';
      const tab: ProjectTab = { id, root: path, name, branch: null, monorepoConfig: null, fileTree: [], scanStatus: 'idle', error: null };
      set({ tabs: [tab], activeTabId: id, root: path, scanStatus: 'idle', error: null });
    }
  },

  setMonorepoConfig: (config) => {
    const s = get();
    const tabs = updateActiveTab(s.tabs, s.activeTabId, { monorepoConfig: config });
    set({ tabs, monorepoConfig: config });
  },

  setFileTree: (tree) => {
    const s = get();
    const tabs = updateActiveTab(s.tabs, s.activeTabId, { fileTree: tree });
    set({ tabs, fileTree: tree });
  },

  setScanStatus: (status) => {
    const s = get();
    const tabs = updateActiveTab(s.tabs, s.activeTabId, { scanStatus: status });
    set({ tabs, scanStatus: status });
  },

  setScanProgress: (progress) => set({ scanProgress: progress }),

  setError: (error) => {
    const s = get();
    const tabs = updateActiveTab(s.tabs, s.activeTabId, { error, scanStatus: 'error' });
    set({ tabs, error, scanStatus: 'error' });
  },

  reset: () => set({
    tabs: [], activeTabId: null, root: null, monorepoConfig: null,
    fileTree: [], scanStatus: 'idle', scanProgress: 0, error: null,
  }),
}));
