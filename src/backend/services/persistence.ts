import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Resolve the data directory at every call so it picks up:
 *   1. `CODETRELLIS_DATA_DIR` env var (used by the E2E harness — see
 *      docs/E2E-HARNESS.md §7), highest priority.
 *   2. Settings override (`settings.dataDirOverride`) — set via the
 *      Settings panel for users who want their plans/DB on a network
 *      drive or shared volume.
 *   3. Default `~/.codetrellis/`.
 *
 * settings-service is loaded lazily to dodge an import cycle
 * (settings-service depends on persistence's `getDataDir()`).
 */
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.codetrellis');

function getDbPath(): string {
  return path.join(resolveDataDir(), 'data.db');
}

function getDbTmpPath(): string {
  return path.join(resolveDataDir(), 'data.db.tmp');
}

function resolveDataDir(): string {
  const fromEnv = process.env.CODETRELLIS_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSettings } = require('./settings-service');
    const override = getSettings().data.dataDirOverride;
    if (override) return override;
  } catch {
    // settings-service may itself depend on getDataDir(); if that
    // happens during init, just fall through to the default.
  }
  return DEFAULT_DATA_DIR;
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
 * Save database binary to disk atomically (write to .tmp, then rename).
 */
export function saveToDisk(data: Uint8Array): void {
  ensureDataDir();
  try {
    fs.writeFileSync(getDbTmpPath(), data);
    fs.renameSync(getDbTmpPath(), getDbPath());
    dirty = false;
  } catch (err) {
    console.error('[Persistence] Failed to save database:', err);
  }
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
export function startAutoSave(exportFn: () => Uint8Array, intervalMs = 30000): void {
  if (autoSaveInterval) clearInterval(autoSaveInterval);

  autoSaveInterval = setInterval(() => {
    if (dirty) {
      saveToDisk(exportFn());
      console.log('[Persistence] Auto-saved database');
    }
  }, intervalMs);

  console.log(`[Persistence] Auto-save enabled (every ${intervalMs / 1000}s)`);
}

/**
 * Force save now (called on shutdown or after critical mutations).
 */
export function saveNow(exportFn: () => Uint8Array): void {
  saveToDisk(exportFn());
  console.log('[Persistence] Saved database');
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
