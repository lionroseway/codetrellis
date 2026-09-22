import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { Box, Braces, Hash, Layers, LetterText, List, type LucideIcon } from 'lucide-react';

import { LOD_ZOOM, statusOutline, type GraphNodeVisualData } from '../../../lib/graph-visuals';
import { useUiStore } from '../../../stores/ui-store';

interface SymbolNodeData extends GraphNodeVisualData {
  label: string;
  symbolKind: string;
}

const KIND_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string; border: string; glow: string }> = {
  function: { icon: Braces, color: '#4ade80', bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(74, 222, 128, 0.22)', glow: 'rgba(34, 197, 94, 0.24)' },
  class: { icon: Box, color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(96, 165, 250, 0.22)', glow: 'rgba(59, 130, 246, 0.24)' },
  method: { icon: Braces, color: '#93c5fd', bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(147, 197, 253, 0.18)', glow: 'rgba(59, 130, 246, 0.16)' },
  interface: { icon: Layers, color: '#c084fc', bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(192, 132, 252, 0.22)', glow: 'rgba(168, 85, 247, 0.22)' },
  type: { icon: LetterText, color: '#d8b4fe', bg: 'rgba(168, 85, 247, 0.08)', border: 'rgba(216, 180, 254, 0.18)', glow: 'rgba(168, 85, 247, 0.16)' },
  enum: { icon: List, color: '#facc15', bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(250, 204, 21, 0.22)', glow: 'rgba(234, 179, 8, 0.18)' },
  variable: { icon: Hash, color: '#a1a1aa', bg: 'rgba(161, 161, 170, 0.1)', border: 'rgba(161, 161, 170, 0.18)', glow: 'rgba(161, 161, 170, 0.16)' },
};

function SymbolNodeComponent({ data }: NodeProps) {
  const d = data as SymbolNodeData;
  const config = KIND_CONFIG[d.symbolKind] || KIND_CONFIG.variable;
  const Icon = config.icon;
  const perf = useUiStore((s) => s.graphStyle) === 'performance';
  const zoomedOut = useStore((st) => st.transform[2] < LOD_ZOOM);

  return (
    <div
      className={`group relative w-[190px] overflow-hidden rounded-[18px] border px-3 py-2.5 ${perf ? '' : 'backdrop-blur-lg transition-all duration-300 hover:-translate-y-0.5'}`}
      style={perf
        ? {
            borderColor: config.border,
            // Opaque base: without the blur, a translucent card shows the edges behind it.
            background: `linear-gradient(180deg, rgba(255,255,255,0.12), ${config.bg}), #0e1422`,
            ...statusOutline({ glow: config.glow, changed: false }),
          }
        : {
            borderColor: config.border,
            background: `linear-gradient(180deg, rgba(255,255,255,0.12), ${config.bg})`,
            boxShadow: `0 16px 36px rgba(0,0,0,0.32), 0 0 22px ${config.glow}`,
          }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/70" />
      {perf && zoomedOut ? (
        <div className="flex min-h-[36px] items-center gap-2">
          <Icon size={20} style={{ color: config.color }} />
          <div className="min-w-0 flex-1 truncate text-[18px] font-semibold text-zinc-50">{d.label}</div>
        </div>
      ) : (
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/8" style={{ backgroundColor: config.bg }}>
          <Icon size={14} className="drop-shadow-[0_0_8px_currentColor]" style={{ color: config.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400/75">
            {d.symbolKind}
          </div>
          <div className="truncate text-[12px] text-zinc-100">{d.label}</div>
        </div>
      </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-white/70" />
    </div>
  );
}

export const SymbolNode = memo(SymbolNodeComponent);
SymbolNode.displayName = 'SymbolNode';
