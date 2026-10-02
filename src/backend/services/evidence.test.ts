/**
 * The evidence export (Phase 32 B10.4): one signed package for a window,
 * checked as an auditor would, from the file alone, and on the computer
 * that made it against its own record.
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-evidence-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let evidence: typeof import('./evidence');
let seal: typeof import('./pack-seal');
let log: typeof import('./agent-event-log');
let chain: typeof import('./record-chain');

const PROJECT = path.join(tmp, 'shop');
const event = (n: number, at = Date.now()): AgentEvent => ({ id: log.eventId('t'), timestamp: at, source: 'mcp', type: 'tool_call', payload: { tool: 'list_plans', args: '{}', n } });

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  evidence = await import('./evidence');
  seal = await import('./pack-seal');
  log = await import('./agent-event-log');
  chain = await import('./record-chain');
  // As the server wires it: a published app event is kept and linked.
  log.setEventPublisher((_type, payload) => { log.recordAgentEvent(payload as AgentEvent); });
});

beforeEach(() => {
  for (const t of ['agent_events', 'record_chain', 'record_anchor', 'task_record_keys']) db.getDb().run(`DELETE FROM ${t}`);
});

/** Three tool calls before the window, then four in it with a person's decision among them. */
function seed(): { from: number; to: number } {
  const t0 = Date.now() - 60_000;
  for (let i = 0; i < 3; i++) log.recordAgentEvent(event(i, t0 + i));
  const from = t0 + 10_000;
  for (let i = 0; i < 3; i++) log.recordAgentEvent(event(10 + i, from + i));
  log.recordDecision('rule_changed', { change: 'set', ruleId: 'web-not-db', from: 'packages/web/', mayNotImport: 'services/', authorType: 'human' }, null);
  return { from, to: Date.now() };
}

const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

test('a window: its entries, with the link before them, recompute into one chain; signed here, it holds', () => {
  const { from, to } = seed();
  const e = evidence.sealEvidence(evidence.buildEvidence({ projectPath: PROJECT, from, to }));
  assert.equal(e.format, 'codetrellis-evidence');
  assert.deepEqual(e.record.entries.map((x) => x.seq), [4, 5, 6, 7]);
  assert.equal(e.record.before.seq, 3);
  assert.deepEqual(e.record.through, chain.recordHead());
  assert.match(e.record.how, /^digest = sha256\(JSON\.stringify\(\[event\.id/);
  // The person's decision, in words, with its entry number.
  assert.deepEqual(e.decisions.map((d) => [d.seq, d.words]), [[7, 'You set the architecture rule “packages/web/ may not import services/”']]);
  assert.deepEqual(e.start.stack.plans, []);

  const c = evidence.verifyEvidence(roundTrip(e));
  assert.equal(c.ok, true, c.words);
  assert.equal(c.seal.state, 'this-computer');
  assert.equal(c.chain.words, 'Its 4 record entries (#4 to #7) recompute into one unbroken chain.');
  assert.equal(c.here.state, 'matches');
  assert.equal(c.here.words, 'This computer\'s record still holds every entry in it, unchanged.');
});

test('saved as a page and read back, it still verifies; the page shows the decisions and the seal', () => {
  const { from, to } = seed();
  const e = evidence.sealEvidence(evidence.buildEvidence({ projectPath: PROJECT, from, to }));
  const page = evidence.renderEvidenceHtml(e);
  assert.match(page, /<td>#7<\/td>/);
  assert.match(page, /Signed by the computer with key <code>SHA256:/);
  assert.doesNotMatch(page, /<script>/);
  const c = evidence.verifyEvidence(evidence.evidenceFromText(page));
  assert.equal(c.ok, true, c.words);
});

test('an event edited in the file: the seal fails, and the chain names the entry', () => {
  const { from, to } = seed();
  const e = roundTrip(evidence.sealEvidence(evidence.buildEvidence({ projectPath: PROJECT, from, to })));
  e.record.entries[1].event!.payload = JSON.stringify({ tool: 'delete_plan', args: '{}' });
  const c = evidence.verifyEvidence(e);
  assert.equal(c.ok, false);
  assert.equal(c.seal.state, 'changed');
  assert.match(c.seal.words, /^Changed after it was signed: this export no longer matches its signature/);
  assert.equal(c.chain.ok, false);
  assert.deepEqual(c.chain.problems.map((p) => [p.seq, p.kind]), [[5, 'changed']]);
  assert.match(c.chain.words, /#5 \(tool call, \d{4}-\d{2}-\d{2}\): its event does not match its digest/);
  assert.equal(c.here.words, 'Its signature does not hold, so who made it is not known and this computer\'s record was not compared.');
});

test('re-signed by someone else after an edit: the key is unknown and the chain still names the entry', () => {
  const { from, to } = seed();
  const e = roundTrip(evidence.buildEvidence({ projectPath: PROJECT, from, to }));
  e.record.entries[0].event!.payload = '{}';
  // Signed by this computer, then the key is swapped for a stranger's: a forger cannot sign as this computer.
  const signing = require('./task-records/signing') as typeof import('./task-records/signing');
  const stranger = signing.makeDeviceKey();
  const bytes = seal.sealBytes({ ...e, sealedRecord: { seq: 7, hash: 'f'.repeat(64) } } as never, seal.EVIDENCE_NAMESPACE);
  const forged = { ...e, sealedRecord: { seq: 7, hash: 'f'.repeat(64) }, seal: { how: 'device', key: stranger.fingerprint, publicKey: stranger.publicKey, value: signing.signWithDevice(stranger, bytes).value } };
  const c = evidence.verifyEvidence(roundTrip(forged));
  assert.equal(c.seal.state, 'unknown-key');
  assert.equal(c.ok, false);
  assert.deepEqual(c.chain.problems.map((p) => [p.seq, p.kind]), [[4, 'changed']]);
  assert.equal(c.here.state, 'not-here');
  assert.equal(c.here.words, 'It was made on another computer, so this one has no record of it to compare.');
});

test('a pack\'s signature never passes for an export\'s', () => {
  const { from, to } = seed();
  const asPack = seal.sealPack(evidence.buildEvidence({ projectPath: PROJECT, from, to }));
  const c = evidence.verifyEvidence(roundTrip(asPack));
  assert.equal(c.seal.state, 'changed');
});

test('the database changed since the export: on this computer, the entry is named', () => {
  const { from, to } = seed();
  const e = roundTrip(evidence.sealEvidence(evidence.buildEvidence({ projectPath: PROJECT, from, to })));
  const id = e.record.entries[2].event!.id;
  db.getDb().run('UPDATE agent_events SET payload = ? WHERE id = ?', [JSON.stringify({ tool: 'delete_plan' }), id]);
  const c = evidence.verifyEvidence(e);
  assert.equal(c.seal.state, 'this-computer');
  assert.equal(c.chain.ok, true, 'the file itself is intact');
  assert.equal(c.here.state, 'differs');
  assert.equal(c.ok, false);
  assert.match(c.here.words, /^Since it was exported: #6 \(tool call, \d{4}-\d{2}-\d{2}\): its content was changed in this computer's record since\.$/);
});

test('retention removed entries since: still holds, and says so', () => {
  const { from, to } = seed();
  const e = roundTrip(evidence.sealEvidence(evidence.buildEvidence({ projectPath: PROJECT, from, to })));
  chain.trimRecord(Number.MAX_SAFE_INTEGER, 1_000_000);
  const c = evidence.verifyEvidence(e);
  assert.equal(c.here.state, 'trimmed');
  assert.equal(c.here.words, 'This computer\'s record still matches it, except 4 entries retention has removed since.');
  assert.equal(c.ok, true, c.words);
});

test('an empty window still chains from the link before it; bad requests say what is wrong', () => {
  const { from } = seed();
  // Between the first three entries and the window's: nothing linked then.
  const e = evidence.buildEvidence({ projectPath: PROJECT, from: from - 5_000, to: from - 4_000 });
  assert.equal(e.record.entries.length, 0);
  assert.equal(e.record.before.seq, 3);
  assert.deepEqual(e.record.through, e.record.before);
  assert.throws(() => evidence.buildEvidence({ projectPath: PROJECT, from: 10, to: 5 }), /from must be before to/);
  assert.throws(() => evidence.buildEvidence({ projectPath: PROJECT }), /from and to must be times in milliseconds/);
  assert.throws(() => evidence.buildEvidence({ planUid: 'no-such-plan' }), /Plan no-such-plan not found/);
  assert.throws(() => evidence.verifyEvidence({ format: 'codetrellis-signoff-pack' }), /not a CodeTrellis evidence export/);
  assert.throws(() => evidence.evidenceFromText('<html>nothing</html>'), /No evidence data in that file/);
});
