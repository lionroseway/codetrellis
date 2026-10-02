/**
 * Play-forward (Phase 32 B9.2, observability spec §6.3): the window shows
 * what every active plan says it will do, from now until they are done.
 *
 * Replay looks back at recorded moments; this looks ahead at what the plans
 * say. The two are one clock with two directions, so entering one leaves the
 * other. The answer is `/api/play-forward` (B9.1), read on entering and
 * again when a plan changes while it is on.
 */
import { create } from 'zustand';
import type { PlayForward } from '@shared/types/play-forward';
import { useReplayStore } from './replay-store';

interface PlayForwardStore {
  active: boolean;
  root: string | null;
  data: PlayForward | null;
  loading: boolean;
  error: string | null;
  enter: (root: string) => Promise<void>;
  /** Read again, keeping what is shown until the answer arrives. */
  refresh: () => Promise<void>;
  exit: () => void;
}

let generation = 0;

export const usePlayForwardStore = create<PlayForwardStore>((set, get) => ({
  active: false,
  root: null,
  data: null,
  loading: false,
  error: null,

  enter: async (root) => {
    if (useReplayStore.getState().active) useReplayStore.getState().exit();
    set({ active: true, root, data: null, error: null });
    await get().refresh();
  },

  refresh: async () => {
    const { root, active } = get();
    if (!active || !root) return;
    const mine = ++generation;
    set({ loading: true });
    try {
      const res = await fetch(`/api/play-forward?project=${encodeURIComponent(root)}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = (await res.json()) as PlayForward;
      if (mine === generation && get().active) set({ data, loading: false, error: null });
    } catch (e) {
      if (mine === generation) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  exit: () => {
    generation++;
    set({ active: false, root: null, data: null, loading: false, error: null });
  },
}));

// Replay and play-forward are one clock: starting replay leaves play-forward.
useReplayStore.subscribe((s, prev) => {
  if (s.active && !prev.active && usePlayForwardStore.getState().active) usePlayForwardStore.getState().exit();
});
