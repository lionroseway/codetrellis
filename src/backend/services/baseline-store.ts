/**
 * The SQLite baseline store (Phase 32 §0.6, bug 9). One row per project:
 * the snapshot and where it came from, so a restart restores the baseline
 * rather than re-capturing whatever the tree holds at launch.
 */

import { getDb } from './database';
import type { Baseline, BaselineStore } from './diff-engine';

interface StoredBaseline {
  files: Array<[string, { hash: string; symbolCount: number }]>;
  edges: string[];
  timestamp: number;
  commitHash: string | null;
  shortCommitHash: string | null;
  source: Baseline['source'];
  dirty: boolean;
  capturedAt: number;
}

/** A baseline as JSON: its Map and Set as arrays. */
export function baselineToJson(b: Baseline): string {
  const stored: StoredBaseline = {
    files: [...b.files.entries()],
    edges: [...b.edges],
    timestamp: b.timestamp,
    commitHash: b.commitHash ?? null,
    shortCommitHash: b.shortCommitHash ?? null,
    source: b.source,
    dirty: b.dirty,
    capturedAt: b.capturedAt,
  };
  return JSON.stringify(stored);
}

/** Back from JSON, or null if the row is not one this version wrote. */
export function baselineFromJson(json: string, projectPath: string): Baseline | null {
  let s: Partial<StoredBaseline>;
  try { s = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(s.files) || !Array.isArray(s.edges) || typeof s.capturedAt !== 'number') return null;
  if (s.source !== 'scan' && s.source !== 'commit' && s.source !== 'working-tree') return null;
  return {
    files: new Map(s.files),
    edges: new Set(s.edges),
    timestamp: typeof s.timestamp === 'number' ? s.timestamp : s.capturedAt,
    commitHash: s.commitHash ?? null,
    shortCommitHash: s.shortCommitHash ?? null,
    source: s.source,
    dirty: s.dirty === true,
    capturedAt: s.capturedAt,
    projectPath,
  };
}

export const sqliteBaselineStore: BaselineStore = {
  save(b) {
    if (!b.projectPath) return;
    getDb().run(
      `INSERT INTO project_baselines (project_path, data_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(project_path) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
      [b.projectPath, baselineToJson(b), Date.now()],
    );
  },
  load(projectPath) {
    const res = getDb().exec('SELECT data_json FROM project_baselines WHERE project_path = ?', [projectPath]);
    const json = res[0]?.values[0]?.[0];
    return typeof json === 'string' ? baselineFromJson(json, projectPath) : null;
  },
  remove(projectPath) {
    getDb().run('DELETE FROM project_baselines WHERE project_path = ?', [projectPath]);
  },
};
