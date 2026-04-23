import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronRight, Package } from 'lucide-react';

interface PackageNodeData {
  label: string;
  childCount: number;
  expanded?: boolean;
  topFiles?: string[];
  connectionCount?: number;
  changeStatus?: string;
  onToggle?: () => void;
  [key: string]: unknown;
}

export function PackageNode({ data }: NodeProps) {
  const d = data as unknown as PackageNodeData;

  return (
    <div
      className="px-4 py-3 rounded-xl border-2 border-blue-500/30 bg-blue-950/40 backdrop-blur-sm shadow-[0_0_15px_rgba(59,130,246,0.15)] min-w-[160px] cursor-pointer hover:shadow-[0_0_20px_rgba(59,130,246,0.25)] transition-all"
      onClick={() => d.onToggle?.()}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-2 !h-2 !shadow-[0_0_4px_rgba(59,130,246,0.6)]" />
      <div className="flex items-center gap-2">
        <Package size={16} className="text-blue-400 shrink-0 drop-shadow-[0_0_4px_rgba(59,130,246,0.5)]" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-blue-100 truncate">{d.label}</span>
            <span className="text-[10px] text-blue-300/70 bg-blue-500/10 px-1.5 py-0.5 rounded-full border border-blue-500/20 shrink-0">
              {d.childCount} files
            </span>
          </div>
          {d.topFiles && d.topFiles.length > 0 && (
            <div className="text-[9px] text-blue-300/40 mt-1 truncate">
              {d.topFiles.slice(0, 4).join(' · ')}
            </div>
          )}
        </div>
        <ChevronRight size={14} className="text-blue-300/50 shrink-0" />
      </div>
      {d.connectionCount != null && d.connectionCount > 0 && (
        <div className="text-[9px] text-blue-400/50 mt-1">
          {d.connectionCount} connections
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-2 !h-2 !shadow-[0_0_4px_rgba(59,130,246,0.6)]" />
    </div>
  );
}
