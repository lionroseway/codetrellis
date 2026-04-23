import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Files, Package } from 'lucide-react';

import { getChangeVisual, type GraphNodeVisualData } from '../../../lib/graph-visuals';

interface PackageNodeData extends GraphNodeVisualData {
  label: string;
  childCount: number;
  onToggle?: () => void;
}

function PackageNodeComponent({ data }: NodeProps) {
  const d = data as PackageNodeData;
  const change = getChangeVisual(d.changeStatus);

  return (
    <div
      className="group relative w-[260px] overflow-hidden rounded-[24px] border border-blue-300/14 bg-[linear-gradient(180deg,rgba(59,130,246,0.16),rgba(8,14,29,0.76))] px-4 py-3 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-200/24"
      style={{ boxShadow: `0 24px 56px rgba(0,0,0,0.46), 0 0 40px ${change?.glow || 'rgba(59, 130, 246, 0.26)'}` }}
      onClick={() => d.onToggle?.()}
    >
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-blue-100 !shadow-[0_0_12px_rgba(59,130,246,0.65)]" />
      <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.2),transparent_44%)]" />
      <div className="relative z-10">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-blue-200/18 bg-blue-500/12 shadow-[0_0_22px_rgba(59,130,246,0.18)]">
            <Package size={18} className="text-blue-100" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-blue-50">{d.label}</div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-blue-100/72">
                  <span className="rounded-full border border-blue-200/16 bg-blue-500/10 px-2 py-1">{d.childCount} files</span>
                  {typeof d.connectionCount === 'number' && (
                    <span className="rounded-full border border-white/8 bg-white/6 px-2 py-1 text-zinc-100/90">
                      {d.connectionCount} links
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  d.onToggle?.();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/8 bg-white/6 text-blue-100/80 transition-colors hover:bg-white/12"
              >
                {d.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
          </div>
        </div>

        {d.topFiles && d.topFiles.length > 0 && (
          <div className="mt-3 rounded-2xl border border-white/8 bg-black/14 px-3 py-2">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-blue-100/58">
              <Files size={11} />
              Hot Files
            </div>
            <div className="space-y-1">
              {d.topFiles.slice(0, 4).map((file) => (
                <div key={file} className="truncate text-[11px] text-zinc-100/88">
                  {file}
                </div>
              ))}
            </div>
          </div>
        )}

        {change && (
          <div className="mt-3 inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold text-blue-50" style={{ borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)' }}>
            {change.symbol}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-blue-100 !shadow-[0_0_12px_rgba(59,130,246,0.65)]" />
    </div>
  );
}

export const PackageNode = memo(PackageNodeComponent);
PackageNode.displayName = 'PackageNode';
