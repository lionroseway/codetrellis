/**
 * Plan file service — Phase 13 §A.
 *
 * Round-trips a plan (plan + phases + tasks + spec docs) between the
 * SQL store and a directory of YAML + markdown checked into the
 * project repo. Layout follows [docs/PLAN-EXPORT.md §3](../../../docs/PLAN-EXPORT.md):
 *
 *   <project>/.codetrellis/plans/<slug>/
 *     plan.yaml
 *     phases/<NN-slug>.yaml
 *     tasks/<NNN-slug>.yaml
 *     docs/<order>-<slug>.md          (with YAML front-matter)
 *
 * §A is **manual** — the user / agent calls `exportPlan` /
 * `importPlan`. Phase 13 §B will add file-watcher auto-sync on top of
 * these primitives.
 *
 * Design choices implemented here:
 * - YAML for structured data, markdown (with front-matter) for spec docs.
 * - One file per task / phase / doc so PR diffs are scoped.
 * - UID is the canonical id; slugs are derived from titles and don't
 *   auto-rename on title change (see PLAN-EXPORT §8 Identity).
 * - Importer is upsert: existing rows by UID get updated, new ones
 *   created. Importing the same directory twice is idempotent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import * as planService from './plan-service';
import * as planPhasesService from './plan-phases-service';
import * as planDocsService from './plan-documents-service';
import { getDb } from './database';
import type {
  Plan,
  PlanPhase,
  Task,
  PlanDocument,
  PhaseStatus,
  TaskStatus,
} from '../../shared/types';

// --- Public surface ---

export interface ExportPlanResult {
  planDir: string;
  files: string[]; // absolute paths of every file written
}

export interface ImportPlanResult {
  plan: Plan;
  phases: PlanPhase[];
  tasks: Task[];
  docs: PlanDocument[];
  warnings: string[];
}

/**
 * Export a plan to disk under `<projectRoot>/.codetrellis/plans/<slug>/`.
 * Idempotent: re-exporting the same plan overwrites the same files.
 */
export function exportPlan(planUid: string, projectRoot: string): ExportPlanResult {
  const plan = planService.getPlan(planUid);
  if (!plan) throw new Error(`Plan ${planUid} not found`);

  const phases = planPhasesService.listPhases(planUid);
  const tasks = plan.tasks;
  const docs = planDocsService.listPlanDocuments(planUid);

  const slug = makePlanSlug(plan);
  const planDir = path.join(projectRoot, '.codetrellis', 'plans', slug);

  ensureDir(planDir);
  ensureDir(path.join(planDir, 'phases'));
  ensureDir(path.join(planDir, 'tasks'));
  ensureDir(path.join(planDir, 'docs'));

  const files: string[] = [];

  // plan.yaml
  const planFile = path.join(planDir, 'plan.yaml');
  writeFileAtomic(planFile, stringifyYaml(serializePlan(plan)));
  files.push(planFile);

  // phases/
  for (const phase of phases) {
    const fname = `${pad2(phase.phaseNumber)}-${slugify(phase.title) || 'phase'}.yaml`;
    const fpath = path.join(planDir, 'phases', fname);
    writeFileAtomic(fpath, stringifyYaml(serializePhase(phase)));
    files.push(fpath);
  }

  // tasks/
  for (const task of tasks) {
    const fname = `${pad3(task.sortOrder)}-${slugify(task.description) || 'task'}.yaml`;
    const fpath = path.join(planDir, 'tasks', fname);
    writeFileAtomic(fpath, stringifyYaml(serializeTask(task)));
    files.push(fpath);
  }

  // docs/ — markdown body with YAML front-matter for metadata
  for (const doc of docs) {
    const orderPrefix = doc.orderHint ? `${doc.orderHint}-` : '';
    const fname = `${orderPrefix}${slugify(doc.title) || doc.docType}.md`;
    const fpath = path.join(planDir, 'docs', fname);
    writeFileAtomic(fpath, serializeDoc(doc));
    files.push(fpath);
  }

  // Ensure .codetrellis/.gitignore exists so cache/ stays out of git.
  ensureCodetrellisGitignore(path.join(projectRoot, '.codetrellis'));

  return { planDir, files };
}

/**
 * Import a plan from a `<plan-dir>/plan.yaml` (and sibling files).
 * Upsert: matches by UID. Returns the resulting in-DB rows.
 */
export function importPlan(planDirOrPlanYaml: string): ImportPlanResult {
  // Accept either the directory or the plan.yaml path explicitly.
  let planDir = planDirOrPlanYaml;
  if (planDir.endsWith('plan.yaml')) {
    planDir = path.dirname(planDir);
  }
  const planFile = path.join(planDir, 'plan.yaml');
  if (!fs.existsSync(planFile)) {
    throw new Error(`Not a plan directory: ${planDir} (no plan.yaml)`);
  }

  const warnings: string[] = [];
  const planRaw = parseYaml(fs.readFileSync(planFile, 'utf-8'));
  if (!planRaw || typeof planRaw !== 'object' || !planRaw.uid || !planRaw.title) {
    throw new Error(`Invalid plan.yaml at ${planFile} — missing uid or title`);
  }

  const planUid = planRaw.uid as string;
  const projectPath = (planRaw.projectPath as string) || '.';

  // 1. Plan upsert.
  upsertPlan(planUid, planRaw, projectPath);

  // 2. Phases — read every yaml under phases/, upsert each.
  const phaseDir = path.join(planDir, 'phases');
  if (fs.existsSync(phaseDir)) {
    for (const fname of fs.readdirSync(phaseDir)) {
      if (!fname.endsWith('.yaml') && !fname.endsWith('.yml')) continue;
      const fpath = path.join(phaseDir, fname);
      try {
        const raw = parseYaml(fs.readFileSync(fpath, 'utf-8'));
        if (!raw?.uid) {
          warnings.push(`Skipping ${fpath} — missing uid`);
          continue;
        }
        upsertPhase(planUid, raw);
      } catch (err) {
        warnings.push(`Failed to import phase ${fname}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // 3. Tasks — read every yaml under tasks/, upsert each.
  const taskDir = path.join(planDir, 'tasks');
  if (fs.existsSync(taskDir)) {
    for (const fname of fs.readdirSync(taskDir)) {
      if (!fname.endsWith('.yaml') && !fname.endsWith('.yml')) continue;
      const fpath = path.join(taskDir, fname);
      try {
        const raw = parseYaml(fs.readFileSync(fpath, 'utf-8'));
        if (!raw?.uid) {
          warnings.push(`Skipping ${fpath} — missing uid`);
          continue;
        }
        upsertTask(planUid, raw);
      } catch (err) {
        warnings.push(`Failed to import task ${fname}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // 4. Docs — read every md under docs/, parse front-matter + body.
  const docDir = path.join(planDir, 'docs');
  if (fs.existsSync(docDir)) {
    for (const fname of fs.readdirSync(docDir)) {
      if (!fname.endsWith('.md')) continue;
      const fpath = path.join(docDir, fname);
      try {
        const { meta, body } = parseFrontMatter(fs.readFileSync(fpath, 'utf-8'));
        if (!meta.uid) {
          warnings.push(`Skipping ${fpath} — missing uid in front-matter`);
          continue;
        }
        upsertDoc(planUid, meta, body);
      } catch (err) {
        warnings.push(`Failed to import doc ${fname}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Return the freshly-imported state.
  const updatedPlan = planService.getPlan(planUid);
  if (!updatedPlan) throw new Error(`Plan ${planUid} disappeared after import`);

  return {
    plan: updatedPlan,
    phases: planPhasesService.listPhases(planUid),
    tasks: updatedPlan.tasks,
    docs: planDocsService.listPlanDocuments(planUid),
    warnings,
  };
}

/**
 * Discover every plan directory under `<projectRoot>/.codetrellis/plans/`.
 * Used on project open to auto-detect committed plans without an
 * explicit import step.
 */
export function discoverPlanDirs(projectRoot: string): string[] {
  const root = path.join(projectRoot, '.codetrellis', 'plans');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((p) => {
      try {
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'plan.yaml'));
      } catch {
        return false;
      }
    });
}

// --- Serialization ---

function serializePlan(plan: Plan & { tasks?: Task[] }) {
  return {
    uid: plan.uid,
    title: plan.title,
    description: plan.description,
    status: plan.status,
    author: plan.author,
    authorType: plan.authorType,
    projectPath: plan.projectPath,
    createdAt: new Date(plan.createdAt).toISOString(),
    updatedAt: new Date(plan.updatedAt).toISOString(),
  };
}

function serializePhase(phase: PlanPhase) {
  return {
    uid: phase.uid,
    phaseNumber: phase.phaseNumber,
    title: phase.title,
    status: phase.status,
    gitCheckpoint: phase.gitCheckpoint,
    scope: phase.scope,
    prerequisites: phase.prerequisites,
    acceptanceCriteria: phase.acceptanceCriteria,
    createdAt: new Date(phase.createdAt).toISOString(),
    updatedAt: new Date(phase.updatedAt).toISOString(),
  };
}

function serializeTask(task: Task) {
  return {
    uid: task.uid,
    sortOrder: task.sortOrder,
    phaseUid: task.phaseUid,
    description: task.description,
    status: task.status,
    assignee: task.assignee,
    assigneeType: task.assigneeType,
    assigneeModel: task.assigneeModel,
    affectedFiles: task.affectedFiles,
    affectedSymbols: task.affectedSymbols,
    newConnections: task.newConnections,
    removedConnections: task.removedConnections,
    dependencies: task.dependencies,
    fileSpec: task.fileSpec ?? null,
    symbolSpecs: task.symbolSpecs ?? [],
    createdAt: new Date(task.createdAt).toISOString(),
    updatedAt: new Date(task.updatedAt).toISOString(),
  };
}

function serializeDoc(doc: PlanDocument): string {
  const meta = {
    uid: doc.uid,
    docType: doc.docType,
    title: doc.title,
    orderHint: doc.orderHint,
    parentDocUid: doc.parentDocUid,
    version: doc.version,
    author: doc.author,
    authorType: doc.authorType,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
  return `---\n${stringifyYaml(meta)}---\n\n${doc.body || ''}`;
}

// --- Upserts (importer side) ---

function upsertPlan(planUid: string, raw: any, projectPath: string): void {
  const db = getDb();
  const exists = db.exec(`SELECT uid FROM plans WHERE uid = ?`, [planUid]);
  const now = Date.now();
  if (exists[0]?.values[0]) {
    db.run(
      `UPDATE plans SET title = ?, description = ?, status = ?, author = ?, author_type = ?, project_path = ?, updated_at = ? WHERE uid = ?`,
      [
        String(raw.title),
        String(raw.description ?? ''),
        String(raw.status ?? 'draft'),
        String(raw.author ?? 'human'),
        String(raw.authorType ?? 'human'),
        projectPath,
        toEpoch(raw.updatedAt) ?? now,
        planUid,
      ],
    );
  } else {
    db.run(
      `INSERT INTO plans (uid, title, description, status, author, author_type, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        planUid,
        String(raw.title),
        String(raw.description ?? ''),
        String(raw.status ?? 'draft'),
        String(raw.author ?? 'human'),
        String(raw.authorType ?? 'human'),
        projectPath,
        toEpoch(raw.createdAt) ?? now,
        toEpoch(raw.updatedAt) ?? now,
      ],
    );
  }
}

function upsertPhase(planUid: string, raw: any): void {
  const existing = planPhasesService.getPhase(raw.uid);
  if (existing) {
    planPhasesService.updatePhase(raw.uid, {
      phaseNumber: typeof raw.phaseNumber === 'number' ? raw.phaseNumber : undefined,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      status: isPhaseStatus(raw.status) ? raw.status : undefined,
      gitCheckpoint: raw.gitCheckpoint ?? null,
      scope: typeof raw.scope === 'string' ? raw.scope : undefined,
      prerequisites: typeof raw.prerequisites === 'string' ? raw.prerequisites : undefined,
      acceptanceCriteria: typeof raw.acceptanceCriteria === 'string' ? raw.acceptanceCriteria : undefined,
    });
    return;
  }
  // Create with a known UID. The service auto-generates UIDs, so we
  // insert directly via the DB to preserve the file's UID.
  const db = getDb();
  const now = Date.now();
  db.run(
    `INSERT INTO plan_phases (uid, plan_uid, phase_number, title, scope, prerequisites, git_checkpoint, acceptance_criteria, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(raw.uid),
      planUid,
      Number(raw.phaseNumber ?? 1),
      String(raw.title ?? ''),
      String(raw.scope ?? ''),
      String(raw.prerequisites ?? ''),
      raw.gitCheckpoint ?? null,
      String(raw.acceptanceCriteria ?? ''),
      isPhaseStatus(raw.status) ? raw.status : 'pending',
      toEpoch(raw.createdAt) ?? now,
      toEpoch(raw.updatedAt) ?? now,
    ],
  );
}

function upsertTask(planUid: string, raw: any): void {
  const existing = planService.getTaskByUid(String(raw.uid));
  if (existing) {
    planService.updateTask(String(raw.uid), {
      description: typeof raw.description === 'string' ? raw.description : undefined,
      status: isTaskStatus(raw.status) ? raw.status : undefined,
      phaseUid: raw.phaseUid ?? null,
      assignee: raw.assignee ?? null,
      assigneeType: raw.assigneeType ?? null,
      assigneeModel: raw.assigneeModel ?? null,
      affectedFiles: Array.isArray(raw.affectedFiles) ? raw.affectedFiles : undefined,
      affectedSymbols: Array.isArray(raw.affectedSymbols) ? raw.affectedSymbols : undefined,
      newConnections: Array.isArray(raw.newConnections) ? raw.newConnections : undefined,
      removedConnections: Array.isArray(raw.removedConnections) ? raw.removedConnections : undefined,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : undefined,
      fileSpec: typeof raw.fileSpec === 'string' ? raw.fileSpec : undefined,
      symbolSpecs: Array.isArray(raw.symbolSpecs) ? raw.symbolSpecs : undefined,
    });
    return;
  }
  // Insert with the file's UID preserved.
  const db = getDb();
  const now = Date.now();
  db.run(
    `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, assignee, assignee_type, assignee_model, affected_files, affected_symbols, new_connections, removed_connections, dependencies, file_spec, symbol_specs, phase_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(raw.uid),
      planUid,
      Number(raw.sortOrder ?? 0),
      String(raw.description ?? ''),
      isTaskStatus(raw.status) ? raw.status : 'pending',
      raw.assignee ?? null,
      raw.assigneeType ?? null,
      raw.assigneeModel ?? null,
      JSON.stringify(raw.affectedFiles ?? []),
      JSON.stringify(raw.affectedSymbols ?? []),
      JSON.stringify(raw.newConnections ?? []),
      JSON.stringify(raw.removedConnections ?? []),
      JSON.stringify(raw.dependencies ?? []),
      raw.fileSpec ?? null,
      JSON.stringify(raw.symbolSpecs ?? []),
      raw.phaseUid ?? null,
      toEpoch(raw.createdAt) ?? now,
      toEpoch(raw.updatedAt) ?? now,
    ],
  );
}

function upsertDoc(planUid: string, meta: any, body: string): void {
  const docUid = String(meta.uid);
  const existing = planDocsService.getPlanDocument(docUid);
  if (existing) {
    planDocsService.updatePlanDocument(docUid, {
      title: typeof meta.title === 'string' ? meta.title : undefined,
      body,
      docType: typeof meta.docType === 'string' ? meta.docType : undefined,
      orderHint: meta.orderHint ?? null,
      parentDocUid: meta.parentDocUid ?? null,
    });
    return;
  }
  // Insert with the file's UID preserved.
  const db = getDb();
  const now = Date.now();
  db.run(
    `INSERT INTO plan_documents (uid, plan_uid, doc_type, title, body, version, author, author_type, order_hint, parent_doc_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      docUid,
      planUid,
      String(meta.docType ?? 'custom'),
      String(meta.title ?? ''),
      body,
      Number(meta.version ?? 1),
      String(meta.author ?? 'human'),
      String(meta.authorType ?? 'human'),
      meta.orderHint ?? null,
      meta.parentDocUid ?? null,
      toEpoch(meta.createdAt) ?? now,
      toEpoch(meta.updatedAt) ?? now,
    ],
  );
}

// --- Helpers ---

function makePlanSlug(plan: Plan): string {
  // Combine title-slug with a short uid suffix so slug clashes between
  // plans with similar titles can't overwrite each other on disk.
  const titlePart = slugify(plan.title) || 'plan';
  const uidSuffix = plan.uid.split('-')[0]; // 8-char chunk
  return `${titlePart}-${uidSuffix}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function pad3(n: number): string { return String(n).padStart(3, '0'); }

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function ensureCodetrellisGitignore(codetrellisDir: string): void {
  const gitignorePath = path.join(codetrellisDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) return;
  const content = [
    '# CodeTrellis runtime cache — do not commit',
    'cache/',
    '',
  ].join('\n');
  try {
    fs.writeFileSync(gitignorePath, content, 'utf-8');
  } catch {
    // best-effort; not fatal if the user has an unusual permissions setup
  }
}

function toEpoch(s: unknown): number | null {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function isPhaseStatus(s: unknown): s is PhaseStatus {
  return s === 'pending' || s === 'in_progress' || s === 'done' || s === 'blocked';
}

function isTaskStatus(s: unknown): s is TaskStatus {
  return (
    s === 'pending' || s === 'assigned' || s === 'in_progress' ||
    s === 'done' || s === 'blocked' || s === 'skipped'
  );
}

/**
 * Tiny YAML front-matter parser. Returns `{ meta: {...}, body: '...' }`.
 * Accepts `---\n<yaml>\n---\n<body>` or — if no front-matter present —
 * `{ meta: {}, body: original }`.
 */
function parseFrontMatter(source: string): { meta: any; body: string } {
  if (!source.startsWith('---')) return { meta: {}, body: source };
  const end = source.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: source };
  const yamlBlock = source.slice(3, end).replace(/^\n/, '');
  const body = source.slice(end + 4).replace(/^\n+/, '');
  let meta: any = {};
  try {
    meta = parseYaml(yamlBlock) ?? {};
  } catch {
    meta = {};
  }
  return { meta, body };
}
