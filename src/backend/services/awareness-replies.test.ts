/**
 * A person's message to the agents about a signal (Phase 32 A4.1): kept
 * beside the signal, read once by each session in its workstreams on its next
 * tool call, in words that say who sent it; the tasks held there get a steer.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-awareness-replies-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let replies: typeof import('./awareness-replies');

const PROJECT = path.join(tmp, 'acme');
const AUTH = `${PROJECT}-auth`;
const BILLING = `${PROJECT}-billing`;
const DESK = { actor: 'sam@acme.dev', actorType: 'human' as const, channel: 'desktop' as const };

function signal(id: string, state = 'open', workstreams = [AUTH, BILLING]) {
  db.getDb().run(
    `INSERT OR REPLACE INTO awareness_signals (id, project_root, kind, severity, subject, workstreams, summary, first_seen, last_seen, state)
     VALUES (?, ?, 'contract', 'high', '{}', ?, ?, 1, 1, ?)`,
    [id, PROJECT, JSON.stringify(workstreams), `\`billing-v2\` changed createInvoice's signature; \`auth-refresh\` imports it`, state],
  );
}

function session(id: string, workstream: string | null, agentType = 'codex') {
  db.getDb().run(
    `INSERT OR REPLACE INTO agent_sessions (session_id, agent_type, connected_at, last_seen, status, workstream_root)
     VALUES (?, ?, ?, ?, 'active', ?)`,
    [id, agentType, Date.now(), Date.now(), workstream],
  );
}

before(async () => {
  for (const d of [PROJECT, AUTH, BILLING]) fs.mkdirSync(d, { recursive: true });
  db = await import('./database');
  await db.initDatabase();
  replies = await import('./awareness-replies');
});

beforeEach(() => {
  for (const t of ['awareness_signals', 'awareness_signal_replies', 'awareness_signal_reply_reads', 'agent_sessions', 'plan_items']) {
    db.getDb().run(`DELETE FROM ${t}`);
  }
});

describe('the words', () => {
  test('a message is 1 to 1000 characters, trimmed', () => {
    assert.equal(replies.cleanReply('  keep the old signature  '), 'keep the old signature');
    assert.equal(replies.cleanReply('   '), null);
    assert.equal(replies.cleanReply(42), null);
    assert.equal(replies.cleanReply('x'.repeat(1001)), null);
    assert.equal(replies.cleanReply('x'.repeat(1000))?.length, 1000);
  });

  test('the block quotes the person under the signal it is about, and says who sent it', () => {
    const text = replies.replyText([{
      signal: { id: 's1', severity: 'high', kind: 'contract', summary: 'billing-v2 changed createInvoice' },
      reply: { message: 'Keep the old signature\nuntil checkout moves', by: DESK },
    }]);
    assert.equal(text, [
      '── CodeTrellis: a message about other work ──',
      'About high contract s1: billing-v2 changed createInvoice',
      'From the person, from the CodeTrellis window:',
      '> Keep the old signature',
      '> until checkout moves',
      'Answer with acknowledge_signal(id, note) to say what you will do.',
    ].join('\n'));
    const phone = replies.replyText([{ signal: { id: 's1', severity: 'high', kind: 'contract', summary: 'x' }, reply: { message: 'hi', by: { ...DESK, channel: 'phone' } } }]);
    assert.match(phone, /From the person, from their phone:/);
    const plain = replies.replyText([{ signal: { id: 's1', severity: 'high', kind: 'contract', summary: 'x' }, reply: { message: 'hi', by: { ...DESK, actorType: 'unverified', channel: 'local-api' } } }]);
    assert.match(plain, /From sent through the local API, not verified as the person:/);
  });
});

describe('recording and delivering', () => {
  test('only a live signal of this project takes a reply', () => {
    signal('gone', 'resolved');
    assert.equal(replies.recordReply(PROJECT, 'gone', 'hello', DESK), null);
    assert.equal(replies.recordReply(PROJECT, 'nope', 'hello', DESK), null);
    signal('s1');
    assert.equal(replies.recordReply('/elsewhere', 's1', 'hello', DESK), null);
    const kept = replies.recordReply(PROJECT, 's1', 'hello', DESK, 1000);
    assert.ok(kept);
    assert.deepEqual(kept!.reply, { id: kept!.reply.id, message: 'hello', by: DESK, at: 1000, readBy: [] });
  });

  test('each session in either workstream reads it once, on its next call; others never', () => {
    signal('s1');
    session('codex-auth', AUTH);
    session('claude-billing', BILLING, 'claude-code');
    session('elsewhere', `${PROJECT}-exports`);
    session('unplaced', null);
    replies.recordReply(PROJECT, 's1', 'Keep the old signature', DESK, 1000);

    const first = replies.replyNoticeFor('codex-auth', PROJECT, 2000);
    assert.match(first!, /> Keep the old signature/);
    assert.equal(replies.replyNoticeFor('codex-auth', PROJECT, 2001), null, 'once per session');
    assert.ok(replies.replyNoticeFor('claude-billing', PROJECT, 3000));
    assert.equal(replies.replyNoticeFor('elsewhere', PROJECT), null);
    assert.equal(replies.replyNoticeFor('unplaced', PROJECT), null);
    assert.equal(replies.replyNoticeFor('codex-auth', null), null);

    // A later reply is delivered by itself.
    replies.recordReply(PROJECT, 's1', 'Actually, go ahead', DESK, 4000);
    const second = replies.replyNoticeFor('codex-auth', PROJECT, 5000)!;
    assert.match(second, /> Actually, go ahead/);
    assert.doesNotMatch(second, /Keep the old signature/);

    const [r1, r2] = replies.repliesFor(['s1']).get('s1')!;
    assert.deepEqual(r1.readBy, [
      { sessionId: 'codex-auth', agentType: 'codex', readAt: 2000 },
      { sessionId: 'claude-billing', agentType: 'claude-code', readAt: 3000 },
    ]);
    assert.deepEqual(r2.readBy, [{ sessionId: 'codex-auth', agentType: 'codex', readAt: 5000 }]);
  });

  test('a reply sent while the signal was live still reaches the agent after it resolves', () => {
    signal('s1');
    session('codex-auth', AUTH);
    replies.recordReply(PROJECT, 's1', 'Stop before merging', DESK);
    db.getDb().run(`UPDATE awareness_signals SET state = 'resolved' WHERE id = 's1'`);
    assert.match(replies.replyNoticeFor('codex-auth', PROJECT)!, /Stop before merging/);
  });

  test('the tasks held in its workstreams are the steer\'s targets: unfinished ones, by agents placed there', () => {
    signal('s1');
    session('codex-auth', AUTH);
    session('elsewhere', `${PROJECT}-exports`);
    const item = (uid: string, plan: string, sessionId: string, status: string) => db.getDb().run(
      `INSERT INTO plan_items (uid, plan_uid, kind, title, status, assignee_session, author, created_at, updated_at)
       VALUES (?, ?, 'action', ?, ?, ?, 'test', 1, 1)`,
      [uid, plan, uid, status, sessionId],
    );
    for (const plan of ['p-1', 'p-2']) {
      db.getDb().run(`INSERT OR IGNORE INTO plans (uid, title, author, project_path, created_at, updated_at) VALUES (?, ?, 'test', ?, 1, 1)`, [plan, plan, PROJECT]);
    }
    item('i-work', 'p-1', 'codex-auth', 'in_progress');
    item('i-claimed', 'p-2', 'codex-auth', 'assigned');
    item('i-done', 'p-1', 'codex-auth', 'done');
    item('i-other', 'p-1', 'elsewhere', 'in_progress');
    assert.deepEqual(replies.recordReply(PROJECT, 's1', 'hi', DESK)!.tasks, [
      { planUid: 'p-1', itemUid: 'i-work' },
      { planUid: 'p-2', itemUid: 'i-claimed' },
    ]);
  });
});
