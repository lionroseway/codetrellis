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
import { createPlan } from './plan-service';
import { createPhase } from './plan-phases-service';
import { createPlanDocument } from './plan-documents-service';
import { updateTask } from './plan-service';
import { getTasksByPlan } from './plan-service';
import * as planItemService from './plan-item-service';
import { migratePlan } from './plan-migrate-service';
import { getTemplate, substitutePlaceholders } from './plan-templates';

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
  const rawTemplate = getTemplate(input.templateId, input.projectPath);
  if (!rawTemplate) {
    throw new Error(`Unknown plan template: ${input.templateId}`);
  }

  // Build the placeholder map: caller-provided values + per-placeholder
  // defaults. Empty string is a valid value (means "explicitly blank");
  // only undefined falls through to the default.
  const values: Record<string, string> = {};
  for (const p of rawTemplate.placeholders ?? []) {
    if (input.placeholderValues && input.placeholderValues[p.key] !== undefined) {
      values[p.key] = input.placeholderValues[p.key];
    } else if (p.default !== undefined) {
      values[p.key] = p.default;
    }
  }
  const template = substitutePlaceholders(rawTemplate, values);

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

  // Recursively create V2 items from the template's items tree.
  const createdItems: PlanItem[] = [];

  function createItemsRecursive(
    templateItems: any[],
    parentUid: string | null,
    sortBase: number,
  ): void {
    for (let i = 0; i < templateItems.length; i++) {
      const t = templateItems[i];
      const kind = t.kind === 'object' ? 'object' : 'action';

      // Resolve bodyPath if body is in a separate file
      const body = t.body ?? '';
      if (t.bodyPath && input.projectPath) {
        // bodyPath is relative to the template directory. Since we
        // don't have the template dir here, we rely on the body having
        // been inlined by substitutePlaceholders or the loader.
        // For disk templates, the loader reads bodyPath.
        // Fallback: use whatever body we have.
      }

      const item = planItemService.createItem({
        planUid: plan.uid,
        parentUid,
        sortOrder: sortBase + i,
        kind,
        title: String(t.title ?? ''),
        body,
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
        author,
        authorType,
      });

      createdItems.push(item);

      // Recurse into children
      if (Array.isArray(t.children) && t.children.length > 0) {
        createItemsRecursive(t.children, item.uid, 0);
      }
    }
  }

  createItemsRecursive(template.items, null, 0);

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

  // 2. Phases
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

  // 4. Spec docs
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
