import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';

import { GRAPH_CHROME } from '../../../lib/visual-language';
import { useUiStore } from '../../../stores/ui-store';

interface DirectoryNodeData {
  label: string;
  childCount: number;
  expanded?: boolean;
  onToggle?: () => void;
  [key: string]: unknown;
  connectionCount?: number;
}

function DirectoryNodeComponent({ data }: NodeProps) {
  const d = data as DirectoryNodeData;
  const perf = useUiStore((s) => s.graphStyle) === 'performance';

  return (
    <div className={`group relative w-[230px] overflow-hidden rounded-[20px] border border-white/10 ${GRAPH_CHROME.directoryCard} px-3.5 py-3 hover:border-white/18 ${perf ? GRAPH_CHROME.perfGround : `backdrop-blur-xl ${GRAPH_CHROME.directoryShadow} transition-all duration-300 hover:-translate-y-0.5`}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/70" />
      <div className={`pointer-events-none absolute inset-0 rounded-[20px] ${GRAPH_CHROME.directorySheen}`} />
      <div className="relative z-10 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/6 text-zinc-300 transition-colors hover:bg-white/12"
        >
          {d.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {/* Structure, not state: neutral, so sky keeps its one meaning (staged). */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/8">
          {d.expanded
            ? <FolderOpen size={17} className="text-zinc-100 shrink-0" />
            : <Folder size={17} className="text-zinc-100/90 shrink-0" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-zinc-100">{d.label}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400/72">
            Directory cluster
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full border border-white/8 bg-white/6 px-2 py-1 text-[10px] text-zinc-100">{d.childCount}</span>
          {typeof d.connectionCount === 'number' && (
            <span className="text-[10px] text-zinc-400/78">{d.connectionCount} links</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-white/70" />
    </div>
  );
}

export const DirectoryNode = memo(DirectoryNodeComponent);
DirectoryNode.displayName = 'DirectoryNode';
