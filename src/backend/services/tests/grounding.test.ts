import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groundingWords, testFileOf } from './grounding';
import { setActiveProjectRoot } from '../trusted-roots';

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

test('a project opened through a link: a runner\'s realpath still names a file in it', () => {
  // macOS's /var and /tmp are links. The runner writes the realpath; the
  // project is stored under the path it was opened at. A plain relative
  // between the two was "../../private/…", and every file read "no tests".
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-grounding-')));
  const link = `${real}-link`;
  fs.symlinkSync(real, link, 'dir');
  try {
    setActiveProjectRoot(link);
    assert.equal(testFileOf(link, { file: path.join(real, 'src', 'a.test.ts'), classname: null, suite: null }), 'src/a.test.ts');
    assert.equal(testFileOf(link, { file: path.join(link, 'src', 'a.test.ts'), classname: null, suite: null }), 'src/a.test.ts');
  } finally {
    setActiveProjectRoot(null);
    fs.rmSync(link, { force: true });
    fs.rmSync(real, { recursive: true, force: true });
  }
});
