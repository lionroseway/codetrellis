/**
 * Phase 33 G3 — which kinds of edge the graph draws.
 *
 * The owner: "graph being able to toggle on or off imports". Three kinds,
 * each turned off on its own beside Overlays and remembered per machine:
 * import edges (one file imports another), cross-system edges (an HTTP
 * call, a SQL table, a subprocess or an env variable joins two places), and
 * symbol links (a file to the symbols drawn inside it). Pure.
 */

export type EdgeKind = 'imports' | 'crossSystem' | 'symbolLinks';

export const EDGE_KINDS: ReadonlyArray<{ id: EdgeKind; label: string; hint: string }> = [
  { id: 'imports', label: 'Imports', hint: 'One file imports another (solid)' },
  { id: 'crossSystem', label: 'Cross-system', hint: 'HTTP, SQL, subprocess and env links between places (dotted, by protocol)' },
  { id: 'symbolLinks', label: 'Symbol links', hint: 'A file to the symbols drawn inside it' },
];

export const ALL_EDGE_KINDS: readonly EdgeKind[] = EDGE_KINDS.map((k) => k.id);

/** The kinds that are on, from what was saved; unknown ids are dropped, nothing saved means all. */
export function parseEdgeKinds(saved: unknown): EdgeKind[] {
  if (!Array.isArray(saved)) return [...ALL_EDGE_KINDS];
  return ALL_EDGE_KINDS.filter((id) => saved.includes(id));
}

/** The kind of a graph edge, from what the graph builder put in its data. */
export function edgeKindOf(edge: { data?: Record<string, unknown> | null }): EdgeKind {
  const d = edge.data ?? {};
  if (d.kind === 'cross_system' || d.importState === 'cross_system') return 'crossSystem';
  if (d.importState === 'symbol_link') return 'symbolLinks';
  return 'imports';
}

/** The edges of the kinds that are on. The same array when every kind is on. */
export function visibleEdges<E extends { data?: Record<string, unknown> | null }>(edges: E[], on: readonly EdgeKind[]): E[] {
  if (ALL_EDGE_KINDS.every((k) => on.includes(k))) return edges;
  return edges.filter((e) => on.includes(edgeKindOf(e)));
}
