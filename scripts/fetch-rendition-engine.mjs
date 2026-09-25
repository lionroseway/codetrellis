#!/usr/bin/env node
/**
 * Phase 31 §7.6 — put the pinned conversion engine into resources/rendition/engine.
 *
 * Reads src/backend/services/rendition/engine-lock.json (the same pin the app
 * compiles in), downloads the archive it names, and refuses it unless the
 * archive's sha256 and then every file's sha256 match the pin. Packaging
 * copies the directory into the app (extraResources → rendition/engine).
 *
 * `version: null` — no engine published yet — leaves the directory empty,
 * and the packaged app uses its fallback views. An engine already in place
 * that matches the pin is kept rather than downloaded again.
 *
 *   node scripts/fetch-rendition-engine.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'src/backend/services/rendition/engine-lock.json'), 'utf8'));
const dest = path.join(root, 'resources/rendition/engine');

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Every pinned file present, a regular file, and matching; the manifest agreeing on the version. */
function matches(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'engine.json'), 'utf8'));
    if (manifest.version !== lock.version) return `the engine is ${manifest.version}, the pin is ${lock.version}`;
  } catch {
    return 'no engine.json';
  }
  for (const [rel, expected] of Object.entries(lock.files)) {
    const file = path.join(dir, rel);
    let st;
    try { st = fs.lstatSync(file); } catch { return `missing ${rel}`; }
    if (!st.isFile()) return `${rel} is not a regular file`;
    if (sha256(file) !== expected) return `${rel} does not match its pinned hash`;
  }
  return null;
}

if (!lock.version) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  console.log('[rendition] no engine is pinned; packaging without one (Office files use their fallback views)');
  process.exit(0);
}

if (fs.existsSync(dest) && matches(dest) === null) {
  console.log(`[rendition] engine ${lock.version} already in place`);
  process.exit(0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-engine-'));
try {
  const archive = path.join(work, 'engine.tar.gz');
  console.log(`[rendition] downloading engine ${lock.version}`);
  const res = await fetch(lock.archive.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const got = sha256(archive);
  if (got !== lock.archive.sha256) throw new Error(`the archive's sha256 is ${got}; the pin is ${lock.archive.sha256}`);

  const unpacked = path.join(work, 'engine');
  fs.mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', archive, '-C', unpacked], { stdio: 'inherit' });
  const why = matches(unpacked);
  if (why) throw new Error(`the downloaded engine does not match its pin: ${why}`);

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(unpacked, dest, { recursive: true });
  console.log(`[rendition] engine ${lock.version} verified and in place (network-free: ${lock.networkFree === true})`);
} catch (err) {
  console.error(`[rendition] ${err.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
