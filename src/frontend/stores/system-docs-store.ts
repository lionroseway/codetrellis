/**
 * CDev Phase 3.4 — system docs store.
 *
 * Holds the system documentation index for the currently-open project.
 * Mirrors the channels-store pattern: list is hydrated via REST, full
 * doc bodies are fetched on demand, and live updates arrive over the
 * WS bus (`system-doc-created`, `-updated`, `-removed`, `-verified`,
 * `system-doc-changed` from the file watcher).
 *
 * The store is UI state, not durable. The canonical source is the
 * markdown file on disk in `.codetrellis/docs/`.
 */

import { create } from 'zustand';
import type { SystemDoc, SystemDocFreshnessReport } from '@shared/types';

export interface SystemDocSummary {
  uid: string;
  slug: string;
  title: string;
  owner: string | null;
  tags: string[];
  updatedAt: number;
  lastVerifiedAt: number | null;
  capturedAgainstCommit: string | null;
}

interface SystemDocsState {
  /** Project path the index is hydrated for. */
  activeProjectPath: string | null;
  /** Summaries by uid for the active project. */
  byUid: Record<string, SystemDocSummary>;
  /** Sorted ordering — updated_at DESC. Recomputed on mutation. */
  orderedUids: string[];
  /** Full docs cached by uid (populated on read). */
  fullByUid: Record<string, SystemDoc>;
  /** Per-doc freshness cache; refreshed on verify / on demand. */
  freshnessByUid: Record<string, SystemDocFreshnessReport>;
  /** Search input — debounced from the view. */
  searchQuery: string;
  /** Currently selected doc uid in the side rail. */
  selectedUid: string | null;
  loading: boolean;
  saving: boolean;

  // --- Lifecycle ---
  hydrate: (projectPath: string, search?: string) => Promise<void>;
  reset: () => void;

  // --- Selection ---
  setSearchQuery: (q: string) => void;
  selectDoc: (uid: string | null) => Promise<void>;

  // --- Mutations ---
  createDoc: (input: { projectPath: string; title: string; body?: string }) => Promise<SystemDoc | null>;
  updateDoc: (uid: string, patch: Partial<SystemDoc>) => Promise<SystemDoc | null>;
  deleteDoc: (uid: string) => Promise<boolean>;
  verifyDoc: (uid: string) => Promise<SystemDoc | null>;
  refreshFreshness: (uid: string) => Promise<SystemDocFreshnessReport | null>;

  // --- WS handlers ---
  onDocChanged: (uid?: string) => Promise<void>;
  onDocRemoved: (uid: string) => void;
}

function summariseDoc(doc: SystemDoc): SystemDocSummary {
  return {
    uid: doc.uid,
    slug: doc.slug,
    title: doc.title,
    owner: doc.owner,
    tags: doc.tags,
    updatedAt: doc.updatedAt,
    lastVerifiedAt: doc.lastVerifiedAt,
    capturedAgainstCommit: doc.capturedAgainstCommit,
  };
}

function rebuildOrder(byUid: Record<string, SystemDocSummary>): string[] {
  return Object.values(byUid)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((d) => d.uid);
}

export const useSystemDocsStore = create<SystemDocsState>((set, get) => ({
  activeProjectPath: null,
  byUid: {},
  orderedUids: [],
  fullByUid: {},
  freshnessByUid: {},
  searchQuery: '',
  selectedUid: null,
  loading: false,
  saving: false,

  async hydrate(projectPath, search) {
    set({ loading: true, activeProjectPath: projectPath });
    try {
      const url = `/api/system-docs?project=${encodeURIComponent(projectPath)}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
      const res = await fetch(url);
      const docs: SystemDocSummary[] = res.ok ? await res.json() : [];
      const byUid: Record<string, SystemDocSummary> = {};
      for (const d of docs) byUid[d.uid] = d;
      set({ byUid, orderedUids: rebuildOrder(byUid), loading: false });
    } catch (err) {
      console.warn('[SystemDocs] hydrate failed:', err);
      set({ loading: false });
    }
  },

  reset() {
    set({
      activeProjectPath: null,
      byUid: {},
      orderedUids: [],
      fullByUid: {},
      freshnessByUid: {},
      selectedUid: null,
      searchQuery: '',
    });
  },

  setSearchQuery(q) {
    set({ searchQuery: q });
    const projectPath = get().activeProjectPath;
    if (projectPath) {
      // No debouncing here — the view should pass debounced queries
      // (or call hydrate directly). Keep the store dumb.
      get().hydrate(projectPath, q);
    }
  },

  async selectDoc(uid) {
    set({ selectedUid: uid });
    if (!uid) return;
    if (get().fullByUid[uid]) return;
    try {
      const res = await fetch(`/api/system-docs/${encodeURIComponent(uid)}`);
      if (!res.ok) return;
      const doc: SystemDoc = await res.json();
      set((s) => ({
        fullByUid: { ...s.fullByUid, [uid]: doc },
        byUid: { ...s.byUid, [uid]: summariseDoc(doc) },
      }));
      // Kick off a freshness check in the background.
      get().refreshFreshness(uid);
    } catch (err) {
      console.warn('[SystemDocs] selectDoc failed:', err);
    }
  },

  async createDoc(input) {
    set({ saving: true });
    try {
      const res = await fetch('/api/system-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const doc: SystemDoc = await res.json();
      set((s) => {
        const byUid = { ...s.byUid, [doc.uid]: summariseDoc(doc) };
        return {
          byUid,
          orderedUids: rebuildOrder(byUid),
          fullByUid: { ...s.fullByUid, [doc.uid]: doc },
          selectedUid: doc.uid,
        };
      });
      return doc;
    } catch (err) {
      console.warn('[SystemDocs] createDoc failed:', err);
      return null;
    } finally {
      set({ saving: false });
    }
  },

  async updateDoc(uid, patch) {
    set({ saving: true });
    try {
      const res = await fetch(`/api/system-docs/${encodeURIComponent(uid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const doc: SystemDoc = await res.json();
      set((s) => {
        const byUid = { ...s.byUid, [doc.uid]: summariseDoc(doc) };
        return {
          byUid,
          orderedUids: rebuildOrder(byUid),
          fullByUid: { ...s.fullByUid, [doc.uid]: doc },
        };
      });
      return doc;
    } catch (err) {
      console.warn('[SystemDocs] updateDoc failed:', err);
      return null;
    } finally {
      set({ saving: false });
    }
  },

  async deleteDoc(uid) {
    try {
      const res = await fetch(`/api/system-docs/${encodeURIComponent(uid)}`, { method: 'DELETE' });
      if (!res.ok) return false;
      set((s) => {
        const { [uid]: _drop, ...byUid } = s.byUid;
        const { [uid]: _drop2, ...fullByUid } = s.fullByUid;
        const { [uid]: _drop3, ...freshnessByUid } = s.freshnessByUid;
        return {
          byUid,
          orderedUids: rebuildOrder(byUid),
          fullByUid,
          freshnessByUid,
          selectedUid: s.selectedUid === uid ? null : s.selectedUid,
        };
      });
      return true;
    } catch (err) {
      console.warn('[SystemDocs] deleteDoc failed:', err);
      return false;
    }
  },

  async verifyDoc(uid) {
    try {
      const res = await fetch(`/api/system-docs/${encodeURIComponent(uid)}/verify`, { method: 'POST' });
      if (!res.ok) return null;
      const doc: SystemDoc = await res.json();
      set((s) => {
        const byUid = { ...s.byUid, [doc.uid]: summariseDoc(doc) };
        return {
          byUid,
          orderedUids: rebuildOrder(byUid),
          fullByUid: { ...s.fullByUid, [doc.uid]: doc },
        };
      });
      get().refreshFreshness(uid);
      return doc;
    } catch (err) {
      console.warn('[SystemDocs] verifyDoc failed:', err);
      return null;
    }
  },

  async refreshFreshness(uid) {
    try {
      const res = await fetch(`/api/system-docs/${encodeURIComponent(uid)}/freshness`);
      if (!res.ok) return null;
      const report: SystemDocFreshnessReport = await res.json();
      set((s) => ({ freshnessByUid: { ...s.freshnessByUid, [uid]: report } }));
      return report;
    } catch (err) {
      console.warn('[SystemDocs] freshness check failed:', err);
      return null;
    }
  },

  async onDocChanged(uid) {
    const projectPath = get().activeProjectPath;
    if (!projectPath) return;
    // The cheapest update is to re-hydrate the list; the changed
    // doc's body will refetch on next selection. If the changed doc
    // is currently selected, prime the full cache too.
    await get().hydrate(projectPath, get().searchQuery);
    if (uid && get().selectedUid === uid) {
      // Drop the cached full doc so selectDoc refetches.
      set((s) => {
        const { [uid]: _drop, ...fullByUid } = s.fullByUid;
        return { fullByUid };
      });
      await get().selectDoc(uid);
    }
  },

  onDocRemoved(uid) {
    set((s) => {
      const { [uid]: _drop, ...byUid } = s.byUid;
      const { [uid]: _drop2, ...fullByUid } = s.fullByUid;
      const { [uid]: _drop3, ...freshnessByUid } = s.freshnessByUid;
      return {
        byUid,
        orderedUids: rebuildOrder(byUid),
        fullByUid,
        freshnessByUid,
        selectedUid: s.selectedUid === uid ? null : s.selectedUid,
      };
    });
  },
}));
