/**
 * A signal's sides in plain words (Phase 32 A4.2): the same sentences on the
 * desktop and the phone, from git and the parser, never an agent's words.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { kindWords, sideRootsOf, sideWords } from './signal-words';
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
