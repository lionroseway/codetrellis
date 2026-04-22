import { getDb } from './database';
import { getTasksByPlan } from './plan-service';
import { getDependencyEdges, getFileSymbols } from './database';
import { markDirty } from './persistence';
import { broadcast } from '../server';
import type { Deviation } from '../../shared/types';

/**
 * Detect deviations between a plan's expectations and the actual codebase state.
 * Called after file changes to check if reality matches the plan.
 */
export function detectDeviations(planUid: string): Deviation[] {
  const db = getDb();
  const tasks = getTasksByPlan(planUid);
  const deviations: Deviation[] = [];
  const now = Date.now();

  // Collect all expected files from in-progress or done tasks
  const expectedFiles = new Set<string>();
  const taskFileMap = new Map<string, string>(); // file → task description

  for (const task of tasks) {
    if (task.status === 'in_progress' || task.status === 'done') {
      for (const file of task.affectedFiles) {
        expectedFiles.add(file);
        taskFileMap.set(file, task.description);
      }
    }
  }

  // Check for expected files that don't exist in the DB
  for (const [file, taskDesc] of taskFileMap) {
    const result = db.exec(`SELECT id FROM files WHERE relative_path = ? OR path LIKE ?`, [file, `%${file}`]);
    if (!result[0]?.values[0]) {
      // File expected but not found — might be a new file that hasn't been created yet
      const task = tasks.find((t) => t.affectedFiles.includes(file) && t.status === 'done');
      if (task) {
        deviations.push(createDeviation(db, planUid, 'missing_file', 'warning',
          `Task "${taskDesc}" expected file "${file}" but it doesn't exist`, now));
      }
    }
  }

  // Check for expected connections
  let edges: Array<{ sourceRelative: string; targetRelative: string }> = [];
  try {
    edges = getDependencyEdges();
  } catch { /* ignore if no resolved imports */ }

  const edgeSet = new Set(edges.map((e) => `${e.sourceRelative}->${e.targetRelative}`));

  for (const task of tasks) {
    if (task.status !== 'done') continue;

    for (const conn of task.newConnections) {
      if (!edgeSet.has(`${conn.from}->${conn.to}`)) {
        deviations.push(createDeviation(db, planUid, 'missing_import', 'info',
          `Expected import ${conn.from} → ${conn.to} not found`, now));
      }
    }
  }

  // Broadcast deviations
  for (const dev of deviations) {
    broadcast('deviation-detected', { deviation: dev });
  }

  return deviations;
}

/**
 * Check if a changed file deviates from any active plan.
 * Called by the file watcher after re-parsing.
 */
export function checkFileDeviation(relativePath: string): void {
  const db = getDb();

  // Find active plans
  const plansResult = db.exec(`SELECT uid FROM plans WHERE status IN ('in_progress', 'approved')`);
  if (!plansResult[0]) return;

  for (const row of plansResult[0].values) {
    const planUid = row[0] as string;
    const tasks = getTasksByPlan(planUid);

    // Check if this file is in any task's affected files
    const isExpected = tasks.some((t) =>
      t.affectedFiles.some((f) => relativePath.includes(f) || f.includes(relativePath))
    );

    if (!isExpected) {
      // File changed but not in any task — unexpected modification
      createDeviation(db, planUid, 'unexpected_file', 'info',
        `File "${relativePath}" was modified but is not listed in any task`, Date.now());

      broadcast('deviation-detected', {
        deviation: {
          planUid,
          deviationType: 'unexpected_file',
          severity: 'info',
          description: `File "${relativePath}" modified outside of plan`,
        },
      });
    }
  }
}

function createDeviation(
  db: any,
  planUid: string,
  deviationType: string,
  severity: string,
  description: string,
  now: number,
): Deviation {
  db.run(
    `INSERT INTO deviations (plan_uid, deviation_type, severity, description, resolution, detected_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [planUid, deviationType, severity, description, now]
  );

  const idResult = db.exec(`SELECT last_insert_rowid()`);
  const id = (idResult[0]?.values[0]?.[0] as number) || 0;
  markDirty();

  return { id, planUid, deviationType, severity: severity as Deviation['severity'], description, resolution: 'pending', detectedAt: now, resolvedAt: null };
}

export function getDeviations(planUid: string): Deviation[] {
  const result = getDb().exec(
    `SELECT id, plan_uid, deviation_type, severity, description, resolution, detected_at, resolved_at
     FROM deviations WHERE plan_uid = ? ORDER BY detected_at DESC`,
    [planUid]
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    id: r[0], planUid: r[1], deviationType: r[2], severity: r[3] as Deviation['severity'],
    description: r[4], resolution: r[5] as Deviation['resolution'],
    detectedAt: r[6], resolvedAt: r[7],
  }));
}

export function resolveDeviation(deviationId: number, resolution: 'accepted' | 'reverted' | 'ignored'): void {
  getDb().run(
    `UPDATE deviations SET resolution = ?, resolved_at = ? WHERE id = ?`,
    [resolution, Date.now(), deviationId]
  );
  markDirty();
}
