/**
 * The `codetrellis` command the desktop app carries, run from a built
 * artifact on its own OS, the way the app installs it (cli-install.ts):
 *
 *   npx tsx scripts/smoke-cli-packaged.ts linux <out/make/linux-unpacked> <the .AppImage>
 *   npx tsx scripts/smoke-cli-packaged.ts win <out/make/win-unpacked>
 *
 * Linux: the launcher a .deb install links to, through a link as
 * `~/.local/bin/codetrellis` is one; and the launcher an AppImage install
 * writes, naming the AppImage file. Windows: `codetrellis.cmd`, which the
 * installer's PATH entry finds. Each must report the app's version and scan
 * the sample app on the app's own binary in Node mode, with no Node install
 * of its own: that is what proves the CLI's packages resolve from app.asar
 * and werift from the CLI's own copy.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appImageLauncher } from '../src/backend/services/cli-install';

const root = path.resolve(__dirname, '..');
const version = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
const sample = path.join(root, 'tests', 'fixtures', 'sample-app');

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

/** Run one way of starting the CLI: its version, then a scan of the sample app. */
function check(label: string, run: (args: string[]) => string): void {
  console.log(`== ${label}`);
  const v = run(['--version']).trim();
  if (v !== version) fail(`${label}: reported "${v}", expected ${version}`);
  console.log(`  ✓ --version ${v}`);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cli-smoke-'));
  const out = run(['scan', '--project', sample, '--data-dir', data, '--json']);
  const line = out.split('\n').find((l) => l.startsWith('{'));
  const r = line ? (JSON.parse(line) as { parsed: number; symbols: number }) : null;
  if (!r || r.parsed < 30 || r.symbols < 100) fail(`${label}: the scan found too little: ${line ?? out.slice(-400)}`);
  console.log(`  ✓ scan: ${r.parsed} files parsed, ${r.symbols} symbols`);
}

// The CLI must not borrow a Node install's packages: no NODE_PATH from outside.
const env = { ...process.env };
delete env.NODE_PATH;
const exec = (file: string, args: string[], opts: { shell?: boolean } = {}) =>
  execFileSync(file, args, { encoding: 'utf8', env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000, ...opts });

const [mode, given, appImage] = process.argv.slice(2);
const dir = given ? path.resolve(given) : '';
if (!dir || !fs.existsSync(dir)) fail(`no build at ${dir}`);

if (mode === 'linux') {
  const launcher = path.join(dir, 'resources', 'cli', 'bin', 'codetrellis');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cli-home-'));
  const link = path.join(home, '.local', 'bin', 'codetrellis');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(launcher, link);
  check('.deb / .rpm: ~/.local/bin/codetrellis, a link to the app\'s launcher', (args) => exec(link, args));

  if (!appImage || !fs.existsSync(appImage)) fail(`no AppImage at ${appImage}`);
  const written = path.join(home, 'appimage-bin', 'codetrellis');
  fs.mkdirSync(path.dirname(written), { recursive: true });
  fs.writeFileSync(written, appImageLauncher(path.resolve(appImage)), { mode: 0o755 });
  check('AppImage: the launcher the app writes, naming the AppImage file', (args) => exec(written, args));
} else if (mode === 'win') {
  const cmd = path.join(dir, 'resources', 'cli', 'bin', 'codetrellis.cmd');
  if (!fs.existsSync(cmd)) fail(`no ${cmd}`);
  check('Windows: codetrellis.cmd, as the PATH entry finds it', (args) => exec('cmd.exe', ['/d', '/c', cmd, ...args]));
} else {
  fail('usage: smoke-cli-packaged.ts linux <linux-unpacked> <AppImage> | win <win-unpacked>');
}
console.log('The CLI the app carries runs from the build.');
