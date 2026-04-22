import dagre from '@dagrejs/dagre';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';
import type { Node, Edge } from '@xyflow/react';
import type { ViewDepth, ProjectionData } from '../../shared/types';

export type LayoutMode = 'map' | 'tree';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 44;

export interface DependencyEdge {
  source: string;
  target: string;
  sourceRelative: string;
  targetRelative: string;
  specifiers: string[];
}

export interface FileSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers?: string[];
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Build a dependency graph from file-to-file import edges.
 *
 * Package view: group files by top-level directory, show edges between groups
 * File view: each file is a node, import arrows between them
 * Symbol view: files + their symbols as child nodes
 */
export interface DiffData {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  blastRadius: string[];
}

export function buildDependencyGraph(
  depEdges: DependencyEdge[],
  viewDepth: ViewDepth,
  expandedNodes: Set<string>,
  symbolsMap: Map<string, FileSymbol[]>,
  onToggle: (nodeId: string) => void,
  diffData?: DiffData | null,
  recentlyChanged?: Set<string>,
  projectionData?: ProjectionData | null,
  layoutMode: LayoutMode = 'map',
): GraphData {
  const changeMap = buildChangeMap(diffData);
  if (recentlyChanged) {
    for (const f of recentlyChanged) {
      if (!changeMap.has(f)) changeMap.set(f, 'active');
    }
  }
  // Apply projection data to change map
  if (projectionData) {
    for (const f of projectionData.modifiedFiles) {
      if (!changeMap.has(f.path)) changeMap.set(f.path, 'planned_modify');
    }
    for (const f of projectionData.removedFiles) {
      if (!changeMap.has(f.path)) changeMap.set(f.path, 'planned_remove');
    }
  }

  const layout = layoutMode === 'tree' ? applyTreeLayout : applyForceLayout;

  let result: GraphData;
  if (viewDepth === 'package') {
    result = buildPackageView(depEdges, expandedNodes, onToggle, changeMap, layout);
  } else {
    result = buildFileView(depEdges, viewDepth, expandedNodes, symbolsMap, onToggle, changeMap, layout);
  }

  // Add ghost nodes and edges from projection
  if (projectionData) {
    for (const ghost of projectionData.ghostFiles) {
      const name = ghost.path.split('/').pop() || ghost.path;
      result.nodes.push({
        id: `ghost:${ghost.path}`,
        type: 'fileNode',
        position: { x: 0, y: 0 },
        data: {
          label: name,
          fullPath: ghost.path,
          language: getLanguage(name),
          nodeType: 'file',
          changeStatus: 'planned_add',
          ghost: true,
          taskDescription: ghost.taskDescription,
        },
      });
    }
    for (const edge of projectionData.newEdges) {
      const sourceId = result.nodes.find((n) => n.id === edge.from || n.id === `ghost:${edge.from}`)?.id || edge.from;
      const targetId = result.nodes.find((n) => n.id === edge.to || n.id === `ghost:${edge.to}`)?.id || edge.to;
      result.edges.push({
        id: `proj:${edge.from}->${edge.to}`,
        source: sourceId,
        target: targetId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'rgba(34, 197, 94, 0.4)', strokeWidth: 2, strokeDasharray: '6 3' },
      });
    }
    // Re-layout with the new nodes
    result = layout(result.nodes, result.edges);
  }

  return result;
}

function buildChangeMap(diffData?: DiffData | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!diffData) return map;
  for (const f of diffData.addedFiles) map.set(f, 'added');
  for (const f of diffData.removedFiles) map.set(f, 'removed');
  for (const f of diffData.modifiedFiles) map.set(f, 'modified');
  for (const f of diffData.blastRadius) {
    if (!map.has(f)) map.set(f, 'affected');
  }
  return map;
}

/**
 * Package view: group files by their top-level directory (e.g. src/backend, src/frontend)
 * and show edges between groups.
 */
function buildPackageView(
  depEdges: DependencyEdge[],
  expandedNodes: Set<string>,
  onToggle: (nodeId: string) => void,
  changeMap: Map<string, string>,
  layoutFn: (nodes: Node[], edges: Edge[]) => GraphData = applyTreeLayout,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Collect all files and group by top-level dir
  const allFiles = new Set<string>();
  for (const e of depEdges) {
    allFiles.add(e.sourceRelative);
    allFiles.add(e.targetRelative);
  }

  const groups = new Map<string, Set<string>>();
  for (const file of allFiles) {
    const parts = file.split('/');
    // Group by first 2 path segments (e.g. "src/backend", "src/frontend", "docs")
    const group = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group)!.add(file);
  }

  // Create group nodes
  for (const [group, files] of groups) {
    const isExpanded = expandedNodes.has(group);
    nodes.push({
      id: group,
      type: 'packageNode',
      position: { x: 0, y: 0 },
      data: {
        label: group,
        childCount: files.size,
        expanded: isExpanded,
        onToggle: () => onToggle(group),
      },
    });

    // If expanded, show individual files
    if (isExpanded) {
      for (const file of files) {
        const name = file.split('/').pop() || file;
        const lang = getLanguage(name);
        nodes.push({
          id: file,
          type: 'fileNode',
          position: { x: 0, y: 0 },
          data: { label: name, language: lang, nodeType: 'file', changeStatus: changeMap.get(file) },
        });
        edges.push({
          id: `${group}->${file}`,
          source: group,
          target: file,
          type: 'smoothstep',
          style: { stroke: '#3f3f46', strokeWidth: 1 },
        });
      }
    }
  }

  // Create edges between groups (or between files if both groups expanded)
  const seenGroupEdges = new Set<string>();
  for (const dep of depEdges) {
    const srcParts = dep.sourceRelative.split('/');
    const tgtParts = dep.targetRelative.split('/');
    const srcGroup = srcParts.length >= 3 ? `${srcParts[0]}/${srcParts[1]}` : srcParts[0];
    const tgtGroup = tgtParts.length >= 3 ? `${tgtParts[0]}/${tgtParts[1]}` : tgtParts[0];

    if (srcGroup === tgtGroup) {
      // Intra-group: only show if group is expanded
      if (expandedNodes.has(srcGroup)) {
        const edgeId = `dep:${dep.sourceRelative}->${dep.targetRelative}`;
        edges.push({
          id: edgeId,
          source: dep.sourceRelative,
          target: dep.targetRelative,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#3b82f6', strokeWidth: 1.5 },
          label: dep.specifiers.length > 0 ? dep.specifiers.slice(0, 2).join(', ') : undefined,
          labelStyle: { fontSize: 9, fill: '#a1a1aa' },
        });
      }
      continue;
    }

    // Inter-group edge
    const srcNode = expandedNodes.has(srcGroup) ? dep.sourceRelative : srcGroup;
    const tgtNode = expandedNodes.has(tgtGroup) ? dep.targetRelative : tgtGroup;
    const edgeKey = `${srcNode}->${tgtNode}`;

    if (!seenGroupEdges.has(edgeKey)) {
      seenGroupEdges.add(edgeKey);
      edges.push({
        id: `dep:${edgeKey}`,
        source: srcNode,
        target: tgtNode,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#3b82f6', strokeWidth: 1.5 },
      });
    }
  }

  return layoutFn(nodes, edges);
}

/**
 * File view: every file involved in an import is a node,
 * import relationships are directed edges.
 */
function buildFileView(
  depEdges: DependencyEdge[],
  viewDepth: ViewDepth,
  expandedNodes: Set<string>,
  symbolsMap: Map<string, FileSymbol[]>,
  onToggle: (nodeId: string) => void,
  changeMap: Map<string, string>,
  layoutFn: (nodes: Node[], edges: Edge[]) => GraphData = applyTreeLayout,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Collect all files
  const fileSet = new Set<string>();
  for (const e of depEdges) {
    fileSet.add(e.sourceRelative);
    fileSet.add(e.targetRelative);
  }

  // Create file nodes
  for (const file of fileSet) {
    const name = file.split('/').pop() || file;
    const lang = getLanguage(name);
    const isExpanded = expandedNodes.has(file);
    const symbols = symbolsMap.get(file) || [];

    nodes.push({
      id: file,
      type: 'fileNode',
      position: { x: 0, y: 0 },
      data: {
        label: name,
        fullPath: file,
        language: lang,
        nodeType: 'file',
        symbolCount: symbols.length,
        expanded: isExpanded,
        changeStatus: changeMap.get(file),
        onToggle: viewDepth === 'symbol' ? () => onToggle(file) : undefined,
      },
    });

    // Show symbols if expanded in symbol view
    if (viewDepth === 'symbol' && isExpanded && symbols.length > 0) {
      for (const sym of symbols) {
        const symId = `${file}::${sym.kind}:${sym.name}`;
        nodes.push({
          id: symId,
          type: 'symbolNode',
          position: { x: 0, y: 0 },
          data: { label: sym.name, symbolKind: sym.kind },
        });
        edges.push({
          id: `${file}->${symId}`,
          source: file,
          target: symId,
          type: 'smoothstep',
          style: { stroke: '#27272a', strokeWidth: 1 },
        });
      }
    }
  }

  // Create import edges
  for (const dep of depEdges) {
    edges.push({
      id: `dep:${dep.sourceRelative}->${dep.targetRelative}`,
      source: dep.sourceRelative,
      target: dep.targetRelative,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#3b82f6', strokeWidth: 1.5 },
      label: dep.specifiers.length > 0 ? dep.specifiers.slice(0, 3).join(', ') : undefined,
      labelStyle: { fontSize: 9, fill: '#a1a1aa' },
    });
  }

  return layoutFn(nodes, edges);
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', css: 'css', json: 'json', md: 'markdown',
  };
  return map[ext] || '';
}

/**
 * Build a graph from a frozen trellis snapshot.
 * Used for "Current" (baseline) and "Diff" modes.
 */
export function buildFromSnapshot(
  snapshotEdges: Array<{ source: string; target: string; specifiers: string[] }>,
  viewDepth: ViewDepth,
  layoutMode: LayoutMode = 'map',
  diffData?: DiffData | null,
  frozen = false,
): GraphData {
  // Convert snapshot edges to DependencyEdge format
  const depEdges: DependencyEdge[] = snapshotEdges.map((e) => ({
    source: e.source,
    target: e.target,
    sourceRelative: e.source,
    targetRelative: e.target,
    specifiers: e.specifiers,
  }));

  const changeMap = buildChangeMap(diffData);
  const layout = layoutMode === 'tree' ? applyTreeLayout : applyForceLayout;

  // Build file view from snapshot edges (package view groups them)
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (viewDepth === 'package') {
    // Group by top-level dir
    const allFiles = new Set<string>();
    for (const e of depEdges) {
      allFiles.add(e.sourceRelative);
      allFiles.add(e.targetRelative);
    }

    const groups = new Map<string, Set<string>>();
    for (const file of allFiles) {
      const parts = file.split('/');
      const group = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
      if (!groups.has(group)) groups.set(group, new Set());
      groups.get(group)!.add(file);
    }

    for (const [group, files] of groups) {
      nodes.push({
        id: group,
        type: 'packageNode',
        position: { x: 0, y: 0 },
        data: { label: group, childCount: files.size, expanded: false, frozen },
      });
    }

    const seenEdges = new Set<string>();
    for (const dep of depEdges) {
      const srcParts = dep.sourceRelative.split('/');
      const tgtParts = dep.targetRelative.split('/');
      const srcGroup = srcParts.length >= 3 ? `${srcParts[0]}/${srcParts[1]}` : srcParts[0];
      const tgtGroup = tgtParts.length >= 3 ? `${tgtParts[0]}/${tgtParts[1]}` : tgtParts[0];
      if (srcGroup === tgtGroup) continue;
      const key = `${srcGroup}->${tgtGroup}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        id: `snap:${key}`,
        source: srcGroup,
        target: tgtGroup,
        type: 'smoothstep',
        animated: !frozen,
        style: { stroke: frozen ? '#3f3f46' : '#3b82f6', strokeWidth: frozen ? 1 : 1.5, opacity: frozen ? 0.5 : 1 },
      });
    }
  } else {
    // File view
    const fileSet = new Set<string>();
    for (const e of depEdges) {
      fileSet.add(e.sourceRelative);
      fileSet.add(e.targetRelative);
    }

    for (const file of fileSet) {
      const name = file.split('/').pop() || file;
      const lang = getLanguage(name);
      const status = changeMap.get(file);
      nodes.push({
        id: file,
        type: 'fileNode',
        position: { x: 0, y: 0 },
        data: {
          label: name,
          fullPath: file,
          language: lang,
          nodeType: 'file',
          changeStatus: status,
          frozen,
        },
      });
    }

    for (const dep of depEdges) {
      edges.push({
        id: `snap:${dep.sourceRelative}->${dep.targetRelative}`,
        source: dep.sourceRelative,
        target: dep.targetRelative,
        type: 'smoothstep',
        animated: !frozen,
        style: { stroke: frozen ? '#3f3f46' : '#3b82f6', strokeWidth: frozen ? 1 : 1.5, opacity: frozen ? 0.5 : 1 },
      });
    }
  }

  return layout(nodes, edges);
}

function applyTreeLayout(nodes: Node[], edges: Edge[]): GraphData {
  if (nodes.length === 0) return { nodes, edges };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 30, marginy: 30 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Force-directed layout — organic, map-like positioning.
 * Nodes repel each other, edges act as springs.
 */
function applyForceLayout(nodes: Node[], edges: Edge[]): GraphData {
  if (nodes.length === 0) return { nodes, edges };

  interface ForceNode extends SimulationNodeDatum {
    id: string;
    nodeIndex: number;
  }

  const forceNodes: ForceNode[] = nodes.map((n, i) => ({
    id: n.id,
    nodeIndex: i,
    x: Math.random() * 800 - 400,
    y: Math.random() * 800 - 400,
  }));

  const nodeIdToIndex = new Map(forceNodes.map((n, i) => [n.id, i]));

  const forceEdges: SimulationLinkDatum<ForceNode>[] = edges
    .filter((e) => nodeIdToIndex.has(e.source) && nodeIdToIndex.has(e.target))
    .map((e) => ({
      source: nodeIdToIndex.get(e.source)!,
      target: nodeIdToIndex.get(e.target)!,
    }));

  const sim = forceSimulation(forceNodes)
    .force('link', forceLink(forceEdges).distance(120).strength(0.3))
    .force('charge', forceManyBody().strength(-300).distanceMax(500))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(NODE_WIDTH * 0.6))
    .stop();

  // Run simulation synchronously
  for (let i = 0; i < 150; i++) sim.tick();

  const layoutedNodes = nodes.map((node, i) => ({
    ...node,
    position: {
      x: (forceNodes[i].x || 0) - NODE_WIDTH / 2,
      y: (forceNodes[i].y || 0) - NODE_HEIGHT / 2,
    },
  }));

  return { nodes: layoutedNodes, edges };
}
