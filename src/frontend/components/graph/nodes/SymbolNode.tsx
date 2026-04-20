import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Braces, Box, type LucideIcon, Hash, Layers, LetterText, List } from 'lucide-react';

interface SymbolNodeData {
  label: string;
  symbolKind: string;
  [key: string]: unknown;
}

const KIND_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string; border: string; glow: string }> = {
  function: { icon: Braces, color: 'text-green-400', bg: 'bg-green-950/30', border: 'border-green-500/20', glow: 'shadow-[0_0_6px_rgba(34,197,94,0.1)]' },
  class: { icon: Box, color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-500/20', glow: 'shadow-[0_0_6px_rgba(59,130,246,0.1)]' },
  method: { icon: Braces, color: 'text-blue-300', bg: 'bg-blue-950/20', border: 'border-blue-500/15', glow: '' },
  interface: { icon: Layers, color: 'text-purple-400', bg: 'bg-purple-950/30', border: 'border-purple-500/20', glow: 'shadow-[0_0_6px_rgba(139,92,246,0.1)]' },
  type: { icon: LetterText, color: 'text-purple-300', bg: 'bg-purple-950/20', border: 'border-purple-500/15', glow: '' },
  enum: { icon: List, color: 'text-yellow-400', bg: 'bg-yellow-950/30', border: 'border-yellow-500/20', glow: '' },
  variable: { icon: Hash, color: 'text-zinc-400', bg: 'bg-zinc-900/30', border: 'border-zinc-500/15', glow: '' },
};

export function SymbolNode({ data }: NodeProps) {
  const d = data as unknown as SymbolNodeData;
  const config = KIND_CONFIG[d.symbolKind] || KIND_CONFIG.variable;
  const Icon = config.icon;

  return (
    <div className={`px-2.5 py-1.5 rounded-lg border ${config.border} ${config.bg} ${config.glow} backdrop-blur-sm min-w-[80px] hover:bg-white/[0.03] transition-all`}>
      <Handle type="target" position={Position.Top} className="!bg-zinc-400 !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={`${config.color} shrink-0 drop-shadow-[0_0_3px_currentColor]`} />
        <span className="text-[11px] text-zinc-300 truncate">{d.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400 !w-1.5 !h-1.5" />
    </div>
  );
}
