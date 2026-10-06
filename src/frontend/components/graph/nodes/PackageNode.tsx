import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Files, Orbit } from 'lucide-react';

import { farStatusStyle, getChangeVisual, LOD_ZOOM, statusOutline, type GraphNodeVisualData } from '../../../lib/graph-visuals';
import { chipClass, GIT, GRAPH_CHROME, GRAPH_MARK, INTENT, nodeChange } from '../../../lib/visual-language';
import { useUiStore } from '../../../stores/ui-store';
import { BreakpointBadge } from './BreakpointBadge';
import { GroundingMark } from './GroundingMark';
import { PlannedOverlapMark } from './PlannedOverlapMark';

interface PackageNodeData extends GraphNodeVisualData {
  label: string;
  childCount: number;
  description?: string;
  sourceLabel?: string;
  plannedChangeCount?: number;
  localChangeCount?: number;
  onToggle?: () => void;
}

function PackageNodeComponent({ data }: NodeProps) {
  const d = data as PackageNodeData;
  const change = getChangeVisual(d.changeStatus);
  const isRelatedToSelection = d.relatedToSelection == null ? true : Boolean(d.relatedToSelection);
  const mode = typeof d.mode === 'string' ? d.mode : undefined;
  const perf = useUiStore((s) => s.graphStyle) === 'performance';
  const far = useStore((st) => st.transform[2] < LOD_ZOOM);
  const changeVisual = nodeChange(d.changeStatus);
  const glow = change?.glow || GRAPH_CHROME.glow;
  // A file under this cluster is in the plan's footprint (B6.4).
  const isPlanHighlighted = Boolean((d as Record<string, unknown>).planHighlighted);

  return (
    <div
      data-plan-highlighted={isPlanHighlighted || undefined}
      className={[
        'group relative w-[260px] overflow-hidden rounded-[24px] border border-white/12 px-4 py-3 hover:border-white/20',
        GRAPH_CHROME.clusterCard,
        isPlanHighlighted ? GRAPH_MARK.footprintCluster : '',
        perf ? GRAPH_CHROME.perfGround : 'backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5',
        !isRelatedToSelection ? 'opacity-50' : '',
        // The status tints the cluster; the view mode never does (audit 24).
        changeVisual?.card ?? '',
      ].join(' ')}
      style={perf
        ? (far ? farStatusStyle : statusOutline)({
            glow,
            changed: Boolean(change),
            planned: typeof d.changeStatus === 'string' && d.changeStatus.startsWith('planned_'),
            live: d.changeStatus === 'in_progress_task' || d.changeStatus === 'active',
            focused: Boolean(d.isFocused),
          })
        : { boxShadow: GRAPH_CHROME.clusterShadow(glow, isRelatedToSelection) }}
    >
      <Handle type="target" position={Position.Top} className={GRAPH_CHROME.handle} />
      <BreakpointBadge title={(data as Record<string, unknown>).breakpointTitle} />
      <GroundingMark grounding={(data as Record<string, unknown>).grounding} />
      <PlannedOverlapMark planned={(data as Record<string, unknown>).plannedOverlap} />
      <div className={`pointer-events-none absolute inset-0 rounded-[24px] ${GRAPH_CHROME.clusterSheen}`} />
      <div className="relative z-10">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-white/8">
            <Orbit size={18} className="text-zinc-100" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-zinc-50">{d.label}</div>
                {d.description && (
                  <div className="mt-1 truncate text-[11px] text-zinc-300/70">
                    {d.description}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-300/75">
                  <span className="rounded-full border border-white/10 bg-white/6 px-2 py-1">{d.childCount} files</span>
                  {typeof d.connectionCount === 'number' && (
                    <span className="rounded-full border border-white/8 bg-white/6 px-2 py-1 text-zinc-100/90">
                      {d.connectionCount} links
                    </span>
                  )}
                  {mode && (
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-semibold tracking-[0.14em] ${GRAPH_MARK.modeChip}`}>
                      {mode === 'current' ? 'baseline' : mode}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  d.onToggle?.();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/8 bg-white/6 text-zinc-200/80 transition-colors hover:bg-white/12"
              >
                {d.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
          </div>
        </div>

        {d.topFiles && d.topFiles.length > 0 && (
          <div className="mt-3 rounded-2xl border border-white/8 bg-black/14 px-3 py-2">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-zinc-400/80">
              <Files size={11} />
              Key Files
            </div>
            <div className="space-y-1">
              {d.topFiles.slice(0, 4).map((file) => (
                <div key={file} className="truncate text-[11px] text-zinc-100/88">
                  {file.split('/').pop()}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-200/82">
          {typeof d.localChangeCount === 'number' && d.localChangeCount > 0 && (
            <span className={`rounded-full border px-2 py-1 ${chipClass(GIT.modified.tone)}`} title="Uncommitted local changes">
              {d.localChangeCount} {GIT.modified.glyph} local
            </span>
          )}
          {typeof d.plannedChangeCount === 'number' && d.plannedChangeCount > 0 && (
            <span className={`rounded-full border px-2 py-1 ${chipClass(INTENT.planned.tone)}`}>
              {d.plannedChangeCount} {INTENT.planned.glyph} planned
            </span>
          )}
          {d.sourceLabel && (
            <span className="text-[10px] text-zinc-400/70">
              {d.sourceLabel}
            </span>
          )}
        </div>

        {change && (
          <div className={`mt-3 inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${change.tone}`} title={change.word}>
            {change.symbol}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className={GRAPH_CHROME.handle} />
    </div>
  );
}

export const PackageNode = memo(PackageNodeComponent);
PackageNode.displayName = 'PackageNode';
