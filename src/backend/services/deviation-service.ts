import { getDb } from './database';
import { listAllItems } from './plan-item-service';
import { getDependencyEdges } from './database';
import { markDirty } from './persistence';
import { broadcast } from '../server';
import type { Deviation, PlanItem } from '../../shared/types';

/**
 * Expected file with its CRUD verb, source item label, and status.
 */
interface FileExpectation {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'move';
  label: string;
  status: string | null;
}

/**
 * Collect all file expectations from a plan's Actions.
 */
function collectExpectations(planUid: string): { files: Map<string, FileExpectation>; items: PlanItem[] } {
  const items = listAllItems(planUid).filter((i: PlanItem) => i.kind === 'action');
  const files = new Map<string, FileExpectation>();

  for (const item of items) {
    for (const fs of item.fileSpecs ?? []) {
      files.set(fs.path, {
        path: fs.path,
        action: fs.action,
        label: item.title,
        status: item.status ?? null,
      });
    }
  }

  return { files, items };
}

/**
 * Detect deviations between a plan's expectations and the actual codebase state.
 *
 * Detection runs across ALL statuses so files that appear before work starts
 * are still caught. Severity/message adjusts based on task status.
 *
 * @param changedFiles — optional list of files that changed since the baseline
 *   snapshot. When provided, any changed file NOT in the plan's fileSpecs is
 *   recorded as an `unexpected_file` deviation. Without this, only spec-vs-
 *   reality checks run (missing/wrong-state files).
 */
export function detectDeviations(planUid: string, changedFiles?: string[]): Deviation[] {
  const db = getDb();
  const { files: fileExpectations, items } = collectExpectations(planUid);
  const deviations: Deviation[] = [];
  const now = Date.now();

  // ── Spec-vs-reality: check each expected file against the live DB ──
  for (const [file, exp] of fileExpectations) {
    const result = db.exec(
      `SELECT id FROM files WHERE relative_path = ? OR path LIKE ?`,
      [file, `%/${file}`],
    );
    const fileExists = !!(result[0]?.values[0]);

    if (exp.action === 'create') {
      if (exp.status === 'done' && !fileExists) {
        deviations.push(createDeviation(db, planUid, 'missing_file', 'warning',
          `"${exp.label}" expected to create "${file}" but it doesn't exist`, now));
      }
    } else if (exp.action === 'delete') {
      if (exp.status === 'done' && fileExists) {
        deviations.push(createDeviation(db, planUid, 'unexpected_file', 'warning',
          `"${exp.label}" expected to delete "${file}" but it still exists`, now));
      }
    } else {
      // 'modify' or 'move': file should exist when done
      if (exp.status === 'done' && !fileExists) {
        deviations.push(createDeviation(db, planUid, 'missing_file', 'warning',
          `"${exp.label}" expected file "${file}" but it doesn't exist`, now));
      }
    }
  }

  // ── Unexpected files: changed since baseline but not in any fileSpec ──
  if (changedFiles && changedFiles.length > 0) {
    const expectedPaths = [...fileExpectations.keys()];
    for (const file of changedFiles) {
      const isExpected = expectedPaths.some(
        (p) => file === p || file.endsWith('/' + p) || p.endsWith('/' + file),
      );
      if (!isExpected) {
        deviations.push(createDeviation(db, planUid, 'unexpected_file', 'info',
          `File "${file}" changed since baseline but is not in any plan item`, now));
      }
    }
  }

  // ── Expected connections (only for done items) ──
  let edges: Array<{ sourceRelative: string; targetRelative: string }> = [];
  try {
    edges = getDependencyEdges();
  } catch { /* ignore if no resolved imports */ }

  const edgeSet = new Set(edges.map((e) => `${e.sourceRelative}->${e.targetRelative}`));

  for (const item of items) {
    if (item.status !== 'done') continue;
    for (const conn of item.newConnections ?? []) {
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
    const { files } = collectExpectations(planUid);

    // Check if this file is in any Action's fileSpecs
    const isExpected = [...files.keys()].some(
      (f) => relativePath.includes(f) || f.includes(relativePath),
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
