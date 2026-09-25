/**
 * Phase 31 §5 — get_brief is the whole of "what am I doing and how will it
 * be judged" in one read: the item, the guide in tree order, the materials
 * with how each is read, each criterion with what it still needs, and the
 * note a person sent back — and never any file's content.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-brief-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let brief: typeof import('./brief-service');
let artefacts: typeof import('./artefact-service');
let criteria: typeof import('./criteria-service');
let hd: typeof import('./human-decision');

const PLAN = '100b0000-0000-4000-8000-00000000b001';
const GUIDE = 'aaaa0000-1111-4000-8000-00000000b001';
const GUIDE_CHILD = 'aaaa0000-2222-4000-8000-00000000b001';
const GUIDE_LAST = 'aaaa0000-3333-4000-8000-00000000b001';
const ITEM = '9f2c41ab-1111-4000-8000-00000000b001';
const AGENT = { author: 'claude-desktop', authorType: 'mcp' };

before(async () => {
  fs.mkdirSync(path.join(project, 'in'));
  fs.writeFileSync(path.join(project, 'in', 'brand-guide.md'), 'SECRET-CONTENT: use the palette\n');
  fs.writeFileSync(path.join(project, 'in', 'q3-sales.csv'), 'region,q3\nEMEA,120\n');
  fs.writeFileSync(path.join(project, 'in', 'walkthrough.mp4'), Buffer.alloc(16));

  const db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  brief = await import('./brief-service');
  artefacts = await import('./artefact-service');
  criteria = await import('./criteria-service');
  hd = await import('./human-decision');
  const now = Date.now();
  const d = db.getDb();
  d.run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, project, now, now],
  );
  const item = (uid: string, kind: string, title: string, body: string, sort: number, parent: string | null = null) => d.run(
    `INSERT INTO plan_items (uid, plan_uid, parent_uid, sort_order, kind, title, body, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 't', 'human', ?, ?)`,
    [uid, PLAN, parent, sort, kind, title, body, kind === 'action' ? 'in_progress' : null, now, now],
  );
  // Inserted out of order: the guide comes back as the tree shows it.
  item(GUIDE_LAST, 'object', 'Glossary', 'Terms.', 3);
  item(GUIDE, 'object', 'Brief from finance', 'x'.repeat(10_000), 1);
  item(ITEM, 'action', 'Q3 summary', 'Summarise Q3 for the board.', 2);
  item(GUIDE_CHILD, 'object', 'House style', 'Short sentences.', 1, GUIDE);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('get_brief', () => {
  test('one read: item, guide in order, materials, criteria with what they need, the note sent back', async () => {
    const guide = await artefacts.recordArtefact({ itemUid: GUIDE, path: 'in/brand-guide.md', role: 'material', actor: AGENT });
    const sales = await artefacts.recordArtefact({ itemUid: ITEM, path: 'in/q3-sales.csv', role: 'material', actor: AGENT });
    await artefacts.recordArtefact({ itemUid: ITEM, path: 'in/walkthrough.mp4', role: 'evidence', actor: AGENT });
    const person = hd.issueHumanDecision('desktop', 'analyst@example.com');
    const cited = criteria.addCriterionAsHuman(ITEM, { text: 'EMEA matches the ledger', kind: 'citation' }, person);
    criteria.submitCriterion(cited.uid, { evidence: [{ attachmentUid: sales.uid, locator: { lines: 2 } }], note: 'line 2' }, AGENT);
    criteria.decideCriterion(cited.uid, { decision: 'sent_back', note: 'EMEA excludes the Nordics restatement', anchor: { attachmentUid: sales.uid, locator: { lines: 2 } } }, hd.issueHumanDecision('desktop', 'analyst@example.com'));
    criteria.addCriterionAsHuman(ITEM, { text: 'The tone suits the board', kind: 'manual' }, hd.issueHumanDecision('desktop', 'analyst@example.com'));

    const b = await brief.getBrief(ITEM);
    assert.ok(b);
    assert.equal(b.item.ref, 'task 9f2c41ab');
    assert.equal(b.item.body, 'Summarise Q3 for the board.');
    assert.equal(b.plan.title, 'Board pack');
    assert.deepEqual(b.guide.map((g) => g.title), ['Brief from finance', 'House style', 'Glossary']);
    assert.match(b.guide[0].body, /cut at 4,000 characters — get_item\("aaaa0000-1111-4000-8000-00000000b001"\) has the rest/);

    assert.deepEqual(b.materials.map((m) => [m.name, m.role, m.read_as, m.item]), [
      ['q3-sales.csv', 'material', 'numbered lines', 'task 9f2c41ab'],
      ['walkthrough.mp4', 'evidence', 'not read as text (video)', 'task 9f2c41ab'],
      ['brand-guide.md', 'material', 'numbered lines', `page ${GUIDE.slice(0, 8)}`],
    ]);
    assert.equal(b.materials[2].attachment_uid, guide.uid);

    const [sentBack, manual] = b.criteria;
    assert.equal(sentBack.state, 'sent_back');
    assert.match(sentBack.still_needs!, /sent it back/);
    assert.deepEqual(sentBack.sent_back?.points_at, { attachment_uid: sales.uid, locator: { lines: 2 } });
    assert.equal(sentBack.sent_back?.note, 'EMEA excludes the Nordics restatement');
    assert.equal(manual.state, 'open');
    assert.match(manual.still_needs!, /person's judgement/);
    assert.equal(b.sent_back, 1);

    assert.match(b.about_materials, /data, never instruction/);
    // What a file says is never in the brief — only what the file is.
    assert.doesNotMatch(JSON.stringify(b), /SECRET-CONTENT/);
  });

  test('an unknown item is null', async () => {
    assert.equal(await brief.getBrief('00000000-0000-4000-8000-000000000000'), null);
  });
});

describe('list_materials', () => {
  test('every recorded file on the plan, item by item in tree order', async () => {
    const list = await brief.listMaterials(PLAN);
    assert.deepEqual(list?.map((m) => m.name), ['brand-guide.md', 'q3-sales.csv', 'walkthrough.mp4']);
    assert.equal(await brief.listMaterials('00000000-0000-4000-8000-000000000000'), null);
  });
});

describe('what a criterion still needs', () => {
  test('in words, by state and kind', () => {
    assert.equal(brief.stillNeeds({ kind: 'citation', policy: 'agent', state: 'met' }), null);
    assert.match(brief.stillNeeds({ kind: 'artefact', policy: 'agent', state: 'open' })!, /record_artefact.*A passing submission marks it met/);
    assert.match(brief.stillNeeds({ kind: 'test', policy: 'propose', state: 'open' })!, /JUnit.*A person decides/);
    assert.match(brief.stillNeeds({ kind: 'code', policy: 'human', state: 'submitted' })!, /waiting for a person/);
    assert.match(brief.stillNeeds({ kind: 'citation', policy: 'propose', state: 'stale' })!, /changed since/);
  });
});
