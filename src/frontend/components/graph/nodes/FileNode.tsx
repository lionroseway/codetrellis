import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronRight, ChevronDown, FileCode, FileJson, FileText, Check } from 'lucide-react';

interface FileNodeData {
  label: string;
  fullPath?: string;
  language?: string;
  symbolCount?: number;
  expanded?: boolean;
  changeStatus?: string;
  ghost?: boolean;
  taskDescription?: string;
  taskNumber?: number;
  done?: boolean;
  onToggle?: () => void;
  [key: string]: unknown;
}

const LANG_STYLES: Record<string, { border: string; bg: string; iconColor: string; glow: string }> = {
  typescript: { border: 'border-blue-500/25', bg: 'bg-blue-950/30', iconColor: 'text-blue-400', glow: 'shadow-[0_0_8px_rgba(59,130,246,0.1)]' },
  javascript: { border: 'border-yellow-500/25', bg: 'bg-yellow-950/30', iconColor: 'text-yellow-400', glow: 'shadow-[0_0_8px_rgba(234,179,8,0.1)]' },
  python: { border: 'border-green-500/25', bg: 'bg-green-950/30', iconColor: 'text-green-400', glow: 'shadow-[0_0_8px_rgba(34,197,94,0.1)]' },
  rust: { border: 'border-orange-500/25', bg: 'bg-orange-950/30', iconColor: 'text-orange-400', glow: 'shadow-[0_0_8px_rgba(249,115,22,0.1)]' },
  css: { border: 'border-purple-500/25', bg: 'bg-purple-950/30', iconColor: 'text-purple-400', glow: '' },
  json: { border: 'border-zinc-500/20', bg: 'bg-zinc-900/30', iconColor: 'text-zinc-400', glow: '' },
  markdown: { border: 'border-zinc-600/20', bg: 'bg-zinc-900/20', iconColor: 'text-zinc-500', glow: '' },
};

const CHANGE_STYLES: Record<string, string> = {
  added: 'ring-1 ring-green-400/50 shadow-[0_0_15px_rgba(34,197,94,0.2)]',
  modified: 'ring-1 ring-amber-400/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]',
  removed: 'ring-1 ring-red-400/50 shadow-[0_0_15px_rgba(239,68,68,0.2)] opacity-50',
  affected: 'ring-1 ring-violet-400/30 shadow-[0_0_10px_rgba(139,92,246,0.15)]',
  active: 'ring-2 ring-accent animate-node-pulse',
  planned_add: 'border-dashed !border-green-400/50 shadow-[0_0_20px_rgba(34,197,94,0.2)] bg-green-950/20',
  planned_modify: 'ring-2 ring-amber-400/40 shadow-[0_0_20px_rgba(249,115,22,0.2)]',
  planned_remove: 'border-dashed !border-red-400/50 opacity-30 line-through shadow-[0_0_15px_rgba(239,68,68,0.15)]',
  in_progress_task: 'ring-2 ring-accent animate-node-pulse shadow-[0_0_25px_rgba(59,130,246,0.35)]',
};

const BADGE_STYLES: Record<string, { text: string; bg: string; label: string }> = {
  planned_add: { text: 'text-green-300', bg: 'bg-green-500/20 border-green-500/30', label: '+ NEW' },
  planned_modify: { text: 'text-amber-300', bg: 'bg-amber-500/20 border-amber-500/30', label: '~ MOD' },
  planned_remove: { text: 'text-red-300', bg: 'bg-red-500/20 border-red-500/30', label: '- DEL' },
  in_progress_task: { text: 'text-blue-300', bg: 'bg-accent/20 border-accent/30', label: 'ACTIVE' },
  added: { text: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', label: 'NEW' },
  modified: { text: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', label: 'MOD' },
  removed: { text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: 'DEL' },
  affected: { text: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20', label: 'DEP' },
  active: { text: 'text-blue-400', bg: 'bg-accent/10 border-accent/20', label: 'LIVE' },
};

function FileIcon({ language }: { language?: string }) {
  const color = LANG_STYLES[language || '']?.iconColor || 'text-zinc-500';
  if (language === 'json') return <FileJson size={13} className={`${color} drop-shadow-[0_0_3px_currentColor] shrink-0`} />;
  if (language === 'markdown') return <FileText size={13} className={`${color} shrink-0`} />;
  return <FileCode size={13} className={`${color} drop-shadow-[0_0_3px_currentColor] shrink-0`} />;
}

export function FileNode({ data }: NodeProps) {
  const d = data as unknown as FileNodeData;
  const isGhost = d.ghost || d.changeStatus === 'planned_add';
  const style = LANG_STYLES[d.language || ''] || { border: 'border-zinc-700/30', bg: 'bg-zinc-900/30', iconColor: 'text-zinc-500', glow: '' };
  const changeStyle = d.changeStatus ? CHANGE_STYLES[d.changeStatus] || '' : '';
  const badge = d.changeStatus ? BADGE_STYLES[d.changeStatus] : null;

  return (
    <div className={`relative px-3 py-1.5 rounded-lg border ${isGhost ? 'border-dashed border-green-400/40 bg-green-950/15' : `${style.border} ${style.bg}`} ${style.glow} ${changeStyle} backdrop-blur-sm min-w-[100px] hover:bg-white/[0.03] transition-all`}>
      <Handle type="target" position={Position.Top} className="!bg-zinc-400 !w-1.5 !h-1.5" />

      {/* Task number badge (top-left corner) */}
      {d.taskNumber != null && (
        <div className="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-accent/80 text-white text-[8px] font-bold flex items-center justify-center shadow-[0_0_6px_rgba(59,130,246,0.5)]">
          {d.taskNumber}
        </div>
      )}

      {/* Done checkmark (top-right corner) */}
      {d.done && (
        <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-green-500/80 text-white flex items-center justify-center shadow-[0_0_6px_rgba(34,197,94,0.5)]">
          <Check size={10} />
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {d.onToggle && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onToggle?.(); }}
            className="text-zinc-500 hover:text-zinc-300 shrink-0 transition-colors"
          >
            {d.expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        )}
        <FileIcon language={d.language} />
        <span className={`text-[11px] truncate ${isGhost ? 'text-green-300/70 italic' : 'text-zinc-300'}`}>{d.label}</span>
        {badge && (
          <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full border ${badge.bg} ${badge.text}`}>
            {badge.label}
          </span>
        )}
        {!d.changeStatus && d.symbolCount != null && d.symbolCount > 0 && (
          <span className="text-[9px] text-zinc-500 bg-white/[0.04] px-1.5 rounded-full ml-auto">
            {d.symbolCount}
          </span>
        )}
      </div>
      {d.fullPath && (
        <div className="text-[9px] text-zinc-600 truncate mt-0.5">{d.fullPath}</div>
      )}
      {isGhost && d.taskDescription && (
        <div className="text-[8px] text-green-400/50 truncate mt-0.5 italic">{d.taskDescription}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400 !w-1.5 !h-1.5" />
    </div>
  );
}
