/**
 * Play-forward chrome (Phase 32 B9.2, observability spec §6.3, WIREFRAMES §7).
 *
 * `PlayForwardStart` is the way in, beside "Replay" on the Timeline and at
 * the top of the Stack tab. `PlayForwardBar` shows above every tab while it
 * is on: which way the clock runs ("now → all plans done"), how much is
 * planned, and each planned overlap in words; clicking one shows its file on
 * the graph. The graph draws what every active plan says it will change,
 * dashed, nothing of which exists yet, with planned overlaps as dashed
 * zones. "Back to now" ends it.
 */
import { useEffect } from 'react';
import { Radio, FastForward } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useGraphStore } from '../../stores/graph-store';
import { usePlayForwardStore } from '../../stores/play-forward-store';

export function PlayForwardStart({ where }: { where: 'timeline' | 'stack' }) {
  const root = useProjectStore((s) => s.root);
  const active = usePlayForwardStore((s) => s.active);
  const enter = usePlayForwardStore((s) => s.enter);
  if (!root || active) return null;
  return (
    <button
      type="button"
      onClick={() => { void enter(root); }}
      className="mb-2 flex items-center gap-1.5 text-[10.5px] text-foreground-muted hover:text-foreground px-2 py-1 rounded-md border border-white/[0.06] hover:bg-surface-hover transition-colors"
      title="Show what every active plan says it will change, from now until they are done, and where two will meet if they go ahead"
      data-testid={`play-forward-start-${where}`}
    >
      <FastForward size={11} />
      Play the plans forward
    </button>
  );
}

/** Any plan or task changing (the Stack tab's own signal). */
const REFRESH_EVENTS = ['stack-changed'];

export function PlayForwardBar() {
  const { active, root: forwardRoot, data, loading, error, refresh, exit } = usePlayForwardStore();
  const root = useProjectStore((s) => s.root);
  // Another project opened: its plans are not these.
  useEffect(() => { if (active && root !== forwardRoot) exit(); }, [active, root, forwardRoot, exit]);
  // A plan changing while it is on changes what is planned.
  useEffect(() => {
    if (!active) return;
    const run = () => { void refresh(); };
    for (const e of REFRESH_EVENTS) window.addEventListener(e, run);
    return () => { for (const e of REFRESH_EVENTS) window.removeEventListener(e, run); };
  }, [active, refresh]);
  if (!active) return null;

  const overlaps = data?.overlaps ?? [];
  return (
    <div className="mx-2 mt-2 rounded-md border border-violet-400/30 bg-violet-500/[0.05] px-2.5 py-2 space-y-1.5" data-testid="play-forward-bar" role="region" aria-label="Playing forward">
      <div className="flex items-center gap-2 text-[11px]">
        <FastForward size={12} className="text-violet-300 shrink-0" />
        <span className="font-medium text-violet-200" data-testid="play-forward-range">◇ Playing forward · now → all plans done</span>
        {loading && <span className="text-foreground-subtle">reading…</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={exit}
          className="flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 transition-colors"
          data-testid="play-forward-now"
        >
          <Radio size={10} />
          Back to now
        </button>
      </div>
      {error && <div className="text-[10.5px] text-danger">The plans could not be read: {error}</div>}
      {data && (
        <div className="text-[10.5px] text-foreground-muted" data-testid="play-forward-words">
          {data.words}{data.plans.length > 0 ? ' · nothing here exists yet' : ''}
        </div>
      )}
      {overlaps.length > 0 && (
        <ul className="space-y-0.5" data-testid="play-forward-overlaps">
          {overlaps.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                data-testid="play-forward-overlap"
                data-kind={o.kind}
                data-serious={o.serious ? 'yes' : 'no'}
                data-sequenced={o.sequenced ? 'yes' : 'no'}
                disabled={!o.file}
                onClick={() => { if (o.file) useGraphStore.getState().focusNode(o.file, false); }}
                className={`text-left text-[10.5px] leading-snug rounded px-1 -mx-1 ${o.file ? 'hover:bg-violet-500/10 cursor-pointer' : 'cursor-default'} ${
                  o.sequenced ? 'text-violet-300/60' : o.serious ? 'text-violet-100 font-medium' : 'text-violet-200'
                }`}
                title={o.file ? 'Show it on the graph' : 'A material is not on the code graph: it is said here and in the Stack tab'}
              >
                {o.words}{o.serious ? ' · serious' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
