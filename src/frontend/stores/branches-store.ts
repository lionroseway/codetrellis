/**
 * Branches and pull requests (Phase 32 E5): the listing from
 * `/api/git/branches` (local, as last fetched) and Fetch now
 * (`POST /api/git/fetch`, which reaches the remotes and gh). A slower,
 * earlier read never replaces a later one; a fetch elsewhere
 * (`git-remotes-changed`, the keeper or another window) reloads it.
 */

import { create } from 'zustand';

export interface BranchRow {
  spec: string;
  kind: 'branch' | 'remote';
  name: string;
  sha: string;
  at: number | null;
  subject: string | null;
  current: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  gone: boolean;
  trackedBy: string | null;
  words: string;
  term: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'draft' | 'merged' | 'closed';
  head: string;
  base: string;
  author: string | null;
  updatedAt: number | null;
  url: string | null;
  review: string | null;
  words: string;
  compare: { before: string; after: string } | null;
}

export interface BranchListing {
  project: string;
  git: boolean;
  branch: string | null;
  remotes: string[];
  branches: BranchRow[];
  remoteBranches: BranchRow[];
  commands: { branches: string; remoteBranches: string };
  fetch: {
    at: number | null; words: string; command: string; running: boolean; error: string | null;
    auto: { on: boolean; everyMinutes: number; words: string };
  };
  pulls: { status: 'never' | 'ok' | 'no-gh' | 'signed-out' | 'not-github' | 'error'; readAt: number | null; pulls: PullRequest[]; words: string; command: string };
}

interface BranchesState {
  root: string | null;
  listing: BranchListing | null;
  loading: boolean;
  error: string | null;
  fetching: boolean;
  /** What the last Fetch now said. */
  fetchWords: string | null;
  fetchFailed: boolean;
  load: (root: string) => Promise<void>;
  fetchNow: (root: string) => Promise<void>;
}

let generation = 0;

export const useBranchesStore = create<BranchesState>((set, get) => ({
  root: null,
  listing: null,
  loading: false,
  error: null,
  fetching: false,
  fetchWords: null,
  fetchFailed: false,

  load: async (root) => {
    if (root !== get().root) set({ root, listing: null, error: null, fetchWords: null, fetchFailed: false });
    const mine = ++generation;
    set({ loading: true });
    try {
      const res = await fetch(`/api/git/branches?project=${encodeURIComponent(root)}`);
      const body = await res.json().catch(() => null);
      if (mine !== generation || get().root !== root) return;
      if (!res.ok) { set({ loading: false, error: body?.error || `Server returned ${res.status}` }); return; }
      set({ loading: false, error: null, listing: body as BranchListing });
    } catch (e) {
      if (mine === generation) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  fetchNow: async (root) => {
    if (get().fetching) return;
    set({ fetching: true, fetchWords: null, fetchFailed: false });
    try {
      const res = await fetch(`/api/git/fetch?project=${encodeURIComponent(root)}`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (get().root !== root) return;
      if (!res.ok) { set({ fetchWords: body?.error || `Server returned ${res.status}`, fetchFailed: true }); return; }
      ++generation;
      set({ fetchWords: body.words, fetchFailed: !body.ok, listing: body.listing as BranchListing, error: null });
    } catch (e) {
      set({ fetchWords: e instanceof Error ? e.message : String(e), fetchFailed: true });
    } finally {
      set({ fetching: false });
    }
  },
}));

/** A pull request's pair as the Changes tab's two sides: its base and head, from where they split. */
export function pullPair(compare: { before: string; after: string }): { before: string; after: string; fromSplit: boolean } | null {
  const m = /^merge-base:(.+)\.\.\.(.+)$/.exec(compare.before);
  return m ? { before: `commit:${m[1]}`, after: compare.after, fromSplit: true } : null;
}
