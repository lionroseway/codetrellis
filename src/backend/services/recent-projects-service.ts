import path from 'node:path';
import { getDb } from './database';
import { markDirty } from './persistence';

export interface RecentProject {
  path: string;
  displayName: string;
  branch: string | null;
  pinned: boolean;
  lastOpenedAt: number;
  firstOpenedAt: number;
}

const MAX_RECENT_UNPINNED = 12;

export function recordProjectOpen(projectPath: string, branch?: string | null): void {
  const db = getDb();
  const now = Date.now();
  const displayName = path.basename(projectPath) || projectPath;

  const existing = db.exec(`SELECT first_opened_at, pinned FROM recent_projects WHERE path = ?`, [projectPath]);
  const row = existing[0]?.values[0];

  if (row) {
    db.run(
      `UPDATE recent_projects SET display_name = ?, branch = ?, last_opened_at = ? WHERE path = ?`,
      [displayName, branch ?? null, now, projectPath]
    );
  } else {
    db.run(
      `INSERT INTO recent_projects (path, display_name, branch, pinned, last_opened_at, first_opened_at) VALUES (?, ?, ?, 0, ?, ?)`,
      [projectPath, displayName, branch ?? null, now, now]
    );
    pruneUnpinned();
  }

  markDirty();
}

export function listRecentProjects(): RecentProject[] {
  const result = getDb().exec(
    `SELECT path, display_name, branch, pinned, last_opened_at, first_opened_at
     FROM recent_projects
     ORDER BY pinned DESC, last_opened_at DESC`
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    path: r[0] as string,
    displayName: r[1] as string,
    branch: (r[2] as string | null) ?? null,
    pinned: Boolean(r[3]),
    lastOpenedAt: r[4] as number,
    firstOpenedAt: r[5] as number,
  }));
}

export function removeRecentProject(projectPath: string): void {
  getDb().run(`DELETE FROM recent_projects WHERE path = ?`, [projectPath]);
  markDirty();
}

export function setRecentProjectPinned(projectPath: string, pinned: boolean): void {
  getDb().run(
    `UPDATE recent_projects SET pinned = ? WHERE path = ?`,
    [pinned ? 1 : 0, projectPath]
  );
  markDirty();
}

function pruneUnpinned(): void {
  const db = getDb();
  const result = db.exec(
    `SELECT path FROM recent_projects WHERE pinned = 0 ORDER BY last_opened_at DESC`
  );
  if (!result[0]) return;
  const paths = result[0].values.map((r: any[]) => r[0] as string);
  const toRemove = paths.slice(MAX_RECENT_UNPINNED);
  for (const p of toRemove) {
    db.run(`DELETE FROM recent_projects WHERE path = ?`, [p]);
  }
}
