import dagre from '@dagrejs/dagre';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force';
import type { Node, Edge } from '@xyflow/react';
import type { ViewDepth, ProjectionData, TrellisMode } from '../../shared/types';
import { getNodeDimensions, type GraphNodeVisualData } from './graph-visuals';

export type LayoutMode = 'map' | 'tree';

export interface DependencyEdge {
  source: string;
  target: string;
  sourceRelative: string;
  targetRelative: string;
  specifiers: string[];
  /**
   * "import" (language-level) or "cross_system" (HTTP / SQL / …).
   * Defaults to "import" when omitted so existing callers stay valid.
   */
  kind?: 'import' | 'cross_system';
  /** For cross_system edges only — "http" / "sql" / "subprocess". */
  protocol?: string;
  /** Human-readable label, e.g. "GET /api/users". */
  label?: string;
}

export interface FileSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers?: string[];
}

/**
 * One graph element per id. The canvas depends on it.
 *
 * React Flow keys every edge and node by `id`, and React cannot tell two
 * children with the same key apart. On each re-render it keeps one and
 * leaks the other into the DOM, never removing it. The builder emitted
 * duplicate edge ids whenever `depEdges` held two rows for the same pair,
 * which is ordinary: `import type { A }` and `import { b }` from the same
 * module are two rows. The hub view alone produced 24 duplicate ids on
 * this repository.
 *
 * The leak compounded. Every graph rebuild (the 10-second git check,
 * each WebSocket event) and, once viewport culling was on, every pan
 * frame added more copies. One edge was measured at 790 copies in the
 * DOM, with 7,070 edge elements for 126 real edges, and panning at
 * 2.6 fps. Hiding the edge layer alone brought it to 50 fps. This was
 * most of the "graph slows the machine down", and it looked like the
 * glass effect because the stale copies still carried the glow filter.
 *
 * Merges rather than drops: a duplicate edge carries its own imported
 * symbols, and the merged edge should list all of them.
 */
export function uniqueGraph(graph: GraphData): GraphData {
  const nodeIds = new Set<string>();
  const nodes = graph.nodes.filter((n) => {
    if (nodeIds.has(n.id)) return false;
    nodeIds.add(n.id);
    return true;
  });

  const byId = new Map<string, Edge>();
  for (const edge of graph.edges) {
    const prior = byId.get(edge.id);
    if (!prior) {
      byId.set(edge.id, edge);
      continue;
    }
    const a = (prior.data || {}) as { symbols?: string[]; symbolCount?: number };
    const b = (edge.data || {}) as { symbols?: string[]; symbolCount?: number };
    if (!a.symbols && !b.symbols) continue;
    const symbols = uniqueNames([...(a.symbols ?? []), ...(b.symbols ?? [])]);
    byId.set(edge.id, {
      ...prior,
      data: { ...(prior.data || {}), symbols, symbolCount: symbols.length },
    });
  }

  if (nodes.length === graph.nodes.length && byId.size === graph.edges.length) return graph;
  return { ...graph, nodes, edges: [...byId.values()] };
}

/**
 * Order-preserving de-duplication.
 *
 * `specifiersIn` is keyed by importer, so a name imported by three files
 * appears three times when flattened. The file card keys its export chips
 * by name, which made the same React duplicate-key error, once per
 * card per render: over 18,000 console errors in one session.
 */
export function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
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
  addedEdges?: Array<{ source: string; target: string }>;
  removedEdges?: Array<{ source: string; target: string }>;
  git?: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
    stagedAdded: string[];
    stagedModified: string[];
    stagedDeleted: string[];
    unstagedModified: string[];
    unstagedDeleted: string[];
  } | null;
}

const forceLayoutPositions = new Map<string, { x: number; y: number }>();

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
  clusterId: string;
  clusterName: string;
  clusterDescription: string;
}

interface ClusterInfo {
  id: string;
  name: string;
  description: string;
  source: 'inferred';
}

const GENERIC_PATH_SEGMENTS = new Set([
  'src', 'lib', 'app', 'apps', 'packages', 'pkg', 'server', 'client',
  'frontend', 'backend', 'shared', 'common', 'core', 'internal',
]);

const GENERIC_FILE_STEMS = new Set([
  'index', 'main', 'app', 'types', 'utils', 'helpers', 'constants',
]);

/**
 * Analyze dependency edges to discover file importance and clusters.
 */
function analyzeArchitecture(depEdges: DependencyEdge[], extraPaths: string[] = []): Map<string, FileInfo> {
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
          clusterId: '',
          clusterName: '',
          clusterDescription: '',
        });
      }
    }
  }

  for (const path of extraPaths) {
    if (!path || files.has(path)) continue;
    const name = path.split('/').pop() || path;
    files.set(path, {
      path, name,
      language: getLanguage(name),
      inbound: 0, outbound: 0, total: 0,
      imports: [], importedBy: [],
      specifiersIn: new Map(), specifiersOut: new Map(),
      clusterId: '',
      clusterName: '',
      clusterDescription: '',
    });
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
  discoverClusters(files);

  return files;
}

/**
 * Cluster discovery using dependency relationships + path heuristics.
 *
 * Strategy:
 * 1. Start with path-inferred clusters as seeds
 * 2. For each file, check if it imports MORE from a different cluster than its own
 * 3. If so, move it to the cluster it's most connected to
 * 4. This creates "virtual folders" based on actual code relationships
 */
function discoverClusters(files: Map<string, FileInfo>): void {
  // Phase 1: Seed clusters from path inference
  for (const info of files.values()) {
    const cluster = inferCluster(info.path);
    info.clusterId = cluster.id;
    info.clusterName = cluster.name;
    info.clusterDescription = cluster.description;
  }

  // Phase 2: Refine clusters based on dependency connections
  // If a file is more connected to files in another cluster, move it there
  let moved = true;
  let iterations = 0;
  const maxIterations = 5; // Prevent infinite loops

  while (moved && iterations < maxIterations) {
    moved = false;
    iterations++;

    for (const info of files.values()) {
      // Count connections to each cluster
      const clusterConnections = new Map<string, number>();
      const allConnections = [...info.imports, ...info.importedBy];

      for (const connPath of allConnections) {
        const connFile = files.get(connPath);
        if (!connFile) continue;
        const cid = connFile.clusterId;
        clusterConnections.set(cid, (clusterConnections.get(cid) || 0) + 1);
      }

      if (clusterConnections.size === 0) continue;

      // Find the cluster this file is most connected to
      const ownClusterCount = clusterConnections.get(info.clusterId) || 0;
      let bestCluster = info.clusterId;
      let bestCount = ownClusterCount;

      for (const [cid, count] of clusterConnections) {
        if (cid !== info.clusterId && count > bestCount) {
          bestCount = count;
          bestCluster = cid;
        }
      }

      // Only move if the other cluster has significantly more connections (>= 2x)
      if (bestCluster !== info.clusterId && bestCount >= ownClusterCount * 2 && bestCount >= 3) {
        // Find a file in the target cluster to get its name/description
        const targetFile = [...files.values()].find((f) => f.clusterId === bestCluster);
        if (targetFile) {
          info.clusterId = targetFile.clusterId;
          info.clusterName = targetFile.clusterName;
          info.clusterDescription = targetFile.clusterDescription;
          moved = true;
        }
      }
    }
  }

  // Phase 3: Merge tiny clusters (< 2 files) into their most-connected neighbor
  const clusterSizes = new Map<string, number>();
  for (const info of files.values()) {
    clusterSizes.set(info.clusterId, (clusterSizes.get(info.clusterId) || 0) + 1);
  }

  for (const info of files.values()) {
    if ((clusterSizes.get(info.clusterId) || 0) >= 2) continue;

    // This is a singleton cluster — merge into the cluster it's most connected to
    const clusterConnections = new Map<string, number>();
    for (const connPath of [...info.imports, ...info.importedBy]) {
      const connFile = files.get(connPath);
      if (!connFile || connFile.clusterId === info.clusterId) continue;
      clusterConnections.set(connFile.clusterId, (clusterConnections.get(connFile.clusterId) || 0) + 1);
    }

    let bestCluster = '';
    let bestCount = 0;
    for (const [cid, count] of clusterConnections) {
      if (count > bestCount) { bestCluster = cid; bestCount = count; }
    }

    if (bestCluster) {
      const targetFile = [...files.values()].find((f) => f.clusterId === bestCluster);
      if (targetFile) {
        info.clusterId = targetFile.clusterId;
        info.clusterName = targetFile.clusterName;
        info.clusterDescription = targetFile.clusterDescription;
      }
    }
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
  trellisMode: TrellisMode = 'live',
  scopePath?: string | null,
): GraphData {
  // Split cross-system edges out before the existing import logic
  // runs. They get appended as their own dashed-pass after layout so
  // they don't get aggregated into cluster→cluster bundles or
  // mistaken for language-level imports.
  const crossSystemDepEdges = depEdges.filter((e) => e.kind === 'cross_system');
  depEdges = depEdges.filter((e) => e.kind !== 'cross_system');

  // Pre-filter edges by scope (relative-path prefix). Cuts the graph
  // to a single subtree before any clustering / layout — drops the
  // visible node + edge counts proportionally and stops the canvas
  // from churning on a whole monorepo at once.
  if (scopePath) {
    const prefix = scopePath.replace(/\/+$/, '') + '/';
    const exact = scopePath.replace(/\/+$/, '');
    depEdges = depEdges.filter((e) =>
      e.sourceRelative === exact || e.sourceRelative.startsWith(prefix)
      || e.targetRelative === exact || e.targetRelative.startsWith(prefix),
    );
  }
  if (depEdges.length === 0 && crossSystemDepEdges.length === 0) return { nodes: [], edges: [] };

  const changeMap = buildChangeMap(diffData);
  const edgeChangeMap = buildEdgeChangeMap(diffData, projectionData);
  const gitStateMap = buildGitStateMap(diffData);
  const liveChangedFiles = collectLiveChangedFiles(diffData);
  const plannedStateMap = buildPlannedStateMap(projectionData);
  if (recentlyChanged) {
    for (const f of recentlyChanged) {
      if (!changeMap.has(f)) changeMap.set(f, 'active');
    }
  }
  if (projectionData && trellisMode !== 'diff') {
    for (const f of projectionData.modifiedFiles) {
      if (!changeMap.has(f.path)) changeMap.set(f.path, 'planned_modify');
    }
    for (const f of projectionData.removedFiles) {
      if (!changeMap.has(f.path)) changeMap.set(f.path, 'planned_remove');
    }
  }

  if (trellisMode === 'diff' && projectionData) {
    for (const [path, plannedState] of plannedStateMap) {
      if (liveChangedFiles.has(path)) {
        changeMap.set(path, 'active');
      } else if (!changeMap.has(path)) {
        changeMap.set(path, plannedState);
      }
    }

    for (const path of liveChangedFiles) {
      if (!plannedStateMap.has(path)) {
        changeMap.set(path, 'unexpected_live');
      }
    }
  }

  const extraPaths = collectStandalonePaths(diffData);
  const arch = analyzeArchitecture(depEdges, extraPaths);

  // Check if a specific file is focused (clicked). Accept the absolute
  // form too: the code reader and `open-file-at` select files by absolute
  // path, and a focus carried from there into Symbols matched nothing.
  const absToRel = new Map<string, string>();
  for (const e of depEdges) {
    absToRel.set(e.source, e.sourceRelative);
    absToRel.set(e.target, e.targetRelative);
  }
  const focusedFile = [...expandedNodes]
    .map((id) => (arch.has(id) ? id : absToRel.get(id)))
    .find((id): id is string => Boolean(id && arch.has(id)));
  // Check if a cluster is expanded
  const expandedClusters = new Set([...expandedNodes].filter((id) => id.startsWith('cluster:')));

  let result: GraphData;

  if (focusedFile) {
    // Focus mode: show one file and all its connections
    result = buildFocusView(focusedFile, arch, depEdges, changeMap, edgeChangeMap, onToggle, symbolsMap, viewDepth);
  } else if (viewDepth === 'file' || viewDepth === 'symbol' || expandedClusters.size > 0) {
    // Symbols with nothing focused shows FILES, not clusters: you pick a
    // file to see its symbols, and a cluster card cannot be picked. This
    // branch used to fall through to the cluster overview, so the Symbols
    // button rendered exactly the Clusters view.
    // Hub/file view: show important files, with expanded clusters showing their files
    result = buildHubView(arch, depEdges, changeMap, edgeChangeMap, onToggle, expandedClusters, Boolean(scopePath));
  } else {
    // Cluster overview (default)
    result = buildClusterView(arch, depEdges, changeMap, edgeChangeMap, onToggle);
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
        type: 'importEdge',
        // Keep the dashed flow on planned-add ghost edges — motion
        // signals "about to happen" and is meaningful.
        animated: true,
        style: { stroke: 'rgba(34, 197, 94, 0.5)', strokeWidth: 2, strokeDasharray: '8 4' },
        data: {
          importState: 'planned_add',
          symbolCount: 1,
        },
      });
    }
  }

  // Cross-system pass — append dashed protocol-tinted edges between
  // the nearest cluster (or file, in deeper views) of each call/route
  // pair. Resolved at the resulting-node granularity so the edge
  // always connects to a visible target.
  if (crossSystemDepEdges.length > 0) {
    appendCrossSystemEdges(result, crossSystemDepEdges);
  }

  // Apply layout
  const layout = layoutMode === 'tree' ? applyTreeLayout : applyForceLayout;
  const laidOut = layout(result.nodes, result.edges);
  return {
    nodes: laidOut.nodes.map((node) => {
      const fullPath = ((node.data || {}) as any).fullPath || '';

      // In "planned" mode, show plan-alignment states (planned_add / planned_modify /
      // planned_remove) instead of raw git states (staged / unstaged / untracked).
      // In "diff" mode, show both.
      let nodeStates: string[];
      if (trellisMode === 'planned') {
        const ps = plannedStateMap.get(node.id) || (fullPath ? plannedStateMap.get(fullPath) : undefined);
        nodeStates = ps ? [ps] : [];
      } else if (trellisMode === 'diff') {
        const git = gitStateMap.get(node.id) || (fullPath ? gitStateMap.get(fullPath) : []) || [];
        const ps = plannedStateMap.get(node.id) || (fullPath ? plannedStateMap.get(fullPath) : undefined);
        nodeStates = ps ? [...git, ps] : git;
      } else {
        nodeStates = gitStateMap.get(node.id) || (fullPath ? gitStateMap.get(fullPath) : []) || [];
      }

      return {
        ...node,
        data: {
          ...(node.data || {}),
          mode: trellisMode,
          gitStates: nodeStates,
        },
      };
    }),
    edges: laidOut.edges,
  };
}

// ============================================================
// CLUSTER VIEW — high-level overview
// ============================================================

function buildClusterView(
  arch: Map<string, FileInfo>,
  depEdges: DependencyEdge[],
  changeMap: Map<string, string>,
  edgeChangeMap: Map<string, 'planned_add' | 'planned_remove' | 'added' | 'removed' | 'unexpected'>,
  onToggle: (nodeId: string) => void,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group files by cluster
  const clusters = new Map<string, FileInfo[]>();
  for (const info of arch.values()) {
    if (!clusters.has(info.clusterId)) clusters.set(info.clusterId, []);
    clusters.get(info.clusterId)!.push(info);
  }

  // Create cluster nodes
  for (const [clusterId, files] of clusters) {
    const primary = files[0];
    const totalConnections = files.reduce((sum, f) => sum + f.total, 0);
    const topFiles = [...files].sort((a, b) => b.total - a.total).slice(0, 5);
    const hasChanges = files.some((f) => changeMap.has(f.path));
    const clusterStatuses = files
      .map((f) => changeMap.get(f.path))
      .filter((status): status is string => Boolean(status));
    const localChangeCount = files.filter((f) => {
      const status = changeMap.get(f.path);
      return status != null && !status.startsWith('planned_');
    }).length;
    const plannedChangeCount = files.filter((f) => changeMap.get(f.path)?.startsWith('planned_')).length;

    nodes.push({
      id: clusterId,
      type: 'packageNode',
      position: { x: 0, y: 0 },
      data: {
        label: primary.clusterName,
        childCount: files.length,
        expanded: false,
        onToggle: () => onToggle(clusterId),
        topFiles: topFiles.map((f) => f.path),
        // Full file list (relative paths) — consumed by Inspector to drill into a cluster
        files: files.map((f) => f.path),
        connectionCount: totalConnections,
        changeStatus: hasChanges ? summarizeClusterChange(clusterStatuses) : undefined,
        nodeType: 'package',
        description: primary.clusterDescription,
        sourceLabel: 'Inferred cluster',
        plannedChangeCount,
        localChangeCount,
      },
    });
  }

  // Create edges between clusters
  const clusterEdges = new Map<string, number>();
  for (const edge of depEdges) {
    const srcInfo = arch.get(edge.sourceRelative);
    const tgtInfo = arch.get(edge.targetRelative);
    if (!srcInfo || !tgtInfo || srcInfo.clusterId === tgtInfo.clusterId) continue;
    const key = `${srcInfo.clusterId}->${tgtInfo.clusterId}`;
    clusterEdges.set(key, (clusterEdges.get(key) || 0) + 1);
  }

  for (const [key, count] of clusterEdges) {
    const [source, target] = key.split('->');
    edges.push({
      id: `cluster:${key}`,
      source,
      target,
      type: 'importEdge',
      animated: false,
      style: {
        stroke: 'rgba(59, 130, 246, 0.4)',
        strokeWidth: Math.min(1 + count * 0.5, 4),
      },
      label: count > 1 ? `${count}` : undefined,
      labelStyle: { fontSize: 9, fill: '#8b8b98' },
      data: {
        importState: edgeChangeMap.get(`${source}->${target}`) || 'regular',
        symbolCount: count,
      },
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
  edgeChangeMap: Map<string, 'planned_add' | 'planned_remove' | 'added' | 'removed' | 'unexpected'>,
  onToggle: (nodeId: string) => void,
  expandedClusters?: Set<string>,
  scoped?: boolean,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const visibleFiles = new Set<string>();
  const hubThreshold = 3;

  if (scoped) {
    // The user has narrowed to a single system / directory via the
    // scope filter — show every file in scope, no hub threshold,
    // no cap. The scope is what makes the count manageable.
    for (const path of arch.keys()) visibleFiles.add(path);
  } else if (expandedClusters && expandedClusters.size > 0) {
    // Show all files from expanded clusters
    for (const [path, info] of arch) {
      if (expandedClusters.has(info.clusterId)) {
        visibleFiles.add(path);
      }
    }
    // Also show hubs from non-expanded clusters if they connect to expanded
    for (const [path, info] of arch) {
      if (visibleFiles.has(path)) continue;
      if (info.total < hubThreshold) continue;
      const connectsToExpanded = [...info.imports, ...info.importedBy].some((imp) => visibleFiles.has(imp));
      if (connectsToExpanded) visibleFiles.add(path);
    }
  } else {
    // Default hub view: files with >= 2 connections OR with changes.
    // Threshold lowered from 3 to 2 so leaf files with one importer
    // don't silently disappear in big repos.
    for (const [path, info] of arch) {
      if (info.total >= 2 || changeMap.has(path)) {
        visibleFiles.add(path);
      }
    }
  }

  // Cap to keep big repos renderable. Skip the cap when scoped — the
  // user explicitly narrowed the view and expects everything in it.
  const NODE_CAP = scoped ? Infinity : 200;
  if (visibleFiles.size > NODE_CAP) {
    const changedFiles = [...visibleFiles].filter((path) => changeMap.has(path));
    const remainingSlots = Math.max(NODE_CAP - changedFiles.length, 0);
    const sorted = [...visibleFiles]
      .filter((path) => !changeMap.has(path))
      .map((p) => ({ path: p, total: arch.get(p)?.total || 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, remainingSlots);
    visibleFiles.clear();
    for (const path of changedFiles) visibleFiles.add(path);
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
          ? uniqueNames([...info.specifiersIn.values()].flat()).slice(0, 5)
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
      type: 'importEdge',
      animated: false,
      style: { stroke: 'rgba(59, 130, 246, 0.3)', strokeWidth: 1.5 },
      label: edge.specifiers.length > 0 ? edge.specifiers.slice(0, 2).join(', ') : undefined,
      labelStyle: { fontSize: 8, fill: '#6b6b78' },
      data: {
        importState: edgeChangeMap.get(`${edge.sourceRelative}->${edge.targetRelative}`) || 'regular',
        symbols: edge.specifiers,
        symbolCount: edge.specifiers.length,
      },
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
  edgeChangeMap: Map<string, 'planned_add' | 'planned_remove' | 'added' | 'removed' | 'unexpected'>,
  onToggle: (nodeId: string) => void,
  symbolsMap: Map<string, FileSymbol[]>,
  viewDepth: ViewDepth,
): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const focusInfo = arch.get(focusPath);
  if (!focusInfo) return { nodes, edges };

  // Array check, not `|| []`: an error body cached as symbols is truthy.
  const loaded = symbolsMap.get(focusPath);
  const symbols = Array.isArray(loaded) ? loaded : [];

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
      exports: uniqueNames([...focusInfo.specifiersIn.values()].flat()).slice(0, 8),
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
        data: { label: sym.name, symbolKind: sym.kind, nodeType: 'symbol' },
      });
      edges.push({
        id: `${focusPath}->${symId}`,
        source: focusPath,
        target: symId,
        type: 'importEdge',
        style: { stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 },
        data: {
          importState: 'symbol_link',
          symbolCount: 1,
        },
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
      type: 'importEdge',
      animated: false,
      style: { stroke: 'rgba(59, 130, 246, 0.5)', strokeWidth: 2 },
      label: specifiers.length > 0 ? specifiers.slice(0, 3).join(', ') : undefined,
      labelStyle: { fontSize: 9, fill: '#8b8b98' },
      data: {
        importState: edgeChangeMap.get(`${focusPath}->${imp}`) || (changeMap.get(imp) === 'planned_add' ? 'planned_add' : 'regular'),
        symbols: specifiers,
        symbolCount: specifiers.length,
        alwaysShowLabel: true,
      },
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
      type: 'importEdge',
      animated: false,
      style: { stroke: 'rgba(245, 158, 11, 0.5)', strokeWidth: 2 },
      label: specifiers.length > 0 ? specifiers.slice(0, 3).join(', ') : undefined,
      labelStyle: { fontSize: 9, fill: '#8b8b98' },
      data: {
        importState: edgeChangeMap.get(`${imp}->${focusPath}`) || (changeMap.get(imp) === 'planned_remove' ? 'planned_remove' : 'regular'),
        symbols: specifiers,
        symbolCount: specifiers.length,
        alwaysShowLabel: true,
      },
    });
  }

  return applyFocusedLayout(nodes, edges, focusPath, viewDepth);
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
  projectionData?: ProjectionData | null,
  scopePath?: string | null,
): GraphData {
  const depEdges: DependencyEdge[] = snapshotEdges.map((e) => ({
    source: e.source, target: e.target,
    sourceRelative: e.source, targetRelative: e.target,
    specifiers: e.specifiers,
  }));

  // Reuse the main builder but with empty expanded set (overview mode)
  const graph = buildDependencyGraph(
    depEdges, viewDepth, new Set(), new Map(), () => {},
    diffData, undefined, projectionData, layoutMode, frozen ? 'current' : projectionData ? 'planned' : 'live', scopePath,
  );

  if (!frozen) return graph;

  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      data: {
        ...(node.data || {}),
        frozen: true,
      },
    })),
    edges: graph.edges,
  };
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
    g.setNode(node.id, {
      ...getNodeDimensions((node.data || {}) as GraphNodeVisualData),
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      const { width: w, height: h } = getNodeDimensions((node.data || {}) as GraphNodeVisualData);
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
    x: forceLayoutPositions.get(n.id)?.x ?? deterministicPosition(n.id, 0),
    y: forceLayoutPositions.get(n.id)?.y ?? deterministicPosition(n.id, 1),
  }));

  const nodeIdToIndex = new Map(forceNodes.map((n, i) => [n.id, i]));

  const forceEdges: SimulationLinkDatum<ForceNode>[] = edges
    .filter((e) => nodeIdToIndex.has(e.source) && nodeIdToIndex.has(e.target))
    .map((e) => ({
      source: nodeIdToIndex.get(e.source)!,
      target: nodeIdToIndex.get(e.target)!,
    }));

  const sim = forceSimulation(forceNodes)
    .force('link', forceLink(forceEdges).distance((link: any) => {
      const source = forceNodes[typeof link.source === 'number' ? link.source : link.source.idx];
      const target = forceNodes[typeof link.target === 'number' ? link.target : link.target.idx];
      const sourceNode = nodes[source.idx];
      const targetNode = nodes[target.idx];
      const sourceWidth = getNodeDimensions((sourceNode.data || {}) as GraphNodeVisualData).width;
      const targetWidth = getNodeDimensions((targetNode.data || {}) as GraphNodeVisualData).width;
      return Math.max(220, (sourceWidth + targetWidth) * 0.62);
    }).strength(0.32))
    .force('charge', forceManyBody().strength(-760).distanceMax(900))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide((d: any) => {
      const node = nodes[d.idx];
      const { width } = getNodeDimensions((node.data || {}) as GraphNodeVisualData);
      return width * 0.76;
    }))
    .stop();

  for (let i = 0; i < 260; i++) sim.tick();

  return {
    nodes: nodes.map((node, i) => {
      const { width: w, height: h } = getNodeDimensions((node.data || {}) as GraphNodeVisualData);
      const x = forceNodes[i].x || 0;
      const y = forceNodes[i].y || 0;
      forceLayoutPositions.set(node.id, { x, y });
      return {
        ...node,
        position: {
          x: x - w / 2,
          y: y - h / 2,
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
  for (const f of diffData.git?.untracked || []) map.set(f, 'added');
  for (const f of diffData.git?.stagedAdded || []) map.set(f, 'added');
  for (const f of diffData.git?.stagedDeleted || []) map.set(f, 'removed');
  for (const f of diffData.git?.unstagedDeleted || []) map.set(f, 'removed');
  for (const f of diffData.git?.stagedModified || []) {
    if (!map.has(f)) map.set(f, 'modified');
  }
  for (const f of diffData.git?.unstagedModified || []) {
    if (!map.has(f)) map.set(f, 'modified');
  }
  for (const f of diffData.blastRadius) {
    if (!map.has(f)) map.set(f, 'affected');
  }
  return map;
}

function buildGitStateMap(diffData?: DiffData | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!diffData?.git) return map;

  const add = (file: string, state: string) => {
    const existing = map.get(file) || [];
    if (!existing.includes(state)) existing.push(state);
    map.set(file, existing);
  };

  for (const file of diffData.git.staged) add(file, 'staged');
  for (const file of diffData.git.unstaged) add(file, 'unstaged');
  for (const file of diffData.git.untracked) add(file, 'untracked');

  return map;
}

/**
 * Append cross-system edges (HTTP / SQL / …) onto the laid-out graph.
 * For each cross-system DependencyEdge, find the visible source +
 * target node — at file depth that's the file node directly; at
 * cluster depth we resolve the file's owning cluster node by walking
 * the result.nodes for one whose `fullPath`/data contains the file
 * path. If neither end has a visible node, we drop the edge silently
 * (the file was scope-filtered or aggregated away).
 */
function appendCrossSystemEdges(result: { nodes: Node[]; edges: Edge[] }, xs: DependencyEdge[]): void {
  // Index visible nodes by every file path they represent. Cluster
  // nodes carry their member files in `data.files`; file/symbol nodes
  // carry the path on `data.fullPath` (or in node.id).
  const fileToNodeId = new Map<string, string>();
  for (const node of result.nodes) {
    const data: any = node.data ?? {};
    if (typeof data.fullPath === 'string') fileToNodeId.set(data.fullPath, node.id);
    if (typeof data.relativePath === 'string') fileToNodeId.set(data.relativePath, node.id);
    if (Array.isArray(data.files)) {
      for (const f of data.files) {
        if (typeof f === 'string') fileToNodeId.set(f, node.id);
        if (typeof f?.path === 'string') fileToNodeId.set(f.path, node.id);
        if (typeof f?.relativePath === 'string') fileToNodeId.set(f.relativePath, node.id);
      }
    }
    // Many node ids ARE the file path — add as a fallback.
    fileToNodeId.set(node.id, node.id);
  }

  const seen = new Set<string>();
  for (const e of xs) {
    const sourceNodeId =
      fileToNodeId.get(e.source) ??
      fileToNodeId.get(e.sourceRelative) ??
      null;
    const targetNodeId =
      fileToNodeId.get(e.target) ??
      fileToNodeId.get(e.targetRelative) ??
      null;
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;

    const key = `${e.protocol}|${sourceNodeId}->${targetNodeId}|${e.label || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tint = protocolTint(e.protocol || 'http');
    result.edges.push({
      id: `xs:${e.protocol}:${sourceNodeId}->${targetNodeId}:${e.label || ''}`,
      source: sourceNodeId,
      target: targetNodeId,
      type: 'importEdge',
      animated: false,
      style: {
        stroke: tint,
        strokeWidth: 1.5,
        strokeDasharray: '4 3',
      },
      label: e.label,
      labelStyle: { fontSize: 9, fill: '#a8a8b0' },
      labelBgStyle: { fill: 'rgba(11, 16, 32, 0.85)' },
      data: {
        importState: 'cross_system',
        kind: 'cross_system',
        protocol: e.protocol,
        symbolCount: 1,
      },
    });
  }
}

function protocolTint(protocol: string): string {
  switch (protocol) {
    case 'http': return 'rgba(167, 139, 250, 0.65)';     // purple
    case 'sql': return 'rgba(251, 191, 36, 0.65)';        // amber
    case 'subprocess': return 'rgba(34, 211, 238, 0.65)'; // cyan
    case 'env': return 'rgba(148, 163, 184, 0.55)';       // slate
    default: return 'rgba(148, 163, 184, 0.5)';
  }
}

function collectLiveChangedFiles(diffData?: DiffData | null): Set<string> {
  return new Set([
    ...(diffData?.addedFiles || []),
    ...(diffData?.removedFiles || []),
    ...(diffData?.modifiedFiles || []),
    ...(diffData?.git?.staged || []),
    ...(diffData?.git?.unstaged || []),
    ...(diffData?.git?.untracked || []),
  ]);
}

function buildPlannedStateMap(projectionData?: ProjectionData | null): Map<string, 'planned_add' | 'planned_modify' | 'planned_remove'> {
  const map = new Map<string, 'planned_add' | 'planned_modify' | 'planned_remove'>();
  if (!projectionData) return map;
  for (const file of projectionData.ghostFiles) map.set(file.path, 'planned_add');
  for (const file of projectionData.modifiedFiles) map.set(file.path, 'planned_modify');
  for (const file of projectionData.removedFiles) map.set(file.path, 'planned_remove');
  return map;
}

/**
 * For every edge that appears in the live graph (or in baseline-but-removed),
 * compute its drift state by crossing live changes with planned changes.
 *
 *   Inputs per "from->to" pair:
 *     liveAdded:   in current live graph but not in baseline (live appearance)
 *     liveRemoved: in baseline but not in current live graph (live deletion)
 *     plannedAdd:  plan says this edge should appear
 *     plannedRemove: plan says this edge should disappear
 *
 *   Output state:
 *     liveAdded   + plannedAdd     => 'added'        (planned and realized — on track)
 *     liveAdded   + !plannedAdd    => 'unexpected'   (drift — appeared without a plan)
 *     liveRemoved + plannedRemove  => 'removed'      (planned and realized — on track)
 *     liveRemoved + !plannedRemove => 'removed'      (drift removal — same red treatment;
 *                                                     not separately rendered today)
 *     plannedAdd alone              => 'planned_add'  (ghost; rendered separately)
 *     plannedRemove (live + base)   => 'planned_remove' (still present, should go)
 *     otherwise                     => no entry → 'regular'
 */
function buildEdgeChangeMap(
  diffData?: DiffData | null,
  projectionData?: ProjectionData | null,
): Map<string, 'planned_add' | 'planned_remove' | 'added' | 'removed' | 'unexpected'> {
  const map = new Map<string, 'planned_add' | 'planned_remove' | 'added' | 'removed' | 'unexpected'>();

  const plannedAddSet = new Set((projectionData?.newEdges || []).map((e) => `${e.from}->${e.to}`));

  // Live appearances: split into "planned & realized" vs "unexpected drift"
  for (const edge of diffData?.addedEdges || []) {
    const key = `${edge.source}->${edge.target}`;
    map.set(key, plannedAddSet.has(key) ? 'added' : 'unexpected');
  }

  // Live removals: keep 'removed' label for both on-track and drift, since
  // absent edges aren't rendered in the live graph today. (Future: render
  // ghost-removed edges in red dashed for unplanned removals.)
  for (const edge of diffData?.removedEdges || []) {
    const key = `${edge.source}->${edge.target}`;
    if (!map.has(key)) map.set(key, 'removed');
  }

  // Planned additions that the agent hasn't done yet — only mark if the edge
  // isn't already in the live state. Ghost rendering handles drawing them.
  for (const edge of projectionData?.newEdges || []) {
    const key = `${edge.from}->${edge.to}`;
    if (!map.has(key)) map.set(key, 'planned_add');
  }

  // Planned removals that are still present — surface as planned_remove so
  // the user sees "should go" without losing visibility of the live state.
  for (const edge of projectionData?.removedEdges || []) {
    const key = `${edge.from}->${edge.to}`;
    if (!map.has(key)) map.set(key, 'planned_remove');
  }

  return map;
}

function applyFocusedLayout(nodes: Node[], edges: Edge[], focusPath: string, viewDepth: ViewDepth): GraphData {
  const focusNode = nodes.find((node) => node.id === focusPath);
  if (!focusNode) return { nodes, edges };

  const inbound = nodes.filter((node) => edges.some((edge) => edge.source === node.id && edge.target === focusPath));
  const outbound = nodes.filter((node) => edges.some((edge) => edge.source === focusPath && edge.target === node.id));
  const symbols = viewDepth === 'symbol'
    ? nodes.filter((node) => typeof node.id === 'string' && node.id.startsWith(`${focusPath}::`))
    : [];

  const positioned = new Map<string, { x: number; y: number }>();
  positioned.set(focusPath, { x: 0, y: 0 });

  const verticalGap = 168;
  const leftX = -360;
  const rightX = 360;
  const symbolY = 260;

  inbound.forEach((node, index) => {
    const centeredIndex = index - (inbound.length - 1) / 2;
    positioned.set(node.id, { x: leftX, y: centeredIndex * verticalGap });
  });

  outbound.forEach((node, index) => {
    const centeredIndex = index - (outbound.length - 1) / 2;
    positioned.set(node.id, { x: rightX, y: centeredIndex * verticalGap });
  });

  symbols.forEach((node, index) => {
    const centeredIndex = index - (symbols.length - 1) / 2;
    positioned.set(node.id, { x: centeredIndex * 220, y: symbolY });
  });

  return {
    nodes: nodes.map((node) => {
      const coords = positioned.get(node.id) || { x: 0, y: 0 };
      const { width, height } = getNodeDimensions((node.data || {}) as GraphNodeVisualData);
      return {
        ...node,
        position: {
          x: coords.x - width / 2,
          y: coords.y - height / 2,
        },
      };
    }),
    edges,
  };
}

function collectStandalonePaths(diffData?: DiffData | null): string[] {
  if (!diffData) return [];
  return [
    ...diffData.addedFiles,
    ...diffData.removedFiles,
    ...diffData.modifiedFiles,
    ...(diffData.git?.staged || []),
    ...(diffData.git?.unstaged || []),
    ...(diffData.git?.untracked || []),
  ];
}

function summarizeClusterChange(statuses: string[]): string {
  if (statuses.includes('unexpected_live')) return 'unexpected_live';
  if (statuses.includes('removed')) return 'removed';
  if (statuses.includes('added')) return 'added';
  if (statuses.includes('modified')) return 'modified';
  if (statuses.includes('active')) return 'active';
  if (statuses.includes('planned_remove')) return 'planned_remove';
  if (statuses.includes('planned_add')) return 'planned_add';
  if (statuses.includes('planned_modify')) return 'planned_modify';
  if (statuses.includes('affected')) return 'affected';
  return 'modified';
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', css: 'css', json: 'json', md: 'markdown',
  };
  return map[ext] || '';
}

function inferCluster(path: string): ClusterInfo {
  const segments = path.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] || path;
  const fileStem = fileName.replace(/\.[^.]+$/, '');
  const normalizedStem = fileStem
    .replace(/\.(spec|test)$/, '')
    .replace(/[-_.]/g, ' ')
    .trim();

  const parent = [...segments]
    .reverse()
    .find((segment) => !GENERIC_PATH_SEGMENTS.has(segment.toLowerCase()) && segment !== fileName);

  const meaningfulStem = !GENERIC_FILE_STEMS.has(normalizedStem.toLowerCase())
    ? normalizedStem
    : '';

  const seed = meaningfulStem || parent || segments.find((segment) => !GENERIC_PATH_SEGMENTS.has(segment.toLowerCase())) || 'system';
  const cleanedSeed = seed
    .replace(/[-_.]/g, ' ')
    .replace(/\b(service|store|watcher|manager|controller|handler|provider|scanner|parser|modal|panel|view|builder)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'system';

  const key = slugify(cleanedSeed);
  return {
    id: `cluster:${key}`,
    name: toClusterName(cleanedSeed),
    description: describeCluster(cleanedSeed),
    source: 'inferred',
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'system';
}

function toClusterName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeCluster(seed: string): string {
  const lowered = seed.toLowerCase();

  if (lowered.includes('auth')) return 'Authentication, sessions, and identity flow';
  if (lowered.includes('plan')) return 'Planning, task orchestration, and execution guidance';
  if (lowered.includes('trellis')) return 'Snapshots, baseline state, and architectural comparison';
  if (lowered.includes('graph')) return 'Graph rendering, layout, and visual structure';
  if (lowered.includes('agent')) return 'Agent communication, activity, and runtime coordination';
  if (lowered.includes('diff') || lowered.includes('deviation')) return 'Change comparison, drift detection, and verification';
  if (lowered.includes('project') || lowered.includes('scan')) return 'Project scanning, discovery, and file analysis';
  if (lowered.includes('persist') || lowered.includes('database')) return 'Persistence, storage, and state tracking';
  if (lowered.includes('ui') || lowered.includes('layout')) return 'User interface, layout, and interaction flow';

  return `Files that work together around ${seed.toLowerCase()}`;
}

function deterministicPosition(id: string, axis: 0 | 1): number {
  let hash = axis === 0 ? 17 : 31;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 33 + id.charCodeAt(i)) % 1000003;
  }
  const spread = axis === 0 ? 720 : 560;
  return (hash % spread) - spread / 2;
}
