import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { PlanPhase, PhaseStatus } from '../../shared/types';

/** Phase 13 §B auto-sync hook — see plan-service for the rationale. */
function notifyMutation(planUid: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { scheduleWriteThrough } = require('./plan-file-service');
    scheduleWriteThrough(planUid);
  } catch { /* fine */ }
}

/**
 * Plan phases — first-class checkpoints within a plan, modelled on the
 * swf `01-PHASE-1-FOUNDATION.md / 02-PHASE-2-…` shape.
 *
 * A plan can have zero phases (light plan, current behaviour) or N
 * phases. Tasks may carry an optional `phaseUid` to bind them to a
 * phase. This file owns the CRUD; task ↔ phase wiring lives in
 * plan-service so the existing task code stays in one place.
 */

export interface CreatePhaseInput {
  planUid: string;
  phaseNumber?: number;          // omit to auto-pick next
  title: string;
  scope?: string;
  prerequisites?: string;
  gitCheckpoint?: string | null;
  acceptanceCriteria?: string;
  status?: PhaseStatus;
}

export interface UpdatePhaseInput {
  phaseNumber?: number;
  title?: string;
  scope?: string;
  prerequisites?: string;
  gitCheckpoint?: string | null;
  acceptanceCriteria?: string;
  status?: PhaseStatus;
}

export function createPhase(input: CreatePhaseInput): PlanPhase {
  const db = getDb();
  const uid = randomUUID();
  const now = Date.now();

  // Auto-assign next phase_number if caller didn't pass one.
  let phaseNumber = input.phaseNumber;
  if (phaseNumber == null) {
    const r = db.exec(
      `SELECT COALESCE(MAX(phase_number), 0) + 1 FROM plan_phases WHERE plan_uid = ?`,
      [input.planUid],
    );
    phaseNumber = (r[0]?.values[0]?.[0] as number) ?? 1;
  }

  const status: PhaseStatus = input.status ?? 'pending';

  db.run(
    `INSERT INTO plan_phases (uid, plan_uid, phase_number, title, scope, prerequisites, git_checkpoint, acceptance_criteria, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      input.planUid,
      phaseNumber,
      input.title,
      input.scope ?? '',
      input.prerequisites ?? '',
      input.gitCheckpoint ?? null,
      input.acceptanceCriteria ?? '',
      status,
      now,
      now,
    ],
  );

  markDirty();
  notifyMutation(input.planUid);
  return {
    uid,
    planUid: input.planUid,
    phaseNumber,
    title: input.title,
    scope: input.scope ?? '',
    prerequisites: input.prerequisites ?? '',
    gitCheckpoint: input.gitCheckpoint ?? null,
    acceptanceCriteria: input.acceptanceCriteria ?? '',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

export function getPhase(uid: string): PlanPhase | null {
  const r = getDb().exec(
    `SELECT uid, plan_uid, phase_number, title, scope, prerequisites, git_checkpoint, acceptance_criteria, status, created_at, updated_at
     FROM plan_phases WHERE uid = ?`,
    [uid],
  );
  if (!r[0]?.values[0]) return null;
  return rowToPhase(r[0].values[0]);
}

export function listPhases(planUid: string): PlanPhase[] {
  const r = getDb().exec(
    `SELECT uid, plan_uid, phase_number, title, scope, prerequisites, git_checkpoint, acceptance_criteria, status, created_at, updated_at
     FROM plan_phases WHERE plan_uid = ? ORDER BY phase_number ASC, created_at ASC`,
    [planUid],
  );
  if (!r[0]) return [];
  return r[0].values.map(rowToPhase);
}

export function updatePhase(uid: string, updates: UpdatePhaseInput): PlanPhase | null {
  const existing = getPhase(uid);
  if (!existing) return null;

  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (updates.phaseNumber !== undefined) { sets.push('phase_number = ?'); params.push(updates.phaseNumber); }
  if (updates.title !== undefined) { sets.push('title = ?'); params.push(updates.title); }
  if (updates.scope !== undefined) { sets.push('scope = ?'); params.push(updates.scope); }
  if (updates.prerequisites !== undefined) { sets.push('prerequisites = ?'); params.push(updates.prerequisites); }
  if (updates.gitCheckpoint !== undefined) { sets.push('git_checkpoint = ?'); params.push(updates.gitCheckpoint); }
  if (updates.acceptanceCriteria !== undefined) { sets.push('acceptance_criteria = ?'); params.push(updates.acceptanceCriteria); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }

  params.push(uid);
  getDb().run(`UPDATE plan_phases SET ${sets.join(', ')} WHERE uid = ?`, params);

  markDirty();
  if (existing) notifyMutation(existing.planUid);
  return getPhase(uid);
}

export function deletePhase(uid: string): void {
  const db = getDb();
  // Capture parent plan before delete so we can notify auto-sync.
  const before = getPhase(uid);
  // Detach any tasks pointing at this phase so they don't dangle.
  db.run(`UPDATE tasks SET phase_uid = NULL WHERE phase_uid = ?`, [uid]);
  db.run(`DELETE FROM plan_phases WHERE uid = ?`, [uid]);
  markDirty();
  if (before) notifyMutation(before.planUid);
}

function rowToPhase(r: any[]): PlanPhase {
  return {
    uid: r[0] as string,
    planUid: r[1] as string,
    phaseNumber: r[2] as number,
    title: r[3] as string,
    scope: r[4] as string,
    prerequisites: r[5] as string,
    gitCheckpoint: (r[6] as string | null) ?? null,
    acceptanceCriteria: r[7] as string,
    status: r[8] as PhaseStatus,
    createdAt: r[9] as number,
    updatedAt: r[10] as number,
  };
}
