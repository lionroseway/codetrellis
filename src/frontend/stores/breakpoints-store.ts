import { create } from 'zustand';
import type { Breakpoint, BreakpointHit, BreakpointDecision } from '@shared/types';

/**
 * Breakpoints (Phase 32 B4.3): the ones a person has set, and the agent
 * calls waiting at them. The waiting list is the top of the inbox, so it is
 * kept current by the broadcast events and a slow poll, like awareness.
 *
 * Every write goes over plain REST from the app window, so the backend
 * records the person as the author (`personFrom`); nothing here names them.
 */

export type SetBreakpointInput =
  | { kind: 'task' | 'spec'; itemUid: string; note?: string }
  | { kind: 'code'; path: string; symbol?: string; note?: string }
  | { kind: 'signal'; signal: 'collision' | 'contract' | 'drift'; note?: string };

interface BreakpointsState {
  breakpoints: Breakpoint[];
  waiting: BreakpointHit[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Set a breakpoint; the error the backend gave, or null. */
  set: (input: SetBreakpointInput) => Promise<string | null>;
  /** Clear a breakpoint; the error, or null. */
  clear: (id: string) => Promise<string | null>;
  /** Answer a waiting call; the error, or null. */
  answer: (ref: string, decision: BreakpointDecision, note?: string) => Promise<string | null>;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch { /* not JSON */ }
  return `${fallback} (${res.status})`;
}

const UNREACHABLE = 'Could not reach CodeTrellis.';
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const useBreakpointsStore = create<BreakpointsState>((set, get) => ({
  breakpoints: [],
  waiting: [],
  loaded: false,
  error: null,

  refresh: async () => {
    try {
      const [b, h] = await Promise.all([fetch('/api/breakpoints'), fetch('/api/breakpoint-hits')]);
      if (!b.ok || !h.ok) { set({ error: await errorOf(b.ok ? h : b, 'Server returned'), loaded: true }); return; }
      const { breakpoints } = (await b.json()) as { breakpoints: Breakpoint[] };
      const { hits } = (await h.json()) as { hits: BreakpointHit[] };
      set({ breakpoints, waiting: hits, loaded: true, error: null });
    } catch {
      set({ error: UNREACHABLE, loaded: true });
    }
  },

  set: async (input) => {
    try {
      const res = await fetch('/api/breakpoints', { method: 'POST', ...json(input) });
      if (!res.ok) return errorOf(res, 'Not set');
      await get().refresh();
      return null;
    } catch {
      return UNREACHABLE;
    }
  },

  clear: async (id) => {
    try {
      const res = await fetch(`/api/breakpoints/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) return errorOf(res, 'Not cleared');
      await get().refresh();
      return null;
    } catch {
      return UNREACHABLE;
    }
  },

  answer: async (ref, decision, note) => {
    try {
      const res = await fetch(`/api/breakpoint-hits/${encodeURIComponent(ref)}/answer`, { method: 'POST', ...json({ decision, note }) });
      if (!res.ok) {
        const err = await errorOf(res, 'Not answered');
        // Someone else answered first: the list is out of date, so refresh it.
        if (res.status === 409) void get().refresh();
        return err;
      }
      // Answered: off the waiting list at once, before the refresh confirms it.
      set({ waiting: get().waiting.filter((h) => h.ref !== ref) });
      void get().refresh();
      return null;
    } catch {
      return UNREACHABLE;
    }
  },
}));

/** The breakpoint of this kind set on an item, if any. */
export function itemBreakpoint(breakpoints: readonly Breakpoint[], kind: 'task' | 'spec', itemUid: string): Breakpoint | null {
  return breakpoints.find((b) => b.kind === kind && b.target === itemUid) ?? null;
}
