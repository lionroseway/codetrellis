/**
 * Proof that a task's skill was used (Phase 32 C1.3): a use is stored against
 * the tasks a Claude Code session in the same workstream is working, and read
 * back as used, not used, or unknown — never "not used" for an agent that
 * cannot say, and nothing at all for a task nobody has started.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Skill } from '../../shared/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-skill-use-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let svc: typeof import('./skill-use-service');

const AUTH = '/w/app-auth';
const BILL = '/w/app-billing';

function session(id: string, agentType: string, workstream: string) {
  db.getDb().run(
    `INSERT OR REPLACE INTO agent_sessions (session_id, agent_type, connected_at, last_seen, status, workstream_root) VALUES (?, ?, 1, 1, 'active', ?)`,
    [id, agentType, workstream],
  );
}
function item(uid: string, status: string, assignee: string | null) {
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, author, created_at, updated_at, status, assignee_session) VALUES (?, 'p1', 'action', ?, 'Sam', 1, 1, ?, ?)`,
    [uid, `Task ${uid}`, status, assignee],
  );
}

const wanted: Skill[] = [
  { name: 'pr-review', source: 'skill', required: false, use: 'recommended' },
  { name: 'typescript', source: 'lang', required: true },
  { name: 'nice-to-know', source: 'skill', required: false },
];

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  svc = await import('./skill-use-service');
});

beforeEach(() => {
  for (const t of ['skill_uses', 'plan_items', 'agent_sessions']) db.getDb().run(`DELETE FROM ${t}`);
  db.getDb().run(`INSERT OR REPLACE INTO plans (uid, title, author, project_path, created_at, updated_at) VALUES ('p1', 'Plan', 'Sam', '/w/app', 1, 1)`);
});

test('which agents are Claude Code: the watcher\'s own client, not Claude Desktop or others', () => {
  for (const t of ['claude-code', 'claude', 'Claude-Code']) assert.equal(svc.isClaudeCode(t), true, t);
  for (const t of ['claude-desktop', 'codex', 'cursor', 'mcp-agent', null, undefined, '']) {
    assert.equal(svc.isClaudeCode(t), false, String(t));
  }
});

test('a skill loaded is stored against the tasks Claude Code sessions in that workstream are working, and only those', () => {
  session('mcp-auth', 'claude-code', AUTH);
  session('mcp-bill', 'claude-code', BILL);
  session('mcp-codex', 'codex', AUTH);
  item('t1', 'in_progress', 'mcp-auth');
  item('t2', 'assigned', 'mcp-auth');
  item('t3', 'done', 'mcp-auth');       // finished: not being worked
  item('t4', 'in_progress', 'mcp-bill'); // another workstream
  item('t5', 'in_progress', 'mcp-codex'); // not Claude Code

  const told = svc.recordSkillUse({ skill: 'pr-review', sessionId: 'cc-1', workstreamRoot: AUTH, at: 5 });
  assert.deepEqual(told.sort(), ['t1', 't2']);
  assert.deepEqual([...svc.skillUsesOf('t1')], [['pr-review', 5]]);
  assert.equal(svc.skillUsesOf('t4').size, 0);
  assert.equal(svc.skillUsesOf('t5').size, 0);
  // Nothing worked there, or no workstream: nothing stored.
  assert.deepEqual(svc.recordSkillUse({ skill: 'pr-review', sessionId: 'cc-2', workstreamRoot: '/w/nowhere' }), []);
  assert.deepEqual(svc.recordSkillUse({ skill: 'pr-review', sessionId: 'cc-2', workstreamRoot: null }), []);
  assert.deepEqual(svc.recordSkillUse({ skill: '  ', sessionId: 'cc-2', workstreamRoot: AUTH }), []);
});

test('read back: used, not used while Claude Code works it, unknown for other agents, nothing before anyone starts', () => {
  session('mcp-auth', 'claude-code', AUTH);
  session('mcp-codex', 'codex', BILL);
  item('cc', 'in_progress', 'mcp-auth');
  item('other', 'in_progress', 'mcp-codex');
  item('fresh', 'pending', null);
  svc.recordSkillUse({ skill: 'pr-review', sessionId: 'cc-1', workstreamRoot: AUTH });

  assert.deepEqual([...svc.skillProof({ uid: 'cc' }, wanted)!], [['pr-review', 'used'], ['typescript', 'not_used']]);
  assert.deepEqual([...svc.skillProof({ uid: 'other' }, wanted)!], [['pr-review', 'unknown'], ['typescript', 'unknown']]);
  assert.equal(svc.skillProof({ uid: 'fresh' }, wanted), null);
});

test('a plugin\'s skill loaded as plugin:name counts for the skill of that name', () => {
  session('mcp-auth', 'claude-code', AUTH);
  item('cc', 'in_progress', 'mcp-auth');
  svc.recordSkillUse({ skill: 'pr-toolkit:pr-review', sessionId: 'cc-1', workstreamRoot: AUTH });
  assert.equal(svc.skillProof({ uid: 'cc' }, wanted)!.get('pr-review'), 'used');
});

test('any client (A8.4): a get_skill read is stored against that session\'s own working tasks, labelled mcp', () => {
  session('codex-1', 'codex', AUTH);
  session('codex-2', 'codex', AUTH);
  item('t1', 'in_progress', 'codex-1');
  item('t2', 'done', 'codex-1');
  item('t3', 'in_progress', 'codex-2');
  assert.deepEqual(svc.recordSkillRead({ skill: 'pr-review', sessionId: 'codex-1', workstreamRoot: AUTH }), ['t1']);
  assert.equal(svc.skillProof({ uid: 't1' }, wanted)?.get('pr-review'), 'used');
  assert.equal(svc.skillProof({ uid: 't3' }, wanted)?.get('pr-review'), 'unknown');
  assert.deepEqual([...svc.skillUseSources('t1')], [['pr-review', 'mcp']]);
  // Nothing claimed: nothing stored.
  assert.deepEqual(svc.recordSkillRead({ skill: 'pr-review', sessionId: 'nobody', workstreamRoot: AUTH }), []);
});

test('how a use was seen: the first source, by name or as a plugin\'s', () => {
  session('cc', 'claude-code', BILL);
  item('t9', 'in_progress', 'cc');
  svc.recordSkillUse({ skill: 'house:pr-review', sessionId: 'cc', workstreamRoot: BILL, at: 1 });
  svc.recordSkillRead({ skill: 'pr-review', sessionId: 'cc', workstreamRoot: BILL, at: 2 });
  const sources = svc.skillUseSources('t9');
  assert.equal(svc.sourceOf(sources, 'pr-review'), 'mcp');
  assert.equal(svc.sourceOf(new Map([['house:pr-review', 'session_log']]), 'pr-review'), 'session_log');
  assert.equal(svc.sourceOf(sources, 'nope'), null);
});
