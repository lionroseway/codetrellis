/**
 * References — `task 9f2c41ab` — against a real database.
 *
 * The case this exists for: a person pastes "task 9f2c41ab isn't right" into
 * an agent chat, and the agent passes that straight to a tool.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatReference,
  formatReferenceLine,
  parseReference,
  shortId,
} from '../../shared/lib/references';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-refs-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let refs: typeof import('./reference-service');

const PLAN = '1c0d9e22-0000-4000-8000-000000000001';
const TASK = '9f2c41ab-1111-4000-8000-000000000002';
const PAGE = '9f2c41ab-2222-4000-8000-000000000003'; // shares TASK's first 8
const COMMENT = '7b3a55e0-3333-4000-8000-000000000004';
const REPLY = 'aa11bb22-4444-4000-8000-000000000005';
const now = Date.now();

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  refs = await import('./reference-service');
  const d = db.getDb();
  d.run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Board pack', 'in_progress', 't', 'human', '/repo', ?, ?)`,
    [PLAN, now, now],
  );
  for (const [uid, kind, title] of [[TASK, 'action', 'Q3 revenue summary'], [PAGE, 'object', 'Reporting guide']]) {
    d.run(
      `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'done', 't', 'human', ?, ?)`,
      [uid, PLAN, kind, title, now, now],
    );
  }
  d.run(
    `INSERT INTO comments (uid, target_type, target_uid, author, author_type, body, created_at)
     VALUES (?, 'item', ?, 'saif', 'human', 'EMEA figure is wrong — see Regional!C14', ?)`,
    [COMMENT, TASK, now],
  );
  d.run(
    `INSERT INTO comments (uid, target_type, target_uid, parent_uid, author, author_type, body, created_at)
     VALUES (?, 'item', ?, ?, 'claude-code', 'mcp', 'Fixed; re-cited C15', ?)`,
    [REPLY, TASK, COMMENT, now + 1],
  );
});

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('reference format', () => {
  test('a reference is a kind and the first eight hex of the uid', () => {
    assert.equal(shortId(TASK), '9f2c41ab');
    assert.equal(formatReference('task', TASK), 'task 9f2c41ab');
  });

  test('the copied line says what it is, in words an agent and a person both read', () => {
    assert.equal(
      formatReferenceLine({ kind: 'task', uid: TASK, title: 'Q3 revenue summary', within: { kind: 'plan', uid: PLAN, title: 'Board pack' } }),
      'task 9f2c41ab "Q3 revenue summary" (plan "Board pack")',
    );
    assert.equal(
      formatReferenceLine({ kind: 'comment', uid: COMMENT, within: { kind: 'task', uid: TASK } }),
      'comment 7b3a55e0 on task 9f2c41ab',
    );
  });

  test('parses what people actually paste, and nothing else', () => {
    for (const raw of ['task 9f2c41ab', 'task:9f2c41ab', 'Task 9F2C41AB', '#9f2c41ab', '9f2c41ab', '9f2c41ab-1111']) {
      assert.ok(parseReference(raw), raw);
    }
    assert.deepEqual(parseReference('task 9f2c41ab'), { kind: 'task', prefix: '9f2c41ab' });
    // A full uid needs no resolving; short or non-hex strings are not references.
    for (const raw of [TASK, '9f2c41a', 'nonexistent-uid', 'itm_abc12345', 'widget 9f2c41ab', '', 42]) {
      assert.equal(parseReference(raw), null, String(raw));
    }
  });
});

describe('resolving references in tool arguments', () => {
  test('a kind-qualified reference resolves to its full uid', () => {
    assert.deepEqual(refs.resolveReferenceArgs({ uid: 'task 9f2c41ab' }), { uid: TASK });
    assert.deepEqual(refs.resolveReferenceArgs({ uid: 'page 9f2c41ab' }), { uid: PAGE });
  });

  test('a bare prefix that two things share is refused with both named', () => {
    assert.throws(
      () => refs.resolveReferenceArgs({ uid: '9f2c41ab' }),
      (err: Error) => err instanceof refs.AmbiguousReferenceError
        && err.message.includes('task 9f2c41ab') && err.message.includes('page 9f2c41ab'),
    );
  });

  test('the argument name narrows a bare prefix', () => {
    assert.deepEqual(refs.resolveReferenceArgs({ plan_uid: '1c0d9e22' }), { plan_uid: PLAN });
    assert.deepEqual(refs.resolveReferenceArgs({ comment_uid: '7b3a55e0' }), { comment_uid: COMMENT });
    // item_uid may be a task or a page — both match here, so still ambiguous.
    assert.throws(() => refs.resolveReferenceArgs({ item_uid: '9f2c41ab' }));
    // A longer prefix settles it.
    assert.deepEqual(refs.resolveReferenceArgs({ item_uid: '9f2c41ab-2222' }), { item_uid: PAGE });
  });

  test('arrays of uids resolve element by element', () => {
    assert.deepEqual(refs.resolveReferenceArgs({ plan_uids: ['plan 1c0d9e22', PLAN] }), { plan_uids: [PLAN, PLAN] });
  });

  test('anything that is not a reference, or names nothing, passes through untouched', () => {
    const args = { uid: TASK, title: '9f2c41ab', item_uid: 'deadbeef', project_path: '/repo' };
    assert.equal(refs.resolveReferenceArgs(args), args, 'same object: nothing changed');
    const unknown = { uid: 'task deadbeef' };
    assert.equal(refs.resolveReferenceArgs(unknown), unknown, "the tool reports its own 'not found'");
  });
});

describe('describing a reference', () => {
  test('a task comes with its plan, its state, and the notes people left on it', () => {
    const [match] = refs.findReferenceMatches({ kind: 'task', prefix: '9f2c41ab' });
    const d = refs.describeReference(match);
    assert.equal(d.reference, 'task 9f2c41ab');
    assert.equal(d.status, 'done');
    assert.equal(d.plan?.title, 'Board pack');
    assert.equal(d.notes[0].body, 'Fixed; re-cited C15', 'newest first');
    assert.ok(d.notes.some((n) => n.authorType === 'human' && n.body.includes('Regional!C14')));
  });

  test('a comment says what it is on, and carries its replies', () => {
    const [match] = refs.findReferenceMatches({ kind: 'comment', prefix: '7b3a55e0' });
    const d = refs.describeReference(match);
    assert.equal(d.on?.reference, 'task 9f2c41ab');
    assert.deepEqual(d.notes.map((n) => n.body), ['Fixed; re-cited C15']);
  });
});
