import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJUnit, testLabel, MAX_CASES } from './junit';

const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="vitest" tests="5" failures="1" errors="1">
  <testsuite name="src/billing/invoice.test.ts" tests="3">
    <testcase classname="src/billing/invoice.test.ts" name="totals a basket" time="0.012" file="src/billing/invoice.test.ts"/>
    <testcase classname="src/billing/invoice.test.ts" name="rounds half up" time="0.004">
      <failure message="expected 10.5 to be 11 &amp; more" type="AssertionError">AssertionError: expected 10.5 to be 11
    at invoice.test.ts:22</failure>
    </testcase>
    <testcase classname="src/billing/invoice.test.ts" name="applies a discount"><skipped/></testcase>
  </testsuite>
  <testsuite name="src/billing/tax.test.ts">
    <testcase classname="TaxTest" name="vat at 20%" time="1.5"><error><![CDATA[TypeError: rate is undefined
  stack]]></error></testcase>
    <testcase classname="TaxTest" name="zero rated"></testcase>
  </testsuite>
</testsuites>`;

test('each test case, with its suite, result, time and the first line of why it failed', () => {
  const r = parseJUnit(REPORT)!;
  assert.deepEqual(r.totals, { tests: 5, passed: 2, failed: 1, errors: 1, skipped: 1 });
  assert.equal(r.truncated, false);
  assert.deepEqual(r.cases[0], { suite: 'src/billing/invoice.test.ts', classname: 'src/billing/invoice.test.ts', name: 'totals a basket', file: 'src/billing/invoice.test.ts', result: 'passed', durationMs: 12, message: null });
  assert.deepEqual(r.cases[1].message, 'expected 10.5 to be 11 & more');
  assert.equal(r.cases[1].result, 'failed');
  assert.equal(r.cases[2].result, 'skipped');
  assert.deepEqual({ ...r.cases[3] }, { suite: 'src/billing/tax.test.ts', classname: 'TaxTest', name: 'vat at 20%', file: null, result: 'error', durationMs: 1500, message: 'TypeError: rate is undefined' });
  assert.equal(r.cases[4].result, 'passed');
});

test('not a test report: null, never a guess', () => {
  assert.equal(parseJUnit('<html><body>hi</body></html>'), null);
  assert.equal(parseJUnit('{"tests": 3}'), null);
});

test('an empty run is a report with no tests, which a check can refuse', () => {
  assert.deepEqual(parseJUnit('<testsuites tests="0"></testsuites>')?.totals, { tests: 0, passed: 0, failed: 0, errors: 0, skipped: 0 });
});

test('a bare testsuite, single-quoted attributes, and a case with no name skipped', () => {
  const r = parseJUnit(`<testsuite name='unit'><testcase classname='a' name='works'/><testcase classname='b'/></testsuite>`)!;
  assert.deepEqual(r.cases.map((c) => [c.suite, c.name]), [['unit', 'works']]);
});

test('a huge report is read only so far, and says so', () => {
  const big = `<testsuite name="s">${'<testcase name="t"/>'.repeat(MAX_CASES + 5)}</testsuite>`;
  const r = parseJUnit(big)!;
  assert.equal(r.cases.length, MAX_CASES);
  assert.equal(r.truncated, true);
});

test('names read as a person reads them', () => {
  assert.equal(testLabel({ classname: 'InvoiceTest', name: 'rounds half up' }), 'InvoiceTest › rounds half up');
  assert.equal(testLabel({ classname: null, name: 'works' }), 'works');
});
