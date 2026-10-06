import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { Box, Braces, Hash, Layers, LetterText, List, type LucideIcon } from 'lucide-react';

import { LOD_ZOOM, statusOutline, type GraphNodeVisualData } from '../../../lib/graph-visuals';
import { GRAPH_CHROME } from '../../../lib/visual-language';
import { useUiStore } from '../../../stores/ui-store';
import { BreakpointBadge } from './BreakpointBadge';

interface SymbolNodeData extends GraphNodeVisualData {
  label: string;
  symbolKind: string;
}

/**
 * The kind is the icon and the word on the card, not a hue: green, blue and
 * violet already mean done, in progress and planned (audit collisions 2, 3, 6).
 */
const KIND_ICON: Record<string, LucideIcon> = {
  function: Braces,
  class: Box,
  method: Braces,
  interface: Layers,
  type: LetterText,
  enum: List,
  variable: Hash,
};

function SymbolNodeComponent({ data }: NodeProps) {
  const d = data as SymbolNodeData;
  const Icon = KIND_ICON[d.symbolKind] || KIND_ICON.variable;
  const perf = useUiStore((s) => s.graphStyle) === 'performance';
  const zoomedOut = useStore((st) => st.transform[2] < LOD_ZOOM);

  return (
    <div
      className={`group relative w-[190px] overflow-hidden rounded-[18px] border px-3 py-2.5 ${perf ? '' : 'backdrop-blur-lg transition-all duration-300 hover:-translate-y-0.5'}`}
      style={perf
        ? {
            borderColor: GRAPH_CHROME.symbolBorder,
            // Opaque base: without the blur, a translucent card shows the edges behind it.
            background: GRAPH_CHROME.symbolGround(true),
            ...statusOutline({ glow: GRAPH_CHROME.glow, changed: false }),
          }
        : {
            borderColor: GRAPH_CHROME.symbolBorder,
            background: GRAPH_CHROME.symbolGround(false),
            boxShadow: GRAPH_CHROME.symbolShadow,
          }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/70" />
      <BreakpointBadge title={(data as Record<string, unknown>).breakpointTitle} />
      {perf && zoomedOut ? (
        <div className="flex min-h-[36px] items-center gap-2">
          <Icon size={20} style={{ color: GRAPH_CHROME.symbolIcon }} />
          <div className="min-w-0 flex-1 truncate text-[18px] font-semibold text-zinc-50">{d.label}</div>
        </div>
      ) : (
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/8" style={{ backgroundColor: GRAPH_CHROME.iconGround }}>
          <Icon size={14} className="drop-shadow-[0_0_8px_currentColor]" style={{ color: GRAPH_CHROME.symbolIcon }} />
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
