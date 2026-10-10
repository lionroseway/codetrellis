/**
 * Phase 33 V6 — one line per linked task item: the files it planned against
 * the ones touched, and where its criteria stand, with a mark a reviewer
 * reads first: ✓ done, ◐ part done, ✗ untouched or sent back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWords } from './review-task';

const base = { planUid: 'p', planTitle: 'Q4', uid: 'i', title: 'Checkout page' };

test('every planned file touched and every criterion met reads as done', () => {
  assert.equal(
    itemWords({ ...base, verdict: 'landed', landed: ['a.ts', 'b.ts'], missing: [], criteria: [{ text: 'x', state: 'met' }] }),
    '✓ Checkout page: touched every file it planned (2); 1 of 1 criterion met.',
  );
});

test('part done names what is missing and the criteria waiting or stale', () => {
  assert.equal(
    itemWords({ ...base, verdict: 'partial', landed: ['a.ts'], missing: ['b.ts'], criteria: [{ text: 'x', state: 'met' }, { text: 'y', state: 'submitted' }, { text: 'z', state: 'stale' }] }),
    '◐ Checkout page: touched 1 of the 2 files it planned; not b.ts; 1 of 3 criteria met (1 waiting for a person, 1 stale).',
  );
  // All files touched but a criterion open is not done.
  assert.match(itemWords({ ...base, verdict: 'landed', landed: ['a.ts'], missing: [], criteria: [{ text: 'x', state: 'open' }] }), /^◐ /);
});

test('untouched, or a criterion sent back, is marked ✗', () => {
  assert.equal(
    itemWords({ ...base, verdict: 'untouched', landed: [], missing: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'], criteria: [] }),
    '✗ Checkout page: touched none of the 6 files it planned: a.ts, b.ts, c.ts, d.ts, e.ts and 1 more; no criteria.',
  );
  assert.match(itemWords({ ...base, verdict: 'landed', landed: ['a.ts'], missing: [], criteria: [{ text: 'x', state: 'sent_back' }] }), /^✗ .*\(1 sent back\)\.$/);
});

test('an item that planned no files says so', () => {
  assert.equal(itemWords({ ...base, verdict: 'no-targets', landed: [], missing: [], criteria: [] }), '◐ Checkout page: planned no files; no criteria.');
});
