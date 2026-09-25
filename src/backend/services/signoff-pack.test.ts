/**
 * Phase 31 §13 — the sign-off pack, and checking it later.
 *
 * What has to hold: the pack lists self-approvals apart from a person's;
 * every value in the page is escaped and nothing in it can run; the page
 * carries its own data, so it can be verified from the saved file alone;
 * and verifying re-hashes the files it names INSIDE the plan's project —
 * a path in a pack that leaves the project, or a link, is never read.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-signoff-pack-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let db: typeof import('./database');
let artefacts: typeof import('./artefact-service');
let criteria: typeof import('./criteria-service');
let hd: typeof import('./human-decision');
let packs: typeof import('./signoff-pack');

const PLAN = '5a0c0000-0000-4000-8000-000000000001';
const OTHER_PLAN = '5a0c0000-0000-4000-8000-000000000002';
const ITEM = '5a0c0000-1111-4000-8000-000000000001';
const AGENT = { author: 'claude-code', authorType: 'mcp' };
const HOSTILE = 'Totals match <img src=x onerror=alert(1)></script><script>alert(2)</script>';

before(async () => {
  fs.mkdirSync(path.join(project, 'out'));
  fs.writeFileSync(path.join(project, 'out', 'totals.csv'), 'region,total\nEMEA,10\n');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET');
  db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('./artefact-service');
  criteria = await import('./criteria-service');
  hd = await import('./human-decision');
  packs = await import('./signoff-pack');
  const now = Date.now();
  for (const uid of [PLAN, OTHER_PLAN]) {
    db.getDb().run(
      `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
       VALUES (?, 'Q3 board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
      [uid, project, now, now],
    );
  }
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'Regional totals', 'pending', 't', 'human', ?, ?)`,
    [ITEM, PLAN, now - 60_000, now - 60_000],
  );

  const out = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/totals.csv', role: 'output', actor: AGENT });
  const byPerson = criteria.addCriterionAsHuman(ITEM, { text: HOSTILE, kind: 'artefact', policy: 'propose' }, hd.issueHumanDecision('desktop', 'x'));
  criteria.submitCriterion(byPerson.uid, { evidence: [{ attachmentUid: out.uid, locator: { range: 'B2' } }], note: 'EMEA in B2' }, AGENT);
  criteria.decideCriterion(byPerson.uid, { decision: 'approved' }, hd.issueHumanDecision('phone', 'analyst@example.com', 'Test phone'));

  const byAgent = criteria.addCriterionAsHuman(ITEM, { text: 'The script compiles', kind: 'code', policy: 'agent' }, hd.issueHumanDecision('desktop', 'x'));
  criteria.submitCriterion(byAgent.uid, { note: 'tsc clean' }, AGENT);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the pack', () => {
  test('vouches for the file with the hash it had when it was approved, and names the device', () => {
    const pack = packs.buildSignoffPack(PLAN);
    assert.equal(pack.format, 'codetrellis-signoff-pack');
    assert.equal(pack.files.length, 1);
    assert.equal(pack.files[0].path, 'out/totals.csv');
    assert.equal(pack.files[0].takenAt, 'approval');
    assert.match(pack.files[0].sha256, /^[a-f0-9]{64}$/);
    const person = pack.rows.find((r) => !r.selfApproved)!;
    assert.equal(person.decision?.device, 'Test phone');
  });

  test('lists self-approvals in their own section, and nothing in the page can run', () => {
    const html = packs.renderPackHtml(packs.buildSignoffPack(PLAN));
    const self = html.indexOf("Approved by the agent's own checks");
    assert.ok(self > 0, 'the section is there');
    assert.ok(html.indexOf('The script compiles') > self, 'the agent-approved one is in it');
    assert.ok(html.indexOf('Totals match') < self, 'the person-approved one is not');
    assert.match(html, /approved by analyst@example\.com on the phone \(Test phone\)/);

    assert.ok(!html.includes('<img src=x'), 'criterion text is escaped');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    assert.deepEqual(scripts, ['<script type="application/json" id="codetrellis-signoff-pack">'], 'the only script is data');
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  });

  test('the saved page carries its own data, hostile text and all', () => {
    const pack = packs.buildSignoffPack(PLAN);
    const back = packs.packFromText(packs.renderPackHtml(pack)) as typeof pack;
    assert.deepEqual(back.files, pack.files);
    assert.equal(back.rows.find((r) => !r.selfApproved)?.text, HOSTILE);
  });
});

describe('verifying a pack later', () => {
  test('says which files still match, which changed and which are gone', async () => {
    const saved = packs.renderPackHtml(packs.buildSignoffPack(PLAN));
    const first = await packs.verifyPack(PLAN, packs.packFromText(saved));
    assert.deepEqual([first.matches, first.changed, first.missing], [1, 0, 0]);

    fs.writeFileSync(path.join(project, 'out', 'totals.csv'), 'region,total\nEMEA,11\n');
    const edited = await packs.verifyPack(PLAN, packs.packFromText(saved));
    assert.equal(edited.files[0].verdict, 'changed');

    fs.rmSync(path.join(project, 'out', 'totals.csv'));
    const gone = await packs.verifyPack(PLAN, packs.packFromText(saved));
    assert.equal(gone.files[0].verdict, 'missing');
  });

  test('a path that leaves the project, or a link, is never read', async () => {
    fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(project, 'out', 'link.txt'));
    const secretHash = (await import('node:crypto')).createHash('sha256').update('SECRET').digest('hex');
    const forged = {
      format: 'codetrellis-signoff-pack', version: 1, plan: { uid: PLAN, title: 'x' },
      files: [
        { path: '../secret.txt', sha256: secretHash, takenAt: 'approval' },
        { path: path.join(tmp, 'secret.txt'), sha256: secretHash, takenAt: 'approval' },
        { path: 'out/link.txt', sha256: secretHash, takenAt: 'approval' },
      ],
    };
    const result = await packs.verifyPack(PLAN, forged);
    assert.deepEqual(result.files.map((f) => f.verdict), ['missing', 'missing', 'missing']);
    assert.ok(result.files.every((f) => f.now === null), 'no hash of the outside file is ever reported');
  });

  test('a pack for another plan, or something that is not a pack, is refused', async () => {
    const pack = packs.buildSignoffPack(PLAN);
    await assert.rejects(packs.verifyPack(OTHER_PLAN, pack), /different plan/);
    await assert.rejects(packs.verifyPack(PLAN, { format: 'something-else' }), /not a CodeTrellis sign-off pack/);
    assert.throws(() => packs.packFromText('<html>no data</html>'), /No sign-off pack data/);
  });
});
