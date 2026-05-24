import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  EMPTY_PROJECT_CONFIG,
  type ProjectConfig,
  type DefaultPlanVisibility,
  type AttachmentLocation,
} from '../../shared/types';
import { getSettings } from './settings-service';

/**
 * Per-project config service — Phase 1.1 of the CDev target architecture.
 *
 * Reads `<projectRoot>/.codetrellis/config.json` per project, caches by
 * project root, and exposes helpers that resolve effective settings
 * with the precedence: **per-item > per-project > per-user**.
 *
 * The file is optional. Missing → effective settings == per-user.
 * Malformed → log a warning and treat as missing.
 *
 * Cache invalidation happens via `invalidateProjectConfigCache(projectRoot)`,
 * called from the file watcher when `.codetrellis/config.json` changes.
 */

const CONFIG_DIR = '.codetrellis';
const CONFIG_FILE = 'config.json';

const cache = new Map<string, ProjectConfig>();

function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);
}

function normaliseProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

/**
 * Read the per-project config for a project root. Returns the cached
 * value if available, otherwise loads from disk and caches.
 *
 * Returns `EMPTY_PROJECT_CONFIG` when the file is missing or invalid —
 * callers treat the absence of a key as "fall through to the per-user
 * setting".
 */
export function getProjectConfig(projectRoot: string): ProjectConfig {
  const key = normaliseProjectRoot(projectRoot);
  const cached = cache.get(key);
  if (cached) return cached;

  const filePath = configPath(key);
  if (!fs.existsSync(filePath)) {
    cache.set(key, EMPTY_PROJECT_CONFIG);
    return EMPTY_PROJECT_CONFIG;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const parsed = parseProjectConfig(raw);
    cache.set(key, parsed);
    return parsed;
  } catch (err) {
    console.warn(`[ProjectConfig] Failed to read ${filePath} — falling back to empty config:`, err);
    cache.set(key, EMPTY_PROJECT_CONFIG);
    return EMPTY_PROJECT_CONFIG;
  }
}

/**
 * Persist a partial update to the project config. Deep-merges with
 * the current value; absent keys are left untouched. Returns the
 * merged result.
 *
 * Writing the file always creates `.codetrellis/` if missing.
 */
export function updateProjectConfig(projectRoot: string, patch: ProjectConfig): ProjectConfig {
  const key = normaliseProjectRoot(projectRoot);
  const current = getProjectConfig(key);

  const next: ProjectConfig = {
    plans: { ...(current.plans ?? {}), ...(patch.plans ?? {}) },
    updatedAt: new Date().toISOString(),
  };

  // Strip empty groups so an empty config file isn't `{plans: {}}` —
  // it should just be `{}` until an override is set.
  if (next.plans && Object.keys(next.plans).length === 0) {
    delete next.plans;
  }

  saveProjectConfig(key, next);
  cache.set(key, next);
  return next;
}

/**
 * Invalidate the cached config for a project. Called from the file
 * watcher when the on-disk config changes (e.g., from `git pull`).
 *
 * If `projectRoot` is omitted, clears the entire cache — used by
 * tests that switch projects, or by the resetProjectConfigCache()
 * shutdown hook.
 */
export function invalidateProjectConfigCache(projectRoot?: string): void {
  if (projectRoot) {
    cache.delete(normaliseProjectRoot(projectRoot));
  } else {
    cache.clear();
  }
}

/** Test-only helper. Same behaviour as `invalidateProjectConfigCache()`. */
export function resetProjectConfigCache(): void {
  cache.clear();
}

// --- Effective-setting helpers (precedence: project > user) -----------------

/**
 * Resolve the effective default plan visibility for a project.
 * Project override wins; user setting is the fallback.
 */
export function getEffectiveDefaultVisibility(projectRoot: string): DefaultPlanVisibility {
  const projectOverride = getProjectConfig(projectRoot).plans?.defaultVisibility;
  return projectOverride ?? getSettings().plans.defaultVisibility;
}

/**
 * Resolve the effective attachment location for a project.
 * Project override wins; user setting is the fallback.
 */
export function getEffectiveAttachmentLocation(projectRoot: string): AttachmentLocation {
  const projectOverride = getProjectConfig(projectRoot).plans?.attachmentLocation;
  return projectOverride ?? getSettings().plans.attachmentLocation;
}

// --- File watcher -----------------------------------------------------------

const watchersByProject = new Map<string, FSWatcher>();

/**
 * Start watching `<projectRoot>/.codetrellis/config.json` for external
 * edits (git pull, manual edit). Invalidates the cache on change so the
 * next read picks up the new content. Idempotent per project.
 *
 * Called from the project-scan flow next to other per-project watchers.
 * The main file watcher ignores everything under `.codetrellis/`, so this
 * dedicated watcher is needed for config hot-reload.
 */
export function startProjectConfigWatcher(projectRoot: string): void {
  const key = normaliseProjectRoot(projectRoot);
  if (watchersByProject.has(key)) return;

  const filePath = configPath(key);

  // Watch the parent directory rather than the file itself — chokidar
  // handles "file doesn't exist yet, then appears" better when watching
  // the directory. Predicate-filter to only react to config.json.
  const dir = path.dirname(filePath);

  // Pre-create the .codetrellis/ dir so chokidar binds to something real.
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`[ProjectConfig] Could not pre-create ${dir}:`, err);
  }

  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    persistent: true,
    depth: 0, // only watch the .codetrellis/ root, not subdirectories
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('all', (event, changedPath) => {
    if (!changedPath) return;
    if (path.basename(changedPath) !== CONFIG_FILE) return;
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
    invalidateProjectConfigCache(key);
  });

  watcher.on('error', (err) => {
    console.warn(`[ProjectConfig] Watcher error for ${dir} (continuing):`, err);
  });

  watchersByProject.set(key, watcher);
}

/**
 * Stop the per-project config watcher. Called from project-close flows
 * and test teardown.
 */
export async function stopProjectConfigWatcher(projectRoot: string): Promise<void> {
  const key = normaliseProjectRoot(projectRoot);
  const watcher = watchersByProject.get(key);
  if (!watcher) return;
  watchersByProject.delete(key);
  await watcher.close();
}

// --- internals --------------------------------------------------------------

function saveProjectConfig(projectRoot: string, config: ProjectConfig): void {
  const filePath = configPath(projectRoot);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`[ProjectConfig] Failed to save ${filePath}:`, err);
  }
}

/**
 * Validate and shape arbitrary parsed JSON into a `ProjectConfig`.
 * Unknown keys are silently dropped; invalid values for known keys
 * fall through to "absent" (i.e., the per-user setting wins).
 */
function parseProjectConfig(raw: unknown): ProjectConfig {
  if (!raw || typeof raw !== 'object') return EMPTY_PROJECT_CONFIG;
  const r = raw as Record<string, unknown>;

  const result: ProjectConfig = {};

  const plansRaw = r.plans;
  if (plansRaw && typeof plansRaw === 'object') {
    const p = plansRaw as Record<string, unknown>;
    const plansOut: NonNullable<ProjectConfig['plans']> = {};
    if (p.defaultVisibility === 'shared' || p.defaultVisibility === 'local') {
      plansOut.defaultVisibility = p.defaultVisibility;
    }
    if (p.attachmentLocation === 'project' || p.attachmentLocation === 'user') {
      plansOut.attachmentLocation = p.attachmentLocation;
    }
    if (Object.keys(plansOut).length > 0) result.plans = plansOut;
  }

  if (typeof r.updatedAt === 'string') {
    result.updatedAt = r.updatedAt;
  }

  return result;
}
