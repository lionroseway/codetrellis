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

/**
 * Top-level layout mode.
 *
 *  - `'graph'` is the historical canvas + bottom plan strip layout.
 *  - `'plan'` (Phase 14 §B) is the full-canvas three-region plan
 *    workspace (Spec rail | Tasks | Activity rail).
 *  - `'docs'` (CDev Phase 3.4) is the full-canvas system documentation
 *    surface (Doc list | Rendered markdown).
 *
 * The mode is decoupled from `activePlan` so the user can switch back
 * to the graph without losing the active plan, and we can still pop
 * the workspace open when a plan is selected from the graph.
 */
/**
 * Phase 26 — `code` is a peer of `graph`, not a panel inside it. When it
 * is active the graph does not mount, so its layout cost is not paid.
 */
export type WorkspaceMode = 'graph' | 'plan' | 'docs' | 'code';

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

  /** Phase 14 §B — graph (canvas + bottom strip) vs plan (full-canvas workspace). */
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  toggleWorkspaceMode: () => void;

  /** When true, the bottom plan panel grows to a much taller size, overriding Allotment's default sizing. */
  planPanelExpanded: boolean;
  /** When true, the right inspector panel grows wider for code/file inspection. */
  inspectorExpanded: boolean;
  /**
   * Override for which plan drift comparisons should be scoped to. `null`
   * means "follow the active plan from plan-store". Set to a uid to pin
   * drift to that specific plan even if the active plan changes.
   */
  driftComparePlanUid: string | null;

  /**
   * Whether the Learn Trellis onboarding takeover is currently open.
   * Auto-opens once on first launch (when the user has no projects
   * and the localStorage seen-flag isn't set); also openable from
   * the TopBar's "Learn" button. See `LearnTrellis.tsx`.
   */
  learnTrellisOpen: boolean;
  setLearnTrellisOpen: (open: boolean) => void;

  /** Phase 16.E — when true, workspace + graph render side-by-side (horizontal split). */
  splitView: boolean;
  toggleSplitView: () => void;
  setSplitView: (v: boolean) => void;

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
  setDriftComparePlanUid: (uid: string | null) => void;
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
  driftComparePlanUid: null,
  learnTrellisOpen: false,
  setLearnTrellisOpen: (open) => set({ learnTrellisOpen: open }),
  splitView: false,
  toggleSplitView: () => set((s) => ({ splitView: !s.splitView })),
  setSplitView: (v) => set({ splitView: v }),

  workspaceMode: 'graph',
  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
  toggleWorkspaceMode: () => set((s) => ({ workspaceMode: s.workspaceMode === 'graph' ? 'plan' : 'graph' })),

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
  setDriftComparePlanUid: (uid) => set({ driftComparePlanUid: uid }),
}));
