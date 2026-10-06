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
 * ⏸ is a call held at a breakpoint, a span from the hit to the answer (to
 * now while it waits); ⊘ is a breach, a change that was never held (B4.3b).
 * Either opens Awareness, where it is answered.
 *
 * Words beside glyphs, colour never alone (design rules §2): the hover says
 * what a mark is, and a failed turn is also red and says "failed".
 */
import { useEffect, useMemo, useState } from 'react';
import { useAwarenessStore } from '../../stores/awareness-store';
import { useBreakpointsStore } from '../../stores/breakpoints-store';
import { usePlanItemsStore } from '../../stores/plan-items-store';
import { sectionsByBranch } from '../../lib/section-worktrees';
import { useReplayState } from '../../stores/replay-store';
import { hhmm, hitsAsOf, signalsAsOf } from '../../lib/replay';
import { buildLanes, position, type LaneMark } from '../../lib/timeline-lanes';
import type { AgentTurn } from '../../lib/agent-turns';
import { identityTone, LANE, TONES } from '../../lib/visual-language';

// Glyphs and words from the visual vocabulary (Phase 33 G1). A commit is ◉:
// ◆ means unplanned everywhere else. U+FE0E asks for the text form of ⚠ and
// ⏸, so they take the severity's colour instead of rendering as an emoji.
const textForm = (kind: LaneMark['kind']) => (kind === 'signal' || kind === 'pause' ? '\uFE0E' : '');
const GLYPH = Object.fromEntries(
  (Object.keys(LANE) as Array<LaneMark['kind']>).map((k) => [k, `${LANE[k].glyph}${textForm(k)}`]),
) as Record<LaneMark['kind'], string>;

const NAME = Object.fromEntries(
  (Object.keys(LANE) as Array<LaneMark['kind']>).map((k) => [k, LANE[k].word]),
) as Record<LaneMark['kind'], string>;

function markClass(m: LaneMark): string {
  if (m.kind === 'breach') return TONES[LANE.breach.tone].text;
  if (m.kind === 'pause') return m.waiting ? TONES[LANE.pause.tone].text : 'text-foreground-muted';
  if (m.kind === 'signal') return m.severity === 'high' ? TONES.blocked.text : m.severity === 'medium' ? TONES.attention.text : 'text-foreground-subtle';
  if (m.kind === 'check-fail' || m.error) return TONES[LANE['check-fail'].tone].text;
  if (m.kind === 'check-pass') return TONES[LANE['check-pass'].tone].text;
  if (m.kind === 'commit' || m.kind === 'merge') return TONES[LANE.commit.tone].text;
  return m.kind === 'edit' ? TONES[LANE.edit.tone].text : 'text-foreground-muted';
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
  onSelectHit,
}: {
  turns: AgentTurn[];
  onSelectTurn: (turnId: string) => void;
  onSelectSignal: (signalId: string) => void;
  /** A held call or a breach: where it is answered. */
  onSelectHit: (ref: string) => void;
}) {
  const workstreams = useAwarenessStore((s) => s.workstreams);
  const signals = useAwarenessStore((s) => s.signals);
  const commits = useAwarenessStore((s) => s.commits);
  const hits = useBreakpointsStore((s) => s.recent);
  // Phase 32 C5.3 — the open plan's sections kept to each branch, named on its lane.
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const sections = useMemo(() => sectionsByBranch(itemsByUid), [itemsByUid]);
  const tick = useNow();
  // A new event is "now" too, so its mark is never drawn past the end.
  const latest = turns.reduce((t, x) => Math.max(t, x.endedAt), 0);
  // B5.3: while replaying, the lanes end at the cursor's moment, with the
  // signals open then and each hit as it stood then.
  const replay = useReplayState();
  const now = replay ? replay.at : Math.max(tick, latest);
  const shownSignals = useMemo(() => (replay ? signalsAsOf(replay) : signals), [replay, signals]);
  const shownHits = useMemo(() => (replay ? hitsAsOf(hits, replay.at) : hits), [replay, hits]);
  const view = useMemo(
    () => buildLanes({ turns, workstreams, signals: shownSignals, commits, hits: shownHits, now }),
    [turns, workstreams, shownSignals, commits, shownHits, now],
  );

  // One lane and nothing on it says nothing the list below doesn't.
  if (view.lanes.length === 0 || (view.lanes.length === 1 && view.lanes[0].marks.length === 0)) return null;

  return (
    <div className="mb-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5" data-testid="timeline-lanes">
      <div className="space-y-1">
        {view.lanes.map((lane) => (
          <div key={lane.key} className="flex items-center gap-2" data-testid="timeline-lane" data-lane={lane.label}>
            <span
              className={`w-28 shrink-0 flex flex-col leading-tight text-[10px] ${lane.root ? 'text-foreground-muted' : 'text-foreground-subtle italic'}`}
              title={[lane.root ?? 'Not in any workstream: a spec edited from the app, say', sections.get(lane.label)?.length ? `Worked here: ${sections.get(lane.label)!.join(', ')}` : null].filter(Boolean).join('\n')}
            >
              <span className="truncate font-mono">{lane.label}</span>
              {lane.root && sections.get(lane.label)?.length ? (
                <span className={`truncate text-[9px] not-italic ${identityTone(lane.label).text}`} data-testid="lane-sections">{sections.get(lane.label)!.join(', ')}</span>
              ) : null}
            </span>
            <div className="relative flex-1 h-4 border-b border-white/[0.06]">
              {/* A long turn is also a faint span from start to end; a pause, a
                  line along the lane's foot to its answer, dashed while it waits. */}
              {lane.marks.filter((m) => m.endAt > m.at).map((m) => {
                const left = position(view, m.at) * 100;
                const width = position(view, m.endAt) * 100 - left;
                if (m.kind === 'pause') {
                  return (
                    <span
                      key={`span-${m.id}`}
                      data-testid="timeline-pause-span"
                      data-waiting={m.waiting ? 'true' : 'false'}
                      // Along the lane's foot, under the marks, so ⏸ and anything
                      // that happened while it waited stay readable.
                      className={`absolute bottom-0 h-0 border-t-2 pointer-events-none opacity-70 ${m.waiting ? 'border-dashed' : 'border-solid'} ${markClass(m)}`}
                      style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, borderColor: 'currentColor' }}
                    />
                  );
                }
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
                    else if (m.kind === 'pause' || m.kind === 'breach') onSelectHit(m.id);
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
          <span data-testid="timeline-lanes-end">{replay ? `at ${hhmm(replay.at)}` : 'now'}</span>
        </div>
      </div>
    </div>
  );
}
