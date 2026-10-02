/**
 * A card an agent pointed at (`navigate_to` with `signal_id` or
 * `breakpoint_ref`): scrolled into view once, and marked while it is the
 * thing pointed at. The card renders `data-highlighted` so `ui_ready` and a
 * screenshot's check can see it, and a ring so a person can.
 */
import { useEffect, useRef } from 'react';
import { useUiStore, type UiHighlight } from '../stores/ui-store';

export function useHighlight(kind: UiHighlight['kind'], id: string) {
  const ref = useRef<HTMLDivElement>(null);
  const highlight = useUiStore((s) => s.highlight);
  const on = highlight?.kind === kind && highlight.id === id;
  const at = on ? highlight!.at : 0;
  useEffect(() => {
    if (at && ref.current) ref.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [at]);
  return { ref, highlighted: on, ring: on ? ' ring-2 ring-accent ring-offset-1 ring-offset-surface' : '' };
}
