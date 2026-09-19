import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Rewind } from 'lucide-react';

/**
 * The transport bar — Phase 26, layer C.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * Drives whatever surface is below it: a file's contents through time,
 * or the list of files that changed. No layout engine is involved, which
 * is why this works on repositories where the graph would struggle.
 *
 * Frames are **discrete**. There is no interpolation between them,
 * because between two recorded points a file either has a state or it
 * does not, and a tween of source code would be fiction. Playing simply
 * steps.
 */

export interface PlaybackFrame {
  spec: string;
  label: string;
  kind: string;
  timestamp: number | null;
  delta: {
    added: number;
    removed: number;
    modified: number;
    edgesAdded: number | null;
    edgesRemoved: number | null;
  } | null;
  changedFiles: string[];
  truncated: boolean;
}

interface Props {
  frames: PlaybackFrame[];
  index: number;
  onIndexChange: (index: number) => void;
  notes?: string[];
}

/** Milliseconds per frame, by speed multiplier. */
const BASE_INTERVAL_MS = 1200;
const SPEEDS = [0.5, 1, 2, 4] as const;

export function PlaybackBar({ frames, index, onIndexChange, notes }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const atEnd = index >= frames.length - 1;

  const step = useCallback(
    (by: number) => {
      const next = Math.min(Math.max(index + by, 0), Math.max(frames.length - 1, 0));
      onIndexChange(next);
    },
    [index, frames.length, onIndexChange],
  );

  useEffect(() => {
    if (!playing) return;
    // Stop at the end rather than looping: a timeline that silently
    // restarts makes it impossible to tell "finished" from "began again".
    if (atEnd) {
      setPlaying(false);
      return;
    }
    timer.current = setInterval(() => onIndexChange(Math.min(index + 1, frames.length - 1)), BASE_INTERVAL_MS / speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [playing, index, speed, atEnd, frames.length, onIndexChange]);

  const current = frames[index];

  const summary = useMemo(() => {
    if (!current?.delta) return 'Starting point';
    const { added, modified, removed } = current.delta;
    const parts: string[] = [];
    if (added) parts.push(`+${added}`);
    if (modified) parts.push(`~${modified}`);
    if (removed) parts.push(`−${removed}`);
    return parts.length > 0 ? `${parts.join('  ')} files` : 'No file changes';
  }, [current]);

  if (frames.length === 0) {
    return (
      <div className="px-2 py-1.5 text-[10px] text-foreground-subtle">
        {notes?.[0] ?? 'Nothing to play back yet.'}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/[0.06] bg-black/20 px-2 py-1.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onIndexChange(0)}
          disabled={index === 0}
          title="Back to the start"
          className="text-foreground-subtle hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <Rewind size={12} />
        </button>
        <button
          onClick={() => step(-1)}
          disabled={index === 0}
          title="Previous frame"
          className="text-foreground-subtle hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <SkipBack size={12} />
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={atEnd && !playing}
          title={playing ? 'Pause' : 'Play forward'}
          className="text-accent hover:text-accent/80 disabled:opacity-30 transition-colors"
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button
          onClick={() => step(1)}
          disabled={atEnd}
          title="Next frame"
          className="text-foreground-subtle hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <SkipForward size={12} />
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(frames.length - 1, 0)}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            onIndexChange(Number(e.target.value));
          }}
          className="flex-1 h-1 accent-[color:var(--accent,#6366f1)] cursor-pointer"
        />

        <button
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          title="Playback speed"
          className="text-[9.5px] font-mono text-foreground-subtle hover:text-foreground w-7 text-right transition-colors"
        >
          {speed}×
        </button>
      </div>

      <div className="flex items-center gap-2 text-[9.5px]">
        <span className="font-mono text-foreground-muted truncate max-w-[45%]" title={current?.label}>
          {current?.label}
        </span>
        {current?.timestamp && (
          <span className="text-foreground-subtle/70">
            {new Date(current.timestamp).toLocaleDateString()}
          </span>
        )}
        <span className="text-foreground-subtle">{summary}</span>
        <span className="ml-auto text-foreground-subtle/60 font-mono">
          {index + 1}/{frames.length}
        </span>
      </div>

      {current?.truncated && (
        <div className="text-[9px] text-foreground-subtle/70">
          File list truncated — this frame changed more files than the timeline carries.
        </div>
      )}
    </div>
  );
}
