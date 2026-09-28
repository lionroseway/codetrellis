/**
 * Phase 32 B2.1 — Timeline lanes: one lane per workstream above the turn
 * list, so parallel work reads as parallel (observability doc §6.1).
 *
 * Each lane is a workstream (its branch as the label), time runs left to
 * right up to now, and each thing that happened on it is a mark: ● a turn,
 * ✎ a turn that edited a spec, ⚠ a signal raised about it. Hover a mark for
 * one line; click a turn to open it in the list below, or a signal to go to
 * the Awareness tab. Live: marks arrive with the events, and "now" moves.
 *
 * Words beside glyphs, colour never alone (design rules §2): the hover says
 * what a mark is, and a failed turn is also red and says "failed".
 */
import { useEffect, useMemo, useState } from 'react';
import { useAwarenessStore } from '../../stores/awareness-store';
import { buildLanes, position, type LaneMark } from '../../lib/timeline-lanes';
import type { AgentTurn } from '../../lib/agent-turns';

// U+FE0E asks for the text form of ⚠, so it takes the severity's colour
// instead of rendering as a yellow emoji whatever the severity.
const GLYPH: Record<LaneMark['kind'], string> = {
  turn: '●', edit: '✎', signal: '⚠\uFE0E', commit: '◆', merge: '⧫', 'check-pass': '✓', 'check-fail': '✗',
};

const NAME: Record<LaneMark['kind'], string> = {
  turn: 'turn', edit: 'edit', signal: 'signal', commit: 'commit', merge: 'merge', 'check-pass': 'checks passed', 'check-fail': 'checks failed',
};

function markClass(m: LaneMark): string {
  if (m.kind === 'signal') return m.severity === 'high' ? 'text-danger' : m.severity === 'medium' ? 'text-warning' : 'text-foreground-subtle';
  if (m.kind === 'check-fail' || m.error) return 'text-danger';
  if (m.kind === 'check-pass') return 'text-success';
  if (m.kind === 'commit' || m.kind === 'merge') return 'text-foreground';
  return m.kind === 'edit' ? 'text-accent' : 'text-foreground-muted';
}

function markTitle(m: LaneMark): string {
  const when = new Date(m.at).toLocaleTimeString();
  const what = m.kind === 'signal' ? `${m.severity} signal` : m.kind === 'turn' && m.error ? 'turn (failed)' : NAME[m.kind];
  return `${when} · ${what} · ${m.text}`;
}

/** "now" moves every half minute, so an idle view still says where now is. */
function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

export function TimelineLanes({
  turns,
  onSelectTurn,
  onSelectSignal,
}: {
  turns: AgentTurn[];
  onSelectTurn: (turnId: string) => void;
  onSelectSignal: (signalId: string) => void;
}) {
  const workstreams = useAwarenessStore((s) => s.workstreams);
  const signals = useAwarenessStore((s) => s.signals);
  const commits = useAwarenessStore((s) => s.commits);
  const tick = useNow();
  // A new event is "now" too, so its mark is never drawn past the end.
  const latest = turns.reduce((t, x) => Math.max(t, x.endedAt), 0);
  const now = Math.max(tick, latest);
  const view = useMemo(() => buildLanes({ turns, workstreams, signals, commits, now }), [turns, workstreams, signals, commits, now]);

  // One lane and nothing on it says nothing the list below doesn't.
  if (view.lanes.length === 0 || (view.lanes.length === 1 && view.lanes[0].marks.length === 0)) return null;

  return (
    <div className="mb-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5" data-testid="timeline-lanes">
      <div className="space-y-1">
        {view.lanes.map((lane) => (
          <div key={lane.key} className="flex items-center gap-2" data-testid="timeline-lane" data-lane={lane.label}>
            <span
              className={`w-28 shrink-0 truncate text-[10px] font-mono ${lane.root ? 'text-foreground-muted' : 'text-foreground-subtle italic'}`}
              title={lane.root ?? 'Not in any workstream: a spec edited from the app, say'}
            >
              {lane.label}
            </span>
            <div className="relative flex-1 h-4 border-b border-white/[0.06]">
              {/* A long turn is also a faint span from start to end. */}
              {lane.marks.filter((m) => m.endAt > m.at).map((m) => {
                const left = position(view, m.at) * 100;
                const width = position(view, m.endAt) * 100 - left;
                return width > 1.5 ? (
                  <span
                    key={`span-${m.id}`}
                    className={`absolute top-[7px] h-[2px] rounded bg-current opacity-30 pointer-events-none ${markClass(m)}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                ) : null;
              })}
              {lane.marks.map((m) => (
                <button
                  key={`${m.kind}-${m.id}`}
                  type="button"
                  onClick={() => {
                    if (m.kind === 'signal') onSelectSignal(m.id);
                    else if (m.kind !== 'commit' && m.kind !== 'merge') onSelectTurn(m.id);
                  }}
                  title={markTitle(m)}
                  aria-label={markTitle(m)}
                  data-testid="timeline-mark"
                  data-kind={m.kind}
                  className={`absolute top-0 h-4 w-3 flex items-center justify-center leading-none text-[11px] hover:scale-125 transition-transform ${markClass(m)}`}
                  // Centred on its time, but never off either end of the lane.
                  style={{ left: `clamp(0px, calc(${position(view, m.at) * 100}% - 6px), calc(100% - 12px))` }}
                >
                  {GLYPH[m.kind]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="w-28 shrink-0" />
        <div className="flex-1 flex justify-between text-[9px] text-foreground-subtle font-mono">
          <span>{new Date(view.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}
