import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronRight, ChevronDown, Package } from 'lucide-react';

interface PackageNodeData {
  label: string;
  childCount: number;
  expanded?: boolean;
  onToggle?: () => void;
  [key: string]: unknown;
}

export function PackageNode({ data }: NodeProps) {
  const d = data as unknown as PackageNodeData;

  return (
    <div className="px-3.5 py-2.5 rounded-xl border border-blue-500/30 bg-blue-950/40 backdrop-blur-sm shadow-[0_0_15px_rgba(59,130,246,0.15)] min-w-[140px] hover:shadow-[0_0_20px_rgba(59,130,246,0.25)] transition-shadow">
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-2 !h-2 !shadow-[0_0_4px_rgba(59,130,246,0.6)]" />
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
          className="text-blue-300/70 hover:text-blue-200 shrink-0 transition-colors"
        >
          {d.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Package size={14} className="text-blue-400 shrink-0 drop-shadow-[0_0_4px_rgba(59,130,246,0.5)]" />
        <span className="text-xs font-semibold text-blue-100 truncate">{d.label}</span>
        <span className="text-[10px] text-blue-300/70 bg-blue-500/10 px-1.5 py-0.5 rounded-full ml-auto border border-blue-500/20">
          {d.childCount}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-2 !h-2 !shadow-[0_0_4px_rgba(59,130,246,0.6)]" />
    </div>
  );
}
