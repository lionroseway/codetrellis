import { create } from 'zustand';
import { parseOverlays, type OverlayId } from '../lib/graph-overlays';
import { parseEdgeKinds, type EdgeKind } from '../lib/graph-edge-kinds';

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
export type WorkspaceMode = 'graph' | 'plan' | 'docs' | 'code' | 'brief' | 'rules';

/** The bottom panel's tabs (`PlanPanel`). */
export type PlanPanelTab = 'plans' | 'stack' | 'timeline' | 'awareness' | 'review' | 'changes' | 'proposed' | 'comments';

/**
 * One thing an agent pointed at (`navigate_to` with `signal_id` or
 * `breakpoint_ref`): the card scrolls into view and is marked, until the
 * next navigation. `at` makes pointing at the same thing again a change.
 */
export interface UiHighlight { kind: 'signal' | 'breakpoint'; id: string; at: number }

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
  /** The bottom panel's tab. In the store so the workstreams strip can open Awareness (A1.8). */
  planPanelTab: PlanPanelTab;
  setPlanPanelTab: (tab: PlanPanelTab) => void;
  /** Show the bottom panel on a tab, from anywhere in the app. */
  openPlanPanelTab: (tab: PlanPanelTab) => void;
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
  highlight: UiHighlight | null;
  setHighlight: (h: UiHighlight | null) => void;
  /** An agent asked the code reader for its Line history (navigate_to), on a file and optionally a line. */
  lineHistoryRequest: { filePath: string; line: number | null; at: number } | null;
  requestLineHistory: (filePath: string, line: number | null) => void;
  /** Show the sidebar when it is hidden (an agent opening one of its views). */
  showSidebar: () => void;
  toggleInspector: () => void;
  toggleAgentPanel: () => void;
  /**
   * Phase 33 G4 — the panels as they were before full screen, or null when
   * the graph is not full screen. Toggling again puts them back as they were.
   */
  fullScreenFrom: { sidebar: boolean; inspector: boolean; planPanel: boolean } | null;
  toggleFullScreen: () => void;
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
  /** Phase 32 B3.3 — the graph overlays that are on. */
  graphOverlays: OverlayId[];
  toggleGraphOverlay: (id: OverlayId) => void;
  /** Phase 33 G8 — "Show this suite": the suite whose rules the graph keeps lit, the rest faded; null for none. */
  ruleSuiteFocus: string | null;
  /** Phase 33 G9 — the Rules view's tab: what the rules are, or what the checks say. */
  rulesViewTab: 'rules' | 'checks';
  setRulesViewTab: (tab: 'rules' | 'checks') => void;
  setRuleSuiteFocus: (suite: string | null) => void;
  /** Phase 33 G3 — the kinds of edge the graph draws. */
  graphEdges: EdgeKind[];
  toggleGraphEdge: (id: EdgeKind) => void;
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
/** Per machine, like the graph style: which overlays a person keeps on. */
const GRAPH_OVERLAYS_KEY = 'codetrellis.graphOverlays';

function readGraphOverlays(): OverlayId[] {
  try {
    const raw = localStorage.getItem(GRAPH_OVERLAYS_KEY);
    return parseOverlays(raw ? JSON.parse(raw) : undefined);
  } catch {
    return parseOverlays(undefined);
  }
}

/** Per machine too: which kinds of edge a person keeps drawn (G3). */
const GRAPH_EDGES_KEY = 'codetrellis.graphEdges';

function readGraphEdges(): EdgeKind[] {
  try {
    const raw = localStorage.getItem(GRAPH_EDGES_KEY);
    return parseEdgeKinds(raw ? JSON.parse(raw) : undefined);
  } catch {
    return parseEdgeKinds(undefined);
  }
}

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
  planPanelTab: 'plans',
  setPlanPanelTab: (planPanelTab) => set({ planPanelTab }),
  openPlanPanelTab: (planPanelTab) => set({ planPanelTab, agentPanelVisible: true }),
  inspectorExpanded: false,
  driftComparePlanUid: null,
  graphStyle: readGraphStyle(),
  setGraphStyle: (graphStyle) => {
    try { localStorage.setItem(GRAPH_STYLE_KEY, graphStyle); } catch { /* private window — session only */ }
    set({ graphStyle });
  },
  ruleSuiteFocus: null,
  rulesViewTab: 'rules',
  setRulesViewTab: (rulesViewTab) => set({ rulesViewTab }),
  setRuleSuiteFocus: (ruleSuiteFocus) => set((s) => {
    // Showing a suite turns the Rules overlay on, so what it is about is drawn.
    if (ruleSuiteFocus && !s.graphOverlays.includes('rules')) {
      const graphOverlays = [...s.graphOverlays, 'rules' as OverlayId];
      try { localStorage.setItem(GRAPH_OVERLAYS_KEY, JSON.stringify(graphOverlays)); } catch { /* private window — session only */ }
      return { ruleSuiteFocus, graphOverlays };
    }
    return { ruleSuiteFocus };
  }),
  graphOverlays: readGraphOverlays(),
  toggleGraphOverlay: (id) => set((s) => {
    const graphOverlays = s.graphOverlays.includes(id) ? s.graphOverlays.filter((x) => x !== id) : [...s.graphOverlays, id];
    try { localStorage.setItem(GRAPH_OVERLAYS_KEY, JSON.stringify(graphOverlays)); } catch { /* private window — session only */ }
    return { graphOverlays };
  }),
  graphEdges: readGraphEdges(),
  toggleGraphEdge: (id) => set((s) => {
    const graphEdges = s.graphEdges.includes(id) ? s.graphEdges.filter((x) => x !== id) : [...s.graphEdges, id];
    try { localStorage.setItem(GRAPH_EDGES_KEY, JSON.stringify(graphEdges)); } catch { /* private window — session only */ }
    return { graphEdges };
  }),
  splitView: false,
  toggleSplitView: () => set((s) => ({ splitView: !s.splitView })),
  audioBarVisible: false,
  toggleAudioBar: () => set((s) => ({ audioBarVisible: !s.audioBarVisible })),
  setSplitView: (v) => set({ splitView: v }),

  workspaceMode: 'graph',
  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
  toggleWorkspaceMode: () => set((s) => ({ workspaceMode: s.workspaceMode === 'graph' ? 'plan' : 'graph' })),

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  highlight: null,
  setHighlight: (highlight) => set({ highlight }),
  lineHistoryRequest: null,
  requestLineHistory: (filePath, line) => set({ lineHistoryRequest: { filePath, line, at: Date.now() } }),
  showSidebar: () => set({ sidebarVisible: true }),
  toggleInspector: () => set((s) => ({ inspectorVisible: !s.inspectorVisible })),
  toggleAgentPanel: () => set((s) => ({ agentPanelVisible: !s.agentPanelVisible })),
  fullScreenFrom: null,
  toggleFullScreen: () => set((s) => (s.fullScreenFrom
    ? {
      sidebarVisible: s.fullScreenFrom.sidebar,
      inspectorVisible: s.fullScreenFrom.inspector,
      agentPanelVisible: s.fullScreenFrom.planPanel,
      fullScreenFrom: null,
    }
    : {
      fullScreenFrom: { sidebar: s.sidebarVisible, inspector: s.inspectorVisible, planPanel: s.agentPanelVisible },
      sidebarVisible: false,
      inspectorVisible: false,
      agentPanelVisible: false,
    })),
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
