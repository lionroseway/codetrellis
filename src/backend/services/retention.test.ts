/**
 * How long the record is kept (Phase 32 B10.2): the window in days or
 * everything, set by the person only, refused when it is not one of the
 * choices, and keeping everything prunes nothing.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-retention-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let settings: typeof import('./settings-service');
let retention: typeof import('./retention');
let log: typeof import('./agent-event-log');
let chain: typeof import('./record-chain');
let grant: typeof import('./grant-guard');

const DAY = 24 * 60 * 60 * 1000;

before(async () => {
  const db = await import('./database');
  await db.initDatabase();
  settings = await import('./settings-service');
  retention = await import('./retention');
  log = await import('./agent-event-log');
  chain = await import('./record-chain');
  grant = await import('./grant-guard');
});

after(() => { settings.updateSettings({ data: { ...settings.getSettings().data, retentionDays: 14 } }); });

const set = (retentionDays: number | null) => settings.updateSettings({ data: { ...settings.getSettings().data, retentionDays } as never });

test('14 days unless the person chose otherwise; the window in words; everything has no cutoff', () => {
  assert.equal(settings.getSettings().data.retentionDays, 14);
  assert.equal(retention.retentionCutoff(100 * DAY), 86 * DAY);
  assert.equal(retention.retentionWords(365), 'a year');
  assert.equal(retention.retentionWords(30), '30 days');
  assert.equal(retention.retentionWords(null), 'everything');
  assert.equal(retention.retentionCutoff(100 * DAY, null), null);
});

test('only the choices are taken; anything else is refused with what it must be, and nothing is stored', () => {
  assert.throws(() => set(7), /data\.retentionDays must be 14, 30, 90 or 365 days, or null to keep everything/);
  assert.equal(settings.getSettings().data.retentionDays, 14);
  set(90);
  assert.equal(settings.getSettings().data.retentionDays, 90);
  set(14);
});

test('changing it is the person\'s: a patch that changes it is a grant; one that carries it unchanged is not', () => {
  const now = settings.getSettings();
  assert.deepEqual(grant.grantChange({ data: { ...now.data, retentionDays: 30 } }, now), { field: 'data.retentionDays', where: 'Settings → Data' });
  assert.equal(grant.grantChange({ data: { ...now.data, dataDirOverride: '/tmp/x' } }, now), null);
  assert.equal(grant.grantRefusal('data.retentionDays', 'Settings → Data'), 'Only you can change data.retentionDays — in the CodeTrellis app, Settings → Data.');
});

test('keeping everything prunes nothing, however old; a window trims, and the record still verifies', () => {
  const event = (n: number, at: number): AgentEvent => ({ id: log.eventId('t'), timestamp: at, source: 'mcp', type: 'tool_call', payload: { n } });
  const now = Date.now();
  log.recordAgentEvent(event(1, now - 400 * DAY));
  log.recordAgentEvent(event(2, now - 40 * DAY));
  log.recordAgentEvent(event(3, now - DAY));
  set(null);
  assert.equal(log.pruneAgentEvents(now, 1), 0, 'no window and no row cap');
  assert.equal(chain.verifyRecord().entries, 3);
  set(90);
  assert.equal(log.pruneAgentEvents(now), 1);
  set(30);
  assert.equal(log.pruneAgentEvents(now), 1);
  const r = chain.verifyRecord();
  assert.equal(r.ok, true, r.words);
  assert.equal(r.entries, 1);
  assert.equal(r.trimmedThrough, 2);
});
