import { useCallback, useEffect, useState } from 'react';
import { FastForward } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { usePlayForwardStore } from '../../stores/play-forward-store';
import { useReplayStore } from '../../stores/replay-store';
import { hhmm } from '../../lib/replay';
import { singleFlight } from '../../lib/single-flight';

/**
 * Phase 32 B9.3b — a plan approved into planned overlaps, said once in the
 * inbox (JOURNEYS G3: "should this run when a plan is approved?"). Each
 * notice names the plan and every open overlap it is in, with the way to act
 * on them (play the plans forward) and "Seen", after which it leaves.
 */
interface Notice { id: number; planUid: string; planLabel: string; title: string; overlaps: string[]; at: number }

export function PlannedOverlapNotices() {
  const root = useProjectStore((s) => s.root);
  const replaying = useReplayStore((s) => s.active);
  const [notices, setNotices] = useState<Notice[]>([]);

  const load = useCallback(async () => {
    if (!root) { setNotices([]); return; }
    try {
      const res = await fetch(`/api/play-forward/notices?project=${encodeURIComponent(root)}`);
      if (res.ok) setNotices(((await res.json()) as { notices: Notice[] }).notices);
    } catch { /* keeps what is shown */ }
  }, [root]);

  useEffect(() => {
    void load();
    const run = singleFlight(load);
    window.addEventListener('stack-changed', run);
    return () => window.removeEventListener('stack-changed', run);
  }, [load]);

  // A past moment's inbox is replay's; these are today's.
  if (!root || replaying || notices.length === 0) return null;

  const seen = async (id: number) => {
    await fetch(`/api/play-forward/notices/${id}/seen?project=${encodeURIComponent(root)}`, { method: 'POST' }).catch(() => null);
    void load();
  };

  return (
    <div className="space-y-2" data-testid="planned-overlap-notices">
      {notices.map((n) => (
        <div key={n.id} data-testid="planned-overlap-notice" className="rounded-lg border border-violet-400/30 bg-violet-500/[0.05] px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <FastForward size={12} className="text-violet-300 shrink-0 self-center" />
            <span className="font-medium text-violet-100" data-testid="planned-overlap-notice-title">◇ {n.title}</span>
            <span className="text-foreground-subtle">{hhmm(n.at)}</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-[10.5px] text-violet-200">
            {n.overlaps.map((w) => <li key={w} data-testid="planned-overlap-notice-overlap">{w}</li>)}
          </ul>
          <div className="mt-1.5 flex gap-2 text-[10.5px]">
            <button
              type="button"
              data-testid="planned-overlap-notice-play"
              onClick={() => { void usePlayForwardStore.getState().enter(root); }}
              className="px-1.5 py-0.5 rounded border border-violet-400/30 text-violet-200 hover:bg-violet-500/15 transition-colors"
              title="Play the plans forward: see them on the graph, and re-sequence, tell the agents or leave each one"
            >
              Play the plans forward
            </button>
            <button type="button" data-testid="planned-overlap-notice-seen" onClick={() => { void seen(n.id); }} className="text-foreground-subtle hover:text-foreground">
              Seen
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
