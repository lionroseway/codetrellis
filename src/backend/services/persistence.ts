// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___settings_service from './settings-service';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Two-tier resolution to avoid an import cycle:
 *
 *   - **Settings dir** = env > default. Always resolvable without
 *     reading any file. Settings.json itself lives here.
 *   - **Data dir** = env > settings.dataDirOverride > default. Reads
 *     settings.json, so it depends on the settings dir being known
 *     first. Used for `data.db` and trellis snapshots.
 *
 * The cycle this prevents: previously `getDataDir()` consulted
 * settings-service, which called `getSettingsPath()` which called
 * `getDataDir()`. With settings.json living at a path that doesn't
 * itself depend on settings, the recursion is broken.
 */
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.codetrellis');

/**
 * The directory `settings.json` lives in. Stable, never depends on
 * settings — only env override + default. Used by settings-service's
 * own path resolver.
 */
export function getSettingsDir(): string {
  const fromEnv = process.env.CODETRELLIS_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return DEFAULT_DATA_DIR;
}

/** Fully-resolved data dir (DB, snapshots) — may differ from settings dir. */
function resolveDataDir(): string {
  const fromEnv = process.env.CODETRELLIS_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSettings } = _lazy___settings_service;
    const override = getSettings().data.dataDirOverride;
    if (override && typeof override === 'string' && override.trim()) return override;
  } catch {
    // settings-service may not be ready yet (during early init or
    // tests). Fall through to the default — the DB starts in the
    // canonical place.
  }
  return DEFAULT_DATA_DIR;
}

function getDbPath(): string {
  return path.join(resolveDataDir(), 'data.db');
}

function getDbTmpPath(): string {
  return path.join(resolveDataDir(), 'data.db.tmp');
}

let dirty = false;
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export function ensureDataDir(): void {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[Persistence] Created data directory: ${dir}`);
  }
}

/**
 * Load database binary from disk. Returns null if no saved database exists.
 */
export function loadFromDisk(): Uint8Array | null {
  ensureDataDir();
  if (!fs.existsSync(getDbPath())) {
    console.log('[Persistence] No saved database found, starting fresh');
    return null;
  }

  try {
    const buffer = fs.readFileSync(getDbPath());
    console.log(`[Persistence] Loaded database from ${getDbPath()} (${(buffer.length / 1024).toFixed(1)} KB)`);
    return new Uint8Array(buffer);
  } catch (err) {
    console.error('[Persistence] Failed to load database:', err);
    return null;
  }
}

/**
 * No-op since the migration to better-sqlite3: the database is disk-backed
 * (WAL) and persists writes in place, so there's nothing to export+write.
 * Kept for API compatibility with existing callers.
 */
export function saveToDisk(_data?: Uint8Array): void {
  dirty = false;
}

/**
 * Mark the database as having unsaved changes.
 * Call this after any plan/task/comment mutation.
 */
export function markDirty(): void {
  dirty = true;
}

/**
 * Start auto-saving the database at the given interval.
 * Only writes if dirty flag is set.
 */
export function startAutoSave(_exportFn: () => Uint8Array, _intervalMs = 30000): void {
  // No-op since better-sqlite3: the DB is disk-backed (WAL) and
  // auto-checkpoints, so there's no periodic full-DB export to schedule.
}

/**
 * Force save now — no-op under better-sqlite3 (writes persist in place).
 * Kept so the ~80 existing callers (saveNow(exportDatabase)) don't break
 * and, crucially, no longer serialize the whole DB on every mutation.
 */
export function saveNow(_exportFn: () => Uint8Array): void {
  dirty = false;
}

export function stopAutoSave(): void {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

export function getDataDir(): string {
  return resolveDataDir();
}
