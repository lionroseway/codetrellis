import { create } from 'zustand';

export type SelectedNodeKind = 'cluster' | 'file' | 'symbol' | 'directory' | 'ghost' | null;

export interface SelectedNodeMeta {
  label?: string;
  description?: string;
  files?: string[];
  symbolName?: string;
  symbolKind?: string;
  symbolStartLine?: number;
  symbolEndLine?: number;
  parentFilePath?: string;
}

interface UiState {
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  agentPanelVisible: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  agentPanelHeight: number;
  selectedNodeId: string | null;
  selectedNodeKind: SelectedNodeKind;
  selectedNodeMeta: SelectedNodeMeta;

  /** When true, the bottom plan panel grows to a much taller size, overriding Allotment's default sizing. */
  planPanelExpanded: boolean;
  /** When true, the right inspector panel grows wider for code/file inspection. */
  inspectorExpanded: boolean;

  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleAgentPanel: () => void;
  setSidebarWidth: (w: number) => void;
  setInspectorWidth: (w: number) => void;
  setAgentPanelHeight: (h: number) => void;
  setSelectedNode: (id: string | null, kind?: SelectedNodeKind, meta?: SelectedNodeMeta) => void;
  togglePlanPanelExpanded: () => void;
  toggleInspectorExpanded: () => void;
  setPlanPanelExpanded: (v: boolean) => void;
  setInspectorExpanded: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarVisible: true,
  inspectorVisible: true,
  agentPanelVisible: true,
  sidebarWidth: 260,
  inspectorWidth: 300,
  agentPanelHeight: 200,
  selectedNodeId: null,
  selectedNodeKind: null,
  selectedNodeMeta: {},

  planPanelExpanded: false,
  inspectorExpanded: false,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleInspector: () => set((s) => ({ inspectorVisible: !s.inspectorVisible })),
  toggleAgentPanel: () => set((s) => ({ agentPanelVisible: !s.agentPanelVisible })),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setInspectorWidth: (w) => set({ inspectorWidth: w }),
  setAgentPanelHeight: (h) => set({ agentPanelHeight: h }),
  setSelectedNode: (id, kind = null, meta = {}) => set({ selectedNodeId: id, selectedNodeKind: id ? kind : null, selectedNodeMeta: id ? meta : {} }),
  togglePlanPanelExpanded: () => set((s) => ({ planPanelExpanded: !s.planPanelExpanded })),
  toggleInspectorExpanded: () => set((s) => ({ inspectorExpanded: !s.inspectorExpanded })),
  setPlanPanelExpanded: (v) => set({ planPanelExpanded: v }),
  setInspectorExpanded: (v) => set({ inspectorExpanded: v }),
}));
