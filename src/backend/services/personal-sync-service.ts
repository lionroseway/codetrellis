/**
 * Personal sync service — Phase 5.3.
 *
 * Reads/writes a `codetrellis-sync/` directory inside the user's
 * configured `personalSyncPath`. The user chooses the path — a
 * personal git repo, an iCloud Drive folder, a Dropbox directory —
 * and handles the sync mechanism themselves (git push/pull, cloud
 * daemon, etc.). CodeTrellis only writes files; it never initiates
 * network operations.
 *
 * Sync artefacts:
 *
 *   codetrellis-sync/
 *   ├── settings.json          ← settings snapshot (all except machine-local)
 *   ├── recent-projects.json   ← project paths + last-opened timestamps
 *   └── .sync-meta.json        ← machine id + last export timestamp
 *
 * In `full` mode the DB could also be exported here, but v1 starts
 * with `selective` (settings + recent-projects only) which covers the
 * 90% use case. Full-DB export is deferred — it requires careful
 * exclusion of machine-local rows (sessions, tool-call streams,
 * cached graph computations) and the DB can be large.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSettings } from './settings-service';
import type { AppSettings, PersonalSyncMode } from '../../shared/types';

const SYNC_DIR_NAME = 'codetrellis-sync';

/** Machine-local fields stripped before exporting settings. */
const MACHINE_LOCAL_KEYS: (keyof AppSettings)[] = [];

interface SyncMeta {
  machineId: string;
  hostname: string;
  lastExportAt: string;
}

interface RecentProjectEntry {
  projectPath: string;
  lastOpenedAt: string;
}

interface SyncStatus {
  configured: boolean;
  mode: PersonalSyncMode;
  syncPath: string;
  syncDirExists: boolean;
  lastExportAt: string | null;
  lastImportAvailable: boolean;
  /** If another machine exported, its hostname. */
  remoteMachine: string | null;
}

// Stable machine id derived from hostname + homedir hash.
function getMachineId(): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto
    .createHash('sha256')
    .update(`${os.hostname()}:${os.homedir()}`)
    .digest('hex')
    .slice(0, 12);
}

function getSyncDir(): string | null {
  const settings = getSettings();
  const syncPath = settings.data.personalSyncPath;
  if (!syncPath || !syncPath.trim()) return null;
  return path.join(syncPath, SYNC_DIR_NAME);
}

function ensureSyncDir(): string | null {
  const dir = getSyncDir();
  if (!dir) return null;
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn('[PersonalSync] Cannot create sync directory:', err);
      return null;
    }
  }
  return dir;
}

/**
 * Export current settings + recent-projects to the sync directory.
 * Called by the user via the Settings panel or a manual MCP trigger.
 */
export function exportSync(recentProjects: RecentProjectEntry[] = []): {
  exported: boolean;
  syncDir: string | null;
  error?: string;
} {
  const dir = ensureSyncDir();
  if (!dir) return { exported: false, syncDir: null, error: 'No sync path configured' };

  const settings = getSettings();
  if (settings.data.personalSyncMode === 'none') {
    return { exported: false, syncDir: dir, error: 'Sync mode is "none"' };
  }

  try {
    // Settings snapshot (strip nothing for now — all settings are
    // safe to sync. Machine-local data like sessions lives in the DB,
    // not in settings.json).
    const settingsSnapshot = { ...settings };
    // Don't sync the personalSyncPath itself — the target machine
    // will have its own path. Also don't sync dataDirOverride.
    const exportSettings: AppSettings = {
      ...settingsSnapshot,
      data: {
        ...settingsSnapshot.data,
        dataDirOverride: '',       // machine-local
        personalSyncPath: '',      // machine-local
      },
    };
    atomicWrite(path.join(dir, 'settings.json'), JSON.stringify(exportSettings, null, 2));

    // Recent projects
    atomicWrite(path.join(dir, 'recent-projects.json'), JSON.stringify(recentProjects, null, 2));

    // Sync metadata
    const meta: SyncMeta = {
      machineId: getMachineId(),
      hostname: os.hostname(),
      lastExportAt: new Date().toISOString(),
    };
    atomicWrite(path.join(dir, '.sync-meta.json'), JSON.stringify(meta, null, 2));

    return { exported: true, syncDir: dir };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PersonalSync] Export failed:', msg);
    return { exported: false, syncDir: dir, error: msg };
  }
}

/**
 * Read what's available to import from the sync directory (without
 * actually applying it). Used by the first-run wizard to show the
 * user what they'd get.
 */
export function peekImport(): {
  available: boolean;
  syncDir: string | null;
  remoteMachine: string | null;
  lastExportAt: string | null;
  hasSettings: boolean;
  hasRecentProjects: boolean;
  recentProjectCount: number;
} {
  const dir = getSyncDir();
  if (!dir || !fs.existsSync(dir)) {
    return {
      available: false,
      syncDir: dir,
      remoteMachine: null,
      lastExportAt: null,
      hasSettings: false,
      hasRecentProjects: false,
      recentProjectCount: 0,
    };
  }

  const hasSettings = fs.existsSync(path.join(dir, 'settings.json'));
  const hasRecentProjects = fs.existsSync(path.join(dir, 'recent-projects.json'));
  let remoteMachine: string | null = null;
  let lastExportAt: string | null = null;
  let recentProjectCount = 0;

  try {
    const metaPath = path.join(dir, '.sync-meta.json');
    if (fs.existsSync(metaPath)) {
      const meta: SyncMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      remoteMachine = meta.hostname || null;
      lastExportAt = meta.lastExportAt || null;
    }
  } catch { /* ignore */ }

  try {
    if (hasRecentProjects) {
      const projects: RecentProjectEntry[] = JSON.parse(
        fs.readFileSync(path.join(dir, 'recent-projects.json'), 'utf-8'),
      );
      recentProjectCount = Array.isArray(projects) ? projects.length : 0;
    }
  } catch { /* ignore */ }

  return {
    available: hasSettings || hasRecentProjects,
    syncDir: dir,
    remoteMachine,
    lastExportAt,
    hasSettings,
    hasRecentProjects,
    recentProjectCount,
  };
}

/**
 * Apply settings from the sync directory to this machine's settings.
 * Merges imported settings with the local ones (import wins for
 * identity, plans preferences; local wins for machine-specific fields
 * like data dir, sync path, MCP port).
 */
export function importSync(): {
  imported: boolean;
  error?: string;
  settingsImported: boolean;
  recentProjects: RecentProjectEntry[];
} {
  const dir = getSyncDir();
  if (!dir || !fs.existsSync(dir)) {
    return { imported: false, error: 'Sync directory does not exist', settingsImported: false, recentProjects: [] };
  }

  let settingsImported = false;
  const recentProjects: RecentProjectEntry[] = [];

  try {
    // Import settings
    const settingsPath = path.join(dir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const imported: Partial<AppSettings> = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      // Merge: import identity + plans prefs, preserve local data/mcp.
      const { updateSettings } = require('./settings-service') as typeof import('./settings-service');
      updateSettings({
        identity: imported.identity,
        plans: imported.plans,
        firstRunComplete: imported.firstRunComplete,
      });
      settingsImported = true;
    }

    // Import recent projects
    const projectsPath = path.join(dir, 'recent-projects.json');
    if (fs.existsSync(projectsPath)) {
      const projects: RecentProjectEntry[] = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
      if (Array.isArray(projects)) {
        recentProjects.push(...projects);
      }
    }

    return { imported: true, settingsImported, recentProjects };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PersonalSync] Import failed:', msg);
    return { imported: false, error: msg, settingsImported: false, recentProjects: [] };
  }
}

/**
 * Get the current sync status for the Settings panel / MCP tools.
 */
export function getSyncStatus(): SyncStatus {
  const settings = getSettings();
  const syncPath = settings.data.personalSyncPath;
  const dir = getSyncDir();

  if (!syncPath || !dir) {
    return {
      configured: false,
      mode: settings.data.personalSyncMode,
      syncPath: '',
      syncDirExists: false,
      lastExportAt: null,
      lastImportAvailable: false,
      remoteMachine: null,
    };
  }

  const syncDirExists = fs.existsSync(dir);
  let lastExportAt: string | null = null;
  let remoteMachine: string | null = null;
  let lastImportAvailable = false;

  if (syncDirExists) {
    try {
      const metaPath = path.join(dir, '.sync-meta.json');
      if (fs.existsSync(metaPath)) {
        const meta: SyncMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        lastExportAt = meta.lastExportAt;
        // If the export came from a different machine, flag it.
        if (meta.machineId !== getMachineId()) {
          remoteMachine = meta.hostname;
          lastImportAvailable = true;
        }
      }
    } catch { /* ignore */ }
  }

  return {
    configured: true,
    mode: settings.data.personalSyncMode,
    syncPath,
    syncDirExists,
    lastExportAt,
    lastImportAvailable,
    remoteMachine,
  };
}

// --- internal ---

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}
