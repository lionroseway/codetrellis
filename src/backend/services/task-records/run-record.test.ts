import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRunPath, MAX_RUN_RECORD_BYTES, parseRunRecord, runFilesOf, runRecordBytes, serializeRunRecord, type RunRecord } from './run-record';

const RUN: RunRecord = {
  writer: 'a1b2c3d4e5f60718', name: 'Sam Lee', counter: 3, at: Date.parse('2026-10-01T12:00:00Z'),
  by: { author: 'claude-code', authorType: 'mcp' }, commit: 'f'.repeat(40), dirty: ['src/wip.ts'], report: 'reports/unit.xml',
  totals: { tests: 4, passed: 2, failed: 1, errors: 0, skipped: 1 },
  files: [{ file: 'src/a.test.ts', passed: 2, failed: 1, skipped: 1, failing: [{ name: 'rounds half up', result: 'failed', why: 'expected 3, got 2' }] }],
};

test('a run record reads back as it was written, signed over the same bytes', () => {
  const text = serializeRunRecord(RUN, null);
  assert.match(text, /^# CodeTrellis: one device's latest test run/);
  const parsed = parseRunRecord(text);
  assert.ok('record' in parsed);
  assert.deepEqual(parsed.record, RUN);
  assert.equal(parsed.signed.bytes, runRecordBytes(RUN));
});

test('a run record is untrusted: other kinds, bad writers, paths outside, and oversize are refused or dropped', () => {
  assert.deepEqual(parseRunRecord('kind: material-read\nwriter: a1b2c3d4\ncounter: 1\n'), { error: 'not a test-run record' });
  assert.deepEqual(parseRunRecord('kind: test-run\nwriter: Sam\ncounter: 1\nat: 2026-10-01T00:00:00Z\n'), { error: 'no writer' });
  assert.deepEqual(parseRunRecord('kind: test-run\nwriter: a1b2c3d4\ncounter: 0\nat: 2026-10-01T00:00:00Z\n'), { error: 'no counter' });
  assert.deepEqual(parseRunRecord('x'.repeat(MAX_RUN_RECORD_BYTES + 1)), { error: 'larger than a run record can be' });
  const hostile = serializeRunRecord({
    ...RUN, commit: 'not-a-sha', dirty: ['../etc/passwd', 'ok.ts'],
    files: [{ file: '../../outside.test.ts', passed: 1, failed: 0, skipped: 0, failing: [] }, { file: '/abs.test.ts', passed: 1, failed: 0, skipped: 0, failing: [] }, ...RUN.files],
  }, null);
  const r = parseRunRecord(hostile);
  assert.ok('record' in r);
  assert.equal(r.record.commit, null);
  assert.deepEqual(r.record.dirty, ['ok.ts']);
  assert.deepEqual(r.record.files.map((f) => f.file), ['src/a.test.ts']);
  // A count is never less than the failing tests it names.
  const under = parseRunRecord(serializeRunRecord({ ...RUN, files: [{ ...RUN.files[0], failed: 0 }] }, null));
  assert.ok('record' in under);
  assert.equal(under.record.files[0].failed, 1);
  assert.equal(isRunPath('a/b.ts'), true);
  for (const bad of ['', '/a', 'C:/a', 'a\\b', 'a//b', 'a/../b', '..']) assert.equal(isRunPath(bad), false, bad);
});

test('a run by test file: counts, failing tests named with why, cases with no file left out', () => {
  const files = runFilesOf([
    { testFile: 'src/b.test.ts', name: 'one', result: 'passed', message: null },
    { testFile: 'src/a.test.ts', name: 'two', result: 'failed', message: 'nope' },
    { testFile: 'src/a.test.ts', name: 'three', result: 'error', message: null },
    { testFile: 'src/a.test.ts', name: 'four', result: 'skipped', message: null },
    { testFile: null, name: 'no file', result: 'failed', message: 'lost' },
  ]);
  assert.deepEqual(files, [
    { file: 'src/a.test.ts', passed: 0, failed: 2, skipped: 1, failing: [{ name: 'two', result: 'failed', why: 'nope' }, { name: 'three', result: 'error', why: null }] },
    { file: 'src/b.test.ts', passed: 1, failed: 0, skipped: 0, failing: [] },
  ]);
  // Fifty failing tests are named; the rest are counted.
  const many = runFilesOf(Array.from({ length: 60 }, (_, i) => ({ testFile: 'src/a.test.ts', name: `t${i}`, result: 'failed', message: null })));
  assert.equal(many[0].failed, 60);
  assert.equal(many[0].failing.length, 50);
});
