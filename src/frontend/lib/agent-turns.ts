import type { AgentEvent } from '@shared/types';
import { phraseEvent, type PhrasedEvent } from './tool-phrasing';

/**
 * Turn grouping — Phase 22, change A.
 *
 * See [docs/PHASE-22-AGENT-ACTIVITY-CLARITY.md](../../../docs/PHASE-22-AGENT-ACTIVITY-CLARITY.md).
 *
 * An agent reads three files, greps, edits two and runs a test. That is
 * **one intention and seven rows**. The timeline rendered all seven, in
 * arrival order, mixed with every other agent's rows, and asked the user
 * to reconstruct meaning from it. They don't; they watch it scroll and
 * close the panel.
 *
 * Grouping is a *view* concern. The underlying events are never dropped
 * or rewritten — the timeline's value in a post-mortem is that it is
 * complete — so every turn keeps its events for the disclosure.
 */

/**
 * A gap longer than this starts a new turn. Deliberately a constant and
 * not a setting: it is a rendering heuristic, and a user asked to tune
 * it would be being asked to debug our grouping.
 */
export const TURN_GAP_MS = 30_000;

export interface AgentTurn {
  /** Stable id — the first event's id. */
  id: string;
  /** Session the turn belongs to. Null for events with no session. */
  sessionId: string | null;
  agentType: string | null;
  agentModel: string | null;
  startedAt: number;
  endedAt: number;
  /** Wall-clock span of the turn in ms. */
  durationMs: number;
  events: AgentEvent[];
  /** One line describing the turn. */
  summary: string;
  /** True when anything in the turn changed state. */
  mutating: boolean;
  /** True when any event in the turn errored. */
  hasError: boolean;
  /** Distinct file basenames the turn touched, in first-seen order. */
  files: string[];
}

function sessionOf(event: AgentEvent): string | null {
  const s = event.payload?.sessionId;
  return typeof s === 'string' ? s : null;
}

function stringField(event: AgentEvent, key: string): string | null {
  const v = event.payload?.[key];
  return typeof v === 'string' ? v : null;
}

/** The file an event touched, if any — basename only. */
function fileOf(event: AgentEvent): string | null {
  const f = event.payload?.file ?? event.payload?.path ?? event.payload?.relativePath;
  if (typeof f !== 'string' || !f) return null;
  return f.split('/').pop() ?? null;
}

/**
 * Group events into turns.
 *
 * Turns are per session, because two agents working at once interleave
 * in the event stream and merging them would attribute one agent's work
 * to the other. Cross-attribution has bitten this codebase before (see
 * `inferAgentFromSession` in mcp/server.ts), so it is a property worth
 * preserving deliberately rather than by luck.
 *
 * Input need not be sorted; output is oldest-first.
 */
export function groupIntoTurns(events: AgentEvent[], gapMs: number = TURN_GAP_MS): AgentTurn[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const openBySession = new Map<string, AgentTurn>();
  const turns: AgentTurn[] = [];

  for (const event of sorted) {
    const sessionId = sessionOf(event);
    const key = sessionId ?? '__no_session__';
    const open = openBySession.get(key);

    if (open && event.timestamp - open.endedAt <= gapMs) {
      open.events.push(event);
      open.endedAt = event.timestamp;
      open.durationMs = open.endedAt - open.startedAt;
      continue;
    }

    const turn: AgentTurn = {
      id: event.id,
      sessionId,
      agentType: stringField(event, 'agentType'),
      agentModel: stringField(event, 'agentModel'),
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      durationMs: 0,
      events: [event],
      summary: '',
      mutating: false,
      hasError: false,
      files: [],
    };
    openBySession.set(key, turn);
    turns.push(turn);
  }

  for (const turn of turns) finalise(turn);
  return turns;
}

function finalise(turn: AgentTurn): void {
  const phrased = turn.events.map((e) => ({ event: e, phrased: phraseEvent(e) }));

  turn.hasError = phrased.some((p) => p.phrased.intent === 'error');
  turn.mutating = phrased.some((p) => p.phrased.mutating);

  const files: string[] = [];
  for (const { event } of phrased) {
    const f = fileOf(event);
    if (f && !files.includes(f)) files.push(f);
  }
  turn.files = files;

  // The agent identity may only appear on later events in the turn
  // (a session registers, then works), so take the first non-null.
  if (!turn.agentType) {
    turn.agentType = phrased.map((p) => stringField(p.event, 'agentType')).find((v) => v) ?? null;
  }
  if (!turn.agentModel) {
    turn.agentModel = phrased.map((p) => stringField(p.event, 'agentModel')).find((v) => v) ?? null;
  }

  turn.summary = summarise(turn, phrased.map((p) => p.phrased));
}

/**
 * The turn's headline, in priority order:
 *
 *   1. an error, because that is what the user needs to see
 *   2. a question to the human — the agent is blocked on them
 *   3. the last mutating action, because mutations describe intent while
 *      the reads around them are only how the agent got there
 *   4. otherwise the reading it did
 *
 * Files touched are appended, since "what changed" is the thing a user
 * scans for.
 */
function summarise(turn: AgentTurn, phrased: PhrasedEvent[]): string {
  const count = turn.events.length;
  const suffix = count > 1 ? ` · ${count} calls` : '';

  const error = phrased.find((p) => p.intent === 'error');
  if (error) return `${error.text}${suffix}`;

  const ask = phrased.find((p) => p.intent === 'ask');
  if (ask) return `${ask.text}${suffix}`;

  const mutations = phrased.filter((p) => p.mutating);
  if (mutations.length > 0) {
    const headline = mutations[mutations.length - 1].text;
    const others = mutations.length > 1 ? ` (+${mutations.length - 1} more)` : '';
    return `${headline}${others}${suffix}`;
  }

  const session = phrased.find((p) => p.intent === 'session');
  if (session && count === 1) return session.text;

  const reads = phrased.filter((p) => p.intent === 'read');
  if (reads.length > 0) {
    return reads.length === 1 ? reads[0].text : `${reads[0].text}${suffix}`;
  }

  return phrased[0]?.text ?? `${count} events`;
}

/** `41s`, `2m 05s`, `—` for an instant turn. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * "4 minutes ago". Used by the idle state, which previously showed
 * nothing at all — indistinguishable from the app being broken.
 */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const seconds = Math.round(delta / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
