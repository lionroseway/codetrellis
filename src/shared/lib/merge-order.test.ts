/**
 * The review queue's merge order (Phase 32 A5.4): what changes something
 * another line imports goes first, with the reason on both sides; ready lines
 * come first among the free; a cycle is broken and said to be one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOrder } from './merge-order';

const line = (key: string, ready = false) => ({ key, name: key, ready });

test('the line that changes what another imports goes first, and both are told why', () => {
  const got = mergeOrder([line('checkout-fix', true), line('billing-v2')], [{ first: 'billing-v2', then: 'checkout-fix', symbol: 'validateCreateUser' }]);
  assert.deepEqual(got.map((l) => l.key), ['billing-v2', 'checkout-fix']);
  assert.equal(got[0].reason, 'Before checkout-fix: it imports validateCreateUser, which this changes, and will need updating after.');
  assert.equal(got[1].reason, 'After billing-v2: it changes validateCreateUser, which this imports, so update to it first.');
});

test('with nothing between them, ready lines come first, then by name', () => {
  const got = mergeOrder([line('zeta'), line('alpha'), line('beta', true)], []);
  assert.deepEqual(got.map((l) => [l.key, l.position]), [['beta', 1], ['alpha', 2], ['zeta', 3]]);
  assert.equal(got[0].reason, 'No other line of work depends on this one.');
});

test('a cycle is broken at the best-ranked line, and said to be one; what follows it keeps its own reason', () => {
  const got = mergeOrder([line('a', true), line('b'), line('c')], [
    { first: 'a', then: 'b', symbol: 'x' },
    { first: 'b', then: 'a', symbol: 'y' },
    { first: 'b', then: 'c', symbol: 'z' },
  ]);
  assert.deepEqual(got.map((l) => l.key), ['a', 'b', 'c']);
  assert.equal(got[0].reason, 'a and b each change something the other imports: merge a first, then update b to it.');
  assert.match(got[2].reason, /^After b: it changes z, which this imports/);
});

test('several importers and symbols are listed once each', () => {
  const got = mergeOrder([line('billing-v2'), line('checkout-fix'), line('auth-refresh')], [
    { first: 'billing-v2', then: 'checkout-fix', symbol: 'createInvoice' },
    { first: 'billing-v2', then: 'auth-refresh', symbol: 'createInvoice' },
    { first: 'billing-v2', then: 'checkout-fix', symbol: 'Invoice' },
  ]);
  assert.equal(got[0].key, 'billing-v2');
  assert.equal(got[0].reason, 'Before checkout-fix and auth-refresh: they import createInvoice and Invoice, which this changes, and will need updating after.');
});

test('a dependency on a line not in the queue is ignored', () => {
  const got = mergeOrder([line('checkout-fix')], [{ first: 'billing-v2', then: 'checkout-fix', symbol: 'x' }]);
  assert.equal(got[0].reason, 'No other line of work depends on this one.');
});
