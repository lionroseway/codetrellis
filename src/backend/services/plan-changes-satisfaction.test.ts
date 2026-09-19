/**
 * "Did the plan land?" reported yes before anyone had started.
 *
 * `computeDrift` asked the live database whether the file EXISTED, and
 * treated existence as satisfaction for every operation. Existence is
 * evidence for an `add` and for a `remove`; for a `modify` it is evidence
 * of nothing at all, because a file you intend to edit is by definition
 * already there. So every `modify` in every plan read as satisfied from
 * the moment the plan was written.
 *
 * It was found by running two surfaces against one plan in the same
 * second and reading both answers: `review_plan` said "1 landed of 3"
 * while this feed said 3 of 3 satisfied. The demo script printed them a
 * few lines apart, which is the only reason the disagreement was visible
 * — neither number is wrong-looking on its own.
 *
 * The fix asks the working tree instead. A `modify` is satisfied when the
 * file differs from HEAD, and not before.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-changes-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

/** A real git repo, because the answer now comes from git. */
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-changes-repo-'));
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

const TOUCHED = 'src/money.go';
const UNTOUCHED = 'src/report.cs';

let db: typeof import('./database');
let plans: typeof import('./plan-service');
let items: typeof import('./plan-item-service');
let changes: typeof import('./plan-changes-service');
let planUid: string;

before(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, TOUCHED), 'package money\n');
  fs.writeFileSync(path.join(repo, UNTOUCHED), 'class Report {}\n');
  git('add', '-A');
  git('commit', '-qm', 'base');

  db = await import('./database');
  await db.initDatabase();
  plans = await import('./plan-service');
  items = await import('./plan-item-service');
  changes = await import('./plan-changes-service');

  planUid = plans.createPlan(
    { title: 'Consistent rounding', description: '', tasks: [] },
    'test', 'human', repo,
  ).uid;

  // Both files are scanned and present, which is exactly the state the
  // old rule mistook for completion.
  const now = Date.now();
  for (const rel of [TOUCHED, UNTOUCHED]) {
    db.getDb().run(
      `INSERT INTO files (path, relative_path, language, content_hash, last_parsed)
       VALUES (?, ?, 'go', 'h', ?)`,
      [path.join(repo, rel), rel, now],
    );
  }

  for (const rel of [TOUCHED, UNTOUCHED]) {
    items.createItem({
      planUid,
      kind: 'action', author: 'test', authorType: 'human',
      title: `Edit ${rel}`,
      fileSpecs: [{ path: rel, action: 'modify' }],
    });
  }
  items.createItem({
    planUid,
    kind: 'action', author: 'test', authorType: 'human',
    title: 'Add a helper',
    fileSpecs: [{ path: 'src/rounding_new.go', action: 'create' }],
  });
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

const byTarget = (t: string) => changes.listProposedChanges(planUid).find((c) => c.target === t)!;

describe('a modify is satisfied by work, not by the file being there', () => {
  test('an untouched file is not satisfied', () => {
    // The whole bug in one assertion: before the fix this was
    // 'satisfied', on a plan nobody had started.
    assert.equal(byTarget(UNTOUCHED).driftStatus, 'planned');
  });

  test('editing the file satisfies it', () => {
    fs.appendFileSync(path.join(repo, TOUCHED), '\nfunc Round() {}\n');
    assert.equal(byTarget(TOUCHED).driftStatus, 'satisfied');
    assert.equal(byTarget(UNTOUCHED).driftStatus, 'planned', 'only the edited file moved');
  });

  test('a planned new file that does not exist is still not satisfied', () => {
    assert.equal(byTarget('src/rounding_new.go').driftStatus, 'planned');
  });

  test('this feed agrees with the item count a reviewer would give', () => {
    // The disagreement that exposed it: one landed of three.
    const landed = changes.listProposedChanges(planUid)
      .filter((c) => c.driftStatus === 'satisfied').length;
    assert.equal(landed, 1);
  });
});

describe('outside a git repo it under-claims rather than over-claims', () => {
  test('no git means nothing reads as landed', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-changes-nogit-'));
    try {
      const uid = plans.createPlan(
        { title: 'No repo', description: '', tasks: [] }, 'test', 'human', bare,
      ).uid;
      items.createItem({
        planUid: uid, kind: 'action', title: 'Edit', author: 'test', authorType: 'human',
        fileSpecs: [{ path: UNTOUCHED, action: 'modify' }],
      });
      // `UNTOUCHED` is in `files`, so the old rule would say satisfied
      // here too — with no evidence available at all.
      assert.equal(changes.listProposedChanges(uid)[0].driftStatus, 'planned');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
