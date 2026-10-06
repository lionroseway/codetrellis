/**
 * Phase 33 R7 — a call out of the code as a call rule names it, and the calls
 * that match it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callEntry, callMatches, callProblem, callWords, isCallEntry, normaliseCall } from './call-entry';
import { hostOf } from '../../backend/services/callsites/shared';

test('a callsite as an entry: an HTTP call with its host and path, a path alone, a SQL table', () => {
  assert.equal(callEntry({ kind: 'http_call', urlPattern: '/v1/charges', host: 'api.stripe.com' }), 'http:api.stripe.com/v1/charges');
  assert.equal(callEntry({ kind: 'http_call', urlPattern: '/', host: 'api.stripe.com' }), 'http:api.stripe.com');
  assert.equal(callEntry({ kind: 'http_call', urlPattern: '/api/users/:id' }), 'http:/api/users/:id');
  assert.equal(callEntry({ kind: 'sql_query', urlPattern: 'Payments' }), 'sql:payments');
  assert.equal(callEntry({ kind: 'http_route', urlPattern: '/api/users' }), null);
  assert.equal(isCallEntry('http:api.stripe.com'), true);
  assert.equal(isCallEntry('npm:stripe'), false);
  assert.equal(hostOf('https://API.Stripe.com/v1/charges?x=1'), 'api.stripe.com');
  assert.equal(hostOf('http://billing:8080/ledger'), 'billing');
  assert.equal(hostOf('/api/users'), undefined);
});

test('what a rule may name, kept lowercase without a trailing slash; and why not', () => {
  assert.equal(callProblem('http:api.stripe.com'), null);
  assert.equal(callProblem('http:api.stripe.com/v1/charges'), null);
  assert.equal(callProblem('http:/api/admin'), null);
  assert.equal(callProblem('sql:payments'), null);
  assert.match(callProblem('stripe') ?? '', /http: and a host/);
  assert.match(callProblem('http:not a host') ?? '', /a host, a path, or both/);
  assert.match(callProblem('sql:drop table') ?? '', /a table name/);
  assert.equal(normaliseCall('http:API.Stripe.com/v1/'), 'http:api.stripe.com/v1');
  assert.equal(normaliseCall('sql:Payments'), 'sql:payments');
});

test('a call matches the rule by host and path prefix, by path on any host, or by table', () => {
  assert.equal(callMatches('http:api.stripe.com', 'http:api.stripe.com/v1/charges'), true);
  assert.equal(callMatches('http:api.stripe.com/v1/charges', 'http:api.stripe.com/v1/charges/:id'), true);
  assert.equal(callMatches('http:api.stripe.com/v1/charges', 'http:api.stripe.com/v1/refunds'), false);
  assert.equal(callMatches('http:api.stripe.com', 'http:files.stripe.com/v1/files'), false);
  assert.equal(callMatches('http:/api/admin', 'http:/api/admin/users'), true);
  assert.equal(callMatches('http:/api/admin', 'http:internal.acme/api/admin'), true);
  assert.equal(callMatches('http:/api/admin', 'http:/api/administrators'), false);
  assert.equal(callMatches('sql:payments', 'sql:payments'), true);
  assert.equal(callMatches('sql:payments', 'sql:payment_methods'), false);
  assert.equal(callMatches('sql:payments', 'http:/payments'), false);
  assert.equal(callWords('sql:payments'), 'the table payments');
  assert.equal(callWords('http:api.stripe.com'), 'api.stripe.com');
});
