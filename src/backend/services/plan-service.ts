import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { Plan, Task, PlanVersion, CreatePlanInput, PlanStatus, FileSpec } from '../../shared/types';

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { scheduleWriteThrough } = require('./plan-file-service');
    scheduleWriteThrough(planUid);
  } catch { /* auto-sync not available — fine, manual export still works */ }
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

  db.run(
    `INSERT INTO plans (uid, title, description, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    [uid, input.title, input.description || '', author, authorType, projectPath, now, now]
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
  };

  // Version 1
  db.run(
    `INSERT INTO plan_versions (plan_uid, version, snapshot, change_summary, author, created_at)
     VALUES (?, 1, ?, 'Plan created', ?, ?)`,
    [uid, JSON.stringify({ plan, tasks }), author, now]
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
        base_ref, target_branch, target_worktree, auto_create_branch`;

function rowToPlanCore(r: any[]): Plan {
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
    taskCount: tasks.length,
    completedTaskCount: tasks.filter((t) => t.status === 'done').length,
    tasks,
  };
}

export function listPlans(projectPath?: string, statusFilter?: string): Plan[] {
  const db = getDb();
  let query = `SELECT ${PLAN_COLUMNS} FROM plans WHERE status != 'archived'`;
  const params: string[] = [];

  if (projectPath) { query += ` AND project_path = ?`; params.push(projectPath); }
  if (statusFilter) { query += ` AND status = ?`; params.push(statusFilter); }
  query += ` ORDER BY updated_at DESC`;

  const result = db.exec(query, params);
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => {
    const core = rowToPlanCore(r);
    const counts = db.exec(
      `SELECT COUNT(*), SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) FROM tasks WHERE plan_uid = ?`,
      [r[0]]
    );
    return {
      ...core,
      taskCount: (counts[0]?.values[0]?.[0] as number) || 0,
      completedTaskCount: (counts[0]?.values[0]?.[1] as number) || 0,
    };
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

export function getNextTask(planUid: string, phaseUid?: string | null): Task | null {
  const tasks = getTasksByPlan(planUid);
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.uid));

  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    if (phaseUid !== undefined && task.phaseUid !== phaseUid) continue;
    if (task.dependencies.every((d) => done.has(d))) return task;
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
