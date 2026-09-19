/**
 * A plan imported from a ticket belonged to nowhere.
 *
 * `create_plan_from_external` and `import_external` both passed `''` as
 * the project path. That is not "unknown" — it is a stored claim that the
 * plan has no project, and every project-scoped feature then degraded
 * without saying anything: drift had no working tree to ask, review had
 * no comparands to offer, git context had no repo. The plan itself looked
 * entirely normal in the list and in the workspace.
 *
 * It surfaced sideways. The proposed-changes feed reported 0 of 3
 * satisfied on a plan whose work had demonstrably landed — and the reason
 * was not the feed. With no project there is no tree to compare against,
 * so the honest answer is "no evidence", which is what it gave.
 *
 * The fix defaults to the project the user has open. This test covers the
 * service-level invariant the tools now rely on: a plan carries the path
 * it was given, an empty path is preserved as empty rather than invented,
 * and `getActiveProjectRoot` reports what was set.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-planpath-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let db: typeof import('./database');
let plans: typeof import('./plan-service');
let roots: typeof import('./trusted-roots');

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  plans = await import('./plan-service');
  roots = await import('./trusted-roots');
});

after(() => {
  roots.setActiveProjectRoot(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the active project root is readable, not just writable', () => {
  test('it reports what was set', () => {
    roots.setActiveProjectRoot('/Users/someone/work/ledger');
    assert.equal(roots.getActiveProjectRoot(), '/Users/someone/work/ledger');
  });

  test('and null when nothing is open', () => {
    roots.setActiveProjectRoot(null);
    assert.equal(roots.getActiveProjectRoot(), null);
  });
});

describe('a plan keeps the project it was created against', () => {
  test('a path given is a path stored', () => {
    const uid = plans.createPlan(
      { title: 'With a project', description: '', tasks: [] }, 'test', 'human', '/repo/one',
    ).uid;
    assert.equal(plans.getPlan(uid)?.projectPath, '/repo/one');
  });

  test('an empty path stays empty — the service never guesses', () => {
    // The default belongs in the tool that knows what the user has open,
    // not in the service. If this ever starts inventing a root, a plan
    // created by a test or a migration silently acquires one.
    const uid = plans.createPlan(
      { title: 'Without a project', description: '', tasks: [] }, 'test', 'human', '',
    ).uid;
    assert.equal(plans.getPlan(uid)?.projectPath, '');
  });

  test('the fallback the tools apply resolves to the open project', () => {
    // This is the exact expression both import tools now use.
    roots.setActiveProjectRoot('/repo/open');
    const supplied: string | undefined = undefined;
    const projectPath = supplied ?? roots.getActiveProjectRoot() ?? '';
    const uid = plans.createPlan(
      { title: 'Imported from a ticket', description: '', tasks: [] }, 'test', 'human', projectPath,
    ).uid;
    assert.equal(plans.getPlan(uid)?.projectPath, '/repo/open');
  });

  test('and an explicit path still wins over the open project', () => {
    roots.setActiveProjectRoot('/repo/open');
    const supplied: string | undefined = '/repo/explicit';
    const projectPath = supplied ?? roots.getActiveProjectRoot() ?? '';
    const uid = plans.createPlan(
      { title: 'Imported elsewhere', description: '', tasks: [] }, 'test', 'human', projectPath,
    ).uid;
    assert.equal(plans.getPlan(uid)?.projectPath, '/repo/explicit');
  });
});
