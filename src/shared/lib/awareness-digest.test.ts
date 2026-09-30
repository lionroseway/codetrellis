/**
 * The digest (Phase 32 A3.1): few lines, grouped, capped, in words a person
 * takes in at a glance, and the same words for an agent.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, digestText, DIGEST_MAX_LINES } from './awareness-digest';
import type { AwarenessSignal } from '../types';

const NAMES: Record<string, string> = { '/r/auth': 'auth-refresh', '/r/billing': 'billing-v2', '/r/checkout': 'checkout-fix', '/r/docs': 'docs' };
const label = (root: string) => NAMES[root] ?? root;

let n = 0;
const sig = (over: Partial<AwarenessSignal>): AwarenessSignal => ({
  id: `s${n++}`, kind: 'collision', severity: 'high', subject: { file: 'src/session.ts', symbol: 'refreshToken' },
  workstreams: ['/r/auth', '/r/billing'], summary: '', firstSeen: 1000, lastSeen: 2000, state: 'open', ...over,
});

describe('what is listed', () => {
  test('only open high and medium: answered ones are seen, low ones counted, resolved ones gone', () => {
    const d = buildDigest([
      sig({}),
      sig({ state: 'acknowledged' }),
      sig({ state: 'intended' }),
      sig({ state: 'resolved' }),
      sig({ kind: 'stale-base', severity: 'low', workstreams: ['/r/auth'], subject: { files: ['a.ts'] } }),
    ], label);
    assert.equal(d.needsYou, 1);
    assert.equal(d.lines.length, 1);
    assert.equal(d.low, 1);
  });

  test('two worktrees overlapping in four places is one line, not four', () => {
    const d = buildDigest([
      sig({ subject: { file: 'src/session.ts', symbol: 'refreshToken' } }),
      sig({ subject: { file: 'src/session.ts', symbol: 'renew' } }),
      sig({ severity: 'medium', subject: { file: 'src/billing/invoice.ts' } }),
      sig({ severity: 'medium', subject: { file: 'README.md' } }),
    ], label);
    assert.equal(d.lines.length, 1);
    assert.equal(d.lines[0].text, '`auth-refresh` and `billing-v2` both change 4 things: src/session.ts → refreshToken, src/session.ts → renew and 2 more');
    assert.equal(d.lines[0].signalIds.length, 4);
    assert.equal(d.lines[0].severity, 'high');
  });

  test('past the cap, "and N more", most severe and newest first', () => {
    const pairs = [['/r/auth', '/r/billing'], ['/r/auth', '/r/checkout'], ['/r/billing', '/r/checkout'], ['/r/auth', '/r/docs'], ['/r/billing', '/r/docs'], ['/r/checkout', '/r/docs'], ['/r/a', '/r/b']];
    const d = buildDigest(pairs.map((w, i) => sig({ workstreams: w, severity: i === 6 ? 'high' : 'medium', lastSeen: 1000 + i })), label);
    assert.equal(d.lines.length, DIGEST_MAX_LINES);
    assert.equal(d.moreLines, pairs.length - DIGEST_MAX_LINES);
    assert.equal(d.lines[0].severity, 'high', 'the one high comes first');
    assert.match(d.lines[1].text, /checkout-fix` and `docs/, 'then the newest medium');
  });
});

describe('the words', () => {
  test('a contract: who changed what, who imports it, and the choice waiting on the person', () => {
    const [line] = buildDigest([sig({
      kind: 'contract', workstreams: ['/r/billing', '/r/checkout'],
      subject: { file: 'src/billing.ts', symbol: 'createInvoice', by: '/r/billing', change: 'signature', importers: ['a.ts'] },
      told: [{ sessionId: 'x', agentType: 'codex', toldAt: 5 }],
    })], label).lines;
    assert.equal(line.text, "`billing-v2` changed createInvoice's signature; `checkout-fix` imports it");
    assert.equal(line.told, true);
    assert.equal(line.question, 'keep the old signature, or update the callers?');
  });

  test('several contracts from one side are one line; a removal says so', () => {
    const c = (symbol: string, change: 'signature' | 'removed' = 'signature') => sig({
      kind: 'contract', workstreams: ['/r/billing', '/r/checkout'], subject: { file: 'b.ts', symbol, by: '/r/billing', change },
    });
    assert.equal(buildDigest([c('a'), c('b'), c('c')], label).lines[0].text, '`billing-v2` changed 3 exported names `checkout-fix` imports: a, b and 1 more');
    assert.equal(buildDigest([c('gone', 'removed')], label).lines[0].text, '`billing-v2` removed gone; `checkout-fix` imports it');
  });

  test('drift and a declared collision read plainly', () => {
    const d = buildDigest([
      sig({ kind: 'drift', severity: 'medium', workstreams: ['/r/billing'], subject: { files: ['config/shared.ts', 'x.ts', 'y.ts'] } }),
      sig({ subject: { file: 'src/session.ts', symbol: 'refreshToken', intended: ['/r/auth'] } }),
    ], label);
    assert.deepEqual(d.lines.map((l) => l.text), [
      '`auth-refresh` and `billing-v2` both change src/session.ts → refreshToken (declared, not yet edited)',
      '`billing-v2` changes 3 files outside its scope: config/shared.ts, x.ts and 1 more',
    ]);
    assert.equal(d.lines[0].told, false, 'nobody was told');
  });

  test('new since the person last looked', () => {
    const d = buildDigest([sig({ firstSeen: 100 }), sig({ firstSeen: 900, workstreams: ['/r/auth', '/r/checkout'] })], label, { since: 500 });
    assert.equal(d.newSince, 1);
    assert.equal(buildDigest([sig({})], label).newSince, null);
  });
});

describe('for an agent', () => {
  test('one paragraph with every line, the question, and the rest counted', () => {
    const d = buildDigest([
      sig({ told: [{ sessionId: 'x', agentType: 'codex', toldAt: 5 }] }),
      sig({ kind: 'stale-base', severity: 'low', workstreams: ['/r/auth'], subject: { files: ['a.ts'] } }),
    ], label);
    assert.equal(digestText(d),
      '1 signal needs attention. `auth-refresh` and `billing-v2` both change src/session.ts → refreshToken. Agents told. ' +
      'Waiting on the person: who goes first, or is it intended? 1 low-priority note.');
  });

  test('calm', () => {
    assert.equal(digestText(buildDigest([], label)), 'Nothing overlaps with other work right now.');
  });
});

describe('tasks\' materials (A6.3)', () => {
  test('one line per material, in the signal\'s own words, with a question that fits', () => {
    const material = (id: string, kind: AwarenessSignal['kind'], file: string, summary: string) => sig({
      id, kind, severity: 'medium', workstreams: ['task:a', 'task:b'], summary,
      subject: { material: file, labels: { 'task:a': 'Q3 report', 'task:b': 'Board pack' } },
    });
    const d = buildDigest([
      material('m1', 'contract', 'sales.xlsx', '`sales.xlsx` changed. 2 tasks cite Summary!B2:F9'),
      material('m2', 'contract', 'costs.xlsx', '`costs.xlsx` changed. “Q3 report” cites A1:C4. “Board pack” uses it too'),
      material('m3', 'version-split', 'fx.csv', '“Board pack”, “Q3 report” read different versions of `fx.csv`; “Board pack” has the current one'),
    ], label);
    // Same kind and same two tasks, different materials: still a line each.
    assert.equal(d.lines.length, 3);
    assert.deepEqual(d.lines.map((l) => l.text).sort(), [
      '`costs.xlsx` changed. “Q3 report” cites A1:C4. “Board pack” uses it too',
      '`sales.xlsx` changed. 2 tasks cite Summary!B2:F9',
      '“Board pack”, “Q3 report” read different versions of `fx.csv`; “Board pack” has the current one',
    ]);
    assert.equal(d.lines.find((l) => l.signalIds[0] === 'm1')!.question, 'check the cited parts again, or keep the old version?');
    assert.equal(d.lines.find((l) => l.signalIds[0] === 'm3')!.question, 'which version should both use?');
  });
});
