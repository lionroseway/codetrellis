import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';

interface DirectoryNodeData {
  label: string;
  childCount: number;
  expanded?: boolean;
  onToggle?: () => void;
  [key: string]: unknown;
}

export function DirectoryNode({ data }: NodeProps) {
  const d = data as unknown as DirectoryNodeData;

  return (
    <div className="px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm min-w-[120px] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all">
      <Handle type="target" position={Position.Top} className="!bg-zinc-400 !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
          className="text-zinc-500 hover:text-zinc-300 shrink-0 transition-colors"
        >
          {d.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {d.expanded
          ? <FolderOpen size={13} className="text-zinc-400 shrink-0" />
          : <Folder size={13} className="text-zinc-500 shrink-0" />
        }
        <span className="text-[11px] font-medium text-zinc-300 truncate">{d.label}</span>
        <span className="text-[10px] text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded-full ml-auto border border-white/[0.06]">
          {d.childCount}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400 !w-1.5 !h-1.5" />
    </div>
  );
}
