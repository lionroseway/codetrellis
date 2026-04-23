import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArrowDownLeft, ArrowUpRight, Check, FileCode, FileJson, FileText } from 'lucide-react';

import { getChangeVisual, getLanguageLabel, getLanguageVisual, type GraphNodeVisualData } from '../../../lib/graph-visuals';

interface FileNodeData extends GraphNodeVisualData {
  label: string;
  onToggle?: () => void;
}

function FileIcon({ language, size = 18 }: { language?: string; size?: number }) {
  const color = getLanguageVisual(language).accent;
  const className = 'shrink-0 drop-shadow-[0_0_8px_currentColor]';

  if (language === 'json') return <FileJson size={size} className={className} style={{ color }} />;
  if (language === 'markdown') return <FileText size={size} className={className} style={{ color }} />;
  return <FileCode size={size} className={className} style={{ color }} />;
}

function FileNodeComponent({ data }: NodeProps) {
  const d = data as FileNodeData;
  const language = getLanguageVisual(d.language);
  const change = getChangeVisual(d.changeStatus);
  const isGhost = d.ghost || d.changeStatus === 'planned_add';
  const isFocused = Boolean(d.isFocused);
  const isHub = Boolean(d.isHub);
  const isRemoved = d.changeStatus === 'removed' || d.changeStatus === 'planned_remove';
  const exportsList = d.exports?.slice(0, isFocused ? 8 : 4) || [];
  const showRichMeta = isFocused || isHub || isGhost;
  const wrapperClass = isFocused
    ? 'w-[280px] min-h-[196px] px-4 py-4'
    : isHub
      ? 'w-[232px] min-h-[118px] px-3.5 py-3'
      : isGhost
        ? 'w-[210px] min-h-[92px] px-3 py-2.5'
        : 'w-[176px] min-h-[68px] px-3 py-2.5';

  return (
    <div
      className={[
        'group relative overflow-hidden rounded-[22px] border border-white/10',
        'bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.03))]',
        'backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/18',
        'shadow-[0_22px_48px_rgba(4,8,20,0.45)]',
        wrapperClass,
        d.frozen ? 'opacity-65 saturate-75' : '',
        isGhost ? 'border-dashed border-emerald-300/30 bg-[linear-gradient(180deg,rgba(34,197,94,0.14),rgba(11,26,18,0.52))] opacity-80' : '',
        isRemoved ? 'opacity-55' : '',
      ].join(' ')}
      onClick={() => d.onToggle?.()}
      style={{
        boxShadow: `0 24px 60px rgba(3,7,18,0.48), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 36px ${change?.glow || language.glow}`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-white/70 !shadow-[0_0_10px_rgba(255,255,255,0.4)]" />
      <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,var(--node-glow),transparent_44%)] opacity-90" style={{ ['--node-glow' as string]: change?.glow || language.glow }} />
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-80" />

      {(isFocused || d.changeStatus === 'in_progress_task' || d.changeStatus === 'active') && (
        <div
          className={[
            'pointer-events-none absolute inset-[-1px] rounded-[22px] border border-white/12',
            isFocused ? 'animate-graph-glow-pulse' : 'animate-node-pulse',
          ].join(' ')}
          style={{ boxShadow: `0 0 0 1px rgba(255,255,255,0.05) inset, 0 0 28px ${change?.glow || language.glow}` }}
        />
      )}

      {d.taskNumber != null && (
        <div className="absolute left-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full border border-blue-300/25 bg-blue-500/14 px-2 text-[10px] font-semibold text-blue-100 shadow-[0_0_18px_rgba(59,130,246,0.25)]">
          {d.taskNumber}
        </div>
      )}

      {d.done && (
        <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-500/16 text-emerald-50 shadow-[0_0_18px_rgba(34,197,94,0.28)]">
          <Check size={12} />
        </div>
      )}

      {d.direction && (
        <div className={`absolute ${d.done ? 'right-11' : 'right-3'} top-3 flex h-6 min-w-6 items-center justify-center rounded-full border px-2 ${
          d.direction === 'outbound'
            ? 'border-blue-300/25 bg-blue-500/14 text-blue-100 shadow-[0_0_14px_rgba(59,130,246,0.26)]'
            : 'border-amber-300/25 bg-amber-500/14 text-amber-100 shadow-[0_0_14px_rgba(245,158,11,0.26)]'
        }`}>
          {d.direction === 'outbound' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
        </div>
      )}

      <div className="relative z-10 flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8"
            style={{
              width: isFocused ? 44 : 36,
              height: isFocused ? 44 : 36,
              boxShadow: `0 0 18px ${language.glow}`,
              backgroundColor: language.bg,
            }}
          >
            <FileIcon language={d.language} size={isFocused ? 22 : 18} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className={`truncate font-semibold tracking-[0.01em] text-zinc-50 ${isFocused ? 'text-[15px]' : isHub ? 'text-[13px]' : 'text-[12px]'} ${isRemoved ? 'line-through' : ''}`}>
                  {d.label}
                </div>
                {(isFocused || isHub) && d.fullPath && (
                  <div className="mt-1 truncate font-mono text-[10px] text-zinc-400/85">
                    {d.fullPath}
                  </div>
                )}
              </div>

              {showRichMeta && (
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold tracking-[0.14em] ${language.badge}`}>
                    {getLanguageLabel(d.language)}
                  </span>
                  {typeof d.connectionCount === 'number' && (
                    <span className="rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[10px] font-medium text-zinc-100">
                      {d.connectionCount} links
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {(isFocused || isHub) && exportsList.length > 0 && (
          <div className="rounded-2xl border border-white/8 bg-black/16 px-3 py-2">
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-zinc-400/80">
              <span>Exports</span>
              {typeof d.symbolCount === 'number' && <span>{d.symbolCount} symbols</span>}
            </div>
            <div className={`space-y-1 ${isFocused ? 'max-h-24 overflow-y-auto pr-1' : ''}`}>
              {exportsList.map((name) => (
                <div key={name} className="truncate text-[11px] text-zinc-100/92">
                  {name}
                </div>
              ))}
            </div>
          </div>
        )}

        {isGhost && d.taskDescription && (
          <div className="mt-auto rounded-2xl border border-emerald-300/15 bg-emerald-500/10 px-3 py-2 text-[11px] italic text-emerald-100/88">
            {d.taskDescription}
          </div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        {change && (
          <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${change.tone}`}>
            {change.symbol}
          </span>
        )}
        {isGhost && (
          <span className="rounded-full border border-emerald-300/20 bg-emerald-500/12 px-2 py-1 text-[10px] font-semibold text-emerald-100">
            NEW
          </span>
        )}
        {!showRichMeta && typeof d.connectionCount === 'number' && d.connectionCount > 0 && (
          <span className="rounded-full border border-white/8 bg-white/6 px-2 py-1 text-[10px] text-zinc-100/90">
            {d.connectionCount}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-white/70 !shadow-[0_0_10px_rgba(255,255,255,0.4)]" />
    </div>
  );
}

export const FileNode = memo(FileNodeComponent);
FileNode.displayName = 'FileNode';
