import { GRAPH_MARK, MARKS } from '../../../lib/visual-language';

/**
 * A planned overlap on a node while playing forward (Phase 32 B9.2,
 * observability spec §7): "zones that will form if the plans go ahead are
 * drawn dashed, as ◇ planned overlap". A dashed violet ring and a ◇ badge,
 * the words on hover; serious ones say so, and an overlap already sequenced
 * is drawn quieter. In words as well as colour.
 */
export function PlannedOverlapMark({ planned }: { planned?: unknown }) {
  if (!planned || typeof planned !== 'object') return null;
  const p = planned as { title?: unknown; serious?: unknown; sequenced?: unknown; count?: unknown };
  if (typeof p.title !== 'string') return null;
  const quiet = p.sequenced === true;
  const serious = p.serious === true;
  const ring = quiet ? GRAPH_MARK.plannedOverlapRing.quiet : serious ? GRAPH_MARK.plannedOverlapRing.serious : GRAPH_MARK.plannedOverlapRing.normal;
  return (
    <>
      <span aria-hidden className={`pointer-events-none absolute -inset-1 z-10 rounded-[26px] border-2 border-dashed ${ring}`} />
      <span
        data-testid="node-planned-overlap"
        data-serious={serious ? 'yes' : 'no'}
        data-sequenced={quiet ? 'yes' : 'no'}
        title={p.title}
        aria-label={p.title}
        role="img"
        className={`absolute -top-2.5 left-4 z-10 flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] leading-none ${
          quiet ? GRAPH_MARK.plannedOverlapBadge.quiet : GRAPH_MARK.plannedOverlapBadge.normal
        }`}
      >
        {MARKS.plannedOverlap.glyph} {typeof p.count === 'number' && p.count > 1 ? `${p.count} planned overlaps` : 'planned overlap'}
      </span>
    </>
  );
}
