/**
 * Criteria, evidence and sign-off — against a real database.
 *
 * The rules under test are the ones that make a sign-off worth reading:
 * state is derived, never set; a person's decision needs a value only the
 * desktop and phone transports can make; an agent cannot decide how
 * strictly its own work is judged; a plan file cannot weaken a criterion.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-criteria-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });

let db: typeof import('./database');
let criteria: typeof import('./criteria-service');
let hd: typeof import('./human-decision');

const PLAN = 'c0ffee00-0000-4000-8000-000000000001';
const AGENT = { author: 'claude-code', authorType: 'mcp' };
const now = Date.now();
let n = 0;

function newItem(opts: { body?: string; requiresApproval?: boolean } = {}): string {
  const uid = `c0ffee00-1111-4000-8000-${String(++n).padStart(12, '0')}`;
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, body, status, requires_approval, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'T', ?, 'pending', ?, 't', 'human', ?, ?)`,
    [uid, PLAN, opts.body ?? '', opts.requiresApproval ? 1 : 0, now, now],
  );
  return uid;
}

function newAttachment(itemUid: string): string {
  const uid = `c0ffee00-2222-4000-8000-${String(++n).padStart(12, '0')}`;
  db.getDb().run(
    `INSERT INTO attachments (uid, target_type, target_uid, kind, value, author, author_type, created_at)
     VALUES (?, 'item', ?, 'file_ref', 'out/report.xlsx', 'claude-code', 'mcp', ?)`,
    [uid, itemUid, now],
  );
  return uid;
}

const person = () => hd.issueHumanDecision('desktop', 'saif@example.com');

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  criteria = await import('./criteria-service');
  hd = await import('./human-decision');
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Board pack', 'in_progress', 't', 'human', '/repo', ?, ?)`,
    [PLAN, now, now],
  );
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('reading the body section (§4.1 migration)', () => {
  test('the checklist intake writes becomes one row per line, verbatim', () => {
    assert.deepEqual(
      criteria.parseAcceptanceSection('Do it.\n\n## Acceptance criteria\n- [ ] EMEA totals match the ledger\n- [x] Chart has a source line\n\n## Notes\n- not a criterion'),
      ['EMEA totals match the ledger', 'Chart has a source line'],
    );
  });

  test('legacy prose with no list becomes a single criterion', () => {
    assert.deepEqual(
      criteria.parseAcceptanceSection('## Scope\nx\n\n## Acceptance criteria\n\nAll endpoints return 401 without a token.\n\n## Git checkpoint\nabc'),
      ['All endpoints return 401 without a token.'],
    );
  });

  test('no section, no criteria', () => {
    assert.deepEqual(criteria.parseAcceptanceSection('Just a body.'), []);
  });

  test('an item is read once — rows appear as manual/human and never double', () => {
    const item = newItem({ body: '## Acceptance criteria\n- [ ] Totals match\n- [ ] Sourced' });
    const first = criteria.listCriteria(item);
    assert.equal(first.length, 2);
    assert.equal(first[0].text, 'Totals match');
    assert.equal(first[0].kind, 'manual');
    assert.equal(first[0].policy, 'human', 'manual is a judgement, so only a person can meet it');
    assert.equal(first[0].source, 'migrated');
    assert.equal(criteria.listCriteria(item).length, 2);
  });
});

describe('state is derived', () => {
  test('open → submitted → sent back → submitted → met', () => {
    const item = newItem();
    const c = criteria.addCriterionAsHuman(item, { text: 'Figures reconcile', kind: 'artefact' }, person());
    assert.equal(c.policy, 'propose', 'the artefact default');
    assert.equal(c.state, 'open');

    const att = newAttachment(item);
    assert.equal(criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: att, locator: { sheet: 'Q3', range: 'C14' } }], note: 'See C14' }, AGENT).state, 'submitted');

    const back = criteria.decideCriterion(c.uid, { decision: 'sent_back', note: 'EMEA is off by 2%' }, person());
    assert.equal(back.state, 'sent_back');
    assert.equal(back.latestSignoff?.note, 'EMEA is off by 2%');
    assert.equal(back.latestSignoff?.actorType, 'human');

    assert.equal(criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: att }], note: 'Fixed' }, AGENT).state, 'submitted');
    const met = criteria.decideCriterion(c.uid, { decision: 'approved' }, person());
    assert.equal(met.state, 'met');
    assert.equal(met.latestSubmission[0].locator, null, 'the second submission had no locator');
    assert.equal(criteria.listSignoffs(c.uid).length, 2, 'decisions are appended, never replaced');
  });

  test('on an agent-policy criterion the submission is the approval — in the agent\'s name', () => {
    const item = newItem();
    const c = criteria.addCriterionAsHuman(item, { text: 'Targets touched', kind: 'code' }, person());
    assert.equal(c.policy, 'agent');
    const met = criteria.submitCriterion(c.uid, { note: 'server.ts modified' }, AGENT);
    assert.equal(met.state, 'met');
    assert.equal(met.latestSignoff?.actorType, 'mcp');
    assert.equal(met.latestSignoff?.channel, 'mcp');
  });

  test('rewording a criterion undoes decisions taken on the old words', () => {
    const item = newItem();
    const c = criteria.addCriterionAsHuman(item, { text: 'Revenue by region', kind: 'artefact' }, person());
    criteria.submitCriterion(c.uid, { note: 'done' }, AGENT);
    criteria.decideCriterion(c.uid, { decision: 'approved' }, person());
    assert.equal(criteria.getCriterion(c.uid)?.state, 'met');

    assert.equal(criteria.updateCriterion(c.uid, { text: 'Revenue by region and product' }, person()).state, 'open');
    assert.equal(criteria.updateCriterion(c.uid, { policy: 'human' }, person()).state, 'open', 'a policy change is not a rewording');
  });
});

describe('only a person decides', () => {
  test('a HumanDecision-shaped value that was not issued is refused', () => {
    const item = newItem();
    const c = criteria.addCriterionAsHuman(item, { text: 'Chart sourced', kind: 'artefact' }, person());
    const forged = Object.freeze({ actor: 'agent-pretending', channel: 'desktop' }) as unknown as import('./human-decision').HumanDecision;
    assert.throws(
      () => criteria.decideCriterion(c.uid, { decision: 'approved' }, forged),
      (e: unknown) => e instanceof criteria.CriterionError && e.status === 403,
    );
    assert.throws(() => criteria.updateCriterion(c.uid, { policy: 'agent' }, forged), /Only a person/);
    assert.throws(() => criteria.deleteCriterion(c.uid, forged), /Only a person/);
    assert.equal(criteria.getCriterion(c.uid)?.state, 'open');
  });

  test('sending back needs a note — it is what the agent reads next', () => {
    const item = newItem();
    const c = criteria.addCriterionAsHuman(item, { text: 'x', kind: 'artefact' }, person());
    assert.throws(() => criteria.decideCriterion(c.uid, { decision: 'sent_back' }, person()), /send-back note/);
  });

  test('an agent-added criterion starts at propose, whatever the kind', () => {
    const item = newItem();
    assert.equal(criteria.addCriterionAsAgent(item, { text: 'Compiles', kind: 'code' }, AGENT).policy, 'propose');
    assert.equal(criteria.addCriterionAsAgent(item, { text: 'Reads well', kind: 'manual' }, AGENT).policy, 'human');
  });

  test('evidence must be attached to the same item', () => {
    const item = newItem();
    const other = newItem();
    const c = criteria.addCriterionAsHuman(item, { text: 'x', kind: 'artefact' }, person());
    assert.throws(
      () => criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: newAttachment(other) }] }, AGENT),
      /belongs to another item/,
    );
    assert.throws(() => criteria.submitCriterion(c.uid, {}, AGENT), /needs evidence, a note, or both/);
  });
});

describe('requiresApproval is shorthand for one human criterion', () => {
  test('set, it appears; cleared, it goes; it gates until a person approves', () => {
    const item = newItem({ requiresApproval: true });
    const [gate] = criteria.listCriteria(item);
    assert.equal(gate.text, criteria.GATE_CRITERION_TEXT);
    assert.equal(gate.policy, 'human');
    assert.equal(criteria.unmetHumanCriteria(item).length, 1);

    criteria.submitCriterion(gate.uid, { note: 'done' }, AGENT);
    assert.equal(criteria.unmetHumanCriteria(item).length, 1, 'an agent submitting does not clear a human gate');
    criteria.decideCriterion(gate.uid, { decision: 'approved' }, person());
    assert.equal(criteria.unmetHumanCriteria(item).length, 0);

    db.getDb().run(`UPDATE plan_items SET requires_approval = 0 WHERE uid = ?`, [item]);
    assert.equal(criteria.listCriteria(item).length, 0);
  });
});

describe('plan files cannot weaken a criterion', () => {
  test('export carries criteria, never decisions', () => {
    const item = newItem();
    const c = criteria.addCriterionAsHuman(item, { text: 'Signed off by finance', kind: 'manual' }, person());
    criteria.decideCriterion(c.uid, { decision: 'approved' }, person());
    const [exported] = criteria.criteriaForExport(item);
    assert.equal(exported.uid, c.uid);
    assert.equal(exported.policy, 'human');
    assert.equal('state' in exported || 'signoffs' in exported || 'latestSignoff' in exported, false);
  });

  test('an existing criterion keeps its strictness; a new one is agent only when it is code', () => {
    const item = newItem();
    const strict = criteria.addCriterionAsHuman(item, { text: 'Legal reviewed', kind: 'artefact', policy: 'human' }, person());
    criteria.importCriteria(item, [
      { uid: strict.uid, text: 'Legal reviewed', kind: 'artefact', policy: 'agent' },
      { uid: 'c0ffee00-3333-4000-8000-000000000001', text: 'Report exists', kind: 'artefact', policy: 'agent' },
      { uid: 'c0ffee00-3333-4000-8000-000000000002', text: 'Build passes', kind: 'code', policy: 'agent' },
      { uid: 'c0ffee00-3333-4000-8000-000000000003', text: 'Reads well', kind: 'manual', policy: 'agent' },
    ]);
    const byText = Object.fromEntries(criteria.listCriteria(item).map((c) => [c.text, c]));
    assert.equal(byText['Legal reviewed'].policy, 'human');
    assert.equal(byText['Report exists'].policy, 'propose');
    assert.equal(byText['Build passes'].policy, 'agent');
    assert.equal(byText['Reads well'].policy, 'human');
    assert.equal(byText['Report exists'].authorType, 'file-import');
  });

  test('a file never moves a criterion to another item, and stops the body being re-read', () => {
    const a = newItem();
    const b = newItem({ body: '## Acceptance criteria\n- [ ] would be a duplicate' });
    const c = criteria.addCriterionAsHuman(a, { text: 'Mine', kind: 'artefact' }, person());
    criteria.importCriteria(b, [{ uid: c.uid, text: 'Stolen', kind: 'artefact', policy: 'propose' }]);
    assert.equal(criteria.getCriterion(c.uid)?.itemUid, a);
    assert.equal(criteria.getCriterion(c.uid)?.text, 'Mine');
    assert.equal(criteria.listCriteria(b).length, 0, 'the file is the source now; the body section is not read again');
  });
});
