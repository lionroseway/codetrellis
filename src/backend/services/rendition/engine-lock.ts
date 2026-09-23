/**
 * Phase 31 §7.6 — the conversion engine this build will run.
 *
 * The engine's version and the sha256 of every file it is made of, pinned
 * here so an installed engine cannot vouch for itself. Written by the engine
 * build (from LibreOffice's own source, recorded in
 * `resources/rendition/README.md`), never by hand.
 *
 * `null` until that build exists: a packaged app then runs no engine at all,
 * and every Office file uses its packaged fallback view.
 */

import type { EnginePin } from './engine-manifest';

export const ENGINE_PIN: EnginePin | null = null;
