/**
 * Replay (Phase 32 B5.3): one clock for the window.
 *
 * While replay is on, the Timeline lanes, the graph, the plan's task
 * statuses and the Awareness inbox show the project as it was at the
 * cursor, a recorded moment (a frame, B5.1), from `/api/replay/state`
 * (B5.2). Stepping moves from frame to frame; nothing animates in between.
 * Live events keep arriving into the other stores underneath: the readers
 * choose replay's answer while it is on, and the live one again when the
 * person goes back to live.
 */

import { create } from 'zustand';
import { REPLAY_WINDOW_MS, statusesAsOf, type ReplayFrameInfo, type ReplayState } from '../lib/replay';

interface FrameGraph {
  frameId: number;
  files: Array<{ path: string }>;
  edges: Array<{ source: string; target: string; specifiers: string[] }>;
}

interface ReplayStore {
  /** On while the person is replaying. */
  active: boolean;
  root: string | null;
  frames: ReplayFrameInfo[];
  index: number;
  /** The project at the cursor's moment; null until it is read. */
  state: ReplayState | null;
  /** The graph at the cursor's frame, as it was: drawn frozen. */
  graph: FrameGraph | null;
  /** Each task's status at the moment, by uid; a task made later is absent. */
  statuses: Record<string, string | null>;
  loading: boolean;
  error: string | null;
  /** Catch-up (B5.4): play at once at this speed, from where the person left off. */
  autoplay: 4 | null;
  /** Start replaying the project's recorded moments since `from` (default: the last two hours). */
  enter: (root: string, from?: number, opts?: { catchUp?: boolean }) => Promise<void>;
  /** Move the cursor to a frame. */
  setIndex: (index: number) => Promise<void>;
  /** Back to live. */
  exit: () => void;
}

const EMPTY = { frames: [] as ReplayFrameInfo[], index: 0, state: null, graph: null, statuses: {} as Record<string, string | null>, loading: false, error: null, autoplay: null };

/** Each cursor move numbers its reads; a slower earlier read never replaces a later one. */
let generation = 0;

export const useReplayStore = create<ReplayStore>((set, get) => ({
  active: false,
  root: null,
  ...EMPTY,

  enter: async (root, from, opts) => {
    const mine = ++generation;
    set({ active: true, root, ...EMPTY, loading: true, autoplay: opts?.catchUp ? 4 : null });
    try {
      const since = from ?? Date.now() - REPLAY_WINDOW_MS;
      const res = await fetch(`/api/replay/frames?project=${encodeURIComponent(root)}&from=${since}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const frames = ((await res.json()) as { frames?: ReplayFrameInfo[] }).frames ?? [];
      if (mine !== generation) return;
      set({ frames, loading: false });
      // Start at the first moment: replay plays forward from where it begins.
      if (frames.length > 0) await get().setIndex(0);
    } catch (e) {
      if (mine === generation) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  setIndex: async (index) => {
    const { root, frames, graph } = get();
    if (!root || frames.length === 0) return;
    const i = Math.min(Math.max(index, 0), frames.length - 1);
    const frame = frames[i];
    const mine = ++generation;
    set({ index: i, loading: true });
    try {
      const q = `project=${encodeURIComponent(root)}`;
      // A frame that points at another shares its graph: read it once.
      const graphId = frame.sameAs ?? frame.id;
      const graphRead = graph?.frameId === graphId
        ? Promise.resolve(graph)
        : fetch(`/api/trellis/${graphId}`).then(async (r) => {
          if (!r.ok) return null;
          const body = (await r.json()) as { data?: { files?: FrameGraph['files']; edges?: FrameGraph['edges'] } };
          return { frameId: graphId, files: body.data?.files ?? [], edges: body.data?.edges ?? [] };
        }).catch(() => null);
      const [stateRes, nextGraph] = await Promise.all([fetch(`/api/replay/state?${q}&at=${frame.at}`), graphRead]);
      if (!stateRes.ok) throw new Error(`Server returned ${stateRes.status}`);
      const state = (await stateRes.json()) as ReplayState;
      if (mine !== generation) return;
      set({ state, graph: nextGraph, statuses: statusesAsOf(state), loading: false, error: null });
    } catch (e) {
      if (mine === generation) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  exit: () => {
    ++generation;
    set({ active: false, root: null, ...EMPTY });
  },
}));

/** While replaying with a state read: what the readers show instead of live. */
export function useReplayState(): ReplayState | null {
  return useReplayStore((s) => (s.active ? s.state : null));
}
