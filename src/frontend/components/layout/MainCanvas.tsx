import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type NodeMouseHandler,
} from '@xyflow/react';
import { Download } from 'lucide-react';
import '@xyflow/react/dist/style.css';

import { useProjectStore } from '../../stores/project-store';
import { useGraphStore } from '../../stores/graph-store';
import { useAgentStore } from '../../stores/agent-store';
import { useUiStore } from '../../stores/ui-store';
import { buildDependencyGraph, type DependencyEdge, type FileSymbol } from '../../lib/graph-builder';
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

  // Fetch dependency edges when scan completes or tab changes
  useEffect(() => {
    if (scanStatus !== 'ready' || !root) return;

    let cancelled = false;
    setLoadingGraph(true);

    fetch('/api/dependencies')
      .then((r) => r.json())
      .then((edges) => {
        if (!cancelled) {
          setDepEdges(edges);
          setLoadingGraph(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingGraph(false);
      });

    return () => { cancelled = true; };
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

  // Fetch symbols for expanded files in symbol view
  useEffect(() => {
    if (viewDepth !== 'symbol') return;
    const expandedFiles = [...expandedNodes].filter((id) => id.includes('.'));
    if (expandedFiles.length === 0) return;

    Promise.all(
      expandedFiles
        .filter((fp) => !symbolsMap.has(fp))
        .map(async (relPath) => {
          // Need to get the absolute path — use the file from depEdges
          const edge = depEdges.find((e) => e.sourceRelative === relPath || e.targetRelative === relPath);
          const absPath = edge?.sourceRelative === relPath ? edge.source : edge?.target;
          if (!absPath) return null;
          const res = await fetch(`/api/symbols/file?path=${encodeURIComponent(absPath)}`);
          return { relPath, symbols: await res.json() as FileSymbol[] };
        })
    ).then((results) => {
      const newMap = new Map(symbolsMap);
      for (const r of results) {
        if (r) newMap.set(r.relPath, r.symbols);
      }
      setSymbolsMap(newMap);
    });
  }, [viewDepth, expandedNodes, depEdges]);

  // Build the graph
  const graphData = useMemo(() => {
    if (depEdges.length === 0) return { nodes: [], edges: [] };
    return buildDependencyGraph(depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, diffData, recentlyChanged);
  }, [depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, diffData, recentlyChanged]);

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
        <Background color="rgba(59,130,246,0.06)" gap={24} size={1} />
        <Controls className="!bg-white/[0.03] !backdrop-blur-md !border-white/[0.08] !rounded-xl !shadow-[0_0_15px_rgba(0,0,0,0.3)] [&>button]:!bg-transparent [&>button]:!border-white/[0.06] [&>button]:!text-zinc-400 [&>button:hover]:!bg-white/[0.06] [&>button:hover]:!text-zinc-200" />
        <MiniMap className="!bg-white/[0.03] !backdrop-blur-md !border-white/[0.08] !rounded-xl !shadow-[0_0_15px_rgba(0,0,0,0.3)]" nodeColor="rgba(59,130,246,0.6)" maskColor="rgba(0,0,0,0.8)" />
        <Panel position="top-right">
          <ExportButton />
        </Panel>
      </ReactFlow>
    </div>
  );
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
