import { create } from 'zustand';
import type { GraphNode, GraphEdge, ViewDepth, ArchitectureDiff } from '@shared/types';

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

  setGraphData: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  setViewDepth: (depth: ViewDepth) => void;
  toggleExpand: (nodeId: string) => void;
  setFilter: (filter: Partial<GraphState['filter']>) => void;
  applyDiff: (diff: ArchitectureDiff) => void;
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

  setGraphData: (nodes, edges) => set({ nodes, edges }),
  setViewDepth: (depth) => set({ viewDepth: depth }),
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
  clearGraph: () => set({ nodes: [], edges: [], expandedNodes: new Set() }),
}));
