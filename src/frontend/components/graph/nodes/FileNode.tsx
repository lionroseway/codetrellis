import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { ArrowDownLeft, ArrowUpRight, Check, FileCode, FileJson, FileText, Focus } from 'lucide-react';

import { getChangeVisual, getLanguageLabel, getLanguageVisual, farStatusStyle, LOD_ZOOM, statusOutline, type GraphNodeVisualData } from '../../../lib/graph-visuals';
import { chipClass, GIT, GRAPH_CHROME, GRAPH_MARK, INTENT, nodeChange, type StateVisual } from '../../../lib/visual-language';
import { useUiStore } from '../../../stores/ui-store';
import { BreakpointBadge } from './BreakpointBadge';
import { GroundingMark } from './GroundingMark';
import { PlannedOverlapMark } from './PlannedOverlapMark';
import { RuleBreachMark } from './RuleBreachMark';
import { WorkOverlayMarks } from './WorkOverlayMarks';

const NODE_CARD_PLANNED = nodeChange('planned_add')?.card ?? '';

/** A git or planned state on a card's chip row, in the vocabulary. */
function gitChipState(state: string): StateVisual {
  if (state === 'planned_add' || state === 'planned_modify') return INTENT.planned;
  if (state === 'planned_remove') return nodeChange('planned_remove')!.state;
  if (state === 'untracked') return GIT.untracked;
  if (state === 'staged') return GIT.staged;
  return GIT.unstaged;
}

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
  const changeVisual = nodeChange(d.changeStatus);
  const isGhost = d.ghost || d.changeStatus === 'planned_add';
  const isFocused = Boolean(d.isFocused);
  const isHub = Boolean(d.isHub);
  const isRemoved = d.changeStatus === 'removed' || d.changeStatus === 'planned_remove';
  const exportsList = d.exports?.slice(0, isFocused ? 8 : 4) || [];
  const showRichMeta = isFocused || isHub || isGhost;
  const isRelatedToSelection = Boolean(d.relatedToSelection);
  const isPlanHighlighted = Boolean(d.planHighlighted);
  const gitStates = Array.isArray(d.gitStates) ? d.gitStates : [];
  const mode = typeof d.mode === 'string' ? d.mode : undefined;
  const perf = useUiStore((s) => s.graphStyle) === 'performance';
  const isLive = d.changeStatus === 'in_progress_task' || d.changeStatus === 'active';
  const glow = change?.glow || language.glow;
  // Boolean selector: re-renders on crossing the threshold, not on every zoom tick.
  const zoomedOut = useStore((st) => st.transform[2] < LOD_ZOOM);
  const far = perf && zoomedOut;
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
        GRAPH_CHROME.glassCard,
        perf
          ? `${GRAPH_CHROME.perfGround} hover:border-white/18`
          : `backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/18 ${GRAPH_CHROME.glassShadow}`,
        wrapperClass,
        d.frozen ? 'opacity-65 saturate-75' : '',
        // A ghost is a planned add: planned's dashed violet, whatever its status says.
        isGhost ? `${NODE_CARD_PLANNED} opacity-80` : '',
        isRemoved ? 'opacity-55' : '',
        !isRelatedToSelection && d.relatedToSelection != null ? 'opacity-50' : '',
        // The status tints the card; the view mode never does, so a mode
        // cannot paint over a status (audit collision 24). Baseline only greys.
        changeVisual && !isGhost ? changeVisual.card : '',
        mode === 'current' ? 'grayscale-[0.18]' : '',
        !perf && isPlanHighlighted && !d.changeStatus ? GRAPH_MARK.footprintGlass : '',
      ].join(' ')}
      data-plan-highlighted={isPlanHighlighted || undefined}
      style={perf
        ? (far ? farStatusStyle : statusOutline)({
            glow,
            changed: Boolean(change),
            planned: typeof d.changeStatus === 'string' && d.changeStatus.startsWith('planned_'),
            live: isLive,
            focused: isFocused,
            planHighlighted: isPlanHighlighted,
          })
        : {
            boxShadow: GRAPH_CHROME.nodeShadow(glow, isRelatedToSelection),
          }}
    >
      <Handle type="target" position={Position.Top} className={GRAPH_CHROME.handle} />
      <BreakpointBadge title={(data as Record<string, unknown>).breakpointTitle} />
      <GroundingMark grounding={(data as Record<string, unknown>).grounding} />
      <PlannedOverlapMark planned={(data as Record<string, unknown>).plannedOverlap} />
      <RuleBreachMark breach={(data as Record<string, unknown>).ruleBreach} />
      <WorkOverlayMarks workCount={(data as Record<string, unknown>).workCount} collisionTitle={(data as Record<string, unknown>).collisionTitle} />
      <div className={`pointer-events-none absolute inset-0 rounded-[22px] ${GRAPH_CHROME.sheen} opacity-90`} style={{ ['--node-glow' as string]: change?.glow || language.glow }} />
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-80" />

      {!perf && (isFocused || isLive) && (
        <div
          className={[
            'pointer-events-none absolute inset-[-1px] rounded-[22px] border border-white/12',
            isFocused ? 'animate-graph-glow-pulse' : 'animate-node-pulse',
          ].join(' ')}
          style={{ boxShadow: GRAPH_CHROME.pulseShadow(change?.glow || language.glow) }}
        />
      )}
      {!perf && isPlanHighlighted && !d.changeStatus && (
        <div className={`pointer-events-none absolute inset-[-2px] rounded-[24px] ${GRAPH_MARK.footprintPulse} animate-pulse`} />
      )}

      {far ? (
        <div className="relative z-10 flex min-h-[44px] items-center gap-2">
          <FileIcon language={d.language} size={24} />
          <span className="min-w-0 flex-1 truncate text-[20px] font-semibold text-zinc-50">{d.label}</span>
          {change && (
            <span className="text-[28px] font-bold leading-none text-white" title={change.word}>{change.symbol}</span>
          )}
        </div>
      ) : (
        <>
        {d.taskNumber != null && (
          <div className={`absolute left-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[10px] font-semibold ${GRAPH_MARK.taskNumber}`} title={`Task ${d.taskNumber}`}>
            {d.taskNumber}
          </div>
        )}

        {d.done && (
          <div className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border ${GRAPH_MARK.done}`} title="Done">
            <Check size={12} />
          </div>
        )}

        {d.direction && (
          // Direction is the arrow, not a hue: blue and amber both mean states.
          <div
            className={`absolute ${d.done ? 'right-11' : 'right-3'} top-3 flex h-6 min-w-6 items-center justify-center rounded-full border px-2 ${GRAPH_MARK.direction}`}
            title={d.direction === 'outbound' ? 'Imported by the focused file' : 'Imports the focused file'}
          >
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
                    {mode && (
                      <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold tracking-[0.14em] ${GRAPH_MARK.modeChip}`}>
                        {mode === 'current' ? 'baseline' : mode}
                      </span>
                    )}
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
            <div className={`mt-auto rounded-2xl border px-3 py-2 text-[11px] italic ${chipClass(INTENT.planned.tone)}`}>
              {d.taskDescription}
            </div>
          )}
        </div>

        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          {change && (
            <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${change.tone}`} title={change.word}>
              {change.symbol}
            </span>
          )}
          {isGhost && (
            <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${chipClass(INTENT.planned.tone)}`}>
              {INTENT.planned.glyph} NEW
            </span>
          )}
          {!showRichMeta && typeof d.connectionCount === 'number' && d.connectionCount > 0 && (
            <span className="rounded-full border border-white/8 bg-white/6 px-2 py-1 text-[10px] text-zinc-100/90">
              {d.connectionCount}
            </span>
          )}
          {gitStates.map((state) => (
            <span
              key={state}
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${chipClass(gitChipState(state).tone)}`}
              title={gitChipState(state).word}
            >
              {state === 'planned_add' ? 'planned +' :
               state === 'planned_modify' ? 'planned ~' :
               state === 'planned_remove' ? 'planned −' :
               state}
            </span>
          ))}
        </div>

        <div className="absolute bottom-3 right-3">
          <button
            onClick={(event) => {
              event.stopPropagation();
              d.onToggle?.();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/8 text-zinc-100/82 transition-all hover:bg-white/14 hover:text-white"
            title={isFocused ? 'Return to map view' : 'Focus this file'}
          >
            <Focus size={14} />
          </button>
        </div>

        </>
      )}

      <Handle type="source" position={Position.Bottom} className={GRAPH_CHROME.handle} />
    </div>
  );
}

export const FileNode = memo(FileNodeComponent);
FileNode.displayName = 'FileNode';
