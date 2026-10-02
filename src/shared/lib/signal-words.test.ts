/**
 * A signal's sides in plain words (Phase 32 A4.2): the same sentences on the
 * desktop and the phone, from git and the parser, never an agent's words.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { briefLine, kindWords, sideRootsOf, sideWords } from './signal-words';
import type { AwarenessSignal } from '../types';

const label = (root: string) => ({ '/w/auth': 'auth-refresh', '/w/billing': 'billing-v2', '/w/checkout': 'checkout-fix' } as Record<string, string>)[root] ?? root;
const sig = (over: Partial<AwarenessSignal>): Pick<AwarenessSignal, 'kind' | 'workstreams' | 'subject'> => ({
  kind: 'collision', workstreams: ['/w/auth', '/w/billing'], subject: {}, ...over,
});

describe('each side, in words', () => {
  test('a collision: what each side changes, and a side that has only declared it', () => {
    assert.deepEqual(sideWords(sig({ subject: { file: 'src/auth/session.ts', symbol: 'refreshToken', intended: ['/w/billing'] } }), label).map((s) => s.words), [
      'auth-refresh changes refreshToken in src/auth/session.ts.',
      'billing-v2 has said it will change refreshToken in src/auth/session.ts.',
    ]);
  });

  test('a contract runs one way: the change first, then who imports it', () => {
    const s = sig({
      kind: 'contract', workstreams: ['/w/billing', '/w/checkout'],
      subject: { file: 'src/billing/invoice.ts', symbol: 'createInvoice', by: '/w/checkout', change: 'signature', signature: { before: '(o)', after: '(o, c)' }, importers: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] },
    });
    assert.deepEqual(sideRootsOf(s), ['/w/checkout', '/w/billing']);
    assert.deepEqual(sideWords(s, label), [
      { root: '/w/checkout', name: 'checkout-fix', words: "checkout-fix changed createInvoice's signature in src/billing/invoice.ts: createInvoice(o) is now createInvoice(o, c)." },
      { root: '/w/billing', name: 'billing-v2', words: 'billing-v2 imports it, in 4 files: a.ts, b.ts, c.ts and more.' },
    ]);
  });

  test('a removed export, and an importer that only possibly uses it', () => {
    const s = sig({ kind: 'contract', subject: { file: 'x.go', symbol: 'Post', by: '/w/auth', change: 'removed', possibly: true } });
    assert.deepEqual(sideWords(s, label).map((x) => x.words), ['auth-refresh removed Post from x.go.', 'billing-v2 possibly imports it.']);
    assert.equal(kindWords(s), 'Removed export');
  });

  test('drift and a stale base name the one side and what it is about', () => {
    assert.deepEqual(sideWords(sig({ kind: 'drift', workstreams: ['/w/auth'], subject: { files: ['a.ts'] } }), label).map((x) => x.words),
      ['auth-refresh changes 1 file outside the task it claimed: a.ts.']);
    assert.deepEqual(sideWords(sig({ kind: 'stale-base', workstreams: ['/w/billing'], subject: { files: ['src/b.ts'] } }), label).map((x) => x.words),
      ['main changed src/b.ts since billing-v2 branched, and billing-v2 changes it too.']);
  });
});

describe('a task set two ways at once (C3.2)', () => {
  const split = (said: NonNullable<AwarenessSignal['subject']['said']>) => sig({
    kind: 'state-split', workstreams: ['task:t1'], subject: { items: ['t1'], labels: { 'task:t1': 'Check the figures' }, said },
  });

  test('one side per person, each with what they set, on the one task', () => {
    const s = split([{ name: 'Sam Lee', status: 'in_progress' }, { name: 'Dana Ortiz', status: 'blocked' }]);
    assert.equal(kindWords(s), 'Set two ways at once');
    assert.deepEqual(sideWords(s, label), [
      { root: 'task:t1', name: 'Sam Lee', words: 'Sam Lee set “Check the figures” to in progress, without having seen the other change.' },
      { root: 'task:t1', name: 'Dana Ortiz', words: 'Dana Ortiz set “Check the figures” to blocked, without having seen the other change.' },
    ]);
    assert.equal(briefLine(s, 'task:t1'), 'Sam Lee set this task to in progress; Dana Ortiz set this task to blocked, at once.');
  });

  test('two records claiming to be one change by the same person say so', () => {
    const s = split([{ name: 'Sam Lee', status: 'done', forged: true }, { name: 'Sam Lee', status: 'skipped', forged: true }]);
    assert.equal(kindWords(s), "A record in someone else's name");
    assert.match(sideWords(s, label)[1].words, /^A record claiming to be Sam Lee's sets “Check the figures” to skipped; another record claims to be the same change\.$/);
  });
});

describe('a rule (A7.2)', () => {
  test('one side: what it imports across which rule, and why', () => {
    const s = sig({
      kind: 'rule', workstreams: ['/w/billing'],
      subject: {
        files: ['web/reports.ts'],
        rule: { id: 'web-not-db', words: 'web/ may not import db/', because: 'web talks to db through the API' },
        edges: [{ from: 'web/reports.ts', to: 'db/client.ts' }],
      },
    });
    assert.equal(kindWords(s), 'Breaks a rule');
    assert.deepEqual(sideWords(s, label).map((x) => x.words), [
      'billing-v2 adds 1 import the rule “web/ may not import db/” forbids (web talks to db through the API): web/reports.ts → db/client.ts.',
    ]);
  });
});
