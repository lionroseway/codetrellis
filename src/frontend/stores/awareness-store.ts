/**
 * Awareness (Phase 32 A1.8): the workstreams of the opened project and the
 * signals between them, for the Awareness tab and its count. Refreshed on
 * the `awareness-changed` / `workstreams-changed` window events, which
 * `useWebSocket` dispatches.
 */

import { create } from 'zustand';
import type { AwarenessSignal, SettableSignalState, Workstream, WorkstreamCommit } from '@shared/types';

/** How far back the Timeline lanes ask for commits (B2.2): the lanes' widest window. */
const COMMITS_WINDOW_MS = 2 * 60 * 60 * 1000;

interface AwarenessState {
  root: string | null;
  workstreams: Workstream[];
  signals: AwarenessSignal[];
  /** Each workstream's own commits, by root, for the Timeline lanes (B2.2). */
  commits: Record<string, WorkstreamCommit[]>;
  loaded: boolean;
  /** Set when the last read failed; the lists keep what they had. */
  error: string | null;
  refresh: (root: string | null) => Promise<void>;
  /** A person's answer to a signal. Resolves to an error message, or null. */
  answer: (id: string, state: SettableSignalState) => Promise<string | null>;
}

export const useAwarenessStore = create<AwarenessState>((set, get) => ({
  root: null,
  workstreams: [],
  signals: [],
  commits: {},
  loaded: false,
  error: null,

  refresh: async (root) => {
    if (!root) { set({ root: null, workstreams: [], signals: [], commits: {}, loaded: false, error: null }); return; }
    if (root !== get().root) set({ root, workstreams: [], signals: [], commits: {}, loaded: false, error: null });
    const q = `project=${encodeURIComponent(root)}`;
    try {
      // Commits are extra: failing to read them never costs the rest.
      const commitsRead = fetch(`/api/workstreams/commits?${q}&since=${Date.now() - COMMITS_WINDOW_MS}`)
        .then(async (r) => (r.ok ? ((await r.json()) as { commits?: Record<string, WorkstreamCommit[]> }).commits ?? {} : {}))
        .catch(() => ({} as Record<string, WorkstreamCommit[]>));
      const [ws, aw] = await Promise.all([fetch(`/api/workstreams?${q}&idle=1`), fetch(`/api/awareness?${q}`)]);
      if (!ws.ok || !aw.ok) throw new Error(`Server returned ${ws.ok ? aw.status : ws.status}`);
      const workstreams = (await ws.json()) as Workstream[];
      const body = (await aw.json()) as { signals?: AwarenessSignal[] };
      const commits = await commitsRead;
      if (get().root !== root) return; // the project changed while this was in flight
      set({
        workstreams: Array.isArray(workstreams) ? workstreams : [],
        signals: Array.isArray(body.signals) ? body.signals : [],
        commits: commits && typeof commits === 'object' ? commits : {},
        loaded: true, error: null,
      });
    } catch (e) {
      if (get().root === root) set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  answer: async (id, state) => {
    const root = get().root;
    if (!root) return 'No project is open.';
    try {
      const res = await fetch(`/api/awareness/${encodeURIComponent(id)}/state?project=${encodeURIComponent(root)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return (body as { error?: string }).error ?? `Server returned ${res.status}`;
      const updated = body as AwarenessSignal;
      set((s) => ({ signals: s.signals.map((x) => (x.id === id ? updated : x)) }));
      return null;
    } catch {
      return 'Could not reach CodeTrellis.';
    }
  },
}));
