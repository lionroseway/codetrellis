/**
 * Timeline lanes (Phase 32 B2.1, observability doc §6.1): one lane per
 * workstream, time running left to right, a mark for each thing that
 * happened on it.
 *
 *   ●  an agent turn (tool calls and edits, grouped as the turn list does)
 *   ✎  a turn that edited a spec or an item's description (B1.2)
 *   ⚠  a signal raised about it (A1.6–A3), on every lane it names
 *
 * Commits, merges, checks and breakpoints (◆ ✓ ✗ ⏸) are later steps.
 *
 * Pure: the component supplies turns, workstreams, signals and the time.
 * A turn is placed on the workstream its events name; failing that, the
 * workstream whose agents include its session; failing that, a lane for
 * work outside any workstream (a spec edited from the app, say).
 */

import type { AgentEvent, AwarenessSignal, SignalSeverity, Workstream } from '@shared/types';
import type { AgentTurn } from './agent-turns';

export type LaneMarkKind = 'turn' | 'edit' | 'signal';

export interface LaneMark {
  /** The turn's id, or the signal's. */
  id: string;
  kind: LaneMarkKind;
  at: number;
  /** A turn's end, so a long one can be drawn as a span. */
  endAt: number;
  /** One line for the hover. */
  text: string;
  error?: boolean;
  severity?: SignalSeverity;
}

export interface Lane {
  /** The workstream's root, or `outside` for work in none. */
  key: string;
  root: string | null;
  /** Its branch, or the folder's name. */
  label: string;
  main: boolean;
  marks: LaneMark[];
}

export interface LanesView {
  start: number;
  end: number;
  lanes: Lane[];
}

export const OUTSIDE = 'outside';
/** How far back the lanes reach at most, and at least. */
export const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
export const MIN_WINDOW_MS = 15 * 60 * 1000;

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/** A workstream's name in a lane label. */
export function laneLabel(w: Pick<Workstream, 'root' | 'branch'>): string {
  return w.branch ?? baseName(w.root.replace(/^branch:/, ''));
}

/** The workstream an event names: in its payload (live) or on the stored row (history). */
function rootOf(event: AgentEvent): string | null {
  const fromPayload = event.payload?.workstreamRoot;
  if (typeof fromPayload === 'string' && fromPayload) return fromPayload;
  const stored = (event as AgentEvent & { workstreamRoot?: unknown }).workstreamRoot;
  return typeof stored === 'string' && stored ? stored : null;
}

/** Where a turn goes: the workstream its events name, or its session's. */
export function turnRoot(turn: AgentTurn, workstreams: readonly Workstream[]): string | null {
  for (const e of turn.events) {
    const r = rootOf(e);
    if (r) return r;
  }
  if (turn.sessionId) {
    const w = workstreams.find((x) => x.agents.some((a) => a.sessionId === turn.sessionId));
    if (w) return w.root;
  }
  return null;
}

export function buildLanes(input: {
  turns: readonly AgentTurn[];
  workstreams: readonly Workstream[];
  signals: readonly AwarenessSignal[];
  now: number;
}): LanesView {
  const { turns, workstreams, signals, now } = input;
  const lanes = new Map<string, Lane>();
  for (const w of workstreams) {
    lanes.set(w.root, { key: w.root, root: w.root, label: laneLabel(w), main: w.main, marks: [] });
  }
  const laneFor = (root: string | null): Lane => {
    const key = root ?? OUTSIDE;
    let lane = lanes.get(key);
    if (!lane) {
      lane = root
        ? { key, root, label: baseName(root), main: false, marks: [] }
        : { key, root: null, label: 'No workstream', main: false, marks: [] };
      lanes.set(key, lane);
    }
    return lane;
  };

  for (const turn of turns) {
    const edited = turn.events.some((e) => e.type === 'spec_edited');
    laneFor(turnRoot(turn, workstreams)).marks.push({
      id: turn.id,
      kind: edited ? 'edit' : 'turn',
      at: turn.startedAt,
      endAt: turn.endedAt,
      text: `${turn.agentType ? `${turn.agentType}: ` : ''}${turn.summary}`,
      ...(turn.hasError ? { error: true } : {}),
    });
  }
  for (const s of signals) {
    if (s.state === 'resolved') continue;
    for (const root of s.workstreams) {
      laneFor(root).marks.push({ id: s.id, kind: 'signal', at: s.firstSeen, endAt: s.firstSeen, text: s.summary, severity: s.severity });
    }
  }

  // From the earliest mark, within [MIN_WINDOW, MAX_WINDOW] of now.
  const times = [...lanes.values()].flatMap((l) => l.marks.map((m) => m.at)).filter((t) => t <= now);
  const earliest = times.length ? Math.min(...times) : now;
  const start = Math.min(now - MIN_WINDOW_MS, Math.max(now - MAX_WINDOW_MS, earliest));

  const out = [...lanes.values()]
    .map((l) => ({ ...l, marks: l.marks.filter((m) => m.endAt >= start && m.at <= now).sort((a, b) => a.at - b.at) }))
    // Every workstream keeps its lane, so the shape of parallel work shows
    // even when it is quiet; the outside lane only when something is on it.
    .filter((l) => l.key !== OUTSIDE || l.marks.length > 0)
    .sort((a, b) => Number(b.main) - Number(a.main) || (a.key === OUTSIDE ? 1 : 0) - (b.key === OUTSIDE ? 1 : 0) || a.label.localeCompare(b.label));
  return { start, end: now, lanes: out };
}

/** Where a time sits across the lane, 0 to 1. */
export function position(view: Pick<LanesView, 'start' | 'end'>, at: number): number {
  const span = view.end - view.start;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (at - view.start) / span));
}
