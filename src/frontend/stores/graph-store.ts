import { create } from 'zustand';
import type { GraphNode, GraphEdge, ViewDepth, ArchitectureDiff, ProjectionData, TrellisMode } from '@shared/types';
import type { LayoutMode } from '../lib/graph-builder';

export type BaselineMode = 'pinned' | 'auto';

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewDepth: ViewDepth;
  expandedNodes: Set<string>;
  filter: {
    language: string | null;
    packageScope: string | null;
    searchQuery: string;
  };

  layoutMode: LayoutMode;
  trellisMode: TrellisMode;
  /**
   * Graph scope — limits which files appear in the graph. Real
   * monorepos have thousands of files; rendering everything pegs
   * RAM and is unreadable. Picking a system / directory here cuts
   * the canvas down to one focus area.
   *
   * `null` = show everything; otherwise a relative path prefix
   * (e.g. "apps/admin" or "backend/fastapi") — only files whose
   * relative path starts with this prefix appear.
   */
  scopePath: string | null;
  baselineMode: BaselineMode;
  baselineCommitHash: string | null;
  baselineShortCommitHash: string | null;
  currentSnapshot: {
    id: number;
    name?: string;
    commitHash?: string | null;
    shortCommitHash?: string | null;
    edges: Array<{ source: string; target: string; specifiers: string[] }>;
    files: Array<{ path: string }>;
  } | null;
  projectionEnabled: boolean;
  projectionData: ProjectionData | null;

  setGraphData: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  setViewDepth: (depth: ViewDepth) => void;
  toggleExpand: (nodeId: string) => void;
  setFilter: (filter: Partial<GraphState['filter']>) => void;
  applyDiff: (diff: ArchitectureDiff) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setTrellisMode: (mode: TrellisMode) => void;
  setScopePath: (scopePath: string | null) => void;
  setBaselineMode: (mode: BaselineMode) => void;
  setBaselineReference: (data: { commitHash: string | null; shortCommitHash: string | null }) => void;
  setCurrentSnapshot: (data: GraphState['currentSnapshot']) => void;
  toggleProjection: () => void;
  setProjectionData: (data: ProjectionData | null) => void;
  clearGraph: () => void;

  /** Phase 17.C — multi-select on graph for batch planning. */
  selectedNodeIds: string[];
  setSelectedNodeIds: (ids: string[]) => void;
  clearSelection: () => void;

  /** Phase 18 — MCP graph_focus: pending focus target for the canvas. */
  pendingFocus: { path: string; highlight: boolean } | null;
  focusNode: (path: string, highlight?: boolean) => void;
  clearPendingFocus: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  viewDepth: 'package',
  expandedNodes: new Set(),
  filter: {
    language: null,
    packageScope: null,
    searchQuery: '',
  },

  layoutMode: 'map' as LayoutMode,
  trellisMode: 'live' as TrellisMode,
  scopePath: null,
  baselineMode: 'pinned' as BaselineMode,
  baselineCommitHash: null,
  baselineShortCommitHash: null,
  currentSnapshot: null,
  projectionEnabled: false,
  projectionData: null,

  setGraphData: (nodes, edges) => set({ nodes, edges }),
  setViewDepth: (depth) => set({ viewDepth: depth, expandedNodes: new Set() }), // Reset expanded when switching depth
  toggleExpand: (nodeId) =>
    set((s) => {
      const next = new Set(s.expandedNodes);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return { expandedNodes: next };
    }),
  setFilter: (filter) =>
    set((s) => ({ filter: { ...s.filter, ...filter } })),
  applyDiff: (diff) =>
    set((s) => {
      const removedIds = new Set(diff.removedNodes.map((n) => n.id));
      const modifiedMap = new Map(diff.modifiedNodes.map((n) => [n.id, n]));
      const nodes = s.nodes
        .filter((n) => !removedIds.has(n.id))
        .map((n) => modifiedMap.get(n.id) ?? n)
        .concat(diff.addedNodes);

      const removedEdgeIds = new Set(diff.removedEdges.map((e) => e.id));
      const edges = s.edges
        .filter((e) => !removedEdgeIds.has(e.id))
        .concat(diff.addedEdges);

      return { nodes, edges };
    }),
  setLayoutMode: (mode) => set({ layoutMode: mode }),
  setTrellisMode: (mode) => set((s) => {
    // Diff mode is meaningless without the planned overlay — auto-
    // engage projection so the user doesn't have to know about a
    // separate toggle. Other modes leave projection alone.
    if (mode === 'diff' && !s.projectionEnabled && s.projectionData) {
      return { trellisMode: mode, projectionEnabled: true };
    }
    return { trellisMode: mode };
  }),
  setScopePath: (scopePath) => set({ scopePath }),
  setBaselineMode: (mode) => set({ baselineMode: mode }),
  setBaselineReference: (data) => set({
    baselineCommitHash: data.commitHash,
    baselineShortCommitHash: data.shortCommitHash,
  }),
  setCurrentSnapshot: (data) => set({
    currentSnapshot: data,
    baselineCommitHash: data?.commitHash ?? null,
    baselineShortCommitHash: data?.shortCommitHash ?? null,
  }),
  toggleProjection: () => set((s) => ({ projectionEnabled: !s.projectionEnabled })),
  setProjectionData: (data) => set({ projectionData: data }),
  clearGraph: () => set({
    nodes: [],
    edges: [],
    expandedNodes: new Set(),
    projectionData: null,
    currentSnapshot: null,
    baselineCommitHash: null,
    baselineShortCommitHash: null,
    selectedNodeIds: [],
  }),

  // Phase 17.C — multi-select
  selectedNodeIds: [],
  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  clearSelection: () => set({ selectedNodeIds: [] }),

  // Phase 18 — MCP graph_focus
  pendingFocus: null,
  focusNode: (path, highlight = true) => set({ pendingFocus: { path, highlight } }),
  clearPendingFocus: () => set({ pendingFocus: null }),
}));
