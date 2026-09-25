/**
 * Phase 31 §13 — what was agreed, as the PR draft states it.
 *
 * The rows are the data the PR draft's table, the review panel and the
 * sign-off pack all render from. What has to hold: every criterion appears
 * verbatim with where it stands; a self-approval is never shown as a
 * person's; an approval whose file changed says which file; and the PR
 * draft puts the table between the tickets and the plan review, with a
 * warning for everything not met.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-signoff-rows-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let db: typeof import('./database');
let artefacts: typeof import('./artefact-service');
let criteria: typeof import('./criteria-service');
let hd: typeof import('./human-decision');
let rows: typeof import('./signoff-rows');
let prDraft: typeof import('./pr-draft-service');

const PLAN = '5160ff00-0000-4000-8000-000000000001';
const ITEM = '5160ff00-1111-4000-8000-000000000001';
const AGENT = { author: 'claude-code', authorType: 'mcp' };
const person = () => hd.issueHumanDecision('desktop', 'analyst@example.com');

before(async () => {
  fs.mkdirSync(path.join(project, 'out'));
  fs.writeFileSync(path.join(project, 'out', 'totals.csv'), 'region,total\nEMEA,10\n');
  db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('./artefact-service');
  criteria = await import('./criteria-service');
  hd = await import('./human-decision');
  rows = await import('./signoff-rows');
  prDraft = await import('./pr-draft-service');
  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Q3 board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, project, now, now],
  );
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'Regional | totals', 'pending', 't', 'human', ?, ?)`,
    [ITEM, PLAN, now - 60_000, now - 60_000],
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the rows', () => {
  test('every criterion, verbatim, with where it stands — and a self-approval is never a person\'s', async () => {
    const out = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/totals.csv', role: 'output', actor: AGENT });
    const signed = criteria.addCriterionAsHuman(ITEM, { text: 'EMEA ties to the ledger', kind: 'artefact', policy: 'propose' }, person());
    criteria.submitCriterion(signed.uid, { evidence: [{ attachmentUid: out.uid, locator: { range: 'B2' } }], note: 'EMEA in B2' }, AGENT);
    criteria.decideCriterion(signed.uid, { decision: 'approved' }, person());

    const machine = criteria.addCriterionAsHuman(ITEM, { text: 'Tests pass', kind: 'test', policy: 'agent' }, person());
    criteria.submitCriterion(machine.uid, { note: 'green' }, AGENT);

    const waiting = criteria.addCriterionAsHuman(ITEM, { text: 'Chart has a source line', kind: 'manual', policy: 'propose' }, person());
    criteria.submitCriterion(waiting.uid, { note: 'added' }, AGENT);

    const got = rows.signoffRows(PLAN);
    const by = (uid: string) => got.find((r) => r.criterionUid === uid)!;

    assert.equal(by(signed.uid).state, 'met');
    assert.equal(by(signed.uid).selfApproved, false);
    assert.equal(by(signed.uid).decision?.actor, 'analyst@example.com');
    assert.equal(by(signed.uid).evidence[0].path, 'out/totals.csv');
    assert.equal(by(signed.uid).evidence[0].where, 'B2');
    assert.match(by(signed.uid).evidence[0].sha256AtSubmit ?? '', /^[a-f0-9]{64}$/);

    assert.equal(by(machine.uid).state, 'met');
    assert.equal(by(machine.uid).selfApproved, true, 'the agent approved its own work');
    assert.match((await import('../../shared/lib/signoff')).decisionWords(by(machine.uid)), /^self-approved by claude-code over MCP/);

    assert.equal(by(waiting.uid).state, 'submitted');
    assert.equal(by(waiting.uid).decision, null);
  });

  test('an approval whose file changed names the file', async () => {
    fs.writeFileSync(path.join(project, 'out', 'totals.csv'), 'region,total\nEMEA,12\n');
    await artefacts.refreshArtefactHashes(ITEM);
    const stale = rows.signoffRows(PLAN).find((r) => r.text === 'EMEA ties to the ledger')!;
    assert.equal(stale.state, 'stale');
    assert.deepEqual(stale.changedFiles, ['out/totals.csv']);
    assert.notEqual(stale.evidence[0].sha256Now, stale.evidence[0].sha256AtSubmit);
  });
});

describe('the PR draft', () => {
  test('the table sits between the tickets and the plan review, cells cannot break it, and nothing unmet goes unwarned', () => {
    const result = prDraft.buildPrDraft({ planUid: PLAN, projectPath: project });
    assert.ok(result.ok);
    const { body, warnings } = result.draft;

    const table = body.indexOf('## Acceptance criteria');
    const review = body.search(/## Plan review|The plan review could not be computed/);
    assert.ok(table >= 0, 'the table is there');
    assert.ok(review > table, 'before the plan review');

    assert.match(body, /\| Regional \\\| totals \| EMEA ties to the ledger \| changed since approved \| totals\.csv \(B2\) \|/,
      'a pipe in a title is escaped, not a new column');
    assert.match(body, /1 of these was approved by the agent's own checks/);

    assert.ok(warnings.some((w) => w.includes('"EMEA ties to the ledger"') && w.includes('out/totals.csv')), 'the stale one, naming the file');
    assert.ok(warnings.some((w) => w.includes('"Chart has a source line"') && w.includes('waiting for sign-off')));
    assert.ok(!warnings.some((w) => w.includes('"Tests pass"')), 'a met criterion is not a warning');
  });

  test('a plan with no criteria has no empty section', () => {
    assert.equal(rows.renderCriteriaTable([]), '');
  });
});
