/**
 * Phase 33 C7 — a check-run record: written once, read back the same, signed
 * over its body; anyone's text, so read with limits and never as another kind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRunBytes, outcomeWords, parseCheckRun, serializeCheckRun, type CheckRunRecord } from './check-run-record';

const RUN: CheckRunRecord = {
  writer: 'a1b2c3d4e5f60718', name: 'Build bot', counter: 3, at: Date.parse('2026-10-06T12:00:00Z'),
  by: { author: 'ci', authorType: 'mcp' }, ranIn: 'GitHub Actions',
  commit: 'f'.repeat(40), dirty: [], base: 'origin/main', rulebook: 'e'.repeat(40), scope: null, strict: false,
  outcome: { ok: false, files: 3, blocks: 1, warns: 1 },
  says: ['✗ packages/web/src/api.ts now imports npm:stripe, which the rule “only packages/web/src/payments.ts may import npm:stripe” forbids'],
  findings: [
    { rule: 'stripe-via-wrapper', suite: 'payments', path: 'packages/web/src/api.ts', imports: 'npm:stripe', strength: 'block', failing: true, words: 'only packages/web/src/payments.ts may import npm:stripe', fix: 'use packages/web/src/payments.ts instead' },
    { rule: 'charge-from-checkout', suite: 'payments', path: 'src/admin/refund.ts', imports: 'src/payments/charge.ts', strength: 'warn', failing: false, words: 'src/admin/ may not import src/payments/charge.ts', fix: null },
  ],
};

test('a run reads back exactly as written, and its signed bytes are its body', () => {
  const text = serializeCheckRun(RUN);
  assert.match(text, /^# CodeTrellis: one device's latest check run/);
  const parsed = parseCheckRun(text);
  assert.ok('record' in parsed);
  assert.deepEqual(parsed.record, RUN);
  assert.equal(parsed.signed.bytes, checkRunBytes(RUN));
});

test('anyone\'s text: another kind, a bad writer, a path outside the project, and too much are refused or dropped', () => {
  assert.deepEqual(parseCheckRun(serializeCheckRun(RUN).replace('kind: check-run', 'kind: test-run')), { error: 'not a check-run record' });
  assert.deepEqual(parseCheckRun(serializeCheckRun({ ...RUN, writer: 'NOT-HEX' })), { error: 'no writer' });
  const outside = parseCheckRun(serializeCheckRun({ ...RUN, findings: [{ ...RUN.findings[0], path: '../../etc/passwd' }], dirty: ['/abs', 'ok.ts'] }));
  assert.ok('record' in outside);
  assert.deepEqual(outside.record.findings, []);
  assert.deepEqual(outside.record.dirty, ['ok.ts']);
  assert.deepEqual(parseCheckRun('x'.repeat(600 * 1024)), { error: 'larger than a check-run record can be' });
  const many = parseCheckRun(serializeCheckRun({ ...RUN, says: Array.from({ length: 300 }, (_, i) => `line ${i}`) }));
  assert.ok('record' in many && many.record.says.length === 200);
});

test('an outcome in a few words', () => {
  assert.equal(outcomeWords({ ok: true, files: 2, blocks: 0, warns: 0 }), '✓ conforms');
  assert.equal(outcomeWords({ ok: true, files: 2, blocks: 0, warns: 1 }), '✓ conforms · ⚠ 1 warns');
  assert.equal(outcomeWords({ ok: false, files: 2, blocks: 2, warns: 1 }), '✗ 2 block · ⚠ 1 warns');
});
