/**
 * Awareness (Phase 32 A1.8): the workstreams of the opened project and the
 * signals between them, for the Awareness tab and its count. Refreshed on
 * the `awareness-changed` / `workstreams-changed` window events, which
 * `useWebSocket` dispatches.
 */

import { create } from 'zustand';
import type { AwarenessSignal, SettableSignalState, SignalReply, Workstream, WorkstreamCommit } from '@shared/types';

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
  /** A person's message to the agents about a signal (A4.1). Resolves to an error message, or null. */
  reply: (id: string, message: string) => Promise<string | null>;
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
    if (root !== get().root) { commitsReadAt = 0; commitsHeads = ''; set({ root, workstreams: [], signals: [], commits: {}, loaded: false, error: null }); }
    // One read at a time (Phase 32 E1). Every file change in any worktree
    // broadcasts workstreams-changed, and each used to start three reads at
    // once, unbounded: the browser's six connections filled with commit
    // reads, each seconds of git on the backend, and nothing else loaded.
    // A refresh asked for while one runs becomes one more, after it.
    if (inFlight) { again = root; return inFlight; }
    inFlight = readOnce(root, set, get);
    try { await inFlight; } finally { inFlight = null; }
    if (again) { const next = again; again = null; await get().refresh(next); }
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

  reply: async (id, message) => {
    const root = get().root;
    if (!root) return 'No project is open.';
    try {
      const res = await fetch(`/api/awareness/${encodeURIComponent(id)}/reply?project=${encodeURIComponent(root)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return (body as { error?: string }).error ?? `Server returned ${res.status}`;
      const { signalId: _s, steers: _t, ...reply } = body as SignalReply & { signalId: string; steers: string[] };
      set((s) => ({ signals: s.signals.map((x) => (x.id === id ? { ...x, replies: [...(x.replies ?? []), reply] } : x)) }));
      return null;
    } catch {
      return 'Could not reach CodeTrellis.';
    }
  },
}));

/** The read in flight, and a refresh asked for while it ran. */
let inFlight: Promise<void> | null = null;
let again: string | null = null;
/** Commits change when a workstream commits, not on every file change: read at most this often. */
const COMMITS_EVERY_MS = 30_000;
let commitsReadAt = 0;
let commitsInFlight = false;
/** The workstreams' heads when commits were last read: a head that moved means a commit landed. */
let commitsHeads = '';

async function readOnce(root: string, set: (s: Partial<AwarenessState>) => void, get: () => AwarenessState): Promise<void> {
  const q = `project=${encodeURIComponent(root)}`;
  try {
    const [ws, aw] = await Promise.all([fetch(`/api/workstreams?${q}&idle=1`), fetch(`/api/awareness?${q}`)]);
    if (!ws.ok || !aw.ok) throw new Error(`Server returned ${ws.ok ? aw.status : ws.status}`);
    const workstreams = (await ws.json()) as Workstream[];
    const body = (await aw.json()) as { signals?: AwarenessSignal[] };
    if (get().root !== root) return; // the project changed while this was in flight
    const list = Array.isArray(workstreams) ? workstreams : [];
    set({ workstreams: list, signals: Array.isArray(body.signals) ? body.signals : [], loaded: true, error: null });
    // Commits are extra: failing to read them never costs the rest, and
    // neither does reading them slowly; they land when they arrive. Read
    // when a workstream's head moved (a commit landed) or every
    // COMMITS_EVERY_MS, and never two at once.
    const heads = list.map((w) => `${w.root}@${w.head ?? ''}`).sort().join('|');
    if (!commitsInFlight && (heads !== commitsHeads || Date.now() - commitsReadAt >= COMMITS_EVERY_MS)) {
      commitsInFlight = true;
      commitsReadAt = Date.now();
      commitsHeads = heads;
      void fetch(`/api/workstreams/commits?${q}&since=${Date.now() - COMMITS_WINDOW_MS}`)
        .then(async (r) => (r.ok ? ((await r.json()) as { commits?: Record<string, WorkstreamCommit[]> }).commits ?? {} : {}))
        .then((commits) => {
          if (get().root === root && commits && typeof commits === 'object') set({ commits });
        })
        .catch(() => { commitsHeads = ''; /* read again next time */ })
        .finally(() => { commitsInFlight = false; });
    }
  } catch (e) {
    if (get().root === root) set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Test seam: forget what is in flight and when commits were read. */
export function resetAwarenessReads(): void { inFlight = null; again = null; commitsReadAt = 0; commitsInFlight = false; commitsHeads = ''; }
