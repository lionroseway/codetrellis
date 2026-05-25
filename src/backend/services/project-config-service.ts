import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  EMPTY_PROJECT_CONFIG,
  CHANNEL_EVENT_TYPES,
  CHANNEL_EVENT_STATUSES,
  SENSOR_DEFAULTS,
  type ProjectConfig,
  type DefaultPlanVisibility,
  type AttachmentLocation,
  type ChannelRoutingRule,
  type ChannelEvent,
  type ChannelRouteWhen,
  type SensorConfig,
  type DriftSensorConfig,
  type DocSensorConfig,
  type StuckSensorConfig,
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
 *
 * `channels.routing` is replaced wholesale when present in the patch
 * — array merging is rarely what callers want for routing rules
 * (would silently double an entry on re-save). Callers wanting to
 * append should read, push, write.
 */
export function updateProjectConfig(projectRoot: string, patch: ProjectConfig): ProjectConfig {
  const key = normaliseProjectRoot(projectRoot);
  const current = getProjectConfig(key);

  const next: ProjectConfig = {
    plans: { ...(current.plans ?? {}), ...(patch.plans ?? {}) },
    channels: {
      ...(current.channels ?? {}),
      ...(patch.channels ?? {}),
      // Routing rules replaced wholesale when present.
      ...(patch.channels?.routing !== undefined ? { routing: patch.channels.routing } : {}),
    },
    // Phase 4.1 — sensors: deep-merge per-sensor group.
    sensors: mergeSensorConfig(current.sensors, patch.sensors),
    // Phase 3.6 — repoRole is a flat scalar; patch wins when present.
    repoRole: patch.repoRole !== undefined ? patch.repoRole : current.repoRole,
    updatedAt: new Date().toISOString(),
  };

  // Strip empty groups so an empty config file isn't `{plans: {}}` —
  // it should just be `{}` until an override is set.
  if (next.plans && Object.keys(next.plans).length === 0) {
    delete next.plans;
  }
  if (next.channels && Object.keys(next.channels).length === 0) {
    delete next.channels;
  }
  if (next.sensors && Object.keys(next.sensors).length === 0) {
    delete next.sensors;
  }
  // Tester finding #6: `mixed` is the default — no point persisting
  // it as an explicit no-op value in committed config. Treat
  // `undefined` and `mixed` identically and strip both from disk.
  if (next.repoRole === undefined || next.repoRole === 'mixed') {
    delete next.repoRole;
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

// --- Channel routing (Phase 2.2) -------------------------------------------

/**
 * Return the channel routing rules configured for a project. Returns
 * an empty array when nothing is configured. Disabled rules
 * (`enabled: false`) are filtered out — callers see only what's live.
 */
export function listChannelRoutingRules(projectRoot: string): ChannelRoutingRule[] {
  const cfg = getProjectConfig(projectRoot);
  const rules = cfg.channels?.routing ?? [];
  return rules.filter((r) => r.enabled !== false);
}

/**
 * Match a channel event against the project's routing rules. Returns
 * every rule whose `when` clause matches. Rules without `minAgeMs`
 * (immediate triggers) are returned alongside time-based rules — the
 * dispatcher decides which to fire now vs schedule.
 */
export function matchChannelRoutingRules(projectRoot: string, event: ChannelEvent): ChannelRoutingRule[] {
  const rules = listChannelRoutingRules(projectRoot);
  return rules.filter((r) => matches(r.when, event));
}

function matches(when: ChannelRouteWhen, event: ChannelEvent): boolean {
  if (when.eventType && when.eventType !== event.eventType) return false;
  if (when.status && when.status !== event.status) return false;
  if (when.planUid && when.planUid !== event.planUid) return false;
  if (when.itemUid && when.itemUid !== event.itemUid) return false;
  // minAgeMs is checked by the dispatcher (timer), not by post-time matching.
  return true;
}

// --- Sensor config helpers (Phase 4.1) ----------------------------------------

/**
 * Merge two SensorConfig objects. Patch wins for any scalar present
 * within a sub-group; absent sub-groups pass through from current.
 */
function mergeSensorConfig(
  current: SensorConfig | undefined,
  patch: SensorConfig | undefined,
): SensorConfig | undefined {
  if (!patch) return current;
  if (!current) return patch;
  const merged: SensorConfig = {};
  if (current.drift || patch.drift) {
    merged.drift = { ...(current.drift ?? {}), ...(patch.drift ?? {}) };
  }
  if (current.docs || patch.docs) {
    merged.docs = { ...(current.docs ?? {}), ...(patch.docs ?? {}) };
  }
  if (current.stuck || patch.stuck) {
    merged.stuck = { ...(current.stuck ?? {}), ...(patch.stuck ?? {}) };
  }
  // Strip empty sub-groups
  if (merged.drift && Object.keys(merged.drift).length === 0) delete merged.drift;
  if (merged.docs && Object.keys(merged.docs).length === 0) delete merged.docs;
  if (merged.stuck && Object.keys(merged.stuck).length === 0) delete merged.stuck;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Resolved drift sensor config with defaults applied. */
export type EffectiveDriftSensor = Required<DriftSensorConfig>;
/** Resolved docs sensor config with defaults applied. */
export type EffectiveDocSensor = Required<DocSensorConfig>;
/** Resolved stuck sensor config with defaults applied. */
export type EffectiveStuckSensor = Required<StuckSensorConfig>;

export interface EffectiveSensorConfig {
  drift: EffectiveDriftSensor;
  docs: EffectiveDocSensor;
  stuck: EffectiveStuckSensor;
}

/**
 * Return the fully-resolved sensor config for a project. Every field
 * is present — project overrides win, then SENSOR_DEFAULTS fill gaps.
 */
export function getEffectiveSensorConfig(projectRoot: string): EffectiveSensorConfig {
  const cfg = getProjectConfig(projectRoot).sensors;
  return {
    drift: {
      enabled: cfg?.drift?.enabled ?? SENSOR_DEFAULTS.drift.enabled,
      channelEvents: cfg?.drift?.channelEvents ?? SENSOR_DEFAULTS.drift.channelEvents,
      debounceMs: cfg?.drift?.debounceMs ?? SENSOR_DEFAULTS.drift.debounceMs,
    },
    docs: {
      enabled: cfg?.docs?.enabled ?? SENSOR_DEFAULTS.docs.enabled,
      channelEvents: cfg?.docs?.channelEvents ?? SENSOR_DEFAULTS.docs.channelEvents,
    },
    stuck: {
      enabled: cfg?.stuck?.enabled ?? SENSOR_DEFAULTS.stuck.enabled,
      repetitionThreshold: cfg?.stuck?.repetitionThreshold ?? SENSOR_DEFAULTS.stuck.repetitionThreshold,
      errorLoopThreshold: cfg?.stuck?.errorLoopThreshold ?? SENSOR_DEFAULTS.stuck.errorLoopThreshold,
      idleMinutes: cfg?.stuck?.idleMinutes ?? SENSOR_DEFAULTS.stuck.idleMinutes,
    },
  };
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

  const channelsRaw = r.channels;
  if (channelsRaw && typeof channelsRaw === 'object') {
    const c = channelsRaw as Record<string, unknown>;
    const channelsOut: NonNullable<ProjectConfig['channels']> = {};
    if (Array.isArray(c.routing)) {
      const rules: ChannelRoutingRule[] = [];
      for (const item of c.routing) {
        const rule = parseRoutingRule(item);
        if (rule) rules.push(rule);
      }
      if (rules.length > 0) channelsOut.routing = rules;
    }
    if (Object.keys(channelsOut).length > 0) result.channels = channelsOut;
  }

  // Phase 4.1 — sensor configuration.
  const sensorsRaw = r.sensors;
  if (sensorsRaw && typeof sensorsRaw === 'object') {
    const s = sensorsRaw as Record<string, unknown>;
    const sensors = parseSensorConfig(s);
    if (sensors && Object.keys(sensors).length > 0) result.sensors = sensors;
  }

  // Phase 3.6 — repo role hint. Defaults to absent ("mixed"); the
  // UI treats absence as "mixed" too.
  if (r.repoRole === 'planning' || r.repoRole === 'code' || r.repoRole === 'mixed') {
    result.repoRole = r.repoRole;
  }

  if (typeof r.updatedAt === 'string') {
    result.updatedAt = r.updatedAt;
  }

  return result;
}

function parseRoutingRule(raw: unknown): ChannelRoutingRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const whenRaw = r.when;
  const when: ChannelRouteWhen = {};
  if (whenRaw && typeof whenRaw === 'object') {
    const w = whenRaw as Record<string, unknown>;
    if (typeof w.eventType === 'string' && (CHANNEL_EVENT_TYPES as readonly string[]).includes(w.eventType)) {
      when.eventType = w.eventType as ChannelRouteWhen['eventType'];
    }
    if (typeof w.status === 'string' && (CHANNEL_EVENT_STATUSES as readonly string[]).includes(w.status)) {
      when.status = w.status as ChannelRouteWhen['status'];
    }
    if (typeof w.planUid === 'string') when.planUid = w.planUid;
    if (typeof w.itemUid === 'string') when.itemUid = w.itemUid;
    if (typeof w.minAgeMs === 'number' && Number.isFinite(w.minAgeMs)) when.minAgeMs = w.minAgeMs;
  }

  const notifyRaw = r.notify;
  if (!notifyRaw || typeof notifyRaw !== 'object') return null;
  const n = notifyRaw as Record<string, unknown>;
  if (n.target !== 'in-app-toast' && n.target !== 'webhook') return null;
  const notify =
    n.target === 'webhook'
      ? (() => {
          if (typeof n.url !== 'string' || !n.url) return null;
          const out: { target: 'webhook'; url: string; headers?: Record<string, string> } = {
            target: 'webhook',
            url: n.url,
          };
          if (n.headers && typeof n.headers === 'object') {
            const hs: Record<string, string> = {};
            for (const [k, v] of Object.entries(n.headers as Record<string, unknown>)) {
              if (typeof v === 'string') hs[k] = v;
            }
            if (Object.keys(hs).length > 0) out.headers = hs;
          }
          return out;
        })()
      : (() => {
          const out: { target: 'in-app-toast'; tone?: 'info' | 'warning' | 'error'; sticky?: boolean } = {
            target: 'in-app-toast',
          };
          if (n.tone === 'info' || n.tone === 'warning' || n.tone === 'error') out.tone = n.tone;
          if (typeof n.sticky === 'boolean') out.sticky = n.sticky;
          return out;
        })();

  if (!notify) return null;

  const rule: ChannelRoutingRule = { when, notify };
  if (typeof r.id === 'string') rule.id = r.id;
  if (typeof r.description === 'string') rule.description = r.description;
  if (typeof r.enabled === 'boolean') rule.enabled = r.enabled;
  return rule;
}

/**
 * Parse the `sensors` section of a project config. Validates types
 * strictly; invalid values are silently dropped (the default fills in).
 */
function parseSensorConfig(raw: Record<string, unknown>): SensorConfig | undefined {
  const result: SensorConfig = {};

  const driftRaw = raw.drift;
  if (driftRaw && typeof driftRaw === 'object') {
    const d = driftRaw as Record<string, unknown>;
    const drift: DriftSensorConfig = {};
    if (typeof d.enabled === 'boolean') drift.enabled = d.enabled;
    if (typeof d.channelEvents === 'boolean') drift.channelEvents = d.channelEvents;
    if (typeof d.debounceMs === 'number' && Number.isFinite(d.debounceMs) && d.debounceMs >= 0) {
      drift.debounceMs = d.debounceMs;
    }
    if (Object.keys(drift).length > 0) result.drift = drift;
  }

  const docsRaw = raw.docs;
  if (docsRaw && typeof docsRaw === 'object') {
    const d = docsRaw as Record<string, unknown>;
    const docs: DocSensorConfig = {};
    if (typeof d.enabled === 'boolean') docs.enabled = d.enabled;
    if (typeof d.channelEvents === 'boolean') docs.channelEvents = d.channelEvents;
    if (Object.keys(docs).length > 0) result.docs = docs;
  }

  const stuckRaw = raw.stuck;
  if (stuckRaw && typeof stuckRaw === 'object') {
    const s = stuckRaw as Record<string, unknown>;
    const stuck: StuckSensorConfig = {};
    if (typeof s.enabled === 'boolean') stuck.enabled = s.enabled;
    if (typeof s.repetitionThreshold === 'number' && Number.isFinite(s.repetitionThreshold) && s.repetitionThreshold > 0) {
      stuck.repetitionThreshold = s.repetitionThreshold;
    }
    if (typeof s.errorLoopThreshold === 'number' && Number.isFinite(s.errorLoopThreshold) && s.errorLoopThreshold > 0) {
      stuck.errorLoopThreshold = s.errorLoopThreshold;
    }
    if (typeof s.idleMinutes === 'number' && Number.isFinite(s.idleMinutes) && s.idleMinutes > 0) {
      stuck.idleMinutes = s.idleMinutes;
    }
    if (Object.keys(stuck).length > 0) result.stuck = stuck;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
