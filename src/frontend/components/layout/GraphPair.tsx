/**
 * Phase 32 E2b — the graph compares the same two points as the Changes tab.
 *
 * With "Show on the graph" on, the graph's marks (added, changed, removed,
 * and the imports that came or went) are its architecture diff between the
 * pair chosen there, read through `/api/compare`, rather than its own
 * baseline against now. The banner says which two, in words and as git's
 * command, and turns it off.
 */

import { useEffect, useState } from 'react';
import { GitCompareArrows, Loader2, X } from 'lucide-react';
import { effectiveBefore, useSourceControlStore } from '../../stores/source-control-store';

export interface PairDiff {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  blastRadius: string[];
  addedEdges: Array<{ source: string; target: string }>;
  removedEdges: Array<{ source: string; target: string }>;
  summary: { added: number; removed: number; modified: number; edgesAdded: number; edgesRemoved: number };
}

interface GraphPairState {
  loading: boolean;
  error: string | null;
  labels: { before: string; after: string } | null;
  diff: PairDiff | null;
  edgesComparable: boolean;
  notes: string[];
}

const IDLE: GraphPairState = { loading: false, error: null, labels: null, diff: null, edgesComparable: false, notes: [] };

/** The architecture diff between the chosen pair, while it is shown on the graph. */
export function useGraphPair(root: string | null): GraphPairState {
  const on = useSourceControlStore((s) => s.pairOnGraph);
  const pair = useSourceControlStore((s) => s.pair);
  const [state, setState] = useState<GraphPairState>(IDLE);
  const before = pair ? effectiveBefore(pair) : null;
  const after = pair?.after ?? null;

  useEffect(() => {
    if (!on || !root || !before || !after) { setState(IDLE); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const q = `project=${encodeURIComponent(root)}&before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`;
    fetch(`/api/compare?${q}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) { setState({ ...IDLE, error: body?.error || `Server returned ${res.status}` }); return; }
        setState({
          loading: false, error: null,
          labels: { before: body.before.label, after: body.after.label },
          diff: body.diff as PairDiff, edgesComparable: Boolean(body.edgesComparable), notes: body.notes ?? [],
        });
      })
      .catch((e) => { if (!cancelled) setState({ ...IDLE, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [on, root, before, after]);

  return state;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the graph is comparing, said once at the top of the canvas, with the way out. */
export function GraphPairBanner({ state }: { state: GraphPairState }) {
  const on = useSourceControlStore((s) => s.pairOnGraph);
  const command = useSourceControlStore((s) => s.pairResult?.command ?? null);
  const showPairOnGraph = useSourceControlStore((s) => s.showPairOnGraph);
  if (!on) return null;
  const d = state.diff?.summary;
  return (
    <div
      data-testid="graph-pair"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[70%] flex items-center gap-2 rounded-lg border border-sky-400/40 bg-background/90 px-3 py-1.5 text-[11px] text-sky-100 shadow"
    >
      <GitCompareArrows size={13} className="shrink-0 text-sky-300" />
      <div className="min-w-0">
        <div className="truncate" data-testid="graph-pair-words">
          {state.labels ? <>Comparing <b>{state.labels.before}</b> → <b>{state.labels.after}</b></> : 'Comparing two points'}
          {d && ` · ${plural(d.added, 'file')} added, ${d.modified} changed, ${d.removed} removed`}
          {d && state.edgesComparable && ` · ${plural(d.edgesAdded, 'import')} added, ${d.edgesRemoved} removed`}
        </div>
        {command && <code className="block truncate font-mono text-[9.5px] text-sky-200/60" data-testid="graph-pair-command">$ {command}</code>}
        {state.diff && !state.edgesComparable && state.notes[0] && (
          <div className="truncate text-[10px] text-amber-200/80" data-testid="graph-pair-note" title={state.notes.join(' ')}>{state.notes[state.notes.length - 1]}</div>
        )}
        {state.error && <div className="text-[10px] text-danger" data-testid="graph-pair-error">{state.error}</div>}
      </div>
      {state.loading && (
        <span className="shrink-0 flex items-center gap-1 text-[10px] text-sky-200/70" data-testid="graph-pair-loading"><Loader2 size={10} className="animate-spin" /> Reading…</span>
      )}
      <button
        type="button"
        onClick={() => showPairOnGraph(false)}
        className="shrink-0 p-0.5 rounded text-sky-200/70 hover:text-sky-100"
        title="Stop comparing: the graph goes back to its own changes"
        aria-label="Stop comparing on the graph"
        data-testid="graph-pair-stop"
      >
        <X size={12} />
      </button>
    </div>
  );
}
