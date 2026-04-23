import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import { Download, Layers, Network, GitFork, Camera, Target, Radio, GitCompare } from 'lucide-react';
import '@xyflow/react/dist/style.css';

import { useProjectStore } from '../../stores/project-store';
import { useGraphStore } from '../../stores/graph-store';
import { useAgentStore } from '../../stores/agent-store';
import { usePlanStore } from '../../stores/plan-store';
import { useUiStore } from '../../stores/ui-store';
import { buildDependencyGraph, buildFromSnapshot, type DependencyEdge, type FileSymbol } from '../../lib/graph-builder';
import { PackageNode } from '../graph/nodes/PackageNode';
import { DirectoryNode } from '../graph/nodes/DirectoryNode';
import { FileNode } from '../graph/nodes/FileNode';
import { SymbolNode } from '../graph/nodes/SymbolNode';
import { WelcomeScreen } from '../WelcomeScreen';

const nodeTypes = {
  packageNode: PackageNode,
  directoryNode: DirectoryNode,
  fileNode: FileNode,
  symbolNode: SymbolNode,
};

export function MainCanvas() {
  const root = useProjectStore((s) => s.root);
  const scanStatus = useProjectStore((s) => s.scanStatus);
  const viewDepth = useGraphStore((s) => s.viewDepth);
  const expandedNodes = useGraphStore((s) => s.expandedNodes);
  const toggleExpand = useGraphStore((s) => s.toggleExpand);
  const setSelectedNode = useUiStore((s) => s.setSelectedNode);
  const recentlyChanged = useAgentStore((s) => s.recentlyChangedFiles);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const setLayoutMode = useGraphStore((s) => s.setLayoutMode);
  const trellisMode = useGraphStore((s) => s.trellisMode);
  const setTrellisMode = useGraphStore((s) => s.setTrellisMode);
  const currentSnapshot = useGraphStore((s) => s.currentSnapshot);
  const setCurrentSnapshot = useGraphStore((s) => s.setCurrentSnapshot);
  const projectionEnabled = useGraphStore((s) => s.projectionEnabled);
  const projectionData = useGraphStore((s) => s.projectionData);
  const toggleProjection = useGraphStore((s) => s.toggleProjection);
  const setProjectionData = useGraphStore((s) => s.setProjectionData);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);

  // Dependency edges from backend
  const [depEdges, setDepEdges] = useState<DependencyEdge[]>([]);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [symbolsMap, setSymbolsMap] = useState<Map<string, FileSymbol[]>>(new Map());
  const [diffData, setDiffData] = useState<{
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
    blastRadius: string[];
  } | null>(null);

  // Fetch dependency edges when scan completes
  const hasFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (scanStatus !== 'ready' || !root) return;
    // Don't re-fetch if we already fetched for this project
    if (hasFetchedRef.current === root && depEdges.length > 0) return;

    setLoadingGraph(true);
    hasFetchedRef.current = root;

    fetch('/api/dependencies')
      .then((r) => r.json())
      .then((edges) => {
        setDepEdges(edges);
        setLoadingGraph(false);
      })
      .catch(() => {
        setLoadingGraph(false);
      });
  }, [scanStatus, root]);

  // Poll for diffs every 10 seconds
  useEffect(() => {
    if (scanStatus !== 'ready' || !root) return;
    const fetchDiff = () => {
      fetch(`/api/diff?project=${encodeURIComponent(root)}`)
        .then((r) => r.json())
        .then((diff) => {
          if (diff && !diff.error) {
            setDiffData(diff);
            // Also refresh edges if there are changes
            if (diff.summary?.added > 0 || diff.summary?.removed > 0 || diff.summary?.modified > 0) {
              fetch('/api/dependencies').then((r) => r.json()).then(setDepEdges);
            }
          }
        })
        .catch(() => {});
    };
    const interval = setInterval(fetchDiff, 10000);
    return () => clearInterval(interval);
  }, [scanStatus, root]);

  // Fetch projection data when a plan is active
  useEffect(() => {
    if (!activePlanUid || !projectionEnabled) {
      setProjectionData(null);
      return;
    }
    fetch(`/api/plans/${activePlanUid}/projection`)
      .then((r) => r.json())
      .then((data) => setProjectionData(data))
      .catch(() => setProjectionData(null));
  }, [activePlanUid, projectionEnabled, setProjectionData]);

  // Fetch snapshot when switching to current/diff mode
  useEffect(() => {
    if (trellisMode !== 'current' && trellisMode !== 'diff' && trellisMode !== 'planned') return;
    if (!activePlanUid) {
      setCurrentSnapshot(null);
      return;
    }
    // Find snapshot for this plan
    fetch(`/api/trellis/snapshots?plan=${activePlanUid}`)
      .then((r) => r.json())
      .then((snapshots: any[]) => {
        if (snapshots.length === 0) { setCurrentSnapshot(null); return; }
        const snapshotId = snapshots[0].id;
        return fetch(`/api/trellis/${snapshotId}`).then((r) => r.json());
      })
      .then((snapshot: any) => {
        if (snapshot?.data) {
          setCurrentSnapshot({ edges: snapshot.data.edges, files: snapshot.data.files });
        }
      })
      .catch(() => setCurrentSnapshot(null));
  }, [trellisMode, activePlanUid, setCurrentSnapshot]);

  // Fetch symbols for focused file in symbol view
  useEffect(() => {
    if (viewDepth !== 'symbol') return;
    const focusedFiles = [...expandedNodes].filter((id) => id.includes('.'));
    if (focusedFiles.length === 0) return;

    for (const relPath of focusedFiles) {
      if (symbolsMap.has(relPath)) continue;
      // Find absolute path from dep edges
      const edge = depEdges.find((e) => e.sourceRelative === relPath || e.targetRelative === relPath);
      const absPath = edge ? (edge.sourceRelative === relPath ? edge.source : edge.target) : null;
      if (!absPath) continue;

      fetch(`/api/symbols/file?path=${encodeURIComponent(absPath)}`)
        .then((r) => r.json())
        .then((symbols: FileSymbol[]) => {
          setSymbolsMap((prev) => new Map(prev).set(relPath, symbols));
        })
        .catch(() => {});
    }
  }, [viewDepth, expandedNodes, depEdges]);

  // Build the graph
  const graphData = useMemo(() => {
    // Current/Planned mode: render from frozen snapshot
    if ((trellisMode === 'current' || trellisMode === 'planned') && currentSnapshot) {
      return buildFromSnapshot(
        currentSnapshot.edges, viewDepth, layoutMode, null,
        trellisMode === 'current', // frozen = true for current
      );
    }

    // Diff mode: live graph with diff against snapshot
    if (trellisMode === 'diff' && currentSnapshot && depEdges.length > 0) {
      const snapshotFileSet = new Set(currentSnapshot.files.map((f: any) => f.path));
      const liveFileSet = new Set(depEdges.flatMap((e) => [e.sourceRelative, e.targetRelative]));
      const clientDiff = {
        addedFiles: [...liveFileSet].filter((f) => !snapshotFileSet.has(f)),
        removedFiles: [...snapshotFileSet].filter((f) => !liveFileSet.has(f)),
        modifiedFiles: [] as string[],
        blastRadius: [] as string[],
      };
      return buildDependencyGraph(depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, clientDiff, recentlyChanged, projectionEnabled ? projectionData : null, layoutMode);
    }

    // Live mode (default)
    if (depEdges.length === 0) return { nodes: [], edges: [] };
    return buildDependencyGraph(depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, diffData, recentlyChanged, projectionEnabled ? projectionData : null, layoutMode);
  }, [depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, diffData, recentlyChanged, projectionData, projectionEnabled, layoutMode, trellisMode, currentSnapshot]);

  const [nodes, setNodes, onNodesChange] = useNodesState(graphData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphData.edges);

  useEffect(() => {
    setNodes(graphData.nodes);
    setEdges(graphData.edges);
  }, [graphData, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  if (!root) {
    return <WelcomeScreen />;
  }

  if (scanStatus === 'scanning' || loadingGraph) {
    return (
      <div className="w-full h-full relative overflow-hidden flex items-center justify-center bg-gradient-to-br from-[#0a0b10] via-[#0d1020] to-[#0a0b10]">
        <div className="flex flex-col items-center gap-4">
          {/* Animated logo */}
          <div className="relative">
            <div className="absolute inset-0 w-14 h-14 rounded-2xl bg-accent/20 blur-xl animate-pulse" />
            <img src="/icon.png" alt="" className="relative w-12 h-12 animate-pulse" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2.5 text-foreground text-sm font-medium">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
              {scanStatus === 'scanning' ? 'Scanning project...' : 'Building dependency graph...'}
            </div>
            <p className="text-[11px] text-foreground-subtle">
              {scanStatus === 'scanning'
                ? 'Parsing source files and extracting symbols'
                : 'Resolving imports and mapping connections'
              }
            </p>
          </div>

          {/* Progress bar */}
          <div className="w-48 h-1 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full bg-accent/60 rounded-full animate-[loading_2s_ease-in-out_infinite]"
              style={{ width: scanStatus === 'scanning' ? '60%' : '90%' }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-gradient-to-br from-[#0a0b10] via-[#0d1020] to-[#0a0b10]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
      >
        <AutoFitView nodes={nodes} />
        <Background color="rgba(59,130,246,0.06)" gap={24} size={1} />
        <Controls className="!bg-white/[0.03] !backdrop-blur-md !border-white/[0.08] !rounded-xl !shadow-[0_0_15px_rgba(0,0,0,0.3)] [&>button]:!bg-transparent [&>button]:!border-white/[0.06] [&>button]:!text-zinc-400 [&>button:hover]:!bg-white/[0.06] [&>button:hover]:!text-zinc-200" />
        <MiniMap className="!bg-white/[0.03] !backdrop-blur-md !border-white/[0.08] !rounded-xl !shadow-[0_0_15px_rgba(0,0,0,0.3)]" nodeColor="rgba(59,130,246,0.6)" maskColor="rgba(0,0,0,0.8)" />
        <Panel position="top-right">
          <div className="flex items-center gap-2">
            {/* Trellis mode selector */}
            <div className="flex items-center bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-lg p-0.5 shadow-[0_0_10px_rgba(0,0,0,0.3)]">
              {([
                { mode: 'live' as const, icon: Radio, label: 'Live', color: 'text-green-400' },
                { mode: 'current' as const, icon: Camera, label: 'Baseline', color: 'text-blue-400' },
                { mode: 'planned' as const, icon: Target, label: 'Planned', color: 'text-amber-400' },
                { mode: 'diff' as const, icon: GitCompare, label: 'Diff', color: 'text-violet-400' },
              ] as const).map(({ mode, icon: Icon, label, color }) => (
                <button
                  key={mode}
                  onClick={() => setTrellisMode(mode)}
                  className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-all ${
                    trellisMode === mode
                      ? `bg-white/[0.08] ${color} shadow-[0_0_6px_currentColor]`
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  title={`${label} view`}
                >
                  <Icon size={11} />
                  {label}
                </button>
              ))}
            </div>

            {/* Layout toggle */}
            <div className="flex items-center bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-lg p-0.5 shadow-[0_0_10px_rgba(0,0,0,0.3)]">
              <button
                onClick={() => setLayoutMode('map')}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-all ${
                  layoutMode === 'map' ? 'bg-accent/20 text-accent' : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Map view (force-directed)"
              >
                <Network size={11} />
                Map
              </button>
              <button
                onClick={() => setLayoutMode('tree')}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-all ${
                  layoutMode === 'tree' ? 'bg-accent/20 text-accent' : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Tree view (hierarchical)"
              >
                <GitFork size={11} />
                Tree
              </button>
            </div>

            {activePlanUid && (
              <button
                onClick={toggleProjection}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg backdrop-blur-md border transition-all shadow-[0_0_10px_rgba(0,0,0,0.3)] ${
                  projectionEnabled
                    ? 'bg-accent/20 border-accent/30 text-accent shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                    : 'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]'
                }`}
                title={projectionEnabled ? 'Hide plan projection' : 'Show plan projection on graph'}
              >
                <Layers size={12} />
                Projection
              </button>
            )}
            <ExportButton />
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function AutoFitView({ nodes }: { nodes: Node[] }) {
  const { fitView } = useReactFlow();
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (nodes.length > 0 && nodes.length !== prevCountRef.current) {
      prevCountRef.current = nodes.length;
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    }
  }, [nodes, fitView]);

  return null;
}

function ExportButton() {
  const { getNodes } = useReactFlow();

  const handleExport = async () => {
    const nodes = getNodes();
    if (nodes.length === 0) return;

    // Use html-to-image approach via canvas
    const flowEl = document.querySelector('.react-flow') as HTMLElement;
    if (!flowEl) return;

    try {
      // Simple approach: use the browser's built-in canvas capture
      const { toPng } = await import('html-to-image');
      const viewport = flowEl.querySelector('.react-flow__viewport') as HTMLElement;
      if (!viewport) return;

      const dataUrl = await toPng(viewport, {
        backgroundColor: '#0a0a0b',
        quality: 1,
      });

      const link = document.createElement('a');
      link.download = 'codetrellis-graph.png';
      link.href = dataUrl;
      link.click();
    } catch {
      // Fallback: just alert
      console.error('Export failed — html-to-image may not be installed');
    }
  };

  return (
    <button
      onClick={handleExport}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-white/[0.03] backdrop-blur-md border border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] hover:border-white/[0.12] transition-all shadow-[0_0_10px_rgba(0,0,0,0.3)]"
      title="Export graph as PNG"
    >
      <Download size={12} />
      Export
    </button>
  );
}
