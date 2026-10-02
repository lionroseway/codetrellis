import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundingWords, testFileOf } from './grounding';

const T = (result: string) => ({ result: result as 'passed' });

test('a file\'s tests in words: failing first, then stale, passing, none', () => {
  assert.deepEqual(groundingWords([], null, 5), { state: 'untested', words: '○ no tests: no test with a reported result imports it' });
  assert.deepEqual(groundingWords([T('passed'), T('failed'), T('error')], 1000, 900), { state: 'failing', words: '✗ 2 of 3 tests failing' });
  assert.deepEqual(groundingWords([T('passed'), T('failed')], 1000, 9000), { state: 'failing', words: '✗ 1 of 2 tests failing, and it changed after they ran' });
  assert.deepEqual(groundingWords([T('passed'), T('passed')], 1000, 9000), { state: 'stale', words: '⚠ tests older than the code: it changed after its 2 tests last ran' });
  assert.deepEqual(groundingWords([T('passed'), T('skipped')], 1000, 900), { state: 'passing', words: '✓ 1 test passing' });
  assert.deepEqual(groundingWords([T('skipped')], 1000, 900), { state: 'untested', words: '○ 1 test, all skipped' });
});

test('a change within a moment of the run is the same moment', () => {
  assert.equal(groundingWords([T('passed')], 10_000, 11_500).state, 'passing');
});

test('a result\'s test file, from the file attribute, else a path-like class or suite; never outside the project', () => {
  assert.equal(testFileOf('/w/app', { file: 'src/billing/invoice.test.ts', classname: 'InvoiceTest', suite: null }), 'src/billing/invoice.test.ts');
  assert.equal(testFileOf('/w/app', { file: null, classname: 'tests/test_tax.py', suite: null }), 'tests/test_tax.py');
  assert.equal(testFileOf('/w/app', { file: null, classname: 'TaxTest', suite: 'src/tax.test.ts' }), 'src/tax.test.ts');
  assert.equal(testFileOf('/w/app', { file: '/w/app/src/a.test.ts', classname: null, suite: null }), 'src/a.test.ts');
  assert.equal(testFileOf('/w/app', { file: '../other/a.test.ts', classname: null, suite: null }), null);
  assert.equal(testFileOf('/w/app', { file: null, classname: 'TaxTest', suite: 'unit' }), null);
});
