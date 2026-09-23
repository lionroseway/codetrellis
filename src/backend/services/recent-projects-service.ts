import path from 'node:path';
import { getDb } from './database';
import { markDirty } from './persistence';
import { getNormalisedOriginUrl, normaliseRepoUrl } from './git-identity';

export interface RecentProject {
  path: string;
  /**
   * User-facing label. Defaults to the basename of `path` on first
   * open; can be overridden per-device via `setProjectAlias`. Never
   * travels in the manifest — different machines can show different
   * labels for the same repo.
   */
  displayName: string;
  branch: string | null;
  pinned: boolean;
  lastOpenedAt: number;
  firstOpenedAt: number;
  /**
   * CDev Phase 3.1 — normalised git origin URL. Stable across clones
   * of the same repo (regardless of local path), so it's the cross-
   * machine identifier for cross-repo plans and pointer resolution.
   * Null when the project isn't a git repository or has no origin.
   */
  originUrl: string | null;
}

export const MAX_RECENT_UNPINNED = 12;

export function recordProjectOpen(projectPath: string, branch?: string | null): void {
  const db = getDb();
  const now = Date.now();
  const defaultDisplayName = path.basename(projectPath) || projectPath;
  const originUrl = getNormalisedOriginUrl(projectPath);

  const existing = db.exec(
    `SELECT first_opened_at, pinned, display_name FROM recent_projects WHERE path = ?`,
    [projectPath],
  );
  const row = existing[0]?.values[0];

  if (row) {
    // Preserve the user-set alias on update; only the auto-default
    // gets overwritten when the user hasn't customised it. We
    // recognise "the user customised it" by it differing from the
    // basename of the path — anything else is theirs to keep.
    const currentDisplay = String(row[2] ?? '');
    const isCustom = currentDisplay && currentDisplay !== defaultDisplayName;
    const displayName = isCustom ? currentDisplay : defaultDisplayName;

    db.run(
      `UPDATE recent_projects
         SET display_name = ?, branch = ?, last_opened_at = ?, origin_url = ?
         WHERE path = ?`,
      [displayName, branch ?? null, now, originUrl ?? null, projectPath],
    );
  } else {
    db.run(
      `INSERT INTO recent_projects (path, display_name, branch, pinned, last_opened_at, first_opened_at, origin_url)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [projectPath, defaultDisplayName, branch ?? null, now, now, originUrl ?? null],
    );
    pruneUnpinned();
  }
  db.run(`DELETE FROM evicted_projects WHERE path = ?`, [projectPath]);

  markDirty();
}

export function listRecentProjects(): RecentProject[] {
  const result = getDb().exec(
    `SELECT path, display_name, branch, pinned, last_opened_at, first_opened_at, origin_url
     FROM recent_projects
     ORDER BY pinned DESC, last_opened_at DESC`,
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    path: r[0] as string,
    displayName: r[1] as string,
    branch: (r[2] as string | null) ?? null,
    pinned: Boolean(r[3]),
    lastOpenedAt: r[4] as number,
    firstOpenedAt: r[5] as number,
    originUrl: (r[6] as string | null) ?? null,
  }));
}

export function removeRecentProject(projectPath: string): void {
  getDb().run(`DELETE FROM recent_projects WHERE path = ?`, [projectPath]);
  markDirty();
}

export function setRecentProjectPinned(projectPath: string, pinned: boolean): void {
  getDb().run(
    `UPDATE recent_projects SET pinned = ? WHERE path = ?`,
    [pinned ? 1 : 0, projectPath],
  );
  markDirty();
}

/** Hard cap on alias length — anything past this overflows the TopBar
 *  tab and serves no UX purpose. Tester finding #5. */
const ALIAS_MAX_CHARS = 200;

/**
 * Per-device alias for the repo at `projectPath`. Local-only — never
 * travels in the manifest. Pass an empty string to reset the alias
 * back to the path's basename default. Trims whitespace; clamps to
 * `ALIAS_MAX_CHARS` to keep the TopBar tab readable.
 */
export function setProjectAlias(projectPath: string, alias: string): RecentProject | null {
  const trimmed = alias.trim();
  const fallback = path.basename(projectPath) || projectPath;
  const next = (trimmed || fallback).slice(0, ALIAS_MAX_CHARS);
  getDb().run(
    `UPDATE recent_projects SET display_name = ? WHERE path = ?`,
    [next, projectPath],
  );
  markDirty();
  return getRecentProject(projectPath);
}

/**
 * Refresh the cached origin URL for a project — called when the user
 * has just run `git remote set-url` and wants CodeTrellis to pick it
 * up without re-opening.
 */
export function refreshProjectOriginUrl(projectPath: string): RecentProject | null {
  const originUrl = getNormalisedOriginUrl(projectPath);
  getDb().run(
    `UPDATE recent_projects SET origin_url = ? WHERE path = ?`,
    [originUrl ?? null, projectPath],
  );
  markDirty();
  return getRecentProject(projectPath);
}

/**
 * Find the recent project (if any) whose origin URL matches the given
 * one. Used by cross-repo plan resolution to map a pointer file's
 * `homeRepo` URL to a locally-open project. Both sides are
 * re-normalised before comparison so callers don't have to.
 *
 * When the user has multiple clones of the same repo on disk (CDev
 * Phase 3 tester finding #4), prefer the most-recently-opened one —
 * that's the clone they're most likely to want when they click "Open"
 * in the stitched view. The earlier behaviour (arbitrary row order)
 * could resolve to a stale, rarely-used clone.
 */
export function findRecentProjectByOriginUrl(rawUrl: string): RecentProject | null {
  if (!rawUrl) return null;
  const target = normaliseRepoUrl(rawUrl);
  if (!target) return null;
  const result = getDb().exec(
    `SELECT path, display_name, branch, pinned, last_opened_at, first_opened_at, origin_url
     FROM recent_projects WHERE origin_url = ?
     ORDER BY last_opened_at DESC LIMIT 1`,
    [target],
  );
  if (!result[0] || result[0].values.length === 0) return null;
  const r = result[0].values[0] as any[];
  return {
    path: r[0] as string,
    displayName: r[1] as string,
    branch: (r[2] as string | null) ?? null,
    pinned: Boolean(r[3]),
    lastOpenedAt: r[4] as number,
    firstOpenedAt: r[5] as number,
    originUrl: (r[6] as string | null) ?? null,
  };
}

export function getRecentProject(projectPath: string): RecentProject | null {
  const result = getDb().exec(
    `SELECT path, display_name, branch, pinned, last_opened_at, first_opened_at, origin_url
     FROM recent_projects WHERE path = ?`,
    [projectPath],
  );
  if (!result[0] || result[0].values.length === 0) return null;
  const r = result[0].values[0] as any[];
  return {
    path: r[0] as string,
    displayName: r[1] as string,
    branch: (r[2] as string | null) ?? null,
    pinned: Boolean(r[3]),
    lastOpenedAt: r[4] as number,
    firstOpenedAt: r[5] as number,
    originUrl: (r[6] as string | null) ?? null,
  };
}

function pruneUnpinned(): void {
  const db = getDb();
  const result = db.exec(
    `SELECT path FROM recent_projects WHERE pinned = 0 ORDER BY last_opened_at DESC`,
  );
  if (!result[0]) return;
  const paths = result[0].values.map((r: any[]) => r[0] as string);
  const toRemove = paths.slice(MAX_RECENT_UNPINNED);
  const now = Date.now();
  for (const p of toRemove) {
    db.run(`DELETE FROM recent_projects WHERE path = ?`, [p]);
    db.run(
      `INSERT INTO evicted_projects (path, evicted_at) VALUES (?, ?)
       ON CONFLICT(path) DO UPDATE SET evicted_at = excluded.evicted_at`,
      [p, now],
    );
  }
}

/**
 * Projects the unpinned cap pushed off the recent list, newest first.
 *
 * Trust is the active project plus `recent_projects`, so eviction quietly
 * withdraws it: an agent that worked in a project yesterday is refused today
 * with "not open", although the person did open it. This list exists so the
 * refusal can say what actually happened. It must never be read as trust —
 * a project removed from the list has to be opened again, by the person.
 */
export function listEvictedProjects(): Array<{ path: string; evictedAt: number }> {
  const result = getDb().exec(
    `SELECT path, evicted_at FROM evicted_projects ORDER BY evicted_at DESC`,
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]) => ({ path: r[0] as string, evictedAt: r[1] as number }));
}
