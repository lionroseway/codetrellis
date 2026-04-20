import { create } from 'zustand';

interface UiState {
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  agentPanelVisible: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  agentPanelHeight: number;
  selectedNodeId: string | null;

  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleAgentPanel: () => void;
  setSidebarWidth: (w: number) => void;
  setInspectorWidth: (w: number) => void;
  setAgentPanelHeight: (h: number) => void;
  setSelectedNode: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarVisible: true,
  inspectorVisible: true,
  agentPanelVisible: true,
  sidebarWidth: 260,
  inspectorWidth: 300,
  agentPanelHeight: 200,
  selectedNodeId: null,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleInspector: () => set((s) => ({ inspectorVisible: !s.inspectorVisible })),
  toggleAgentPanel: () => set((s) => ({ agentPanelVisible: !s.agentPanelVisible })),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setInspectorWidth: (w) => set({ inspectorWidth: w }),
  setAgentPanelHeight: (h) => set({ agentPanelHeight: h }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
}));
