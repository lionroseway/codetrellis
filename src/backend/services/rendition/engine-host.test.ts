/**
 * Phase 31 §7.6 — the engine host, against a stand-in engine.
 *
 * The real engine is a quarter of a gigabyte and is not in the repo; what
 * the host promises does not depend on it. The stand-in answers with a tiny
 * PDF, and on cue hangs, crashes, overflows, or tries to reach the network
 * or the disk. The child entry is bundled exactly as the build does.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { EngineHost, EngineUnavailable, ConversionFailed, runtimeIsolation } from './engine-host';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-engine-'));
const engineDir = path.join(tmp, 'engine');
const childScript = path.join(tmp, 'engine-child.cjs');
const secret = path.join(tmp, 'outside.txt');

const ADAPTER = `
exports.create = async () => ({
  async convert(bytes) {
    const text = Buffer.from(bytes).toString('utf8');
    if (text === 'HANG') return new Promise(() => {});
    if (text === 'CRASH') process.exit(3);
    if (text === 'NOT-PDF') return new Uint8Array([1, 2, 3, 4, 5, 6]);
    if (text === 'THROW') throw new Error('bad input at /secret/path');
    if (text === 'PID') return Buffer.from('%PDF-' + process.pid);
    // __CF_USER_TEXT_ENCODING is set by macOS CoreFoundation inside every
    // process at start (a child forked with env {} has it) — not inherited.
    if (text === 'ENV') return Buffer.from('%PDF-' + JSON.stringify(Object.keys(process.env).filter((k) => k !== '__CF_USER_TEXT_ENCODING')));
    if (text.startsWith('READ ')) {
      try { require('node:fs').readFileSync(text.slice(5)); return Buffer.from('%PDF-read allowed'); }
      catch (e) { return Buffer.from('%PDF-read ' + e.code); }
    }
    if (text === 'NET') {
      const out = [];
      try { require('node:net'); out.push('net loaded'); } catch (e) { out.push('net refused'); }
      out.push(typeof fetch === 'function' ? 'fetch present' : 'fetch absent');
      try { require('node:child_process'); out.push('child_process loaded'); } catch { out.push('child_process refused'); }
      return Buffer.from('%PDF-' + out.join('; '));
    }
    return Buffer.from('%PDF-1.4 ' + text);
  },
});
`;

function writeEngine(version = '1.0.0', dir = engineDir, networkFree?: boolean, adapter = ADAPTER): Record<string, string> {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapter.cjs'), adapter);
  const files = { 'adapter.cjs': createHash('sha256').update(adapter).digest('hex') };
  fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify({ name: 'stand-in', version, adapter: 'adapter.cjs', files, networkFree }));
  return files;
}

const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');
const hosts: EngineHost[] = [];
function host(extra: Partial<ConstructorParameters<typeof EngineHost>[0]> = {}): EngineHost {
  const h = new EngineHost({ engineDir, childScript, requireNetworkDenial: false, timeoutMs: 5_000, startTimeoutMs: 20_000, ...extra });
  hosts.push(h);
  return h;
}

before(() => {
  buildSync({
    entryPoints: [path.join(__dirname, 'child', 'main.ts')],
    outfile: childScript,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
  fs.writeFileSync(secret, 'SECRET');
  writeEngine();
});

after(() => {
  for (const h of hosts) h.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('mounted only when needed', () => {
  test('nothing runs until the first conversion; then it answers, and stops when idle', async () => {
    const h = host({ idleMs: 300 });
    assert.equal(h.running, false);
    assert.equal(text(await h.convert(Buffer.from('hello'), 'docx')), '%PDF-1.4 hello');
    assert.equal(h.running, true);
    assert.equal(h.engineVersion, '1.0.0');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(h.running, false);
  });

  test('conversions queue on one engine rather than starting several', async () => {
    const h = host();
    const pids = await Promise.all([1, 2, 3].map(() => h.convert(Buffer.from('PID'), 'pptx').then(text)));
    assert.equal(new Set(pids).size, 1);
  });
});

describe('a conversion that goes wrong ends, and the next one starts clean', () => {
  test('past its time the engine is killed, and a fresh one serves the next request', async () => {
    const h = host({ timeoutMs: 500 });
    const first = text(await h.convert(Buffer.from('PID'), 'docx'));
    await assert.rejects(h.convert(Buffer.from('HANG'), 'docx'), (e: Error) => e instanceof ConversionFailed && /longer than/.test(e.message));
    assert.equal(h.running, false);
    const second = text(await h.convert(Buffer.from('PID'), 'docx'));
    assert.notEqual(first, second);
  });

  test('a crash rejects what was waiting, and the engine restarts on demand', async () => {
    const h = host();
    await assert.rejects(h.convert(Buffer.from('CRASH'), 'docx'), /stopped unexpectedly/);
    assert.equal(text(await h.convert(Buffer.from('again'), 'docx')), '%PDF-1.4 again');
  });

  test('output that is not a PDF, or too large, is refused; an engine error names no path', async () => {
    const h = host({ maxOutputBytes: 12 });
    await assert.rejects(h.convert(Buffer.from('NOT-PDF'), 'docx'), /did not produce a PDF/);
    await assert.rejects(h.convert(Buffer.from('this output is long'), 'docx'), /larger than/);
    await assert.rejects(h.convert(Buffer.from('THROW'), 'docx'), (e: Error) => !/secret/.test(e.message));
  });
});

describe('an engine starts settled', () => {
  test('one that hangs on its warm-up is replaced, and one that always does is unavailable, in words', async () => {
    // The stand-in hangs on the warm-up document (RTF) and nothing else.
    const stuckDir = path.join(tmp, 'stuck');
    writeEngine('1.0.0', stuckDir, undefined, ADAPTER.replace("const text = Buffer.from(bytes).toString('utf8');", "const text = Buffer.from(bytes).toString('utf8');\n    if (text.startsWith('{\\\\rtf')) return new Promise(() => {});"));
    const h = host({ engineDir: stuckDir, warmUpMs: 500 });
    const started = Date.now();
    await assert.rejects(h.convert(Buffer.from('hello'), 'docx'), (err: Error) =>
      err instanceof EngineUnavailable && /did not settle after starting/.test(err.message));
    // Two tries, each stopped at the warm-up's deadline — not the conversion's.
    assert.ok(Date.now() - started < 4_000, `${Date.now() - started}ms`);
    assert.equal(h.running, false);

    // The ordinary stand-in answers its warm-up, and real work follows.
    const ok = host({ warmUpMs: 5_000 });
    assert.equal(text(await ok.convert(Buffer.from('hello'), 'docx')), '%PDF-1.4 hello');
  });
});

describe('what the engine may not do', () => {
  test('read outside its own directory, see our environment, load network modules or start processes', async () => {
    process.env.CODETRELLIS_CAPABILITY_TOKEN_TEST = 'x';
    const h = host();
    assert.equal(text(await h.convert(Buffer.from(`READ ${secret}`), 'docx')), '%PDF-read ERR_ACCESS_DENIED');
    assert.equal(text(await h.convert(Buffer.from('ENV'), 'docx')), '%PDF-[]');
    assert.equal(text(await h.convert(Buffer.from('NET'), 'docx')), '%PDF-net refused; fetch absent; child_process refused');
    delete process.env.CODETRELLIS_CAPABILITY_TOKEN_TEST;
  });

  test('an engine reached through a symlinked directory still starts, and is still confined', async () => {
    // macOS keeps every temp dir under /var → /private/var, and an engine
    // started through a link died reading "/var" however it was granted. A
    // link made here fails the same way on any OS, so CI on Linux catches it.
    const linked = path.join(os.tmpdir(), `ct-engine-link-${process.pid}`);
    fs.rmSync(linked, { force: true, recursive: true });
    fs.symlinkSync(tmp, linked, 'junction');
    try {
      const h = host({ engineDir: path.join(linked, 'engine'), childScript: path.join(linked, 'engine-child.cjs') });
      assert.equal(text(await h.convert(Buffer.from('hello'), 'docx')), '%PDF-1.4 hello');
      assert.equal(text(await h.convert(Buffer.from(`READ ${secret}`), 'docx')), '%PDF-read ERR_ACCESS_DENIED');
    } finally {
      fs.rmSync(linked, { force: true });
    }
  });

  test('where the runtime cannot keep it off the network, only an engine proven network-free runs', async () => {
    const unproven = host({ requireNetworkDenial: true });
    const provenDir = path.join(tmp, 'proven');
    const files = writeEngine('1.0.0', provenDir, true);
    const proven = host({ engineDir: provenDir, requireNetworkDenial: true });
    if (runtimeIsolation().net) {
      assert.equal(text(await unproven.convert(Buffer.from('ok'), 'docx')), '%PDF-1.4 ok');
    } else {
      await assert.rejects(unproven.convert(Buffer.from('ok'), 'docx'), (e: Error) => e instanceof EngineUnavailable && /not proven network-free/.test(e.message));
      assert.equal(unproven.running, false);
    }
    assert.equal(text(await proven.convert(Buffer.from('ok'), 'docx')), '%PDF-1.4 ok');

    // Packaged, the pin decides — an engine's own manifest cannot claim it.
    const pinnedWithoutProof = host({ engineDir: provenDir, requireNetworkDenial: true, pinned: { version: '1.0.0', files } });
    if (!runtimeIsolation().net) {
      await assert.rejects(pinnedWithoutProof.convert(Buffer.from('ok'), 'docx'), /not proven network-free/);
    }
    const pinnedWithProof = host({ engineDir: provenDir, requireNetworkDenial: true, pinned: { version: '1.0.0', files, networkFree: true } });
    assert.equal(text(await pinnedWithProof.convert(Buffer.from('ok'), 'docx')), '%PDF-1.4 ok');
  });
});

describe('only the engine this build pinned', () => {
  test('a file that does not match its pinned hash, or another version, keeps the engine from starting', async () => {
    const files = writeEngine('1.0.0');
    await assert.rejects(
      host({ pinned: { version: '1.0.0', files: { 'adapter.cjs': '0'.repeat(64) } } }).convert(Buffer.from('x'), 'docx'),
      (e: Error) => e instanceof EngineUnavailable && /does not match/.test(e.message),
    );
    await assert.rejects(
      host({ pinned: { version: '2.0.0', files } }).convert(Buffer.from('x'), 'docx'),
      /this build expects 2\.0\.0/,
    );
    assert.equal(text(await host({ pinned: { version: '1.0.0', files } }).convert(Buffer.from('pinned'), 'docx')), '%PDF-1.4 pinned');
  });

  test('an engine file replaced by a link is refused', async () => {
    const dir = path.join(tmp, 'linked');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(path.join(engineDir, 'adapter.cjs'), path.join(dir, 'adapter.cjs'));
    fs.copyFileSync(path.join(engineDir, 'engine.json'), path.join(dir, 'engine.json'));
    await assert.rejects(host({ engineDir: dir }).convert(Buffer.from('x'), 'docx'), /not a regular file/);
  });

  test('no engine installed is a sentence, not a crash', async () => {
    await assert.rejects(host({ engineDir: path.join(tmp, 'nowhere') }).convert(Buffer.from('x'), 'docx'), /no engine is installed/);
  });
});
