/**
 * What the Awareness tab shows (Phase 32 A1.8).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupSignals, needsYouCount, digestLine, kindWords, sideLabel, sidesOf, stateWords, actionsFor, ago } from './awareness-view';
import type { AwarenessSignal, Workstream, WorkstreamAgent } from '../../shared/types';

const NOW = 1_800_000_000_000;
const agent = (id: string): WorkstreamAgent => ({ sessionId: id, agentType: 'codex', model: null, source: 'mcp', lastSeen: NOW });
const ws = (root: string, branch: string, main: boolean, agents: WorkstreamAgent[] = []): Workstream => ({
  root, branch, head: 'abc1234', main, shape: 'worktree', agents,
  changes: { base: 'b', files: main ? [] : [{ path: 'src/x.ts', status: 'modified' }], truncated: false }, idle: false,
});
let n = 0;
const sig = (over: Partial<AwarenessSignal> = {}): AwarenessSignal => ({
  id: `s${n++}`, kind: 'collision', severity: 'high', subject: { file: 'src/x.ts', symbol: 'refresh' },
  workstreams: ['/r-auth', '/r-billing'], summary: '`auth` and `billing` both change src/x.ts', firstSeen: NOW - 60_000, lastSeen: NOW, state: 'open',
  ...over,
});

const ROOM = [ws('/r', 'main', true), ws('/r-auth', 'auth-refresh', false, [agent('a')]), ws('/r-billing', 'billing-v2', false, [agent('b')])];

describe('groupSignals', () => {
  test('open high and medium need you; open low is a note; answered ones move down; resolved ones are gone', () => {
    const g = groupSignals([
      sig({ id: 'low', severity: 'low', kind: 'stale-base' }),
      sig({ id: 'med', severity: 'medium' }),
      sig({ id: 'high', severity: 'high' }),
      sig({ id: 'seen', state: 'acknowledged' }),
      sig({ id: 'meant', state: 'intended' }),
      sig({ id: 'nah', state: 'dismissed', severity: 'medium' }),
      sig({ id: 'gone', state: 'resolved' }),
    ]);
    assert.deepEqual(g.needsYou.map((s) => s.id), ['high', 'med'], 'most severe first');
    assert.deepEqual(g.lowPriority.map((s) => s.id), ['low']);
    assert.deepEqual(g.seen.map((s) => s.id), ['seen']);
    assert.deepEqual(g.setAside.map((s) => s.id), ['meant', 'nah']);
  });

  test('the tab counts only what needs you', () => {
    assert.equal(needsYouCount([sig(), sig({ severity: 'low' }), sig({ state: 'acknowledged' })]), 1);
    assert.equal(needsYouCount([]), 0);
  });

  test('newest first within a severity', () => {
    const g = groupSignals([sig({ id: 'old', lastSeen: NOW - 5000 }), sig({ id: 'new', lastSeen: NOW })]);
    assert.deepEqual(g.needsYou.map((s) => s.id), ['new', 'old']);
  });
});

describe('digestLine', () => {
  test('no parallel work says so, and says what would show here', () => {
    const d = digestLine([ws('/r', 'main', true)], []);
    assert.equal(d.headline, 'No parallel work right now');
    assert.match(d.detail, /worktrees, clones or branches/);
  });

  test('counts the workstreams the strip shows, and what needs you', () => {
    assert.equal(digestLine(ROOM, [sig(), sig({ severity: 'medium' }), sig({ severity: 'low', kind: 'stale-base' })]).headline,
      '2 workstreams active · 2 need you · 1 low-priority note');
    assert.equal(digestLine(ROOM, [sig()]).headline, '2 workstreams active · 1 needs you');
  });

  test('work with nothing unanswered is calm, and says what to do when something is not', () => {
    const calm = digestLine(ROOM, [sig({ state: 'intended' })]);
    assert.equal(calm.headline, '2 workstreams active · nothing needs you');
    assert.match(calm.detail, /New overlaps appear here/);
    assert.match(digestLine(ROOM, [sig()]).detail, /acknowledge it .* mark it intended .* dismiss it/);
  });
});

describe('a signal in words', () => {
  test('what kind of overlap', () => {
    assert.equal(kindWords(sig()), 'Same function');
    assert.equal(kindWords(sig({ subject: { file: 'a.ts' } })), 'Same file');
    assert.equal(kindWords(sig({ kind: 'stale-base', subject: { files: ['a.ts'] } })), 'Behind main');
    assert.equal(kindWords(sig({ kind: 'drift', subject: { files: ['config/shared.ts'] } })), 'Outside its scope', 'A2.5');
    assert.equal(kindWords(sig({ kind: 'contract', subject: { file: 'a.ts', symbol: 'f', change: 'signature' } })), 'Changed signature');
    assert.equal(kindWords(sig({ subject: { file: 'a.ts', symbol: 'f', intended: ['/r-auth'] } })), 'Same function · declared', 'A2.4');
    assert.equal(kindWords(sig({ subject: { file: 'a.ts', intended: ['/r-auth', '/r-billing'] } })), 'Same file · declared');
    assert.equal(kindWords(sig({ kind: 'contract', subject: { file: 'a.ts', symbol: 'f', change: 'removed' } })), 'Removed export');
  });

  test('a contract reads in its direction: who changed it, then whose work imports it (A2.3)', () => {
    const c = sig({ kind: 'contract', subject: { file: 'a.ts', symbol: 'f', by: '/r-billing', change: 'signature' } });
    assert.deepEqual(sidesOf(c, ROOM), ['billing-v2', 'auth-refresh']);
  });

  test('each side by the name the strip gives it; a branch by its name; an unknown folder by its last part', () => {
    assert.equal(sideLabel('/r-auth', ROOM), 'auth-refresh');
    assert.equal(sideLabel('branch:cloud-fix', ROOM), 'cloud-fix');
    assert.equal(sideLabel('/elsewhere/acme-2', ROOM), 'acme-2');
    assert.deepEqual(sidesOf(sig(), ROOM), ['auth-refresh', 'billing-v2']);
  });

  test('a stale base is one workstream against main', () => {
    assert.deepEqual(sidesOf(sig({ kind: 'stale-base', workstreams: ['/r-auth'] }), ROOM), ['auth-refresh', 'main']);
  });

  test('who answered: the person from the app window, or the local API, not claimed as the person', () => {
    const at = NOW - 120_000;
    assert.equal(stateWords(sig({ state: 'intended', stateAt: at, stateBy: { actor: 'saif', actorType: 'human', channel: 'desktop' } }), NOW),
      'Marked intended by you · 2 min ago');
    assert.equal(stateWords(sig({ state: 'dismissed', stateAt: at, stateBy: { actor: 'saif', actorType: 'unverified', channel: 'local-api' } }), NOW),
      'Dismissed by saif · 2 min ago', 'the name as given; the tag beside it says unverified');
    assert.equal(stateWords(sig(), NOW), null, 'open: nobody has answered');
  });

  test('ago', () => {
    assert.equal(ago(NOW - 10_000, NOW), 'just now');
    assert.equal(ago(NOW - 5 * 60_000, NOW), '5 min ago');
    assert.equal(ago(NOW - 3 * 3_600_000, NOW), '3 h ago');
  });
});

describe('actionsFor', () => {
  test('an open signal can be acknowledged, marked intended or dismissed', () => {
    assert.deepEqual(actionsFor('open').map((a) => a.state), ['acknowledged', 'intended', 'dismissed']);
  });
  test('an answer can always be taken back; a resolved signal offers nothing', () => {
    assert.deepEqual(actionsFor('acknowledged').map((a) => a.state), ['intended', 'dismissed', 'open']);
    assert.deepEqual(actionsFor('intended').map((a) => a.state), ['open']);
    assert.deepEqual(actionsFor('dismissed').map((a) => a.state), ['open']);
    assert.deepEqual(actionsFor('resolved'), []);
  });
  test('a contract can be intended: the change is meant and the importing side will follow (A2.3)', () => {
    const open = actionsFor('open', 'contract');
    assert.deepEqual(open.map((a) => a.state), ['acknowledged', 'intended', 'dismissed']);
    assert.match(open[1].hint, /side that imports it will follow/);
  });
  test('drift can be intended: the extra files are meant to be part of the work (A2.5)', () => {
    const open = actionsFor('open', 'drift');
    assert.deepEqual(open.map((a) => a.state), ['acknowledged', 'intended', 'dismissed']);
    assert.match(open[1].hint, /extra files are meant/);
  });
  test('drift names only its own workstream', () => {
    assert.deepEqual(sidesOf(sig({ kind: 'drift', workstreams: ['/r-billing'], subject: { files: ['x.ts'] } }), ROOM), ['billing-v2']);
  });
  test('a stale base has no second side, so it cannot be "intended"', () => {
    assert.deepEqual(actionsFor('open', 'stale-base').map((a) => a.state), ['acknowledged', 'dismissed']);
    assert.deepEqual(actionsFor('acknowledged', 'stale-base').map((a) => a.state), ['dismissed', 'open']);
  });
});
