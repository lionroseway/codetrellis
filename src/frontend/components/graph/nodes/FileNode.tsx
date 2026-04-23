import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileCode, FileJson, FileText, Check, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

interface FileNodeData {
  label: string;
  fullPath?: string;
  language?: string;
  symbolCount?: number;
  connectionCount?: number;
  isHub?: boolean;
  isFocused?: boolean;
  direction?: 'inbound' | 'outbound';
  exports?: string[];
  changeStatus?: string;
  ghost?: boolean;
  taskDescription?: string;
  taskNumber?: number;
  done?: boolean;
  frozen?: boolean;
  onToggle?: () => void;
  [key: string]: unknown;
}

const LANG_STYLES: Record<string, { border: string; bg: string; iconColor: string; glow: string }> = {
  typescript: { border: 'border-blue-500/30', bg: 'bg-blue-950/40', iconColor: 'text-blue-400', glow: 'shadow-[0_0_10px_rgba(59,130,246,0.12)]' },
  javascript: { border: 'border-yellow-500/30', bg: 'bg-yellow-950/40', iconColor: 'text-yellow-400', glow: 'shadow-[0_0_10px_rgba(234,179,8,0.12)]' },
  python: { border: 'border-green-500/30', bg: 'bg-green-950/40', iconColor: 'text-green-400', glow: 'shadow-[0_0_10px_rgba(34,197,94,0.12)]' },
  rust: { border: 'border-orange-500/30', bg: 'bg-orange-950/40', iconColor: 'text-orange-400', glow: '' },
  css: { border: 'border-purple-500/30', bg: 'bg-purple-950/40', iconColor: 'text-purple-400', glow: '' },
  json: { border: 'border-zinc-500/20', bg: 'bg-zinc-900/40', iconColor: 'text-zinc-400', glow: '' },
  markdown: { border: 'border-zinc-600/20', bg: 'bg-zinc-900/30', iconColor: 'text-zinc-500', glow: '' },
};

const CHANGE_STYLES: Record<string, string> = {
  added: 'ring-1 ring-green-400/50 shadow-[0_0_15px_rgba(34,197,94,0.2)]',
  modified: 'ring-1 ring-amber-400/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]',
  removed: 'ring-1 ring-red-400/50 shadow-[0_0_15px_rgba(239,68,68,0.2)] opacity-50',
  affected: 'ring-1 ring-violet-400/30 shadow-[0_0_10px_rgba(139,92,246,0.15)]',
  active: 'ring-2 ring-accent animate-node-pulse',
  planned_add: 'border-dashed !border-green-400/50 shadow-[0_0_20px_rgba(34,197,94,0.2)] bg-green-950/20',
  planned_modify: 'ring-2 ring-amber-400/40 shadow-[0_0_20px_rgba(249,115,22,0.2)]',
  planned_remove: 'border-dashed !border-red-400/50 opacity-30',
  in_progress_task: 'ring-2 ring-accent animate-node-pulse shadow-[0_0_25px_rgba(59,130,246,0.35)]',
};

function FileIcon({ language, size = 14 }: { language?: string; size?: number }) {
  const color = LANG_STYLES[language || '']?.iconColor || 'text-zinc-500';
  if (language === 'json') return <FileJson size={size} className={`${color} drop-shadow-[0_0_3px_currentColor] shrink-0`} />;
  if (language === 'markdown') return <FileText size={size} className={`${color} shrink-0`} />;
  return <FileCode size={size} className={`${color} drop-shadow-[0_0_3px_currentColor] shrink-0`} />;
}

export function FileNode({ data }: NodeProps) {
  const d = data as unknown as FileNodeData;
  const isGhost = d.ghost || d.changeStatus === 'planned_add';
  const isFocused = d.isFocused;
  const isHub = d.isHub;
  const style = LANG_STYLES[d.language || ''] || { border: 'border-zinc-700/30', bg: 'bg-zinc-900/40', iconColor: 'text-zinc-500', glow: '' };
  const changeStyle = d.changeStatus ? CHANGE_STYLES[d.changeStatus] || '' : '';
  const frozenStyle = d.frozen ? 'opacity-60 grayscale-[30%]' : '';

  // Hub/focused nodes are larger
  const padding = isFocused ? 'px-4 py-3' : isHub ? 'px-3.5 py-2.5' : 'px-3 py-1.5';
  const minWidth = isFocused ? 'min-w-[200px]' : isHub ? 'min-w-[160px]' : 'min-w-[100px]';
  const borderWidth = isFocused ? 'border-2' : 'border';

  return (
    <div
      className={`relative ${padding} rounded-xl ${borderWidth} ${
        isGhost ? 'border-dashed border-green-400/40 bg-green-950/15'
        : `${style.border} ${style.bg}`
      } ${style.glow} ${changeStyle} ${frozenStyle} backdrop-blur-sm ${minWidth} cursor-pointer hover:brightness-110 transition-all`}
      onClick={() => d.onToggle?.()}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-400 !w-2 !h-2" />

      {/* Task number badge */}
      {d.taskNumber != null && (
        <div className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-accent/80 text-white text-[9px] font-bold flex items-center justify-center shadow-[0_0_6px_rgba(59,130,246,0.5)]">
          {d.taskNumber}
        </div>
      )}

      {/* Done checkmark */}
      {d.done && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-green-500/80 text-white flex items-center justify-center shadow-[0_0_6px_rgba(34,197,94,0.5)]">
          <Check size={11} />
        </div>
      )}

      {/* Direction indicator */}
      {d.direction && (
        <div className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center ${
          d.direction === 'outbound' ? 'bg-blue-500/60' : 'bg-amber-500/60'
        }`}>
          {d.direction === 'outbound'
            ? <ArrowUpRight size={9} className="text-white" />
            : <ArrowDownLeft size={9} className="text-white" />
          }
        </div>
      )}

      {/* Main content */}
      <div className="flex items-center gap-2">
        <FileIcon language={d.language} size={isFocused ? 18 : isHub ? 16 : 13} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`font-medium truncate ${
              isFocused ? 'text-[13px] text-foreground' :
              isHub ? 'text-[12px] text-zinc-200' :
              isGhost ? 'text-[11px] text-green-300/70 italic' :
              'text-[11px] text-zinc-300'
            }`}>{d.label}</span>

            {d.connectionCount != null && d.connectionCount > 0 && (
              <span className="text-[9px] text-zinc-500 bg-white/[0.06] px-1.5 py-0.5 rounded-full shrink-0">
                {d.connectionCount}
              </span>
            )}
          </div>

          {/* Show exports for hub/focused nodes */}
          {(isHub || isFocused) && d.exports && d.exports.length > 0 && (
            <div className="text-[9px] text-zinc-500 mt-0.5 truncate">
              {d.exports.slice(0, 4).join(' · ')}
              {d.exports.length > 4 && ` +${d.exports.length - 4}`}
            </div>
          )}
        </div>

        {/* Change status badge */}
        {d.changeStatus && (
          <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
            d.changeStatus.startsWith('planned_add') ? 'text-green-300 bg-green-500/10 border-green-500/20' :
            d.changeStatus.startsWith('planned_modify') ? 'text-amber-300 bg-amber-500/10 border-amber-500/20' :
            d.changeStatus.startsWith('planned_remove') ? 'text-red-300 bg-red-500/10 border-red-500/20' :
            d.changeStatus === 'in_progress_task' ? 'text-blue-300 bg-accent/10 border-accent/20' :
            d.changeStatus === 'added' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
            d.changeStatus === 'modified' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
            'text-violet-400 bg-violet-500/10 border-violet-500/20'
          }`}>
            {d.changeStatus === 'planned_add' ? '+' :
             d.changeStatus === 'planned_modify' ? '~' :
             d.changeStatus === 'planned_remove' ? '-' :
             d.changeStatus === 'in_progress_task' ? '▸' :
             d.changeStatus === 'added' ? '+' :
             d.changeStatus === 'modified' ? '~' :
             d.changeStatus === 'removed' ? '-' : '!'}
          </span>
        )}
      </div>

      {/* Ghost node task description */}
      {isGhost && d.taskDescription && (
        <div className="text-[8px] text-green-400/40 truncate mt-1 italic">{d.taskDescription}</div>
      )}

      {/* Full path for focused node */}
      {isFocused && d.fullPath && (
        <div className="text-[9px] text-zinc-600 truncate mt-1 font-mono">{d.fullPath}</div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400 !w-2 !h-2" />
    </div>
  );
}
