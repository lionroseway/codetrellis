#!/usr/bin/env node
/**
 * Every patch in patches/ is applied in node_modules (Phase 32 HD4c).
 *
 * `patch-package` runs as the root postinstall, so an install that skips
 * scripts (`npm ci --ignore-scripts`, which the installer builds use) skips
 * it too, and nothing said so: the Windows and Linux installers CI built
 * could ship without the werift SCTP patch the phone's link relies on. This
 * reads each patch and checks that every hunk's result is in the installed
 * file, with no git and no shell, so it runs the same on every runner.
 *
 *   node scripts/check-patches.cjs     exits 1, naming each file, when one is not applied
 */
const fs = require('node:fs');
const path = require('node:path');

/** The hunks of a unified diff, each as the lines it leaves, per file. */
function parsePatch(text) {
  const files = [];
  let file = null;
  let hunk = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = { path: line.slice(4).replace(/^b\//, '').trim(), hunks: [] };
      files.push(file);
      hunk = null;
    } else if (line.startsWith('@@') && file) {
      hunk = [];
      file.hunks.push(hunk);
    } else if (hunk && (line.startsWith(' ') || line.startsWith('+'))) {
      hunk.push(line.slice(1));
    } else if (hunk && line.startsWith('\\')) {
      /* "\ No newline at end of file" */
    }
  }
  return files;
}

/** The files a patch should have changed but has not, relative to `root`. */
function unapplied(patchText, root) {
  const missing = [];
  for (const f of parsePatch(patchText)) {
    const abs = path.join(root, f.path);
    let body;
    try { body = fs.readFileSync(abs, 'utf8'); } catch { missing.push(`${f.path} (not installed)`); continue; }
    const lines = body.split('\n');
    for (const h of f.hunks) {
      if (!containsBlock(lines, h)) { missing.push(f.path); break; }
    }
  }
  return missing;
}

function containsBlock(lines, block) {
  if (block.length === 0) return true;
  outer: for (let i = 0; i + block.length <= lines.length; i++) {
    for (let j = 0; j < block.length; j++) if (lines[i + j] !== block[j]) continue outer;
    return true;
  }
  return false;
}

/** Every patch under `root/patches` that is not fully applied, with the files that say so. */
function check(root) {
  const dir = path.join(root, 'patches');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.patch')).flatMap((n) => {
    const files = unapplied(fs.readFileSync(path.join(dir, n), 'utf8'), root);
    return files.length ? [{ patch: n, files }] : [];
  });
}

module.exports = { parsePatch, unapplied, check };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const bad = check(root);
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b.patch} is not applied: ${b.files.join(', ')}`);
    console.error('Run `npx patch-package` after an install that skipped scripts.');
    process.exit(1);
  }
  console.log('✓ every patch in patches/ is applied');
}
