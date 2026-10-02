import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_READ_RECORD_BYTES, parseReadRecord, readRecordBytes, serializeReadRecord, type ReadRecord } from './read-record';
import { parseRecord } from './record';
import { makeDeviceKey, signWithDevice, verifyWithDevice } from './signing';
import { isStoredPlace } from '../material-place';

const PLAN = 'a1b2c3d4-1111-2222-3333-444455556666';
const ITEM = 'b1b2c3d4-1111-2222-3333-444455556666';
const ALEX = 'cccccccc55556666';
const where = { plan: PLAN, item: ITEM };
const SHA = 'a'.repeat(64);

const read = (over: Partial<ReadRecord> = {}): ReadRecord => ({
  writer: ALEX, name: 'Alex Kim', counter: 1, at: Date.parse('2026-09-24T10:00:00Z'), plan: PLAN, item: ITEM,
  by: { author: 'claude-code', authorType: 'mcp' }, material: 'plans://Materials/sales.xlsx',
  attachment: 'd1b2c3d4-1111-2222-3333-444455556666', sha256: SHA, ...over,
});

test('a read record round-trips through its file, saying which version of which material', () => {
  const r = read();
  const text = serializeReadRecord(r);
  assert.match(text, /^# CodeTrellis: which version of a material a task read/);
  const parsed = parseReadRecord(text, where);
  assert.ok('record' in parsed, JSON.stringify(parsed));
  assert.deepEqual(parsed.record, r);
  assert.equal(parsed.signed.signature, null);
});

test('a signed read record verifies over the bytes read back, and not once changed', () => {
  const key = makeDeviceKey();
  const r = read();
  const sig = signWithDevice(key, readRecordBytes(r));
  const parsed = parseReadRecord(serializeReadRecord(r, sig), where);
  assert.ok('record' in parsed);
  assert.equal(verifyWithDevice(key.publicKey, parsed.signed.bytes, sig.value), true);
  const edited = parseReadRecord(serializeReadRecord(r, sig).replace(SHA, 'b'.repeat(64)), where);
  assert.ok('record' in edited);
  assert.equal(verifyWithDevice(key.publicKey, edited.signed.bytes, sig.value), false);
});

test('a read record is never a task-state record, nor the other way round', () => {
  const text = serializeReadRecord(read());
  assert.ok('error' in parseRecord(text, where));
  const state = '# x\nwriter: cccccccc55556666\ncounter: 1\nplan: ' + PLAN + '\nitem: ' + ITEM + '\nstate: { status: done }\n';
  assert.deepEqual(parseReadRecord(state, where), { error: 'not a material-read record' });
});

test('a read record is refused when it names another task, a path outside, or is too large', () => {
  assert.deepEqual(parseReadRecord(serializeReadRecord(read()), { plan: PLAN, item: 'c1b2c3d4-0000' }), { error: 'names another task than its folder' });
  for (const material of ['/etc/passwd', '../secrets.xlsx', 'plans://../x', 'plans://a//b', 'https://example.com/x', 'C:/x']) {
    const out = parseReadRecord(serializeReadRecord(read({ material })), where);
    assert.ok('error' in out, material);
  }
  assert.ok('error' in parseReadRecord('x'.repeat(MAX_READ_RECORD_BYTES + 1), where));
  assert.ok('error' in parseReadRecord(serializeReadRecord(read({ writer: 'not-a-writer' })), where));
});

test('a hash or attachment that is not one is dropped, not guessed at', () => {
  const parsed = parseReadRecord(serializeReadRecord(read({ sha256: 'nope', attachment: '../x' })), where);
  assert.ok('record' in parsed);
  assert.equal(parsed.record.sha256, null);
  assert.equal(parsed.record.attachment, null);
});

test('a stored place is project-relative or in the plans folder, and climbs nowhere', () => {
  for (const ok of ['data/sales.xlsx', 'plans://Materials/sales.xlsx', 'report.docx']) assert.equal(isStoredPlace(ok), true, ok);
  for (const bad of ['', '/abs/x', '../x', 'a/../b', 'plans://', 'plans://../x', 'mailto:x@y', 'C:\\x']) assert.equal(isStoredPlace(bad), false, bad);
});
