/**
 * Phase 31 §7.6 — the conversion engine this build will run.
 *
 * `engine-lock.json` is written from the engine build's job summary
 * (.github/workflows/rendition-engine.yml), never by hand: the engine's
 * version, the sha256 of every file it is made of, the archive it ships in,
 * and whether it passed the network proof. Pinned here so an installed
 * engine cannot vouch for itself; scripts/fetch-rendition-engine.mjs
 * reads the same file to put that exact engine into a package.
 *
 * `version: null` until an engine is published: a packaged app then runs no
 * engine, and every Office file uses its packaged fallback view.
 */

import type { EnginePin } from './engine-manifest';
import lock from './engine-lock.json';

interface LockFile {
  version: string | null;
  networkFree: boolean;
  archive: { url: string; sha256: string } | null;
  files: Record<string, string>;
}

const pinned = lock as LockFile;

export const ENGINE_PIN: EnginePin | null = pinned.version
  ? { version: pinned.version, files: pinned.files, networkFree: pinned.networkFree === true }
  : null;
