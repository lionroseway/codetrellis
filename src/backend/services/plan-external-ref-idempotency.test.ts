/**
 * "Idempotent on the ticket key" was true only for the three trackers
 * whose keys we can parse.
 *
 * `set_plan_external_ref` advertises "calling it twice updates rather
 * than duplicating", and the service docstring names Jira, Linear, Azure
 * DevOps, GitHub Projects, Shortcut and a wiki page. `keyFromUrl`
 * recognises Jira, Linear and GitHub. For everything else the key is
 * null, the existing-ref lookup was skipped entirely, and a fresh row was
 * INSERTed on every call.
 *
 * The unique index on `(plan_uid, external_key)` does not catch it
 * either: SQLite treats NULLs as distinct, so nothing at any layer
 * objected. Three identical calls left three rows, and the chip rendered
 * three sibling links.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-planref-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let db: typeof import('./database');
let intake: typeof import('./external-intake-service');

const PLAN = 'pln_planref';
const AZURE = 'https://dev.azure.com/acme/proj/_workitems/edit/412';

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  intake = await import('./external-intake-service');

  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Ref idempotency', 'active', 'test', 'human', '/repo', ?, ?)`,
    [PLAN, now, now],
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().run(`DELETE FROM plan_external_refs WHERE plan_uid = ?`, [PLAN]);
});

const refs = () => intake.getPlanExternalRefs(PLAN);

describe('a ticket with no parsable key is still attached once (m7)', () => {
  test('three identical calls leave one row', () => {
    for (let i = 0; i < 3; i++) {
      intake.setPlanExternalRef({ planUid: PLAN, url: AZURE, title: 'Work item 412' });
    }
    assert.equal(refs().length, 1);
    assert.equal(refs()[0].externalKey, null);
  });

  test('a trailing slash is the same ticket', () => {
    // The difference a human pasting the same URL twice actually makes.
    intake.setPlanExternalRef({ planUid: PLAN, url: AZURE });
    intake.setPlanExternalRef({ planUid: PLAN, url: `${AZURE}/` });
    assert.equal(refs().length, 1);
  });

  test('a genuinely different ticket is a second row', () => {
    // The fix must deduplicate, not collapse. Two work items are two
    // refs however unparsable their URLs are.
    intake.setPlanExternalRef({ planUid: PLAN, url: AZURE });
    intake.setPlanExternalRef({
      planUid: PLAN,
      url: 'https://dev.azure.com/acme/proj/_workitems/edit/999',
    });
    assert.equal(refs().length, 2);
  });

  test('re-attaching updates the title rather than adding a row', () => {
    intake.setPlanExternalRef({ planUid: PLAN, url: AZURE, title: 'Old title' });
    intake.setPlanExternalRef({ planUid: PLAN, url: AZURE, title: 'Renamed in the tracker' });
    assert.equal(refs().length, 1);
    assert.equal(refs()[0].title, 'Renamed in the tracker');
  });

  test('a parsable key still dedupes on the key, not the URL', () => {
    // Jira URLs for one issue differ by trailing query; the key is the
    // stronger identity and stays the one that is used.
    intake.setPlanExternalRef({ planUid: PLAN, url: 'https://acme.atlassian.net/browse/PROJ-412' });
    intake.setPlanExternalRef({
      planUid: PLAN,
      url: 'https://acme.atlassian.net/browse/PROJ-412?filter=all',
    });
    assert.equal(refs().length, 1);
    assert.equal(refs()[0].externalKey, 'PROJ-412');
  });
});

describe('attribution of an attached ticket (m9)', () => {
  test('the service records the author it is given', () => {
    // The MCP handler now resolves `authorFromExtra` the way every other
    // write path in that file does; before, it passed nothing and the
    // service defaulted to 'human', so an agent's epic was
    // indistinguishable from the user attaching one by hand.
    intake.setPlanExternalRef({
      planUid: PLAN,
      url: AZURE,
      author: 'claude-code',
      authorType: 'mcp',
    });
    assert.equal(refs()[0].author, 'claude-code');
    assert.equal(refs()[0].authorType, 'mcp');
  });

  test('a ref attached with no author is still a human', () => {
    intake.setPlanExternalRef({ planUid: PLAN, url: AZURE });
    assert.equal(refs()[0].authorType, 'human');
  });
});

describe('an archived plan releases its ticket', () => {
  test('re-importing an epic works after its plan is deleted', async () => {
    // `deletePlan` is a soft delete. This lookup ignored status, so a
    // deleted plan kept its ticket and `create_plan_from_external` refused
    // the re-import — advising "delete it first" to someone who had.
    // Found by running the demo script a second time.
    const plans = await import('./plan-service');
    const uid = plans.createPlan({ title: 'Epic one', description: '', tasks: [] }, 'test', 'human', '/repo').uid;
    intake.setPlanExternalRef({ planUid: uid, url: 'https://acme.atlassian.net/browse/DEMO-1', key: 'DEMO-1' });

    assert.equal(intake.findPlanByExternalKey('DEMO-1'), uid, 'a live plan owns its ticket');

    plans.deletePlan(uid);
    assert.equal(
      intake.findPlanByExternalKey('DEMO-1'),
      null,
      'a deleted plan still owned the ticket, so the epic could never be re-imported',
    );
  });

  test('a live plan still blocks a duplicate import', () => {
    // The refusal is right when the plan is actually there — that is M10.
    const uid = intake.setPlanExternalRef({
      planUid: PLAN, url: 'https://acme.atlassian.net/browse/DEMO-2', key: 'DEMO-2',
    }).planUid;
    assert.equal(intake.findPlanByExternalKey('DEMO-2'), uid);
  });
});
