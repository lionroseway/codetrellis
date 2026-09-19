/**
 * Two numbers the budget report presented with more confidence than it had.
 *
 * Both are the same class of error the pricing header warns about: a
 * derived figure carrying a claim the data underneath does not support.
 * Neither throws, and both look entirely reasonable on screen.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-budget-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let budget: typeof import('./budget-service');

const PLAN = 'pln_budget_report';

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  budget = await import('./budget-service');
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Budget report', 'active', 'test', 'human', '/repo', ?, ?)`,
    [PLAN, Date.now(), Date.now()],
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().run(`DELETE FROM plan_items WHERE plan_uid = ?`, [PLAN]);
  db.getDb().run(`DELETE FROM item_time_entries WHERE plan_uid = ?`, [PLAN]);
});

function addItem(uid: string, status: string): void {
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', ?, ?, 'test', 'human', ?, ?)`,
    [uid, PLAN, uid, status, Date.now(), Date.now()],
  );
}

function addSpend(minutes: number, costUsd: number | null, pricingVersion: string | null): void {
  const started = Date.now();
  db.getDb().run(
    `INSERT INTO item_time_entries
       (plan_uid, item_uid, session_id, agent_type, agent_model, started_at, ended_at,
        input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, pricing_version)
     VALUES (?, NULL, 's1', 'claude-code', 'claude-opus-5', ?, ?, 0, 0, 0, 0, ?, ?)`,
    [PLAN, started, started + minutes * 60_000, costUsd, pricingVersion],
  );
}

describe('a skipped item is finished, not pending (m4)', () => {
  test('a plan of done and skipped items is complete', () => {
    for (const uid of ['a', 'b', 'c', 'd', 'e']) addItem(uid, 'done');
    for (const uid of ['f', 'g', 'h', 'i', 'j']) addItem(uid, 'skipped');
    addSpend(60, 1, '2026-09-17');

    const report = budget.getBudgetReport(PLAN);
    // Previously 0.5 — `skipped` is terminal and will never become
    // `done`, so it sat in the unfinished column forever.
    assert.equal(report.completionRatio, 1);
    // Which is the number that mattered: the forecast for a plan with no
    // work left in it is what has already been spent, not double it.
    assert.equal(report.forecastMinutes, 60);
    assert.equal(report.forecastCostUsd, 1);
  });

  test('a genuinely half-finished plan still forecasts double', () => {
    // The fix must not simply flatten every ratio to 1.
    for (const uid of ['a', 'b']) addItem(uid, 'done');
    for (const uid of ['c', 'd']) addItem(uid, 'todo');
    addSpend(60, null, null);

    const report = budget.getBudgetReport(PLAN);
    assert.equal(report.completionRatio, 0.5);
    assert.equal(report.forecastMinutes, 120);
  });

  test('a plan where everything was skipped is complete, not undefined', () => {
    for (const uid of ['a', 'b']) addItem(uid, 'skipped');
    addSpend(30, null, null);

    const report = budget.getBudgetReport(PLAN);
    assert.equal(report.completionRatio, 1);
    assert.equal(report.forecastMinutes, 30);
  });
});

describe('the price table a total was priced under (m5)', () => {
  test('one table in, one table out', () => {
    addItem('a', 'done');
    addSpend(10, 5, '2026-09-17');

    const report = budget.getBudgetReport(PLAN);
    assert.equal(report.pricingVersion, '2026-09-17');
    assert.deepEqual(report.pricingVersions, ['2026-09-17']);
  });

  test('a total spanning a price change says so', () => {
    // $30 under the old table, $10 under the new. Reporting the current
    // version asserts the whole $40 was priced under it — precisely the
    // stale-reading-as-fresh claim the field exists to prevent.
    addItem('a', 'done');
    addSpend(10, 30, '2026-09-17');
    addSpend(10, 10, '2026-12-01');

    const report = budget.getBudgetReport(PLAN);
    assert.equal(report.spentCostUsd, 40);
    assert.equal(report.pricingVersion, 'mixed');
    assert.deepEqual(report.pricingVersions, ['2026-09-17', '2026-12-01']);
  });

  test('an unpriced row contributes no provenance', () => {
    // Time with no cost was never priced by any table, so it must not
    // drag a version into the answer.
    addItem('a', 'done');
    addSpend(10, null, '2026-09-17');

    const report = budget.getBudgetReport(PLAN);
    assert.equal(report.spentCostUsd, null);
    assert.deepEqual(report.pricingVersions, []);
  });

  test('with nothing priced, the current table is the honest answer', () => {
    addItem('a', 'todo');
    const report = budget.getBudgetReport(PLAN);
    // It is what the next row will be priced under. What it must not be
    // is a claim about rows that do not exist.
    assert.equal(typeof report.pricingVersion, 'string');
    assert.deepEqual(report.pricingVersions, []);
  });
});
