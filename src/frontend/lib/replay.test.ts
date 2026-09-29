/**
 * Replay's words and mapping (Phase 32 B5.3).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameWords, hitsAsOf, replayRangeWords, signalsAsOf, statusesAsOf, toPlaybackFrames, type ReplayFrameInfo, type ReplayState } from './replay';

const frame = (over: Partial<ReplayFrameInfo> = {}): ReplayFrameInfo => ({
  id: 1, at: new Date(2026, 8, 29, 10, 2).getTime(), reasons: ['turn-end'], ref: null, sessionId: 's', agentType: 'codex',
  workstreamRoot: null, commitSha: null, branch: 'main', sameAs: null, fileCount: 10, edgeCount: 4, ...over,
});

test('a frame says what it stands for, every moment in it', () => {
  assert.equal(frameWords(frame()), "Codex's turn ended");
  assert.equal(frameWords(frame({ agentType: null, reasons: ['status'] })), 'A task changed status');
  assert.equal(frameWords(frame({ reasons: ['status', 'commit'], commitSha: '3f2a1b0c9d'.padEnd(40, '0') })), 'A task changed status · a commit landed (3f2a1b0)');
});

test('the chrome says between which two times, and where the cursor is', () => {
  const frames = [frame(), frame({ id: 2, at: new Date(2026, 8, 29, 12, 4).getTime() })];
  const words = replayRangeWords(frames, 0);
  assert.match(words, /^Replaying \d\d:\d\d → \d\d:\d\d · at \d\d:\d\d$/);
  assert.equal(replayRangeWords([], 0), 'Replay: nothing recorded yet');
});

test('signals then read as open signals, seen until the moment or their close', () => {
  const state: ReplayState = {
    at: 500, projectPath: '/p', frame: null, sinceFrame: null, tasks: [], waiting: [],
    signals: [{ id: 'c', kind: 'collision', subject: { file: 'a.ts' }, severity: 'high', summary: 'Both change a', workstreams: ['/w/a'], openedAt: 100, closedAt: 900 }],
  };
  const [s] = signalsAsOf(state);
  assert.equal(s.state, 'open');
  assert.equal(s.firstSeen, 100);
  assert.equal(s.lastSeen, 500);
  assert.deepEqual(s.subject, { file: 'a.ts' });
});

test('statuses then, by uid; frames as the transport bar steps them', () => {
  const state: ReplayState = {
    at: 1, projectPath: '/p', frame: null, sinceFrame: null, waiting: [], signals: [],
    tasks: [{ uid: 'a', planUid: 'p', planTitle: 'P', title: 'A', status: 'pending', statusNow: 'done' }],
  };
  assert.deepEqual(statusesAsOf(state), { a: 'pending' });
  const [f] = toPlaybackFrames([frame()]);
  assert.equal(f.spec, '1');
  assert.match(f.label, /^\d\d:\d\d · Codex's turn ended$/);
});

test('hits as they stood: none made later, one answered later still waiting', () => {
  const hit = (ref: string, hitAt: number, answeredAt: number | null) => ({ ref, hitAt, answeredAt, decision: answeredAt ? 'continue' : null, note: null }) as unknown as import('@shared/types').BreakpointHit;
  const at = hitsAsOf([hit('a', 100, 300), hit('b', 400, null), hit('c', 50, 80)], 200);
  assert.deepEqual(at.map((h) => [h.ref, h.answeredAt, h.decision]), [['a', null, null], ['c', 80, 'continue']]);
});
