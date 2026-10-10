import { useEffect, useRef, useState } from 'react';
import { Spline } from 'lucide-react';
import { useUiStore } from '../../stores/ui-store';
import { EDGE_KINDS } from '../../lib/graph-edge-kinds';
import { GRAPH_CHROME } from '../../lib/visual-language';

/**
 * Which kinds of edge the graph draws (Phase 33 G3): imports, cross-system
 * links and symbol links, each turned off on its own. Beside Overlays, and
 * remembered per machine like them.
 */
export function EdgesMenu() {
  const on = useUiStore((s) => s.graphEdges);
  const toggle = useUiStore((s) => s.toggleGraphEdge);
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
        data-testid="graph-edges"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-white/[0.03] backdrop-blur-md border border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] hover:border-white/[0.12] transition-all"
        title={`Edges drawn on the graph: ${on.length} of ${EDGE_KINDS.length} kinds on`}
        aria-expanded={open}
      >
        <Spline size={12} />
        Edges <span className="text-zinc-500">{on.length}/{EDGE_KINDS.length}</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="graph-edges-menu"
          className={`absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-white/[0.1] ${GRAPH_CHROME.menu} p-1.5 shadow-xl`}
        >
          {EDGE_KINDS.map((k) => (
            <label key={k.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-white/[0.04]">
              <input
                type="checkbox"
                data-testid={`edges-${k.id}`}
                checked={on.includes(k.id)}
                onChange={() => toggle(k.id)}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="text-[11px] text-zinc-200">{k.label}</span>
                <span className="text-[10px] text-zinc-500">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
