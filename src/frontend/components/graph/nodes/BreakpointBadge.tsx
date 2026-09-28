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
      className="absolute bottom-2 right-3 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-warning/80 bg-[#2a1f08] px-1 text-[12px] shadow-[0_0_10px_rgba(245,158,11,0.35)] leading-none text-warning"
    >
      ⏸&#xFE0E;
    </span>
  );
}
