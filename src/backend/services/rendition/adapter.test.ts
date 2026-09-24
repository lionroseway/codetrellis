/**
 * Phase 31 §7.6 — the engine's adapter, against a stand-in for Emscripten's
 * glue: it must stop LibreOffice's own main() from starting.
 *
 * Emscripten runs an exported main() as soon as the runtime is ready unless
 * told not to, and with PROXY_TO_PTHREAD it does so on a worker — racing the
 * LibreOfficeKit start-up the adapter does itself. That race hung the first
 * conversion of a new engine. Nothing but the real engine reproduces the
 * hang, so this pins the setting that prevents it.
 *
 * Run in a child process: the adapter locks the browser network globals
 * for the rest of whatever process loads it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADAPTER = path.resolve(__dirname, '..', '..', '..', '..', 'tools', 'rendition-engine', 'runtime', 'adapter.cjs');

// Reads its settings from a global Module, as the classic glue does; calls
// "main" the way Emscripten does unless noInitialRun is set.
const GLUE = `
const M = global.Module;
globalThis.__ranMain = false;
M.ENV = {};
M.FS = { mkdirTree() {}, writeFile() {}, readFile() { return new Uint8Array([1]); }, unlink() {} };
M.UTF8ToString = () => '';
M.ccall = (name) => (name === 'libreofficekit_hook' ? 1 : 0);
setImmediate(() => {
  M.onRuntimeInitialized();
  if (!M.noInitialRun) globalThis.__ranMain = true;
});
`;

test('the engine starts without running LibreOffice\'s own main()', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-adapter-'));
  try {
    fs.writeFileSync(path.join(dir, 'soffice.cjs'), GLUE);
    fs.writeFileSync(path.join(dir, 'soffice.wasm'), Buffer.alloc(8));
    fs.writeFileSync(path.join(dir, 'soffice.data'), Buffer.alloc(8));
    const out = execFileSync(process.execPath, ['-e', `
      require(${JSON.stringify(ADAPTER)}).create({ dir: ${JSON.stringify(dir)} })
        .then(() => new Promise((r) => setImmediate(r)))
        .then(() => console.log(JSON.stringify({ ranMain: globalThis.__ranMain })));
    `], { encoding: 'utf8', timeout: 20_000 });
    assert.deepEqual(JSON.parse(out.trim()), { ranMain: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
