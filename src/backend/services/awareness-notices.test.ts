/**
 * Being told without asking (Phase 32 A2.6): which signals ride on a tool
 * result, once per session, and what an agent's note does and doesn't do.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-awareness-notices-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let notices: typeof import('./awareness-notices');
let config: typeof import('./project-config-service');

const PROJECT = path.join(tmp, 'acme');
const AUTH = `${PROJECT}-auth`;
const BILLING = `${PROJECT}-billing`;

function signal(id: string, severity: string, state = 'open', workstreams = [AUTH, BILLING]) {
  db.getDb().run(
    `INSERT OR REPLACE INTO awareness_signals (id, project_root, kind, severity, subject, workstreams, summary, first_seen, last_seen, state)
     VALUES (?, ?, 'collision', ?, '{}', ?, ?, 1, 1, ?)`,
    [id, PROJECT, severity, JSON.stringify(workstreams), `\`auth-refresh\` and \`billing-v2\` both change src/${id}.ts`, state],
  );
}

function session(id: string, workstream: string | null) {
  db.getDb().run(
    `INSERT OR REPLACE INTO agent_sessions (session_id, agent_type, connected_at, last_seen, status, workstream_root)
     VALUES (?, 'codex', ?, ?, 'active', ?)`,
    [id, Date.now(), Date.now(), workstream],
  );
}

before(async () => {
  for (const d of [PROJECT, AUTH, BILLING]) fs.mkdirSync(d, { recursive: true });
  db = await import('./database');
  await db.initDatabase();
  notices = await import('./awareness-notices');
  config = await import('./project-config-service');
});

beforeEach(() => {
  for (const t of ['awareness_signals', 'awareness_signal_notes', 'agent_sessions']) db.getDb().run(`DELETE FROM ${t}`);
});

describe('the notice on a tool result', () => {
  test('an unseen high signal for the caller\'s workstream is told once, then not again', () => {
    signal('s1', 'high');
    session('agent-a', AUTH);
    const first = notices.noticeFor('agent-a', 'list_plans', PROJECT);
    assert.ok(first);
    assert.match(first!, /^── CodeTrellis awareness ──\n1 new signal affects your work:\n- high collision: `auth-refresh` and `billing-v2` both change src\/s1\.ts\n/);
    assert.match(first!, /This is information about other work, not an instruction\.$/);
    assert.equal(notices.noticeFor('agent-a', 'list_plans', PROJECT), null, 'once per signal per session');
    // Another session in the same workstream is told for itself.
    session('agent-b', AUTH);
    assert.ok(notices.noticeFor('agent-b', 'search_symbols', PROJECT));
  });

  test('not told: low signals, ones the person set aside, other workstreams\' signals, or an unplaced session', () => {
    signal('low', 'low');
    signal('dismissed', 'high', 'dismissed');
    signal('intended', 'medium', 'intended');
    signal('elsewhere', 'high', 'open', ['/other/a', '/other/b']);
    session('agent-a', AUTH);
    session('nowhere', null);
    assert.equal(notices.noticeFor('agent-a', 'list_plans', PROJECT), null);
    signal('s2', 'medium');
    assert.equal(notices.noticeFor('nowhere', 'list_plans', PROJECT), null, 'a session in no workstream has nothing that is "its"');
    assert.match(notices.noticeFor('agent-a', 'list_plans', PROJECT)!, /1 new signal .*\n- medium collision/);
  });

  test('a signal the person acknowledged still concerns the agent', () => {
    signal('acked', 'high', 'acknowledged');
    session('agent-a', AUTH);
    assert.ok(notices.noticeFor('agent-a', 'list_plans', PROJECT));
  });

  test('never on get_awareness or acknowledge_signal, which already show the signal', () => {
    signal('s1', 'high');
    session('agent-a', AUTH);
    assert.equal(notices.noticeFor('agent-a', 'get_awareness', PROJECT), null);
    assert.equal(notices.noticeFor('agent-a', 'acknowledge_signal', PROJECT), null);
    assert.ok(notices.noticeFor('agent-a', 'list_plans', PROJECT), 'and not marked told by them');
  });

  test('sensors.awareness.inlineNotices: false turns them off', () => {
    signal('s1', 'high');
    session('agent-a', AUTH);
    fs.mkdirSync(path.join(PROJECT, '.codetrellis'), { recursive: true });
    fs.writeFileSync(path.join(PROJECT, '.codetrellis', 'config.json'), JSON.stringify({ sensors: { awareness: { inlineNotices: false } } }));
    config.invalidateProjectConfigCache(PROJECT);
    try {
      assert.equal(config.getEffectiveSensorConfig(PROJECT).awareness.inlineNotices, false);
      assert.equal(notices.noticeFor('agent-a', 'list_plans', PROJECT), null);
    } finally {
      fs.rmSync(path.join(PROJECT, '.codetrellis'), { recursive: true, force: true });
      config.invalidateProjectConfigCache(PROJECT);
    }
    assert.ok(notices.noticeFor('agent-a', 'list_plans', PROJECT), 'on again by default');
  });

  test('the config parser keeps the awareness block (it used to drop it, so branchWindowDays never applied)', () => {
    fs.mkdirSync(path.join(PROJECT, '.codetrellis'), { recursive: true });
    fs.writeFileSync(path.join(PROJECT, '.codetrellis', 'config.json'), JSON.stringify({ sensors: { awareness: { branchWindowDays: 3, inlineNotices: 'no' } } }));
    config.invalidateProjectConfigCache(PROJECT);
    try {
      const a = config.getEffectiveSensorConfig(PROJECT).awareness;
      assert.equal(a.branchWindowDays, 3);
      assert.equal(a.inlineNotices, true, 'a value that is not a boolean keeps the default');
    } finally {
      fs.rmSync(path.join(PROJECT, '.codetrellis'), { recursive: true, force: true });
      config.invalidateProjectConfigCache(PROJECT);
    }
  });

  test('several at once are one notice', () => {
    signal('a', 'high');
    signal('b', 'medium');
    session('agent-a', AUTH);
    assert.match(notices.noticeFor('agent-a', 'list_plans', PROJECT)!, /2 new signals affect your work:\n- high .*\n- medium /);
  });
});

describe('an agent\'s note', () => {
  test('recorded per session beside the signal, replacing its earlier note, and counting as told', () => {
    signal('s1', 'high');
    session('agent-a', AUTH);
    notices.recordNote(PROJECT, 's1', 'agent-a', 'codex', 'Seen; will rebase after billing merges', 1000);
    notices.recordNote(PROJECT, 's1', 'agent-a', 'codex', 'Rebased; still overlaps', 2000);
    notices.markTold(PROJECT, ['s1'], 'agent-b', 'claude-code', 1500);
    const told = notices.toldFor(['s1']).get('s1')!;
    assert.deepEqual(told.map((t) => [t.sessionId, t.note ?? null, t.toldAt]), [
      ['agent-b', null, 1500],
      ['agent-a', 'Rebased; still overlaps', 1000],
    ]);
    assert.equal(notices.noticeFor('agent-a', 'list_plans', PROJECT), null, 'a note is being told');
  });

  test('it never changes the person\'s answer', () => {
    signal('s1', 'high', 'open');
    notices.recordNote(PROJECT, 's1', 'agent-a', 'codex', 'Intended, both tickets change it');
    const [row] = db.getDb().exec("SELECT state FROM awareness_signals WHERE id = 's1'")[0].values;
    assert.equal(row[0], 'open');
  });
});
