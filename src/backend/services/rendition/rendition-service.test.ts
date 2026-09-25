/**
 * Phase 31 §7.6 — an Office file as a PDF: found as the viewer finds bytes,
 * converted once per content, cached, and a sentence when it cannot be.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rendition-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let db: typeof import('../database');
let artefacts: typeof import('../artefact-service');
let rendition: typeof import('./rendition-service');
let hostMod: typeof import('./engine-host');

const PLAN = 'e1d00000-0000-4000-8000-000000000001';
const ITEM = 'e1d00000-1111-4000-8000-000000000001';
const AGENT = { author: 'claude-desktop', authorType: 'mcp' };

/** A host that answers from a script: each entry is a PDF or an error to throw. */
function scripted(steps: Array<string | Error>, version = '1.0.0') {
  const calls: Array<{ bytes: string; ext: string }> = [];
  const fake = {
    calls,
    async check() { return { ok: true as const, manifest: { name: 'fake', version, adapter: 'a', files: {} } }; },
    async convert(bytes: Uint8Array, ext: string) {
      calls.push({ bytes: Buffer.from(bytes).toString(), ext });
      const step = steps.shift() ?? '%PDF-1.4 default';
      if (step instanceof Error) throw step;
      await new Promise((r) => setTimeout(r, 20));
      return new Uint8Array(Buffer.from(step));
    },
  };
  return fake as typeof fake & import('./engine-host').EngineHost;
}

async function record(name: string, content: string | Buffer): Promise<string> {
  fs.writeFileSync(path.join(project, 'out', name), content);
  return (await artefacts.recordArtefact({ itemUid: ITEM, path: `out/${name}`, role: 'material', actor: AGENT })).uid;
}

const read = (file: { root: string; rel: string }) => fs.readFileSync(path.join(file.root, file.rel), 'utf8');

before(async () => {
  fs.mkdirSync(path.join(project, 'out'));
  db = await import('../database');
  await db.initDatabase();
  (await import('../trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('../artefact-service');
  rendition = await import('./rendition-service');
  hostMod = await import('./engine-host');
  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, 'Board pack', 'in_progress', 't', 'human', ?, ?, ?)`,
    [PLAN, project, now, now],
  );
  db.getDb().run(
    `INSERT INTO plan_items (uid, plan_uid, kind, title, status, author, author_type, created_at, updated_at)
     VALUES (?, ?, 'action', 'Deck', 'pending', 't', 'human', ?, ?)`,
    [ITEM, PLAN, now, now],
  );
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('converted once per content, and cached', () => {
  test('the first look converts; the second is served from the cache without the engine', async () => {
    const uid = await record('deck.pptx', 'deck bytes v1');
    const host = scripted(['%PDF-1.4 deck v1']);
    const first = await rendition.renditionOf(uid, host);
    assert.ok(first.ok);
    assert.equal(read(first.file), '%PDF-1.4 deck v1');
    assert.equal(first.file.contentType, 'application/pdf');
    assert.ok(first.file.root.startsWith(process.env.CODETRELLIS_DATA_DIR!));
    assert.deepEqual(host.calls, [{ bytes: 'deck bytes v1', ext: 'pptx' }]);

    const again = await rendition.renditionOf(uid, host);
    assert.ok(again.ok);
    assert.equal(host.calls.length, 1);
  });

  test('changed bytes are a new rendition; a new engine version is too', async () => {
    const uid = await record('report.docx', 'report v1');
    const host = scripted(['%PDF-1.4 report v1', '%PDF-1.4 report v2']);
    const v1 = await rendition.renditionOf(uid, host);
    fs.writeFileSync(path.join(project, 'out', 'report.docx'), 'report v2');
    const v2 = await rendition.renditionOf(uid, host);
    assert.ok(v1.ok && v2.ok);
    assert.notEqual(v1.file.rel, v2.file.rel);
    assert.equal(read(v2.file), '%PDF-1.4 report v2');

    const upgraded = scripted(['%PDF-1.4 report v2, engine 2'], '2.0.0');
    const v3 = await rendition.renditionOf(uid, upgraded);
    assert.ok(v3.ok);
    assert.equal(upgraded.calls.length, 1);
  });

  test('two viewers asking at once cause one conversion', async () => {
    const uid = await record('shared.pptx', 'shared bytes');
    const host = scripted(['%PDF-1.4 shared']);
    const [a, b] = await Promise.all([rendition.renditionOf(uid, host), rendition.renditionOf(uid, host)]);
    assert.ok(a.ok && b.ok);
    assert.equal(host.calls.length, 1);
  });
});

describe('when it cannot be converted, a status and a sentence', () => {
  test('a hung engine is retried once on a fresh one; hung twice is a 503', async () => {
    const uid = await record('flaky.pptx', 'flaky bytes');
    const recovered = scripted([new hostMod.ConversionTimedOut('The conversion took longer than 30s, so it was stopped'), '%PDF-1.4 second try']);
    const ok = await rendition.renditionOf(uid, recovered);
    assert.ok(ok.ok);
    assert.equal(recovered.calls.length, 2);

    const uid2 = await record('stuck.pptx', 'stuck bytes');
    const hung = scripted([new hostMod.ConversionTimedOut('took longer than 30s'), new hostMod.ConversionTimedOut('took longer than 30s')]);
    const failed = await rendition.renditionOf(uid2, hung);
    assert.deepEqual(failed, { ok: false, status: 503, reason: 'took longer than 30s' });
  });

  test('no engine, an engine that cannot run, and a document it cannot read', async () => {
    const uid = await record('deck2.pptx', 'deck two');
    assert.deepEqual(await rendition.renditionOf(uid, null), { ok: false, status: 503, reason: 'this build carries no conversion engine' });
    const cannot = scripted([new hostMod.EngineUnavailable('this runtime cannot keep the conversion engine off the network')]);
    assert.deepEqual(await rendition.renditionOf(uid, cannot), { ok: false, status: 503, reason: 'this runtime cannot keep the conversion engine off the network' });
    const broken = scripted([new hostMod.ConversionFailed('The document could not be converted')]);
    assert.equal((await rendition.renditionOf(await record('bad.docx', 'bad'), broken) as { reason: string }).reason, 'The document could not be converted');
  });

  test('not an Office file, not an attachment, or past the cap', async () => {
    const host = scripted([]);
    assert.equal((await rendition.renditionOf(await record('totals.csv', 'a,b'), host) as { status: number }).status, 415);
    assert.equal((await rendition.renditionOf('no-such-attachment', host) as { status: number }).status, 404);
    const big = path.join(project, 'out', 'huge.docx');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, rendition.CONVERTIBLE.docx + 1);
    const uid = (await artefacts.recordArtefact({ itemUid: ITEM, path: 'out/huge.docx', role: 'material', actor: AGENT })).uid;
    assert.equal((await rendition.renditionOf(uid, host) as { status: number }).status, 413);
    assert.equal(host.calls.length, 0);
  });

  test('a material swapped for a link after recording is not read', async () => {
    const uid = await record('swap.docx', 'real');
    fs.writeFileSync(path.join(tmp, 'secret.docx'), 'SECRET');
    fs.rmSync(path.join(project, 'out', 'swap.docx'));
    fs.symlinkSync(path.join(tmp, 'secret.docx'), path.join(project, 'out', 'swap.docx'));
    const host = scripted([]);
    const result = await rendition.renditionOf(uid, host);
    assert.equal(result.ok, false);
    assert.equal(host.calls.length, 0);
  });
});
