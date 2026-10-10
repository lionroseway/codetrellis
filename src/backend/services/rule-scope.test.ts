import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import { parseScope, scopeRules, scopeWords } from './rule-scope';

const rule = (id: string, from: string, suite?: string): ArchitectureRule => ({
  id, from, mayNotImport: 'db/', except: [], because: '', since: '2026-10-06T00:00:00.000Z', by: 'Sam', strength: 'block', ...(suite ? { suite } : {}),
});
const book = [
  rule('stripe-via-wrapper', 'src/', 'payments'),
  rule('payments-not-ui', 'src/payments/', 'payments'),
  rule('web-not-db', 'web/', 'architecture'),
  rule('old-one', 'lib/**/legacy/**'),
];
const ids = (scope: ReturnType<typeof parseScope>) => scopeRules(book, scope).map((r) => r.id);

test('each scope selects exactly its rules', () => {
  assert.deepEqual(ids(parseScope({ suite: 'payments' })), ['stripe-via-wrapper', 'payments-not-ui']);
  assert.deepEqual(ids(parseScope({ rule: 'web-not-db,old-one' })), ['web-not-db', 'old-one']);
  // A path inside a rule's from, or a folder holding it.
  assert.deepEqual(ids(parseScope({ path: 'src/payments/charge.ts' })), ['stripe-via-wrapper', 'payments-not-ui']);
  assert.deepEqual(ids(parseScope({ path: 'src' })), ['stripe-via-wrapper', 'payments-not-ui']);
  assert.deepEqual(ids(parseScope({ path: 'lib/a/legacy/x.ts' })), ['old-one']);
  assert.deepEqual(ids(parseScope({ path: './web/' })), ['web-not-db']);
});

test('scopes given together all apply; a rule in no suite is never in one', () => {
  assert.deepEqual(ids(parseScope({ suite: 'payments', path: 'src/payments/' })), ['stripe-via-wrapper', 'payments-not-ui']);
  assert.deepEqual(ids(parseScope({ suite: 'payments', rule: 'web-not-db' })), []);
  assert.deepEqual(ids(parseScope({ suite: 'architecture,payments', rule: 'old-one' })), []);
});

test('nothing given is no scope: every rule, and the words say so', () => {
  assert.equal(parseScope({ suite: '', rule: ' , ' }), null);
  assert.deepEqual(ids(null), book.map((r) => r.id));
  assert.equal(scopeWords(null), 'every rule');
  assert.equal(scopeWords(parseScope({ suite: 'payments', path: 'src/,lib/' })), 'suite payments; rules about src/, lib/');
});
