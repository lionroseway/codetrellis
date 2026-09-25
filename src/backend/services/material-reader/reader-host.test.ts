/**
 * Phase 31 §5.1 — reading a material for an agent, end to end: resolved by
 * attachment uid under the item's trusted root, read through the worker
 * process, and stopped — not waited on — when a file hangs the reader or
 * eats its memory; and that process, when built, can reach nothing.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeDeck, makeDocx, makePdf, makeWorkbook } from './fixtures.test-helper';
import type { EngineHost } from '../rendition/engine-host';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-reader-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));
const outside = path.join(tmp, 'outside.md');

let host: typeof import('./reader-host');
let artefacts: typeof import('../artefact-service');

const PLAN = '100b0000-0000-4000-8000-00000000a001';
const ITEM = '9f2c41ab-1111-4000-8000-00000000a001';
const AGENT = { author: 'claude-desktop', authorType: 'mcp' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

before(async () => {
  fs.mkdirSync(path.join(project, 'in'));
  fs.writeFileSync(path.join(project, 'in', 'q3-sales.xlsx'), makeWorkbook({ Regional: [['Region', 'Q3'], ['EMEA', 120]] }));
  fs.writeFileSync(path.join(project, 'in', 'pack.pdf'), makePdf(['Cover', 'EMEA rose 12 percent']));
  fs.writeFileSync(path.join(project, 'in', 'chart.png'), PNG);
  fs.writeFileSync(path.join(project, 'in', 'not-a.png'), 'hello');
  fs.writeFileSync(path.join(project, 'in', 'walkthrough.mp4'), Buffer.alloc(64));
  fs.writeFileSync(path.join(project, 'in', 'notes.md'), 'safe\n');
  fs.writeFileSync(outside, 'secret outside the project\n');

  const db = await import('../database');
  await db.initDatabase();
  (await import('../trusted-roots')).setActiveProjectRoot(project);
  artefacts = await import('../artefact-service');
  host = await import('./reader-host');
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

const record = (rel: string) => artefacts.recordArtefact({ itemUid: ITEM, path: rel, role: 'material', actor: AGENT });

describe('read_material through the reader process', () => {
  test('a workbook sheet, by uid, with the item it belongs to', async () => {
    const a = await record('in/q3-sales.xlsx');
    const r = await host.readMaterial(a.uid, { sheet: 'Regional' });
    assert.equal(r.ok, true, r.ok ? '' : r.reason);
    if (!r.ok || r.kind !== 'text') return;
    assert.equal(r.name, 'q3-sales.xlsx');
    assert.equal(r.itemUid, ITEM);
    assert.equal(r.reply.where, 'sheet "Regional"');
    assert.equal(r.reply.sections[0].body, 'Region,Q3\nEMEA,120');
  });

  test('a PDF page', async () => {
    const a = await record('in/pack.pdf');
    const r = await host.readMaterial(a.uid, { page: 2 });
    assert.ok(r.ok && r.kind === 'text', JSON.stringify(r));
    assert.equal(r.reply.sections[0].body, 'EMEA rose 12 percent');
  });

  test('an image comes back as itself; one that is not what it is named is refused', async () => {
    const png = await host.readMaterial((await record('in/chart.png')).uid, null);
    assert.ok(png.ok && png.kind === 'image');
    assert.equal(png.mimeType, 'image/png');
    assert.deepEqual(Buffer.from(png.base64, 'base64'), PNG);
    const located = await host.readMaterial((await record('in/chart.png')).uid, { page: 1 });
    assert.deepEqual([located.ok, !located.ok && located.status], [false, 422]);
    const fake = await host.readMaterial((await record('in/not-a.png')).uid, null);
    assert.equal(!fake.ok && fake.reason, 'not-a.png is named .png but is not that kind of image');
  });

  test('a video is said not to be readable as text', async () => {
    const r = await host.readMaterial((await record('in/walkthrough.mp4')).uid, null);
    assert.equal(!r.ok && r.status, 415);
  });

  test('a Word document the viewer has rendered reads as that rendition; one it has not, as the document', async () => {
    const docx = makeDocx(['# Highlights', 'EMEA rose.']);
    fs.writeFileSync(path.join(project, 'in', 'summary.docx'), docx);
    const a = await record('in/summary.docx');
    // What the viewer leaves behind: the PDF, named by the bytes and the engine.
    const engine = { check: async () => ({ ok: true, manifest: { version: 'test-engine-1' } }) } as unknown as EngineHost;
    const light = await host.readMaterial(a.uid, null, { engine });
    assert.ok(light.ok && light.kind === 'text' && light.reply.format === 'markdown', 'no rendition yet: the document itself');

    const renditions = path.join(process.env.CODETRELLIS_DATA_DIR!, 'renditions');
    fs.mkdirSync(renditions, { recursive: true });
    const sha = createHash('sha256').update(docx).digest('hex');
    fs.writeFileSync(path.join(renditions, `${sha}-test-engine-1.pdf`), makePdf(['Highlights', 'EMEA rose.']));
    const r = await host.readMaterial(a.uid, { page: 2 }, { engine });
    assert.ok(r.ok && r.kind === 'text', JSON.stringify(r));
    assert.equal(r.reply.where, 'page 2');
    assert.equal(r.reply.sections[0].body, 'EMEA rose.');

    // A different engine made none of these; an engine that does not check out, none at all.
    const other = await host.readMaterial(a.uid, null, { engine: { check: async () => ({ ok: true, manifest: { version: 'other' } }) } as unknown as EngineHost });
    assert.ok(other.ok && other.kind === 'text' && other.reply.format === 'markdown');
    const off = await host.readMaterial(a.uid, null, { engine: { check: async () => ({ ok: false, reason: 'no engine' }) } as unknown as EngineHost });
    assert.ok(off.ok && off.kind === 'text' && off.reply.format === 'markdown');
    const broken = await host.readMaterial(a.uid, null, { engine: { check: async () => { throw new Error('EIO'); } } as unknown as EngineHost });
    assert.ok(broken.ok && broken.kind === 'text' && broken.reply.format === 'markdown', 'an engine that cannot be checked costs nothing');
  });

  test('an unknown uid, and a file swapped for a link after it was recorded, are not read', async () => {
    assert.equal((await host.readMaterial('00000000-0000-4000-8000-000000000000', null)).ok, false);
    const a = await record('in/notes.md');
    const file = path.join(project, 'in', 'notes.md');
    fs.rmSync(file);
    fs.symlinkSync(outside, file);
    const r = await host.readMaterial(a.uid, null);
    assert.equal(r.ok, false);
    assert.doesNotMatch(JSON.stringify(r), /secret outside/);
  });
});

describe('a reader that misbehaves is stopped, and cannot reach out', () => {
  const script = (name: string, body: string) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, body);
    return p;
  };
  const req = { name: 'hostile.pdf', ext: 'pdf', bytes: new Uint8Array(8) };

  test('one that never answers is killed at its deadline', async () => {
    const hang = script('hang.cjs', "process.once('message', () => { setInterval(() => {}, 1000); });");
    const started = Date.now();
    const r = await host.runReader(req, { script: hang, timeoutMs: 500 });
    assert.equal(r.ok, false);
    assert.ok('timedOut' in r && r.timedOut);
    assert.ok(Date.now() - started < 5000);
  });

  test('one that eats its memory dies at its own ceiling — whatever NODE_OPTIONS says', async () => {
    // A worker thread's resourceLimits lose to this; the reader's process must not.
    const before = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = '--max-old-space-size=8192';
    try {
      const hog = script('hog.cjs', "process.once('message', () => { const keep = []; for (let i = 0;; i++) keep.push({ i, s: 'x' + i }); });");
      const started = Date.now();
      const r = await host.runReader(req, { script: hog, heapMb: 64, timeoutMs: 60_000 });
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /needs more memory to read than CodeTrellis allows/);
      assert.ok(Date.now() - started < 30_000, 'stopped by the heap ceiling, not the deadline');
    } finally {
      if (before === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = before;
    }
  });

  test('a built reader can read no file, start no process and no thread, and sees none of our environment', async () => {
    process.env.CT_READER_TEST_SECRET = 'capability-token-lookalike';
    const probe = script('probe.cjs', `
      const out = {};
      const tryIt = (k, fn) => { try { fn(); out[k] = 'allowed'; } catch (e) { out[k] = e.code || e.message; } };
      tryIt('read', () => require('node:fs').readFileSync(${JSON.stringify(outside)}));
      tryIt('write', () => require('node:fs').writeFileSync(${JSON.stringify(path.join(tmp, 'written.txt'))}, 'x'));
      tryIt('spawn', () => require('node:child_process').spawnSync('true'));
      tryIt('thread', () => new (require('node:worker_threads').Worker)('1', { eval: true }));
      out.env = Object.keys(process.env).filter((k) => k !== 'ELECTRON_RUN_AS_NODE');
      process.once('message', () => process.send({ ok: false, reason: JSON.stringify(out) }));
    `);
    const r = await host.runReader(req, { script: probe });
    delete process.env.CT_READER_TEST_SECRET;
    const out = JSON.parse((r as { reason: string }).reason);
    assert.deepEqual(out, { read: 'ERR_ACCESS_DENIED', write: 'ERR_ACCESS_DENIED', spawn: 'ERR_ACCESS_DENIED', thread: 'ERR_ACCESS_DENIED', env: [] });
    assert.equal(fs.existsSync(path.join(tmp, 'written.txt')), false);
  });

  const bundle = path.resolve(__dirname, '..', '..', '..', '..', 'out', 'reader', 'material-reader.mjs');
  test('the shipped bundle reads every format while confined', { skip: !fs.existsSync(bundle) && 'run npm run build:reader first (CI does)' }, async () => {
    const cases: Array<[string, Buffer, object | null, RegExp]> = [
      ['q3.xlsx', makeWorkbook({ Regional: [['EMEA', 120]] }), { sheet: 'Regional' }, /^EMEA,120$/],
      ['pack.pdf', makePdf(['Cover', 'EMEA rose 12 percent']), { page: 2 }, /^EMEA rose 12 percent$/],
      ['board.pptx', makeDeck([['Totals', 'Ties to the ledger']]), null, /^Ties to the ledger$/],
      ['summary.docx', makeDocx(['# Highlights', 'EMEA rose.']), null, /# Highlights\n\nEMEA rose\./],
    ];
    for (const [name, bytes, locator, want] of cases) {
      const r = await host.runReader({ name, ext: name.split('.').pop()!, bytes: new Uint8Array(bytes), locator }, { script: bundle });
      assert.ok(r.ok, `${name}: ${(r as { reason?: string }).reason}`);
      assert.match((r as Extract<typeof r, { ok: true }>).sections[0].body, want, name);
    }
  });
});
