import { ATTENTION, GRAPH_MARK } from '../../../lib/visual-language';

/**
 * ⏸ on a graph node that has a breakpoint (Phase 32 B4.3b): a glyph and,
 * on hover, which breakpoints hold it in words, never colour alone.
 */
export function BreakpointBadge({ title }: { title?: unknown }) {
  if (typeof title !== 'string' || !title) return null;
  return (
    <span
      data-testid="node-breakpoint"
      title={title}
      aria-label={title}
      role="img"
      className={`absolute bottom-2 right-3 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[12px] leading-none ${GRAPH_MARK.breakpoint}`}
    >
      {ATTENTION.paused.glyph}&#xFE0E;
    </span>
  );
}
