import { Search, ChevronRight, ChevronDown, Folder, FolderOpen, FileCode, FileJson, FileText, Package } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { useProjectStore } from '../../stores/project-store';
import { useGraphStore } from '../../stores/graph-store';
import type { FileTreeNode } from '@shared/types';
import { useState } from 'react';

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

function FileTreeItem({ node, depth = 0 }: { node: FileTreeNode; depth?: number }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(depth < 1);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const setSelectedNode = useUiStore((s) => s.setSelectedNode);
  const toggleGraphExpand = useGraphStore((s) => s.toggleExpand);

  const isSelected = selectedNodeId === node.path;
  const hasChildren = node.children && node.children.length > 0;
  const isDir = node.type === 'directory' || node.type === 'package';

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
        }`}
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
      </button>
      {sidebarExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} />
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
  const width = useUiStore((s) => s.sidebarWidth);
  const fileTree = useProjectStore((s) => s.fileTree) || [];
  const root = useProjectStore((s) => s.root);
  const scanStatus = useProjectStore((s) => s.scanStatus);
  const [searchQuery, setSearchQuery] = useState('');

  if (!visible) return null;

  const displayTree = filterTree(fileTree, searchQuery);

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
          <FileTreeItem key={node.path} node={node} />
        ))}
      </div>
    </div>
  );
}
