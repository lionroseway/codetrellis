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
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import { Download, Layers, Network, GitFork, Camera, Target, Radio, GitCompare, Pause, Play, RefreshCw } from 'lucide-react';
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
import { ImportEdge } from '../graph/edges/ImportEdge';
import { WelcomeScreen } from '../WelcomeScreen';

const nodeTypes = {
  packageNode: PackageNode,
  directoryNode: DirectoryNode,
  fileNode: FileNode,
  symbolNode: SymbolNode,
};

const edgeTypes = {
  importEdge: ImportEdge,
};

const DIRTY_STATE_CLEAR_CONFIRMATIONS = 3;
const recentCommitsCache = new Map<string, Array<{
  commitHash: string;
  shortCommitHash: string;
  subject: string;
  committedAt: string;
}>>();

export function MainCanvas() {
  const root = useProjectStore((s) => s.root);
  const scanStatus = useProjectStore((s) => s.scanStatus);
  const setProjectGitStatus = useProjectStore((s) => s.setGitStatus);
  const viewDepth = useGraphStore((s) => s.viewDepth);
  const expandedNodes = useGraphStore((s) => s.expandedNodes);
  const toggleExpand = useGraphStore((s) => s.toggleExpand);
  const setSelectedNode = useUiStore((s) => s.setSelectedNode);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const recentlyChanged = useAgentStore((s) => s.recentlyChangedFiles);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const setLayoutMode = useGraphStore((s) => s.setLayoutMode);
  const trellisMode = useGraphStore((s) => s.trellisMode);
  const setTrellisMode = useGraphStore((s) => s.setTrellisMode);
  const baselineMode = useGraphStore((s) => s.baselineMode);
  const setBaselineMode = useGraphStore((s) => s.setBaselineMode);
  const baselineCommitHash = useGraphStore((s) => s.baselineCommitHash);
  const baselineShortCommitHash = useGraphStore((s) => s.baselineShortCommitHash);
  const setBaselineReference = useGraphStore((s) => s.setBaselineReference);
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
    git?: {
      staged: string[];
      unstaged: string[];
      untracked: string[];
      stagedAdded: string[];
      stagedModified: string[];
      stagedDeleted: string[];
      unstagedModified: string[];
      unstagedDeleted: string[];
      commitHash?: string | null;
      shortCommitHash?: string | null;
    } | null;
  } | null>(null);
  const [snapshotDiff, setSnapshotDiff] = useState<{
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
    addedEdges?: Array<{ source: string; target: string }>;
    removedEdges?: Array<{ source: string; target: string }>;
    progress?: number;
  } | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(10000);
  const [recentCommits, setRecentCommits] = useState<Array<{
    commitHash: string;
    shortCommitHash: string;
    subject: string;
    committedAt: string;
  }>>(() => (root ? recentCommitsCache.get(root) || [] : []));
  const [commitsState, setCommitsState] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => (
    root && recentCommitsCache.has(root) ? 'ready' : 'idle'
  ));
  const cleanRefreshStreakRef = useRef(0);
  const gitCleanRefreshStreakRef = useRef(0);

  const fetchBaselineSnapshot = useCallback(() => {
    fetch('/api/baseline')
      .then((r) => r.json())
      .then((snapshot: any) => {
        if (snapshot?.data) {
          setCurrentSnapshot({
            id: snapshot.id,
            name: snapshot.name,
            commitHash: snapshot.commitHash,
            shortCommitHash: snapshot.shortCommitHash,
            edges: snapshot.data.edges,
            files: snapshot.data.files,
          });
          setBaselineReference({
            commitHash: snapshot.commitHash ?? null,
            shortCommitHash: snapshot.shortCommitHash ?? null,
          });
          return;
        }
        setCurrentSnapshot(null);
      })
      .catch(() => setCurrentSnapshot(null));
  }, [setBaselineReference, setCurrentSnapshot]);

  const captureBaseline = useCallback((commitHash?: string | null) => {
    if (!root) return Promise.resolve();
    return fetch('/api/baseline/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: root, commitHash: commitHash || undefined }),
    })
      .then((r) => r.json())
      .then((snapshot) => {
        if (snapshot?.data) {
          setCurrentSnapshot({
            id: snapshot.id,
            name: snapshot.name,
            commitHash: snapshot.commitHash,
            shortCommitHash: snapshot.shortCommitHash,
            edges: snapshot.data.edges,
            files: snapshot.data.files,
          });
          setBaselineReference({
            commitHash: snapshot.commitHash ?? null,
            shortCommitHash: snapshot.shortCommitHash ?? null,
          });
        }
      })
      .catch(() => {});
  }, [root, setBaselineReference, setCurrentSnapshot]);

  useEffect(() => {
    if (!root) {
      setRecentCommits([]);
      setCommitsState('idle');
      return;
    }

    const cachedCommits = recentCommitsCache.get(root) || [];
    if (cachedCommits.length > 0) {
      setRecentCommits(cachedCommits);
      setCommitsState('ready');
    } else {
      setRecentCommits([]);
      setCommitsState('loading');
    }

    fetch(`/api/git/commits?path=${encodeURIComponent(root)}&limit=20`)
      .then((r) => r.json())
      .then((data) => {
        const commits = Array.isArray(data?.commits) ? data.commits : [];
        if (commits.length > 0) {
          recentCommitsCache.set(root, commits);
          setRecentCommits(commits);
          setCommitsState('ready');
          return;
        }

        if (cachedCommits.length === 0) {
          setRecentCommits([]);
          setCommitsState('ready');
        }
      })
      .catch(() => {
        if (cachedCommits.length === 0) {
          setRecentCommits([]);
          setCommitsState('error');
        }
      });
  }, [root]);

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
  const refreshWorkingTreeDiff = useCallback(() => {
    if (scanStatus !== 'ready' || !root) return;
    Promise.all([
      fetch(`/api/diff?project=${encodeURIComponent(root)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/git/status?path=${encodeURIComponent(root)}`).then((r) => r.json()).catch(() => null),
    ])
      .then(([diff, gitStatus]) => {
        let nextDiffHasChanges = false;
        let nextGitHasChanges = false;
        let latestCommitHash: string | null = null;

        setDiffData((previous) => {
          const incomingGit = gitStatus && !gitStatus.error
            ? gitStatus
            : diff?.git || null;
          const previousGit = previous?.git || null;
          const incomingGitHasChanges = hasGitChanges(incomingGit);
          const previousGitHadChanges = hasGitChanges(previousGit);
          const headAdvanced = Boolean(
            incomingGit?.commitHash &&
            previousGit?.commitHash &&
            incomingGit.commitHash !== previousGit.commitHash,
          );

          let effectiveGit = incomingGit;
          if (!incomingGitHasChanges && headAdvanced) {
            gitCleanRefreshStreakRef.current = 0;
            effectiveGit = incomingGit;
          } else if (incomingGitHasChanges) {
            gitCleanRefreshStreakRef.current = 0;
          } else if (previousGitHadChanges) {
            if (gitCleanRefreshStreakRef.current < DIRTY_STATE_CLEAR_CONFIRMATIONS - 1) {
              gitCleanRefreshStreakRef.current += 1;
              effectiveGit = previousGit;
            } else {
              gitCleanRefreshStreakRef.current = 0;
            }
          } else {
            gitCleanRefreshStreakRef.current = 0;
          }

          nextGitHasChanges = Boolean(
            effectiveGit?.staged?.length ||
            effectiveGit?.unstaged?.length ||
            effectiveGit?.untracked?.length,
          );
          latestCommitHash = effectiveGit?.commitHash ?? null;
          setProjectGitStatus(effectiveGit || null);

          if (diff && !diff.error) {
            const nextDiff = { ...diff, git: effectiveGit };
            nextDiffHasChanges = Boolean(
              diff.summary?.added ||
              diff.summary?.removed ||
              diff.summary?.modified,
            );
            if (!nextDiffHasChanges && !nextGitHasChanges && previous && !headAdvanced) {
              const previousHadChanges = Boolean(
                previous.addedFiles.length ||
                previous.removedFiles.length ||
                previous.modifiedFiles.length ||
                previous.git?.staged?.length ||
                previous.git?.unstaged?.length ||
                previous.git?.untracked?.length,
              );
              if (previousHadChanges && cleanRefreshStreakRef.current < DIRTY_STATE_CLEAR_CONFIRMATIONS - 1) {
                cleanRefreshStreakRef.current += 1;
                nextDiffHasChanges = true;
                nextGitHasChanges = true;
                return previous;
              }
            }
            cleanRefreshStreakRef.current = 0;
            return nextDiff;
          }

          if (effectiveGit) {
            nextDiffHasChanges = Boolean(
              previous?.addedFiles.length ||
              previous?.removedFiles.length ||
              previous?.modifiedFiles.length,
            );
            cleanRefreshStreakRef.current = nextGitHasChanges || nextDiffHasChanges ? 0 : cleanRefreshStreakRef.current;
            return previous
              ? { ...previous, git: effectiveGit }
              : {
                  addedFiles: [],
                  removedFiles: [],
                  modifiedFiles: [],
                  blastRadius: [],
                  git: effectiveGit,
                };
          }

          nextDiffHasChanges = Boolean(
            previous?.addedFiles.length ||
            previous?.removedFiles.length ||
            previous?.modifiedFiles.length,
          );
          nextGitHasChanges = Boolean(
            previous?.git?.staged?.length ||
            previous?.git?.unstaged?.length ||
            previous?.git?.untracked?.length,
          );
          if (nextDiffHasChanges || nextGitHasChanges) {
            cleanRefreshStreakRef.current = 0;
          }
          return previous;
        });

        if (
          nextDiffHasChanges ||
          nextGitHasChanges
        ) {
          fetch('/api/dependencies')
            .then((r) => r.json())
            .then((edges) => {
              if (Array.isArray(edges) && edges.length > 0) {
                setDepEdges(edges);
              }
            })
            .catch(() => {});
        }

        if (
          baselineMode === 'auto' &&
          latestCommitHash &&
          latestCommitHash !== baselineCommitHash &&
          !nextGitHasChanges
        ) {
          captureBaseline();
        }
      })
      .catch(() => {});
  }, [scanStatus, root, setProjectGitStatus, baselineMode, baselineCommitHash, captureBaseline]);

  useEffect(() => {
    if (scanStatus !== 'ready' || !root) return;
    refreshWorkingTreeDiff();
    if (!autoRefreshEnabled) return;
    const interval = setInterval(refreshWorkingTreeDiff, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [scanStatus, root, autoRefreshEnabled, refreshIntervalMs, refreshWorkingTreeDiff]);

  // Fetch projection data when a plan is active
  useEffect(() => {
    if (!activePlanUid || (!projectionEnabled && trellisMode !== 'planned' && trellisMode !== 'diff')) {
      setProjectionData(null);
      return;
    }
    fetch(`/api/plans/${activePlanUid}/projection`)
      .then((r) => r.json())
      .then((data) => setProjectionData(data))
      .catch(() => setProjectionData(null));
  }, [activePlanUid, projectionEnabled, trellisMode, setProjectionData]);

  // Fetch snapshot when switching to current/diff mode
  useEffect(() => {
    if (trellisMode !== 'current' && trellisMode !== 'diff' && trellisMode !== 'planned') return;
    if (!activePlanUid) {
      fetchBaselineSnapshot();
      setSnapshotDiff(null);
      return;
    }

    fetch(`/api/trellis/snapshots?plan=${activePlanUid}`)
      .then((r) => r.json())
      .then((snapshots: any[]) => {
        if (snapshots.length === 0) {
          fetchBaselineSnapshot();
          return null;
        }
        const snapshotId = snapshots[0].id;
        return fetch(`/api/trellis/${snapshotId}`).then((r) => r.json());
      })
      .then((snapshot: any) => {
        if (snapshot?.data) {
          setCurrentSnapshot({
            id: snapshot.id,
            name: snapshot.name,
            commitHash: snapshot.commitHash,
            shortCommitHash: snapshot.shortCommitHash,
            edges: snapshot.data.edges,
            files: snapshot.data.files,
          });
        }
      })
      .catch(() => fetchBaselineSnapshot());
  }, [trellisMode, activePlanUid, setCurrentSnapshot, fetchBaselineSnapshot]);

  useEffect(() => {
    if (trellisMode !== 'diff' || !currentSnapshot?.id) {
      setSnapshotDiff(null);
      return;
    }

    const fetchSnapshotDiff = () => {
      fetch(`/api/trellis/${currentSnapshot.id}/diff`)
        .then((r) => r.json())
        .then((diff) => {
          if (diff && !diff.error) setSnapshotDiff(diff);
        })
        .catch(() => {});
    };

    fetchSnapshotDiff();
    const interval = setInterval(fetchSnapshotDiff, 5000);
    return () => clearInterval(interval);
  }, [trellisMode, currentSnapshot?.id]);

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
  const workingTreeDiff = useMemo(() => mergeLiveDiff(null, diffData), [diffData]);
  const liveWorkingTreeDiff = useMemo(() => mergeLiveDiff(snapshotDiff, diffData), [snapshotDiff, diffData]);

  const graphData = useMemo(() => {
    // Current/Planned mode: render from frozen snapshot
    if ((trellisMode === 'current' || trellisMode === 'planned') && currentSnapshot) {
      return buildFromSnapshot(
        currentSnapshot.edges,
        viewDepth,
        layoutMode,
        trellisMode === 'planned'
          ? {
              addedFiles: [],
              removedFiles: [],
              modifiedFiles: [],
              blastRadius: [],
            }
          : null,
        trellisMode === 'current', // frozen = true for current
        trellisMode === 'planned' ? projectionData : null,
      );
    }

    // Diff mode: live graph with diff against snapshot
    if (trellisMode === 'diff' && currentSnapshot && depEdges.length > 0) {
      return buildDependencyGraph(depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, liveWorkingTreeDiff, recentlyChanged, projectionData, layoutMode, trellisMode);
    }

    // Live mode (default)
    if (depEdges.length === 0) return { nodes: [], edges: [] };
    return buildDependencyGraph(depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, workingTreeDiff, recentlyChanged, trellisMode === 'planned' || projectionEnabled ? projectionData : null, layoutMode, trellisMode);
  }, [depEdges, viewDepth, expandedNodes, symbolsMap, toggleExpand, workingTreeDiff, liveWorkingTreeDiff, recentlyChanged, projectionData, projectionEnabled, layoutMode, trellisMode, currentSnapshot]);

  const activeDiff = trellisMode === 'diff' ? liveWorkingTreeDiff : workingTreeDiff;

  const displayGraphData = useMemo(() => {
    if (!selectedNodeId) return graphData;

    return {
      nodes: graphData.nodes.map((node) => ({
        ...node,
        data: {
          ...(node.data || {}),
          relatedToSelection: node.id === selectedNodeId || graphData.edges.some((edge) => (edge.source === selectedNodeId && edge.target === node.id) || (edge.target === selectedNodeId && edge.source === node.id)),
        },
      })),
      edges: graphData.edges.map((edge) => ({
        ...edge,
        data: {
          ...(edge.data || {}),
          emphasized: edge.source === selectedNodeId || edge.target === selectedNodeId,
          muted: edge.source !== selectedNodeId && edge.target !== selectedNodeId,
        },
      })),
    };
  }, [graphData, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(displayGraphData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(displayGraphData.edges);

  const selectedCommitLabel = useMemo(() => {
    if (baselineMode === 'auto') return 'Track HEAD';
    if (!baselineCommitHash) return 'Pin current HEAD';
    const matchingCommit = recentCommits.find((commit) => commit.commitHash === baselineCommitHash);
    if (matchingCommit) {
      return `${matchingCommit.shortCommitHash} · ${matchingCommit.subject}`;
    }
    return baselineShortCommitHash ? `${baselineShortCommitHash} · pinned` : 'Pinned baseline';
  }, [baselineMode, baselineCommitHash, baselineShortCommitHash, recentCommits]);

  useEffect(() => {
    setNodes((prev) => preserveNodePositions(prev, displayGraphData.nodes));
    setEdges(displayGraphData.edges);
  }, [displayGraphData, setNodes, setEdges]);

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
      <div className="pointer-events-none absolute inset-0 opacity-45 [background-image:radial-gradient(circle_at_center,rgba(59,130,246,0.08)_0,transparent_46%),linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:100%_100%,28px_28px,28px_28px]" />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
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
          <div className="flex max-w-[min(880px,calc(100vw-620px))] flex-wrap items-center justify-end gap-2">
            {/* Trellis mode selector */}
            <div className="flex shrink-0 items-center bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-lg p-0.5 shadow-[0_0_10px_rgba(0,0,0,0.3)]">
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

            <div className="flex min-w-0 shrink items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 backdrop-blur-md shadow-[0_0_10px_rgba(0,0,0,0.3)]">
              <button
                onClick={() => {
                  setBaselineMode('pinned');
                  captureBaseline();
                }}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-all ${baselineMode === 'pinned' ? 'bg-blue-500/14 text-blue-200' : 'text-zinc-400 hover:text-zinc-200'}`}
                title="Pin baseline to the current commit/state"
              >
                Pin
              </button>
              <button
                onClick={() => setBaselineMode('auto')}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-all ${baselineMode === 'auto' ? 'bg-emerald-500/14 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
                title="Automatically move baseline forward when HEAD advances cleanly"
              >
                Auto-track
              </button>
              <span className="rounded-md border border-white/8 bg-black/12 px-2 py-1 text-[10px] text-zinc-300">
                {baselineMode === 'auto' ? 'HEAD' : baselineShortCommitHash ? baselineShortCommitHash : 'baseline'}
              </span>
              <select
                value={baselineMode === 'auto' ? '__AUTO__' : (baselineCommitHash || '__CURRENT__')}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '__AUTO__') {
                    setBaselineMode('auto');
                    return;
                  }

                  setBaselineMode('pinned');
                  if (value === '__CURRENT__') {
                    captureBaseline();
                    return;
                  }
                  captureBaseline(value);
                }}
                className="w-[140px] rounded-md border border-white/8 bg-black/20 px-2 py-1 text-[10px] text-zinc-200 outline-none transition-all hover:border-white/15 sm:w-[180px] lg:w-[240px] xl:w-[320px]"
                title="Choose which commit the baseline should be pinned to"
              >
                <option value="__AUTO__">Track HEAD</option>
                <option value="__CURRENT__">Pin current HEAD</option>
                {commitsState === 'loading' && (
                  <option disabled value="__LOADING__">Loading recent commits...</option>
                )}
                {commitsState === 'error' && (
                  <option disabled value="__ERROR__">Recent commits unavailable</option>
                )}
                {commitsState === 'ready' && recentCommits.length === 0 && (
                  <option disabled value="__EMPTY__">No recent commits found</option>
                )}
                {recentCommits.map((commit) => (
                  <option key={commit.commitHash} value={commit.commitHash}>
                    {commit.shortCommitHash} · {commit.subject} · {commit.committedAt}
                  </option>
                ))}
              </select>
            </div>

            {/* Layout toggle */}
            <div className="flex shrink-0 items-center bg-white/[0.03] backdrop-blur-md border border-white/[0.08] rounded-lg p-0.5 shadow-[0_0_10px_rgba(0,0,0,0.3)]">
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
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 backdrop-blur-md shadow-[0_0_10px_rgba(0,0,0,0.3)]">
              <button
                onClick={() => setAutoRefreshEnabled((value) => !value)}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-all ${autoRefreshEnabled ? 'text-green-300 bg-green-500/10' : 'text-zinc-400 hover:text-zinc-200'}`}
                title={autoRefreshEnabled ? 'Pause automatic refresh checks' : 'Resume automatic refresh checks'}
              >
                {autoRefreshEnabled ? <Pause size={11} /> : <Play size={11} />}
                {autoRefreshEnabled ? 'Auto' : 'Paused'}
              </button>
              <button
                onClick={refreshWorkingTreeDiff}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md text-zinc-400 transition-all hover:text-zinc-200"
                title="Check for changes now"
              >
                <RefreshCw size={11} />
                Check now
              </button>
              <select
                value={refreshIntervalMs}
                onChange={(event) => setRefreshIntervalMs(Number(event.target.value))}
                className="rounded-md border-0 bg-transparent px-2 py-1 text-[10px] text-zinc-300 outline-none"
                title="Automatic refresh interval"
              >
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
                <option value={30000}>30s</option>
              </select>
            </div>
            <div className="shrink-0">
              <ExportButton />
            </div>
          </div>
        </Panel>
        <Panel position="top-left">
          <DiffSummary
            trellisMode={trellisMode}
            diff={activeDiff}
            progress={snapshotDiff?.progress}
            gitStatus={diffData?.git || null}
            planSummary={summarizePlanVsLive(activeDiff, projectionData)}
            snapshotName={currentSnapshot?.name}
          />
        </Panel>
      </ReactFlow>
    </div>
  );
}

function preserveNodePositions(previousNodes: Node[], nextNodes: Node[]): Node[] {
  const previousPositions = new Map(previousNodes.map((node) => [node.id, node.position]));
  return nextNodes.map((node) => {
    const previousPosition = previousPositions.get(node.id);
    return previousPosition ? { ...node, position: previousPosition } : node;
  });
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

function DiffSummary({
  trellisMode,
  diff,
  progress,
  gitStatus,
  planSummary,
  snapshotName,
}: {
  trellisMode: string;
  diff: { addedFiles: string[]; removedFiles: string[]; modifiedFiles: string[] } | null;
  progress?: number;
  gitStatus: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
    stagedAdded: string[];
    stagedModified: string[];
    stagedDeleted: string[];
    unstagedModified: string[];
    unstagedDeleted: string[];
  } | null;
  planSummary: {
    planned: number;
    onTrack: number;
    pending: number;
    unexpected: number;
    liveChanged: number;
  } | null;
  snapshotName?: string;
}) {
  const hasDiff = Boolean(diff && (diff.addedFiles.length || diff.removedFiles.length || diff.modifiedFiles.length));
  const hasGitStatus = Boolean(gitStatus && (gitStatus.staged.length || gitStatus.unstaged.length || gitStatus.untracked.length));
  const totalChangedFiles = countUniqueChangedFiles(diff, gitStatus);
  if (!hasDiff && !hasGitStatus && trellisMode !== 'diff') return null;

  return (
    <div className="min-w-[220px] rounded-xl border border-white/[0.08] bg-[#0b1020]/80 px-3 py-2.5 backdrop-blur-md shadow-[0_0_18px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
            {trellisMode === 'diff'
              ? planSummary ? 'Plan vs Live' : 'Baseline vs Live'
              : trellisMode === 'planned'
                ? 'Planned Target'
                : trellisMode === 'current'
                  ? 'Baseline Reference'
                  : 'Working Tree Changes'}
          </div>
          <div className="mt-1 text-[12px] font-medium text-zinc-100">
            {trellisMode === 'diff'
              ? planSummary
                ? 'Monitoring live work against the plan'
                : 'Comparing live workspace to the baseline'
              : totalChangedFiles > 0
                ? `${totalChangedFiles} changes detected`
                : 'No tracked changes yet'}
          </div>
          {snapshotName && (trellisMode === 'current' || trellisMode === 'diff') && (
            <div className="mt-1 text-[10px] text-zinc-400/80">
              source: {snapshotName}
            </div>
          )}
        </div>
        {typeof progress === 'number' && (
          <div className="rounded-full border border-blue-300/18 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-100">
            {progress}% changed
          </div>
        )}
      </div>

      {trellisMode === 'diff' && planSummary && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-emerald-300/18 bg-emerald-500/10 px-2 py-1 text-emerald-100">
            on track {planSummary.onTrack}
          </span>
          <span className="rounded-full border border-blue-300/18 bg-blue-500/10 px-2 py-1 text-blue-100">
            planned {planSummary.planned}
          </span>
          <span className="rounded-full border border-amber-300/18 bg-amber-500/10 px-2 py-1 text-amber-100">
            pending {planSummary.pending}
          </span>
          <span className="rounded-full border border-fuchsia-300/18 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-100">
            unexpected {planSummary.unexpected}
          </span>
        </div>
      )}

      {diff && (
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <span className="rounded-full border border-emerald-300/18 bg-emerald-500/10 px-2 py-1 text-emerald-100">
            + {diff.addedFiles.length} added
          </span>
          <span className="rounded-full border border-amber-300/18 bg-amber-500/10 px-2 py-1 text-amber-100">
            ~ {diff.modifiedFiles.length} modified
          </span>
          <span className="rounded-full border border-red-300/18 bg-red-500/10 px-2 py-1 text-red-100">
            - {diff.removedFiles.length} removed
          </span>
        </div>
      )}

      {gitStatus && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-sky-300/18 bg-sky-500/10 px-2 py-1 text-sky-100">
            staged {gitStatus.staged.length}
          </span>
          <span className="rounded-full border border-orange-300/18 bg-orange-500/10 px-2 py-1 text-orange-100">
            unstaged {gitStatus.unstaged.length}
          </span>
          <span className="rounded-full border border-emerald-300/18 bg-emerald-500/10 px-2 py-1 text-emerald-100">
            untracked {gitStatus.untracked.length}
          </span>
        </div>
      )}
    </div>
  );
}

function mergeLiveDiff(
  snapshotDiff: {
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
    addedEdges?: Array<{ source: string; target: string }>;
    removedEdges?: Array<{ source: string; target: string }>;
  } | null,
  diffData: {
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
  } | null,
) {
  if (!snapshotDiff && !diffData) return null;

  const addedFiles = new Set<string>([
    ...(snapshotDiff?.addedFiles || []),
    ...(diffData?.addedFiles || []),
    ...(diffData?.git?.untracked || []),
    ...(diffData?.git?.stagedAdded || []),
  ]);
  const removedFiles = new Set<string>([
    ...(snapshotDiff?.removedFiles || []),
    ...(diffData?.removedFiles || []),
    ...(diffData?.git?.stagedDeleted || []),
    ...(diffData?.git?.unstagedDeleted || []),
  ]);
  const modifiedFiles = new Set<string>([
    ...(snapshotDiff?.modifiedFiles || []),
    ...(diffData?.modifiedFiles || []),
    ...(diffData?.git?.stagedModified || []),
    ...(diffData?.git?.unstagedModified || []),
  ]);

  return {
    addedFiles: [...addedFiles],
    removedFiles: [...removedFiles],
    modifiedFiles: [...modifiedFiles].filter((path) => !addedFiles.has(path) && !removedFiles.has(path)),
    blastRadius: diffData?.blastRadius || [],
    addedEdges: snapshotDiff?.addedEdges || diffData?.addedEdges || [],
    removedEdges: snapshotDiff?.removedEdges || diffData?.removedEdges || [],
    git: diffData?.git || null,
  };
}

function summarizePlanVsLive(
  diff: {
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
  } | null,
  projectionData: {
    ghostFiles: Array<{ path: string }>;
    modifiedFiles: Array<{ path: string }>;
    removedFiles: Array<{ path: string }>;
  } | null,
) {
  if (!projectionData) return null;

  const plannedFiles = new Set<string>([
    ...projectionData.ghostFiles.map((file) => file.path),
    ...projectionData.modifiedFiles.map((file) => file.path),
    ...projectionData.removedFiles.map((file) => file.path),
  ]);
  const liveFiles = new Set<string>([
    ...(diff?.addedFiles || []),
    ...(diff?.removedFiles || []),
    ...(diff?.modifiedFiles || []),
  ]);

  let onTrack = 0;
  let unexpected = 0;

  for (const file of liveFiles) {
    if (plannedFiles.has(file)) {
      onTrack += 1;
    } else {
      unexpected += 1;
    }
  }

  return {
    planned: plannedFiles.size,
    onTrack,
    pending: Math.max(plannedFiles.size - onTrack, 0),
    unexpected,
    liveChanged: liveFiles.size,
  };
}

function countUniqueChangedFiles(
  diff: {
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
  } | null,
  gitStatus: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
  } | null,
) {
  return new Set([
    ...(diff?.addedFiles || []),
    ...(diff?.removedFiles || []),
    ...(diff?.modifiedFiles || []),
    ...(gitStatus?.staged || []),
    ...(gitStatus?.unstaged || []),
    ...(gitStatus?.untracked || []),
  ]).size;
}

function hasGitChanges(gitStatus: {
  staged: string[];
  unstaged: string[];
  untracked: string[];
} | null | undefined) {
  return Boolean(
    gitStatus?.staged?.length ||
    gitStatus?.unstaged?.length ||
    gitStatus?.untracked?.length,
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
