/**
 * Phase 32 A6.2 — a task's footprint: what its sessions read (with the hash
 * each read saw and the part), the outputs it recorded, and the parts of
 * materials its citations name. A read counts for the session's brief task,
 * or the material's own task when the session has none.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-footprint-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let fp: typeof import('./material-footprints');
let artefacts: typeof import('./artefact-service');
let criteria: typeof import('./criteria-service');
let sessions: typeof import('./session-service');

const PLAN = '100b0000-0000-4000-8000-00000000f001';
const REPORT = '9f2c41ab-1111-4000-8000-00000000f001';
const PACK = '9f2c41ab-2222-4000-8000-00000000f001';
const AGENT = { author: 'claude-desktop', authorType: 'mcp' };

before(async () => {
  fs.mkdirSync(path.join(project, 'in'));
  fs.mkdirSync(path.join(project, 'out'));
  fs.writeFileSync(path.join(project, 'in', 'sales.csv'), 'region,q3\nEMEA,120\n');
  fs.writeFileSync(path.join(project, 'out', 'report.md'), '# Q3\n');

  const db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  fp = await import('./material-footprints');
  artefacts = await import('./artefact-service');
  criteria = await import('./criteria-service');
  sessions = await import('./session-service');
  const now = Date.now();
  const d = db.getDb();
  d.run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, project, now, now],
  );
  for (const [uid, title] of [[REPORT, 'Q3 report'], [PACK, 'Board pack']]) {
    d.run(
      `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
       VALUES (?, ?, 'action', ?, 'in_progress', 't', 'human', ?, ?)`,
      [uid, PLAN, title, now, now],
    );
  }
  sessions.registerSession('s-report', 'claude-desktop');
  sessions.registerSession('s-pack', 'codex');
  sessions.registerSession('s-loose', 'cursor');
  sessions.bindBrief('s-report', REPORT);
  sessions.bindBrief('s-pack', PACK);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('material footprints', () => {
  test('locators are stored in one order, and an empty one is the whole file', () => {
    assert.equal(fp.locatorKey({ range: 'B2:F9', sheet: 'Summary' }), '{"sheet":"Summary","range":"B2:F9"}');
    assert.equal(fp.locatorKey({}), null);
    assert.equal(fp.locatorKey(null), null);
    assert.equal(fp.partWords({ sheet: 'Summary', range: 'B2:F9' }), 'Summary!B2:F9');
    assert.equal(fp.partWords({ page: '3-5' }), 'pages 3–5');
    assert.equal(fp.partWords({ lines: 2 }), 'line 2');
    assert.equal(fp.partWords(null), 'the whole file');
  });

  test('a read counts for the session\'s brief task, with the hash it saw', async () => {
    // The material is recorded on the report; the pack's session reads it too.
    const sales = await artefacts.recordArtefact({ itemUid: REPORT, path: 'in/sales.csv', role: 'material', actor: AGENT });
    assert.equal(fp.recordMaterialRead({ attachmentUid: sales.uid, sessionId: 's-report', locator: { lines: '1-2' }, at: 1000 }), REPORT);
    assert.equal(fp.recordMaterialRead({ attachmentUid: sales.uid, sessionId: 's-pack', locator: null, at: 2000 }), PACK);
    // A session with no brief: the read counts for the material's own task.
    assert.equal(fp.recordMaterialRead({ attachmentUid: sales.uid, sessionId: 's-loose', locator: { lines: 2 }, at: 3000 }), REPORT);
    assert.equal(fp.recordMaterialRead({ attachmentUid: 'no-such-attachment', sessionId: 's-report' }), null);

    const report = fp.taskFootprint(REPORT);
    assert.equal(report.read.length, 1);
    const m = report.read[0];
    assert.equal(m.path, 'in/sales.csv');
    assert.equal(m.attachmentUid, sales.uid);
    assert.deepEqual(m.reads.map((r) => [r.sessionId, r.agent, r.sha256, r.at]), [
      ['s-report', 'claude-desktop', sales.sha256, 1000],
      ['s-loose', 'cursor', sales.sha256, 3000],
    ]);
    assert.deepEqual(m.parts, [{ lines: '1-2' }, { lines: 2 }]);
    assert.equal(m.lastSha256, sales.sha256);

    const pack = fp.taskFootprint(PACK);
    assert.deepEqual(pack.read.map((x) => [x.path, x.reads.length, x.parts.length]), [['in/sales.csv', 1, 0]]);
  });

  test('a changed file: the next read keeps the new hash beside the old', async () => {
    fs.writeFileSync(path.join(project, 'in', 'sales.csv'), 'region,q3\nEMEA,125\n');
    // Recording again re-takes the hash, as resolving a material does.
    const sales = await artefacts.recordArtefact({ itemUid: REPORT, path: 'in/sales.csv', role: 'material', actor: AGENT });
    fp.recordMaterialRead({ attachmentUid: sales.uid, sessionId: 's-report', locator: { lines: '1-2' }, at: 4000 });
    const m = fp.taskFootprint(REPORT).read[0];
    const hashes = [...new Set(m.reads.map((r) => r.sha256))];
    assert.equal(hashes.length, 2);
    assert.equal(m.lastSha256, sales.sha256);
    // The same part read twice is one part.
    assert.equal(m.parts.length, 2);
  });

  test('outputs recorded and the parts citations name are part of it', async () => {
    const sales = artefacts.listArtefacts(REPORT).find((a) => a.path === 'in/sales.csv')!;
    const out = await artefacts.recordArtefact({ itemUid: REPORT, path: 'out/report.md', role: 'output', actor: AGENT });
    const c = criteria.addCriterionAsAgent(REPORT, { text: 'EMEA matches the ledger', kind: 'citation' }, AGENT);
    criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: sales.uid, locator: { lines: 2 } }], note: 'line 2' }, AGENT);
    // Cited again at the same part: listed once.
    criteria.submitCriterion(c.uid, { evidence: [{ attachmentUid: sales.uid, locator: { lines: 2 } }], note: 'again' }, AGENT);

    const f = fp.taskFootprint(REPORT);
    assert.deepEqual(f.outputs, [{ attachmentUid: out.uid, path: 'out/report.md', sha256: out.sha256 }]);
    assert.deepEqual(f.cited.map((x) => [x.path, x.locator, x.criterionUid]), [['in/sales.csv', { lines: 2 }, c.uid]]);
    // The pack cites nothing and wrote nothing.
    assert.deepEqual([fp.taskFootprint(PACK).outputs, fp.taskFootprint(PACK).cited], [[], []]);
  });

  test('what get_brief shows: a line per material, in words', () => {
    const lines = fp.readSoFar(REPORT);
    assert.equal(lines.length, 1);
    assert.deepEqual({ ...lines[0], sha256: undefined, last_read_at: undefined }, {
      path: 'in/sales.csv',
      attachment_uid: lines[0].attachment_uid,
      reads: 3,
      parts: ['lines 1–2', 'line 2'],
      by: ['claude-desktop', 'cursor'],
      sha256: undefined,
      last_read_at: undefined,
    });
    assert.equal(lines[0].last_read_at, new Date(4000).toISOString());
    assert.deepEqual(fp.readSoFar(PACK)[0].parts, ['the whole file']);
    assert.deepEqual(fp.readSoFar('no-such-task'), []);
  });
});
