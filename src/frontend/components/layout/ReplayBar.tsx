/**
 * The replay chrome (Phase 32 B5.3).
 *
 * `ReplayStart` is the way in, on the Timeline tab. `ReplayBar` is shown
 * above every tab while replay is on: it says which moments are being
 * watched and between which two times, steps and plays them with the
 * transport bar the code view already uses, and goes back to live. While it
 * is on, the lanes, the graph, the plan's task statuses, the stack (B6.5)
 * and the inbox show the moment at the cursor; live events keep arriving
 * underneath.
 */

import { History, Radio } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { PlaybackBar } from '../inspector/PlaybackBar';
import { useReplayStore } from '../../stores/replay-store';
import { useProjectStore } from '../../stores/project-store';
import { frameWords, replayRangeWords, toPlaybackFrames } from '../../lib/replay';

/** The moment's words sit under the bar; the transport bar's own line stays empty. */
const noSummary = (): string => '';

export function ReplayStart() {
  const root = useProjectStore((s) => s.root);
  const active = useReplayStore((s) => s.active);
  const enter = useReplayStore((s) => s.enter);
  if (!root || active) return null;
  return (
    <button
      type="button"
      onClick={() => { void enter(root); }}
      className="mb-2 flex items-center gap-1.5 text-[10.5px] text-foreground-muted hover:text-foreground px-2 py-1 rounded-md border border-white/[0.06] hover:bg-surface-hover transition-colors"
      title="Step through the last two hours as they were: the graph, the tasks, the stack and the inbox at each recorded moment"
      data-testid="replay-start"
    >
      <History size={11} />
      Replay the last two hours
    </button>
  );
}

export function ReplayBar() {
  const { active, root: replayRoot, frames, index, state, loading, error, autoplay, setIndex, exit } = useReplayStore();
  const root = useProjectStore((s) => s.root);
  const playback = useMemo(() => toPlaybackFrames(frames), [frames]);
  // Another project opened: its moments are not these.
  useEffect(() => { if (active && root !== replayRoot) exit(); }, [active, root, replayRoot, exit]);
  if (!active) return null;

  const frame = frames[index];
  const waiting = state?.waiting.length ?? 0;
  const open = state?.signals.length ?? 0;
  return (
    <div className="mx-2 mt-2 rounded-md border border-accent/30 bg-accent/[0.05] px-2.5 py-2 space-y-1.5" data-testid="replay-bar" role="region" aria-label="Replay">
      <div className="flex items-center gap-2 text-[11px]">
        <History size={12} className="text-accent shrink-0" />
        <span className="font-medium text-foreground" data-testid="replay-range">{replayRangeWords(frames, index)}</span>
        {loading && <span className="text-foreground-subtle">reading…</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={exit}
          className="flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
          data-testid="replay-live"
        >
          <Radio size={10} />
          Back to live
        </button>
      </div>
      {error && <div className="text-[10.5px] text-danger">Replay could not be read: {error}</div>}
      {!loading && frames.length === 0 && !error && (
        <div className="text-[10.5px] text-foreground-muted" data-testid="replay-empty">
          Nothing recorded in the last two hours. A moment is kept when an agent's turn ends, a task changes status or a commit lands.
        </div>
      )}
      {frames.length > 0 && (
        <>
          <PlaybackBar
            key={`${frames[0]?.id ?? 0}:${autoplay ?? 'still'}`}
            frames={playback}
            index={index}
            onIndexChange={(i) => { void setIndex(i); }}
            summaryOf={noSummary}
            autoPlaySpeed={autoplay ?? undefined}
          />
          {frame && (
            <div className="text-[10.5px] text-foreground-muted" data-testid="replay-moment">
              {frameWords(frame)}
              {state && ` · ${open === 0 ? 'no signals open' : `${open} signal${open === 1 ? '' : 's'} open`}`}
              {state && ` · ${waiting === 0 ? 'nothing waiting on you' : `${waiting} waiting on you`}`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
