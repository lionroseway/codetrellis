#!/usr/bin/env node
/**
 * Build and sign `SHA256SUMS` for a set of release artifacts.
 *
 * Phase 19, finding 23. Called by scripts/release.sh once the artifacts are
 * in out/make; produces two more assets to upload alongside them:
 *
 *   SHA256SUMS      one "<sha256>  <filename>" line per artifact
 *   SHA256SUMS.sig  detached Ed25519 signature over that file's bytes
 *
 * The format is `shasum -a 256` output on purpose. A user who does not trust
 * our in-app verification can run `shasum -c SHA256SUMS` themselves, which is
 * worth more than a format only we can read.
 *
 * Usage:  node scripts/sign-release-manifest.js <outDir> <file>...
 *
 * The FILE LIST IS PASSED IN, not globbed here. release.sh already knows which
 * artifacts belong to this version — the naming differs per platform
 * (`codetrellis_1.2.3_amd64.deb` vs `CodeTrellis-1.2.3-arm64.dmg`) and
 * duplicating that knowledge is how a manifest ends up describing a different
 * set of files than the release actually contains.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash, createPrivateKey, sign } = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const KEY_PATH = path.join(REPO_ROOT, 'scripts', 'release-signing-key.pem');

const [, , outDir, ...files] = process.argv;
if (!outDir || files.length === 0) {
  console.error('Usage: node scripts/sign-release-manifest.js <outDir> <file>...');
  process.exit(2);
}

if (!fs.existsSync(KEY_PATH)) {
  console.error(`No signing key at ${path.relative(REPO_ROOT, KEY_PATH)}.`);
  console.error('Generate one with: node scripts/generate-signing-key.js');
  console.error('');
  console.error('This is fatal rather than a warning. An unsigned release cannot be');
  console.error('verified by the app, so every user would be silently left on the');
  console.error('unverified browser path — and nothing about the release would look wrong.');
  process.exit(1);
}

const lines = [];
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`Artifact does not exist: ${file}`);
    process.exit(1);
  }
  const name = path.basename(file);
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  lines.push(`${digest}  ${name}`);
  console.log(`  ${digest.slice(0, 12)}\u2026  ${name}`);
}

const manifest = Buffer.from(lines.join('\n') + '\n', 'utf-8');
fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), manifest);

const key = createPrivateKey(fs.readFileSync(KEY_PATH));
// Ed25519 signs the message directly \u2014 no digest algorithm to pass, and so
// none to get wrong.
const signature = sign(null, manifest, key);
fs.writeFileSync(path.join(outDir, 'SHA256SUMS.sig'), signature.toString('base64') + '\n');

console.log(`\nSigned ${lines.length} artifact(s) \u2192 SHA256SUMS + SHA256SUMS.sig`);
