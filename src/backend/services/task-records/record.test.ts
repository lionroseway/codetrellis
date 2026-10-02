import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distinctRecords, heads, isRecordId, parseRecord, readItem, recordFileName, seenOf, serializeRecord, supersedes,
  MAX_RECORD_BYTES, type TaskRecord,
} from './record';

const PLAN = 'a1b2c3d4-1111-2222-3333-444455556666';
const ITEM = 'b1b2c3d4-1111-2222-3333-444455556666';
const SAM = 'aaaaaaaa11112222';
const DANA = 'bbbbbbbb33334444';
const where = { plan: PLAN, item: ITEM };

const rec = (writer: string, counter: number, seen: Record<string, number>, status: string, at = 1_000 * counter): TaskRecord => ({
  writer, name: writer === SAM ? 'Sam Lee' : 'Dana Ortiz', counter, seen, at, plan: PLAN, item: ITEM,
  by: { author: writer === SAM ? 'Sam Lee' : 'Dana Ortiz', authorType: 'human' },
  state: { status, assignee: null, assigneeType: null, progressPercent: null, blockedReason: null },
});

test('a record round-trips through its file, with a note for whoever opens it', () => {
  const r = rec(SAM, 3, { [DANA]: 2 }, 'in_progress');
  r.state.progressPercent = 40;
  const text = serializeRecord(r);
  assert.match(text, /^# CodeTrellis task state, written once/);
  const parsed = parseRecord(text, where);
  assert.ok('record' in parsed);
  assert.deepEqual(parsed.record, r);
  assert.equal(parsed.signed.signature, null);
  assert.equal(recordFileName(SAM, 3), `${SAM}-3.yaml`);
});

test('a record is read only in its own task\'s folder', () => {
  const text = serializeRecord(rec(SAM, 1, {}, 'done'));
  assert.deepEqual(parseRecord(text, { plan: PLAN, item: 'c1b2c3d4-1111-2222-3333-444455556666' }), { error: 'names another task than its folder' });
});

test('anything that is not a record is refused, never guessed at', () => {
  assert.deepEqual(parseRecord('- a\n- list', where), { error: 'not a record' });
  assert.deepEqual(parseRecord('{', where), { error: 'not YAML' });
  assert.deepEqual(parseRecord(`writer: ../../etc\ncounter: 1\nplan: ${PLAN}\nitem: ${ITEM}\nstate: {}`, where), { error: 'no writer' });
  assert.deepEqual(parseRecord(`writer: ${SAM}\ncounter: -1\nplan: ${PLAN}\nitem: ${ITEM}\nstate: {}`, where), { error: 'no counter' });
  assert.deepEqual(parseRecord(`writer: ${SAM}\ncounter: 1\nplan: ${PLAN}\nitem: ${ITEM}`, where), { error: 'no state' });
  assert.deepEqual(parseRecord(`a: ${'x'.repeat(MAX_RECORD_BYTES)}`, where), { error: 'larger than a record can be' });
  assert.deepEqual(parseRecord(`base: &a [1]\nwriter: *a`, where), { error: 'not YAML' });
});

test('a state no task can have is read as none, and progress is kept between 0 and 100', () => {
  const text = `writer: ${SAM}\ncounter: 1\nplan: ${PLAN}\nitem: ${ITEM}\nstate:\n  status: exploded\n  progressPercent: 250\n`;
  const out = parseRecord(text, where);
  assert.ok('record' in out);
  assert.equal(out.record.state.status, null);
  assert.equal(out.record.state.progressPercent, 100);
  assert.equal(out.record.name, 'someone');
});

test('a writer cannot claim to have seen itself, and seen names only writers', () => {
  const text = `writer: ${SAM}\ncounter: 2\nseen:\n  ${SAM}: 9\n  ${DANA}: 1\n  "../x": 4\nplan: ${PLAN}\nitem: ${ITEM}\nstate: { status: done }\n`;
  const out = parseRecord(text, where);
  assert.ok('record' in out);
  assert.deepEqual(out.record.seen, { [DANA]: 1 });
});

test('order comes from what each writer had seen, not from clocks', () => {
  const dana1 = rec(DANA, 1, {}, 'in_progress', 9_000_000);
  const sam1 = rec(SAM, 1, { [DANA]: 1 }, 'done', 10); // Sam's laptop clock is hours behind
  assert.ok(supersedes(sam1, dana1));
  assert.ok(!supersedes(dana1, sam1));
  assert.deepEqual(heads([dana1, sam1]), [sam1]);
  assert.deepEqual(readItem([dana1, sam1]), { kind: 'settled', head: sam1 });
});

test('two people acting at once, disagreeing, is a split naming both; agreeing is settled', () => {
  const dana1 = rec(DANA, 1, {}, 'blocked');
  const sam1 = rec(SAM, 1, {}, 'done');
  const out = readItem([dana1, sam1]);
  assert.equal(out.kind, 'split');
  assert.deepEqual(out.kind === 'split' ? out.heads.map((h) => h.writer).sort() : [], [SAM, DANA].sort());
  assert.equal(readItem([rec(DANA, 1, {}, 'done'), rec(SAM, 1, {}, 'done')]).kind, 'settled');
  // A later record made having seen both ends the split.
  assert.deepEqual(readItem([dana1, sam1, rec(DANA, 2, { [SAM]: 1 }, 'done')]).kind, 'settled');
});

test('reading a record twice changes nothing; two different records under one name are both kept', () => {
  const sam1 = rec(SAM, 1, {}, 'done');
  const copy = { ...sam1, seen: { ...sam1.seen }, state: { ...sam1.state } };
  assert.deepEqual(distinctRecords([sam1, copy]), { records: [sam1], clashing: [] });
  assert.deepEqual(readItem([sam1, copy]), readItem([sam1]));
  const forged = rec(SAM, 1, {}, 'skipped');
  assert.deepEqual(distinctRecords([sam1, forged]).clashing, [forged]);
});

test('seen is the highest counter of each writer', () => {
  assert.deepEqual(seenOf([rec(SAM, 1, {}, 'done'), rec(SAM, 3, {}, 'done'), rec(DANA, 2, {}, 'done')]), { [SAM]: 3, [DANA]: 2 });
});

test('a folder name is a uid, never anything a path could be made of', () => {
  assert.ok(isRecordId(PLAN));
  for (const bad of ['..', '.', 'a/b', 'a\\b', '', '-x', 'x'.repeat(65)]) assert.ok(!isRecordId(bad), bad);
});
