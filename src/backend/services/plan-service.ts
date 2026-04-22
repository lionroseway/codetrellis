import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { Plan, Task, PlanVersion, CreatePlanInput, PlanStatus } from '../../shared/types';

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
    db.run(
      `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, affected_files, affected_symbols, new_connections, removed_connections, dependencies, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      [taskUid, uid, i, t.description,
        JSON.stringify(t.affectedFiles || []), JSON.stringify(t.affectedSymbols || []),
        JSON.stringify(t.newConnections || []), JSON.stringify(t.removedConnections || []),
        JSON.stringify(t.dependencies || []), now, now]
    );
    tasks.push({
      uid: taskUid, planUid: uid, sortOrder: i, description: t.description,
      status: 'pending', assignee: null, assigneeType: null, assigneeModel: null,
      affectedFiles: t.affectedFiles || [], affectedSymbols: t.affectedSymbols || [],
      newConnections: t.newConnections || [], removedConnections: t.removedConnections || [],
      dependencies: t.dependencies || [], createdAt: now, updatedAt: now,
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
  return plan;
}

export function getPlan(planUid: string): (Plan & { tasks: Task[] }) | null {
  const db = getDb();
  const result = db.exec(
    `SELECT uid, title, description, status, author, author_type, project_path, created_at, updated_at FROM plans WHERE uid = ?`,
    [planUid]
  );
  if (!result[0]?.values[0]) return null;
  const r = result[0].values[0];

  const tasks = getTasksByPlan(planUid);
  return {
    uid: r[0] as string, title: r[1] as string, description: r[2] as string,
    status: r[3] as PlanStatus, author: r[4] as string, authorType: r[5] as string,
    projectPath: r[6] as string, createdAt: r[7] as number, updatedAt: r[8] as number,
    taskCount: tasks.length, completedTaskCount: tasks.filter((t) => t.status === 'done').length,
    tasks,
  };
}

export function listPlans(projectPath?: string, statusFilter?: string): Plan[] {
  const db = getDb();
  let query = `SELECT uid, title, description, status, author, author_type, project_path, created_at, updated_at FROM plans WHERE status != 'archived'`;
  const params: string[] = [];

  if (projectPath) { query += ` AND project_path = ?`; params.push(projectPath); }
  if (statusFilter) { query += ` AND status = ?`; params.push(statusFilter); }
  query += ` ORDER BY updated_at DESC`;

  const result = db.exec(query, params);
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => {
    const counts = db.exec(
      `SELECT COUNT(*), SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) FROM tasks WHERE plan_uid = ?`,
      [r[0]]
    );
    return {
      uid: r[0], title: r[1], description: r[2], status: r[3] as PlanStatus,
      author: r[4], authorType: r[5], projectPath: r[6],
      createdAt: r[7], updatedAt: r[8],
      taskCount: (counts[0]?.values[0]?.[0] as number) || 0,
      completedTaskCount: (counts[0]?.values[0]?.[1] as number) || 0,
    };
  });
}

export function updatePlan(planUid: string, changes: Partial<Pick<Plan, 'title' | 'description' | 'status'>>, author: string): void {
  const db = getDb();
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (changes.title !== undefined) { sets.push('title = ?'); params.push(changes.title); }
  if (changes.description !== undefined) { sets.push('description = ?'); params.push(changes.description); }
  if (changes.status !== undefined) { sets.push('status = ?'); params.push(changes.status); }

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
}

export function deletePlan(planUid: string): void {
  getDb().run(`UPDATE plans SET status = 'archived', updated_at = ? WHERE uid = ?`, [Date.now(), planUid]);
  markDirty();
}

export function getTasksByPlan(planUid: string): Task[] {
  const result = getDb().exec(
    `SELECT uid, plan_uid, sort_order, description, status, assignee, assignee_type, assignee_model,
            affected_files, affected_symbols, new_connections, removed_connections, dependencies, created_at, updated_at
     FROM tasks WHERE plan_uid = ? ORDER BY sort_order`,
    [planUid]
  );
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    uid: r[0], planUid: r[1], sortOrder: r[2], description: r[3],
    status: r[4] as Task['status'], assignee: r[5], assigneeType: r[6], assigneeModel: r[7],
    affectedFiles: JSON.parse(r[8] || '[]'), affectedSymbols: JSON.parse(r[9] || '[]'),
    newConnections: JSON.parse(r[10] || '[]'), removedConnections: JSON.parse(r[11] || '[]'),
    dependencies: JSON.parse(r[12] || '[]'), createdAt: r[13], updatedAt: r[14],
  }));
}

export function updateTask(taskUid: string, updates: Partial<Pick<Task, 'status' | 'assignee' | 'assigneeType' | 'assigneeModel' | 'description'>>): void {
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.assignee !== undefined) { sets.push('assignee = ?'); params.push(updates.assignee); }
  if (updates.assigneeType !== undefined) { sets.push('assignee_type = ?'); params.push(updates.assigneeType); }
  if (updates.assigneeModel !== undefined) { sets.push('assignee_model = ?'); params.push(updates.assigneeModel); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }

  params.push(taskUid);
  getDb().run(`UPDATE tasks SET ${sets.join(', ')} WHERE uid = ?`, params);
  markDirty();
}

export function claimTask(taskUid: string, agentId: string, agentType: string, model?: string): boolean {
  const result = getDb().exec(`SELECT status, assignee FROM tasks WHERE uid = ?`, [taskUid]);
  if (!result[0]?.values[0]) return false;
  const [status, assignee] = result[0].values[0];
  if (assignee || status !== 'pending') return false;

  updateTask(taskUid, { status: 'assigned', assignee: agentId, assigneeType: agentType, assigneeModel: model || null });
  return true;
}

export function getNextTask(planUid: string): Task | null {
  const tasks = getTasksByPlan(planUid);
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.uid));

  for (const task of tasks) {
    if (task.status !== 'pending') continue;
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
