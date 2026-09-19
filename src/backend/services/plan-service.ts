// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___plan_file_service from './plan-file-service';
import * as _lazy___git_identity from './git-identity';
import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
// Direct, not lazy: plan-item-service does not import this module, so
// there is no cycle to break.
import * as planItemService from './plan-item-service';
import type { Plan, Task, PlanItem, PlanVersion, CreatePlanInput, PlanStatus, FileSpec } from '../../shared/types';

/**
 * Compute `affectedFiles` from `fileSpecs`. Phase 14 §A treats
 * `affectedFiles` as a derived view — every fileSpec contributes its
 * `path` (and `moveTo` for moves) so the existing drift / graph
 * machinery keeps working. Returns a deduped array.
 */
function deriveAffectedFiles(fileSpecs: FileSpec[] | undefined, existing: string[] | undefined): string[] {
  if (!fileSpecs || fileSpecs.length === 0) return existing ?? [];
  const set = new Set<string>();
  for (const fs of fileSpecs) {
    if (fs.path) set.add(fs.path);
    if (fs.moveTo) set.add(fs.moveTo);
  }
  // Preserve ordering: fileSpec paths first, then any extras the caller
  // had in `affectedFiles` that aren't covered by a spec yet.
  const ordered: string[] = Array.from(set);
  if (existing) {
    for (const p of existing) {
      if (!set.has(p)) {
        ordered.push(p);
        set.add(p);
      }
    }
  }
  return ordered;
}

/**
 * Phase 13 §B auto-sync hook. Lazy-required to dodge the import
 * cycle (plan-file-service → plan-service → here). Best-effort: if
 * the auto-sync layer isn't wired up (early init / tests), this is a
 * no-op.
 */
function notifyMutation(planUid: string): void {
  try {
    const { scheduleWriteThrough } = _lazy___plan_file_service;
    scheduleWriteThrough(planUid);
  } catch { /* auto-sync not available — fine, manual export still works */ }
}

/** Strip trailing slashes so `/foo/bar/` and `/foo/bar` match in queries. */
function normalizePath(p: string): string {
  return p.replace(/\/+$/, '') || p;
}

export function createPlan(
  input: CreatePlanInput,
  author: string,
  authorType: string,
  projectPath: string,
): Plan {
  const db = getDb();
  const uid = randomUUID();
  const now = Date.now();
  const normalizedPath = normalizePath(projectPath);

  // Phase 3.3 — capture the origin URL of the current project as the
  // plan's home repo. Stable across clones (same URL means same repo
  // regardless of local path). Falls back to null when the project
  // isn't a git repo or has no origin.
  const { getNormalisedOriginUrl } = _lazy___git_identity;
  const homeRepo: string | null = normalizedPath ? (getNormalisedOriginUrl(normalizedPath) ?? null) : null;

  db.run(
    `INSERT INTO plans (uid, title, description, status, author, author_type, project_path, created_at, updated_at, home_repo, scope)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, '[]')`,
    [uid, input.title, input.description || '', author, authorType, normalizedPath, now, now, homeRepo]
  );

  const tasks: Task[] = [];
  for (let i = 0; i < input.tasks.length; i++) {
    const t = input.tasks[i];
    const taskUid = randomUUID();
    const fileSpecs: FileSpec[] = t.fileSpecs ?? [];
    const affectedFiles = deriveAffectedFiles(fileSpecs, t.affectedFiles);
    db.run(
      `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, affected_files, affected_symbols, new_connections, removed_connections, dependencies, file_spec, symbol_specs, parent_task_uid, body, prompt, scope_path, file_specs, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [taskUid, uid, i, t.description,
        JSON.stringify(affectedFiles), JSON.stringify(t.affectedSymbols || []),
        JSON.stringify(t.newConnections || []), JSON.stringify(t.removedConnections || []),
        JSON.stringify(t.dependencies || []),
        t.fileSpec ?? null, JSON.stringify(t.symbolSpecs || []),
        t.parentTaskUid ?? null,
        t.body ?? null, t.prompt ?? null,
        t.scopePath ?? null, JSON.stringify(fileSpecs),
        now, now]
    );
    tasks.push({
      uid: taskUid, planUid: uid, sortOrder: i, description: t.description,
      status: 'pending', assignee: null, assigneeType: null, assigneeModel: null,
      affectedFiles, affectedSymbols: t.affectedSymbols || [],
      newConnections: t.newConnections || [], removedConnections: t.removedConnections || [],
      dependencies: t.dependencies || [],
      fileSpec: t.fileSpec, symbolSpecs: t.symbolSpecs || [],
      phaseUid: null,
      parentTaskUid: t.parentTaskUid ?? null,
      body: t.body, prompt: t.prompt,
      scopePath: t.scopePath ?? null,
      fileSpecs,
      progressPercent: null, blockedReason: null,
      createdAt: now, updatedAt: now,
    });
  }

  const plan: Plan = {
    uid, title: input.title, description: input.description || '', status: 'draft',
    author, authorType, projectPath, createdAt: now, updatedAt: now,
    taskCount: tasks.length, completedTaskCount: 0,
    homeRepo,
    scope: [],
  };

  // Version 1.
  //
  // The snapshot is the bare plan, matching what `updatePlan` writes
  // for every subsequent version. It used to be `{ plan, tasks }` —
  // one column, two shapes, nothing checking they agreed. Phase 29
  // §4.8 gave `plan_versions` a reader that diffs each snapshot
  // against the one before it, and v2-against-v1 compared a bare plan
  // to a wrapper, so every tracked field looked like it had changed
  // from nothing on a plan's first edit.
  //
  // Rows written before this still carry the wrapper, so the reader
  // unwraps it rather than relying on this fix alone.
  db.run(
    `INSERT INTO plan_versions (plan_uid, version, snapshot, change_summary, author, created_at)
     VALUES (?, 1, ?, 'Plan created', ?, ?)`,
    [uid, JSON.stringify(plan), author, now]
  );

  markDirty();
  notifyMutation(plan.uid);
  return plan;
}

/**
 * Phase 15 §15.D — column list for plans, including the git-context
 * fields (`base_ref`, `target_branch`, `target_worktree`,
 * `auto_create_branch`). Centralised so getPlan / listPlans / version
 * snapshots all stay in lockstep.
 */
const PLAN_COLUMNS = `uid, title, description, status, author, author_type, project_path, created_at, updated_at,
        base_ref, target_branch, target_worktree, auto_create_branch,
        home_repo, scope`;

function rowToPlanCore(r: any[]): Plan {
  let scope: string[] = [];
  try {
    const parsed = JSON.parse((r[14] as string | null) ?? '[]');
    if (Array.isArray(parsed)) scope = parsed.filter((s): s is string => typeof s === 'string');
  } catch { /* malformed — empty */ }
  return {
    uid: r[0] as string,
    title: r[1] as string,
    description: r[2] as string,
    status: r[3] as PlanStatus,
    author: r[4] as string,
    authorType: r[5] as string,
    projectPath: r[6] as string,
    createdAt: r[7] as number,
    updatedAt: r[8] as number,
    baseRef: (r[9] as string | null) ?? null,
    targetBranch: (r[10] as string | null) ?? null,
    targetWorktree: (r[11] as string | null) ?? null,
    autoCreateBranch: !!(r[12] as number | null),
    // Phase 3.3 — cross-repo scope
    homeRepo: (r[13] as string | null) ?? null,
    scope,
  };
}

export function getPlan(planUid: string): (Plan & { tasks: Task[] }) | null {
  const db = getDb();
  const result = db.exec(
    `SELECT ${PLAN_COLUMNS} FROM plans WHERE uid = ?`,
    [planUid]
  );
  if (!result[0]?.values[0]) return null;
  const r = result[0].values[0];

  const tasks = getTasksByPlan(planUid);
  const core = rowToPlanCore(r);
  return {
    ...core,
    // Same source as the list — see `countPlanActions`. Counting the
    // legacy `tasks` array here meant the plan DETAIL disagreed with
    // itself too: 0 actions beside an item tree that plainly had some.
    ...countPlanActions(db, planUid),
    tasks,
  };
}

/**
 * How many ACTIONS a plan has, and how many are done.
 *
 * Counts `plan_items`, not `tasks`. `tasks` is the pre-V2 table and no
 * modern write path touches it — `add_item` and `bulk_add_items` both go to
 * `plan_items` — so counting it reported 0/0 for every plan an agent has
 * ever created. That number is on the plan list, the plan chip, the
 * minimised chip and two popovers, so "0/0 actions · 0%" was what the user
 * saw for real, populated plans.
 *
 * F13 fixed the ONE surface that contradicted itself most visibly (the V2
 * toolbar, by deriving from the live item tree) and left the stale field
 * feeding everything else. Fixing it here fixes all of them, because they
 * all read this.
 *
 * Legacy plans really do have `tasks` rows and no items, so those still
 * count — `plan_items` wins when a plan has any, otherwise `tasks` does.
 * Summing both would double-count anything that was ever migrated.
 */
function countPlanActions(db: ReturnType<typeof getDb>, planUid: string): {
  taskCount: number;
  completedTaskCount: number;
} {
  const items = db.exec(
    `SELECT COUNT(*), SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)
     FROM plan_items WHERE plan_uid = ? AND kind = 'action'`,
    [planUid],
  );
  const itemTotal = (items[0]?.values[0]?.[0] as number) || 0;
  if (itemTotal > 0) {
    return { taskCount: itemTotal, completedTaskCount: (items[0]?.values[0]?.[1] as number) || 0 };
  }

  const legacy = db.exec(
    `SELECT COUNT(*), SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) FROM tasks WHERE plan_uid = ?`,
    [planUid],
  );
  return {
    taskCount: (legacy[0]?.values[0]?.[0] as number) || 0,
    completedTaskCount: (legacy[0]?.values[0]?.[1] as number) || 0,
  };
}

export function listPlans(projectPath?: string, statusFilter?: string): Plan[] {
  const db = getDb();
  let query = `SELECT ${PLAN_COLUMNS} FROM plans WHERE status != 'archived'`;
  const params: string[] = [];

  if (projectPath) { query += ` AND project_path = ?`; params.push(normalizePath(projectPath)); }
  if (statusFilter) { query += ` AND status = ?`; params.push(statusFilter); }
  query += ` ORDER BY updated_at DESC`;

  const result = db.exec(query, params);
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => {
    const core = rowToPlanCore(r);
    return { ...core, ...countPlanActions(db, r[0] as string) };
  });
}

export function updatePlan(
  planUid: string,
  changes: Partial<Pick<Plan,
    'title' | 'description' | 'status'
    | 'baseRef' | 'targetBranch' | 'targetWorktree' | 'autoCreateBranch'
  >>,
  author: string,
): void {
  const db = getDb();
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (changes.title !== undefined) { sets.push('title = ?'); params.push(changes.title); }
  if (changes.description !== undefined) { sets.push('description = ?'); params.push(changes.description); }
  if (changes.status !== undefined) { sets.push('status = ?'); params.push(changes.status); }
  // Phase 15 §15.D — git context. `null` clears, value sets, missing
  // leaves untouched. autoCreateBranch is stored as 0/1 INTEGER.
  if (changes.baseRef !== undefined) { sets.push('base_ref = ?'); params.push(changes.baseRef); }
  if (changes.targetBranch !== undefined) { sets.push('target_branch = ?'); params.push(changes.targetBranch); }
  if (changes.targetWorktree !== undefined) { sets.push('target_worktree = ?'); params.push(changes.targetWorktree); }
  if (changes.autoCreateBranch !== undefined) { sets.push('auto_create_branch = ?'); params.push(changes.autoCreateBranch ? 1 : 0); }

  params.push(planUid);
  db.run(`UPDATE plans SET ${sets.join(', ')} WHERE uid = ?`, params);

  // New version
  const plan = getPlan(planUid);
  if (plan) {
    const vr = db.exec(`SELECT MAX(version) FROM plan_versions WHERE plan_uid = ?`, [planUid]);
    const nextVersion = ((vr[0]?.values[0]?.[0] as number) || 0) + 1;
    db.run(
      `INSERT INTO plan_versions (plan_uid, version, snapshot, change_summary, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [planUid, nextVersion, JSON.stringify(plan), Object.keys(changes).join(', ') + ' updated', author, now]
    );
  }
  markDirty();
  notifyMutation(planUid);
}

export function deletePlan(planUid: string): void {
  getDb().run(`UPDATE plans SET status = 'archived', updated_at = ? WHERE uid = ?`, [Date.now(), planUid]);
  markDirty();
  notifyMutation(planUid);
}

// ---------- Phase 3.3: cross-repo plan scope ----------
//
// `homeRepo` is the canonical owner of the plan (origin URL of the
// repo where the plan was created — set on createPlan). `scope` is the
// list of *other* repo origin URLs that participate in the plan; each
// scoped repo will receive a thin pointer file (see
// external-pointer-service) so the plan is discoverable across the
// repos that need to coordinate on it.
//
// Both fields normalise their inputs (lowercase host, no .git suffix)
// via `normaliseRepoUrl` so cross-machine cloning of the same repo
// resolves to the same identity regardless of which URL form a
// developer used.

/**
 * Replace the plan's `homeRepo`. Pass `null` to clear it (rare —
 * mostly useful when a plan is created outside any git repo and then
 * later imported into one). Stores the normalised form.
 */
export function setPlanHomeRepo(planUid: string, homeRepoUrl: string | null): void {
  const { normaliseRepoUrl } = _lazy___git_identity;
  const normalised = homeRepoUrl ? normaliseRepoUrl(homeRepoUrl) : null;
  const now = Date.now();
  getDb().run(
    `UPDATE plans SET home_repo = ?, updated_at = ? WHERE uid = ?`,
    [normalised, now, planUid],
  );
  markDirty();
  notifyMutation(planUid);
}

/**
 * Add a repo (by origin URL) to the plan's scope. No-op if it's
 * already in scope or matches the plan's own homeRepo (the home is
 * implicitly scoped — no point listing it twice). Returns the updated
 * scope array.
 */
export function addPlanScope(planUid: string, repoUrl: string): string[] {
  const { normaliseRepoUrl } = _lazy___git_identity;
  const normalised: string = normaliseRepoUrl(repoUrl);
  if (!normalised) throw new Error('addPlanScope: repoUrl must be a non-empty URL');

  const plan = getPlan(planUid);
  if (!plan) throw new Error(`Plan ${planUid} not found`);
  if (plan.homeRepo && normalised === plan.homeRepo) {
    return plan.scope ?? [];
  }

  const current = plan.scope ?? [];
  if (current.includes(normalised)) return current;

  const next = [...current, normalised];
  const now = Date.now();
  getDb().run(
    `UPDATE plans SET scope = ?, updated_at = ? WHERE uid = ?`,
    [JSON.stringify(next), now, planUid],
  );
  markDirty();
  notifyMutation(planUid);
  return next;
}

/**
 * Remove a repo from the plan's scope. No-op when the repo is not in
 * scope. Returns the updated scope array.
 */
export function removePlanScope(planUid: string, repoUrl: string): string[] {
  const { normaliseRepoUrl } = _lazy___git_identity;
  const normalised: string = normaliseRepoUrl(repoUrl);
  if (!normalised) throw new Error('removePlanScope: repoUrl must be a non-empty URL');

  const plan = getPlan(planUid);
  if (!plan) throw new Error(`Plan ${planUid} not found`);

  const current = plan.scope ?? [];
  if (!current.includes(normalised)) return current;

  const next = current.filter((r) => r !== normalised);
  const now = Date.now();
  getDb().run(
    `UPDATE plans SET scope = ?, updated_at = ? WHERE uid = ?`,
    [JSON.stringify(next), now, planUid],
  );
  markDirty();
  notifyMutation(planUid);
  return next;
}

/**
 * Return all plans whose `homeRepo` or `scope` contains the given
 * (normalised) origin URL. Used to discover which plans "belong" to a
 * given repo when stitching across multi-repo workspaces.
 *
 * Pure read; doesn't materialise full task lists for performance.
 */
export function listPlansByRepoUrl(repoUrl: string): Plan[] {
  const { normaliseRepoUrl } = _lazy___git_identity;
  const normalised: string = normaliseRepoUrl(repoUrl);
  if (!normalised) return [];

  const db = getDb();
  // Match on home_repo exactly OR scope JSON containing the URL as a
  // standalone string. sql.js doesn't have JSON1 reliably, so we
  // string-match on the serialised form. Strings are bracketed by
  // double-quotes, eliminating false positives like a URL that's a
  // prefix of another.
  const result = db.exec(
    `SELECT ${PLAN_COLUMNS} FROM plans
     WHERE status != 'archived'
       AND (home_repo = ? OR scope LIKE ?)
     ORDER BY updated_at DESC`,
    [normalised, `%"${normalised}"%`],
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => {
    const core = rowToPlanCore(r);
    return { ...core, ...countPlanActions(db, r[0] as string) };
  });
}

/**
 * Common SELECT-list for tasks. Centralised so getTasksByPlan,
 * getTaskByUid, getSubtasks all read the same column order — adding a
 * column means updating one place.
 */
const TASK_COLUMNS = `uid, plan_uid, sort_order, description, status, assignee, assignee_type, assignee_model,
            affected_files, affected_symbols, new_connections, removed_connections, dependencies,
            file_spec, symbol_specs, phase_uid,
            parent_task_uid, body, prompt, scope_path, file_specs,
            progress_percent, blocked_reason,
            created_at, updated_at`;

function rowToTask(r: any[]): Task {
  return {
    uid: r[0], planUid: r[1], sortOrder: r[2], description: r[3],
    status: r[4] as Task['status'], assignee: r[5], assigneeType: r[6], assigneeModel: r[7],
    affectedFiles: JSON.parse(r[8] || '[]'), affectedSymbols: JSON.parse(r[9] || '[]'),
    newConnections: JSON.parse(r[10] || '[]'), removedConnections: JSON.parse(r[11] || '[]'),
    dependencies: JSON.parse(r[12] || '[]'),
    fileSpec: (r[13] as string | null) ?? undefined,
    symbolSpecs: JSON.parse(r[14] || '[]'),
    phaseUid: (r[15] as string | null) ?? null,
    parentTaskUid: (r[16] as string | null) ?? null,
    body: (r[17] as string | null) ?? undefined,
    prompt: (r[18] as string | null) ?? undefined,
    scopePath: (r[19] as string | null) ?? null,
    fileSpecs: JSON.parse(r[20] || '[]'),
    progressPercent: (r[21] as number | null) ?? null,
    blockedReason: (r[22] as string | null) ?? null,
    createdAt: r[23], updatedAt: r[24],
  };
}

export function getTasksByPlan(planUid: string): Task[] {
  const result = getDb().exec(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE plan_uid = ? ORDER BY sort_order`,
    [planUid]
  );
  if (!result[0]) return [];
  return result[0].values.map(rowToTask);
}

/**
 * Phase 14 §A — fetch direct children of a task (subtasks). Returns
 * an empty array when none exist. Ordered by `sort_order`.
 */
export function getSubtasks(parentTaskUid: string): Task[] {
  const result = getDb().exec(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE parent_task_uid = ? ORDER BY sort_order`,
    [parentTaskUid],
  );
  if (!result[0]) return [];
  return result[0].values.map(rowToTask);
}

export function updateTask(
  taskUid: string,
  updates: Partial<Pick<Task,
    'status' | 'assignee' | 'assigneeType' | 'assigneeModel' | 'description'
    | 'affectedFiles' | 'affectedSymbols' | 'newConnections' | 'removedConnections'
    | 'dependencies' | 'fileSpec' | 'symbolSpecs' | 'phaseUid'
    | 'parentTaskUid' | 'body' | 'prompt' | 'scopePath' | 'fileSpecs'
    | 'progressPercent' | 'blockedReason'
  >>,
): void {
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.assignee !== undefined) { sets.push('assignee = ?'); params.push(updates.assignee); }
  if (updates.assigneeType !== undefined) { sets.push('assignee_type = ?'); params.push(updates.assigneeType); }
  if (updates.assigneeModel !== undefined) { sets.push('assignee_model = ?'); params.push(updates.assigneeModel); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
  if (updates.affectedSymbols !== undefined) { sets.push('affected_symbols = ?'); params.push(JSON.stringify(updates.affectedSymbols)); }
  if (updates.newConnections !== undefined) { sets.push('new_connections = ?'); params.push(JSON.stringify(updates.newConnections)); }
  if (updates.removedConnections !== undefined) { sets.push('removed_connections = ?'); params.push(JSON.stringify(updates.removedConnections)); }
  if (updates.dependencies !== undefined) { sets.push('dependencies = ?'); params.push(JSON.stringify(updates.dependencies)); }
  if (updates.fileSpec !== undefined) { sets.push('file_spec = ?'); params.push(updates.fileSpec); }
  if (updates.symbolSpecs !== undefined) { sets.push('symbol_specs = ?'); params.push(JSON.stringify(updates.symbolSpecs)); }
  if (updates.phaseUid !== undefined) { sets.push('phase_uid = ?'); params.push(updates.phaseUid); }
  if (updates.parentTaskUid !== undefined) { sets.push('parent_task_uid = ?'); params.push(updates.parentTaskUid); }
  if (updates.body !== undefined) { sets.push('body = ?'); params.push(updates.body); }
  if (updates.prompt !== undefined) { sets.push('prompt = ?'); params.push(updates.prompt); }
  if (updates.scopePath !== undefined) { sets.push('scope_path = ?'); params.push(updates.scopePath); }
  if (updates.progressPercent !== undefined) { sets.push('progress_percent = ?'); params.push(updates.progressPercent); }
  if (updates.blockedReason !== undefined) { sets.push('blocked_reason = ?'); params.push(updates.blockedReason); }

  // `affectedFiles` is now a derived view of `fileSpecs`. If the caller
  // supplies fileSpecs we recompute affected_files from them (merging
  // with anything also passed via affectedFiles directly). If only
  // affectedFiles is supplied, store it as-is for back-compat.
  if (updates.fileSpecs !== undefined) {
    const merged = deriveAffectedFiles(updates.fileSpecs, updates.affectedFiles);
    sets.push('file_specs = ?'); params.push(JSON.stringify(updates.fileSpecs));
    sets.push('affected_files = ?'); params.push(JSON.stringify(merged));
  } else if (updates.affectedFiles !== undefined) {
    sets.push('affected_files = ?'); params.push(JSON.stringify(updates.affectedFiles));
  }

  params.push(taskUid);
  getDb().run(`UPDATE tasks SET ${sets.join(', ')} WHERE uid = ?`, params);
  markDirty();
  // Look up the parent plan so the auto-sync layer can pick the right
  // directory. Cheap (one-row by-uid query).
  const parent = getDb().exec(`SELECT plan_uid FROM tasks WHERE uid = ?`, [taskUid]);
  const planUid = parent[0]?.values[0]?.[0] as string | undefined;
  if (planUid) notifyMutation(planUid);
}

/**
 * Append a code reference (file path + optional line range + optional note) to
 * a task. Adds the file to affectedFiles (deduped) and appends a markdown
 * snippet to fileSpec describing the reference. Used by the inspector's
 * "Add to task" action.
 */
export function appendTaskCodeReference(taskUid: string, ref: {
  filePath: string;          // path relative to project, or absolute
  startLine?: number;
  endLine?: number;
  note?: string;
  codeSnippet?: string;
}): Task | null {
  const db = getDb();
  const result = db.exec(
    `SELECT affected_files, file_spec FROM tasks WHERE uid = ?`,
    [taskUid],
  );
  if (!result[0]?.values[0]) return null;

  const [filesJson, currentSpec] = result[0].values[0] as [string, string | null];
  const existingFiles: string[] = JSON.parse((filesJson as string) || '[]');
  const nextFiles = existingFiles.includes(ref.filePath)
    ? existingFiles
    : [...existingFiles, ref.filePath];

  const range = ref.startLine != null && ref.endLine != null
    ? `${ref.filePath}:${ref.startLine}-${ref.endLine}`
    : ref.filePath;
  const lines: string[] = [];
  lines.push('');
  lines.push(`### Reference: \`${range}\``);
  if (ref.note?.trim()) {
    lines.push('');
    lines.push(ref.note.trim());
  }
  if (ref.codeSnippet?.trim()) {
    lines.push('');
    lines.push('```');
    lines.push(ref.codeSnippet.replace(/```/g, '`​``'));
    lines.push('```');
  }
  const appended = (currentSpec || '') + lines.join('\n');

  updateTask(taskUid, { affectedFiles: nextFiles, fileSpec: appended });

  return getTaskByUid(taskUid);
}

export function getTaskByUid(taskUid: string): Task | null {
  const result = getDb().exec(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE uid = ?`,
    [taskUid],
  );
  if (!result[0]?.values[0]) return null;
  return rowToTask(result[0].values[0] as any[]);
}

/**
 * Append a task to a plan and optionally seed it with a code reference. The
 * task gets appended to the end of the existing task list.
 *
 * Accepts the Phase 14 §A task-as-context fields too — pass `body`,
 * `prompt`, `scopePath`, `fileSpecs`, or `parentTaskUid` to seed the
 * full shape. `affectedFiles` is derived from `fileSpecs` (deduped).
 */
export function appendTaskToPlan(planUid: string, input: {
  description: string;
  affectedFiles?: string[];
  fileSpec?: string;
  affectedSymbols?: string[];
  body?: string;
  prompt?: string;
  scopePath?: string | null;
  fileSpecs?: FileSpec[];
  parentTaskUid?: string | null;
}): Task | null {
  const db = getDb();
  const planExists = db.exec(`SELECT uid FROM plans WHERE uid = ?`, [planUid]);
  if (!planExists[0]?.values[0]) return null;

  const orderResult = db.exec(`SELECT COALESCE(MAX(sort_order), -1) FROM tasks WHERE plan_uid = ?`, [planUid]);
  const nextOrder = ((orderResult[0]?.values[0]?.[0] as number) ?? -1) + 1;
  const taskUid = randomUUID();
  const now = Date.now();

  const fileSpecs = input.fileSpecs ?? [];
  const affectedFiles = deriveAffectedFiles(fileSpecs, input.affectedFiles);

  db.run(
    `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, affected_files, affected_symbols, new_connections, removed_connections, dependencies, file_spec, symbol_specs, parent_task_uid, body, prompt, scope_path, file_specs, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, '[]', '[]', '[]', ?, '[]', ?, ?, ?, ?, ?, ?, ?)`,
    [taskUid, planUid, nextOrder, input.description,
      JSON.stringify(affectedFiles),
      JSON.stringify(input.affectedSymbols || []),
      input.fileSpec ?? null,
      input.parentTaskUid ?? null,
      input.body ?? null, input.prompt ?? null,
      input.scopePath ?? null, JSON.stringify(fileSpecs),
      now, now],
  );

  markDirty();
  notifyMutation(planUid);
  return getTaskByUid(taskUid);
}

export function claimTask(taskUid: string, agentId: string, agentType: string, model?: string): { ok: boolean; conflicts?: string[] } {
  const result = getDb().exec(`SELECT status, assignee, plan_uid, affected_files FROM tasks WHERE uid = ?`, [taskUid]);
  if (!result[0]?.values[0]) return { ok: false };
  const [status, assignee, planUid, affectedFilesJson] = result[0].values[0];
  if (assignee || status !== 'pending') return { ok: false };

  // Check for conflicts — are any other in-progress tasks touching the same files?
  const affectedFiles: string[] = JSON.parse((affectedFilesJson as string) || '[]');
  const conflicts: string[] = [];

  if (affectedFiles.length > 0) {
    const otherTasks = getTasksByPlan(planUid as string);
    for (const other of otherTasks) {
      if (other.uid === taskUid) continue;
      if (other.status !== 'in_progress' && other.status !== 'assigned') continue;
      if (other.assignee === agentId) continue; // Same agent, no conflict

      const overlap = other.affectedFiles.filter((f) => affectedFiles.includes(f));
      if (overlap.length > 0) {
        conflicts.push(`Task "${other.description}" (${other.assignee}) also affects: ${overlap.join(', ')}`);
      }
    }
  }

  updateTask(taskUid, { status: 'assigned', assignee: agentId, assigneeType: agentType, assigneeModel: model || null });
  return { ok: true, conflicts: conflicts.length > 0 ? conflicts : undefined };
}

/**
 * The next thing to work on: the first pending item whose dependencies
 * are all done.
 *
 * **This reads `plan_items` first and `tasks` only as a fallback.**
 * Those are two separate tables with two separate writers — `tasks` is
 * V1, `plan_items` is the V2 model the workspace has written since
 * Phase 15 — and this function used to read only `tasks`. Which meant
 * it returned "nothing next" for every plan authored in the current
 * UI, because such a plan has no rows in `tasks` at all. Nothing
 * noticed, because nothing called it: no MCP tool exposes it and
 * neither client called the REST route (Phase 29 §4.14). It was
 * answering the right question against the wrong table.
 *
 * A V1 plan keeps its old answer exactly — the fallback runs only when
 * the plan has no V2 items.
 */
export function getNextTask(planUid: string, phaseUid?: string | null): Task | PlanItem | null {
  const items = planItemService.listAllItems(planUid);
  if (items.length > 0) return nextPlanItem(items, phaseUid);

  const tasks = getTasksByPlan(planUid);
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.uid));

  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    if (phaseUid !== undefined && task.phaseUid !== phaseUid) continue;
    if (task.dependencies.every((d) => done.has(d))) return task;
  }
  return null;
}

/**
 * V2 selection. Objects carry no status, so only Actions are
 * candidates. `listAllItems` is already ordered by sortOrder, which is
 * the order the tree renders — so "first ready" here means the same
 * thing the user sees top-to-bottom.
 *
 * `phaseUid` has no V2 equivalent: phases became ordinary parent items.
 * Passing one filters by parent instead, which is the same intent in
 * the new model.
 */
function nextPlanItem(items: PlanItem[], parentUid?: string | null): PlanItem | null {
  const done = new Set(
    items.filter((i) => i.status === 'done' || i.status === 'skipped').map((i) => i.uid),
  );

  for (const item of items) {
    if (item.kind !== 'action') continue;
    if (item.status !== 'pending') continue;
    if (parentUid !== undefined && item.parentUid !== parentUid) continue;
    if ((item.dependencies ?? []).every((d) => done.has(d))) return item;
  }
  return null;
}

export function getPlanVersions(planUid: string): PlanVersion[] {
  const result = getDb().exec(
    `SELECT id, plan_uid, version, snapshot, change_summary, author, created_at
     FROM plan_versions WHERE plan_uid = ? ORDER BY version DESC`,
    [planUid]
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    id: r[0], planUid: r[1], version: r[2], snapshot: r[3],
    changeSummary: r[4], author: r[5], createdAt: r[6],
  }));
}
