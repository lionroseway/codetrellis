/**
 * The agent event log (Phase 32 B1): what is kept, how it is stamped, what
 * is masked, and how long it lasts.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-agent-event-log-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let log: typeof import('./agent-event-log');

const AUTH = '/w/app-auth';

function session(id: string, agentType: string, workstream: string | null, status = 'active') {
  db.getDb().run(
    `INSERT OR REPLACE INTO agent_sessions (session_id, agent_type, connected_at, last_seen, status, workstream_root)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, agentType, Date.now(), Date.now(), status, workstream],
  );
}

const event = (over: Partial<AgentEvent> & { payload?: Record<string, unknown> }): AgentEvent => ({
  id: log.eventId('t'), timestamp: 1_000, source: 'mcp', type: 'tool_call', payload: {}, ...over,
});

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  log = await import('./agent-event-log');
});

beforeEach(() => {
  for (const t of ['agent_events', 'agent_sessions']) db.getDb().run(`DELETE FROM ${t}`);
});

describe('what is kept', () => {
  test('a tool call is stamped with its session\'s agent and workstream, which the broadcast did not carry', () => {
    session('s-1', 'codex', AUTH);
    log.recordAgentEvent(event({ payload: { tool: 'list_plans', args: '{}', sessionId: 's-1', phase: 'complete', durationMs: 4 } }));
    const [e] = log.listAgentEvents();
    assert.equal(e.sessionId, 's-1');
    assert.equal(e.agentType, 'codex');
    assert.equal(e.workstreamRoot, AUTH);
    assert.equal(e.payload.tool, 'list_plans');
  });

  test('a session that has ended still names its workstream: session_end is logged after it goes inactive', () => {
    session('s-2', 'claude-code', AUTH, 'inactive');
    log.recordAgentEvent(event({ type: 'session_end', payload: { sessionId: 's-2' } }));
    assert.equal(log.listAgentEvents()[0].workstreamRoot, AUTH);
  });

  test('a watcher event keeps the workstream it names, and is Claude Code\'s', () => {
    log.recordAgentEvent(event({ source: 'claude-code-watcher', type: 'file_changed', payload: { file: 'a.ts', sessionId: 'cc-9', workstreamRoot: '/w/app-billing' } }));
    const [e] = log.listAgentEvents();
    assert.equal(e.workstreamRoot, '/w/app-billing');
    assert.equal(e.agentType, 'claude-code');
  });

  test('a session bound after its first calls were logged adopts them, and nothing already placed moves', async () => {
    session('s-late', 'codex', null);
    log.recordAgentEvent(event({ payload: { tool: 'list_plans', sessionId: 's-late' } }));
    log.recordAgentEvent(event({ source: 'claude-code-watcher', payload: { sessionId: 's-late', workstreamRoot: '/w/elsewhere' } }));
    assert.equal(log.listAgentEvents()[0].workstreamRoot, null);
    const sessions = await import('./session-service');
    sessions.bindSession('s-late', AUTH);
    assert.deepEqual(log.listAgentEvents().map((e) => e.workstreamRoot), [AUTH, '/w/elsewhere']);
  });

  test('the same event twice is one row; a malformed one is ignored, never thrown', () => {
    const e = event({});
    log.recordAgentEvent(e);
    log.recordAgentEvent(e);
    assert.equal(log.recordAgentEvent(null as unknown as AgentEvent), null);
    assert.equal(log.listAgentEvents().length, 1);
  });

  test('ids carry this launch, so a stored event never collides with a live one after a restart', () => {
    const a = log.eventId('mcp-tool');
    const b = log.eventId('mcp-tool');
    assert.match(a, /^mcp-tool-[0-9a-f]{8}-\d+$/);
    assert.notEqual(a, b);
  });

  test('an oversized payload is cut, not dropped', () => {
    log.recordAgentEvent(event({ payload: { summary: 'x'.repeat(10_000) } }));
    const [e] = log.listAgentEvents();
    assert.equal(e.payload.truncated, true);
    assert.equal(String(e.payload.text).length, log.MAX_PAYLOAD_CHARS);
  });
});

describe('what is masked', () => {
  test('values under secret-sounding keys, in JSON and key=value form', () => {
    assert.equal(log.redactSecrets('{"apiKey":"abc123xyz","name":"ok"}'), '{"apiKey":"[redacted]","name":"ok"}');
    assert.equal(log.redactSecrets('{"github_token": "ghx"}'), '{"github_token": "[redacted]"}');
    assert.equal(log.redactSecrets('curl -H password=hunter2 x'), 'curl -H password=[redacted] x');
    assert.equal(log.redactSecrets('{"tokens":12}'), '{"tokens":[redacted]}', 'a key that says token is masked even when harmless: over-masking is the safe side');
  });

  test('token formats wherever they appear, and this launch\'s capability token', () => {
    const cap = 'f'.repeat(64);
    // Fakes, assembled at run time so no secret-shaped literal is committed
    // (the secret scan reads every commit, and rightly flags one).
    const fake = (prefix: string, body: string) => prefix + body;
    const aws = fake('AKIA', 'ABCDEFGHIJKLMNOP');
    const text = `run with ${fake('sk-ant-', 'api03-' + 'a'.repeat(30))} and ${fake('gh' + 'p_', 'b'.repeat(36))} and ${aws} against ${cap}`;
    assert.equal(log.redactSecrets(text, [cap]), 'run with [redacted] and [redacted] and [redacted] against [redacted]');
  });

  test('what is stored is masked', () => {
    log.recordAgentEvent(event({ payload: { tool: 'x', args: '{"password":"hunter2"}' } }));
    assert.equal(log.listAgentEvents()[0].payload.args, '{"password":"[redacted]"}');
  });

  test('ordinary arguments are left as they are', () => {
    const args = '{"uid":"8c473f17-d2c6-4973-899f-9e700aaf2169","path":"src/session.ts","expected_hash":"' + 'a'.repeat(64) + '"}';
    assert.equal(log.redactSecrets(args), args);
  });
});

describe('reading it back', () => {
  test('oldest first, the most recent `limit`, filtered by time, session or workstream', () => {
    session('s-a', 'codex', AUTH);
    session('s-b', 'claude-code', '/w/app-billing');
    for (let i = 1; i <= 6; i++) log.recordAgentEvent(event({ timestamp: i * 100, payload: { n: i, sessionId: i % 2 ? 's-a' : 's-b' } }));
    assert.deepEqual(log.listAgentEvents({ limit: 3 }).map((e) => e.payload.n), [4, 5, 6]);
    assert.deepEqual(log.listAgentEvents({ since: 300 }).map((e) => e.payload.n), [4, 5, 6]);
    assert.deepEqual(log.listAgentEvents({ before: 300 }).map((e) => e.payload.n), [1, 2]);
    assert.deepEqual(log.listAgentEvents({ sessionId: 's-a' }).map((e) => e.payload.n), [1, 3, 5]);
    assert.deepEqual(log.listAgentEvents({ workstreamRoot: '/w/app-billing' }).map((e) => e.payload.n), [2, 4, 6]);
    assert.equal(log.listAgentEvents({ limit: 1_000_000 }).length, 6, 'a huge limit is capped, not refused');
  });
});

describe('how long it lasts', () => {
  test('older than the retention window goes; so do the oldest past the row cap', () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    const day = 24 * 60 * 60 * 1000;
    log.recordAgentEvent(event({ timestamp: now - (log.RETENTION_DAYS + 1) * day, payload: { n: 'old' } }));
    for (let i = 1; i <= 4; i++) log.recordAgentEvent(event({ timestamp: now - i * 1000, payload: { n: i } }));
    assert.equal(log.pruneAgentEvents(now, 3), 2);
    assert.deepEqual(log.listAgentEvents().map((e) => e.payload.n), [3, 2, 1]);
  });
});

describe('the tap', () => {
  test('keeps agent events from the broadcast and nothing else, until stopped', () => {
    let listener: ((m: { type: string; payload: unknown }) => void) | null = null;
    const stop = log.startAgentEventLog((l) => { listener = l; return () => { listener = null; }; }, () => ['s'.repeat(16)]);
    listener!({ type: 'agent-event', payload: event({ payload: { args: `token ${'s'.repeat(16)}` } }) });
    listener!({ type: 'plan-updated', payload: { uid: 'p' } });
    assert.equal(log.listAgentEvents().length, 1);
    assert.equal(log.listAgentEvents()[0].payload.args, 'token [redacted]');
    stop();
    assert.equal(listener, null);
  });
});

describe('what the app records itself (B1.2)', () => {
  const edit = { kind: 'document' as const, planUid: 'p1', uid: 'd1', title: 'Token rotation', version: 3, author: 'Sam', authorType: 'human' };

  test('a body edit is published as a spec_edited event, labelled by who made it', () => {
    const sent: Array<{ type: string; payload: AgentEvent }> = [];
    log.setEventPublisher((type, payload) => sent.push({ type, payload: payload as AgentEvent }));
    try {
      log.recordBodyEdit(edit);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].type, 'agent-event');
      assert.match(sent[0].payload.id, /^app-[0-9a-f]{8}-\d+$/);
      assert.equal(sent[0].payload.source, 'app');
      assert.equal(sent[0].payload.type, 'spec_edited');
      assert.deepEqual(sent[0].payload.payload, { ...edit, agentType: 'human' });
    } finally {
      log.setEventPublisher(null);
    }
  });

  test('made inside an MCP tool, it carries that session and agent, so it joins the turn', () => {
    const sent: AgentEvent[] = [];
    log.setEventPublisher((_t, p) => sent.push(p as AgentEvent));
    try {
      log.withEventContext({ sessionId: 's-9', agentType: 'codex' }, () => log.recordBodyEdit({ ...edit, author: 'codex', authorType: 'agent' }));
      assert.equal(sent[0].payload.sessionId, 's-9');
      assert.equal(sent[0].payload.agentType, 'codex');
      log.recordBodyEdit(edit);
      assert.equal(sent[1].payload.sessionId, undefined, 'outside the tool, no session');
    } finally {
      log.setEventPublisher(null);
    }
  });

  test('with nothing to publish to, or a publisher that throws, the edit is not disturbed', () => {
    log.recordBodyEdit(edit);
    log.setEventPublisher(() => { throw new Error('down'); });
    try { log.recordBodyEdit(edit); } finally { log.setEventPublisher(null); }
  });
});

describe('criteria decided and checked, on the lane of the workstream the item is worked in (B2.2)', () => {
  const seed = () => {
    const db2 = db.getDb();
    db2.run(`DELETE FROM item_criteria`);
    db2.run(`DELETE FROM plan_items`);
    db2.run(`INSERT OR REPLACE INTO plans (uid, title, author, project_path, created_at, updated_at) VALUES ('p1', 'Plan', 'Sam', '/w/app', 1, 1)`);
    const item = (uid: string, title: string, session: string | null) => db2.run(
      `INSERT INTO plan_items (uid, plan_uid, kind, title, author, created_at, updated_at, assignee_session) VALUES (?, 'p1', 'action', ?, 'Sam', 1, 1, ?)`,
      [uid, title, session],
    );
    item('i-auth', 'Rotate tokens', 's-auth');
    item('i-free', 'Write docs', null);
    db2.run(`INSERT INTO item_criteria (uid, item_uid, text, author, author_type, created_at, updated_at) VALUES ('c1', 'i-auth', 'Old tokens are refused', 'Sam', 'human', 1, 1)`);
    session('s-auth', 'codex', AUTH);
  };

  test('the workstream is read from who holds the item now; nobody, none', () => {
    seed();
    assert.equal(log.workstreamOfItem('i-auth'), AUTH);
    assert.equal(log.workstreamOfItem('i-free'), null);
    assert.equal(log.workstreamOfItem('nope'), null);
  });

  test('a decision names the criterion, the item and the workstream, labelled by who decided', () => {
    seed();
    const sent: AgentEvent[] = [];
    log.setEventPublisher((_t, p) => sent.push(p as AgentEvent));
    try {
      log.recordCriterionDecision({ criterionUid: 'c1', decision: 'sent_back', actor: 'Sam', actorType: 'human', channel: 'desktop' });
      log.recordCriterionDecision({ criterionUid: 'missing', decision: 'approved', actor: 'Sam', actorType: 'human', channel: 'desktop' });
    } finally {
      log.setEventPublisher(null);
    }
    assert.equal(sent.length, 1, 'an unknown criterion records nothing');
    assert.equal(sent[0].type, 'criterion_decided');
    assert.deepEqual(sent[0].payload, {
      criterionUid: 'c1', itemUid: 'i-auth', itemTitle: 'Rotate tokens', planUid: 'p1', text: 'Old tokens are refused',
      decision: 'sent_back', actor: 'Sam', actorType: 'human', channel: 'desktop', workstreamRoot: AUTH, agentType: 'human',
    });
  });

  test('a check run is one event per workstream, counting a failing check or a stale criterion as trouble', () => {
    seed();
    const sent: AgentEvent[] = [];
    log.setEventPublisher((_t, p) => sent.push(p as AgentEvent));
    try {
      log.recordCheckRun({
        runUid: 'r1', planUid: 'p1', trigger: 'manual', by: 'Sam', byType: 'human',
        outcomes: [
          { itemUid: 'i-auth', ok: true, state: 'met', text: 'a' },
          { itemUid: 'i-auth', ok: true, state: 'stale', text: 'b went stale' },
          { itemUid: 'i-auth', ok: false, state: 'open', text: 'c fails' },
          { itemUid: 'i-free', ok: true, state: 'open', text: 'd' },
        ],
      });
    } finally {
      log.setEventPublisher(null);
    }
    const byRoot = Object.fromEntries(sent.map((e) => [String(e.payload.workstreamRoot ?? 'none'), e.payload]));
    assert.deepEqual(Object.keys(byRoot).sort(), [AUTH, 'none'].sort());
    assert.deepEqual(
      { passed: byRoot[AUTH].passed, failed: byRoot[AUTH].failed, failing: byRoot[AUTH].failing },
      { passed: 1, failed: 2, failing: ['b went stale', 'c fails'] },
    );
    assert.deepEqual({ passed: byRoot.none.passed, failed: byRoot.none.failed }, { passed: 1, failed: 0 });
  });
});
