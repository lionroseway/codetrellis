// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___plan_service from './plan-service';
import { getDb } from './database';
import { listAllItems, updateItem, createItem } from './plan-item-service';
import { getDependencyEdges } from './database';
import { markDirty } from './persistence';
import { broadcast } from '../server';
import { onDeviationDetected } from './sensor-bridge-service';
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
 * Get the set of file paths that already have a non-pending deviation
 * for a plan. Used by detectDeviations to avoid minting duplicates.
 */
function getResolvedDeviationPaths(db: any, planUid: string): Set<string> {
  const result = db.exec(
    `SELECT file_path FROM deviations
     WHERE plan_uid = ? AND file_path IS NOT NULL AND resolution != 'pending'`,
    [planUid],
  );
  const paths = new Set<string>();
  if (result[0]) {
    for (const row of result[0].values) {
      if (row[0]) paths.add(row[0] as string);
    }
  }
  return paths;
}

/**
 * Get the set of file paths that already have a *pending* deviation
 * for a plan. Used by detectDeviations to avoid duplicate pending rows.
 */
function getPendingDeviationPaths(db: any, planUid: string): Set<string> {
  const result = db.exec(
    `SELECT file_path FROM deviations
     WHERE plan_uid = ? AND file_path IS NOT NULL AND resolution = 'pending'`,
    [planUid],
  );
  const paths = new Set<string>();
  if (result[0]) {
    for (const row of result[0].values) {
      if (row[0]) paths.add(row[0] as string);
    }
  }
  return paths;
}

/**
 * Detect deviations between a plan's expectations and the actual codebase state.
 *
 * Detection runs across ALL statuses so files that appear before work starts
 * are still caught. Severity/message adjusts based on task status.
 *
 * Idempotent: skips files that already have a pending or resolved (accepted/ignored)
 * deviation. A previously-accepted file won't be re-flagged.
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

  // Load already-handled paths to avoid duplicates
  const resolvedPaths = getResolvedDeviationPaths(db, planUid);
  const pendingPaths = getPendingDeviationPaths(db, planUid);
  const alreadyHandled = new Set([...resolvedPaths, ...pendingPaths]);

  // ── Spec-vs-reality: check each expected file against the live DB ──
  for (const [file, exp] of fileExpectations) {
    if (alreadyHandled.has(file)) continue;

    const result = db.exec(
      `SELECT id FROM files WHERE relative_path = ? OR path LIKE ?`,
      [file, `%/${file}`],
    );
    const fileExists = !!(result[0]?.values[0]);

    if (exp.action === 'create') {
      if (exp.status === 'done' && !fileExists) {
        deviations.push(createDeviation(db, planUid, 'missing_file', 'warning',
          `"${exp.label}" expected to create "${file}" but it doesn't exist`, now, file));
        alreadyHandled.add(file);
      }
    } else if (exp.action === 'delete') {
      if (exp.status === 'done' && fileExists) {
        deviations.push(createDeviation(db, planUid, 'unexpected_file', 'warning',
          `"${exp.label}" expected to delete "${file}" but it still exists`, now, file));
        alreadyHandled.add(file);
      }
    } else {
      // 'modify' or 'move': file should exist when done
      if (exp.status === 'done' && !fileExists) {
        deviations.push(createDeviation(db, planUid, 'missing_file', 'warning',
          `"${exp.label}" expected file "${file}" but it doesn't exist`, now, file));
        alreadyHandled.add(file);
      }
    }
  }

  // ── Unexpected files: changed since baseline but not in any fileSpec ──
  if (changedFiles && changedFiles.length > 0) {
    const expectedPaths = [...fileExpectations.keys()];
    for (const file of changedFiles) {
      if (alreadyHandled.has(file)) continue;

      // Suffix matching for relative vs absolute path variants
      const isExpected = expectedPaths.some(
        (p) => file === p || file.endsWith('/' + p) || p.endsWith('/' + file),
      );
      // Also check if any resolved path matches (suffix-aware)
      const wasResolved = [...resolvedPaths].some(
        (p) => file === p || file.endsWith('/' + p) || p.endsWith('/' + file),
      );

      if (!isExpected && !wasResolved) {
        deviations.push(createDeviation(db, planUid, 'unexpected_file', 'info',
          `File "${file}" changed since baseline but is not in any plan item`, now, file));
        alreadyHandled.add(file);
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

    // Skip if already has a non-pending deviation for this path
    const resolvedPaths = getResolvedDeviationPaths(db, planUid);
    const pendingPaths = getPendingDeviationPaths(db, planUid);
    if (resolvedPaths.has(relativePath) || pendingPaths.has(relativePath)) continue;

    // Check if this file is in any Action's fileSpecs
    const isExpected = [...files.keys()].some(
      (f) => relativePath.includes(f) || f.includes(relativePath),
    );

    if (!isExpected) {
      createDeviation(db, planUid, 'unexpected_file', 'info',
        `File "${relativePath}" was modified but is not listed in any plan item`, Date.now(), relativePath);

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
  filePath?: string,
): Deviation {
  db.run(
    `INSERT INTO deviations (plan_uid, deviation_type, severity, description, resolution, detected_at, file_path)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [planUid, deviationType, severity, description, now, filePath ?? null]
  );

  const idResult = db.exec(`SELECT last_insert_rowid()`);
  const id = (idResult[0]?.values[0]?.[0] as number) || 0;
  markDirty();

  const deviation: Deviation = { id, planUid, deviationType, severity: severity as Deviation['severity'], description, resolution: 'pending', detectedAt: now, resolvedAt: null, filePath: filePath ?? null };

  // Phase 4.2 — bridge new deviations to the channel system.
  // Lazy-require getPlan to resolve project root; the bridge
  // handles config checks and debouncing.
  try {
    const { getPlan: getPlanLazy } = _lazy___plan_service;
    const plan = getPlanLazy(planUid);
    if (plan?.projectPath) {
      onDeviationDetected(deviation, plan.projectPath);
    }
  } catch { /* best-effort — sensor bridge must never crash deviation detection */ }

  return deviation;
}

export function getDeviations(planUid: string): Deviation[] {
  const result = getDb().exec(
    `SELECT id, plan_uid, deviation_type, severity, description, resolution, detected_at, resolved_at, file_path
     FROM deviations WHERE plan_uid = ? ORDER BY detected_at DESC`,
    [planUid]
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    id: r[0], planUid: r[1], deviationType: r[2], severity: r[3] as Deviation['severity'],
    description: r[4], resolution: r[5] as Deviation['resolution'],
    detectedAt: r[6], resolvedAt: r[7],
    filePath: (r[8] as string) ?? null,
  }));
}

/** Sentinel title for the auto-created reconciliation action. */
const RECONCILED_ITEM_TITLE = 'Reconciled changes';

/**
 * Resolve a deviation. When resolution is `accepted` and the deviation
 * has a file_path (unexpected_file), the file is added to the plan's
 * fileSpecs so it stops being flagged as drift.
 */
export function resolveDeviation(deviationId: number, resolution: 'accepted' | 'reverted' | 'ignored'): void {
  const db = getDb();
  const now = Date.now();

  db.run(
    `UPDATE deviations SET resolution = ?, resolved_at = ? WHERE id = ?`,
    [resolution, now, deviationId]
  );
  markDirty();

  // ── accepted + unexpected_file → amend the plan ──
  if (resolution === 'accepted') {
    const devResult = db.exec(
      `SELECT plan_uid, deviation_type, file_path FROM deviations WHERE id = ?`,
      [deviationId],
    );
    if (!devResult[0]?.values[0]) return;

    const [planUid, devType, filePath] = devResult[0].values[0] as [string, string, string | null];
    if (!filePath || (devType !== 'unexpected_file' && devType !== 'missing_file')) return;

    // Find or create a "Reconciled changes" action to house the accepted file
    const items = listAllItems(planUid).filter((i: PlanItem) => i.kind === 'action');
    const reconciledItem = items.find((i) => i.title === RECONCILED_ITEM_TITLE);

    if (reconciledItem) {
      // Append to its fileSpecs if not already present
      const existingSpecs = reconciledItem.fileSpecs ?? [];
      const already = existingSpecs.some((fs) => fs.path === filePath);
      if (!already) {
        updateItem(reconciledItem.uid, {
          fileSpecs: [...existingSpecs, { path: filePath, action: 'modify' }],
          author: 'codetrellis',
          authorType: 'system',
          changeSummary: `Accepted deviation: ${filePath}`,
        });
      }
    } else {
      // Create a new action item
      createItem({
        planUid,
        kind: 'action',
        title: RECONCILED_ITEM_TITLE,
        body: 'Files accepted from drift detection — originally not in the plan but confirmed as intentional.',
        fileSpecs: [{ path: filePath, action: 'modify' }],
        status: 'done',
        author: 'codetrellis',
        authorType: 'system',
      });
    }

    broadcast('plan-item-changed', { planUid });
  }
}
