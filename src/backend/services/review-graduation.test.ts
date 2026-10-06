/**
 * Phase 33 C6 — graduation, its pure parts: the folder findings share, and a
 * guide alone as a rule at guide strength.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedFolder } from './review-graduation';
import { parseArchitectureRule, ruleStatement } from './architecture-rule';

test('the folder findings share', () => {
  assert.equal(sharedFolder(['src/payments/charge.ts', 'src/payments/refund/index.ts']), 'src/payments/');
  assert.equal(sharedFolder(['src/api.ts', 'src/api.ts']), 'src/');
  assert.equal(sharedFolder(['src/a.ts', 'lib/b.ts']), './');
  assert.equal(sharedFolder(['README.md']), './');
});

test('a guide alone is a rule at guide strength, and only there', () => {
  const guide = parseArchitectureRule({ id: 'charge-idempotently', kind: 'folder', folder: 'src/payments/', strength: 'guide', guide: 'Every charge carries an idempotency key.' });
  assert.deepEqual(guide.problems, []);
  assert.equal(ruleStatement(guide.rule!), 'files in src/payments/ follow its guide');
  const warn = parseArchitectureRule({ id: 'charge-idempotently', kind: 'folder', folder: 'src/payments/', strength: 'warn', guide: 'Every charge carries an idempotency key.' });
  assert.match(warn.problems.join(' '), /files, kinds or exports/);
});
