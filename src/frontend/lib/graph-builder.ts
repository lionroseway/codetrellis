import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { ViewDepth } from '../../shared/types';

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
): GraphData {
  const changeMap = buildChangeMap(diffData);
  // Mark recently changed files as 'active' if not already in changeMap
  if (recentlyChanged) {
    for (const f of recentlyChanged) {
      if (!changeMap.has(f)) changeMap.set(f, 'active');
    }
  }
  if (viewDepth === 'package') {
    return buildPackageView(depEdges, expandedNodes, onToggle, changeMap);
  }
  return buildFileView(depEdges, viewDepth, expandedNodes, symbolsMap, onToggle, changeMap);
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

  return applyLayout(nodes, edges);
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

  return applyLayout(nodes, edges);
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', css: 'css', json: 'json', md: 'markdown',
  };
  return map[ext] || '';
}

function applyLayout(nodes: Node[], edges: Edge[]): GraphData {
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
