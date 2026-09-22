import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';

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
    <div className={`group relative w-[230px] overflow-hidden rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(13,17,28,0.7))] px-3.5 py-3 hover:border-white/18 ${perf ? 'bg-[#0e1422]' : 'backdrop-blur-xl shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition-all duration-300 hover:-translate-y-0.5'}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/70" />
      <div className="pointer-events-none absolute inset-0 rounded-[20px] bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_40%)]" />
      <div className="relative z-10 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/6 text-zinc-300 transition-colors hover:bg-white/12"
        >
          {d.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-sky-500/10">
          {d.expanded
            ? <FolderOpen size={17} className="text-sky-100 shrink-0 drop-shadow-[0_0_8px_rgba(56,189,248,0.35)]" />
            : <Folder size={17} className="text-sky-100/90 shrink-0 drop-shadow-[0_0_8px_rgba(56,189,248,0.35)]" />
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
