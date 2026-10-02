/**
 * Phase 32 E3 — the evolution view: one file at two points, side by side,
 * each side scrubbing back through the commits that changed it there.
 *
 * Each side is any point E2 offers (a branch, a tag, a remote branch,
 * another worktree, this checkout); its scrubber walks the file's own
 * history on that side, newest on the right, following renames. Locked,
 * moving one side moves the other to where it stood at the same time. Each
 * position has a card: the commit, its git author, and what CodeTrellis
 * knows of who made it and how; between the two, the decisions this
 * computer recorded. The diff is between the two positions.
 *
 * It is how a person outside the work sees the process that led to the
 * current state: which commit brought a change, by whom, and what was
 * decided around it.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Link2, Link2Off, Loader2 } from 'lucide-react';
import { useSourceControlStore } from '../../stores/source-control-store';
import { RefPicker } from './RefPicker';
import { GitCommand } from './SourceControlPanel';
import { positionAt, timeOf } from '../../lib/evolution';

const CodeDiffView = lazy(() => import('../inspector/CodeDiffView').then((m) => ({ default: m.CodeDiffView })));

export interface FilePosition {
  spec: string;
  kind: 'working' | 'commit';
  path: string;
  sha: string | null;
  short: string | null;
  at: number | null;
  author: string | null;
  subject: string | null;
  status: string | null;
  from?: string;
  attribution: { agent: string; how: string; words: string; sessionId?: string | null } | null;
}

interface History { at: string; label: string; path: string; positions: FilePosition[]; truncated: boolean; command: string }
interface Decision { seq: number; at: number; type: string; words: string }

type Side = 'left' | 'right';

const when = (ms: number | null) => {
  if (ms === null) return 'now';
  const d = new Date(ms);
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

function useHistory(root: string, spec: string, relativePath: string) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; history: History | null }>({ loading: true, error: null, history: null });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/git/file-history?project=${encodeURIComponent(root)}&at=${encodeURIComponent(spec)}&path=${encodeURIComponent(relativePath)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setState({ loading: false, error: body?.error || `Server returned ${res.status}`, history: null });
        else setState({ loading: false, error: null, history: body as History });
      })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: e instanceof Error ? e.message : String(e), history: null }); });
    return () => { cancelled = true; };
  }, [root, spec, relativePath]);
  return state;
}

/** One side's card: the position, who made it, and how CodeTrellis knows. */
function PositionCard({ side, history, index, onIndex, loading, error }: {
  side: Side;
  history: History | null;
  index: number;
  onIndex: (i: number) => void;
  loading: boolean;
  error: string | null;
}) {
  const positions = history?.positions ?? [];
  const p = positions[index];
  const n = positions.length;
  return (
    <div className="min-w-0 flex-1 space-y-1.5" data-testid="evo-side" data-side={side}>
      {loading && <p className="flex items-center gap-1 text-[10px] text-foreground-subtle" data-testid="evo-loading"><Loader2 size={10} className="animate-spin" /> Reading its history…</p>}
      {error && <p className="text-[10.5px] text-danger" data-testid="evo-error">{error}</p>}
      {history && n === 0 && <p className="text-[10.5px] text-foreground-subtle" data-testid="evo-empty">This file has no history on {history.label}.</p>}
      {n > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <button type="button" className="p-0.5 rounded text-foreground-subtle hover:text-foreground disabled:opacity-30" disabled={index >= n - 1} onClick={() => onIndex(index + 1)} title="Older" aria-label="Older" data-testid="evo-older"><ChevronLeft size={12} /></button>
            <input
              type="range"
              min={0}
              max={n - 1}
              // Oldest on the left, newest on the right.
              value={n - 1 - index}
              onChange={(e) => onIndex(n - 1 - Number(e.target.value))}
              className="flex-1 accent-sky-400"
              aria-label={`Scrub ${side === 'left' ? 'the left' : 'the right'} side through its history`}
              data-testid="evo-scrub"
            />
            <button type="button" className="p-0.5 rounded text-foreground-subtle hover:text-foreground disabled:opacity-30" disabled={index <= 0} onClick={() => onIndex(index - 1)} title="Newer" aria-label="Newer" data-testid="evo-newer"><ChevronRight size={12} /></button>
            <span className="shrink-0 text-[9.5px] tabular-nums text-foreground-subtle" data-testid="evo-position">{n - index} of {n}{history?.truncated ? '+' : ''}</span>
          </div>
          <div className="rounded-md border border-border-subtle bg-white/[0.02] px-2 py-1.5" data-testid="evo-card">
            {p.kind === 'working' ? (
              <p className="text-[11px] text-foreground" data-testid="evo-card-subject">The working copy, as it is now</p>
            ) : (
              <>
                <p className="truncate text-[11px] text-foreground" title={p.subject ?? ''} data-testid="evo-card-subject">{p.subject}</p>
                <p className="text-[10px] text-foreground-muted" data-testid="evo-card-author">
                  {p.author} · {when(p.at)} · <span className="font-mono">{p.short}</span>
                  {p.status === 'renamed' && p.from ? ` · renamed from ${p.from}` : p.status && p.status !== 'modified' ? ` · ${p.status}` : ''}
                </p>
                {p.attribution && (
                  <p className="text-[10px] text-accent/90" data-testid="evo-card-attribution" title={`How CodeTrellis knows: ${p.attribution.how}`}>{p.attribution.words}</p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function EvolutionView({ root, relativePath }: { root: string; relativePath: string }) {
  const pair = useSourceControlStore((s) => s.pair);
  const loadRefs = useSourceControlStore((s) => s.loadRefs);
  // Starts from the two points chosen in the Changes tab, when there are; this checkout otherwise.
  const [specs, setSpecs] = useState<Record<Side, string>>(() => ({ left: pair?.before ?? 'live', right: pair?.after ?? 'live' }));
  const [index, setIndex] = useState<Record<Side, number | null>>({ left: null, right: null });
  const [locked, setLocked] = useState(false);
  const left = useHistory(root, specs.left, relativePath);
  const right = useHistory(root, specs.right, relativePath);

  useEffect(() => { void loadRefs(root); }, [root, loadRefs]);
  // A new side starts at its newest; the same side on both starts one step apart, so there is something to see.
  useEffect(() => { setIndex({ left: null, right: null }); }, [specs.left, specs.right, relativePath]);
  const sameSide = specs.left === specs.right;
  const li = index.left ?? (sameSide ? Math.min(1, Math.max((left.history?.positions.length ?? 1) - 1, 0)) : 0);
  const ri = index.right ?? 0;
  const lp = left.history?.positions[li];
  const rp = right.history?.positions[ri];

  const move = useCallback((side: Side, i: number) => {
    const now = Date.now();
    setIndex((cur) => {
      const next = { ...cur, [side]: i };
      if (locked) {
        const mine = (side === 'left' ? left : right).history?.positions ?? [];
        const other = (side === 'left' ? right : left).history?.positions ?? [];
        next[side === 'left' ? 'right' : 'left'] = positionAt(other, timeOf(mine[i], now), now);
      }
      return next;
    });
  }, [locked, left, right]);

  // What was decided between the two positions.
  const [decisions, setDecisions] = useState<{ list: Decision[]; words: string } | null>(null);
  const span = useMemo(() => {
    if (!lp || !rp) return null;
    const now = Date.now();
    const a = timeOf(lp, now);
    const b = timeOf(rp, now);
    return a === b ? null : { from: Math.min(a, b), to: Math.max(a, b) };
  }, [lp, rp]);
  useEffect(() => {
    if (!span) { setDecisions(null); return; }
    let cancelled = false;
    fetch(`/api/record/decisions?from=${span.from}&to=${span.to}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { decisions: Decision[]; words: string } | null) => { if (!cancelled && body) setDecisions({ list: body.decisions, words: body.words }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [span]);

  const label = (h: History | null, p: FilePosition | undefined) =>
    !h || !p ? '' : p.kind === 'working' ? `${h.label}, now` : `${h.label} · ${p.short}`;

  return (
    <div className="space-y-2" data-testid="evolution">
      <p className="text-[10.5px] text-foreground-muted" data-testid="evo-words">
        How {relativePath} came to be: each side is a point you choose, scrubbed back through the commits that changed the file there.
      </p>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <RefPicker side="before" value={specs.left} onChange={(spec) => setSpecs((s) => ({ ...s, left: spec }))} />
          {left.history && <GitCommand command={left.history.command} className="" testId="evo-command" />}
          <PositionCard side="left" history={left.history} index={li} onIndex={(i) => move('left', i)} loading={left.loading} error={left.error} />
        </div>
        <button
          type="button"
          onClick={() => setLocked((v) => !v)}
          className={`mt-1 shrink-0 p-1 rounded border ${locked ? 'border-sky-400/50 text-sky-200 bg-sky-400/10' : 'border-border text-foreground-subtle hover:text-foreground'}`}
          title={locked ? 'Locked: moving one side moves the other to the same time' : 'Lock the two sides together in time'}
          aria-pressed={locked}
          data-testid="evo-lock"
        >
          {locked ? <Link2 size={12} /> : <Link2Off size={12} />}
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <RefPicker side="after" value={specs.right} onChange={(spec) => setSpecs((s) => ({ ...s, right: spec }))} />
          {right.history && <GitCommand command={right.history.command} className="" testId="evo-command" />}
          <PositionCard side="right" history={right.history} index={ri} onIndex={(i) => move('right', i)} loading={right.loading} error={right.error} />
        </div>
      </div>

      {decisions && (
        <div className="rounded-md border border-border-subtle px-2 py-1.5" data-testid="evo-decisions">
          <p className="text-[10.5px] text-foreground-muted" data-testid="evo-decisions-words">Between the two: {decisions.words[0].toLowerCase()}{decisions.words.slice(1)}</p>
          {decisions.list.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {decisions.list.slice(0, 8).map((d) => (
                <li key={d.seq} className="text-[10.5px] text-foreground" data-testid="evo-decision">
                  <span className="text-foreground-subtle tabular-nums">{new Date(d.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> · {d.words}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {lp && rp && (
        <Suspense fallback={<div className="text-[10.5px] text-foreground-subtle">Loading the diff editor…</div>}>
          <CodeDiffView
            projectPath={root}
            relativePath={relativePath}
            before={lp.spec}
            after={rp.spec}
            beforePath={lp.path}
            afterPath={rp.path}
            labels={{ before: label(left.history, lp), after: label(right.history, rp) }}
          />
        </Suspense>
      )}
    </div>
  );
}
