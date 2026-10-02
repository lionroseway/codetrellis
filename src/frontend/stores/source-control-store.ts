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
}

/** Every read is numbered; a slower earlier one never replaces a later one. */
let generation = 0;

export const useSourceControlStore = create<SourceControlState>((set, get) => ({
  root: null,
  data: null,
  loading: false,
  error: null,
  compare: null,
  sidebarView: 'files',
  setSidebarView: (v) => set({ sidebarView: v }),

  refresh: async (root) => {
    const mine = ++generation;
    if (!root) { set({ root: null, data: null, loading: false, error: null, compare: null }); return; }
    if (root !== get().root) set({ root, data: null, compare: null });
    set({ loading: true });
    try {
      const res = await fetch(`/api/source-control?project=${encodeURIComponent(root)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Server returned ${res.status}`);
      if (mine === generation) set({ data: body as SourceControl, loading: false, error: null });
    } catch (e) {
      if (mine === generation) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
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
