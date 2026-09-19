/**
 * "0/0 actions" on a plan that plainly has actions.
 *
 * `taskCount` / `completedTaskCount` counted the `tasks` table. Items have
 * lived in `plan_items` since the Object/Action model landed, and no modern
 * write path touches `tasks` — `add_item` and `bulk_add_items` both write
 * items. So every plan an agent has ever created reported 0/0, and that
 * number feeds the plan list's progress bar and count, the plan chip, the
 * minimised chip and two popovers.
 *
 * F13 noticed the contradiction in the V2 toolbar and fixed it THERE, by
 * deriving from the live item tree, leaving the stale field feeding
 * everything else — so the same screen showed "0/1 actions" in its header
 * and "0/0 actions" in its chip row. Found by driving the packaged app and
 * reading the screen.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-actioncount-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let db: typeof import('./database');
let plans: typeof import('./plan-service');

const PROJECT = '/repo';

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  plans = await import('./plan-service');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// No cleanup between tests: `createPlan` also writes a version row, so
// deleting plans trips a foreign key. Each test makes its own plan and
// looks it up by uid, which is isolation enough.
function newPlan(title: string): string {
  return plans.createPlan({ title, description: '', tasks: [] }, 'test', 'human', PROJECT).uid;
}

function addAction(planUid: string, uid: string, status: string): void {
  const now = Date.now();
  // Item uids are scoped to the plan: nothing is cleaned up between tests,
  // so a bare 'a' collides on the primary key.
  const scoped = `${planUid}:${uid}`;
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', ?, ?, 'test', 'human', ?, ?)`,
    [scoped, planUid, uid, status, now, now],
  );
}

describe('action counts come from the items that exist (V2)', () => {
  test('a plan with items reports them', () => {
    const uid = newPlan('Has items');
    addAction(uid, 'a', 'done');
    addAction(uid, 'b', 'pending');
    addAction(uid, 'c', 'pending');

    const listed = plans.listPlans(PROJECT).find((p) => p.uid === uid);
    assert.equal(listed?.taskCount, 3, 'the plan list said 0 for every agent-created plan');
    assert.equal(listed?.completedTaskCount, 1);
  });

  test('the detail view agrees with the list', () => {
    // These disagreeing is what put "0/1 actions" and "0/0 actions" on the
    // same screen.
    const uid = newPlan('Agreement');
    addAction(uid, 'a', 'done');
    addAction(uid, 'b', 'pending');

    const listed = plans.listPlans(PROJECT).find((p) => p.uid === uid);
    const detail = plans.getPlan(uid);
    assert.equal(detail?.taskCount, listed?.taskCount);
    assert.equal(detail?.completedTaskCount, listed?.completedTaskCount);
    assert.equal(detail?.taskCount, 2);
  });

  test('only ACTIONS count — objects are context, not work', () => {
    const uid = newPlan('Mixed');
    addAction(uid, 'a', 'pending');
    const now = Date.now();
    db.getDb().run(
      `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
       VALUES (?, ?, 'object', 'A page', 'pending', 'test', 'human', ?, ?)`,
      [`${uid}:obj`, uid, now, now],
    );
    assert.equal(plans.getPlan(uid)?.taskCount, 1);
  });

  test('an empty plan is 0/0, not a crash', () => {
    const uid = newPlan('Empty');
    assert.equal(plans.getPlan(uid)?.taskCount, 0);
    assert.equal(plans.getPlan(uid)?.completedTaskCount, 0);
  });
});

describe('legacy plans still count', () => {
  test('a pre-V2 plan with only tasks rows is not zeroed', () => {
    // The fallback exists so fixing the modern path does not break the old
    // one. Summing both would double-count anything migrated.
    const uid = newPlan('Legacy');
    const now = Date.now();
    for (const [t, status] of [['t1', 'done'], ['t2', 'pending']] as const) {
      db.getDb().run(
        `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
        [`${uid}:${t}`, uid, t, status, now, now],
      );
    }
    assert.equal(plans.getPlan(uid)?.taskCount, 2);
    assert.equal(plans.getPlan(uid)?.completedTaskCount, 1);
  });

  test('items win when a plan has both', () => {
    const uid = newPlan('Both');
    const now = Date.now();
    db.getDb().run(
      `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, created_at, updated_at)
       VALUES (?, ?, 0, 'old', 'done', ?, ?)`,
      [`${uid}:old`, uid, now, now],
    );
    addAction(uid, 'new1', 'pending');
    addAction(uid, 'new2', 'pending');
    // 2, not 3 — the legacy row is not added on top.
    assert.equal(plans.getPlan(uid)?.taskCount, 2);
  });
});
