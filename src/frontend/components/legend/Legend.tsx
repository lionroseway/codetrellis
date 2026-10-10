import { useState } from 'react';
import type { LegendEntry } from '../../lib/legend';

/**
 * Phase 33 G2 — the one legend: on the graph, the plan canvas, the file tree
 * and the Timeline, built from the visual vocabulary (G1). It lists only
 * what is on screen; each entry is a glyph, a word and a swatch (a line,
 * with its dash, for an edge), never colour alone. Hovering one tells the
 * surface which key to light. Collapsed or open is remembered per surface,
 * on this machine.
 */
export function Legend({ surface, entries, onHover, className = '' }: {
  surface: string;
  entries: readonly LegendEntry[];
  onHover?: (key: string | null) => void;
  className?: string;
}) {
  const storeKey = `codetrellis.legend.${surface}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(storeKey) !== 'closed'; } catch { return true; }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storeKey, next ? 'open' : 'closed'); } catch { /* private window — this session only */ }
  };
  if (entries.length === 0) return null;
  return (
    <div
      data-testid={`legend-${surface}`}
      role="group"
      aria-label="Legend"
      className={`rounded-lg border border-white/[0.08] bg-background/85 backdrop-blur-sm text-[10.5px] text-foreground-muted shadow ${className}`}
    >
      <button
        type="button"
        data-testid="legend-toggle"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wide text-foreground-subtle hover:text-foreground"
      >
        Legend <span aria-hidden>{open ? '▾' : '▸'}</span>
        {!open && <span className="normal-case tracking-normal">{entries.length}</span>}
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5 px-2 pb-1.5">
          {entries.map((e) => (
            <li
              key={e.key}
              data-testid="legend-entry"
              data-key={e.key}
              onMouseEnter={() => onHover?.(e.key)}
              onMouseLeave={() => onHover?.(null)}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-white/[0.05] cursor-default"
            >
              {e.line ? (
                <svg width="18" height="6" aria-hidden className="shrink-0">
                  <line x1="0" y1="3" x2="18" y2="3" stroke={e.hex} strokeWidth="2" strokeDasharray={e.line.dash} />
                </svg>
              ) : (
                <span aria-hidden className="shrink-0 inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: e.hex }} />
              )}
              <span aria-hidden className="w-3 text-center shrink-0" style={{ color: e.hex }}>{e.glyph}</span>
              <span>{e.word}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
