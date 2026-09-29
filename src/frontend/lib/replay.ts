/**
 * Replay, the window's side (Phase 32 B5.3, observability doc §6.2).
 *
 * Replay steps between recorded moments (frames, B5.1) and shows the
 * project as it was at each (the state at a moment, B5.2). These helpers
 * turn the backend's answers into what the window already draws: signals
 * in the shape the inbox and lanes read, task statuses by uid, the frames
 * as the transport bar's frames, and the words for the chrome.
 *
 * Pure, so the words and the mapping are tested without a browser.
 */

import type { AwarenessSignal, BreakpointHit } from '@shared/types';
import type { PlaybackFrame } from '../components/inspector/PlaybackBar';

/** How far back replay looks by default: the lanes' own widest window. */
export const REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;

export type FrameReason = 'turn-end' | 'status' | 'commit';

/** A frame as `/api/replay/frames` lists it. */
export interface ReplayFrameInfo {
  id: number;
  at: number;
  reasons: FrameReason[];
  ref: string | null;
  sessionId: string | null;
  agentType: string | null;
  workstreamRoot: string | null;
  commitSha: string | null;
  branch: string | null;
  sameAs: number | null;
  fileCount: number;
  edgeCount: number;
}

export interface ReplayDiff {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  addedEdges: Array<{ source: string; target: string }>;
  removedEdges: Array<{ source: string; target: string }>;
}

/** The project at a moment, as `/api/replay/state` answers. */
export interface ReplayState {
  at: number;
  projectPath: string;
  frame: ReplayFrameInfo | null;
  sinceFrame: ReplayDiff | null;
  tasks: Array<{ uid: string; planUid: string; planTitle: string; title: string; status: string | null; statusNow?: string | null }>;
  waiting: BreakpointHit[];
  signals: Array<{
    id: string; kind: AwarenessSignal['kind']; subject: AwarenessSignal['subject']; severity: AwarenessSignal['severity'];
    summary: string; workstreams: string[]; openedAt: number; closedAt: number | null;
  }>;
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** 24-hour HH:MM, the same in every locale, so the chrome reads the same everywhere. */
const hhmm = (t: number): string => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** The signals open then, as the inbox and the lanes read signals: all open at that moment. */
export function signalsAsOf(state: ReplayState): AwarenessSignal[] {
  return state.signals.map((s) => ({
    id: s.id,
    kind: s.kind,
    severity: s.severity,
    subject: s.subject ?? {},
    workstreams: s.workstreams,
    summary: s.summary,
    firstSeen: s.openedAt,
    lastSeen: Math.min(s.closedAt ?? state.at, state.at),
    state: 'open',
  }));
}

/** Each task's status then, by uid. */
export function statusesAsOf(state: ReplayState): Record<string, string | null> {
  return Object.fromEntries(state.tasks.map((t) => [t.uid, t.status]));
}

/** What a frame stands for, in words: "Codex's turn ended · a commit landed (3f2a1b0)". */
export function frameWords(frame: ReplayFrameInfo): string {
  const who = frame.agentType ? frame.agentType : 'an agent';
  const parts = frame.reasons.map((r) => {
    if (r === 'turn-end') return `${who}'s turn ended`;
    if (r === 'status') return 'a task changed status';
    return `a commit landed${frame.commitSha ? ` (${frame.commitSha.slice(0, 7)})` : ''}`;
  });
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The chrome: which moments are being watched, between which two times. */
export function replayRangeWords(frames: readonly ReplayFrameInfo[], index: number): string {
  if (frames.length === 0) return 'Replay: nothing recorded yet';
  const at = frames[Math.min(Math.max(index, 0), frames.length - 1)].at;
  return `Replaying ${hhmm(frames[0].at)} → ${hhmm(frames[frames.length - 1].at)} · at ${hhmm(at)}`;
}

/** The frames as the transport bar steps them: time and words, no per-file delta. */
export function toPlaybackFrames(frames: readonly ReplayFrameInfo[]): PlaybackFrame[] {
  return frames.map((f) => ({
    spec: String(f.id),
    label: `${hhmm(f.at)} · ${frameWords(f)}`,
    kind: 'frame',
    timestamp: f.at,
    delta: null,
    changedFiles: [],
    truncated: false,
  }));
}

/**
 * Breakpoint hits as they stood at `at`: none made after it, and one
 * answered after it still waiting, so its ⏸ span runs to the cursor.
 */
export function hitsAsOf(hits: readonly BreakpointHit[], at: number): BreakpointHit[] {
  return hits
    .filter((h) => h.hitAt <= at)
    .map((h) => (h.answeredAt !== null && h.answeredAt > at ? { ...h, answeredAt: null, decision: null, note: null } : h));
}
