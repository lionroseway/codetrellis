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

import fs from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import * as planService from './plan-service';
import * as planPhasesService from './plan-phases-service';
import * as planDocsService from './plan-documents-service';

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

  const phases = planPhasesService.listPhases(input.planUid);
  const tasks = plan.tasks;
  const docs = planDocsService.listPlanDocuments(input.planUid);

  const templateDir = path.join(input.projectRoot, '.codetrellis', 'templates', input.templateId);
  ensureDir(templateDir);
  ensureDir(path.join(templateDir, 'docs'));

  // Group tasks by phase for the YAML's `phases[].tasks[]` shape. Tasks
  // not bound to a phase get dropped from the template — templates are
  // intentionally phased; if you have a flat plan, publishing it as a
  // template doesn't really make sense yet (could add later).
  const tasksByPhase = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (!t.phaseUid) continue;
    const bucket = tasksByPhase.get(t.phaseUid) ?? [];
    bucket.push(t);
    tasksByPhase.set(t.phaseUid, bucket);
  }

  // Doc bodies live as separate markdown files referenced via
  // `bodyPath` in template.yaml. Keeps the YAML manageable.
  const docEntries: Array<{
    key: string;
    docType: string;
    title: string;
    orderHint: string | null;
    parentKey: string | null;
    bodyPath: string;
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
      key,
      docType: d.docType,
      title: d.title,
      orderHint: d.orderHint,
      parentKey: null, // resolved below once all keys are known
      bodyPath: bodyPath.replace(/\\/g, '/'), // forward slashes in YAML
    });
  }
  // Now resolve parentKey now that every key is known.
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
    placeholders: input.placeholders && input.placeholders.length ? input.placeholders : undefined,
    phases: phases.map((p) => {
      const phaseTasks = (tasksByPhase.get(p.uid) ?? []).map((t) => ({
        description: t.description,
        affectedFiles: t.affectedFiles ?? [],
      }));
      return {
        phaseNumber: p.phaseNumber,
        title: p.title,
        scope: p.scope || undefined,
        prerequisites: p.prerequisites || undefined,
        acceptanceCriteria: p.acceptanceCriteria || undefined,
        // status + gitCheckpoint scrubbed — fresh template starts at pending
        tasks: phaseTasks.length ? phaseTasks : undefined,
      };
    }),
    docs: docEntries.map((d) => ({
      key: d.key,
      docType: d.docType,
      title: d.title,
      orderHint: d.orderHint || undefined,
      parentKey: d.parentKey || undefined,
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
