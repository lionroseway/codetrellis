import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { OVERLAYS } from '../../lib/graph-overlays';

/**
 * What is drawn over the graph (Phase 32 B3.3): plan intent, other
 * workstreams' line counts, collision zones and breakpoints, each turned on
 * and off here. Remembered per machine.
 */
export function OverlaysMenu() {
  const on = useUiStore((s) => s.graphOverlays);
  const toggle = useUiStore((s) => s.toggleGraphOverlay);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="graph-overlays"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-white/[0.03] backdrop-blur-md border border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] hover:border-white/[0.12] transition-all"
        title={`Overlays on the graph: ${on.length} of ${OVERLAYS.length} on`}
        aria-expanded={open}
      >
        <Layers size={12} />
        Overlays <span className="text-zinc-500">{on.length}/{OVERLAYS.length}</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="graph-overlays-menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-white/[0.1] bg-[#0d1117] p-1.5 shadow-xl"
        >
          {OVERLAYS.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-white/[0.04]">
              <input
                type="checkbox"
                data-testid={`overlay-${o.id}`}
                checked={on.includes(o.id)}
                onChange={() => toggle(o.id)}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="text-[11px] text-zinc-200">{o.label}</span>
                <span className="text-[10px] text-zinc-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
