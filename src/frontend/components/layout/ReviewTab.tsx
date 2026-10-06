import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GitMerge } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import type { ReviewQueue, ReviewQueueLine, ReviewQueueStatus } from '@shared/types';
import type { OtherWorkInFlight } from '@shared/lib/other-work';
import { singleFlight } from '../../lib/single-flight';
import { gitLetterText } from '../../lib/visual-language';

/**
 * The Review tab (Phase 32 A5.5, awareness spec §9.4): the review queue, in
 * the suggested merge order with the reason for each place, and each line's
 * review with the other work in flight around it.
 *
 * The order is a suggestion, and the tab says so. Opening a line reviews its
 * branch against the main checkout's branch, the same review an agent gets
 * from `review_plan`.
 */

const REFRESH_MS = 30_000;

const STATUS: Record<ReviewQueueStatus, { label: string; tone: string }> = {
  ready: { label: 'Ready', tone: 'text-green-400 bg-green-500/10' },
  held: { label: 'Held', tone: 'text-red-400 bg-red-500/10' },
  waiting: { label: 'Waiting for sign-off', tone: 'text-amber-400 bg-amber-500/10' },
  'in-progress': { label: 'In progress', tone: 'text-foreground-muted bg-surface-hover' },
  unavailable: { label: 'Not reviewed', tone: 'text-foreground-subtle bg-surface-hover' },
};

interface LineReview {
  otherWork: OtherWorkInFlight | null;
  unplannedEdges: Array<{ source: string; target: string }>;
  comparison: { diff: { addedFiles: string[]; modifiedFiles: string[]; removedFiles: string[] } };
  /** Phase 33 V1: what the change does to the architecture, one sentence each. */
  architecture?: { words: string[]; order?: Array<{ path: string; why: string }> };
}

export function ReviewTab() {
  const root = useProjectStore((s) => s.root);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!root) return;
    try {
      const res = await fetch(`/api/review-queue?project=${encodeURIComponent(root)}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setQueue((await res.json()) as ReviewQueue);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [root]);

  useEffect(() => {
    void load();
    const run = singleFlight(load);
    window.addEventListener('awareness-changed', run);
    window.addEventListener('workstreams-changed', run);
    const id = setInterval(run, REFRESH_MS);
    return () => {
      window.removeEventListener('awareness-changed', run);
      window.removeEventListener('workstreams-changed', run);
      clearInterval(id);
    };
  }, [load]);

  if (!root) return <div className="text-[11px] text-foreground-subtle py-6 text-center">Open a project to see what is in review.</div>;
  if (!queue && !error) return <div className="text-[11px] text-foreground-subtle py-6 text-center">Reading the review queue…</div>;

  return (
    <div className="text-[11px] space-y-2" data-testid="review-tab">
      {error && <div className="text-red-400 px-2">Could not read the review queue: {error}</div>}
      {queue && queue.lines.length === 0 && (
        <div className="text-foreground-subtle py-6 px-4 text-center leading-relaxed" data-testid="review-empty">
          Nothing is in review. A line of work shows here once a plan&rsquo;s items name its branch.
        </div>
      )}
      {queue && queue.lines.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-2 text-foreground-muted">
            <GitMerge size={12} />
            <span>
              A suggested merge order{queue.base ? <>, each line reviewed against <span className="font-mono">{queue.base}</span></> : null}. It is a suggestion; nothing is enforced.
            </span>
          </div>
          {queue.lines.map((line) => {
            const key = `${line.planUid}:${line.branch}`;
            return (
              <QueueLine
                key={key}
                line={line}
                base={queue.base}
                root={root}
                open={open === key}
                onToggle={() => setOpen(open === key ? null : key)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

function QueueLine({ line, base, root, open, onToggle }: { line: ReviewQueueLine; base: string | null; root: string; open: boolean; onToggle: () => void }) {
  const status = STATUS[line.status];
  const c = line.criteria;
  const facts = [
    // With no criteria the status already says so.
    c.total ? `${c.met}/${c.total} criteria met` : null,
    `${line.filesChanged} file${line.filesChanged === 1 ? '' : 's'} changed`,
    line.blastRadius ? `${line.blastRadius} file${line.blastRadius === 1 ? '' : 's'} affected` : null,
    line.unplannedEdges ? `${line.unplannedEdges} unplanned dependenc${line.unplannedEdges === 1 ? 'y' : 'ies'}` : null,
    line.openSignals ? `${line.openSignals} open overlap${line.openSignals === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return (
    <div className="rounded-md border border-border-subtle" data-testid="review-line">
      <button onClick={onToggle} className="w-full text-left px-2 py-1.5 flex items-start gap-2 hover:bg-surface-hover rounded-md">
        <span className="shrink-0 w-4 text-foreground-subtle font-mono pt-px">{line.position}</span>
        {open ? <ChevronDown size={12} className="shrink-0 mt-0.5" /> : <ChevronRight size={12} className="shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-semibold text-foreground">{line.branch}</span>
            <span className="text-foreground-subtle truncate">{line.planTitle}</span>
            <span className={`text-[9px] font-semibold px-1.5 rounded ${status.tone}`} data-testid="review-line-status">{status.label}</span>
          </div>
          <div className="text-foreground-muted" data-testid="review-line-reason">{line.reason}</div>
          <div className="text-foreground-subtle">{line.statusWords} · {facts.join(' · ')}</div>
        </div>
      </button>
      {open && <LineDetail line={line} base={base} root={root} />}
    </div>
  );
}

function LineDetail({ line, base, root }: { line: ReviewQueueLine; base: string | null; root: string }) {
  const [review, setReview] = useState<LineReview | null>(null);
  const [error, setError] = useState<string | null>(line.error ?? null);

  useEffect(() => {
    if (!base || line.error) return;
    let live = true;
    const q = `project=${encodeURIComponent(root)}&before=${encodeURIComponent(`commit:${base}`)}&after=${encodeURIComponent(`commit:${line.branch}`)}`;
    fetch(`/api/plans/${encodeURIComponent(line.planUid)}/review?${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Server returned ${r.status}`);
        return (await r.json()) as LineReview;
      })
      .then((r) => { if (live) setReview(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [base, root, line.planUid, line.branch, line.error]);

  if (error) return <div className="px-8 pb-2 text-red-400">Could not review {line.branch}: {error}</div>;
  if (!review) return <div className="px-8 pb-2 text-foreground-subtle">Reviewing {line.branch}…</div>;
  const d = review.comparison.diff;
  const files = [...d.addedFiles.map((f) => ['A', f]), ...d.modifiedFiles.map((f) => ['M', f]), ...d.removedFiles.map((f) => ['D', f])];
  const other = review.otherWork;
  return (
    <div className="px-8 pb-2 space-y-2" data-testid="review-line-detail">
      {base && <SinceLastLook root={root} base={base} head={line.branch} />}
      {/* V1 — what the change does to the architecture, before anything else. */}
      {review.architecture && (
        <section data-testid="review-architecture">
          <h4 className="text-[10px] uppercase tracking-wide text-foreground-subtle mb-0.5">What this change does to the architecture</h4>
          {review.architecture.words.length === 0
            ? <div className="text-foreground-subtle">No imports between folders, outside packages, cross-system calls or rules change.</div>
            : review.architecture.words.map((w) => (
              <div key={w} className={w.startsWith('✗') ? 'text-red-300' : 'text-foreground-muted'} data-testid="review-architecture-line">{w}</div>
            ))}
        </section>
      )}
      <section>
        <h4 className="text-[10px] uppercase tracking-wide text-foreground-subtle mb-0.5">Other work in flight</h4>
        {!other || other.entries.length === 0
          ? <div className="text-foreground-subtle">No other line of work overlaps with {line.branch}.</div>
          : other.entries.map((e) => (
            <div key={e.signalId} className="py-0.5" data-testid="review-other-work">
              <div><span className="font-semibold">{e.severity.toUpperCase()} · {e.heading}.</span> {e.sides.map((s) => s.words).join(' ')}</div>
              {e.merge && <div className="text-foreground-muted">{e.merge}</div>}
              <div className="text-foreground-subtle">{e.outcomeWords}</div>
              {e.notes.map((n) => <div key={n} className="text-foreground-subtle italic">&ldquo;{n}&rdquo;</div>)}
            </div>
          ))}
      </section>
      {review.unplannedEdges.length > 0 && (
        <section>
          <h4 className="text-[10px] uppercase tracking-wide text-foreground-subtle mb-0.5">Dependencies nobody planned</h4>
          {review.unplannedEdges.map((e) => (
            <div key={`${e.source}->${e.target}`} className="font-mono text-foreground-muted">{e.source} → {e.target}</div>
          ))}
        </section>
      )}
      {/* V2 — the changed files in order of what a mistake there would cost. */}
      {review.architecture?.order && review.architecture.order.length > 0 ? (
        <section data-testid="review-order">
          <h4 className="text-[10px] uppercase tracking-wide text-foreground-subtle mb-0.5">Review in this order · changed against {base}</h4>
          {review.architecture.order.slice(0, 25).map((r, n) => (
            <div key={r.path} className="flex gap-2" data-testid="review-order-file">
              <span className="w-4 shrink-0 text-right text-foreground-subtle">{n + 1}.</span>
              <span className="min-w-0">
                <span className="font-mono text-foreground-muted">{r.path}</span>
                <span className="block text-foreground-subtle">{r.why}</span>
              </span>
            </div>
          ))}
          {review.architecture.order.length > 25 && <div className="text-foreground-subtle">…and {review.architecture.order.length - 25} more</div>}
        </section>
      ) : (
      <section>
        <h4 className="text-[10px] uppercase tracking-wide text-foreground-subtle mb-0.5">Changed against {base}</h4>
        {files.length === 0
          ? <div className="text-foreground-subtle">Nothing changed yet.</div>
          : files.slice(0, 25).map(([mark, f]) => (
            <div key={f} className="font-mono text-foreground-muted"><span className={`${gitLetterText(mark)} mr-1.5`}>{mark}</span>{f}</div>
          ))}
        {files.length > 25 && <div className="text-foreground-subtle">…and {files.length - 25} more</div>}
      </section>
      )}
    </div>
  );
}

interface Since { words: string; changed: string[]; addressed: string[]; added: string[] }

/**
 * Phase 33 V3 — what moved since you last marked this line reviewed: the
 * files, the findings the pushes addressed, the new ones. Marking keeps the
 * look at the branch's head now.
 */
function SinceLastLook({ root, base, head }: { root: string; base: string; head: string }) {
  const [since, setSince] = useState<Since | null>(null);
  const [marked, setMarked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = `project=${encodeURIComponent(root)}`;

  const load = useCallback(async () => {
    const r = await fetch(`/api/review/architecture?${q}&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
    if (!r.ok) return;
    setSince(((await r.json()) as { since?: Since }).since ?? null);
  }, [q, base, head]);

  useEffect(() => { void load(); }, [load]);

  const mark = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/review/seen?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base, head }) });
      if (r.ok) {
        const m = (await r.json()) as { commit: string };
        setMarked(m.commit.slice(0, 7));
        await load();
      }
    } finally { setBusy(false); }
  };

  return (
    <section className="flex items-start gap-2" data-testid="review-since">
      <div className="min-w-0 flex-1">
        {since
          ? <>
              <div className="text-foreground" data-testid="review-since-words">{since.words}</div>
              {since.addressed.map((f) => <div key={`a:${f}`} className="text-foreground-subtle line-through" data-testid="review-since-addressed">{f}</div>)}
              {since.added.map((f) => <div key={`n:${f}`} className="text-foreground-muted" data-testid="review-since-added">New: {f}</div>)}
            </>
          : <div className="text-foreground-subtle">You have not marked {head} reviewed. Mark it, and the next look shows only what moved since.</div>}
        {marked && <div className="text-foreground-subtle" data-testid="review-since-marked">Marked reviewed at {marked}.</div>}
      </div>
      <button
        onClick={() => void mark()}
        disabled={busy}
        className="shrink-0 px-2 py-0.5 rounded border border-border-subtle hover:bg-surface-hover disabled:opacity-50"
        data-testid="review-mark-reviewed"
      >
        Mark reviewed
      </button>
    </section>
  );
}
