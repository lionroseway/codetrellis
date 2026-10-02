/**
 * Two agents of one type are two claimants (Phase 32 bug 1).
 *
 * `claim_item` recorded the agent's TYPE as the assignee, and the overlap
 * check skipped items with the same assignee. So two Claude Code sessions
 * editing the same file in one plan never saw each other: exactly the case
 * parallel work is about. The claim now records the session, and overlap is
 * compared by session.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claim-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let items: typeof import('./plan-item-service');
const PLAN = 'a0a00000-0000-4000-8000-000000000001';

before(async () => {
  const db = await import('./database');
  await db.initDatabase();
  items = await import('./plan-item-service');
  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Parallel work', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, tmp, now, now],
  );
});

const action = (title: string, file: string) => items.createItem({
  planUid: PLAN, kind: 'action', title,
  fileSpecs: [{ path: file, action: 'modify' }],
  author: 't', authorType: 'human',
} as never);

test('a second Claude Code session claiming work on the same file is told about the first', () => {
  const a = action('Refresh tokens', 'src/auth/session.ts');
  const b = action('Rotate keys', 'src/auth/session.ts');

  const first = items.claimItem(a.uid, 'claude-code', 'claude-code', undefined, undefined, 'session-1');
  assert.equal(first.ok, true);
  assert.equal(items.getItem(a.uid)?.assigneeSession, 'session-1');

  const second = items.claimItem(b.uid, 'claude-code', 'claude-code', undefined, undefined, 'session-2');
  assert.equal(second.ok, true);
  assert.equal(second.conflicts?.length, 1, 'the same agent TYPE in another session is another claimant');
  assert.match(second.conflicts![0], /Refresh tokens.*src\/auth\/session\.ts/);
});

test('one session claiming two actions on the same file is not warned about itself', () => {
  const a = action('Split the module', 'src/billing/invoice.ts');
  const b = action('Rename the export', 'src/billing/invoice.ts');
  items.claimItem(a.uid, 'claude-code', 'claude-code', undefined, undefined, 'session-3');
  const again = items.claimItem(b.uid, 'claude-code', 'claude-code', undefined, undefined, 'session-3');
  assert.equal(again.ok, true);
  assert.equal(again.conflicts, undefined);
});

test('releasing a claim clears its session', () => {
  const a = action('Tidy', 'src/x.ts');
  items.claimItem(a.uid, 'claude-code', 'claude-code', undefined, undefined, 'session-4');
  items.updateItem(a.uid, { status: 'pending', assignee: null, author: 't', authorType: 'human' });
  assert.equal(items.getItem(a.uid)?.assigneeSession, null);
});
