/**
 * Artefacts and "changed since approved" — against a real database and a
 * real project on disk (Phase 31 §4.2–4.4).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-artefacts-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));
const outside = path.join(tmp, 'outside.xlsx');

let db: typeof import('./database');
let artefacts: typeof import('./artefact-service');
let criteria: typeof import('./criteria-service');
let hd: typeof import('./human-decision');

const PLAN = 'a47e0000-0000-4000-8000-000000000001';
const ITEM = 'a47e0000-1111-4000-8000-000000000001';
const AGENT = { author: 'claude-desktop', authorType: 'mcp' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

before(async () => {
  fs.mkdirSync(path.join(project, 'out'));
  fs.writeFileSync(path.join(project, 'out', 'q3.xlsx'), 'Q3 v1');
  fs.writeFileSync(path.join(project, 'run.sh'), 'echo hi');
  fs.writeFileSync(outside, 'SECRET');
  fs.symlinkSync(outside, path.join(project, 'out', 'looks-inside.xlsx'));

  db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('./artefact-service');
  criteria = await import('./criteria-service');
  hd = await import('./human-decision');
  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, project, now, now],
  );
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'Q3 summary', 'pending', 't', 'human', ?, ?)`,
    [ITEM, PLAN, now, now],
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('recording an artefact', () => {
  test('a project file is recorded relative, with its hash', async () => {
    const a = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/q3.xlsx', role: 'output', actor: AGENT });
    assert.equal(a.path, 'out/q3.xlsx');
    assert.equal(a.role, 'output');
    assert.equal(a.sha256, sha('Q3 v1'));
    assert.equal(a.recordedByType, 'mcp');

    const again = await artefacts.recordArtefact({
      itemUid: ITEM, path: path.join(project, 'out', 'q3.xlsx'), role: 'output', actor: AGENT,
    });
    assert.equal(again.uid, a.uid, 'an absolute path inside the project is the same file, not a second row');
  });

  test('outside the project, through a link, or of the wrong type — refused', async () => {
    const refuse = (p: string, role: unknown = 'output') =>
      assert.rejects(artefacts.recordArtefact({ itemUid: ITEM, path: p, role, actor: AGENT }), artefacts.ArtefactError);
    await refuse(outside);
    await refuse('../outside.xlsx');
    await refuse('out/looks-inside.xlsx');
    await refuse('run.sh');
    await refuse('out/missing.xlsx');
    await refuse('out/q3.xlsx', 'summary');
  });
});

describe('changed since approved', () => {
  test('an approval notices when its file changes, and a re-approval clears it', async () => {
    const out = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/q3.xlsx', role: 'output', actor: AGENT });
    const person = hd.issueHumanDecision('desktop', 'analyst@example.com');
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Totals match the ledger', kind: 'artefact' }, person);

    const submitted = criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: out.uid }], note: 'See Totals!B9' }, AGENT);
    assert.equal(submitted.latestSubmission[0].sha256AtSubmit, sha('Q3 v1'));
    assert.equal(criteria.decideCriterion(c.uid, { decision: 'approved' }, person).state, 'met');
    assert.deepEqual(criteria.listSignoffs(c.uid).at(-1)?.evidenceHashes, { [out.uid]: sha('Q3 v1') });

    // Nothing changed: a refresh changes nothing.
    assert.deepEqual(await artefacts.refreshArtefactHashes(ITEM), []);
    assert.equal(criteria.getCriterion(c.uid)?.state, 'met');

    // The spreadsheet is edited after the person approved it.
    fs.writeFileSync(path.join(project, 'out', 'q3.xlsx'), 'Q3 v2 — restated');
    assert.deepEqual(await artefacts.refreshArtefactHashes(ITEM), [out.uid]);
    assert.equal(criteria.getCriterion(c.uid)?.state, 'stale', 'never silently still met');

    // They look again and approve what is there now.
    assert.equal(criteria.decideCriterion(c.uid, { decision: 'approved' }, person).state, 'met');
  });

  test('a file that is deleted, or swapped for a link, counts as changed', async () => {
    fs.writeFileSync(path.join(project, 'out', 'chart.png'), 'png-bytes');
    const shot = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/chart.png', role: 'evidence', actor: AGENT });
    const person = hd.issueHumanDecision('desktop', 'analyst@example.com');
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Chart is sourced', kind: 'artefact' }, person);
    criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: shot.uid }] , note: 'bottom-left' }, AGENT);
    criteria.decideCriterion(c.uid, { decision: 'approved' }, person);

    fs.rmSync(path.join(project, 'out', 'chart.png'));
    fs.symlinkSync(outside, path.join(project, 'out', 'chart.png'));
    await artefacts.refreshArtefactHashes(ITEM);
    assert.equal(artefacts.getArtefact(shot.uid)?.sha256, null, 'a link is not read, so it has no hash');
    assert.equal(criteria.getCriterion(c.uid)?.state, 'stale');
  });

  test('an unapproved criterion is never stale — there was nothing to change since', async () => {
    const person = hd.issueHumanDecision('desktop', 'analyst@example.com');
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Draft reviewed', kind: 'artefact' }, person);
    const out = artefacts.listArtefacts(ITEM).find((a) => a.path === 'out/q3.xlsx')!;
    criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: out.uid }], note: 'x' }, AGENT);
    fs.writeFileSync(path.join(project, 'out', 'q3.xlsx'), 'Q3 v3');
    await artefacts.refreshArtefactHashes(ITEM);
    assert.equal(criteria.getCriterion(c.uid)?.state, 'submitted');
  });
});
