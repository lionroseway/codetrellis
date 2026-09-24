/**
 * Phase 31 §7.3 — `npx tsx tools/html-view-hostile/run.ts`
 *
 * Bundles main.ts with the real src/electron/html-view.ts (only the
 * attachment lookup stubbed: stub-content.ts) and runs it in Electron —
 * under xvfb-run where there is no display (Linux CI). Exits non-zero if the
 * view let anything out.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const here = __dirname;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-html-hostile-')), 'main.cjs');
async function main(): Promise<void> {
await build({
  entryPoints: [path.join(here, 'main.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'error',
  plugins: [{
    name: 'stub-content',
    setup(b) {
      b.onResolve({ filter: /artefact-content-service$/ }, () => ({ path: path.join(here, 'stub-content.ts') }));
    },
  }],
});
const electron = String(require('electron'));
const work = path.dirname(out);
// A stand-in for the OS's "open with another app": if the view ever hands a
// URL to the OS, this leaves a mark the test reads.
const bin = path.join(work, 'bin');
const marker = path.join(work, 'opened.txt');
fs.mkdirSync(bin);
for (const name of ['xdg-open', 'xdg-email', 'open', 'gio', 'kde-open', 'gnome-open', 'x-www-browser', 'sensible-browser']) {
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "$0 $*" >> '${marker}'\n`, { mode: 0o755 });
}
// The opener runs as the test's user, and must be able to leave its mark.
fs.chmodSync(work, 0o777);
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOSTILE_OPEN_MARKER: marker };
// Chromium's sandbox is part of what is tested, so it is never turned off:
// as root, run as HOSTILE_USER (a plain account) or not at all.
const asRoot = process.getuid?.() === 0;
if (asRoot && !process.env.HOSTILE_USER) {
  console.error('Run as a non-root user, or set HOSTILE_USER to one: the sandbox is not turned off for this test.');
  process.exit(2);
}
const launch = [...(process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', '-a'] : []), electron, out];
const cmd = asRoot ? ['runuser', '-u', process.env.HOSTILE_USER!, '--', 'env', `PATH=${env.PATH}`, `HOSTILE_OPEN_MARKER=${marker}`, ...launch] : launch;
if (asRoot) fs.chmodSync(out, 0o755);
const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env });
fs.rmSync(work, { recursive: true, force: true });
process.exit(r.status ?? 1);
}

void main();
