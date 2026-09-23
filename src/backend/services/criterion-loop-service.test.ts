/**
 * Phase 31 §8 — the loops, against a real database and real files.
 *
 * The cases the phase names (§18 13a–13c): a citation to a sheet the
 * workbook does not have is refused and said in words; a note sent back
 * comes back in the worklist with where it points and a reference; a
 * material changed after sign-off makes the next check run say `stale`
 * with the file named — and a check run never moves anything to `met`.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-loops-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let db: typeof import('./database');
let artefacts: typeof import('./artefact-service');
let criteria: typeof import('./criteria-service');
let loop: typeof import('./criterion-loop-service');
let checks: typeof import('./criterion-checks');
let hd: typeof import('./human-decision');

const PLAN = '100b0000-0000-4000-8000-000000000001';
const ITEM = '9f2c41ab-1111-4000-8000-000000000001';
const AGENT = { author: 'claude-desktop', authorType: 'mcp' };

/** A zip with the given entries — the first stored, the rest deflated, as Office mixes them. */
function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  Object.entries(entries).forEach(([name, text], i) => {
    const raw = Buffer.from(text, 'utf8');
    const method = i === 0 ? 0 : 8;
    const data = method === 0 ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(zlib.crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(zlib.crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function workbook(): Buffer {
  return makeZip({
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Regional &amp; FX" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1:B4"/></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><dimension ref="A1:F20"/></worksheet>',
    'xl/sharedStrings.xml': '<sst><si><t>EMEA revenue</t></si></sst>',
  });
}

before(async () => {
  fs.mkdirSync(path.join(project, 'in'));
  fs.mkdirSync(path.join(project, 'out'));
  fs.writeFileSync(path.join(project, 'in', 'q3-sales.xlsx'), workbook());
  fs.writeFileSync(path.join(project, 'in', 'guide.md'), '# Brand guide\n\nUse the palette.\nCite every claim.\n');

  db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('./artefact-service');
  criteria = await import('./criteria-service');
  loop = await import('./criterion-loop-service');
  checks = await import('./criterion-checks');
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

const person = () => hd.issueHumanDecision('desktop', 'analyst@example.com');
const fails = (r: { findings: Array<{ status: string; message: string }> }) =>
  r.findings.filter((f) => f.status === 'fail').map((f) => f.message);

describe('reading the formats', () => {
  test('sheet names and used ranges come out of a workbook, entities decoded', () => {
    assert.deepEqual(checks.workbookSheets(workbook()), [
      { name: 'Summary', dimension: 'A1:B4' },
      { name: 'Regional & FX', dimension: 'A1:F20' },
    ]);
  });

  test('a PDF page tree, an mp4 length, a JUnit report', () => {
    assert.equal(checks.pdfPageCount(Buffer.from('1 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj')), 3);
    assert.equal(checks.pdfPageCount(Buffer.from('no page tree here')), null);

    const mvhd = Buffer.alloc(40);
    mvhd.write('mvhd', 4, 'latin1');
    mvhd.writeUInt32BE(1000, 4 + 16); // timescale
    mvhd.writeUInt32BE(95_000, 4 + 20); // duration: 95s
    assert.equal(checks.mp4DurationSeconds(mvhd), 95);

    assert.deepEqual(
      checks.junitCounts('<testsuites tests="12" failures="1" errors="0"><testsuite tests="12"/></testsuites>'),
      { tests: 12, failures: 1, errors: 0 },
    );
    assert.equal(checks.junitCounts('plain log output'), null);
  });

  test('an entry that would inflate past the cap is refused, not read', async () => {
    const { readZipEntry } = await import('../lib/zip-entries');
    const bomb = makeZip({ 'a.txt': 'x', 'b.xml': 'y'.repeat(2_000_000) });
    assert.throws(() => readZipEntry(bomb, 'b.xml', { maxEntryBytes: 1024 }), /inflates past/);
  });
});

describe('the agent\'s loop — check before you claim (§8.1)', () => {
  test('a citation to a sheet the workbook does not have is refused, in words (13a)', async () => {
    const sales = await artefacts.recordArtefact({ itemUid: ITEM, path: 'in/q3-sales.xlsx', role: 'material', actor: AGENT });
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Every figure cites the ledger', kind: 'citation' }, person());

    const wrong = [{ attachmentUid: sales.uid, locator: { sheet: 'Regionl', range: 'C14' } }];
    const dry = await loop.checkCriterion(c.uid, wrong);
    assert.equal(dry.ok, false);
    assert.match(fails(dry).join('\n'), /in\/q3-sales\.xlsx has no sheet "Regionl" — it has "Summary", "Regional & FX"/);

    await assert.rejects(
      loop.submitChecked(c.uid, { evidence: wrong, note: 'EMEA in C14' }, AGENT),
      (err: Error) => err instanceof criteria.CriterionError && /Not submitted/.test(err.message) && /Regionl/.test(err.message),
    );
    assert.equal(criteria.getCriterion(c.uid)?.state, 'open', 'a refused submission records nothing');

    const outside = [{ attachmentUid: sales.uid, locator: { sheet: 'Regional & FX', range: 'Z99' } }];
    assert.match(fails(await loop.checkCriterion(c.uid, outside)).join('\n'), /Regional & FX!Z99 is outside/);

    const right = [{ attachmentUid: sales.uid, locator: { sheet: 'Regional & FX', range: 'C14' } }];
    assert.equal((await loop.checkCriterion(c.uid, right)).ok, true);
    const { criterion } = await loop.submitChecked(c.uid, { evidence: right, note: 'EMEA in C14' }, AGENT);
    assert.equal(criterion.state, 'submitted');
  });

  test('a citation needs a material and a place in it', async () => {
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Follows the brand guide', kind: 'citation' }, person());
    assert.match(fails(await loop.checkCriterion(c.uid, [])).join('\n'), /Cite the material/);

    const guide = await artefacts.recordArtefact({ itemUid: ITEM, path: 'in/guide.md', role: 'material', actor: AGENT });
    assert.match(fails(await loop.checkCriterion(c.uid, [{ attachmentUid: guide.uid }])).join('\n'), /needs a locator/);
    assert.match(
      fails(await loop.checkCriterion(c.uid, [{ attachmentUid: guide.uid, locator: { lines: '4-40' } }])).join('\n'),
      /has 5 lines; 40 is past the end/,
    );
    assert.match(
      fails(await loop.checkCriterion(c.uid, [{ attachmentUid: guide.uid, locator: { text: 'Use Comic Sans' } }])).join('\n'),
      /does not contain "Use Comic Sans"/,
    );
    assert.equal((await loop.checkCriterion(c.uid, [{ attachmentUid: guide.uid, locator: { text: 'use  the palette' } }])).ok, true);
  });

  test('an artefact output must be this work\'s — changed since the item started', async () => {
    const file = path.join(project, 'out', 'summary.docx');
    fs.writeFileSync(file, makeZip({ 'word/document.xml': '<w:document><w:p><w:t>Q3</w:t></w:p></w:document>' }));
    const old = new Date(Date.now() - 86_400_000);
    fs.utimesSync(file, old, old);
    const out = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/summary.docx', role: 'output', actor: AGENT });
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'A summary exists', kind: 'artefact' }, person());

    assert.match(fails(await loop.checkCriterion(c.uid, [{ attachmentUid: out.uid }])).join('\n'), /before this item started/);
    fs.utimesSync(file, new Date(), new Date());
    assert.equal((await loop.checkCriterion(c.uid, [{ attachmentUid: out.uid }])).ok, true);
  });

  test('a red test report fails; a green one passes; a log is unverified, not failed', async () => {
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Tests pass', kind: 'test' }, person());
    fs.writeFileSync(path.join(project, 'out', 'junit.xml'), '<testsuites tests="3" failures="1" errors="0"></testsuites>');
    const report = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/junit.xml', role: 'evidence', actor: AGENT });
    assert.match(fails(await loop.checkCriterion(c.uid, [{ attachmentUid: report.uid }])).join('\n'), /1 of 3 tests failing/);

    fs.writeFileSync(path.join(project, 'out', 'junit.xml'), '<testsuites tests="3" failures="0" errors="0"></testsuites>');
    assert.equal((await loop.checkCriterion(c.uid, [{ attachmentUid: report.uid }])).ok, true);

    fs.writeFileSync(path.join(project, 'out', 'run.log'), 'all good');
    const log = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/run.log', role: 'evidence', actor: AGENT });
    const r = await loop.checkCriterion(c.uid, [{ attachmentUid: log.uid }]);
    assert.equal(r.ok, true, 'what cannot be read is said, never counted against the agent');
    assert.ok(r.findings.some((f) => f.status === 'unverified' && /not a JUnit report/.test(f.message)));
  });

  test('evidence that is not a recorded file on this item is refused', async () => {
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Chart exported', kind: 'artefact' }, person());
    assert.match(
      fails(await loop.checkCriterion(c.uid, [{ attachmentUid: 'no-such-attachment' }])).join('\n'),
      /not a file recorded on this item/,
    );
  });

  test('a manual criterion has nothing mechanical to check', async () => {
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Reads well' }, person());
    const r = await loop.checkCriterion(c.uid);
    assert.equal(r.ok, true);
    assert.match(r.findings[0].message, /person's judgement/);
  });
});

describe('the person\'s loop and the worklist (§8.2)', () => {
  test('a note sent back comes back with the file, the place and a reference (13b)', async () => {
    const sales = artefacts.listArtefacts(ITEM).find((a) => a.path === 'in/q3-sales.xlsx')!;
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'EMEA matches the ledger', kind: 'citation' }, person());
    await loop.submitChecked(
      c.uid, { evidence: [{ attachmentUid: sales.uid, locator: { sheet: 'Summary', range: 'B2' } }], note: 'B2' }, AGENT,
    );
    criteria.decideCriterion(c.uid, { decision: 'sent_back', note: 'EMEA excludes the Nordics restatement' }, person());

    const list = await loop.getWorklist(PLAN);
    const entry = list.entries.find((e) => e.criterionUid === c.uid)!;
    assert.equal(entry.reason, 'sent_back');
    assert.equal(entry.note, 'EMEA excludes the Nordics restatement');
    assert.deepEqual(entry.anchors, [{ attachmentUid: sales.uid, path: 'in/q3-sales.xlsx', locator: { sheet: 'Summary', range: 'B2' } }]);
    assert.equal(entry.itemRef, 'task 9f2c41ab');
    assert.equal(list.entries[0].reason, 'sent_back', 'what a person sent back comes first');
    assert.ok(list.waitingForPerson >= 1, 'a clean submission waits on a person and is not listed');
  });
});

describe('the check run (§8.3)', () => {
  test('a material changed after sign-off reads stale, with the file named — and nothing is approved (13c)', async () => {
    fs.writeFileSync(path.join(project, 'in', 'ledger.csv'), 'region,total\nEMEA,10\nAPAC,20\n');
    const ledger = await artefacts.recordArtefact({ itemUid: ITEM, path: 'in/ledger.csv', role: 'material', actor: AGENT });
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Totals tie to the ledger', kind: 'citation' }, person());
    await loop.submitChecked(
      c.uid, { evidence: [{ attachmentUid: ledger.uid, locator: { range: 'B2:B3' } }], note: 'B2:B3' }, AGENT,
    );
    criteria.decideCriterion(c.uid, { decision: 'approved' }, person());

    const first = await loop.runCheckRun({ planUid: PLAN, trigger: 'manual', by: 'analyst', byType: 'human' });
    assert.equal(first.outcomes.find((o) => o.criterionUid === c.uid)?.state, 'met');
    const signoffsBefore = criteria.listSignoffs(c.uid).length;

    fs.writeFileSync(path.join(project, 'in', 'ledger.csv'), 'region,total\nEMEA,12\nAPAC,20\n');
    const second = await loop.runCheckRun({ planUid: PLAN, trigger: 'manual', by: 'analyst', byType: 'human' });
    const outcome = second.outcomes.find((o) => o.criterionUid === c.uid)!;
    assert.equal(outcome.state, 'stale');
    assert.deepEqual(outcome.changedFiles, ['in/ledger.csv']);
    assert.match(second.sinceLast.join(' '), /1 went stale since .* — in\/ledger\.csv changed/);

    assert.equal(criteria.listSignoffs(c.uid).length, signoffsBefore, 'a check run records no decision');
    assert.ok(
      second.outcomes.every((o) => o.state !== 'met' || first.outcomes.find((p) => p.criterionUid === o.criterionUid)?.state === 'met'),
      'nothing became met by being checked',
    );

    const stale = (await loop.getWorklist(PLAN)).entries.find((e) => e.criterionUid === c.uid)!;
    assert.equal(stale.reason, 'stale');
    assert.deepEqual(stale.details, ['in/ledger.csv changed after it was approved']);

    const runs = loop.listCheckRuns(PLAN);
    assert.equal(runs[0].uid, second.uid, 'newest first, and kept');
    assert.equal(runs.length, 2);
  });

  test('a run over one item does not make the rest read as new next time', () => {
    const o = (uid: string, ok = true) => ({ criterionUid: uid, itemUid: ITEM, text: uid, state: 'open' as const, ok, failures: [], changedFiles: [] });
    const run = (uid: string, outcomes: ReturnType<typeof o>[], startedAt: number) =>
      ({ uid, planUid: PLAN, trigger: 'manual' as const, by: 'a', byType: 'human', startedAt, finishedAt: startedAt, outcomes, sinceLast: [] });
    const full = run('r1', [o('a'), o('b')], 1);
    const scoped = run('r2', [o('a')], 2);
    assert.deepEqual(loop.describeSinceLast([o('a'), o('b')], [scoped, full]), [`Nothing changed since ${new Date(2).toISOString().slice(0, 16).replace('T', ' ')}.`]);
    assert.match(loop.describeSinceLast([o('a'), o('b', false)], [scoped, full]).join(' '), /1 now fails its checks: "b"/);
    assert.deepEqual(loop.describeSinceLast([o('a')], []), ['First check run on this plan.']);
  });
});
