import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = path.join(os.homedir(), '.codetrellis');
const DB_PATH = path.join(DATA_DIR, 'data.db');
const DB_TMP_PATH = path.join(DATA_DIR, 'data.db.tmp');

let dirty = false;
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[Persistence] Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Load database binary from disk. Returns null if no saved database exists.
 */
export function loadFromDisk(): Uint8Array | null {
  ensureDataDir();
  if (!fs.existsSync(DB_PATH)) {
    console.log('[Persistence] No saved database found, starting fresh');
    return null;
  }

  try {
    const buffer = fs.readFileSync(DB_PATH);
    console.log(`[Persistence] Loaded database from ${DB_PATH} (${(buffer.length / 1024).toFixed(1)} KB)`);
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
    fs.writeFileSync(DB_TMP_PATH, data);
    fs.renameSync(DB_TMP_PATH, DB_PATH);
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
  return DATA_DIR;
}
