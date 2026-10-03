/**
 * Timing attribution finds a session in the checkout whichever way the
 * checkout is spelled.
 *
 * Sessions are placed by the folder's realpath. A teammate's worktree opened
 * as its own project through a link (macOS's /var and /tmp are links) asked
 * in its opened spelling, so line history lost "probably codex" the moment
 * the worktree was opened (0.1.18 demo, code-history).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-attribution-')));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let attribution: typeof import('./commit-attribution');

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  attribution = await import('./commit-attribution');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a session placed at the realpath is found from the opened spelling, and the other way round', () => {
  const real = path.join(tmp, 'billing-v2');
  fs.mkdirSync(real);
  const link = path.join(tmp, 'billing-v2-link');
  fs.symlinkSync(real, link, 'dir');
  db.getDb().run(
    'INSERT INTO agent_sessions (session_id, agent_type, connected_at, last_seen, workstream_root) VALUES (?, ?, ?, ?, ?)',
    ['s-codex', 'codex', 1_000, 5_000, real],
  );

  const know = attribution.recordedKnowledge(link);
  assert.deepEqual(know.sessionAt(link, 3_000), { sessionId: 's-codex', agentType: 'codex' });
  assert.deepEqual(know.sessionAt(real, 3_000), { sessionId: 's-codex', agentType: 'codex' });
  assert.equal(know.sessionAt(path.join(tmp, 'elsewhere'), 3_000), null);
});
