#!/usr/bin/env node
/**
 * Prove a packaged app knows what it is.
 *
 *   node scripts/verify-build-stamp.js <path/to/app.asar> [...more]
 *
 * For each archive, reads the bundled main process and checks:
 *
 *   - the version the code will report is package.json's version, and
 *   - the build stamp names the commit being built (HEAD).
 *
 * Exits non-zero on any mismatch. `release.sh` runs this on the macOS
 * apps and `build-installers.yml` on the Windows / Linux ones.
 *
 * Why this exists: v0.1.10–v0.1.13 all reported 0.1.9, and v0.1.15
 * reported 0.1.14 and offered users itself as an update. Typecheck, the
 * web build and every test passed each time, because none of them look
 * inside the packaged artifact. This does. See src/shared/build-info.ts.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

let asar;
try {
  asar = require('@electron/asar');
} catch {
  console.error('[verify-build-stamp] @electron/asar not found — run `npm ci` first (it ships with electron-builder).');
  process.exit(2);
}

const expectedVersion = require(path.join(REPO_ROOT, 'package.json')).version;
const expectedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();

const archives = process.argv.slice(2);
if (archives.length === 0) {
  console.error('usage: verify-build-stamp.js <app.asar> [...]');
  process.exit(2);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let failed = false;

for (const archive of archives) {
  const problems = [];
  if (!fs.existsSync(archive)) {
    console.error(`✗ ${archive}: not found`);
    failed = true;
    continue;
  }

  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf-8'));
  // @electron/asar looks entries up by the OS separator, so on Windows
  // "out/main/main.js" is not found — the first Windows run of this check
  // failed a good build. Split `main` and rejoin it the native way.
  const mainEntry = path.join(...pkg.main.replace(/^\.\//, '').split('/'));
  const main = asar.extractFile(archive, mainEntry).toString('utf-8');

  if (pkg.version !== expectedVersion) {
    problems.push(`packaged package.json is ${pkg.version}, expected ${expectedVersion}`);
  }
  // build-info.ts imports `version` from package.json; the bundler inlines
  // it as a string constant. `version` may be renamed (`version$1`) but
  // keeps its prefix.
  if (!new RegExp(`\\bversion(\\$\\d+)?\\s*=\\s*"${escape(expectedVersion)}"`).test(main)) {
    problems.push(`bundled code does not carry version "${expectedVersion}"`);
  }
  const stamp = main.match(/buildTime:\s*"([^"]+)",\s*buildNumber:\s*(\d+),\s*commit:\s*"([0-9a-f]*)"[^}]*dirty:\s*(true|false)/);
  if (!stamp) {
    problems.push('no build stamp in the bundle — was it built without electron-vite?');
  } else if (stamp[3] !== expectedCommit) {
    problems.push(`stamped commit ${stamp[3].slice(0, 7) || '(none)'}, HEAD is ${expectedCommit.slice(0, 7)}`);
  }

  if (problems.length) {
    failed = true;
    console.error(`✗ ${archive}`);
    for (const p of problems) console.error(`    ${p}`);
  } else {
    const [, buildTime, buildNumber, , dirty] = stamp;
    console.log(`✓ ${archive}: v${expectedVersion} ${expectedCommit.slice(0, 7)} build #${buildNumber} ${buildTime}${dirty === 'true' ? ' (dirty)' : ''}`);
  }
}

process.exit(failed ? 1 : 0);
