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
  /**
   * A line to scroll to and mark when the code reader opens this file.
   *
   * Carried on the selection rather than passed as a prop because the
   * reader resolves its own file from the selection — see
   * `lib/open-file-at`, which is the only thing that sets it.
   */
  line?: number;
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
export type WorkspaceMode = 'graph' | 'plan' | 'docs' | 'code' | 'brief';

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

  /** Phase 16.E — when true, workspace + graph render side-by-side (horizontal split). */
  splitView: boolean;
  toggleSplitView: () => void;
  /**
   * Phase 29 §4.15 — the audio capture bar.
   *
   * Hidden by default: capturing the microphone is a niche, explicit
   * act, and a permanent "Start audio capture" strip would be exactly
   * the kind of always-on chrome this phase is trying not to add. The
   * bar itself keeps showing while a capture is running, whatever this
   * says, because a live microphone must never be invisible.
   */
  audioBarVisible: boolean;
  toggleAudioBar: () => void;
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

  /**
   * How graph cards are drawn. See `GraphStyle`.
   */
  graphStyle: GraphStyle;
  setGraphStyle: (style: GraphStyle) => void;
}

/**
 * Graph card rendering.
 *
 * `glass` is the original look: frosted cards (backdrop blur), soft
 * coloured glows, pulsing rings on focused and in-progress nodes, and a
 * drop-shadow filter on every edge. It is also the reason a large graph
 * stutters on pan and zoom. A backdrop blur re-samples everything behind
 * the card on every frame the canvas moves, and an SVG filter per edge
 * does the same work thousands of times.
 *
 * `performance` keeps every signal and changes how it is drawn. Status is
 * the product here, since you are meant to be able to see at a glance which
 * files the agent touched, so each glow becomes a thick solid outline
 * in the same colour, and each pulse a static double outline. Outlines
 * are painted once and cost nothing on pan. The frosting, the ambient
 * drop shadows and the per-edge filters go.
 *
 * Default is `performance`: the expensive look is the one to opt into.
 * Stored per machine in localStorage, because it is a property of the
 * display, not of the project or the account.
 */
export type GraphStyle = 'performance' | 'glass';

const GRAPH_STYLE_KEY = 'codetrellis.graphStyle';

function readGraphStyle(): GraphStyle {
  try {
    return localStorage.getItem(GRAPH_STYLE_KEY) === 'glass' ? 'glass' : 'performance';
  } catch {
    return 'performance';
  }
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
  graphStyle: readGraphStyle(),
  setGraphStyle: (graphStyle) => {
    try { localStorage.setItem(GRAPH_STYLE_KEY, graphStyle); } catch { /* private window — session only */ }
    set({ graphStyle });
  },
  splitView: false,
  toggleSplitView: () => set((s) => ({ splitView: !s.splitView })),
  audioBarVisible: false,
  toggleAudioBar: () => set((s) => ({ audioBarVisible: !s.audioBarVisible })),
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
