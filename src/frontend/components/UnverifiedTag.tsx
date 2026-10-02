import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UNVERIFIED_EXPLAINER, authorKind } from '../lib/author-words';

/**
 * The mark on anything changed over the local API (owner's decision, Phase 32
 * carried item 2b): plain HTTP with this launch's token, from a browser tab, a
 * script or another tool, not the CodeTrellis window. The record is kept and
 * shown so it can be audited; the tag says the name on it was not verified,
 * and its tooltip says how the request arrived and where to refuse them.
 *
 * One component everywhere an author or actor is shown, so the wording and
 * the explanation are the same on a comment, a sign-off or an answer.
 *
 * The tooltip is portalled to the body: most of the places this sits are
 * scroll containers that would clip it. It opens on hover and on keyboard
 * focus.
 */
export function UnverifiedTag({ detail }: { detail?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = 280;
    const below = r.top < 140; // near the top of the window: open downwards
    setAt({
      left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)),
      top: below ? r.bottom + 6 : r.top - 6,
      below,
    });
  };
  const hide = () => setAt(null);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        role="note"
        aria-label={`Unverified. ${UNVERIFIED_EXPLAINER}`}
        data-testid="unverified-tag"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center gap-0.5 align-middle text-[9px] font-medium uppercase tracking-wide px-1 py-px rounded border border-amber-400/40 text-amber-300/90 bg-amber-400/[0.06] cursor-help whitespace-nowrap focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-300/60"
      >
        unverified
      </span>
      {at && createPortal(
        <div
          role="tooltip"
          data-testid="unverified-tooltip"
          style={{ position: 'fixed', left: at.left, top: at.top, width: 280, zIndex: 10000, transform: at.below ? undefined : 'translateY(-100%)' }}
          className="pointer-events-none rounded-md border border-white/[0.1] bg-surface-solid/95 backdrop-blur-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] px-3 py-2 text-[10.5px] leading-relaxed text-foreground-muted normal-case tracking-normal"
        >
          <div className="text-[11px] font-medium text-foreground mb-0.5">Made over the local API</div>
          {UNVERIFIED_EXPLAINER}
          {detail && <div className="mt-1 text-foreground-subtle">{detail}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * The tag when `type` is `unverified`, nothing otherwise: the one-line call
 * every author display uses (`{name}<UnverifiedIf type={authorType} />`).
 */
export function UnverifiedIf({ type, detail }: { type: string | null | undefined; detail?: string }) {
  return authorKind(type) === 'unverified' ? <>{' '}<UnverifiedTag detail={detail} /></> : null;
}
