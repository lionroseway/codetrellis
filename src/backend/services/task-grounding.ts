/**
 * How far a task's criteria rest on evidence (Phase 32 B8.3b): each
 * criterion graded once, the line built from the grades
 * (`shared/lib/grounding-line.ts`). The window, the phone and `get_brief`
 * ask here, so they never disagree.
 *
 * A criterion's checks are the criterion loop's own (§8.1), run on its latest
 * submission and the task's recorded files, recording nothing.
 */

import { listCriteria } from './criteria-service';
import { checkCriterion } from './criterion-loop-service';
import { getItem } from './plan-item-service';
import { groundingLine, type CriterionGrade, type GroundingLine } from '../../shared/lib/grounding-line';
import type { ItemCriterion } from '../../shared/types';

export interface GradedCriterion { uid: string; text: string; grade: CriterionGrade; why: string }
export interface TaskGrounding extends GroundingLine { itemUid: string; criteria: GradedCriterion[] }

type Check = { ok: boolean; findings: Array<{ status: string; message: string }> };

/** One criterion's grade, from its state and its checks. Pure; exported for the unit tests. */
export function gradeCriterion(c: Pick<ItemCriterion, 'kind' | 'policy' | 'state'> & { submitted: boolean }, check: Check | null): { grade: CriterionGrade; why: string } {
  if (c.state === 'stale') return { grade: 'changed', why: 'a file it was approved on has changed since' };
  if (c.state === 'sent_back') return { grade: 'sent_back', why: 'a person sent it back' };
  const failures = check ? check.findings.filter((f) => f.status === 'fail').map((f) => f.message) : [];
  if (check && !check.ok) {
    if (!c.submitted && c.state === 'open') return { grade: 'no_evidence', why: failures[0] ?? 'nothing offered yet' };
    return { grade: 'failing', why: failures[0] ?? 'its checks fail' };
  }
  if (c.state === 'met') return { grade: 'grounded', why: 'met, and its checks still pass' };
  // A judgement has no mechanical check: only a person can ground it.
  if (c.kind === 'manual') return { grade: 'waiting', why: c.submitted ? 'submitted; only a person can judge it' : 'only a person can judge it' };
  if (c.state === 'submitted') return { grade: 'waiting', why: 'its checks pass; a person decides' };
  return { grade: 'grounded', why: 'its checks pass on the evidence there' };
}

export async function taskGrounding(itemUid: string): Promise<TaskGrounding | null> {
  if (!getItem(itemUid)) return null;
  const graded: GradedCriterion[] = [];
  for (const c of listCriteria(itemUid)) {
    const check = await checkCriterion(c.uid).catch(() => null);
    const { grade, why } = gradeCriterion({ ...c, submitted: (c.latestSubmission?.length ?? 0) > 0 }, check);
    graded.push({ uid: c.uid, text: c.text, grade, why });
  }
  return { itemUid, ...groundingLine(graded.map((g) => g.grade)), criteria: graded };
}
