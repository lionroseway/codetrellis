import { create } from 'zustand';
import type { AgentEvent, AgentPlan, AgentStatus } from '@shared/types';

interface AgentState {
  events: AgentEvent[];
  currentPlan: AgentPlan | null;
  activeFiles: Set<string>;
  recentlyChangedFiles: Set<string>; // files changed in last few seconds — used for graph pulse
  status: AgentStatus;

  pushEvent: (event: AgentEvent) => void;
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
      return { events: [...s.events, event] };
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
