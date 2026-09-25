/**
 * Phase 31 §13 — `npx tsx tools/signoff-pdf-check/run.ts`
 *
 * The sign-off pack's PDF is printed by Electron in a window nobody sees,
 * which no browser test can reach. This bundles the real `htmlToPdf` and
 * runs it in Electron (under xvfb-run where there is no display): the
 * output must be a PDF, and the printing window must reach nothing on the
 * network, whatever the page asks for.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

async function main(): Promise<void> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-signoff-pdf-'));
  await build({
    bundle: true, logLevel: 'error', external: ['electron'],
    entryPoints: [path.join(__dirname, 'main.ts')], outfile: path.join(work, 'main.cjs'), platform: 'node', format: 'cjs',
  });
  const electron = String(require('electron'));
  // This checks the printing window's isolation, not Chromium's sandbox; as
  // root Electron will not start without this switch.
  const args = [path.join(work, 'main.cjs'), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
  const cmd = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', '-a', electron, ...args] : [electron, ...args];
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

void main();
