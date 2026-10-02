/**
 * register_session updates a session in place (Phase 32 bug 2).
 *
 * It used `INSERT OR REPLACE`, which deletes the row and writes a new one: an
 * agent that connected, set a plan active, and then called register_session
 * to say what it was lost the active plan and its terminal link.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-session-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let db: typeof import('./database');
let sessions: typeof import('./session-service');
const PLAN = 'a0a00000-0000-4000-8000-000000000002';

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  sessions = await import('./session-service');
  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Parallel work', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, tmp, now, now],
  );
});

const row = (id: string) => {
  const r = db.getDb().exec(
    `SELECT agent_type, model, active_plan_uid, host_terminal_id, capabilities, connected_at FROM agent_sessions WHERE session_id = ?`,
    [id],
  )[0]?.values[0];
  return r && { agentType: r[0], model: r[1], activePlan: r[2], terminal: r[3], capabilities: JSON.parse(String(r[4] ?? '[]')), connectedAt: r[5] };
};

test('re-registering keeps the active plan, the terminal, the model, the capabilities and when it connected', async () => {
  sessions.registerSession('s-1', 'mcp-client', 'opus', [{ name: 'git', source: 'mcp' }] as never, 'term-7');
  sessions.setActivePlan('s-1', PLAN);
  const first = row('s-1')!;
  await new Promise((r) => setTimeout(r, 5));

  // The agent says what it is, naming nothing else.
  sessions.registerSession('s-1', 'claude-code');

  const after = row('s-1')!;
  assert.equal(after.agentType, 'claude-code');
  assert.equal(after.activePlan, PLAN);
  assert.equal(after.terminal, 'term-7');
  assert.equal(after.model, 'opus');
  assert.deepEqual(after.capabilities, [{ name: 'git', source: 'mcp' }]);
  assert.equal(after.connectedAt, first.connectedAt);
});

test('what a re-registration does name replaces what was there', () => {
  sessions.registerSession('s-2', 'claude-code', 'sonnet', [], 'term-1');
  sessions.registerSession('s-2', 'claude-code', 'opus', [{ name: 'python', source: 'lang' }] as never, 'term-2');
  const after = row('s-2')!;
  assert.equal(after.model, 'opus');
  assert.equal(after.terminal, 'term-2');
  assert.deepEqual(after.capabilities, [{ name: 'python', source: 'lang' }]);
});
