/**
 * The code reader's header called planned work "Drift · unexpected".
 *
 * `computeFileDrift` decided whether an edited file belonged to a plan by
 * reading the legacy `tasks` table's `affectedFiles`. Every plan created
 * in the UI, or imported from a ticket, stores its targets as V2
 * `plan_items.fileSpecs` — which that function never read. So on any
 * modern plan, the header over a file the plan asked to change said
 * "Drift · unexpected", directly above a gutter marking the same lines
 * aligned. Found by looking at a screenshot the way a reviewer would and
 * seeing the two disagree.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fdrift-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

const ROOT = '/repo/sample';
let compute: typeof import('./server').computeFileDrift;
let plans: typeof import('./services/plan-service');
let items: typeof import('./services/plan-item-service');

before(async () => {
  const db = await import('./services/database');
  await db.initDatabase();
  plans = await import('./services/plan-service');
  items = await import('./services/plan-item-service');
  ({ computeFileDrift: compute } = await import('./server'));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('a V2 plan item claims its file for the header chip', () => {
  test('an edited file an item targets is on track, not unexpected', () => {
    const uid = plans.createPlan({ title: 'V2 plan', description: '', tasks: [] }, 'test', 'human', ROOT).uid;
    items.createItem({
      planUid: uid, kind: 'action', title: 'Round in Go', author: 'test', authorType: 'human',
      fileSpecs: [{ path: 'services/shared-go/money/money.go', action: 'modify' }],
    });
    const r = compute(ROOT, `${ROOT}/services/shared-go/money/money.go`, true, uid);
    assert.equal(r.status, 'on_track', 'the header said drift on a file the plan targets');
    assert.equal(r.activeTaskUids.length, 1);
  });

  test('an edited file no item targets is still unexpected', () => {
    // The fix must claim what is planned, not everything.
    const uid = plans.createPlan({ title: 'V2 plan b', description: '', tasks: [] }, 'test', 'human', ROOT).uid;
    items.createItem({
      planUid: uid, kind: 'action', title: 'Round in Go', author: 'test', authorType: 'human',
      fileSpecs: [{ path: 'services/shared-go/money/money.go', action: 'modify' }],
    });
    assert.equal(compute(ROOT, `${ROOT}/services/api/app/config.py`, true, uid).status, 'unexpected');
  });

  test('a directory spec covers files beneath it', () => {
    const uid = plans.createPlan({ title: 'V2 plan c', description: '', tasks: [] }, 'test', 'human', ROOT).uid;
    items.createItem({
      planUid: uid, kind: 'action', title: 'Rework notifier', author: 'test', authorType: 'human',
      fileSpecs: [{ path: 'services/notifier/', action: 'modify', isDir: true }],
    });
    assert.equal(compute(ROOT, `${ROOT}/services/notifier/app.rb`, true, uid).status, 'on_track');
  });

  test('a planned file nobody has touched yet is pending', () => {
    const uid = plans.createPlan({ title: 'V2 plan d', description: '', tasks: [] }, 'test', 'human', ROOT).uid;
    items.createItem({
      planUid: uid, kind: 'action', title: 'Round in Go', author: 'test', authorType: 'human',
      fileSpecs: [{ path: 'services/shared-go/money/money.go', action: 'modify' }],
    });
    assert.equal(compute(ROOT, `${ROOT}/services/shared-go/money/money.go`, false, uid).status, 'pending');
  });
});
