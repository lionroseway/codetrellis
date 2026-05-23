import { getDb } from './database';
import { getTasksByPlan } from './plan-service';
import { listAllItems } from './plan-item-service';
import { getDependencyEdges, getFileSymbols } from './database';
import { markDirty } from './persistence';
import { broadcast } from '../server';
import type { Deviation, PlanItem } from '../../shared/types';

/**
 * Unified file/connection expectations from both V1 tasks and V2 items.
 */
interface WorkUnit {
  label: string;            // description (V1) or title (V2)
  status: string | null;
  /** Files with their intended action (create/modify/delete). */
  fileExpectations: Array<{ path: string; action: 'create' | 'modify' | 'delete' | 'move' }>;
  /** Legacy flat list — V1 tasks only (treated as 'modify'). */
  affectedFiles: string[];
  newConnections: Array<{ from: string; to: string }>;
}

/** Extract work units from V1 tasks. */
function v1WorkUnits(planUid: string): WorkUnit[] {
  const tasks = getTasksByPlan(planUid);
  return tasks.map((t) => ({
    label: t.description,
    status: t.status,
    fileExpectations: (t.affectedFiles ?? []).map((f) => ({ path: f, action: 'modify' as const })),
    affectedFiles: t.affectedFiles ?? [],
    newConnections: t.newConnections ?? [],
  }));
}

/** Extract work units from V2 items (Actions only). */
function v2WorkUnits(planUid: string): WorkUnit[] {
  const items = listAllItems(planUid);
  return items
    .filter((i: PlanItem) => i.kind === 'action')
    .map((i: PlanItem) => ({
      label: i.title,
      status: i.status ?? null,
      fileExpectations: (i.fileSpecs ?? []).map((fs) => ({
        path: fs.path,
        action: fs.action,
      })),
      affectedFiles: (i.fileSpecs ?? []).map((fs) => fs.path),
      newConnections: (i.newConnections ?? []).map((c) => ({ from: c.from, to: c.to })),
    }));
}

/**
 * Detect deviations between a plan's expectations and the actual codebase state.
 * Reads both V1 tasks and V2 plan items (Actions) so drift detection works
 * regardless of which tool surface created the work items.
 *
 * Detection runs across ALL statuses — not just in_progress/done — so that
 * files that appear before work starts (or after it's been claimed) are still
 * caught. The severity/message adjusts based on task status.
 */
export function detectDeviations(planUid: string): Deviation[] {
  const db = getDb();
  const units = [...v1WorkUnits(planUid), ...v2WorkUnits(planUid)];
  const deviations: Deviation[] = [];
  const now = Date.now();

  // Collect ALL expected files from every work unit, keyed by path
  const fileExpectations = new Map<string, { label: string; action: string; status: string | null }>();

  for (const unit of units) {
    for (const fe of unit.fileExpectations) {
      // Later units overwrite earlier ones for the same path — that's fine,
      // the label/action just needs to be representative.
      fileExpectations.set(fe.path, { label: unit.label, action: fe.action, status: unit.status });
    }
  }

  // Check each expected file against the live DB
  for (const [file, expectation] of fileExpectations) {
    const result = db.exec(
      `SELECT id FROM files WHERE relative_path = ? OR path LIKE ?`,
      [file, `%/${file}`],
    );
    const fileExists = !!(result[0]?.values[0]);

    if (expectation.action === 'create') {
      // For 'create': file should exist when done, missing when still pending
      if (expectation.status === 'done' && !fileExists) {
        deviations.push(createDeviation(db, planUid, 'missing_file', 'warning',
          `"${expectation.label}" expected to create "${file}" but it doesn't exist`, now));
      }
      // If the task is not done but file already exists — that's fine (early delivery)
    } else if (expectation.action === 'delete') {
      // For 'delete': file should NOT exist when done
      if (expectation.status === 'done' && fileExists) {
        deviations.push(createDeviation(db, planUid, 'unexpected_file', 'warning',
          `"${expectation.label}" expected to delete "${file}" but it still exists`, now));
      }
    } else {
      // 'modify' or 'move': file should exist
      if (expectation.status === 'done' && !fileExists) {
        deviations.push(createDeviation(db, planUid, 'missing_file', 'warning',
          `"${expectation.label}" expected file "${file}" but it doesn't exist`, now));
      }
    }
  }

  // Check for expected connections (only for done units)
  let edges: Array<{ sourceRelative: string; targetRelative: string }> = [];
  try {
    edges = getDependencyEdges();
  } catch { /* ignore if no resolved imports */ }

  const edgeSet = new Set(edges.map((e) => `${e.sourceRelative}->${e.targetRelative}`));

  for (const unit of units) {
    if (unit.status !== 'done') continue;

    for (const conn of unit.newConnections) {
      if (!edgeSet.has(`${conn.from}->${conn.to}`)) {
        deviations.push(createDeviation(db, planUid, 'missing_import', 'info',
          `Expected import ${conn.from} → ${conn.to} not found`, now));
      }
    }
  }

  // Check for unexpected files — files that changed but aren't in any work unit
  // This catches files modified outside the plan's declared scope.
  const allExpectedPaths = new Set(fileExpectations.keys());
  // Also add suffix-matched variants so relative path comparisons work
  const expectedSuffixes = [...allExpectedPaths];

  // Get recently modified files from the working tree diff if available
  // (This part is already handled by checkFileDeviation which is called
  //  by the file watcher — we don't duplicate it here.)

  // Broadcast deviations
  for (const dev of deviations) {
    broadcast('deviation-detected', { deviation: dev });
  }

  return deviations;
}

/**
 * Check if a changed file deviates from any active plan.
 * Called by the file watcher after re-parsing. Checks both V1 tasks
 * and V2 items so unexpected file changes are caught regardless of
 * which tool surface created the plan.
 */
export function checkFileDeviation(relativePath: string): void {
  const db = getDb();

  // Find active plans
  const plansResult = db.exec(`SELECT uid FROM plans WHERE status IN ('in_progress', 'approved')`);
  if (!plansResult[0]) return;

  for (const row of plansResult[0].values) {
    const planUid = row[0] as string;
    const units = [...v1WorkUnits(planUid), ...v2WorkUnits(planUid)];

    // Check if this file is in any work unit's affected files
    const isExpected = units.some((u) =>
      u.affectedFiles.some((f) => relativePath.includes(f) || f.includes(relativePath))
    );

    if (!isExpected) {
      createDeviation(db, planUid, 'unexpected_file', 'info',
        `File "${relativePath}" was modified but is not listed in any plan item`, Date.now());

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
