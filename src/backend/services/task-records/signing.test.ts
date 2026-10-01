import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  canonicalJson, fingerprintOf, keyFileName, makeDeviceKey, parseKeyIntroduction, parseSignature, serializeKeyIntroduction,
  shortFingerprint, signWithDevice, verifyWithDevice,
} from './signing';
import { parseRecord, recordBytes, serializeRecord, type TaskRecord } from './record';

const PLAN = 'a1b2c3d4-1111-2222-3333-444455556666';
const ITEM = 'b1b2c3d4-1111-2222-3333-444455556666';
const SAM = 'aaaaaaaa11112222';
const where = { plan: PLAN, item: ITEM };
const record = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  writer: SAM, name: 'Sam Lee', counter: 2, seen: { bbbbbbbb33334444: 1 }, at: Date.UTC(2026, 9, 1, 9, 30), plan: PLAN, item: ITEM,
  by: { author: 'claude-code', authorType: 'agent' },
  state: { status: 'in_progress', assignee: 'Sam Lee', assigneeType: 'human', progressPercent: 40, blockedReason: null },
  ...over,
});

test('canonical JSON sorts keys at every level, so the signed bytes do not depend on order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
});

test('a record signed with a device key reads back as the bytes signed, and verifies', () => {
  const key = makeDeviceKey();
  const r = record();
  const sig = signWithDevice(key, recordBytes(r));
  assert.equal(sig.how, 'device');
  const parsed = parseRecord(serializeRecord(r, sig), where);
  assert.ok('record' in parsed);
  assert.deepEqual(parsed.record, r);
  assert.equal(parsed.signed.bytes, recordBytes(r));
  assert.deepEqual(parsed.signed.signature, sig);
  assert.equal(verifyWithDevice(key.publicKey, parsed.signed.bytes, sig.value), true);
});

test('a signed record edited afterwards no longer verifies: a state, a name, or a field added', () => {
  const key = makeDeviceKey();
  const r = record();
  const text = serializeRecord(r, signWithDevice(key, recordBytes(r)));
  type Doc = { state: { status: string }; name: string; seen: Record<string, number>; note?: string };
  const edit = (fn: (doc: Doc) => void) => {
    const doc = parseYaml(text) as Doc;
    fn(doc);
    const p = parseRecord(stringifyYaml(doc), where);
    assert.ok('record' in p);
    return verifyWithDevice(key.publicKey, p.signed.bytes, p.signed.signature!.value);
  };
  assert.equal(edit(() => {}), true);
  assert.equal(edit((d) => { d.state.status = 'done'; }), false);
  assert.equal(edit((d) => { d.name = 'Dana Ortiz'; }), false);
  assert.equal(edit((d) => { d.note = 'added later'; }), false);
  assert.equal(edit((d) => { d.seen = {}; }), false);
});

test('another key, or a key of another kind, does not verify a signature', () => {
  const a = makeDeviceKey();
  const b = makeDeviceKey();
  const sig = signWithDevice(a, 'bytes');
  assert.equal(verifyWithDevice(b.publicKey, 'bytes', sig.value), false);
  assert.equal(verifyWithDevice('not a key', 'bytes', sig.value), false);
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(fingerprintOf(a.publicKey), a.fingerprint);
  assert.equal(shortFingerprint(a.fingerprint), a.fingerprint.slice(0, 19));
});

test('a signature block is read only in the shapes this version writes', () => {
  const key = makeDeviceKey();
  const sig = signWithDevice(key, 'x');
  assert.deepEqual(parseSignature(sig), sig);
  assert.equal(parseSignature(null), null);
  assert.equal(parseSignature({ how: 'device', key: 'SHA256:short', value: sig.value }), null);
  assert.equal(parseSignature({ how: 'device', key: key.fingerprint, value: 'AAAA' }), null);
  const ssh = '-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQ==\n-----END SSH SIGNATURE-----';
  assert.deepEqual(parseSignature({ how: 'git', signer: 'sam@acme.test', value: `${ssh}\n` }), { how: 'git', signer: 'sam@acme.test', value: ssh });
  assert.equal(parseSignature({ how: 'git', signer: 'not an email', value: ssh }), null);
  assert.equal(parseSignature({ how: 'git', signer: 'sam@acme.test', value: 'not a signature' }), null);
  assert.equal(parseSignature({ how: 'pgp', signer: 'sam@acme.test', value: ssh }), null);
});

test('an unsigned record reads with no signature', () => {
  const p = parseRecord(serializeRecord(record()), where);
  assert.ok('record' in p);
  assert.equal(p.signed.signature, null);
});

test('a key introduction round-trips, with the fingerprint computed and never taken from the file', () => {
  const key = makeDeviceKey();
  const text = serializeKeyIntroduction({ writer: SAM, name: 'Sam Lee', publicKey: key.publicKey, fingerprint: key.fingerprint });
  assert.match(text, /^# CodeTrellis: this device signs its task-state records with this key\./);
  assert.deepEqual(parseKeyIntroduction(text, SAM), { key: { writer: SAM, name: 'Sam Lee', publicKey: key.publicKey, fingerprint: key.fingerprint } });
  assert.equal(keyFileName(SAM), `${SAM}.yaml`);
  const lying = text.replace(key.fingerprint, makeDeviceKey().fingerprint);
  assert.deepEqual(parseKeyIntroduction(lying, SAM), { key: { writer: SAM, name: 'Sam Lee', publicKey: key.publicKey, fingerprint: key.fingerprint } });
});

test('a key introduction is refused when it names another device, is not a key, or is too large', () => {
  const key = makeDeviceKey();
  const text = serializeKeyIntroduction({ writer: SAM, name: 'Sam Lee', publicKey: key.publicKey, fingerprint: key.fingerprint });
  assert.deepEqual(parseKeyIntroduction(text, 'cccccccc55556666'), { error: 'names another device than its file' });
  assert.deepEqual(parseKeyIntroduction(text.replace(key.publicKey, 'AAAA'), SAM), { error: 'not a public key' });
  assert.deepEqual(parseKeyIntroduction('kind: something-else\nversion: 1', SAM), { error: 'not a key file this version reads' });
  assert.deepEqual(parseKeyIntroduction(`a: ${'x'.repeat(5000)}`, SAM), { error: 'larger than a key file can be' });
  assert.deepEqual(parseKeyIntroduction('{', SAM), { error: 'not YAML' });
});
