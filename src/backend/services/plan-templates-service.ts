/**
 * Apply a plan template — turns a `PlanTemplate` into real DB rows.
 *
 * V2 templates (with `items` array): creates plan metadata + V2 items
 * via plan-item-service. No V1 phases/tasks/docs involved.
 *
 * V1 templates (with `phases` + `docs`): creates plan + phases + tasks
 * + spec docs via the legacy services. Kept for backward compat with
 * existing templates.
 */

import type { Plan, PlanDocument, PlanItem, PlanPhase, Task } from '../../shared/types';
import { createPlan, getPlan, updatePlan } from './plan-service';
import { createPhase } from './plan-phases-service';
import { createPlanDocument } from './plan-documents-service';
import { updateTask } from './plan-service';
import { getTasksByPlan } from './plan-service';
import * as planItemService from './plan-item-service';
import { migratePlan } from './plan-migrate-service';
import { getTemplate, substitutePlaceholders, type PlanTemplate } from './plan-templates';
import { seedTemplateCriteria } from './criteria-service';

export interface ApplyTemplateInput {
  templateId: string;
  projectPath: string;
  /** Replaces the template's `defaultTitle` if provided. */
  title?: string;
  /** Replaces the template's `defaultPlanDescription` if provided. */
  description?: string;
  author?: string;
  authorType?: string;
  /**
   * Phase 13 §C: values for the template's declared `placeholders`.
   * Substituted into every string field via `{{key}}` interpolation
   * before the plan + phases + docs are seeded. Missing keys fall
   * back to the placeholder's `default`, then to the literal
   * `{{key}}` if no default is set.
   */
  placeholderValues?: Record<string, string>;
}

export interface ApplyTemplateResult {
  plan: Plan;
  /** V1 legacy — empty for V2 templates. */
  phases: PlanPhase[];
  /** V1 legacy — empty for V2 templates. */
  docs: PlanDocument[];
  /** V1 legacy — empty for V2 templates. */
  tasks: Task[];
  /** V2 items created. Empty for V1 templates. */
  items: PlanItem[];
  /** Template format: 2 for V2, 1 for legacy. */
  version: 1 | 2;
}

export function applyTemplate(input: ApplyTemplateInput): ApplyTemplateResult {
  // Look up the template, including disk-installed ones at the
  // project's `.codetrellis/templates/` and `~/.codetrellis/templates/`.
  const template = resolveTemplate(input.templateId, input.projectPath, input.placeholderValues);

  const author = input.author ?? 'human';
  const authorType = input.authorType ?? 'human';

  // `defaultTitle` has already been through substitutePlaceholders, so its
  // `{{key}}` placeholders are filled. `{name}` is the older single-brace form
  // and is not, so it is replaced here — and when there is no title to put in
  // it, the leftover punctuation goes too, or the plan is called
  // "Mass refactor: " with nothing after the colon.
  const title = (input.title ?? template.defaultTitle)
    .replace('{name}', input.title ?? '')
    .replace(/[:\-–—]\s*$/, '')
    .trim();
  const description = input.description ?? template.defaultPlanDescription;

  // Detect V2 template format: has `items` array
  const templateAny = template as any;
  if (Array.isArray(templateAny.items) && templateAny.items.length > 0) {
    return applyV2Template(templateAny, title, description, author, authorType, input);
  }

  return applyV1Template(template, title, description, author, authorType, input);
}

/**
 * A template, found where the project keeps its own and the user keeps
 * theirs, with its `{{placeholders}}` filled: caller-provided values, then
 * each placeholder's default. Empty string is a valid value (explicitly
 * blank); only undefined falls through to the default.
 */
function resolveTemplate(
  templateId: string,
  projectPath: string,
  placeholderValues?: Record<string, string>,
): PlanTemplate {
  const rawTemplate = getTemplate(templateId, projectPath);
  if (!rawTemplate) throw new Error(`Unknown plan template: ${templateId}`);
  const values: Record<string, string> = {};
  for (const p of rawTemplate.placeholders ?? []) {
    if (placeholderValues && placeholderValues[p.key] !== undefined) {
      values[p.key] = placeholderValues[p.key];
    } else if (p.default !== undefined) {
      values[p.key] = p.default;
    }
  }
  return substitutePlaceholders(rawTemplate, values);
}

/**
 * Create a template's item tree in a plan, and the criteria each item
 * brings (§14) — under the file rule, never with decisions.
 */
function createTemplateItems(
  planUid: string,
  items: any[],
  opts: { author: string; authorType: string; templateId: string; sortStart?: number },
): PlanItem[] {
  const created: PlanItem[] = [];
  const walk = (templateItems: any[], parentUid: string | null, sortBase: number): void => {
    for (let i = 0; i < templateItems.length; i++) {
      const t = templateItems[i];
      const kind = t.kind === 'object' ? 'object' : 'action';
      const item = planItemService.createItem({
        planUid,
        parentUid,
        sortOrder: sortBase + i,
        kind,
        title: String(t.title ?? ''),
        // A disk template's `bodyPath` was read, confined, by the loader.
        body: t.body ?? '',
        template: t.template ?? null,
        // Action defaults — template items start as pending
        status: kind === 'action' ? 'pending' : undefined,
        scopePath: t.scopePath ?? null,
        fileSpecs: Array.isArray(t.fileSpecs) ? t.fileSpecs : [],
        symbolSpecs: Array.isArray(t.symbolSpecs) ? t.symbolSpecs : [],
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        // Cascading properties from template
        skills: Array.isArray(t.skills) ? t.skills : [],
        skillsMode: t.skillsMode ?? 'inherit',
        claimPolicy: t.claimPolicy ?? null,
        claimPolicyMode: t.claimPolicyMode ?? 'inherit',
        executionConfig: t.executionConfig ?? null,
        executionConfigMode: t.executionConfigMode ?? 'inherit',
        constraints: t.constraints ?? null,
        constraintsMode: t.constraintsMode ?? 'inherit',
        requiresApproval: t.requiresApproval === true,
        author: opts.author,
        authorType: opts.authorType,
      });
      created.push(item);
      seedTemplateCriteria(item.uid, t.criteria, opts.templateId);
      if (Array.isArray(t.children) && t.children.length > 0) walk(t.children, item.uid, 0);
    }
  };
  walk(items, null, opts.sortStart ?? 0);
  return created;
}

export interface ApplyTemplateToPlanInput {
  planUid: string;
  templateId: string;
  placeholderValues?: Record<string, string>;
  author?: string;
  authorType?: string;
}

/**
 * Fill an EXISTING, empty plan from a template — what "Start from a
 * template" on an empty plan does. The project comes from the plan, never
 * from the request (Phase 19). The plan's own description is kept if it
 * has one. A template that seeds legacy tasks can only start a new plan.
 */
export function applyTemplateToPlan(input: ApplyTemplateToPlanInput): { items: PlanItem[]; version: 1 | 2 } {
  const plan = getPlan(input.planUid);
  if (!plan) throw new Error(`Plan ${input.planUid} not found`);
  if (!plan.projectPath) throw new Error('This plan is not associated with a project');
  if (planItemService.listAllItems(plan.uid).length > 0) {
    throw new Error('This plan already has items — a template starts an empty plan');
  }
  const template = resolveTemplate(input.templateId, plan.projectPath, input.placeholderValues);
  const author = input.author ?? 'human';
  const authorType = input.authorType ?? 'human';
  if (!plan.description?.trim() && template.defaultPlanDescription) {
    updatePlan(plan.uid, { description: template.defaultPlanDescription }, author);
  }

  const templateAny = template as any;
  if (Array.isArray(templateAny.items) && templateAny.items.length > 0) {
    return {
      items: createTemplateItems(plan.uid, templateAny.items, { author, authorType, templateId: input.templateId }),
      version: 2,
    };
  }

  if (template.phases.some((p) => (p.tasks ?? []).length > 0)) {
    throw new Error('This template seeds tasks, so it starts a new plan — use it from "New plan"');
  }
  seedPhasesAndDocs(plan.uid, template, author, authorType);
  migratePlan(plan.uid, { dryRun: false, author, authorType });
  return { items: planItemService.listAllItems(plan.uid), version: 1 };
}

/** V2 path — create plan metadata + V2 items from nested `items` tree. */
function applyV2Template(
  template: any,
  title: string,
  description: string,
  author: string,
  authorType: string,
  input: ApplyTemplateInput,
): ApplyTemplateResult {
  // Create plan container (no V1 tasks).
  const plan = createPlan(
    { title, description, tasks: [] },
    author, authorType, input.projectPath,
  );

  const createdItems = createTemplateItems(plan.uid, template.items, {
    author, authorType, templateId: input.templateId,
  });

  return {
    plan,
    phases: [],
    docs: [],
    tasks: [],
    items: createdItems,
    version: 2,
  };
}

/** V1 path — create plan + phases + tasks + spec docs (legacy format). */
function applyV1Template(
  template: any,
  title: string,
  description: string,
  author: string,
  authorType: string,
  input: ApplyTemplateInput,
): ApplyTemplateResult {
  // 1. Plan + skeleton tasks.
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
    author, authorType, input.projectPath,
  );

  // 2 + 4. Phases and spec docs.
  const { phases, docs, phaseByNumber } = seedPhasesAndDocs(plan.uid, template, author, authorType);

  // 3. Bind seed tasks to their phase.
  const dbTasks = getTasksByPlan(plan.uid);
  for (let i = 0; i < seedTasks.length && i < dbTasks.length; i++) {
    const seed = seedTasks[i];
    const dbTask = dbTasks[i];
    const phase = phaseByNumber.get(seed.phaseRef);
    if (phase && dbTask) {
      updateTask(dbTask.uid, { phaseUid: phase.uid });
    }
  }

  // 5. Project the legacy rows into `plan_items`.
  //
  // Measured, not assumed: before this call, `mass-refactor` produced
  // 0 items, 11 docs and 6 phases. The V2 workspace renders `plan_items`
  // and nothing else — no component reads `planDocs` at all — so every
  // one of those 17 pieces of content was invisible and the plan showed
  // the "this plan is empty" state. Phase 29 §4.10 gave built-in
  // templates a desktop surface, which is what turned that from a
  // latent mismatch into something a user would hit on their first
  // click.
  //
  // This reuses Phase 15's migrator rather than mapping phases and docs
  // to items a second time here. Two implementations of "what a V1 plan
  // looks like as items" would be exactly the drift this phase keeps
  // finding, and that one is idempotent, preserves uids, and is already
  // covered by `scripts/smoke-plan-migrate.ts`.
  migratePlan(plan.uid, { dryRun: false, author, authorType });

  return {
    plan,
    phases,
    docs,
    tasks: getTasksByPlan(plan.uid),
    items: planItemService.listAllItems(plan.uid),
    version: 1,
  };
}

/** A legacy template's phases and spec docs, created in a plan. */
function seedPhasesAndDocs(
  planUid: string,
  template: PlanTemplate,
  author: string,
  authorType: string,
): { phases: PlanPhase[]; docs: PlanDocument[]; phaseByNumber: Map<number, PlanPhase> } {
  const phases: PlanPhase[] = [];
  const phaseByNumber = new Map<number, PlanPhase>();
  for (const p of template.phases) {
    const created = createPhase({
      planUid,
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

  const docs: PlanDocument[] = [];
  const docByKey = new Map<string, PlanDocument>();
  for (const d of template.docs) {
    const parent = d.parentKey ? docByKey.get(d.parentKey) ?? null : null;
    const created = createPlanDocument({
      planUid,
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
  return { phases, docs, phaseByNumber };
}
