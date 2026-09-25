/**
 * Plan item service — Phase 15 §15.A.
 *
 * The unified CRUD layer for `plan_items`. Replaces (eventually)
 * `plan-service.ts` (tasks), `plan-documents-service.ts` (spec docs),
 * `plan-phases-service.ts` (phases). For 15.A it sits alongside the
 * old services; nothing reads from it until 15.C wires the new MCP
 * surface.
 *
 * Two cross-cutting behaviours:
 *
 *  - **Version log (M1).** Every `updateItem` writes a row to
 *    `plan_item_versions` capturing both `body` and a JSON snapshot
 *    of the meaningful structured fields. Restoring a version reads
 *    from this table and writes a new "post-restore" version + a
 *    `plan_events: item_restored` row.
 *
 *  - **Structural events.** Create / move / re-parent / sort change /
 *    delete / status flip / kind transmute all append rows to
 *    `plan_events` via `plan-event-service.ts`. Drives the activity
 *    rail + timeline scrubber.
 *
 * Action-only fields (`status`, `fileSpecs`, `assignee`, …) are
 * silently ignored when `kind === 'object'`. Runtime guards in
 * `claimItem` etc. surface a clear error rather than a silent
 * mismatch.
 *
 * See `docs/PLAN-WORKSPACE-DESIGN.md` (v0.5) §Architecture for the
 * tool surface this service backs.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { appendPlanEvent } from './plan-event-service';
import { unmetHumanCriteria } from './criteria-service';
import type {
  PlanItem,
  PlanItemKind,
  CreatePlanItemInput,
  UpdatePlanItemInput,
  PlanItemEdge,
  FileSpec,
  SymbolSpec,
  TaskStatus,
  PlanItemVersion,
  PlanEvent,
  Skill,
  ClaimPolicy,
  ExecutionConfig,
  CascadeMode,
  ItemConstraints,
} from '../../shared/types';

// =============================================================================
// Constants & helpers
// =============================================================================

/**
 * Common SELECT-list — central column order so every reader is
 * consistent. Adding a column means updating one place.
 */
const ITEM_COLUMNS = `uid, plan_uid, parent_uid, sort_order, kind,
  title, body, template,
  status, assignee, assignee_type, assignee_model,
  progress_percent, blocked_reason,
  scope_path, file_specs, symbol_specs, new_connections, removed_conns, dependencies,
  skills, skills_mode, claim_policy, claim_policy_mode, execution_config, execution_config_mode,
  constraints, constraints_mode, requires_approval,
  author, author_type, created_at, updated_at, migrated_from,
  visibility, visibility_override`;

function rowToItem(r: any[]): PlanItem {
  return {
    uid: r[0] as string,
    planUid: r[1] as string,
    parentUid: (r[2] as string | null) ?? null,
    sortOrder: r[3] as number,
    kind: r[4] as PlanItemKind,
    title: r[5] as string,
    body: (r[6] as string | null) ?? '',
    template: (r[7] as string | null) ?? null,
    status: (r[8] as TaskStatus | null) ?? null,
    assignee: (r[9] as string | null) ?? null,
    assigneeType: (r[10] as string | null) ?? null,
    assigneeModel: (r[11] as string | null) ?? null,
    progressPercent: (r[12] as number | null) ?? null,
    blockedReason: (r[13] as string | null) ?? null,
    scopePath: (r[14] as string | null) ?? null,
    fileSpecs: parseJsonArray<FileSpec>(r[15] as string | null),
    symbolSpecs: parseJsonArray<SymbolSpec>(r[16] as string | null),
    newConnections: parseJsonArray<PlanItemEdge>(r[17] as string | null),
    removedConnections: parseJsonArray<PlanItemEdge>(r[18] as string | null),
    dependencies: parseJsonArray<string>(r[19] as string | null),
    // Phase 17.N-Q
    skills: parseJsonArray<Skill>(r[20] as string | null),
    skillsMode: (r[21] as CascadeMode | null) ?? 'inherit',
    claimPolicy: parseJsonOrNull<ClaimPolicy>(r[22] as string | null),
    claimPolicyMode: (r[23] as 'inherit' | 'replace' | null) ?? 'inherit',
    executionConfig: parseJsonOrNull<ExecutionConfig>(r[24] as string | null),
    executionConfigMode: (r[25] as 'inherit' | 'replace' | null) ?? 'inherit',
    // Phase 17.F
    constraints: parseJsonOrNull<ItemConstraints>(r[26] as string | null),
    constraintsMode: (r[27] as CascadeMode | null) ?? 'inherit',
    // Phase 17.K
    requiresApproval: !!(r[28] as number),
    author: r[29] as string,
    authorType: r[30] as string,
    createdAt: r[31] as number,
    updatedAt: r[32] as number,
    migratedFrom: (r[33] as string | null) ?? null,
    // Phase 3.2 — per-item sharing
    visibility: ((r[34] as string | null) ?? 'shared') as 'shared' | 'local',
    overrideParentVisibility: !!(r[35] as number),
  };
}

function parseJsonArray<T>(s: string | null): T[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonOrNull<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Structured fields we snapshot into `plan_item_versions.meta_snapshot`.
 * Body is its own column. We keep this exhaustive so non-body changes
 * (status flips, fileSpec edits, scopePath rename, …) are blameable.
 */
function metaSnapshotOf(item: PlanItem): Record<string, unknown> {
  return {
    title: item.title,
    template: item.template,
    status: item.status,
    assignee: item.assignee,
    assigneeType: item.assigneeType,
    assigneeModel: item.assigneeModel,
    progressPercent: item.progressPercent,
    blockedReason: item.blockedReason,
    scopePath: item.scopePath,
    fileSpecs: item.fileSpecs,
    symbolSpecs: item.symbolSpecs,
    newConnections: item.newConnections,
    removedConnections: item.removedConnections,
    dependencies: item.dependencies,
    parentUid: item.parentUid,
    sortOrder: item.sortOrder,
    // Phase 17.N-Q
    skills: item.skills,
    skillsMode: item.skillsMode,
    claimPolicy: item.claimPolicy,
    claimPolicyMode: item.claimPolicyMode,
    executionConfig: item.executionConfig,
    executionConfigMode: item.executionConfigMode,
    // Phase 17.F
    constraints: item.constraints,
    constraintsMode: item.constraintsMode,
    // Phase 17.K
    requiresApproval: item.requiresApproval,
    // Phase 3.2
    visibility: item.visibility,
    overrideParentVisibility: item.overrideParentVisibility,
  };
}

// =============================================================================
// Reads
// =============================================================================

export function getItem(uid: string): PlanItem | null {
  const result = getDb().exec(
    `SELECT ${ITEM_COLUMNS} FROM plan_items WHERE uid = ?`,
    [uid],
  );
  if (!result[0]?.values[0]) return null;
  return rowToItem(result[0].values[0] as any[]);
}

/**
 * Direct children of an item, ordered by `sort_order`. Pass
 * `parentUid=null` for the plan root's top-level items.
 */
export function getChildren(planUid: string, parentUid: string | null): PlanItem[] {
  const db = getDb();
  if (parentUid === null) {
    const r = db.exec(
      `SELECT ${ITEM_COLUMNS} FROM plan_items
       WHERE plan_uid = ? AND parent_uid IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
      [planUid],
    );
    return (r[0]?.values ?? []).map(rowToItem);
  }
  const r = db.exec(
    `SELECT ${ITEM_COLUMNS} FROM plan_items
     WHERE plan_uid = ? AND parent_uid = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [planUid, parentUid],
  );
  return (r[0]?.values ?? []).map(rowToItem);
}

/**
 * Every item in the plan, ordered. Cheap — used by the sidebar
 * (which builds the tree client-side from `parentUid`).
 */
export function listAllItems(planUid: string): PlanItem[] {
  const r = getDb().exec(
    `SELECT ${ITEM_COLUMNS} FROM plan_items
     WHERE plan_uid = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [planUid],
  );
  return (r[0]?.values ?? []).map(rowToItem);
}

/**
 * Lightweight tree query for the sidebar (S4). Returns only the
 * fields the row needs to render — no body, no fileSpecs blob.
 */
export interface PlanItemSummary {
  uid: string;
  planUid: string;
  parentUid: string | null;
  sortOrder: number;
  kind: PlanItemKind;
  title: string;
  template: string | null;
  status: TaskStatus | null;
  assignee: string | null;
  progressPercent: number | null;
  childCount: number;
  /** Phase 5.2 — needed by PlanItemTree for visibility indicators. */
  visibility: 'shared' | 'local';
  overrideParentVisibility: boolean;
}

export function listItemSummaries(planUid: string): PlanItemSummary[] {
  const db = getDb();
  const r = db.exec(
    `SELECT i.uid, i.plan_uid, i.parent_uid, i.sort_order, i.kind,
            i.title, i.template, i.status, i.assignee, i.progress_percent,
            (SELECT COUNT(*) FROM plan_items c WHERE c.parent_uid = i.uid) AS child_count,
            i.visibility, i.visibility_override
     FROM plan_items i
     WHERE i.plan_uid = ?
     ORDER BY i.sort_order ASC, i.created_at ASC`,
    [planUid],
  );
  if (!r[0]) return [];
  return r[0].values.map((row: any[]) => ({
    uid: row[0] as string,
    planUid: row[1] as string,
    parentUid: (row[2] as string | null) ?? null,
    sortOrder: row[3] as number,
    kind: row[4] as PlanItemKind,
    title: row[5] as string,
    template: (row[6] as string | null) ?? null,
    status: (row[7] as TaskStatus | null) ?? null,
    assignee: (row[8] as string | null) ?? null,
    progressPercent: (row[9] as number | null) ?? null,
    childCount: (row[10] as number) ?? 0,
    visibility: (row[11] as 'shared' | 'local' | null) ?? 'shared',
    overrideParentVisibility: row[12] === 1,
  }));
}

// =============================================================================
// Create
// =============================================================================

export function createItem(input: CreatePlanItemInput): PlanItem {
  const db = getDb();
  const uid = input.uid ?? randomUUID();
  const now = Date.now();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;

  // Derive sort_order: caller can pin it (migration uses this); else
  // append at the end of the parent's child list.
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const r = db.exec(
      input.parentUid == null
        ? `SELECT COALESCE(MAX(sort_order), -1) + 1
           FROM plan_items WHERE plan_uid = ? AND parent_uid IS NULL`
        : `SELECT COALESCE(MAX(sort_order), -1) + 1
           FROM plan_items WHERE plan_uid = ? AND parent_uid = ?`,
      input.parentUid == null ? [input.planUid] : [input.planUid, input.parentUid],
    );
    sortOrder = (r[0]?.values[0]?.[0] as number) ?? 0;
  }

  // Action-only field nullability: Objects keep the action columns
  // NULL so the read layer cleanly distinguishes them.
  const isAction = input.kind === 'action';

  db.run(
    `INSERT INTO plan_items
       (uid, plan_uid, parent_uid, sort_order, kind,
        title, body, template,
        status, assignee, assignee_type, assignee_model,
        progress_percent, blocked_reason,
        scope_path, file_specs, symbol_specs, new_connections, removed_conns, dependencies,
        skills, skills_mode, claim_policy, claim_policy_mode, execution_config, execution_config_mode,
        constraints, constraints_mode, requires_approval,
        author, author_type, created_at, updated_at, migrated_from,
        visibility, visibility_override)
     VALUES (?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?,
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?)`,
    [
      uid, input.planUid, input.parentUid ?? null, sortOrder, input.kind,
      input.title, input.body ?? '', input.template ?? null,
      isAction ? (input.status ?? 'pending') : null,
      isAction ? (input.assignee ?? null) : null,
      isAction ? (input.assigneeType ?? null) : null,
      isAction ? (input.assigneeModel ?? null) : null,
      // Phase 15.B — migrator preserves legacy progress / blocker
      // values; native creation passes neither so they default null.
      isAction ? (input.progressPercent ?? null) : null,
      isAction ? (input.blockedReason ?? null) : null,
      isAction ? (input.scopePath ?? null) : null,
      JSON.stringify(isAction ? (input.fileSpecs ?? []) : []),
      JSON.stringify(isAction ? (input.symbolSpecs ?? []) : []),
      JSON.stringify(isAction ? (input.newConnections ?? []) : []),
      JSON.stringify(isAction ? (input.removedConnections ?? []) : []),
      JSON.stringify(isAction ? (input.dependencies ?? []) : []),
      // Phase 17.N-Q
      JSON.stringify(input.skills ?? []),
      input.skillsMode ?? 'inherit',
      input.claimPolicy ? JSON.stringify(input.claimPolicy) : null,
      input.claimPolicyMode ?? 'inherit',
      input.executionConfig ? JSON.stringify(input.executionConfig) : null,
      input.executionConfigMode ?? 'inherit',
      // Phase 17.F
      input.constraints ? JSON.stringify(input.constraints) : null,
      input.constraintsMode ?? 'inherit',
      // Phase 17.K
      input.requiresApproval ? 1 : 0,
      input.author, input.authorType, createdAt, updatedAt,
      input.migratedFrom ?? null,
      // Phase 3.2 — per-item sharing
      input.visibility ?? 'shared',
      input.overrideParentVisibility ? 1 : 0,
    ],
  );

  markDirty();

  const item = getItem(uid);
  if (!item) {
    throw new Error(`createItem: failed to read back inserted item ${uid}`);
  }

  // Initial version row — row v1 with the just-inserted snapshot.
  // Lets the per-item history drawer show "created" as the first entry.
  writeVersionRow(item, 1, 'Created', input.author, input.authorType, createdAt);

  // Structural event — drives the activity rail + scrubber.
  appendPlanEvent({
    planUid: input.planUid,
    itemUid: uid,
    eventType: 'item_created',
    afterState: { uid, kind: input.kind, title: input.title, parentUid: input.parentUid ?? null, sortOrder },
    summary: `${input.kind === 'action' ? '⚡' : '📋'} created "${input.title}"`,
    author: input.author,
    authorType: input.authorType,
    createdAt,
  });

  return item;
}

// =============================================================================
// Update
// =============================================================================

export function updateItem(uid: string, updates: UpdatePlanItemInput): PlanItem | null {
  const db = getDb();
  const before = getItem(uid);
  if (!before) return null;

  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  // Two independent things to track:
  //   - `contentChanged` — any non-structural field changed, so we
  //     need a `plan_item_versions` row.
  //   - `structuralEvents[]` — every structural change emits its
  //     own `plan_events` row. Multiple can fire in one update
  //     (e.g. a rename + a re-parent in the same call).
  let contentChanged = false;
  type EventDescriptor = {
    eventType: PlanEvent['eventType'];
    before: unknown;
    after: unknown;
    kind: 'reparented' | 'reordered' | 'renamed' | 'status_changed' | 'kind_transmuted';
  };
  const structuralEvents: EventDescriptor[] = [];

  if (updates.title !== undefined && updates.title !== before.title) {
    sets.push('title = ?'); params.push(updates.title);
    contentChanged = true;
    structuralEvents.push({
      eventType: 'item_renamed',
      before: { title: before.title },
      after: { title: updates.title },
      kind: 'renamed',
    });
  }
  if (updates.body !== undefined && updates.body !== before.body) {
    sets.push('body = ?'); params.push(updates.body);
    contentChanged = true;
  }
  if (updates.template !== undefined && updates.template !== before.template) {
    sets.push('template = ?'); params.push(updates.template);
    contentChanged = true;
  }

  // Action-only fields — apply only when the row is an Action; on
  // Objects they stay NULL.
  if (before.kind === 'action') {
    if (updates.status !== undefined && updates.status !== before.status) {
      sets.push('status = ?'); params.push(updates.status);
      contentChanged = true;
      structuralEvents.push({
        eventType: 'status_changed',
        before: { status: before.status },
        after: { status: updates.status },
        kind: 'status_changed',
      });
    }
    if (updates.assignee !== undefined && updates.assignee !== before.assignee) {
      sets.push('assignee = ?'); params.push(updates.assignee);
      contentChanged = true;
    }
    if (updates.assigneeType !== undefined && updates.assigneeType !== before.assigneeType) {
      sets.push('assignee_type = ?'); params.push(updates.assigneeType);
      contentChanged = true;
    }
    if (updates.assigneeModel !== undefined && updates.assigneeModel !== before.assigneeModel) {
      sets.push('assignee_model = ?'); params.push(updates.assigneeModel);
      contentChanged = true;
    }
    if (updates.progressPercent !== undefined && updates.progressPercent !== before.progressPercent) {
      sets.push('progress_percent = ?'); params.push(updates.progressPercent);
      contentChanged = true;
    }
    if (updates.blockedReason !== undefined && updates.blockedReason !== before.blockedReason) {
      sets.push('blocked_reason = ?'); params.push(updates.blockedReason);
      contentChanged = true;
    }
    if (updates.scopePath !== undefined && updates.scopePath !== before.scopePath) {
      sets.push('scope_path = ?'); params.push(updates.scopePath);
      contentChanged = true;
    }
    // Array/object fields: callers always replace whole-blob, so we
    // unconditionally write when present (no deep-equal check). Cost:
    // an extra version row when the caller passes an unchanged array.
    // Acceptable trade-off vs. a deep-equal helper.
    if (updates.fileSpecs !== undefined) {
      sets.push('file_specs = ?'); params.push(JSON.stringify(updates.fileSpecs));
      contentChanged = true;
    }
    if (updates.symbolSpecs !== undefined) {
      sets.push('symbol_specs = ?'); params.push(JSON.stringify(updates.symbolSpecs));
      contentChanged = true;
    }
    // --- Connections: reconcile newConnections vs removedConnections ---
    // If the same edge appears in both arrays, removal wins — the
    // "add" is cancelled and the removal is consumed. This prevents
    // contradictory state where an edge is simultaneously planned
    // for addition and removal.
    if (updates.newConnections !== undefined || updates.removedConnections !== undefined) {
      let effectiveNew = updates.newConnections ?? before.newConnections ?? [];
      let effectiveRemoved = updates.removedConnections ?? before.removedConnections ?? [];

      if (effectiveNew.length > 0 && effectiveRemoved.length > 0) {
        const edgeKey = (e: PlanItemEdge) => `${e.from}\0${e.to}`;
        const newKeys = new Set(effectiveNew.map(edgeKey));
        const removedKeys = new Set(effectiveRemoved.map(edgeKey));
        const dupes = new Set([...newKeys].filter(k => removedKeys.has(k)));

        if (dupes.size > 0) {
          effectiveNew = effectiveNew.filter(e => !dupes.has(edgeKey(e)));
          effectiveRemoved = effectiveRemoved.filter(e => !dupes.has(edgeKey(e)));
        }
      }

      sets.push('new_connections = ?'); params.push(JSON.stringify(effectiveNew));
      sets.push('removed_conns = ?'); params.push(JSON.stringify(effectiveRemoved));
      contentChanged = true;
    }
    if (updates.dependencies !== undefined) {
      sets.push('dependencies = ?'); params.push(JSON.stringify(updates.dependencies));
      contentChanged = true;
    }
  }

  // Phase 17.N-Q — routing / execution fields (apply to both kinds)
  if (updates.skills !== undefined) {
    sets.push('skills = ?'); params.push(JSON.stringify(updates.skills));
    contentChanged = true;
  }
  if (updates.skillsMode !== undefined && updates.skillsMode !== before.skillsMode) {
    sets.push('skills_mode = ?'); params.push(updates.skillsMode);
    contentChanged = true;
  }
  if (updates.claimPolicy !== undefined) {
    sets.push('claim_policy = ?'); params.push(updates.claimPolicy ? JSON.stringify(updates.claimPolicy) : null);
    contentChanged = true;
  }
  if (updates.claimPolicyMode !== undefined && updates.claimPolicyMode !== before.claimPolicyMode) {
    sets.push('claim_policy_mode = ?'); params.push(updates.claimPolicyMode);
    contentChanged = true;
  }
  if (updates.executionConfig !== undefined) {
    sets.push('execution_config = ?'); params.push(updates.executionConfig ? JSON.stringify(updates.executionConfig) : null);
    contentChanged = true;
  }
  if (updates.executionConfigMode !== undefined && updates.executionConfigMode !== before.executionConfigMode) {
    sets.push('execution_config_mode = ?'); params.push(updates.executionConfigMode);
    contentChanged = true;
  }
  // Phase 17.F — constraints & guardrails
  if (updates.constraints !== undefined) {
    sets.push('constraints = ?'); params.push(updates.constraints ? JSON.stringify(updates.constraints) : null);
    contentChanged = true;
  }
  if (updates.constraintsMode !== undefined && updates.constraintsMode !== before.constraintsMode) {
    sets.push('constraints_mode = ?'); params.push(updates.constraintsMode);
    contentChanged = true;
  }
  // Phase 17.K — approval gate
  if (updates.requiresApproval !== undefined && updates.requiresApproval !== before.requiresApproval) {
    sets.push('requires_approval = ?'); params.push(updates.requiresApproval ? 1 : 0);
    contentChanged = true;
  }
  // Phase 3.2 — per-item sharing
  if (updates.visibility !== undefined && updates.visibility !== before.visibility) {
    sets.push('visibility = ?'); params.push(updates.visibility);
    contentChanged = true;
  }
  if (updates.overrideParentVisibility !== undefined && updates.overrideParentVisibility !== before.overrideParentVisibility) {
    sets.push('visibility_override = ?'); params.push(updates.overrideParentVisibility ? 1 : 0);
    contentChanged = true;
  }

  // Structural moves — re-parent and/or reorder. Each emits its own
  // event independently; neither bumps the version log (pure
  // structural change, body unchanged).
  if (updates.parentUid !== undefined && updates.parentUid !== before.parentUid) {
    sets.push('parent_uid = ?'); params.push(updates.parentUid);
    structuralEvents.push({
      eventType: 'reparented',
      before: { parentUid: before.parentUid },
      after: { parentUid: updates.parentUid },
      kind: 'reparented',
    });
  }
  if (updates.sortOrder !== undefined && updates.sortOrder !== before.sortOrder) {
    sets.push('sort_order = ?'); params.push(updates.sortOrder);
    structuralEvents.push({
      eventType: 'reordered',
      before: { sortOrder: before.sortOrder },
      after: { sortOrder: updates.sortOrder },
      kind: 'reordered',
    });
  }

  // Nothing actually changed — skip the write.
  if (sets.length === 1 /* just updated_at */) {
    return before;
  }

  params.push(uid);
  db.run(`UPDATE plan_items SET ${sets.join(', ')} WHERE uid = ?`, params);
  markDirty();

  const after = getItem(uid);
  if (!after) return null;

  // Defensive: ensure updatedAt reflects the timestamp we just wrote.
  // In rare rapid-fire parallel updates the re-read from sql.js has
  // occasionally returned a stale value; forcing it here guarantees
  // the response and version row are consistent.
  after.updatedAt = now;

  // Per-item version row — written iff content changed. Pure
  // re-parent / reorder skips the version log (those are tracked
  // exclusively via plan_events).
  if (contentChanged) {
    writeVersionRow(after, nextVersionFor(uid), updates.changeSummary ?? null, updates.author, updates.authorType, now);
  }

  // Emit one plan_events row per structural change. A `body` edit
  // alone produces zero events; a rename produces `item_renamed`; a
  // body+rename produces `item_renamed`; a body+rename+reparent
  // produces both `item_renamed` and `reparented`.
  for (const ev of structuralEvents) {
    appendPlanEvent({
      planUid: after.planUid,
      itemUid: after.uid,
      eventType: ev.eventType,
      beforeState: ev.before,
      afterState: ev.after,
      summary: structuralSummary(after, ev.kind, ev.before, ev.after),
      author: updates.author,
      authorType: updates.authorType,
    });
  }

  return after;
}

// =============================================================================
// Move (re-parent + reorder atomically)
// =============================================================================

export interface MoveItemInput {
  newParentUid?: string | null;
  newSortOrder?: number;
  author: string;
  authorType: string;
  /** Optional — if absent, defaults to "moved <title>". */
  summary?: string;
}

/**
 * Re-parent and/or reorder. Single event written even when both
 * change. Used by drag-drop in the sidebar.
 */
export function moveItem(uid: string, input: MoveItemInput): PlanItem | null {
  const before = getItem(uid);
  if (!before) return null;
  const now = Date.now();
  const db = getDb();

  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];
  let isReparent = false;
  let isReorder = false;

  if (input.newParentUid !== undefined && input.newParentUid !== before.parentUid) {
    sets.push('parent_uid = ?'); params.push(input.newParentUid);
    isReparent = true;
  }
  if (input.newSortOrder !== undefined && input.newSortOrder !== before.sortOrder) {
    sets.push('sort_order = ?'); params.push(input.newSortOrder);
    isReorder = true;
  }
  if (sets.length === 1) return before; // no-op

  params.push(uid);
  db.run(`UPDATE plan_items SET ${sets.join(', ')} WHERE uid = ?`, params);
  markDirty();

  appendPlanEvent({
    planUid: before.planUid,
    itemUid: uid,
    eventType: isReparent ? 'item_moved' : 'reordered',
    beforeState: { parentUid: before.parentUid, sortOrder: before.sortOrder },
    afterState: {
      parentUid: input.newParentUid ?? before.parentUid,
      sortOrder: input.newSortOrder ?? before.sortOrder,
    },
    summary: input.summary ?? defaultMoveSummary(before, isReparent, isReorder),
    author: input.author,
    authorType: input.authorType,
  });

  return getItem(uid);
}

// =============================================================================
// Delete (cascade)
// =============================================================================

export interface DeleteItemInput {
  cascade?: boolean;
  author: string;
  authorType: string;
}

/**
 * Delete an item and (by default) its descendants. Records `before_state`
 * on the event so a future `restore_item` can put the tree back —
 * "soft delete via append-only event log" rather than a tombstone column.
 *
 * Returns the uids of every item actually deleted (caller may use this
 * to broadcast `plan-item-deleted` with the cascadedUids list).
 */
export function deleteItem(uid: string, input: DeleteItemInput): string[] {
  const db = getDb();
  const root = getItem(uid);
  if (!root) return [];

  const cascade = input.cascade !== false; // default true
  const toDelete: string[] = cascade
    ? collectSubtree(uid)
    : [uid];

  // Snapshot every row so we can replay on restore.
  const beforeSnapshots: Array<{ uid: string; row: PlanItem }> = [];
  for (const u of toDelete) {
    const item = getItem(u);
    if (item) beforeSnapshots.push({ uid: u, row: item });
  }

  // Hard-delete in reverse depth order so FKs don't bite (children
  // first, parents last). collectSubtree returns a DFS order; reverse
  // for safe deletion.
  for (const u of [...toDelete].reverse()) {
    db.run(`DELETE FROM plan_item_versions WHERE item_uid = ?`, [u]);
    db.run(`DELETE FROM plan_items WHERE uid = ?`, [u]);
  }
  markDirty();

  appendPlanEvent({
    planUid: root.planUid,
    itemUid: uid,
    eventType: 'item_deleted',
    beforeState: { items: beforeSnapshots, cascade },
    summary: cascade && toDelete.length > 1
      ? `🗑 deleted "${root.title}" + ${toDelete.length - 1} child${toDelete.length === 2 ? '' : 'ren'}`
      : `🗑 deleted "${root.title}"`,
    author: input.author,
    authorType: input.authorType,
  });

  return toDelete;
}

function collectSubtree(rootUid: string): string[] {
  const db = getDb();
  const result: string[] = [];
  const stack: string[] = [rootUid];
  while (stack.length > 0) {
    const u = stack.pop() as string;
    result.push(u);
    const r = db.exec(`SELECT uid FROM plan_items WHERE parent_uid = ?`, [u]);
    if (r[0]) {
      for (const row of r[0].values) stack.push(row[0] as string);
    }
  }
  return result;
}

// =============================================================================
// Versions (M1 — per-item history)
// =============================================================================

function nextVersionFor(itemUid: string): number {
  const r = getDb().exec(
    `SELECT COALESCE(MAX(version), 0) + 1 FROM plan_item_versions WHERE item_uid = ?`,
    [itemUid],
  );
  return (r[0]?.values[0]?.[0] as number) ?? 1;
}

function writeVersionRow(
  item: PlanItem,
  version: number,
  changeSummary: string | null,
  author: string,
  authorType: string,
  createdAt: number,
): void {
  getDb().run(
    `INSERT INTO plan_item_versions
       (item_uid, version, body_snapshot, meta_snapshot, change_summary, author, author_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.uid,
      version,
      item.body ?? '',
      JSON.stringify(metaSnapshotOf(item)),
      changeSummary,
      author,
      authorType,
      createdAt,
    ],
  );
}

export function listItemVersions(itemUid: string): PlanItemVersion[] {
  const r = getDb().exec(
    `SELECT id, item_uid, version, body_snapshot, meta_snapshot, change_summary, author, author_type, created_at
     FROM plan_item_versions
     WHERE item_uid = ?
     ORDER BY version DESC`,
    [itemUid],
  );
  if (!r[0]) return [];
  return r[0].values.map((row: any[]) => ({
    id: row[0] as number,
    itemUid: row[1] as string,
    version: row[2] as number,
    bodySnapshot: (row[3] as string) ?? '',
    metaSnapshot: parseJsonObj(row[4] as string | null),
    changeSummary: (row[5] as string | null) ?? null,
    author: row[6] as string,
    authorType: row[7] as string,
    createdAt: row[8] as number,
  }));
}

function parseJsonObj(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Restore an item to a prior version's body + structured fields.
 * Writes a new version row with `change_summary: "Restored vN"` and
 * appends a `plan_events: item_restored` row.
 */
export function restoreItemVersion(
  itemUid: string,
  version: number,
  author: string,
  authorType: string,
): PlanItem | null {
  const versions = listItemVersions(itemUid);
  const target = versions.find((v) => v.version === version);
  if (!target) return null;

  const meta = target.metaSnapshot;
  const updates: UpdatePlanItemInput = {
    body: target.bodySnapshot,
    title: typeof meta.title === 'string' ? meta.title : undefined,
    template: meta.template === null || typeof meta.template === 'string' ? (meta.template as string | null) : undefined,
    status: typeof meta.status === 'string' ? (meta.status as TaskStatus) : undefined,
    assignee: typeof meta.assignee === 'string' || meta.assignee === null ? (meta.assignee as string | null) : undefined,
    assigneeType: typeof meta.assigneeType === 'string' || meta.assigneeType === null ? (meta.assigneeType as string | null) : undefined,
    assigneeModel: typeof meta.assigneeModel === 'string' || meta.assigneeModel === null ? (meta.assigneeModel as string | null) : undefined,
    progressPercent: typeof meta.progressPercent === 'number' || meta.progressPercent === null ? (meta.progressPercent as number | null) : undefined,
    blockedReason: typeof meta.blockedReason === 'string' || meta.blockedReason === null ? (meta.blockedReason as string | null) : undefined,
    scopePath: typeof meta.scopePath === 'string' || meta.scopePath === null ? (meta.scopePath as string | null) : undefined,
    fileSpecs: Array.isArray(meta.fileSpecs) ? (meta.fileSpecs as FileSpec[]) : undefined,
    symbolSpecs: Array.isArray(meta.symbolSpecs) ? (meta.symbolSpecs as SymbolSpec[]) : undefined,
    newConnections: Array.isArray(meta.newConnections) ? (meta.newConnections as PlanItemEdge[]) : undefined,
    removedConnections: Array.isArray(meta.removedConnections) ? (meta.removedConnections as PlanItemEdge[]) : undefined,
    dependencies: Array.isArray(meta.dependencies) ? (meta.dependencies as string[]) : undefined,
    changeSummary: `Restored v${version}`,
    author,
    authorType,
  };
  const restored = updateItem(itemUid, updates);
  if (!restored) return null;

  appendPlanEvent({
    planUid: restored.planUid,
    itemUid,
    eventType: 'item_restored',
    afterState: { restoredFromVersion: version },
    summary: `↩ restored "${restored.title}" to v${version}`,
    author,
    authorType,
  });

  return restored;
}

// =============================================================================
// Action-only operations (claim)
// =============================================================================

export interface ClaimItemResult {
  ok: boolean;
  conflicts?: string[];
  reason?: string;
}

/**
 * Phase 17.P — Resolve the effective claim policy by walking up the tree.
 * Returns the nearest non-null policy (the item's own or inherited from ancestors).
 * Defaults to `{ mode: 'any' }` if no policy is set anywhere in the chain.
 */
export function resolveClaimPolicy(item: PlanItem): ClaimPolicy {
  // If item has its own policy set (not inherit mode), use it
  if (item.claimPolicyMode === 'replace' && item.claimPolicy) {
    return item.claimPolicy;
  }
  if (item.claimPolicy && item.claimPolicyMode !== 'inherit') {
    return item.claimPolicy;
  }

  // Walk up parents
  let cur = item.parentUid ? getItem(item.parentUid) : null;
  while (cur) {
    if (cur.claimPolicy) {
      if (cur.claimPolicyMode === 'replace' || cur.claimPolicyMode !== 'inherit') {
        return cur.claimPolicy;
      }
      // Has a policy but mode is inherit — use it (it's the nearest one)
      return cur.claimPolicy;
    }
    cur = cur.parentUid ? getItem(cur.parentUid) : null;
  }
  return { mode: 'any' };
}

/**
 * Phase 17.P — Resolve effective skills by walking up the tree and merging.
 */
export function resolveSkills(item: PlanItem): Skill[] {
  const chain: PlanItem[] = [];
  let cur: PlanItem | null = item;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentUid ? getItem(cur.parentUid) : null;
  }

  let resolved: Skill[] = [];
  for (const ancestor of chain) {
    const skills = ancestor.skills ?? [];
    if (skills.length === 0 && ancestor.skillsMode === 'inherit') continue;
    if (ancestor.skillsMode === 'replace') {
      resolved = [...skills];
    } else if (ancestor.skillsMode === 'none') {
      resolved = [];
    } else {
      // inherit — merge (later additions override same-name)
      const byName = new Map(resolved.map((s) => [s.name, s]));
      for (const s of skills) byName.set(s.name, s);
      resolved = Array.from(byName.values());
    }
  }
  return resolved;
}

/**
 * Phase 17.F — Resolve effective constraints by walking up the tree.
 * Constraints merge additively: child exclusions ADD to parent exclusions,
 * boolean flags are OR'd (any ancestor requiring tests = tests required).
 * Child can override with constraintsMode='replace' (wipe inherited) or
 * constraintsMode='none' (disable all constraints for subtree).
 */
export function resolveConstraints(item: PlanItem): ItemConstraints {
  const chain: PlanItem[] = [];
  let cur: PlanItem | null = item;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentUid ? getItem(cur.parentUid) : null;
  }

  let resolved: ItemConstraints = {};
  for (const ancestor of chain) {
    const c = ancestor.constraints;
    const mode = ancestor.constraintsMode ?? 'inherit';

    if (mode === 'none') {
      resolved = {};
      continue;
    }
    if (mode === 'replace' && c) {
      resolved = { ...c };
      continue;
    }
    // inherit — merge additively
    if (!c) continue;
    resolved = {
      excludePaths: [...(resolved.excludePaths ?? []), ...(c.excludePaths ?? [])],
      excludeSymbols: [...(resolved.excludeSymbols ?? []), ...(c.excludeSymbols ?? [])],
      lockInterfaces: resolved.lockInterfaces || c.lockInterfaces || false,
      requireTests: resolved.requireTests || c.requireTests || false,
      requireLint: resolved.requireLint || c.requireLint || false,
      maxFilesTouched: c.maxFilesTouched ?? resolved.maxFilesTouched ?? null,
      maxLinesChanged: c.maxLinesChanged ?? resolved.maxLinesChanged ?? null,
      customRules: [...(resolved.customRules ?? []), ...(c.customRules ?? [])],
    };
  }
  return resolved;
}

/**
 * Atomic claim — only succeeds if the Action is unclaimed (no
 * assignee) AND status is `pending`. Returns conflicts list when
 * other in-progress Actions in the same plan touch overlapping
 * files. Mirrors the today's `plan-service.claimTask` semantics.
 *
 * Phase 17.O: Enforces claim policy — rejects claims that violate
 * human-only, assigned, agent-type, or skill requirements.
 */
export function claimItem(
  uid: string,
  agentId: string,
  agentType: string,
  model?: string,
  capabilities?: Array<{ name: string; source: string }>,
): ClaimItemResult {
  const item = getItem(uid);
  if (!item) return { ok: false, reason: 'Item not found' };
  if (item.kind !== 'action') {
    return { ok: false, reason: 'Only Actions can be claimed (this is an Object).' };
  }
  if (item.assignee || item.status !== 'pending') {
    return { ok: false, reason: 'Action already claimed or not pending.' };
  }

  // Phase 17.O — Claim policy enforcement
  const policy = resolveClaimPolicy(item);
  if (policy.mode === 'human-only') {
    return { ok: false, reason: 'This task is restricted to human-only completion.' };
  }
  if (policy.mode === 'assigned') {
    if (policy.assignToType === 'human') {
      return { ok: false, reason: 'This task is assigned to a human.' };
    }
    if (policy.assignTo && policy.assignTo !== agentId) {
      return { ok: false, reason: `This task is assigned to a specific agent (${policy.assignTo}).` };
    }
  }
  if (policy.allowedAgentTypes && policy.allowedAgentTypes.length > 0) {
    if (!policy.allowedAgentTypes.includes(agentType)) {
      return { ok: false, reason: `This task is restricted to agent types: ${policy.allowedAgentTypes.join(', ')}. You are: ${agentType}.` };
    }
  }
  if (policy.allowedModels && policy.allowedModels.length > 0 && model) {
    if (!policy.allowedModels.includes(model)) {
      return { ok: false, reason: `This task is restricted to models: ${policy.allowedModels.join(', ')}. You are using: ${model}.` };
    }
  }

  // Phase 17.N — Skill matching
  if (policy.mode === 'match-skills' || policy.mode === 'any') {
    const requiredSkills = resolveSkills(item).filter((s) => s.required);
    if (requiredSkills.length > 0 && capabilities) {
      const capNames = new Set(capabilities.map((c) => c.name));
      const missing = requiredSkills.filter((s) => !capNames.has(s.name));
      if (missing.length > 0) {
        return {
          ok: false,
          reason: `This task requires skills you don't have: ${missing.map((s) => `${s.name} (${s.source})`).join(', ')}.`,
        };
      }
    } else if (requiredSkills.length > 0 && !capabilities) {
      // Agent didn't declare capabilities — can't claim skill-gated items
      if (policy.mode === 'match-skills') {
        return {
          ok: false,
          reason: `This task requires skills (${requiredSkills.map((s) => s.name).join(', ')}) but you haven't declared capabilities. Use register_session with capabilities.`,
        };
      }
    }
  }

  // Check file-overlap conflicts against other in-progress Actions
  // in the same plan. Same heuristic as today's claim.
  const myFiles = new Set<string>();
  for (const fs of item.fileSpecs ?? []) {
    if (fs.path) myFiles.add(fs.path);
    if (fs.moveTo) myFiles.add(fs.moveTo);
  }
  const conflicts: string[] = [];
  if (myFiles.size > 0) {
    const others = listAllItems(item.planUid).filter((o) =>
      o.uid !== uid &&
      o.kind === 'action' &&
      (o.status === 'in_progress' || o.status === 'assigned') &&
      o.assignee !== agentId,
    );
    for (const other of others) {
      const overlap = (other.fileSpecs ?? []).flatMap((fs) => [fs.path, fs.moveTo].filter(Boolean) as string[])
        .filter((p) => myFiles.has(p));
      if (overlap.length > 0) {
        conflicts.push(`Action "${other.title}" (${other.assignee}) also affects: ${overlap.join(', ')}`);
      }
    }
  }

  updateItem(uid, {
    status: 'assigned',
    assignee: agentId,
    assigneeType: agentType,
    assigneeModel: model ?? null,
    author: agentId,
    authorType: 'agent',
    changeSummary: 'Claimed',
  });

  return { ok: true, conflicts: conflicts.length > 0 ? conflicts : undefined };
}

// =============================================================================
// Phase 17.K — Get next available item (V2 surface), respects approval gates
// =============================================================================

export interface NextItemResult {
  item: PlanItem | null;
  /** When an item exists but is gated by approval, this carries context. */
  gated?: {
    itemUid: string;
    itemTitle: string;
    reason: string;
  };
}

/**
 * Return the next claimable Action from a plan. Checks:
 *   - Status must be 'pending'
 *   - No unmet dependencies (all dep uids must be 'done' or 'skipped')
 *   - If `requiresApproval` on a prior sibling that just completed,
 *     gate the next sibling until a human approves
 *
 * Returns the first eligible item sorted by tree position (parent
 * chain + sortOrder). Returns `gated` info when the next item
 * exists but can't be started due to an approval gate.
 */
export function getNextItem(planUid: string, parentUid?: string | null): NextItemResult {
  const all = listAllItems(planUid);
  const itemMap = Object.fromEntries(all.map((i) => [i.uid, i]));

  // Filter to pending Actions
  let candidates = all.filter((i) =>
    i.kind === 'action' &&
    i.status === 'pending' &&
    !i.assignee,
  );

  // Scope to a parent if provided
  if (parentUid !== undefined) {
    candidates = candidates.filter((i) => i.parentUid === parentUid);
  }

  // Filter out those with unmet dependencies
  candidates = candidates.filter((i) => {
    const deps = i.dependencies ?? [];
    if (deps.length === 0) return true;
    return deps.every((d) => {
      const dep = itemMap[d];
      return dep && (dep.status === 'done' || dep.status === 'skipped');
    });
  });

  // Sort by sortOrder (within same parent) — stable ordering
  candidates.sort((a, b) => a.sortOrder - b.sortOrder);

  if (candidates.length === 0) {
    return { item: null };
  }

  // Check approval gates: if the candidate has a prior sibling with
  // requiresApproval that completed recently, gate the next item.
  const next = candidates[0];
  const siblings = all
    .filter((i) => i.parentUid === next.parentUid && i.kind === 'action')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const myIdx = siblings.findIndex((s) => s.uid === next.uid);
  if (myIdx > 0) {
    // Check the immediately preceding sibling
    const prev = siblings[myIdx - 1];
    // Phase 31 §4.1: the gate is "the previous sibling has human-policy
    // criteria a person has not met". `requiresApproval` is shorthand for
    // one such criterion, so a plan that only sets the flag gates exactly
    // as before — but clearing it now takes a person's sign-off, not a
    // flag any caller could flip.
    const unmet = prev.status === 'done' ? unmetHumanCriteria(prev.uid) : [];
    if (unmet.length > 0) {
      return {
        item: null,
        gated: {
          itemUid: next.uid,
          itemTitle: next.title,
          reason: `Waiting for a person to sign off "${prev.title}" (${unmet.map((c) => `"${c.text}"`).join(', ')}) before proceeding.`,
        },
      };
    }
  }

  return { item: next };
}

// =============================================================================
// Helpers — summaries
// =============================================================================

function structuralSummary(
  after: PlanItem,
  kind: 'reparented' | 'reordered' | 'renamed' | 'status_changed' | 'kind_transmuted',
  beforeState: unknown,
  afterState: unknown,
): string {
  const icon = after.kind === 'action' ? '⚡' : '📋';
  switch (kind) {
    case 'renamed': {
      const b = (beforeState as { title?: string } | undefined)?.title ?? '?';
      return `${icon} renamed "${b}" → "${after.title}"`;
    }
    case 'status_changed': {
      const b = (beforeState as { status?: string } | undefined)?.status ?? '?';
      const a = (afterState as { status?: string } | undefined)?.status ?? '?';
      return `${icon} "${after.title}" ${b} → ${a}`;
    }
    case 'reparented':
      return `${icon} moved "${after.title}"`;
    case 'reordered':
      return `${icon} reordered "${after.title}"`;
    case 'kind_transmuted':
      return `${icon} transmuted "${after.title}"`;
  }
}

function defaultMoveSummary(item: PlanItem, isReparent: boolean, isReorder: boolean): string {
  const icon = item.kind === 'action' ? '⚡' : '📋';
  if (isReparent && isReorder) return `${icon} moved "${item.title}"`;
  if (isReparent) return `${icon} re-parented "${item.title}"`;
  return `${icon} reordered "${item.title}"`;
}

// =============================================================================
// Per-item sharing (Phase 3.2)
// =============================================================================

/**
 * Resolve an item's effective visibility by walking ancestors:
 *
 *   - If the item itself is `local`, return `local` (own intent wins).
 *   - If the item is `shared` AND `overrideParentVisibility` is true,
 *     return `shared` — the escape hatch for "I want this exported
 *     even though my parent stays local."
 *   - Otherwise, walk up. The first `local` ancestor makes this item
 *     effectively `local` too (children of a local parent inherit).
 *   - If no `local` ancestor is found, the item is effectively
 *     `shared`.
 */
export function getEffectiveVisibility(itemUid: string): 'shared' | 'local' {
  const item = getItem(itemUid);
  if (!item) return 'shared';
  if (item.visibility === 'local') return 'local';
  if (item.overrideParentVisibility) return 'shared';
  let cursor = item.parentUid;
  const seen = new Set<string>([itemUid]);
  while (cursor) {
    if (seen.has(cursor)) break; // cycle safety
    seen.add(cursor);
    const ancestor = getItem(cursor);
    if (!ancestor) break;
    if (ancestor.visibility === 'local') return 'local';
    if (ancestor.overrideParentVisibility) return 'shared'; // override breaks the chain
    cursor = ancestor.parentUid;
  }
  return 'shared';
}

/**
 * Returns the items that should be exported to disk for a plan, with
 * each item's parent UID re-anchored to the nearest exported ancestor
 * (or `null` if no such ancestor exists). This handles the override
 * case where a shared child has a local parent — the child appears
 * top-level on disk because its parent isn't there to anchor it.
 *
 * The in-DB tree remains untouched; this is purely an export-time view.
 */
export function listItemsForExport(planUid: string): Array<{ item: PlanItem; exportParentUid: string | null }> {
  const all = listAllItems(planUid);
  const byUid = new Map<string, PlanItem>(all.map((i) => [i.uid, i]));

  // Memoised effective-visibility computation. Walks ancestors once
  // per item; subsequent lookups are O(1).
  const visibilityCache = new Map<string, 'shared' | 'local'>();
  function effective(uid: string): 'shared' | 'local' {
    const cached = visibilityCache.get(uid);
    if (cached) return cached;
    const item = byUid.get(uid);
    if (!item) {
      visibilityCache.set(uid, 'shared');
      return 'shared';
    }
    if (item.visibility === 'local') {
      visibilityCache.set(uid, 'local');
      return 'local';
    }
    if (item.overrideParentVisibility) {
      visibilityCache.set(uid, 'shared');
      return 'shared';
    }
    if (!item.parentUid) {
      visibilityCache.set(uid, 'shared');
      return 'shared';
    }
    const parentEff = effective(item.parentUid);
    visibilityCache.set(uid, parentEff);
    return parentEff;
  }

  const result: Array<{ item: PlanItem; exportParentUid: string | null }> = [];
  for (const item of all) {
    if (effective(item.uid) !== 'shared') continue;
    let exportParentUid: string | null = null;
    let cursor = item.parentUid;
    const seen = new Set<string>([item.uid]);
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (effective(cursor) === 'shared') {
        exportParentUid = cursor;
        break;
      }
      const ancestor = byUid.get(cursor);
      if (!ancestor) break;
      cursor = ancestor.parentUid;
    }
    result.push({ item, exportParentUid });
  }
  return result;
}
