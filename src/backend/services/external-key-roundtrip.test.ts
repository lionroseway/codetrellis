/**
 * A column written by one phase and read by nobody.
 *
 * Phase 24 added `external_refs.external_key`, wrote it in
 * `createExternalRef`, and set it for every item-level ref that
 * `create_plan_from_external` imports. The SELECTs were not updated, so
 * the row mapper never saw the column — and `pr-draft-service` reached
 * for it through an `as { externalKey?: string | null }` cast, which
 * silenced the type error and made the value permanently `undefined`.
 *
 * The visible consequence: import a set of GitHub issues with no epic
 * (that argument is optional), ask for the PR draft, and the `## Tickets`
 * section is skipped entirely — because it was gated on the parsed KEYS
 * rather than on having any refs at all. The URLs a reviewer needs were
 * in the database the whole time.
 *
 * The cast is gone and `externalKey` is on `ExternalRef`, so a future
 * SELECT that drops the column is a compile error rather than a silence.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-extkey-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let db: typeof import('./database');
let refs: typeof import('./external-refs-service');
let prDraft: typeof import('./pr-draft-service');

const PLAN = 'pln_extkey';
const ITEM = 'itm_extkey';

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  refs = await import('./external-refs-service');
  prDraft = await import('./pr-draft-service');

  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Ticket lineage', 'active', 'test', 'human', '/repo', ?, ?)`,
    [PLAN, now, now],
  );
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'Do the thing', 'todo', 'test', 'human', ?, ?)`,
    [ITEM, PLAN, now, now],
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().run(`DELETE FROM external_refs WHERE item_uid = ?`, [ITEM]);
});

describe('external_key survives a round trip (m2)', () => {
  test('the key written is the key read back', () => {
    refs.createExternalRef({
      itemUid: ITEM,
      url: 'https://github.com/acme/repo/issues/412',
      externalKey: 'PROJ-412',
    });

    const [read] = refs.getExternalRefs(ITEM);
    assert.ok(read, 'the ref was stored');
    assert.equal(read.externalKey, 'PROJ-412');
  });

  test('the plan-wide query carries it too', () => {
    refs.createExternalRef({
      itemUid: ITEM,
      url: 'https://linear.app/acme/issue/ENG-7',
      externalKey: 'ENG-7',
    });

    const [read] = refs.getExternalRefsByPlan(PLAN);
    assert.ok(read, 'the ref is found by plan');
    assert.equal(read.externalKey, 'ENG-7');
  });

  test('a ref with no parsable key round-trips as null, not undefined', () => {
    // A Slack thread or a Notion page has no `PROJ-412` in it. That is
    // an absence, and it has to be distinguishable from "the column was
    // never read", which is what `undefined` meant here for a phase.
    refs.createExternalRef({ itemUid: ITEM, url: 'https://notion.so/some-page' });
    const [read] = refs.getExternalRefs(ITEM);
    assert.equal(read.externalKey, null);
  });
});

describe('the PR draft lists the tickets it has (m2)', () => {
  // `reviewPlan` fails against a path that is not a scanned project;
  // `buildPrDraft` tolerates that and still renders everything it can,
  // which is what makes this testable without a repository.
  const draftBody = () => {
    const res = prDraft.buildPrDraft({ planUid: PLAN, projectPath: '/nonexistent-project' });
    assert.ok(res.ok, 'the draft is produced');
    return res.draft.body;
  };

  test('an item-level ticket reaches the body', () => {
    refs.createExternalRef({
      itemUid: ITEM,
      url: 'https://github.com/acme/repo/issues/412',
      externalKey: 'PROJ-412',
    });

    const body = draftBody();
    assert.match(body, /## Tickets/);
    assert.match(body, /PROJ-412/);
    assert.match(body, /issues\/412/);
  });

  test('a ref with no key still gets listed', () => {
    // The section used to be gated on the KEY list, so a plan whose only
    // lineage was a Notion page or a Slack thread produced no Tickets
    // section at all — the refs were dropped for having no key to show.
    refs.createExternalRef({
      itemUid: ITEM,
      url: 'https://notion.so/spec-page',
      title: 'The spec',
    });

    const body = draftBody();
    assert.match(body, /## Tickets/);
    assert.match(body, /notion\.so\/spec-page/);
  });

  test('a plan with no refs gets no Tickets section', () => {
    assert.doesNotMatch(draftBody(), /## Tickets/);
  });
});
