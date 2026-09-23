/**
 * Phase 31 §7.1 / §8.2 — serving an attachment's bytes, and a send-back
 * that points at a place.
 *
 * The resolver behind both the REST route and the packaged app's
 * `ct-artefact:` scheme: confined to the item's opened project, opened once
 * without following links, typed from the allowlist — and HTML, which is a
 * program, never sent as HTML.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-content-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let db: typeof import('./database');
let artefacts: typeof import('./artefact-service');
let content: typeof import('./artefact-content-service');
let criteria: typeof import('./criteria-service');
let loop: typeof import('./criterion-loop-service');
let hd: typeof import('./human-decision');

const PLAN = 'c0ae0000-0000-4000-8000-000000000001';
const ITEM = 'c0ae0000-1111-4000-8000-000000000001';
const OTHER = 'c0ae0000-2222-4000-8000-000000000001';
const AGENT = { author: 'claude-desktop', authorType: 'mcp' };

async function body(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

before(async () => {
  fs.mkdirSync(path.join(project, 'out'));
  fs.writeFileSync(path.join(project, 'out', 'totals.csv'), 'region,total\nEMEA,10\nAPAC,20\n');
  fs.writeFileSync(path.join(project, 'out', 'report.html'), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(tmp, 'secret.csv'), 'SECRET');

  db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('./artefact-service');
  content = await import('./artefact-content-service');
  criteria = await import('./criteria-service');
  loop = await import('./criterion-loop-service');
  hd = await import('./human-decision');
  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Q3', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, project, now, now],
  );
  for (const uid of [ITEM, OTHER]) {
    db.getDb().run(
      `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
       VALUES (?, ?, 'action', 'Q3 summary', 'pending', 't', 'human', ?, ?)`,
      [uid, PLAN, now, now],
    );
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('serving an attachment (§7.1)', () => {
  test('a recorded file streams with the allowlisted type and the safety headers', async () => {
    const a = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/totals.csv', role: 'output', actor: AGENT });
    const file = await content.resolveServable(a.uid);
    assert.ok(file);
    const served = content.serveFile(file!);
    assert.equal(served.status, 200);
    assert.equal(served.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(served.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(served.headers['Cache-Control'], 'no-store');
    assert.match(served.headers['Content-Security-Policy'], /sandbox/);
    assert.equal(await body(served.stream!), 'region,total\nEMEA,10\nAPAC,20\n');
  });

  test('a byte range is served as 206; one past the end is 416', async () => {
    const a = artefacts.listArtefacts(ITEM).find((x) => x.path === 'out/totals.csv')!;
    const file = (await content.resolveServable(a.uid))!;
    const part = content.serveFile(file, 'bytes=0-5');
    assert.equal(part.status, 206);
    assert.equal(part.headers['Content-Range'], `bytes 0-5/${a.size}`);
    assert.equal(await body(part.stream!), 'region');
    const beyond = content.serveFile(file, `bytes=${(a.size ?? 0) + 10}-`);
    assert.equal(beyond.status, 416);
    assert.equal(beyond.stream, null);
  });

  test('HTML is a program: it is never sent as HTML to this origin', async () => {
    const a = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/report.html', role: 'output', actor: AGENT });
    const file = (await content.resolveServable(a.uid))!;
    assert.equal(file.contentType, 'text/plain; charset=utf-8');
  });

  test('a file swapped for a link after recording is not served, and the error names no path', async () => {
    fs.writeFileSync(path.join(project, 'out', 'swap.csv'), 'a,b\n');
    const a = await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/swap.csv', role: 'output', actor: AGENT });
    fs.rmSync(path.join(project, 'out', 'swap.csv'));
    fs.symlinkSync(path.join(tmp, 'secret.csv'), path.join(project, 'out', 'swap.csv'));
    const file = (await content.resolveServable(a.uid))!;
    const served = content.serveFile(file);
    assert.equal(served.status, 404);
    assert.equal(served.stream, null);
    assert.doesNotMatch(served.error ?? '', /secret|\/tmp|project-/);
  });

  test('anything that is not one of our uids is not even looked up', async () => {
    assert.equal(await content.resolveServable('../../etc/passwd'), null);
    assert.equal(await content.resolveServable(''), null);
    assert.equal(await content.resolveServable('no-such-attachment-uid'), null);
  });
});

describe('sending back from the exact place (§8.2)', () => {
  test('the note keeps the file and the cells it is about, and the worklist leads with them', async () => {
    const a = artefacts.listArtefacts(ITEM).find((x) => x.path === 'out/totals.csv')!;
    const person = hd.issueHumanDecision('desktop', 'analyst@example.com');
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Totals tie to the ledger', kind: 'manual' }, person);
    await loop.submitChecked(c.uid, { evidence: [{ attachmentUid: a.uid }], note: 'see totals' }, AGENT);

    const back = criteria.decideCriterion(c.uid, {
      decision: 'sent_back', note: 'EMEA is the pre-restatement figure', anchor: { attachmentUid: a.uid, locator: { range: 'B2' } },
    }, person);
    assert.deepEqual(back.latestSignoff?.anchor, { attachmentUid: a.uid, locator: { range: 'B2' } });

    const entry = (await loop.getWorklist(PLAN)).entries.find((e) => e.criterionUid === c.uid)!;
    assert.deepEqual(entry.anchors[0], { attachmentUid: a.uid, path: 'out/totals.csv', locator: { range: 'B2' } });
  });

  test('an anchor on another item\'s file, or a locator that is not a small object, is refused', () => {
    const person = hd.issueHumanDecision('desktop', 'analyst@example.com');
    const c = criteria.addCriterionAsHuman(ITEM, { text: 'Chart sourced', kind: 'manual' }, person);
    db.getDb().run(
      `INSERT INTO attachments (uid, target_type, target_uid, kind, value, author, author_type, created_at)
       VALUES ('c0ae-other-attachment', 'item', ?, 'file_ref', 'x.csv', 't', 'human', ?)`,
      [OTHER, Date.now()],
    );
    assert.throws(
      () => criteria.decideCriterion(c.uid, { decision: 'sent_back', note: 'no', anchor: { attachmentUid: 'c0ae-other-attachment' } }, person),
      /belongs to another item/,
    );
    const mine = artefacts.listArtefacts(ITEM)[0];
    assert.throws(
      () => criteria.decideCriterion(c.uid, { decision: 'sent_back', note: 'no', anchor: { attachmentUid: mine.uid, locator: 'B2' } }, person),
      /small object/,
    );
  });
});
