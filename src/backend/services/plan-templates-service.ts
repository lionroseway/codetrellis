/**
 * Apply a plan template — turns a `PlanTemplate` into real DB rows
 * (plan + phases + tasks + spec docs). Wires `parentDocUid` from the
 * template's `parentKey` references after the docs are created.
 *
 * Single transactional sweep at the service layer: if any step fails
 * the caller gets the partial state. Good enough for the desktop /
 * single-user case; if we ever need true atomicity we can wrap in a
 * SAVEPOINT.
 */

import type { Plan, PlanDocument, PlanPhase, Task } from '../../shared/types';
import { createPlan } from './plan-service';
import { createPhase } from './plan-phases-service';
import { createPlanDocument } from './plan-documents-service';
import { updateTask } from './plan-service';
import { getTasksByPlan } from './plan-service';
import { getTemplate } from './plan-templates';

export interface ApplyTemplateInput {
  templateId: string;
  projectPath: string;
  /** Replaces the template's `defaultTitle` if provided. */
  title?: string;
  /** Replaces the template's `defaultPlanDescription` if provided. */
  description?: string;
  author?: string;
  authorType?: string;
}

export interface ApplyTemplateResult {
  plan: Plan;
  phases: PlanPhase[];
  docs: PlanDocument[];
  tasks: Task[];
}

export function applyTemplate(input: ApplyTemplateInput): ApplyTemplateResult {
  const template = getTemplate(input.templateId);
  if (!template) {
    throw new Error(`Unknown plan template: ${input.templateId}`);
  }

  const author = input.author ?? 'human';
  const authorType = input.authorType ?? 'human';

  const title = (input.title ?? template.defaultTitle).replace('{name}', input.title ?? '');
  const description = input.description ?? template.defaultPlanDescription;

  // 1. Plan + skeleton tasks. createPlan needs `tasks` up front; we
  //    seed all phase tasks together with a `__phaseRef` we'll resolve
  //    once phases exist, so order_in_plan stays predictable.
  type SeedTask = { description: string; affectedFiles?: string[]; phaseRef: number };
  const seedTasks: SeedTask[] = [];
  for (const phase of template.phases) {
    for (const t of phase.tasks ?? []) {
      seedTasks.push({
        description: t.description,
        affectedFiles: t.affectedFiles ?? [],
        phaseRef: phase.phaseNumber,
      });
    }
  }

  const plan = createPlan(
    {
      title,
      description,
      tasks: seedTasks.map((t) => ({
        description: t.description,
        affectedFiles: t.affectedFiles,
      })),
    },
    author,
    authorType,
    input.projectPath,
  );

  // 2. Phases (in template order; createPhase auto-numbers if omitted,
  //    but we pass phase_number explicitly so the template author owns
  //    the numbering).
  const phases: PlanPhase[] = [];
  const phaseByNumber = new Map<number, PlanPhase>();
  for (const p of template.phases) {
    const created = createPhase({
      planUid: plan.uid,
      phaseNumber: p.phaseNumber,
      title: p.title,
      scope: p.scope,
      prerequisites: p.prerequisites,
      acceptanceCriteria: p.acceptanceCriteria,
      status: p.status ?? 'pending',
    });
    phases.push(created);
    phaseByNumber.set(p.phaseNumber, created);
  }

  // 3. Bind seed tasks to their phase. createPlan returned them in
  //    seedTasks order, so we can re-fetch + match by description +
  //    sort_order. (Description match is fine for the template path —
  //    seed tasks are deterministic per template.)
  const dbTasks = getTasksByPlan(plan.uid);
  for (let i = 0; i < seedTasks.length && i < dbTasks.length; i++) {
    const seed = seedTasks[i];
    const dbTask = dbTasks[i];
    const phase = phaseByNumber.get(seed.phaseRef);
    if (phase && dbTask) {
      updateTask(dbTask.uid, { phaseUid: phase.uid });
    }
  }

  // 4. Spec docs — create in template order so parentKey refs resolve.
  const docs: PlanDocument[] = [];
  const docByKey = new Map<string, PlanDocument>();
  for (const d of template.docs) {
    const parent = d.parentKey ? docByKey.get(d.parentKey) ?? null : null;
    const created = createPlanDocument({
      planUid: plan.uid,
      docType: d.docType,
      title: d.title,
      body: d.body,
      author,
      authorType,
      orderHint: d.orderHint ?? null,
      parentDocUid: parent?.uid ?? null,
    });
    docs.push(created);
    if (d.key) docByKey.set(d.key, created);
  }

  return {
    plan,
    phases,
    docs,
    tasks: getTasksByPlan(plan.uid),
  };
}
