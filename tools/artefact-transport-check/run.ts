/**
 * Phase 31 §7.1 — `npx tsx tools/artefact-transport-check/run.ts`
 *
 * The packaged renderer is a file:// page, and no browser test runs one: a
 * fetch() from it to ct-artefact: was refused as cross-origin, and every
 * document view in a packaged build failed while dev and CI served the same
 * views over HTTP. This bundles the real transport, preload and fetch shim
 * and runs them in Electron (under xvfb-run where there is no display).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

async function main(): Promise<void> {
  const here = __dirname;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-artefact-transport-'));
  const common = { bundle: true, logLevel: 'error' as const, external: ['electron'] };
  await build({ ...common, entryPoints: [path.join(here, 'main.ts')], outfile: path.join(work, 'main.cjs'), platform: 'node', format: 'cjs' });
  await build({ ...common, entryPoints: [path.join(here, '..', '..', 'src', 'electron', 'preload.ts')], outfile: path.join(work, 'preload.cjs'), platform: 'node', format: 'cjs' });
  await build({ ...common, entryPoints: [path.join(here, 'page.ts')], outfile: path.join(work, 'page.js'), platform: 'browser', format: 'iife' });
  fs.writeFileSync(path.join(work, 'page.html'), '<!doctype html><meta charset="utf-8"><script src="page.js"></script>');
  fs.writeFileSync(path.join(work, 'blank.html'), '<!doctype html><meta charset="utf-8">');

  const electron = String(require('electron'));
  // This checks the transport, not Chromium's sandbox; as root Electron will
  // not start without this switch.
  const args = [path.join(work, 'main.cjs'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
  const cmd = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', '-a', electron, ...args] : [electron, ...args];
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

void main();
