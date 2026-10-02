/**
 * Source control (Phase 32 E1): what has changed in the opened project, by
 * where, and the comparison the code view is showing when one was picked
 * from it.
 *
 * The Changes panel reads the groups; picking a file opens the code view on
 * that file's diff between the group's two points, so the code view never
 * guesses what "changed" meant (the defect: the graph showed an agent's
 * committed or worktree changes, and the code view compared this
 * checkout's last commit with its clean working tree).
 */

import { create } from 'zustand';
import { useUiStore } from './ui-store';

export type SourceChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
export type SourceGroupKind = 'staged' | 'changes' | 'untracked' | 'since-opened' | 'workstream';

export interface SourceFile { path: string; status: SourceChangeStatus; from?: string }

export interface SourceGroup {
  id: string;
  kind: SourceGroupKind;
  title: string;
  words: string;
  before: string;
  after: string;
  labels: { before: string; after: string };
  /** The same as git says it: its term, and the command that lists it. */
  git: { term: string | null; command: string };
  files: SourceFile[];
  truncated?: boolean;
  workstream?: { id: string; branch: string | null; agents: string[] };
}

export interface SourceControl {
  project: string;
  git: boolean;
  branch: string | null;
  head: { sha: string; subject: string } | null;
  groups: SourceGroup[];
  words: string;
}

/** Phase 32 E2: a point to compare (a ref, a worktree, this checkout), from `/api/git/refs`. */
export interface GitRef {
  spec: string;
  kind: 'checkout' | 'branch' | 'remote' | 'tag' | 'worktree' | 'commit';
  name: string;
  words: string;
  term: string;
  sha: string | null;
  at: number | null;
  subject: string | null;
  current?: boolean;
  agents?: string[];
}

export interface RefGroup {
  kind: GitRef['kind'];
  title: string;
  words: string;
  git: { term: string; command: string };
  refs: GitRef[];
}

export interface RefListing {
  project: string;
  git: boolean;
  branch: string | null;
  groups: RefGroup[];
  fetchedAt: number | null;
}

/** Two points chosen to compare, and what differs between them. */
export interface RefPair {
  before: string;
  after: string;
  /** Compare from where the two split (git's `a...b`), when both are refs. */
  fromSplit: boolean;
}

export interface PairResult {
  /** The sides as compared (with `fromSplit`, the before side is their merge base). */
  before: string;
  after: string;
  labels: { before: string; after: string };
  files: SourceFile[];
  truncated: boolean;
  command: string | null;
  words: string;
}

/** The side the comparison starts from: the merge base of the two when asked, and both are refs. */
export function effectiveBefore(pair: RefPair): string {
  if (pair.fromSplit && pair.before.startsWith('commit:') && pair.after.startsWith('commit:')) {
    return `merge-base:${pair.before.slice('commit:'.length)}...${pair.after.slice('commit:'.length)}`;
  }
  return pair.before;
}

/** Whether "from where they split" applies: both sides are refs. */
export function canSplit(pair: RefPair): boolean {
  return pair.before.startsWith('commit:') && pair.after.startsWith('commit:');
}

/** A comparison picked from the panel: one file between a group's two points. */
export interface PickedCompare {
  /** Relative to the project. */
  path: string;
  groupId: string;
  before: string;
  after: string;
  labels: { before: string; after: string };
  /** This file's diff as a git command, for whoever wants to run it. */
  command: string;
  /** What the two sides are, for the code view's header. */
  title: string;
  words: string;
}

interface SourceControlState {
  root: string | null;
  data: SourceControl | null;
  loading: boolean;
  error: string | null;
  compare: PickedCompare | null;
  /** The sidebar's view: its files, or what changed. Shared, since code mode draws its own sidebar. */
  sidebarView: 'files' | 'changes';
  setSidebarView: (v: 'files' | 'changes') => void;
  refresh: (root: string | null) => Promise<void>;
  /** Open the code view on this file's diff in this group. */
  openCompare: (root: string, group: SourceGroup, file: SourceFile) => void;
  clearCompare: () => void;

  /** E2: the points this project can compare. */
  refs: RefListing | null;
  loadRefs: (root: string) => Promise<void>;
  /** E2: two points chosen to compare, the files between them, and reading them. */
  pair: RefPair | null;
  pairResult: PairResult | null;
  pairLoading: boolean;
  pairError: string | null;
  setPair: (root: string, pair: RefPair | null) => Promise<void>;
  /** Open the code view on one file between the chosen two. */
  openPairFile: (root: string, file: SourceFile) => void;
  /** E2b: the graph draws its diff between the chosen two, instead of its own. */
  pairOnGraph: boolean;
  showPairOnGraph: (on: boolean) => void;
}

/** Every read is numbered; a slower earlier one never replaces a later one. */
let generation = 0;
let pairGeneration = 0;
/** The source-control read in flight, and a refresh asked for while it ran. */
let scInFlight: Promise<void> | null = null;
let scAgain: string | null = null;

export const useSourceControlStore = create<SourceControlState>((set, get) => ({
  root: null,
  data: null,
  loading: false,
  error: null,
  compare: null,
  sidebarView: 'files',
  setSidebarView: (v) => set({ sidebarView: v }),

  refresh: async (root) => {
    if (!root) { ++generation; scInFlight = null; scAgain = null; set({ root: null, data: null, loading: false, error: null, compare: null }); return; }
    if (root !== get().root) set({ root, data: null, compare: null, refs: null, pair: null, pairResult: null, pairError: null, pairOnGraph: false });
    // One read at a time, as awareness reads (E1). Every file change in any
    // worktree broadcasts workstreams-changed; each started a read of git on
    // the backend, unbounded, and a burst of them held the server and the
    // browser's connections long enough that a person's own click waited.
    // A refresh asked for while one runs becomes one more, after it.
    if (scInFlight) { scAgain = root; return scInFlight; }
    const mine = ++generation;
    set({ loading: true });
    scInFlight = (async () => {
      try {
        const res = await fetch(`/api/source-control?project=${encodeURIComponent(root)}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `Server returned ${res.status}`);
        if (mine === generation && get().root === root) set({ data: body as SourceControl, loading: false, error: null });
      } catch (e) {
        if (mine === generation) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    try { await scInFlight; } finally { scInFlight = null; }
    if (scAgain) { const next = scAgain; scAgain = null; await get().refresh(next); }
  },

  openCompare: (root, group, file) => {
    set({
      compare: {
        path: file.path, groupId: group.id, before: group.before, after: group.after, labels: group.labels,
        command: group.kind === 'untracked' ? `git status --untracked-files -- ${file.path}` : `${group.git.command} -- ${file.path}`,
        title: group.kind === 'workstream' ? `${group.title} · since it left main` : group.title,
        words: group.words,
      },
    });
    const ui = useUiStore.getState();
    ui.setSelectedNode(`${root.replace(/[\\/]+$/, '')}/${file.path}`, 'file');
    ui.setWorkspaceMode('code');
  },

  clearCompare: () => set({ compare: null }),

  refs: null,
  loadRefs: async (root) => {
    try {
      const res = await fetch(`/api/git/refs?project=${encodeURIComponent(root)}`);
      if (!res.ok) return;
      set({ refs: (await res.json()) as RefListing });
    } catch { /* the pickers keep what they had */ }
  },

  pairOnGraph: false,
  showPairOnGraph: (on) => {
    set({ pairOnGraph: on && get().pair !== null });
    if (on) useUiStore.getState().setWorkspaceMode('graph');
  },

  pair: null,
  pairResult: null,
  pairLoading: false,
  pairError: null,
  setPair: async (root, pair) => {
    const mine = ++pairGeneration;
    if (!pair) { set({ pair: null, pairResult: null, pairLoading: false, pairError: null, pairOnGraph: false }); return; }
    set({ pair, pairLoading: true, pairError: null });
    const before = effectiveBefore(pair);
    try {
      const q = `project=${encodeURIComponent(root)}&before=${encodeURIComponent(before)}&after=${encodeURIComponent(pair.after)}`;
      const res = await fetch(`/api/git/refs/compare?${q}`);
      const body = await res.json().catch(() => null);
      if (mine !== pairGeneration) return;
      if (!res.ok) { set({ pairLoading: false, pairResult: null, pairError: body?.error || `Server returned ${res.status}` }); return; }
      set({ pairLoading: false, pairResult: body as PairResult });
    } catch (e) {
      if (mine === pairGeneration) set({ pairLoading: false, pairResult: null, pairError: e instanceof Error ? e.message : String(e) });
    }
  },

  openPairFile: (root, file) => {
    const r = get().pairResult;
    if (!r) return;
    set({
      compare: {
        path: file.path, groupId: 'pair', before: r.before, after: r.after, labels: r.labels,
        command: r.command ? `${r.command} -- ${file.path}` : '',
        title: 'Two points',
        words: `${r.labels.before} → ${r.labels.after}`,
      },
    });
    const ui = useUiStore.getState();
    ui.setSelectedNode(`${root.replace(/[\\/]+$/, '')}/${file.path}`, 'file');
    ui.setWorkspaceMode('code');
  },
}));

/** The first group that lists this file, in the panel's order: where its change is. */
export function groupOfFile(data: SourceControl | null, relativePath: string | null): SourceGroup | null {
  if (!data || !relativePath) return null;
  return data.groups.find((g) => g.files.some((f) => f.path === relativePath)) ?? null;
}

/** What a group's change is called on its own (the code view's "Changed" chip). */
export function changeWords(group: SourceGroup): string {
  switch (group.kind) {
    case 'staged': return 'Ready to commit (staged)';
    case 'changes': return 'Changed, not staged';
    case 'untracked': return 'New file, not yet tracked by git';
    case 'since-opened': return 'Committed since you opened the project';
    default: return `Changed in ${group.title}${group.workstream?.agents.length ? ` by ${group.workstream.agents.join(' and ')}` : ''}`;
  }
}
