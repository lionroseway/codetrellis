import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanSearch, Check } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import {
  explainGap, internalPercent, describeHttpGap, sortByAttention,
  type GapKind,
} from '../../lib/coverage';

/**
 * What the scan could not resolve — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * The backend has always known how much of a codebase it could not
 * read — `/api/stats` carried `importCount` and `resolvedImports` long
 * before this component — and nothing displayed it. So a Swift app whose
 * files import each other implicitly, and a Swift app that genuinely is
 * loosely coupled, drew the same sparse graph. This is the difference
 * between those two.
 *
 * ## Why it says "linked" and not "resolved"
 *
 * The first cut of this reported `resolved / total` and led with the
 * percentage. On the test fixture that reads **45%**, which looks like
 * something is badly broken. Nothing is: C# imports `System`, Go imports
 * `net/http`, Python imports its standard library. Those were never
 * going to resolve to a file inside the scan — they are external by
 * definition, not failures, and calling them unresolved is precisely the
 * over-claim this phase exists to remove.
 *
 * So it reports how many imports link to a file **inside this project**,
 * and the rest are described as pointing outside it. Same number,
 * truthful framing.
 *
 * ## Why it is this quiet
 *
 * Nearly everything it reports is **correct behaviour**. Rails
 * autoloading writing no requires is Rails working. A warning colour
 * here would teach the reader to ignore the surface. So:
 *
 *   - the chip states a ratio and nothing else;
 *   - it is `text-foreground-subtle` like everything else in the status
 *     bar, and never takes a semantic colour on its own;
 *   - the only thing that earns a colour is an **unexplained** gap,
 *     because that is the only case that might be a defect;
 *   - the percentage is shown but never framed as a score — it is
 *     roughly "how self-contained is this codebase", which is a fact
 *     about the project rather than a mark out of ten.
 */

interface CoverageReport {
  imports: { total: number; resolved: number; byLanguage: Array<{ language: string; imports: number; resolved: number }> };
  http: { routes: number; calls: number; edges: number; unservedRoutes: number; unmatchedCalls: number };
}

const KIND_TINT: Record<GapKind, string> = {
  // Only the unexplained case is coloured — see the header.
  unexplained: 'text-warning',
  inherent: 'text-foreground-subtle',
  'known-limit': 'text-foreground-subtle',
};

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', csharp: 'C#',
  kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', python: 'Python',
  rust: 'Rust', java: 'Java', php: 'PHP', go: 'Go', sql: 'SQL',
};

const labelFor = (lang: string): string =>
  LANGUAGE_LABELS[lang.toLowerCase()] ?? lang;

export function CoverageChip() {
  const scanStatus = useProjectStore((s) => s.scanStatus);
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coverage');
      if (!res.ok) return;
      setReport((await res.json()) as CoverageReport);
    } catch {
      // A failed fetch leaves the chip absent rather than showing an
      // error. Coverage is context, not a control — it must never be
      // the loudest thing on screen, least of all when it is broken.
    }
  }, []);

  // Re-read after every scan; the numbers only change when the graph does.
  useEffect(() => {
    if (scanStatus === 'ready') void load();
  }, [scanStatus, load]);

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      void load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const popover = document.querySelector('[data-coverage-popover]');
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        (!popover || !popover.contains(target))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Nothing scanned yet is not a zero — it is an absence. Rendering
  // "0 of 0" would be noise in a bar that is already busy.
  if (!report || report.imports.total === 0) return null;

  const { imports, http } = report;
  const percent = internalPercent(imports.total, imports.resolved);
  const external = imports.total - imports.resolved;
  const rows = sortByAttention(imports.byLanguage);
  const hasUnexplained = rows.some((r) => explainGap(r.language, r.imports, r.resolved)?.kind === 'unexplained');
  const httpGap = describeHttpGap(http.unservedRoutes, http.unmatchedCalls);

  return (
    <div ref={wrapperRef} className="relative flex items-center">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 hover:text-foreground transition-all"
        title="How much of this project's coupling is visible in the graph"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <ScanSearch size={9} className={hasUnexplained ? 'text-warning' : undefined} />
        {imports.resolved}/{imports.total} linked
      </button>

      {open && createPortal(
        <div
          data-coverage-popover
          role="dialog"
          aria-label="Scan coverage"
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-80 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1 text-[10.5px]"
        >
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-foreground font-medium">Import coverage</span>
              <span className="text-foreground-subtle tabular-nums">{percent}% internal</span>
            </div>
            <p className="mt-1 text-foreground-subtle leading-snug">
              {external === 0
                ? 'Every import here links to a file in this project.'
                : `${imports.resolved} of ${imports.total} imports link to a file in this project. The other ${external} point outside it — a standard library, an installed package, or something the language does not write down.`}
            </p>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {rows.map((row) => {
              const gap = explainGap(row.language, row.imports, row.resolved);
              const missing = row.imports - row.resolved;
              return (
                <div key={row.language} className="px-3 py-1.5 border-b border-white/[0.04] last:border-b-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={gap ? KIND_TINT[gap.kind] : 'text-foreground-subtle'}>
                      {labelFor(row.language)}
                    </span>
                    <span className="tabular-nums text-foreground-subtle shrink-0">
                      {gap ? (
                        <>{missing} of {row.imports} point outside</>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success">
                          <Check size={9} /> all {row.imports} internal
                        </span>
                      )}
                    </span>
                  </div>
                  {gap && (
                    <p className="mt-0.5 text-foreground-subtle/70 leading-snug">{gap.text}</p>
                  )}
                </div>
              );
            })}
          </div>

          {(http.routes > 0 || http.calls > 0) && (
            <div className="px-3 py-2 border-t border-white/[0.06]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-foreground">Cross-system</span>
                <span className="tabular-nums text-foreground-subtle shrink-0">
                  {http.edges} linked
                </span>
              </div>
              <p className="mt-0.5 text-foreground-subtle/70 leading-snug">
                {httpGap
                  ? `${httpGap}. That is not necessarily wrong — a caller or a service can live outside this project.`
                  : `Every endpoint found here has a caller here, and every call has a service.`}
              </p>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
