/**
 * Plan migration service — Phase 15 §15.B.
 *
 * Walks the legacy DB tables (`plan_documents`, `plan_phases`,
 * `tasks`) and inserts the equivalent rows into `plan_items` (Phase
 * 15.A foundation), preserving uids so existing `attachments` and
 * `comments` rows still resolve cleanly.
 *
 * Three guarantees:
 *
 *  1. **Uid preservation.** Every legacy row's uid becomes its
 *     `plan_items.uid`. No orphan attachments / comments.
 *
 *  2. **Idempotency.** The `plan_items.migrated_from` column carries
 *     a `<table>:<uid>` key per migrated row, with a UNIQUE index.
 *     A pre-pass queries the existing keys for this plan and skips
 *     already-migrated rows. Re-running the migrator is a no-op
 *     (with `skipped` counts surfaced in the result).
 *
 *  3. **Backfilled timeline.** For every newly-inserted item we emit
 *     a synthetic `plan_events: item_created` row whose `created_at`
 *     matches the legacy row's original timestamp. The plan timeline
 *     scrubber (S7) renders sensibly post-migration without needing
 *     a "history starts from migration day" caveat.
 *
 * The service is **dry-run by default** — pass `{ dryRun: false }`
 * to actually write. CLI wrapper (15.E) gates this behind
 * `--write` and `CODETRELLIS_RUN_MIGRATION=1`.
 *
 * See `docs/PLAN-WORKSPACE-DESIGN.md` (v0.5) §Migration for the full
 * data-preservation table and rollout plan.
 */

import { getDb } from './database';
import { markDirty } from './persistence';
import { createItem, getItem } from './plan-item-service';
import type { FileSpec, PlanItemEdge, SymbolSpec, TaskStatus } from '../../shared/types';

// =============================================================================
// Public API
// =============================================================================

export interface MigrationCounts {
  /** Number of plans walked (dry-run + write). */
  plansWalked: number;
  /** plan_documents → Objects. */
  objectsCreated: number;
  /** plan_phases → Actions (template='phase'). */
  phaseActionsCreated: number;
  /** tasks → Actions. */
  taskActionsCreated: number;
  /** Subtasks whose parent_uid was fixed in pass 2. */
  subtaskReparented: number;
  /** Doc nesting fixed in pass 2. */
  docReparented: number;
  /** attachments rows whose target_type flipped from 'task'/'plan_doc' to 'item'. */
  attachmentsRetargeted: number;
  /** comments rows whose target_type flipped from 'task' to 'item'. */
  commentsRetargeted: number;
  /** Synthetic plan_events: item_created rows backfilled with original timestamps. */
  syntheticEvents: number;
  /** Rows skipped because they were already migrated (idempotency). */
  skipped: number;
}

export interface MigratePlanOptions {
  /**
   * When `true` (default), no DB writes happen — just count what
   * WOULD change. Pass `{ dryRun: false }` to actually migrate.
   */
  dryRun?: boolean;
  /** Author attribution for synthetic events. Default: 'system'. */
  author?: string;
  authorType?: string;
}

const DEFAULT_OPTS: Required<MigratePlanOptions> = {
  dryRun: true,
  author: 'system',
  authorType: 'system',
};

/**
 * Migrate every plan in the database. Returns aggregate counts. See
 * `migratePlan` for per-plan semantics.
 */
export function migrateAllPlans(options: MigratePlanOptions = {}): MigrationCounts {
  const opts = { ...DEFAULT_OPTS, ...options };
  const db = getDb();
  const r = db.exec(`SELECT uid FROM plans`);
  const planUids = (r[0]?.values ?? []).map((row: any[]) => row[0] as string);

  const totals = emptyCounts();
  for (const uid of planUids) {
    const c = migratePlan(uid, opts);
    addCounts(totals, c);
  }
  return totals;
}

/**
 * Migrate a single plan. Idempotent: re-running on an already-
 * migrated plan no-ops (with skipped counts). Always reads from
 * legacy tables (`plan_documents`, `plan_phases`, `tasks`) so a
 * partially-migrated plan can be completed safely.
 *
 * Order of operations matters and is deliberate:
 *   1. Read already-migrated keys (`migrated_from` lookup).
 *   2. Insert plan_documents → Objects (provisional parent_uid=null).
 *   3. Insert plan_phases → Actions (parent_uid=null).
 *   4. Insert tasks → Actions (parent_uid = phase_uid if set, else null).
 *   5. Pass 2: fix doc nesting (parent_doc_uid → parent_uid).
 *   6. Pass 2: fix subtask nesting (parent_task_uid → parent_uid).
 *   7. Retarget attachments (target_type 'task'/'plan_doc' → 'item').
 *   8. Retarget comments (target_type 'task' → 'item').
 *
 * The pass-2 fix-ups happen via direct UPDATE rather than
 * `moveItem` so they don't generate spurious "reparented" plan_events
 * — these aren't user moves, they're migration bookkeeping.
 */
export function migratePlan(planUid: string, options: MigratePlanOptions = {}): MigrationCounts {
  const opts = { ...DEFAULT_OPTS, ...options };
  const counts = emptyCounts();
  counts.plansWalked = 1;

  const alreadyMigrated = readAlreadyMigratedKeys(planUid);

  // 1. plan_documents → Objects
  const docs = readPlanDocuments(planUid);
  for (const doc of docs) {
    const key = `plan_documents:${doc.uid}`;
    if (alreadyMigrated.has(key)) {
      counts.skipped++;
      continue;
    }
    counts.objectsCreated++;
    if (opts.dryRun) continue;
    createItem({
      planUid,
      uid: doc.uid,
      kind: 'object',
      title: doc.title,
      body: doc.body,
      template: doc.docType,
      parentUid: null, // pass 2 will fix nesting via parent_doc_uid
      sortOrder: parseOrderHint(doc.orderHint),
      author: doc.author,
      authorType: doc.authorType,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      migratedFrom: key,
    });
    counts.syntheticEvents++; // createItem emits item_created
  }

  // 2. plan_phases → Actions (template='phase')
  const phases = readPlanPhases(planUid);
  for (const phase of phases) {
    const key = `plan_phases:${phase.uid}`;
    if (alreadyMigrated.has(key)) {
      counts.skipped++;
      continue;
    }
    counts.phaseActionsCreated++;
    if (opts.dryRun) continue;
    createItem({
      planUid,
      uid: phase.uid,
      kind: 'action',
      title: phase.title,
      body: composePhaseBody(phase),
      template: 'phase',
      parentUid: null,
      // Phases sort after Objects. Objects fall in [0, 9999] roughly;
      // phases get a 10000 offset, then phase_number * 100 to leave
      // room for manual reordering.
      sortOrder: 10000 + phase.phaseNumber * 100,
      status: phase.status,
      author: 'system',
      authorType: 'system',
      createdAt: phase.createdAt,
      updatedAt: phase.updatedAt,
      migratedFrom: key,
    });
    counts.syntheticEvents++;
  }

  // 3. tasks → Actions
  const tasks = readTasks(planUid);
  for (const task of tasks) {
    const key = `tasks:${task.uid}`;
    if (alreadyMigrated.has(key)) {
      counts.skipped++;
      continue;
    }
    counts.taskActionsCreated++;
    if (opts.dryRun) continue;
    // Provisional parent: bind to phase if phaseUid set; else null.
    // `parent_task_uid` (subtasks) gets fixed in pass 2.
    const provisionalParent = task.phaseUid;
    createItem({
      planUid,
      uid: task.uid,
      kind: 'action',
      title: task.description.split('\n')[0].slice(0, 200) || 'Untitled',
      body: task.body ?? '',
      template: 'leaf',
      parentUid: provisionalParent,
      // Tasks within a phase keep their original sort_order. Unphased
      // tasks land after the phases band.
      sortOrder: provisionalParent ? task.sortOrder : 20000 + task.sortOrder * 10,
      status: task.status,
      assignee: task.assignee,
      assigneeType: task.assigneeType,
      assigneeModel: task.assigneeModel,
      progressPercent: task.progressPercent,
      blockedReason: task.blockedReason,
      scopePath: task.scopePath,
      fileSpecs: task.fileSpecs,
      symbolSpecs: task.symbolSpecs,
      newConnections: task.newConnections,
      removedConnections: task.removedConnections,
      dependencies: task.dependencies,
      author: task.assignee ?? 'system',
      authorType: task.assigneeType ?? 'system',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      migratedFrom: key,
    });
    counts.syntheticEvents++;
  }

  if (opts.dryRun) return counts; // pass 2+ would mutate

  // 4. Pass 2 — fix doc nesting (parent_doc_uid → parent_uid).
  // Run as a direct UPDATE so we don't emit phantom plan_events.
  const db = getDb();
  for (const doc of docs) {
    if (!doc.parentDocUid) continue;
    // Only fix up if the parent was actually migrated (could be
    // missing if the legacy DB was inconsistent).
    if (!getItem(doc.parentDocUid)) continue;
    db.run(
      `UPDATE plan_items SET parent_uid = ? WHERE uid = ? AND parent_uid IS NULL`,
      [doc.parentDocUid, doc.uid],
    );
    counts.docReparented++;
  }

  // 5. Pass 2 — fix subtask nesting (parent_task_uid → parent_uid).
  // Done after task inserts so the parent task is guaranteed present.
  for (const task of tasks) {
    if (!task.parentTaskUid) continue;
    if (!getItem(task.parentTaskUid)) continue;
    // Only override if the current parent_uid is null (no phase
    // binding). Subtasks bound to a phase are an unusual case — we
    // honour the explicit parent_task_uid here, since that's the
    // stronger relationship.
    db.run(
      `UPDATE plan_items SET parent_uid = ? WHERE uid = ?`,
      [task.parentTaskUid, task.uid],
    );
    counts.subtaskReparented++;
  }

  // 6. Retarget attachments. Old: `target_type IN ('task', 'plan_doc')`.
  // New: 'item'. uid stays the same so the attachments still point at
  // the right row (now in plan_items).
  const migratedItemUids = collectMigratedUids(planUid);
  if (migratedItemUids.size > 0) {
    counts.attachmentsRetargeted = retargetRows(
      'attachments',
      ['task', 'plan_doc'],
      'item',
      migratedItemUids,
    );
    counts.commentsRetargeted = retargetRows(
      'comments',
      ['task'],
      'item',
      migratedItemUids,
    );
  }

  markDirty();
  return counts;
}

// =============================================================================
// Reads from legacy tables
// =============================================================================

interface LegacyPlanDocument {
  uid: string;
  docType: string;
  title: string;
  body: string;
  orderHint: string | null;
  parentDocUid: string | null;
  author: string;
  authorType: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyPlanPhase {
  uid: string;
  phaseNumber: number;
  title: string;
  scope: string;
  prerequisites: string;
  gitCheckpoint: string | null;
  acceptanceCriteria: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

interface LegacyTask {
  uid: string;
  sortOrder: number;
  description: string;
  status: TaskStatus;
  assignee: string | null;
  assigneeType: string | null;
  assigneeModel: string | null;
  affectedFiles: string[];
  affectedSymbols: string[];
  newConnections: PlanItemEdge[];
  removedConnections: PlanItemEdge[];
  dependencies: string[];
  fileSpec: string | null;
  symbolSpecs: SymbolSpec[];
  phaseUid: string | null;
  parentTaskUid: string | null;
  body: string | null;
  prompt: string | null;
  scopePath: string | null;
  fileSpecs: FileSpec[];
  progressPercent: number | null;
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
}

function readPlanDocuments(planUid: string): LegacyPlanDocument[] {
  const db = getDb();
  // Defensive — the legacy table may not exist on a fresh-after-V2 DB.
  let r;
  try {
    r = db.exec(
      `SELECT uid, doc_type, title, body, order_hint, parent_doc_uid,
              author, author_type, created_at, updated_at
       FROM plan_documents WHERE plan_uid = ?
       ORDER BY order_hint ASC NULLS LAST, created_at ASC`,
      [planUid],
    );
  } catch {
    return [];
  }
  if (!r[0]) return [];
  return r[0].values.map((row: any[]): LegacyPlanDocument => ({
    uid: row[0] as string,
    docType: (row[1] as string) ?? 'custom',
    title: (row[2] as string) ?? '',
    body: (row[3] as string) ?? '',
    orderHint: (row[4] as string | null) ?? null,
    parentDocUid: (row[5] as string | null) ?? null,
    author: (row[6] as string) ?? 'human',
    authorType: (row[7] as string) ?? 'human',
    createdAt: (row[8] as number) ?? Date.now(),
    updatedAt: (row[9] as number) ?? Date.now(),
  }));
}

function readPlanPhases(planUid: string): LegacyPlanPhase[] {
  const db = getDb();
  let r;
  try {
    r = db.exec(
      `SELECT uid, phase_number, title, scope, prerequisites,
              git_checkpoint, acceptance_criteria, status, created_at, updated_at
       FROM plan_phases WHERE plan_uid = ? ORDER BY phase_number ASC`,
      [planUid],
    );
  } catch {
    return [];
  }
  if (!r[0]) return [];
  return r[0].values.map((row: any[]): LegacyPlanPhase => ({
    uid: row[0] as string,
    phaseNumber: (row[1] as number) ?? 0,
    title: (row[2] as string) ?? '',
    scope: (row[3] as string) ?? '',
    prerequisites: (row[4] as string) ?? '',
    gitCheckpoint: (row[5] as string | null) ?? null,
    acceptanceCriteria: (row[6] as string) ?? '',
    status: ((row[7] as string) ?? 'pending') as TaskStatus,
    createdAt: (row[8] as number) ?? Date.now(),
    updatedAt: (row[9] as number) ?? Date.now(),
  }));
}

function readTasks(planUid: string): LegacyTask[] {
  const db = getDb();
  let r;
  try {
    r = db.exec(
      `SELECT uid, sort_order, description, status, assignee, assignee_type, assignee_model,
              affected_files, affected_symbols, new_connections, removed_connections, dependencies,
              file_spec, symbol_specs, phase_uid,
              parent_task_uid, body, prompt, scope_path, file_specs,
              progress_percent, blocked_reason,
              created_at, updated_at
       FROM tasks WHERE plan_uid = ? ORDER BY sort_order ASC`,
      [planUid],
    );
  } catch {
    return [];
  }
  if (!r[0]) return [];
  return r[0].values.map((row: any[]): LegacyTask => ({
    uid: row[0] as string,
    sortOrder: (row[1] as number) ?? 0,
    description: (row[2] as string) ?? '',
    status: ((row[3] as string) ?? 'pending') as TaskStatus,
    assignee: (row[4] as string | null) ?? null,
    assigneeType: (row[5] as string | null) ?? null,
    assigneeModel: (row[6] as string | null) ?? null,
    affectedFiles: parseJsonArr(row[7]),
    affectedSymbols: parseJsonArr(row[8]),
    newConnections: parseJsonArr(row[9]),
    removedConnections: parseJsonArr(row[10]),
    dependencies: parseJsonArr(row[11]),
    fileSpec: (row[12] as string | null) ?? null,
    symbolSpecs: parseJsonArr(row[13]),
    phaseUid: (row[14] as string | null) ?? null,
    parentTaskUid: (row[15] as string | null) ?? null,
    body: (row[16] as string | null) ?? null,
    prompt: (row[17] as string | null) ?? null,
    scopePath: (row[18] as string | null) ?? null,
    fileSpecs: parseJsonArr(row[19]),
    progressPercent: (row[20] as number | null) ?? null,
    blockedReason: (row[21] as string | null) ?? null,
    createdAt: (row[22] as number) ?? Date.now(),
    updatedAt: (row[23] as number) ?? Date.now(),
  }));
}

function parseJsonArr<T>(s: unknown): T[] {
  if (typeof s !== 'string') return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// =============================================================================
// Helpers
// =============================================================================

function readAlreadyMigratedKeys(planUid: string): Set<string> {
  const db = getDb();
  const r = db.exec(
    `SELECT migrated_from FROM plan_items
     WHERE plan_uid = ? AND migrated_from IS NOT NULL`,
    [planUid],
  );
  const out = new Set<string>();
  if (!r[0]) return out;
  for (const row of r[0].values) {
    const v = row[0] as string | null;
    if (v) out.add(v);
  }
  return out;
}

/**
 * Parse a legacy `order_hint` ("00", "01", "01.5", "02", …) into an
 * integer step. Multiplies by 10 so "01.5" lands between "01" and
 * "02". Falls back to a high sentinel for unparseable / missing
 * hints so they sort after well-ordered ones.
 */
function parseOrderHint(hint: string | null): number {
  if (!hint) return 9999;
  const n = Number(hint);
  if (!Number.isFinite(n)) return 9999;
  return Math.round(n * 10);
}

function composePhaseBody(phase: LegacyPlanPhase): string {
  const sections: string[] = [];
  if (phase.scope.trim()) sections.push(`## Scope\n\n${phase.scope.trim()}`);
  if (phase.prerequisites.trim()) sections.push(`## Prerequisites\n\n${phase.prerequisites.trim()}`);
  if (phase.acceptanceCriteria.trim()) sections.push(`## Acceptance criteria\n\n${phase.acceptanceCriteria.trim()}`);
  if (phase.gitCheckpoint && phase.gitCheckpoint.trim()) {
    sections.push(`## Git checkpoint\n\n\`${phase.gitCheckpoint.trim()}\``);
  }
  return sections.join('\n\n');
}

/** All `plan_items.uid` belonging to this plan (post-migration). */
function collectMigratedUids(planUid: string): Set<string> {
  const db = getDb();
  const r = db.exec(
    `SELECT uid FROM plan_items WHERE plan_uid = ? AND migrated_from IS NOT NULL`,
    [planUid],
  );
  const out = new Set<string>();
  if (!r[0]) return out;
  for (const row of r[0].values) out.add(row[0] as string);
  return out;
}

/**
 * Flip rows in `attachments` / `comments` from legacy `target_type`
 * values to 'item'. Returns the number of rows updated. We do this
 * one uid at a time (small Ns expected) rather than building a
 * single IN-clause to keep the query simple and observable.
 */
function retargetRows(
  table: 'attachments' | 'comments',
  fromTypes: string[],
  toType: 'item',
  itemUids: Set<string>,
): number {
  const db = getDb();
  let updated = 0;
  for (const uid of itemUids) {
    const placeholders = fromTypes.map(() => '?').join(', ');
    const params = [toType, uid, ...fromTypes];
    // Capture pre-count so we can report rowsAffected accurately.
    const before = db.exec(
      `SELECT COUNT(*) FROM ${table} WHERE target_uid = ? AND target_type IN (${placeholders})`,
      [uid, ...fromTypes],
    );
    const count = (before[0]?.values[0]?.[0] as number) ?? 0;
    if (count === 0) continue;
    db.run(
      `UPDATE ${table} SET target_type = ?
       WHERE target_uid = ? AND target_type IN (${placeholders})`,
      params,
    );
    updated += count;
  }
  return updated;
}

function emptyCounts(): MigrationCounts {
  return {
    plansWalked: 0,
    objectsCreated: 0,
    phaseActionsCreated: 0,
    taskActionsCreated: 0,
    subtaskReparented: 0,
    docReparented: 0,
    attachmentsRetargeted: 0,
    commentsRetargeted: 0,
    syntheticEvents: 0,
    skipped: 0,
  };
}

function addCounts(into: MigrationCounts, from: MigrationCounts): void {
  into.plansWalked += from.plansWalked;
  into.objectsCreated += from.objectsCreated;
  into.phaseActionsCreated += from.phaseActionsCreated;
  into.taskActionsCreated += from.taskActionsCreated;
  into.subtaskReparented += from.subtaskReparented;
  into.docReparented += from.docReparented;
  into.attachmentsRetargeted += from.attachmentsRetargeted;
  into.commentsRetargeted += from.commentsRetargeted;
  into.syntheticEvents += from.syntheticEvents;
  into.skipped += from.skipped;
}
