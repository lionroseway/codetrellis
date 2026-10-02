/**
 * The record (Phase 32 B10.1): every kept agent event linked into a hash
 * chain, and a walk of it that finds a changed, removed or forged event, or
 * a changed link, and still verifies once retention has trimmed it.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-record-chain-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let log: typeof import('./agent-event-log');
let chain: typeof import('./record-chain');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 20);

const event = (n: number, over: Partial<AgentEvent> = {}): AgentEvent => ({
  id: log.eventId('t'), timestamp: T0 + n * 1000, source: 'mcp', type: 'tool_call',
  payload: { tool: 'list_plans', n, agentType: 'codex' }, ...over,
});
const ids = () => log.listAgentEvents({ limit: 2000 }).map((e) => e.id);
const sql = (q: string, p: Array<string | number> = []) => db.getDb().run(q, p);

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  log = await import('./agent-event-log');
  chain = await import('./record-chain');
});

beforeEach(() => {
  for (const t of ['agent_events', 'record_chain', 'record_anchor']) sql(`DELETE FROM ${t}`);
});

describe('the chain', () => {
  test('every kept event is linked as it is written, and the walk says the record is intact', () => {
    for (let i = 1; i <= 5; i++) log.recordAgentEvent(event(i));
    const r = chain.verifyRecord();
    assert.equal(r.ok, true, r.words);
    assert.equal(r.entries, 5);
    assert.equal(r.head.seq, 5);
    assert.match(r.words, /^Intact: 5 entries since 2026-09-20 match the chain\.$/);
  });

  test('an event whose content changed after it was written is named, by number, kind and agent', () => {
    for (let i = 1; i <= 3; i++) log.recordAgentEvent(event(i));
    const second = ids()[1];
    sql('UPDATE agent_events SET payload = ? WHERE id = ?', [JSON.stringify({ tool: 'delete_plan', n: 2 }), second]);
    const r = chain.verifyRecord();
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems.map((p) => [p.seq, p.kind]), [[2, 'changed']]);
    assert.equal(r.words, 'Changed after it was written: 1 of 3 entries since 2026-09-20. #2 (tool call by codex, 2026-09-20): its content changed after it was written.');
  });

  test('a removed event, a forged event and a changed link are each found', () => {
    for (let i = 1; i <= 4; i++) log.recordAgentEvent(event(i));
    const [, b, c] = ids();
    sql('DELETE FROM agent_events WHERE id = ?', [b]);
    sql('INSERT INTO agent_events (id, at, source, type, payload) VALUES (?, ?, ?, ?, ?)', ['forged-1', T0 + 2500, 'mcp', 'tool_call', '{}']);
    sql('UPDATE record_chain SET digest = ? WHERE event_id = ?', ['0'.repeat(64), c]);
    const kinds = chain.verifyRecord().problems.map((p) => [p.seq, p.kind]);
    assert.deepEqual(kinds, [[2, 'removed'], [3, 'relinked'], [3, 'changed'], [null, 'unlinked']]);
  });

  test('a link removed from the middle breaks the chain where it was', () => {
    for (let i = 1; i <= 3; i++) log.recordAgentEvent(event(i));
    sql('DELETE FROM record_chain WHERE seq = 2');
    const kinds = chain.verifyRecord().problems.map((p) => [p.seq, p.kind]);
    assert.deepEqual(kinds, [[2, 'removed'], [3, 'relinked'], [null, 'unlinked']]);
  });

  test('the workstream stamped later (a session binding after its first calls) is not a change', () => {
    log.recordAgentEvent(event(1, { payload: { tool: 'list_plans', sessionId: 's-late' } }));
    log.adoptSessionEvents('s-late', '/w/app-billing');
    assert.equal(chain.verifyRecord().ok, true);
  });
});

describe('retention', () => {
  test('the oldest block goes with its links; the anchor keeps what is left verifiable', () => {
    log.recordAgentEvent(event(0, { timestamp: T0 - 20 * DAY }));
    for (let i = 1; i <= 4; i++) log.recordAgentEvent(event(i));
    assert.equal(chain.trimRecord(T0 - 14 * DAY, 3, T0 + DAY), 2);
    const r = chain.verifyRecord();
    assert.equal(r.ok, true, r.words);
    assert.equal(r.entries, 3);
    assert.equal(r.trimmedThrough, 2);
    assert.match(r.words, /older entries were removed by retention on 2026-09-21/);
    // And it goes on from there.
    log.recordAgentEvent(event(5));
    assert.equal(chain.verifyRecord().head.seq, 6);
    assert.equal(chain.verifyRecord().ok, true);
  });

  test('a late event stamped earlier than the last is trimmed with its neighbours, not out of order', () => {
    log.recordAgentEvent(event(10));
    log.recordAgentEvent(event(1)); // a watcher event read late: it says it happened earlier
    log.recordAgentEvent(event(11));
    const links = db.getDb().exec('SELECT seq, linked_at FROM record_chain ORDER BY seq')[0].values;
    assert.deepEqual(links.map((l) => Number(l[1]) - T0), [10_000, 10_000, 11_000], 'link time never goes backwards');
    assert.equal(chain.trimRecord(T0 + 10_500, 100, T0 + DAY), 2);
    assert.equal(chain.verifyRecord().ok, true);
  });
});

describe('the record begins', () => {
  test('events kept before it are linked once; afterwards an unlinked event is reported, not taken in', () => {
    sql('INSERT INTO agent_events (id, at, source, type, payload) VALUES (?, ?, ?, ?, ?)', ['before-1', T0, 'mcp', 'tool_call', '{}']);
    sql('INSERT INTO agent_events (id, at, source, type, payload) VALUES (?, ?, ?, ?, ?)', ['before-2', T0 + 1, 'mcp', 'tool_call', '{}']);
    assert.equal(chain.beginRecord(), 2);
    assert.equal(chain.verifyRecord().ok, true);
    sql('INSERT INTO agent_events (id, at, source, type, payload) VALUES (?, ?, ?, ?, ?)', ['around-1', T0 + 2, 'mcp', 'tool_call', '{}']);
    assert.equal(chain.beginRecord(), 0);
    assert.deepEqual(chain.verifyRecord().problems.map((p) => [p.eventId, p.kind]), [['around-1', 'unlinked']]);
  });
});
