import { ATTENTION, GRAPH_MARK } from '../../../lib/visual-language';

/**
 * The workstream and collision overlays on a file node (Phase 32 B3.3). Drawn
 * inside the node, which clips what overflows it:
 * each other workstream's lines in the file ("2 workstreams: ＋12 −3, ＋4",
 * who changed how much in words on hover), and a dashed ring with ⚠ when the
 * file is in an open overlap between workstreams. In words as well as colour.
 */
export function WorkOverlayMarks({ workCount, collisionTitle }: { workCount?: unknown; collisionTitle?: unknown }) {
  const count = workCount && typeof workCount === 'object' ? (workCount as { short?: unknown; title?: unknown }) : null;
  const collision = typeof collisionTitle === 'string' && collisionTitle ? collisionTitle : null;
  return (
    <>
      {collision && (
        <>
          <span aria-hidden className={`pointer-events-none absolute inset-0 z-10 rounded-[22px] border-2 border-dashed ${GRAPH_MARK.collisionRing}`} />
          <span
            data-testid="node-collision"
            title={collision}
            aria-label={collision}
            role="img"
            className={`absolute bottom-2 right-10 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[11px] leading-none ${GRAPH_MARK.collisionBadge}`}
          >
            {ATTENTION.collision.glyph}&#xFE0E;
          </span>
        </>
      )}
      {count && typeof count.short === 'string' && (
        <span
          data-testid="node-work-count"
          title={typeof count.title === 'string' ? count.title : undefined}
          className={`absolute bottom-2 left-3 z-10 max-w-[60%] truncate rounded-full border px-1.5 font-mono text-[10px] leading-4 ${GRAPH_MARK.workCount}`}
        >
          {count.short}
        </span>
      )}
    </>
  );
}
