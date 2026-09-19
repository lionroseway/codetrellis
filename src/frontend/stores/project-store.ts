import { create } from 'zustand';
import type { MonorepoConfig, ScanStatus, FileTreeNode } from '@shared/types';

/** The shape returned by `api.scanProject` — kept loose so the store can
 *  apply it defensively (a hard failure may carry only `error`). */
interface ScanResultLike {
  monorepoConfig?: MonorepoConfig | null;
  fileTree?: FileTreeNode[] | null;
  astError?: string | null;
  error?: string | null;
}

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
  /**
   * Set a tab's branch label after the fact.
   *
   * Needed because the branch can only be read once the project is a
   * trusted root, which `scanProject` is what establishes — so the tab
   * exists before its branch is knowable.
   */
  setTabBranch: (id: string, branch: string | null) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  // Active tab mutations (called by existing code)
  setRoot: (path: string) => void;
  setMonorepoConfig: (config: MonorepoConfig) => void;
  setFileTree: (tree: FileTreeNode[]) => void;
  applyScanResult: (result: ScanResultLike | null | undefined) => void;
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

  setTabBranch: (id, branch) => {
    set((s) => {
      const tabs = s.tabs.map((t) => (t.id === id ? { ...t, branch } : t));
      return { tabs, ...deriveActiveState(tabs, s.activeTabId) };
    });
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
    // Coerce to an array — scanning a missing/empty project (e.g. a plan
    // that points at a deleted directory) can yield `undefined` here, which
    // would poison every file-tree consumer (`for (const n of fileTree)` →
    // "nodes is not iterable") and crash the whole app via the error boundary.
    const safeTree = Array.isArray(tree) ? tree : [];
    const s = get();
    const tabs = updateActiveTab(s.tabs, s.activeTabId, { fileTree: safeTree });
    set({ tabs, fileTree: safeTree });
  },

  applyScanResult: (result) => {
    const s = get();
    // A hard failure carries `error` and NO usable tree — surface it
    // instead of flipping to `ready` with an empty tree (the bug that
    // collapsed the explorer to changed-files-only). A degraded scan
    // (corrupt DB etc.) still returns the tree alongside `astError`; we
    // keep the tree and let the analysis catch up on the next scan.
    if (!result || (!Array.isArray(result.fileTree) && result.error)) {
      s.setError(result?.error ? String(result.error) : 'Scan failed');
      return;
    }
    if (result.monorepoConfig) s.setMonorepoConfig(result.monorepoConfig);
    s.setFileTree(Array.isArray(result.fileTree) ? result.fileTree : []);
    s.setScanStatus('ready');
    if (result.astError) {
      console.warn('[Scan] Analysis degraded (file tree intact):', result.astError);
    }
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
