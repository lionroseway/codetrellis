/**
 * Unit tests for near-miss detection (Phase 29).
 *
 * `findNearMisses` is pure and takes its inputs as arguments precisely
 * so it can be tested without a database — the rule is the risky part,
 * not the SQL around it.
 *
 * The risk it carries is specific: `cross-system-service` deliberately
 * has no fuzzy matching, because a wrong edge on an architecture diagram
 * is worse than a missing one. This function exists next to that
 * decision without undermining it, which only holds while the rule stays
 * strict. Every test below is a case it must REFUSE.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findNearMisses } from './coverage-service';

const call = (method: string, pattern: string) =>
  ({ method, pattern, file: 'client.ts', line: 10 });
const route = (method: string, pattern: string) =>
  ({ method, pattern, file: 'server.py', line: 20 });

describe('findNearMisses — what it accepts', () => {
  test('a concrete value against a route parameter', () => {
    // The commonest reason a real pairing fails: 42 is a value, :id is
    // a pattern, they cannot be equal, and they are obviously the same
    // endpoint.
    const found = findNearMisses([call('GET', '/api/ledger/42')], [route('GET', '/api/ledger/:id')]);
    assert.equal(found.length, 1);
    assert.equal(found[0].callPattern, '/api/ledger/42');
    assert.equal(found[0].routePattern, '/api/ledger/:id');
    assert.deepEqual(found[0].differingSegment, { position: 3, inCall: '42', inRoute: ':id' });
  });

  test('a parameter in the middle of a longer path', () => {
    const found = findNearMisses(
      [call('DELETE', '/api/orders/99/lines')],
      [route('DELETE', '/api/orders/:id/lines')],
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].differingSegment.inCall, '99');
  });

  test('it carries enough detail to show the reader both sides', () => {
    const [miss] = findNearMisses([call('GET', '/a/1')], [route('GET', '/a/:id')]);
    assert.equal(miss.callFile, 'client.ts');
    assert.equal(miss.routeFile, 'server.py');
    assert.equal(miss.callLine, 10);
    assert.equal(miss.routeLine, 20);
  });
});

describe('findNearMisses — what it must refuse', () => {
  test('a different method is a different endpoint', () => {
    assert.deepEqual(findNearMisses([call('GET', '/api/ledger/42')], [route('POST', '/api/ledger/:id')]), []);
  });

  test('a different segment count is a different endpoint', () => {
    assert.deepEqual(findNearMisses([call('GET', '/api/ledger/42/lines')], [route('GET', '/api/ledger/:id')]), []);
  });

  test('two differing segments is a guess, not a near miss', () => {
    // `/api/a/1` vs `/api/b/:id` differ in the literal too. Suggesting
    // it would have the reader checking our work, which is worth less
    // than suggesting nothing.
    assert.deepEqual(findNearMisses([call('GET', '/api/a/1')], [route('GET', '/api/b/:id')]), []);
  });

  test('a literal difference with no parameter involved is refused', () => {
    assert.deepEqual(findNearMisses([call('GET', '/api/orders')], [route('GET', '/api/users')]), []);
  });

  test('a parameter on the CALL side is not the same shape', () => {
    // A call written `/api/ledger/:id` against a route serving a literal
    // `/api/ledger/current` is not the same endpoint, and the asymmetry
    // is deliberate.
    assert.deepEqual(
      findNearMisses([call('GET', '/api/ledger/:id')], [route('GET', '/api/ledger/current')]),
      [],
    );
  });

  test('an empty segment does not count as a value', () => {
    assert.deepEqual(findNearMisses([call('GET', '/api/ledger/')], [route('GET', '/api/ledger/:id')]), []);
  });

  test('nothing in, nothing out', () => {
    assert.deepEqual(findNearMisses([], [route('GET', '/a/:id')]), []);
    assert.deepEqual(findNearMisses([call('GET', '/a/1')], []), []);
  });
});

describe('findNearMisses — bounds', () => {
  test('the result is capped so a monorepo cannot flood the panel', () => {
    const calls = Array.from({ length: 200 }, (_, i) => call('GET', `/api/x/${i}`));
    const routes = [route('GET', '/api/x/:id')];
    assert.equal(findNearMisses(calls, routes).length, 25);
  });
});
