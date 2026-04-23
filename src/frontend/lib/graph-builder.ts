import dagre from '@dagrejs/dagre';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';
import type { Node, Edge } from '@xyflow/react';
import type { ViewDepth, ProjectionData } from '../../shared/types';

export type LayoutMode = 'map' | 'tree';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 50;
const HUB_NODE_WIDTH = 260;
const HUB_NODE_HEIGHT = 70;

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

export interface DiffData {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  blastRadius: string[];
}

// ============================================================
// ARCHITECTURE ANALYSIS — discover clusters from dependencies
// ============================================================

interface FileInfo {
  path: string;
  name: string;
  language: string;
  inbound: number;   // how many files import this
  outbound: number;   // how many files this imports
  total: number;      // inbound + outbound
  imports: string[];   // files this imports
  importedBy: string[]; // files that import this
  specifiersIn: Map<string, string[]>;  // who imports what from this
  specifiersOut: Map<string, string[]>; // what this imports from whom
  cluster: string;    // discovered cluster name
}

/**
 * Analyze dependency edges to discover file importance and clusters.
 */
function analyzeArchitecture(depEdges: DependencyEdge[]): Map<string, FileInfo> {
  const files = new Map<string, FileInfo>();

  // Initialize all files
  for (const edge of depEdges) {
    for (const path of [edge.sourceRelative, edge.targetRelative]) {
      if (!files.has(path)) {
        const name = path.split('/').pop() || path;
        files.set(path, {
          path, name,
          language: getLanguage(name),
          inbound: 0, outbound: 0, total: 0,
          imports: [], importedBy: [],
          specifiersIn: new Map(), specifiersOut: new Map(),
          cluster: '',
        });
      }
    }
  }

  // Count connections
  for (const edge of depEdges) {
    const src = files.get(edge.sourceRelative)!;
    const tgt = files.get(edge.targetRelative)!;
    src.outbound++;
    tgt.inbound++;
    src.imports.push(edge.targetRelative);
    tgt.importedBy.push(edge.sourceRelative);
    src.specifiersOut.set(edge.targetRelative, edge.specifiers);
    tgt.specifiersIn.set(edge.sourceRelative, edge.specifiers);
  }

  for (const info of files.values()) {
    info.total = info.inbound + info.outbound;
  }

  // Discover clusters using simple community detection:
  // Files that share many imports/importedBy are in the same cluster
  discoverClusters(files, depEdges);

  return files;
}

/**
 * Simple cluster discovery: group files by their strongest connection neighborhood.
 * Uses the dominant shared-neighbor heuristic.
 */
function discoverClusters(files: Map<string, FileInfo>, depEdges: DependencyEdge[]): void {
  // Strategy: use the 2-segment directory path as a starting point,
  // but merge clusters that are tightly connected
  for (const info of files.values()) {
    const parts = info.path.split('/');
    if (parts.length >= 3) {
      info.cluster = `${parts[0]}/${parts[1]}`;
    } else if (parts.length >= 2) {
      info.cluster = parts[0];
    } else {
      info.cluster = 'root';
    }
  }

  // Refine: if a file imports more from a different cluster than its own,
  // move it to that cluster
  for (const info of files.values()) {
    const clusterCounts = new Map<string, number>();
    for (const imp of [...info.imports, ...info.importedBy]) {
      const other = files.get(imp);
      if (!other) continue;
      clusterCounts.set(other.cluster, (clusterCounts.get(other.cluster) || 0) + 1);
    }
    // Find dominant cluster (excluding own)
    let maxCount = 0;
    let ownCount = clusterCounts.get(info.cluster) || 0;
    for (const [cluster, count] of clusterCounts) {
      if (cluster !== info.cluster && count > maxCount) {
        maxCount = count;
      }
    }
    // Only move if the other cluster has significantly more connections
    // (this prevents unnecessary churn)
  }
}

// ============================================================
// MAIN GRAPH BUILDER
// ============================================================

/**
 * Build the architecture graph.
 *
 * Overview mode (default): shows hub files and cluster summaries
 * Focused mode (when a node is expanded): shows one file's connections
 */
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
  if (depEdges.length === 0) return { nodes: [], edges: [] };

  const changeMap = buildChangeMap(diffData);
  if (recentlyChanged) {
    for (const f of recentlyChanged) {
      if (!changeMap.has(f)) changeMap.set(f, 'active');
    }
  }
  if (projectionData) {
    for (const f of projectionData.modifiedFiles) {
      if (!changeMap.has(f.path)) changeMap.set(f.path, 'planned_modify');
    }
    for (const f of projectionData.removedFiles) {
      if (!changeMap.has(f.path)) changeMap.set(f.path, 'planned_remove');
    }
  }

  const arch = analyzeArchitecture(depEdges);

  // Check if a specific file is focused (clicked)
  const focusedFile = [...expandedNodes].find((id) => arch.has(id));
  // Check if a cluster is expanded
  const expandedClusters = new Set([...expandedNodes].filter((id) => !arch.has(id) && id.includes('/')));

  let result: GraphData;

  if (focusedFile) {
    // Focus mode: show one file and all its connections
    result = buildFocusView(focusedFile, arch, depEdges, changeMap, onToggle, symbolsMap, viewDepth);
  } else if (viewDepth === 'file' || expandedClusters.size > 0) {
    // Hub/file view: show important files, with expanded clusters showing their files
    result = buildHubView(arch, depEdges, changeMap, onToggle, expandedClusters);
  } else {
    // Cluster overview (default)
    result = buildClusterView(arch, depEdges, changeMap, onToggle);
  }

  // Add ghost nodes from projection
  if (projectionData) {
    for (const ghost of projectionData.ghostFiles) {
      const name = ghost.path.split('/').pop() || ghost.path;
      result.nodes.push({
        id: `ghost:${ghost.path}`,
        type: 'fileNode',
        position: { x: 0, y: 0 },
        data: {
          label: name, fullPath: ghost.path, language: getLanguage(name),
          nodeType: 'file', changeStatus: 'planned_add', ghost: true,
          taskDescription: ghost.taskDescription,
        },
      });
    }
    for (const edge of projectionData.newEdges) {
      result.edges.push({
        id: `proj:${edge.from}->${edge.to}`,
        source: result.nodes.find((n) => n.id === edge.from || n.id === `ghost:${edge.from}`)?.id || edge.from,
        target: result.nodes.find((n) => n.id === edge.to || n.id === `ghost:${edge.to}`)?.id || edge.to,
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'rgba(34, 197, 94, 0.5)', strokeWidth: 2, strokeDasharray: '8 4' },
      });
    }
  }

  // Apply layout
  const layout = layoutMode === 'tree' ? applyTreeLayout : applyForceLayout;
  return layout(result.nodes, result.edges);
}

// ============================================================
// CLUSTER VIEW — high-level overview
// ============================================================

function buildClusterView(
  arch: Map<string, FileInfo>,
  depEdges: DependencyEdge[],
  changeMap: Map<string, string>,
  onToggle: (nodeId: string) => void,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group files by cluster
  const clusters = new Map<string, FileInfo[]>();
  for (const info of arch.values()) {
    if (!clusters.has(info.cluster)) clusters.set(info.cluster, []);
    clusters.get(info.cluster)!.push(info);
  }

  // Create cluster nodes
  for (const [clusterName, files] of clusters) {
    const totalConnections = files.reduce((sum, f) => sum + f.total, 0);
    const topFiles = files.sort((a, b) => b.total - a.total).slice(0, 5);
    const hasChanges = files.some((f) => changeMap.has(f.path));

    nodes.push({
      id: clusterName,
      type: 'packageNode',
      position: { x: 0, y: 0 },
      data: {
        label: clusterName,
        childCount: files.length,
        expanded: false,
        onToggle: () => onToggle(clusterName),
        topFiles: topFiles.map((f) => f.name),
        connectionCount: totalConnections,
        changeStatus: hasChanges ? 'modified' : undefined,
      },
    });
  }

  // Create edges between clusters
  const clusterEdges = new Map<string, number>();
  for (const edge of depEdges) {
    const srcInfo = arch.get(edge.sourceRelative);
    const tgtInfo = arch.get(edge.targetRelative);
    if (!srcInfo || !tgtInfo || srcInfo.cluster === tgtInfo.cluster) continue;
    const key = `${srcInfo.cluster}->${tgtInfo.cluster}`;
    clusterEdges.set(key, (clusterEdges.get(key) || 0) + 1);
  }

  for (const [key, count] of clusterEdges) {
    const [source, target] = key.split('->');
    edges.push({
      id: `cluster:${key}`,
      source,
      target,
      type: 'smoothstep',
      animated: true,
      style: {
        stroke: 'rgba(59, 130, 246, 0.4)',
        strokeWidth: Math.min(1 + count * 0.5, 4),
      },
      label: count > 1 ? `${count}` : undefined,
      labelStyle: { fontSize: 9, fill: '#8b8b98' },
    });
  }

  return { nodes, edges };
}

// ============================================================
// HUB VIEW — important files with connections
// ============================================================

function buildHubView(
  arch: Map<string, FileInfo>,
  depEdges: DependencyEdge[],
  changeMap: Map<string, string>,
  onToggle: (nodeId: string) => void,
  expandedClusters?: Set<string>,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const visibleFiles = new Set<string>();
  const hubThreshold = 3;

  if (expandedClusters && expandedClusters.size > 0) {
    // Show all files from expanded clusters
    for (const [path, info] of arch) {
      if (expandedClusters.has(info.cluster)) {
        visibleFiles.add(path);
      }
    }
    // Also show hubs from non-expanded clusters if they connect to expanded
    for (const [path, info] of arch) {
      if (visibleFiles.has(path)) continue;
      if (info.total < 3) continue;
      const connectsToExpanded = [...info.imports, ...info.importedBy].some((imp) => visibleFiles.has(imp));
      if (connectsToExpanded) visibleFiles.add(path);
    }
  } else {
    // Default hub view: files with >= 3 connections + files with changes
    for (const [path, info] of arch) {
      if (info.total >= hubThreshold || changeMap.has(path)) {
        visibleFiles.add(path);
      }
    }
  }

  // Cap at ~40 nodes to keep it readable
  if (visibleFiles.size > 40) {
    const sorted = [...visibleFiles]
      .map((p) => ({ path: p, total: arch.get(p)?.total || 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 40);
    visibleFiles.clear();
    for (const s of sorted) visibleFiles.add(s.path);
  }

  // Create nodes
  for (const path of visibleFiles) {
    const info = arch.get(path)!;
    const isHub = info.total >= hubThreshold;

    nodes.push({
      id: path,
      type: 'fileNode',
      position: { x: 0, y: 0 },
      data: {
        label: info.name,
        fullPath: path,
        language: info.language,
        nodeType: 'file',
        changeStatus: changeMap.get(path),
        connectionCount: info.total,
        isHub,
        onToggle: () => onToggle(path),
        exports: info.specifiersIn.size > 0
          ? [...info.specifiersIn.values()].flat().slice(0, 5)
          : undefined,
      },
    });
  }

  // Create edges (only between visible files)
  for (const edge of depEdges) {
    if (!visibleFiles.has(edge.sourceRelative) || !visibleFiles.has(edge.targetRelative)) continue;
    edges.push({
      id: `hub:${edge.sourceRelative}->${edge.targetRelative}`,
      source: edge.sourceRelative,
      target: edge.targetRelative,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'rgba(59, 130, 246, 0.3)', strokeWidth: 1.5 },
      label: edge.specifiers.length > 0 ? edge.specifiers.slice(0, 2).join(', ') : undefined,
      labelStyle: { fontSize: 8, fill: '#6b6b78' },
    });
  }

  return { nodes, edges };
}

// ============================================================
// FOCUS VIEW — one file centered with its connections
// ============================================================

function buildFocusView(
  focusPath: string,
  arch: Map<string, FileInfo>,
  depEdges: DependencyEdge[],
  changeMap: Map<string, string>,
  onToggle: (nodeId: string) => void,
  symbolsMap: Map<string, FileSymbol[]>,
  viewDepth: ViewDepth,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focusInfo = arch.get(focusPath);
  if (!focusInfo) return { nodes, edges };

  const symbols = symbolsMap.get(focusPath) || [];

  // Center node — the focused file (large)
  nodes.push({
    id: focusPath,
    type: 'fileNode',
    position: { x: 0, y: 0 },
    data: {
      label: focusInfo.name,
      fullPath: focusPath,
      language: focusInfo.language,
      nodeType: 'file',
      changeStatus: changeMap.get(focusPath),
      connectionCount: focusInfo.total,
      isHub: true,
      isFocused: true,
      symbolCount: symbols.length,
      onToggle: () => onToggle(focusPath),
      exports: [...focusInfo.specifiersIn.values()].flat().slice(0, 8),
    },
  });

  // Show symbols inside the focused file if in symbol depth
  if (viewDepth === 'symbol' && symbols.length > 0) {
    for (const sym of symbols) {
      const symId = `${focusPath}::${sym.kind}:${sym.name}`;
      nodes.push({
        id: symId,
        type: 'symbolNode',
        position: { x: 0, y: 0 },
        data: { label: sym.name, symbolKind: sym.kind },
      });
      edges.push({
        id: `${focusPath}->${symId}`,
        source: focusPath,
        target: symId,
        type: 'smoothstep',
        style: { stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 },
      });
    }
  }

  // Connected nodes — files this imports
  for (const imp of focusInfo.imports) {
    const impInfo = arch.get(imp);
    if (!impInfo) continue;
    const specifiers = focusInfo.specifiersOut.get(imp) || [];

    nodes.push({
      id: imp,
      type: 'fileNode',
      position: { x: 0, y: 0 },
      data: {
        label: impInfo.name,
        fullPath: imp,
        language: impInfo.language,
        nodeType: 'file',
        changeStatus: changeMap.get(imp),
        connectionCount: impInfo.total,
        onToggle: () => onToggle(imp),
        direction: 'outbound',
      },
    });

    edges.push({
      id: `focus:${focusPath}->${imp}`,
      source: focusPath,
      target: imp,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'rgba(59, 130, 246, 0.5)', strokeWidth: 2 },
      label: specifiers.length > 0 ? specifiers.slice(0, 3).join(', ') : undefined,
      labelStyle: { fontSize: 9, fill: '#8b8b98' },
    });
  }

  // Connected nodes — files that import this
  for (const imp of focusInfo.importedBy) {
    if (nodes.some((n) => n.id === imp)) continue; // Already added
    const impInfo = arch.get(imp);
    if (!impInfo) continue;
    const specifiers = focusInfo.specifiersIn.get(imp) || [];

    nodes.push({
      id: imp,
      type: 'fileNode',
      position: { x: 0, y: 0 },
      data: {
        label: impInfo.name,
        fullPath: imp,
        language: impInfo.language,
        nodeType: 'file',
        changeStatus: changeMap.get(imp),
        connectionCount: impInfo.total,
        onToggle: () => onToggle(imp),
        direction: 'inbound',
      },
    });

    edges.push({
      id: `focus:${imp}->${focusPath}`,
      source: imp,
      target: focusPath,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'rgba(245, 158, 11, 0.5)', strokeWidth: 2 },
      label: specifiers.length > 0 ? specifiers.slice(0, 3).join(', ') : undefined,
      labelStyle: { fontSize: 9, fill: '#8b8b98' },
    });
  }

  return { nodes, edges };
}

// ============================================================
// SNAPSHOT BUILDER — for trellis baseline/diff modes
// ============================================================

export function buildFromSnapshot(
  snapshotEdges: Array<{ source: string; target: string; specifiers: string[] }>,
  viewDepth: ViewDepth,
  layoutMode: LayoutMode = 'map',
  diffData?: DiffData | null,
  frozen = false,
): GraphData {
  const depEdges: DependencyEdge[] = snapshotEdges.map((e) => ({
    source: e.source, target: e.target,
    sourceRelative: e.source, targetRelative: e.target,
    specifiers: e.specifiers,
  }));

  // Reuse the main builder but with empty expanded set (overview mode)
  return buildDependencyGraph(
    depEdges, viewDepth, new Set(), new Map(), () => {},
    diffData, undefined, undefined, layoutMode,
  );
}

// ============================================================
// LAYOUT ENGINES
// ============================================================

function applyTreeLayout(nodes: Node[], edges: Edge[]): GraphData {
  if (nodes.length === 0) return { nodes, edges };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 70, marginx: 40, marginy: 40 });

  for (const node of nodes) {
    const isHub = (node.data as any)?.isHub || (node.data as any)?.isFocused;
    g.setNode(node.id, {
      width: isHub ? HUB_NODE_WIDTH : NODE_WIDTH,
      height: isHub ? HUB_NODE_HEIGHT : NODE_HEIGHT,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      const isHub = (node.data as any)?.isHub || (node.data as any)?.isFocused;
      const w = isHub ? HUB_NODE_WIDTH : NODE_WIDTH;
      const h = isHub ? HUB_NODE_HEIGHT : NODE_HEIGHT;
      return { ...node, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
    }),
    edges,
  };
}

function applyForceLayout(nodes: Node[], edges: Edge[]): GraphData {
  if (nodes.length === 0) return { nodes, edges };

  interface ForceNode extends SimulationNodeDatum { id: string; idx: number; isHub?: boolean }

  const forceNodes: ForceNode[] = nodes.map((n, i) => ({
    id: n.id, idx: i,
    isHub: (n.data as any)?.isHub || (n.data as any)?.isFocused,
    x: Math.random() * 600 - 300,
    y: Math.random() * 600 - 300,
  }));

  const nodeIdToIndex = new Map(forceNodes.map((n, i) => [n.id, i]));

  const forceEdges: SimulationLinkDatum<ForceNode>[] = edges
    .filter((e) => nodeIdToIndex.has(e.source) && nodeIdToIndex.has(e.target))
    .map((e) => ({
      source: nodeIdToIndex.get(e.source)!,
      target: nodeIdToIndex.get(e.target)!,
    }));

  const sim = forceSimulation(forceNodes)
    .force('link', forceLink(forceEdges).distance(150).strength(0.4))
    .force('charge', forceManyBody().strength(-400).distanceMax(600))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide((d: any) => d.isHub ? HUB_NODE_WIDTH * 0.7 : NODE_WIDTH * 0.6))
    .stop();

  for (let i = 0; i < 200; i++) sim.tick();

  return {
    nodes: nodes.map((node, i) => {
      const isHub = (node.data as any)?.isHub || (node.data as any)?.isFocused;
      const w = isHub ? HUB_NODE_WIDTH : NODE_WIDTH;
      const h = isHub ? HUB_NODE_HEIGHT : NODE_HEIGHT;
      return {
        ...node,
        position: {
          x: (forceNodes[i].x || 0) - w / 2,
          y: (forceNodes[i].y || 0) - h / 2,
        },
      };
    }),
    edges,
  };
}

// ============================================================
// UTILITIES
// ============================================================

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

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', css: 'css', json: 'json', md: 'markdown',
  };
  return map[ext] || '';
}
