import { create } from 'zustand';
import type { GraphNode, GraphEdge, ViewDepth, ArchitectureDiff, ProjectionData, TrellisMode } from '@shared/types';
import type { LayoutMode } from '../lib/graph-builder';

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
  currentSnapshot: {
    id: number;
    name?: string;
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
  setCurrentSnapshot: (data: GraphState['currentSnapshot']) => void;
  toggleProjection: () => void;
  setProjectionData: (data: ProjectionData | null) => void;
  clearGraph: () => void;
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
  setTrellisMode: (mode) => set({ trellisMode: mode }),
  setCurrentSnapshot: (data) => set({ currentSnapshot: data }),
  toggleProjection: () => set((s) => ({ projectionEnabled: !s.projectionEnabled })),
  setProjectionData: (data) => set({ projectionData: data }),
  clearGraph: () => set({ nodes: [], edges: [], expandedNodes: new Set(), projectionData: null }),
}));
