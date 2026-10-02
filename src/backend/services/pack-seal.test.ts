/**
 * The sign-off pack's seal (Phase 32 B10.3): who signed a pack, whether it
 * changed since, and whether the record it names still holds — read from
 * the saved page alone, as a reviewer would.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pack-seal-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let seal: typeof import('./pack-seal');
let signing: typeof import('./task-records/signing');
let log: typeof import('./agent-event-log');
let chain: typeof import('./record-chain');
let pack: typeof import('./signoff-pack');

const PACK = {
  format: 'codetrellis-signoff-pack', version: 1, plan: { uid: 'p-1', title: 'Refunds' }, generatedAt: '2026-10-02T09:00:00.000Z',
  rows: [{ itemUid: 'i-1', text: 'Refunds round to the cent', note: undefined }],
  files: [{ path: 'billing/refund.ts', sha256: 'a'.repeat(64), takenAt: 'approval' }],
};
const event = (n: number): AgentEvent => ({ id: log.eventId('t'), timestamp: Date.now(), source: 'mcp', type: 'tool_call', payload: { n } });

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  seal = await import('./pack-seal');
  signing = await import('./task-records/signing');
  log = await import('./agent-event-log');
  chain = await import('./record-chain');
  pack = await import('./signoff-pack');
});

beforeEach(() => {
  for (const t of ['agent_events', 'record_chain', 'record_anchor', 'task_record_keys']) db.getDb().run(`DELETE FROM ${t}`);
});

test('sealed here, checked here: this computer, unchanged, and the record it names still holds', () => {
  for (let i = 1; i <= 3; i++) log.recordAgentEvent(event(i));
  const sealed = seal.sealPack(PACK);
  assert.deepEqual(sealed.sealedRecord, chain.recordHead());
  const c = seal.checkSeal(JSON.parse(JSON.stringify(sealed)));
  assert.equal(c.state, 'this-computer', c.words);
  assert.equal(c.record?.state, 'matches');
  assert.match(c.words, /^Signed by this computer \(SHA256:[A-Za-z0-9+/]{12}…\), and unchanged since; the record it names is still here and unchanged \(entry #3\)\.$/);
});

test('saved as a page and read back, it still verifies: the seal survives the page', () => {
  // A pack with no criteria renders as a page like any other; its data rides along as JSON.
  const sealed = seal.sealPack({ ...PACK, rows: [] });
  const page = pack.renderPackHtml(sealed as never);
  assert.match(page, /Signed by the computer with key <code>SHA256:/);
  assert.equal(seal.checkSeal(pack.packFromText(page)).state, 'this-computer');
});

test('a byte changed anywhere, the record entry swapped, or the key swapped: changed after it was signed', () => {
  const sealed = JSON.parse(JSON.stringify(seal.sealPack(PACK)));
  const hash = JSON.parse(JSON.stringify(sealed)); hash.files[0].sha256 = 'b'.repeat(64);
  const text = JSON.parse(JSON.stringify(sealed)); text.rows[0].text = 'Refunds round to the dollar';
  const rec = JSON.parse(JSON.stringify(sealed)); rec.sealedRecord = { seq: 99, hash: 'c'.repeat(64) };
  const other = signing.makeDeviceKey();
  const key = JSON.parse(JSON.stringify(sealed)); key.seal.publicKey = other.publicKey;
  for (const p of [hash, text, rec, key]) {
    const c = seal.checkSeal(p);
    assert.equal(c.state, 'changed');
    assert.match(c.words, /^Changed after it was signed: this pack no longer matches its signature \(key SHA256:[A-Za-z0-9+/]{12}…\)\.$/);
  }
});

test('no seal: unsigned, and said so', () => {
  const c = seal.checkSeal(PACK);
  assert.equal(c.state, 'unsigned');
  assert.equal(c.words, 'This pack is not signed: it was made before packs were signed, or its signature was removed.');
});

test('signed by another computer: unknown until its key is trusted, then the teammate by name', () => {
  const other = signing.makeDeviceKey();
  const body = { ...PACK, sealedRecord: { seq: 7, hash: 'd'.repeat(64) } };
  const value = signing.signWithDevice(other, seal.sealBytes(body)).value;
  const theirs = { ...body, seal: { how: 'device', key: other.fingerprint, publicKey: other.publicKey, value } };
  let c = seal.checkSeal(theirs);
  assert.equal(c.state, 'unknown-key');
  assert.match(c.words, /who signed it is not proven\. Check the fingerprint with whoever sent it\.$/);
  db.getDb().run(
    `INSERT INTO task_record_keys (writer, fingerprint, public_key, name, project_root, state, first_seen) VALUES (?, ?, ?, ?, ?, 'trusted', ?)`,
    ['abcd1234', other.fingerprint, other.publicKey, 'Dana Ortiz', '/w/app', Date.now()],
  );
  c = seal.checkSeal(theirs);
  assert.equal(c.state, 'teammate');
  assert.equal(c.signer, 'Dana Ortiz');
  assert.match(c.words, /^Signed by Dana Ortiz's computer \(SHA256:.{12}…\), a key you trust, and unchanged since; the record it names is on that computer \(entry #7\)\.$/);
  // A task-record signature by the same key is not a pack's: the namespace differs.
  const recordSig = signing.signWithDevice(other, `codetrellis-task-record\n${signing.canonicalJson(body)}`).value;
  assert.equal(seal.checkSeal({ ...theirs, seal: { ...theirs.seal, value: recordSig } }).state, 'changed');
});

test('the record it names, later: removed by retention, or changed since', () => {
  for (let i = 1; i <= 4; i++) log.recordAgentEvent(event(i));
  const sealed = JSON.parse(JSON.stringify(seal.sealPack(PACK)));
  chain.trimRecord(Date.now() + 1, 100);
  for (let i = 5; i <= 6; i++) log.recordAgentEvent(event(i));
  assert.equal(seal.checkSeal(sealed).record?.state, 'matches', 'trimmed through exactly its entry: the anchor holds its hash');

  for (let i = 7; i <= 8; i++) log.recordAgentEvent(event(i));
  const later = JSON.parse(JSON.stringify(seal.sealPack(PACK)));
  chain.trimRecord(Date.now() + 1, 100);
  log.recordAgentEvent(event(9));
  assert.equal(seal.checkSeal(sealed).record?.state, 'trimmed');
  assert.match(seal.checkSeal(sealed).words, /has since been removed by retention/);

  log.recordAgentEvent(event(10));
  const now = JSON.parse(JSON.stringify(seal.sealPack(PACK)));
  db.getDb().run('UPDATE record_chain SET hash = ? WHERE seq = ?', ['e'.repeat(64), now.sealedRecord.seq]);
  const c = seal.checkSeal(now);
  assert.equal(c.record?.state, 'differs');
  assert.match(c.words, /but the record it names has changed since/);
  assert.equal(seal.checkSeal(later).record?.state, 'matches', 'its entry is the anchor itself');
});
