/**
 * Publish a plan as a template — Phase 13 §C.
 *
 * Snapshots an existing plan (plan + phases + tasks + spec docs) into
 * a `<projectRoot>/.codetrellis/templates/<id>/` directory in a shape
 * the rest of the template machinery understands:
 *
 *   <id>/
 *     template.yaml       — metadata + phase + task scaffold + doc index
 *     docs/<order>-<slug>.md
 *
 * Strips project-specific bits so the result is reusable:
 *   - Task statuses → `pending`
 *   - Assignees / models → cleared
 *   - Phase status → `pending`
 *   - Phase git checkpoint → null
 *   - All UIDs dropped (the template generates fresh ones at apply
 *     time; UID stability isn't useful for a template)
 *   - Plan-level fields (project path, timestamps) dropped
 *
 * Doesn't currently auto-detect placeholders — the user can add them
 * to the published `template.yaml` afterwards if they want to
 * parameterise the template. Keeps the publish flow simple.
 */

import { criteriaForTemplate } from './criteria-service';
import fs from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import * as planService from './plan-service';
import * as planPhasesService from './plan-phases-service';
import * as planDocsService from './plan-documents-service';
import * as planItemService from './plan-item-service';
import type { PlanItem } from '../../shared/types';

export interface PublishTemplateInput {
  planUid: string;
  projectRoot: string;
  /** Template id (slug). Must be filesystem-safe. */
  templateId: string;
  /** Human-readable label. Defaults to the plan title. */
  label?: string;
  /** One-line short description for the picker tile. */
  shortDescription?: string;
  /** Free-form long description for the picker tooltip. */
  longDescription?: string;
  /**
   * Default plan title used when the template is applied. Use
   * `{{name}}` etc. to interpolate placeholder values.
   */
  defaultTitle?: string;
  /** Default plan description used when the template is applied. */
  defaultPlanDescription?: string;
  /** Optional placeholder declarations — see PlanTemplatePlaceholder. */
  placeholders?: Array<{ key: string; label?: string; default?: string }>;
}

export interface PublishTemplateResult {
  templateDir: string;
  files: string[];
}

export function publishPlanAsTemplate(input: PublishTemplateInput): PublishTemplateResult {
  if (!input.templateId || !/^[a-z0-9][a-z0-9-]*$/.test(input.templateId)) {
    throw new Error(`Invalid templateId: ${input.templateId} (lowercase, alphanumeric + hyphens, must start with a letter or digit)`);
  }

  const plan = planService.getPlan(input.planUid);
  if (!plan) throw new Error(`Plan ${input.planUid} not found`);

  // Detect V2 items — if any exist, use V2 template format.
  const v2Items = planItemService.listAllItems(input.planUid);
  if (v2Items.length > 0) {
    return publishV2Template(input, plan, v2Items);
  }

  return publishV1Template(input, plan);
}

/** V2 path — snapshot item tree into template.yaml with nested `items` array. */
function publishV2Template(
  input: PublishTemplateInput,
  plan: { title: string; description: string },
  allItems: PlanItem[],
): PublishTemplateResult {
  const templateDir = path.join(input.projectRoot, '.codetrellis', 'templates', input.templateId);
  ensureDir(templateDir);
  ensureDir(path.join(templateDir, 'docs'));

  // Build parent→children map
  const childrenOf = new Map<string | null, PlanItem[]>();
  for (const item of allItems) {
    const list = childrenOf.get(item.parentUid) ?? [];
    list.push(item);
    childrenOf.set(item.parentUid, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  }

  const files: string[] = [];

  // Write large item bodies as separate markdown files
  function serializeItemForTemplate(item: PlanItem): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      kind: item.kind,
      title: item.title,
    };

    // Write large bodies to separate files for readability
    if (item.body && item.body.length > 500) {
      const bodySlug = slugify(item.title) || item.kind;
      const bodyPath = `docs/${bodySlug}.md`;
      writeFileAtomic(path.join(templateDir, bodyPath), item.body);
      files.push(path.join(templateDir, bodyPath));
      obj.bodyPath = bodyPath;
    } else if (item.body) {
      obj.body = item.body;
    }

    if (item.template) obj.template = item.template;

    // Preserve structural/policy fields (useful in templates)
    if (item.scopePath) obj.scopePath = item.scopePath;
    if (item.fileSpecs?.length) obj.fileSpecs = item.fileSpecs;
    if (item.symbolSpecs?.length) obj.symbolSpecs = item.symbolSpecs;
    if (item.dependencies?.length) obj.dependencies = item.dependencies;

    // Cascading properties — template-worthy
    if (item.skills?.length) {
      obj.skills = item.skills;
      if (item.skillsMode && item.skillsMode !== 'inherit') obj.skillsMode = item.skillsMode;
    }
    if (item.claimPolicy) {
      obj.claimPolicy = item.claimPolicy;
      if (item.claimPolicyMode && item.claimPolicyMode !== 'inherit') obj.claimPolicyMode = item.claimPolicyMode;
    }
    if (item.executionConfig) {
      obj.executionConfig = item.executionConfig;
      if (item.executionConfigMode && item.executionConfigMode !== 'inherit') obj.executionConfigMode = item.executionConfigMode;
    }
    if (item.constraints) {
      obj.constraints = item.constraints;
      if (item.constraintsMode && item.constraintsMode !== 'inherit') obj.constraintsMode = item.constraintsMode;
    }
    if (item.requiresApproval) obj.requiresApproval = true;

    // Phase 31 §14 — what good looks like travels with the playbook: each
    // criterion's words, kind and policy. Never a decision or evidence —
    // those belong to the plan that did the work, not the next one.
    const criteria = criteriaForTemplate(item.uid);
    if (criteria.length > 0) obj.criteria = criteria;

    // Scrub runtime fields: status, assignee, progressPercent, blockedReason,
    // newConnections, removedConnections — these are project-specific.

    // Recurse into children
    const children = childrenOf.get(item.uid) ?? [];
    if (children.length > 0) {
      obj.children = children.map(serializeItemForTemplate);
    }

    return obj;
  }

  const roots = childrenOf.get(null) ?? [];
  const yamlBody = {
    id: input.templateId,
    version: 2,
    label: input.label ?? plan.title,
    shortDescription: input.shortDescription ?? plan.description.split('\n')[0].slice(0, 140),
    longDescription: input.longDescription ?? plan.description,
    defaultTitle: input.defaultTitle ?? plan.title,
    defaultPlanDescription: input.defaultPlanDescription ?? plan.description,
    placeholders: input.placeholders?.length ? input.placeholders : undefined,
    items: roots.map(serializeItemForTemplate),
  };

  const yamlPath = path.join(templateDir, 'template.yaml');
  writeFileAtomic(yamlPath, stringifyYaml(yamlBody));
  files.unshift(yamlPath);

  return { templateDir, files };
}

/** V1 path — snapshot phases + tasks + docs (legacy format). */
function publishV1Template(
  input: PublishTemplateInput,
  plan: { title: string; description: string; tasks: Array<{ phaseUid: string | null; description: string; affectedFiles?: string[] | null }> },
): PublishTemplateResult {
  const phases = planPhasesService.listPhases(input.planUid);
  const tasks = plan.tasks;
  const docs = planDocsService.listPlanDocuments(input.planUid);

  const templateDir = path.join(input.projectRoot, '.codetrellis', 'templates', input.templateId);
  ensureDir(templateDir);
  ensureDir(path.join(templateDir, 'docs'));

  const tasksByPhase = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (!t.phaseUid) continue;
    const bucket = tasksByPhase.get(t.phaseUid) ?? [];
    bucket.push(t);
    tasksByPhase.set(t.phaseUid, bucket);
  }

  const docEntries: Array<{
    key: string; docType: string; title: string;
    orderHint: string | null; parentKey: string | null; bodyPath: string;
  }> = [];

  const docKeyByUid = new Map<string, string>();
  for (const d of docs) {
    const key = slugify(d.title) || d.docType || d.uid.slice(0, 6);
    docKeyByUid.set(d.uid, key);
    const orderPrefix = d.orderHint ? `${d.orderHint}-` : '';
    const fname = `${orderPrefix}${slugify(d.title) || d.docType}.md`;
    const bodyPath = path.join('docs', fname);
    writeFileAtomic(path.join(templateDir, bodyPath), d.body || '');
    docEntries.push({
      key, docType: d.docType, title: d.title,
      orderHint: d.orderHint, parentKey: null, bodyPath: bodyPath.replace(/\\/g, '/'),
    });
  }
  for (let i = 0; i < docEntries.length; i++) {
    const d = docs[i];
    if (d.parentDocUid) {
      docEntries[i].parentKey = docKeyByUid.get(d.parentDocUid) ?? null;
    }
  }

  const yamlBody = {
    id: input.templateId,
    label: input.label ?? plan.title,
    shortDescription: input.shortDescription ?? plan.description.split('\n')[0].slice(0, 140),
    longDescription: input.longDescription ?? plan.description,
    defaultTitle: input.defaultTitle ?? plan.title,
    defaultPlanDescription: input.defaultPlanDescription ?? plan.description,
    placeholders: input.placeholders?.length ? input.placeholders : undefined,
    phases: phases.map((p) => {
      const phaseTasks = (tasksByPhase.get(p.uid) ?? []).map((t) => ({
        description: t.description,
        affectedFiles: t.affectedFiles ?? [],
      }));
      return {
        phaseNumber: p.phaseNumber, title: p.title,
        scope: p.scope || undefined, prerequisites: p.prerequisites || undefined,
        acceptanceCriteria: p.acceptanceCriteria || undefined,
        tasks: phaseTasks.length ? phaseTasks : undefined,
      };
    }),
    docs: docEntries.map((d) => ({
      key: d.key, docType: d.docType, title: d.title,
      orderHint: d.orderHint || undefined, parentKey: d.parentKey || undefined,
      bodyPath: d.bodyPath,
    })),
  };

  const yamlPath = path.join(templateDir, 'template.yaml');
  writeFileAtomic(yamlPath, stringifyYaml(yamlBody));

  const files = [yamlPath, ...docEntries.map((d) => path.join(templateDir, d.bodyPath))];
  return { templateDir, files };
}

// --- helpers (kept local to avoid a circular dep on plan-file-service) ---

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
