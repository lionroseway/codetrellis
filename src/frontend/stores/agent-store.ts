import { create } from 'zustand';
import type { AgentEvent, AgentPlan, AgentStatus } from '@shared/types';

/**
 * The most events the window holds. The Timeline shows the last 400 as
 * turns; more than this is what the backend's log is for (Phase 32 B1).
 */
export const MAX_EVENTS = 2000;

const capped = (events: AgentEvent[]) => (events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events);

interface AgentState {
  events: AgentEvent[];
  currentPlan: AgentPlan | null;
  activeFiles: Set<string>;
  recentlyChangedFiles: Set<string>; // files changed in last few seconds — used for graph pulse
  status: AgentStatus;

  pushEvent: (event: AgentEvent) => void;
  /**
   * Events recorded before this window connected (B1): merged with what is
   * already here by id, in time order, so a reload keeps the Timeline.
   */
  loadHistory: (events: AgentEvent[]) => void;
  setPlan: (plan: AgentPlan | null) => void;
  setStatus: (status: AgentStatus) => void;
  setActiveFiles: (files: Set<string>) => void;
  markFileChanged: (relativePath: string) => void;
  clearEvents: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  events: [],
  currentPlan: null,
  activeFiles: new Set(),
  recentlyChangedFiles: new Set(),
  status: 'idle',

  pushEvent: (event) =>
    set((s) => {
      // Deduplicate by ID
      if (s.events.some((e) => e.id === event.id)) return s;
      return { events: capped([...s.events, event]) };
    }),
  loadHistory: (history) =>
    set((s) => {
      const seen = new Set(s.events.map((e) => e.id));
      const older = history.filter((e) => e && typeof e.id === 'string' && !seen.has(e.id));
      if (older.length === 0) return s;
      // A stable sort: history first, so equal timestamps keep the log's order.
      const merged = [...older, ...s.events].sort((a, b) => a.timestamp - b.timestamp);
      return { events: capped(merged) };
    }),
  setPlan: (plan) => set({ currentPlan: plan }),
  setStatus: (status) => set({ status }),
  setActiveFiles: (files) => set({ activeFiles: files }),
  markFileChanged: (relativePath) =>
    set((s) => {
      const next = new Set(s.recentlyChangedFiles);
      next.add(relativePath);
      // Auto-clear after 5 seconds
      setTimeout(() => {
        const store = useAgentStore.getState();
        const updated = new Set(store.recentlyChangedFiles);
        updated.delete(relativePath);
        useAgentStore.setState({ recentlyChangedFiles: updated });
      }, 5000);
      return { recentlyChangedFiles: next };
    }),
  clearEvents: () => set({ events: [] }),
}));
