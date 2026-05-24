/**
 * External pointer service — Phase 3.3 of the CDev target architecture.
 *
 * A "pointer" is a thin YAML file checked into a repo telling readers
 * that a plan in *another* repo is in scope for this one. Pointers
 * live at:
 *
 *   <projectRoot>/.codetrellis/external/<plan-uid>.yaml
 *
 * They carry a light cached snapshot of the plan (title, status, short
 * summary, contribution note, homeRepo, timestamp) so a developer
 * cloning just this repo sees a coherent stub — even before they pull
 * the home repo. The cache is *advisory*: the canonical plan still
 * lives in the home repo. Stale snapshots are expected; the UI will
 * surface a "Refresh from home repo" affordance.
 *
 * The pointer files round-trip through git, but the canonical plan
 * (with full item tree, comments, attachments) does not — so this is
 * intentionally a low-bandwidth, low-fidelity signal. Think of it as
 * the cross-repo equivalent of a README pointing at another README.
 *
 * Pointers are never authored by an agent directly. They're created
 * as a side effect of `addPlanScope` (the home repo's plan gains a
 * scope entry, and we write the corresponding pointer into the scoped
 * repo when it's known and reachable from disk).
 */

import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { stampSelfWrite, wasJustWrittenByUs } from './self-write-tracker';

/**
 * On-disk pointer shape. Compact + forwards-compatible — extra fields
 * are ignored by readers from older versions.
 */
export interface ExternalPlanPointer {
  /** UID of the plan being pointed to. */
  planUid: string;
  /** Normalised origin URL of the repo that *owns* the plan. */
  homeRepo: string;
  /** Cached title (so cross-repo lists render without a fetch). */
  title: string;
  /** Plan status at last cache. May drift; refresh from home repo. */
  status: string;
  /** Short prose summary of what the plan does. Optional. */
  summary?: string;
  /**
   * Free-form note explaining *this* repo's contribution to the plan —
   * "ships the API surface", "owns the migration", "consumes the
   * event". Helps onboarding without forcing readers to open the home
   * repo first.
   */
  contribution?: string;
  /** Epoch ms — when the cached fields above were captured. */
  cachedAt: number;
}

export interface WritePointerInput {
  planUid: string;
  /** Absolute path of the scoped repo root (where the pointer lives). */
  projectRoot: string;
  homeRepo: string;
  title: string;
  status: string;
  summary?: string;
  contribution?: string;
}

/**
 * Write a pointer file under `<projectRoot>/.codetrellis/external/`.
 * Idempotent: re-writing the same pointer just bumps `cachedAt` and
 * refreshes the cached title/status/etc. Atomic via tmp+rename so a
 * concurrent reader never sees a half-written file.
 *
 * Returns the absolute path of the pointer file.
 */
export function writePointer(input: WritePointerInput): string {
  const dir = path.join(input.projectRoot, '.codetrellis', 'external');
  ensureDir(dir);

  const filePath = path.join(dir, `${input.planUid}.yaml`);
  const pointer: ExternalPlanPointer = {
    planUid: input.planUid,
    homeRepo: input.homeRepo,
    title: input.title,
    status: input.status,
    summary: input.summary,
    contribution: input.contribution,
    cachedAt: Date.now(),
  };

  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, stringifyYaml(pointer), 'utf-8');
  fs.renameSync(tmp, filePath);
  stampSelfWrite(filePath);
  return filePath;
}

/**
 * Remove a pointer file. No-op when the file doesn't exist. Returns
 * true iff a file was actually removed.
 */
export function removePointer(planUid: string, projectRoot: string): boolean {
  const filePath = path.join(projectRoot, '.codetrellis', 'external', `${planUid}.yaml`);
  if (!fs.existsSync(filePath)) return false;
  stampSelfWrite(filePath); // suppress the resulting unlink event
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a single pointer by plan UID. Returns null when the file is
 * missing, unparseable, or fails minimum-field validation.
 */
export function readPointer(planUid: string, projectRoot: string): ExternalPlanPointer | null {
  const filePath = path.join(projectRoot, '.codetrellis', 'external', `${planUid}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = parseYaml(fs.readFileSync(filePath, 'utf-8'));
    return validatePointer(raw);
  } catch {
    return null;
  }
}

/**
 * Discover every pointer in `<projectRoot>/.codetrellis/external/`.
 * Skips files that fail to parse or validate. Returns one entry per
 * pointer with the absolute file path attached for callers that want
 * to drive a refresh-or-prune UI.
 */
export function discoverPointers(projectRoot: string): Array<{ filePath: string; pointer: ExternalPlanPointer }> {
  const dir = path.join(projectRoot, '.codetrellis', 'external');
  if (!fs.existsSync(dir)) return [];

  const out: Array<{ filePath: string; pointer: ExternalPlanPointer }> = [];
  for (const fname of fs.readdirSync(dir)) {
    if (!fname.endsWith('.yaml') && !fname.endsWith('.yml')) continue;
    const filePath = path.join(dir, fname);
    try {
      const raw = parseYaml(fs.readFileSync(filePath, 'utf-8'));
      const pointer = validatePointer(raw);
      if (pointer) out.push({ filePath, pointer });
    } catch {
      // skip unreadable / malformed — surfaced separately by UI if needed
    }
  }
  return out;
}

/**
 * Check whether a file path is a pointer file (used by the file
 * watcher to dispatch to this service instead of the plan importer).
 *
 * Matches `<...>/.codetrellis/external/<anything>.yaml`.
 */
export function isPointerFile(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  return /\/\.codetrellis\/external\/[^/]+\.ya?ml$/.test(normalised);
}

/** Same self-write helper used by other file-emitting services. */
export function wasPointerJustWrittenByUs(filePath: string): boolean {
  return wasJustWrittenByUs(filePath);
}

// ---------- Watcher ----------
//
// One chokidar watcher per project, depth=0 because pointer files are
// flat under `.codetrellis/external/`. On any add/change/unlink the
// service broadcasts `external-pointers-changed` so the frontend can
// refresh its cross-repo view. We don't try to be clever about diff
// granularity — pointers are small, the frontend just calls
// `discoverPointers` again and re-renders.

const watchersByProject = new Map<string, FSWatcher>();

/** Normalise project paths the same way other services do, so a
 *  caller passing `/tmp/foo/` and `/tmp/foo` resolve to one watcher. */
function projectKey(projectRoot: string): string {
  return path.resolve(projectRoot).replace(/[/\\]+$/, '');
}

/**
 * Start watching `<projectRoot>/.codetrellis/external/` for pointer
 * file changes. Idempotent — calling twice for the same root is a no-op.
 *
 * The callback receives the project root (so the caller can route the
 * broadcast appropriately). When no callback is supplied, a default
 * `broadcast('external-pointers-changed', ...)` is fired via the
 * server module — kept behind a runtime require to avoid the import
 * cycle that bit channel-event-file-service.
 */
export function startPointerWatcher(
  projectRoot: string,
  onChange?: (projectRoot: string, event: 'add' | 'change' | 'unlink', filePath: string) => void,
): void {
  const key = projectKey(projectRoot);
  if (watchersByProject.has(key)) return;

  const dir = path.join(key, '.codetrellis', 'external');
  // Pre-create so chokidar binds to a real directory and ignoreInitial
  // is well-defined.
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn('[ExternalPointer] Could not pre-create dir:', err);
  }

  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    persistent: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('all', (event, filePath) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
    if (!filePath) return;
    if (!filePath.endsWith('.yaml') && !filePath.endsWith('.yml')) return;
    if (wasJustWrittenByUs(filePath)) return; // skip our own writes

    try {
      if (onChange) {
        onChange(key, event, filePath);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { broadcast } = require('../server');
        broadcast('external-pointers-changed', {
          projectRoot: key,
          event,
          filePath,
        });
      }
    } catch (err) {
      console.warn('[ExternalPointer] change handler failed:', err);
    }
  });

  watcher.on('error', (err) => {
    console.warn('[ExternalPointer] Watcher error:', err);
  });

  watchersByProject.set(key, watcher);
}

/** Stop the per-project pointer watcher. Safe to call when none exists. */
export async function stopPointerWatcher(projectRoot: string): Promise<void> {
  const key = projectKey(projectRoot);
  const watcher = watchersByProject.get(key);
  if (!watcher) return;
  watchersByProject.delete(key);
  try {
    await watcher.close();
  } catch {
    // best-effort
  }
}

// ---------- internals ----------

function validatePointer(raw: unknown): ExternalPlanPointer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.planUid !== 'string' || !r.planUid) return null;
  if (typeof r.homeRepo !== 'string' || !r.homeRepo) return null;
  if (typeof r.title !== 'string') return null;
  if (typeof r.status !== 'string') return null;
  const cachedAt = typeof r.cachedAt === 'number'
    ? r.cachedAt
    : typeof r.cachedAt === 'string'
      ? Date.parse(r.cachedAt)
      : NaN;
  if (!Number.isFinite(cachedAt)) return null;

  return {
    planUid: r.planUid,
    homeRepo: r.homeRepo,
    title: r.title,
    status: r.status,
    summary: typeof r.summary === 'string' ? r.summary : undefined,
    contribution: typeof r.contribution === 'string' ? r.contribution : undefined,
    cachedAt,
  };
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
