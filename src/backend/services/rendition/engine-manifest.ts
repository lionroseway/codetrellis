/**
 * Phase 31 §7.6 — is the engine on disk the one we built?
 *
 * A packaged build carries the engine's version and the sha256 of every file
 * it is made of (`engine-lock.json`, compiled in), so an engine directory
 * cannot vouch for itself. Each file is hashed before the engine may start —
 * streamed, and refused if it is a link or not a regular file — once per
 * launch for a given set of files. A mismatch, a missing file or a link
 * means the engine does not run, and the viewer falls back.
 *
 * Without a pin (a source run pointed at a locally built engine), the
 * directory's own `engine.json` list is used.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface EngineManifest {
  name: string;
  version: string;
  adapter: string;
  files: Record<string, string>;
  /**
   * The engine passed the network proof when it was built (network-proof.ts):
   * every network-capable import is a stub that fails, and its glue carries no
   * network machinery. Written by CI, never by hand.
   */
  networkFree?: boolean;
}

export interface EnginePin {
  version: string;
  files: Record<string, string>;
  /** As EngineManifest.networkFree — for a packaged build, only the pin's word counts. */
  networkFree?: boolean;
}

export type EngineCheck = { ok: true; manifest: EngineManifest } | { ok: false; reason: string };

const verified = new Map<string, { stamp: string; result: EngineCheck }>();

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function readManifest(dir: string): EngineManifest | string {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'engine.json'), 'utf-8'));
  } catch {
    return 'no engine is installed';
  }
  const m = raw as Partial<EngineManifest>;
  if (typeof m.name !== 'string' || typeof m.version !== 'string' || typeof m.adapter !== 'string'
    || !m.files || typeof m.files !== 'object') {
    return 'the engine manifest is malformed';
  }
  if (!(m.adapter in m.files)) return 'the engine manifest does not cover its adapter';
  for (const [rel, sha] of Object.entries(m.files)) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) return 'the engine manifest is malformed';
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return 'the engine manifest names a file outside the engine';
  }
  return m as EngineManifest;
}

/** Verify every file in the manifest; cached per launch until a file changes. */
export async function verifyEngine(dir: string, pin?: EnginePin): Promise<EngineCheck> {
  const read = readManifest(dir);
  if (typeof read === 'string') return { ok: false, reason: read };
  let manifest = read;
  if (pin) {
    if (read.version !== pin.version) return { ok: false, reason: `the engine is ${read.version}; this build expects ${pin.version}` };
    if (!(read.adapter in pin.files)) return { ok: false, reason: 'the engine\'s adapter is not one this build pinned' };
    manifest = { ...read, files: pin.files, networkFree: pin.networkFree === true };
  }

  const stats: string[] = [];
  for (const rel of Object.keys(manifest.files)) {
    let st: fs.Stats;
    try { st = fs.lstatSync(path.join(dir, rel)); } catch { return { ok: false, reason: `the engine is missing ${rel}` }; }
    if (!st.isFile()) return { ok: false, reason: `the engine's ${rel} is not a regular file` };
    stats.push(`${rel}:${st.size}:${st.mtimeMs}`);
  }
  // Keyed by everything that decides the answer — what is expected, what it
  // attests, and what is on disk: a different pin is a different question.
  const stamp = `${JSON.stringify(manifest.files)}|${manifest.version}|${manifest.networkFree === true}|${stats.join('|')}`;
  const cached = verified.get(dir);
  if (cached && cached.stamp === stamp) return cached.result;

  let result: EngineCheck = { ok: true, manifest };
  for (const [rel, expected] of Object.entries(manifest.files)) {
    if ((await hashFile(path.join(dir, rel))) !== expected) {
      result = { ok: false, reason: `the engine's ${rel} does not match the hash it was built with` };
      break;
    }
  }
  verified.set(dir, { stamp, result });
  return result;
}
