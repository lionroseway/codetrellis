import { create } from 'zustand';
import type { MonorepoConfig, ScanStatus, FileTreeNode } from '@shared/types';

export interface ProjectGitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  stagedAdded: string[];
  stagedModified: string[];
  stagedDeleted: string[];
  unstagedModified: string[];
  unstagedDeleted: string[];
  commitHash?: string | null;
  shortCommitHash?: string | null;
}

export interface ProjectTab {
  id: string;
  root: string;
  name: string;
  branch: string | null;
  monorepoConfig: MonorepoConfig | null;
  fileTree: FileTreeNode[];
  gitStatus: ProjectGitStatus | null;
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
  gitStatus: ProjectGitStatus | null;
  scanStatus: ScanStatus;
  scanProgress: number;
  error: string | null;
  refreshVersion: number;

  // Tab management
  addTab: (root: string, branch?: string | null) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  // Active tab mutations (called by existing code)
  setRoot: (path: string) => void;
  setMonorepoConfig: (config: MonorepoConfig) => void;
  setFileTree: (tree: FileTreeNode[]) => void;
  setGitStatus: (gitStatus: ProjectGitStatus | null) => void;
  setScanStatus: (status: ScanStatus) => void;
  setScanProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  bumpRefreshVersion: () => void;
  reset: () => void;
}

let tabCounter = 0;

function deriveActiveState(tabs: ProjectTab[], activeTabId: string | null) {
  const active = tabs.find((t) => t.id === activeTabId);
  return {
    root: active?.root || null,
    monorepoConfig: active?.monorepoConfig || null,
    fileTree: active?.fileTree || [],
    gitStatus: active?.gitStatus || null,
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
  gitStatus: null,
  scanStatus: 'idle',
  scanProgress: 0,
  error: null,
  refreshVersion: 0,

  addTab: (root, branch = null) => {
    const id = `tab-${++tabCounter}`;
    const name = root.split('/').pop() || 'project';
    const tab: ProjectTab = {
      id, root, name, branch,
      monorepoConfig: null, fileTree: [], gitStatus: null, scanStatus: 'idle', error: null,
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
      const tabs = updateActiveTab(state.tabs, state.activeTabId, { root: path, gitStatus: null, scanStatus: 'idle', error: null });
      set({ tabs, root: path, gitStatus: null, scanStatus: 'idle', error: null });
    } else {
      // No tabs — create one
      const id = `tab-${++tabCounter}`;
      const name = path.split('/').pop() || 'project';
      const tab: ProjectTab = { id, root: path, name, branch: null, monorepoConfig: null, fileTree: [], gitStatus: null, scanStatus: 'idle', error: null };
      set({ tabs: [tab], activeTabId: id, root: path, gitStatus: null, scanStatus: 'idle', error: null });
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

  setGitStatus: (gitStatus) => {
    const s = get();
    const tabs = updateActiveTab(s.tabs, s.activeTabId, { gitStatus });
    set({ tabs, gitStatus });
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

  bumpRefreshVersion: () => set((s) => ({ refreshVersion: s.refreshVersion + 1 })),

  reset: () => set({
    tabs: [], activeTabId: null, root: null, monorepoConfig: null,
    fileTree: [], gitStatus: null, scanStatus: 'idle', scanProgress: 0, error: null, refreshVersion: 0,
  }),
}));
