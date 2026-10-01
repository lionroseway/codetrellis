/**
 * Phase 32 C2.4 — the plan's status, in one view, read and never written.
 *
 * The header chip says how far the plan has got ("3 of 5 tasks done"),
 * counting a task done when the plan records it done or git (or the review
 * host) shows its branch merged. Opened, it is the plan's status view: what
 * waits on someone, what is under way, and the lineage from ticket to plan
 * to pull request. Every line says where it came from: git, the review host,
 * or the plan itself. There is no status file behind it; this is the file.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { stateFromWords } from '@shared/lib/item-status';
import { shortDate } from '@shared/lib/git-state-words';
import type { StatusLine } from '@shared/lib/item-status';
import { SOURCE_TONE, type PlanStatus } from '../../../lib/plan-status';

function SourceTag({ source }: { source: StatusLine['source'] }) {
  return (
    <span data-testid="plan-status-source" data-source={source} className={`shrink-0 rounded border px-1 text-[10px] ${SOURCE_TONE[source] ?? ''}`}>
      {stateFromWords(source)}
    </span>
  );
}

function Lines({ title, glyph, lines, testid, empty }: { title: string; glyph: string; lines: StatusLine[]; testid: string; empty: string }) {
  return (
    <section data-testid={testid} className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-subtle">{title}</div>
      {lines.length === 0 && <div className="text-[11.5px] italic text-foreground-subtle">{empty}</div>}
      {lines.map((l) => (
        <div key={l.itemUid} data-testid="plan-status-line" className="flex items-start gap-1.5 text-[12px]">
          <span aria-hidden className="shrink-0">{glyph}</span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground">{l.title}</span>
            <span className="text-foreground-muted"> — {l.words}</span>
          </span>
          <SourceTag source={l.source} />
        </div>
      ))}
    </section>
  );
}

export function PlanStatusChip({ status, fallback }: { status: PlanStatus | null; fallback: { done: number; total: number } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    // Escape closes the view and nothing else: caught before the workspace's
    // own Escape, which would otherwise minimise the plan as well.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const done = status?.progress.done ?? fallback.done;
  const total = status?.progress.total ?? fallback.total;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const words = status?.progress.words ?? `${done} of ${total} task${total === 1 ? '' : 's'} done`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="plan-status-chip"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="The plan's status: each state read from git, the review host or the plan itself. Click for the whole view."
        className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-2 py-1 text-[12px] text-foreground-subtle hover:bg-white/[0.04]"
      >
        <span data-testid="plan-status-progress">{words}</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.05]">
          <span className="block h-full rounded-full bg-accent/60 transition-all" style={{ width: `${pct}%` }} />
        </span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Plan status"
          data-testid="plan-status-view"
          className="absolute left-0 top-full z-50 mt-1 w-[min(420px,80vw)] space-y-3 rounded-lg border border-white/[0.10] bg-[#0c0e1a]/98 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        >
          <div>
            <div className="text-[13px] font-medium text-foreground">{status?.title ?? 'This plan'}</div>
            <div className="text-[11.5px] text-foreground-muted">
              {words}
              {status?.updatedAt ? ` · updated ${shortDate(Math.floor(status.updatedAt / 1000))} ${new Date(status.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
          </div>
          {!status && <div className="text-[11.5px] italic text-foreground-subtle">Reading the plan's state…</div>}
          {status && (
            <>
              <Lines title="Waiting on someone" glyph="⏸" lines={status.waiting} testid="plan-status-waiting" empty="Nothing is waiting on anyone." />
              <Lines title="In progress" glyph="▶" lines={status.inProgress} testid="plan-status-in-progress" empty="Nothing is under way." />
              <section data-testid="plan-status-lineage" className="space-y-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-subtle">Lineage</div>
                {status.lineage.map((l) => <div key={l} className="font-mono text-[11px] text-foreground-muted">{l}</div>)}
              </section>
              <p className="text-[10.5px] text-foreground-subtle">
                Read, never written: each state comes from git, a review host you turned on, or the plan itself, and says which. No status file is kept.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
