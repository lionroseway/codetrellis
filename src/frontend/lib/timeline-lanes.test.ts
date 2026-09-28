/**
 * Timeline lanes (Phase 32 B2.1): which lane each turn and signal goes on,
 * what mark it makes, and the window the lanes span.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, AwarenessSignal, Workstream } from '../../shared/types';
import type { AgentTurn } from './agent-turns';
import { buildLanes, turnRoot, position, laneLabel, OUTSIDE, MAX_WINDOW_MS, MIN_WINDOW_MS } from './timeline-lanes';

const NOW = 10_000_000;
const MIN = 60_000;

const ws = (root: string, branch: string | null, sessions: string[] = [], main = false): Workstream => ({
  root, branch, head: null, main, shape: 'worktree', idle: false,
  agents: sessions.map((sessionId) => ({ sessionId, agentType: 'codex', model: null, source: 'mcp', lastSeen: null })),
  changes: { files: [], truncated: false, base: null } as unknown as Workstream['changes'],
});

const ev = (payload: Record<string, unknown>, type: AgentEvent['type'] = 'tool_call', extra: Record<string, unknown> = {}): AgentEvent =>
  ({ id: `e${Math.random()}`, timestamp: NOW - MIN, source: 'mcp', type, payload, ...extra } as AgentEvent);

const turn = (id: string, events: AgentEvent[], at = NOW - 10 * MIN, over: Partial<AgentTurn> = {}): AgentTurn => ({
  id, sessionId: (events[0]?.payload.sessionId as string) ?? null, agentType: 'codex', agentModel: null,
  startedAt: at, endedAt: at + MIN, durationMs: MIN, events, summary: 'Listed plans', mutating: false, hasError: false, files: [], ...over,
});

const signal = (over: Partial<AwarenessSignal>): AwarenessSignal => ({
  id: 's1', kind: 'collision', severity: 'high', subject: { file: 'a.ts' }, workstreams: ['/w/auth', '/w/billing'],
  summary: '`auth` and `billing` both change a.ts', firstSeen: NOW - 5 * MIN, lastSeen: NOW, state: 'open', ...over,
});

const AUTH = ws('/w/auth', 'auth-refresh', ['s-a']);
const BILLING = ws('/w/billing', 'billing-v2', ['s-b']);
const MAIN = ws('/w/app', 'main', [], true);

describe('which lane', () => {
  test('the workstream the events name, live (payload) or stored (row)', () => {
    assert.equal(turnRoot(turn('t', [ev({ sessionId: 's-x', workstreamRoot: '/w/billing' })]), [AUTH, BILLING]), '/w/billing');
    assert.equal(turnRoot(turn('t', [ev({ sessionId: 's-x' }, 'tool_call', { workstreamRoot: '/w/auth' })]), [AUTH, BILLING]), '/w/auth');
  });

  test('else the workstream whose agents include the session; else none', () => {
    assert.equal(turnRoot(turn('t', [ev({ sessionId: 's-b' })]), [AUTH, BILLING]), '/w/billing');
    assert.equal(turnRoot(turn('t', [ev({ sessionId: 's-z' })]), [AUTH, BILLING]), null);
  });

  test('a lane per workstream, main first, even when quiet; one for work outside any, only when used', () => {
    const quiet = buildLanes({ turns: [], workstreams: [BILLING, AUTH, MAIN], signals: [], now: NOW });
    assert.deepEqual(quiet.lanes.map((l) => l.label), ['main', 'auth-refresh', 'billing-v2']);
    const withEdit = buildLanes({
      turns: [turn('t1', [ev({ kind: 'document', title: 'Spec' }, 'spec_edited')], NOW - 3 * MIN, { sessionId: null, agentType: 'human' })],
      workstreams: [AUTH], signals: [], now: NOW,
    });
    assert.deepEqual(withEdit.lanes.map((l) => [l.key, l.label]), [['/w/auth', 'auth-refresh'], [OUTSIDE, 'No workstream']]);
  });

  test('a branch workstream is labelled by its branch; a detached one by its folder', () => {
    assert.equal(laneLabel({ root: 'branch:origin/fix', branch: 'origin/fix' }), 'origin/fix');
    assert.equal(laneLabel({ root: '/w/app-scratch', branch: null }), 'app-scratch');
  });
});

describe('which mark', () => {
  test('a turn is ●, an editing turn ✎, a failed one flagged; a signal ⚠ on every lane it names', () => {
    const view = buildLanes({
      turns: [
        turn('t1', [ev({ sessionId: 's-a' })], NOW - 20 * MIN),
        turn('t2', [ev({ sessionId: 's-a' }), ev({ sessionId: 's-a', kind: 'item' }, 'spec_edited')], NOW - 15 * MIN),
        turn('t3', [ev({ sessionId: 's-b' }, 'tool_error')], NOW - 12 * MIN, { hasError: true }),
      ],
      workstreams: [AUTH, BILLING],
      signals: [signal({}), signal({ id: 'gone', state: 'resolved' })],
      now: NOW,
    });
    const auth = view.lanes.find((l) => l.key === '/w/auth')!;
    const billing = view.lanes.find((l) => l.key === '/w/billing')!;
    assert.deepEqual(auth.marks.map((m) => [m.id, m.kind]), [['t1', 'turn'], ['t2', 'edit'], ['s1', 'signal']]);
    assert.deepEqual(billing.marks.map((m) => [m.id, m.kind, m.error ?? false]), [['t3', 'turn', true], ['s1', 'signal', false]]);
    assert.equal(auth.marks[2].severity, 'high');
    assert.equal(auth.marks[0].text, 'codex: Listed plans');
  });
});

describe('the window', () => {
  test('from the earliest mark, at least 15 minutes, at most 2 hours; older marks drop out', () => {
    const recent = buildLanes({ turns: [turn('t', [ev({ sessionId: 's-a' })], NOW - 2 * MIN)], workstreams: [AUTH], signals: [], now: NOW });
    assert.equal(recent.start, NOW - MIN_WINDOW_MS);
    const hour = buildLanes({ turns: [turn('t', [ev({ sessionId: 's-a' })], NOW - 60 * MIN)], workstreams: [AUTH], signals: [], now: NOW });
    assert.equal(hour.start, NOW - 60 * MIN);
    const old = buildLanes({
      turns: [turn('old', [ev({ sessionId: 's-a' })], NOW - 5 * 60 * MIN), turn('new', [ev({ sessionId: 's-a' })], NOW - MIN)],
      workstreams: [AUTH], signals: [], now: NOW,
    });
    assert.equal(old.start, NOW - MAX_WINDOW_MS);
    assert.deepEqual(old.lanes[0].marks.map((m) => m.id), ['new']);
  });

  test('position runs 0 at the start to 1 at now, clamped', () => {
    const v = { start: 0, end: 100 };
    assert.equal(position(v, 25), 0.25);
    assert.equal(position(v, -5), 0);
    assert.equal(position(v, 500), 1);
  });
});
