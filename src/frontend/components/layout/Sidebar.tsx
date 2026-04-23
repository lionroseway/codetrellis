import { Search, ChevronRight, ChevronDown, Folder, FolderOpen, FileCode, FileJson, FileText, Package } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { useProjectStore } from '../../stores/project-store';
import { useGraphStore } from '../../stores/graph-store';
import type { FileTreeNode } from '@shared/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectGitStatus } from '../../stores/project-store';

type SidebarGitState = 'staged' | 'unstaged' | 'untracked' | 'deleted';
const SIDEBAR_DIRTY_STATE_CLEAR_CONFIRMATIONS = 3;

function getFileIcon(node: FileTreeNode) {
  if (node.type === 'package') return <Package size={13} className="text-accent shrink-0 drop-shadow-[0_0_3px_rgba(59,130,246,0.4)]" />;
  if (node.type === 'directory') return null;
  switch (node.language) {
    case 'typescript': return <FileCode size={13} className="text-blue-400 shrink-0" />;
    case 'javascript': return <FileCode size={13} className="text-yellow-400 shrink-0" />;
    case 'json': return <FileJson size={13} className="text-zinc-400 shrink-0" />;
    case 'css': return <FileCode size={13} className="text-purple-400 shrink-0" />;
    case 'python': return <FileCode size={13} className="text-green-400 shrink-0" />;
    default: return <FileText size={13} className="text-zinc-500 shrink-0" />;
  }
}

function FileTreeItem({
  node,
  depth = 0,
  gitStatesByPath,
}: {
  node: FileTreeNode;
  depth?: number;
  gitStatesByPath: Map<string, SidebarGitState[]>;
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(depth < 1);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const setSelectedNode = useUiStore((s) => s.setSelectedNode);
  const toggleGraphExpand = useGraphStore((s) => s.toggleExpand);

  const isSelected = selectedNodeId === node.path;
  const hasChildren = node.children && node.children.length > 0;
  const isDir = node.type === 'directory' || node.type === 'package';
  const ownGitStates = gitStatesByPath.get(node.path) || [];
  const descendantGitStates = isDir ? collectDescendantGitStates(node, gitStatesByPath) : ownGitStates;
  const displayGitStates = isDir ? descendantGitStates : ownGitStates;
  const toneClass = getTreeToneClass(displayGitStates, Boolean(isSelected));
  const stateCounts = isDir ? collectDescendantGitStateCounts(node, gitStatesByPath) : null;
  const fileMarker = !isDir ? getPrimaryMarker(ownGitStates) : null;

  return (
    <div>
      <button
        onClick={() => {
          if (isDir && hasChildren) setSidebarExpanded(!sidebarExpanded);
          setSelectedNode(node.path);
          // Only toggle graph expand for files (focus mode), not directories
          if (!isDir) toggleGraphExpand(node.path);
        }}
        className={`w-full flex items-center gap-1 px-1.5 py-[3px] text-[12px] transition-all rounded-md ${
          isSelected
            ? 'bg-accent-muted text-accent border-l-2 border-accent shadow-[inset_0_0_12px_rgba(59,130,246,0.06)]'
            : 'text-foreground-muted hover:bg-surface-hover border-l-2 border-transparent'
        } ${toneClass}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isDir && hasChildren ? (
          sidebarExpanded
            ? <ChevronDown size={12} className="text-foreground-subtle shrink-0" />
            : <ChevronRight size={12} className="text-foreground-subtle shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDir ? (
          sidebarExpanded
            ? <FolderOpen size={13} className="text-foreground-subtle shrink-0" />
            : <Folder size={13} className="text-foreground-subtle shrink-0" />
        ) : (
          getFileIcon(node)
        )}
        <span className="truncate ml-0.5">{node.name}</span>
        {isDir && stateCounts && hasAnyCounts(stateCounts) && (
          <div className="ml-auto flex items-center gap-1 pl-2">
            {stateCounts.unstaged > 0 && (
              <span className="text-[10px] font-semibold text-orange-300">
                {stateCounts.unstaged}M
              </span>
            )}
            {stateCounts.untracked > 0 && (
              <span className="text-[10px] font-semibold text-emerald-300">
                {stateCounts.untracked}U
              </span>
            )}
            {stateCounts.staged > 0 && (
              <span className="text-[10px] font-semibold text-sky-300">
                {stateCounts.staged}A
              </span>
            )}
            {stateCounts.deleted > 0 && (
              <span className="text-[10px] font-semibold text-red-300">
                {stateCounts.deleted}D
              </span>
            )}
          </div>
        )}
        {!isDir && fileMarker && (
          <span className={`ml-auto pl-2 text-[11px] font-semibold ${fileMarker.color}`}>
            {fileMarker.label}
          </span>
        )}
      </button>
      {sidebarExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} gitStatesByPath={gitStatesByPath} />
          ))}
        </div>
      )}
    </div>
  );
}

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const result: FileTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(q)) result.push(node);
    } else if (node.children) {
      const filtered = filterTree(node.children, query);
      if (filtered.length > 0) {
        result.push({ ...node, children: filtered });
      } else if (node.name.toLowerCase().includes(q)) {
        result.push(node);
      }
    }
  }
  return result;
}

export function Sidebar() {
  const visible = useUiStore((s) => s.sidebarVisible);
  const fileTree = useProjectStore((s) => s.fileTree) || [];
  const root = useProjectStore((s) => s.root);
  const scanStatus = useProjectStore((s) => s.scanStatus);
  const sharedGitStatus = useProjectStore((s) => s.gitStatus);
  const [searchQuery, setSearchQuery] = useState('');
  const [stableGitStatus, setStableGitStatus] = useState<ProjectGitStatus | null>(null);
  const cleanRefreshStreakRef = useRef(0);

  useEffect(() => {
    if (!root || scanStatus !== 'ready') {
      setStableGitStatus(null);
      cleanRefreshStreakRef.current = 0;
      return;
    }

    setStableGitStatus((previous) => reconcileGitStatus(previous, sharedGitStatus, cleanRefreshStreakRef));
  }, [sharedGitStatus, root, scanStatus]);

  useEffect(() => {
    if (!root || scanStatus !== 'ready') return;

    const refreshSidebarGitStatus = () => {
      fetch(`/api/git/status?path=${encodeURIComponent(root)}`)
        .then((response) => response.json())
        .then((gitStatus) => {
          if (!gitStatus || gitStatus.error) return;
          setStableGitStatus((previous) => reconcileGitStatus(previous, gitStatus, cleanRefreshStreakRef));
        })
        .catch(() => {});
    };

    refreshSidebarGitStatus();
    const interval = setInterval(refreshSidebarGitStatus, 10000);
    return () => clearInterval(interval);
  }, [root, scanStatus]);

  const gitStatesByPath = useMemo(() => buildGitStatesByPath(root, stableGitStatus), [root, stableGitStatus]);
  const treeWithGitEntries = useMemo(() => mergeGitStatusIntoTree(fileTree, root, stableGitStatus), [fileTree, root, stableGitStatus]);
  const displayTree = filterTree(treeWithGitEntries, searchQuery);

  if (!visible) return null;

  return (
    <div className="glass-panel flex flex-col border-r h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <span className="text-[10px] font-semibold text-foreground-subtle uppercase tracking-[0.1em]">
          Explorer
        </span>
      </div>

      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-border rounded-lg focus-within:border-accent-glow focus-within:shadow-[0_0_8px_rgba(59,130,246,0.1)] transition-all">
          <Search size={12} className="text-foreground-subtle shrink-0" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-[11px] bg-transparent text-foreground placeholder:text-foreground-subtle focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-0.5">
        {scanStatus === 'idle' && !root && (
          <div className="flex flex-col items-center justify-center h-full text-foreground-subtle text-xs gap-3 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center">
              <FolderOpen size={18} className="text-foreground-subtle" />
            </div>
            <span className="text-[11px]">Open a project to explore</span>
          </div>
        )}
        {scanStatus === 'scanning' && (
          <div className="flex items-center justify-center h-32 text-foreground-subtle text-xs">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
              Scanning...
            </div>
          </div>
        )}
        {scanStatus === 'ready' && displayTree.length === 0 && searchQuery && (
          <div className="flex items-center justify-center h-20 text-foreground-subtle text-[11px]">
            No matches for "{searchQuery}"
          </div>
        )}
        {displayTree.map((node) => (
          <FileTreeItem key={node.path} node={node} gitStatesByPath={gitStatesByPath} />
        ))}
      </div>
    </div>
  );
}

function buildGitStatesByPath(root: string | null, gitStatus: ProjectGitStatus | null): Map<string, SidebarGitState[]> {
  const statesByPath = new Map<string, SidebarGitState[]>();
  if (!gitStatus) return statesByPath;

  const add = (filePath: string, state: SidebarGitState) => {
    const absolutePath = toAbsoluteGitPath(root, filePath);
    const existing = statesByPath.get(absolutePath) || [];
    if (!existing.includes(state)) existing.push(state);
    statesByPath.set(absolutePath, existing);
  };

  for (const filePath of gitStatus.staged) add(filePath, 'staged');
  for (const filePath of gitStatus.unstaged) add(filePath, 'unstaged');
  for (const filePath of gitStatus.untracked) add(filePath, 'untracked');
  for (const filePath of gitStatus.stagedDeleted) add(filePath, 'deleted');
  for (const filePath of gitStatus.unstagedDeleted) add(filePath, 'deleted');

  return statesByPath;
}

function collectDescendantGitStates(node: FileTreeNode, gitStatesByPath: Map<string, SidebarGitState[]>): SidebarGitState[] {
  const states = new Set<SidebarGitState>(gitStatesByPath.get(node.path) || []);

  const visit = (current: FileTreeNode) => {
    for (const state of gitStatesByPath.get(current.path) || []) {
      states.add(state);
    }
    for (const child of current.children || []) {
      visit(child);
    }
  };

  visit(node);
  return [...states];
}

function collectDescendantGitStateCounts(
  node: FileTreeNode,
  gitStatesByPath: Map<string, SidebarGitState[]>,
): Record<SidebarGitState, number> {
  const counts: Record<SidebarGitState, number> = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    deleted: 0,
  };

  const visit = (current: FileTreeNode) => {
    const states = gitStatesByPath.get(current.path) || [];
    for (const state of states) {
      counts[state] += 1;
    }
    for (const child of current.children || []) {
      visit(child);
    }
  };

  visit(node);
  return counts;
}

function getTreeToneClass(states: SidebarGitState[], isSelected: boolean): string {
  if (isSelected || states.length === 0) return '';
  if (states.includes('untracked')) return 'text-emerald-100/95 bg-emerald-500/6';
  if (states.includes('deleted')) return 'text-red-100/95 bg-red-500/6';
  if (states.includes('staged')) return 'text-sky-100/95 bg-sky-500/6';
  if (states.includes('unstaged')) return 'text-orange-100/95 bg-orange-500/6';
  return '';
}

function toAbsoluteGitPath(root: string | null, filePath: string): string {
  if (!root) return filePath;
  if (isAbsolutePath(filePath)) return normalizePath(filePath);
  return joinPath(root, filePath);
}

function mergeGitStatusIntoTree(fileTree: FileTreeNode[], root: string | null, gitStatus: ProjectGitStatus | null): FileTreeNode[] {
  if (!root || !gitStatus) return fileTree;

  const nextTree = structuredClone(fileTree);
  const gitOnlyPaths = new Set<string>([
    ...gitStatus.untracked,
    ...gitStatus.stagedDeleted,
    ...gitStatus.unstagedDeleted,
  ]);

  for (const gitPath of gitOnlyPaths) {
    insertFileNode(nextTree, root, toAbsoluteGitPath(root, gitPath));
  }

  return nextTree;
}

function hasGitStatusChanges(gitStatus: ProjectGitStatus | null | undefined): boolean {
  return Boolean(
    gitStatus?.staged?.length ||
    gitStatus?.unstaged?.length ||
    gitStatus?.untracked?.length ||
    gitStatus?.stagedDeleted?.length ||
    gitStatus?.unstagedDeleted?.length,
  );
}

function reconcileGitStatus(
  previous: ProjectGitStatus | null,
  incoming: ProjectGitStatus | null,
  cleanRefreshStreakRef: { current: number },
): ProjectGitStatus | null {
  const headAdvanced = Boolean(
    incoming?.commitHash &&
    previous?.commitHash &&
    incoming.commitHash !== previous.commitHash,
  );

  if (headAdvanced && !hasGitStatusChanges(incoming)) {
    cleanRefreshStreakRef.current = 0;
    return incoming;
  }

  if (hasGitStatusChanges(incoming)) {
    cleanRefreshStreakRef.current = 0;
    return incoming;
  }

  if (hasGitStatusChanges(previous)) {
    if (cleanRefreshStreakRef.current < SIDEBAR_DIRTY_STATE_CLEAR_CONFIRMATIONS - 1) {
      cleanRefreshStreakRef.current += 1;
      return previous;
    }
    cleanRefreshStreakRef.current = 0;
  }

  return incoming;
}

function insertFileNode(tree: FileTreeNode[], root: string, absolutePath: string): void {
  const normalizedRoot = normalizePath(root);
  const normalizedAbsolutePath = normalizePath(absolutePath);
  if (!normalizedAbsolutePath.startsWith(normalizedRoot)) return;

  const relativePath = relativePathFromRoot(normalizedRoot, normalizedAbsolutePath);
  if (!relativePath || relativePath.startsWith('..')) return;

  const segments = relativePath.split('/').filter(Boolean);
  let currentLevel = tree;
  let currentPath = normalizedRoot;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    currentPath = joinPath(currentPath, segment);
    const isLeaf = index === segments.length - 1;
    const existing = currentLevel.find((node) => node.path === currentPath);

    if (existing) {
      if (!isLeaf) {
        existing.children = existing.children || [];
        currentLevel = existing.children;
      }
      continue;
    }

    const newNode: FileTreeNode = isLeaf
      ? {
          name: segment,
          path: currentPath,
          type: 'file',
          language: getLanguageFromName(segment),
        }
      : {
          name: segment,
          path: currentPath,
          type: 'directory',
          children: [],
        };

    currentLevel.push(newNode);
    currentLevel.sort((a, b) => {
      if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    if (!isLeaf) {
      currentLevel = newNode.children || [];
    }
  }
}

function getLanguageFromName(name: string): string | undefined {
  const extension = getFileExtension(name);
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.css': 'css',
    '.py': 'python',
    '.md': 'markdown',
  };
  return languageMap[extension];
}

function hasAnyCounts(counts: Record<SidebarGitState, number>): boolean {
  return counts.staged > 0 || counts.unstaged > 0 || counts.untracked > 0 || counts.deleted > 0;
}

function getPrimaryMarker(states: SidebarGitState[]): { label: string; color: string } | null {
  if (states.includes('deleted')) return { label: 'D', color: 'text-red-300' };
  if (states.includes('untracked')) return { label: 'U', color: 'text-emerald-300' };
  if (states.includes('unstaged')) return { label: 'M', color: 'text-orange-300' };
  if (states.includes('staged')) return { label: 'A', color: 'text-sky-300' };
  return null;
}


function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(normalizePath(value));
}

function joinPath(base: string, segment: string): string {
  const normalizedBase = normalizePath(base).replace(/\/$/, '');
  const normalizedSegment = normalizePath(segment).replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSegment}`;
}

function relativePathFromRoot(root: string, absolutePath: string): string {
  const normalizedRoot = normalizePath(root).replace(/\/$/, '');
  const normalizedAbsolute = normalizePath(absolutePath);
  if (normalizedAbsolute === normalizedRoot) return '';
  if (!normalizedAbsolute.startsWith(`${normalizedRoot}/`)) return '../';
  return normalizedAbsolute.slice(normalizedRoot.length + 1);
}

function getFileExtension(name: string): string {
  const normalizedName = normalizePath(name);
  const lastDot = normalizedName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return normalizedName.slice(lastDot).toLowerCase();
}
