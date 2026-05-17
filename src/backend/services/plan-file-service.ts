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
import chokidar, { type FSWatcher } from 'chokidar';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import * as planService from './plan-service';
import * as planPhasesService from './plan-phases-service';
import * as planDocsService from './plan-documents-service';
import * as taskAttachmentsService from './task-attachments-service';
import * as commentService from './comment-service';
import { getDb } from './database';
import type {
  Plan,
  PlanPhase,
  Task,
  PlanDocument,
  PhaseStatus,
  TaskStatus,
  TaskAttachment,
  Comment,
  AttachmentKind,
  CommentKind,
  CommentSource,
  CommentType,
  FileSpec,
} from '../../shared/types';

/**
 * Tracks file paths we just wrote ourselves, so the file watcher can
 * skip re-importing them as if they were external edits. Stamped with
 * a timestamp; entries older than 1 second are dropped (covers any
 * filesystem rename / fsync delay).
 */
const recentSelfWrites = new Map<string, number>();
const SELF_WRITE_TTL_MS = 1000;

function stampSelfWrite(filePath: string): void {
  recentSelfWrites.set(filePath, Date.now());
}

function wasJustWrittenByUs(filePath: string): boolean {
  const t = recentSelfWrites.get(filePath);
  if (!t) return false;
  if (Date.now() - t > SELF_WRITE_TTL_MS) {
    recentSelfWrites.delete(filePath);
    return false;
  }
  return true;
}

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

  // tasks/ — include Phase 14 §A attachments + comments inline so a
  // single task.yaml round-trips the full task-as-context blob. Bigger
  // files but git-diff stays scoped.
  for (const task of tasks) {
    const fname = `${pad3(task.sortOrder)}-${slugify(task.description) || 'task'}.yaml`;
    const fpath = path.join(planDir, 'tasks', fname);
    const attachments = taskAttachmentsService.listTaskAttachments(task.uid);
    const comments = commentService.listCommentsFlat(task.uid);
    writeFileAtomic(fpath, stringifyYaml(serializeTask(task, attachments, comments)));
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
  // Suppress auto-sync write-through during the import — every
  // upsert below would otherwise schedule a redundant export.
  importDepth++;
  try {
    return importPlanInternal(planDirOrPlanYaml);
  } finally {
    importDepth--;
  }
}

function importPlanInternal(planDirOrPlanYaml: string): ImportPlanResult {
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

/**
 * Find the on-disk plan directory for a plan, if it exists. The plan
 * is "linked to file" iff its directory + plan.yaml exist in the
 * given project. Returns null otherwise.
 *
 * Used by the write-through layer to decide whether to auto-export on
 * a DB mutation, and by the UI to render the "Linked" badge.
 */
export function getLinkedPlanDir(planUid: string, projectRoot: string): string | null {
  const plan = planService.getPlan(planUid);
  if (!plan) return null;
  const slug = makePlanSlug(plan);
  const dir = path.join(projectRoot, '.codetrellis', 'plans', slug);
  if (fs.existsSync(path.join(dir, 'plan.yaml'))) return dir;
  return null;
}

/**
 * Drop the on-disk directory for a plan. The DB rows survive — this
 * is the "Shared → Local" toggle. No-op if the dir doesn't exist.
 */
export function unlinkPlan(planUid: string, projectRoot: string): { removed: boolean; planDir: string | null } {
  const dir = getLinkedPlanDir(planUid, projectRoot);
  if (!dir) return { removed: false, planDir: null };
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true, planDir: dir };
}

// --- Auto-sync (Phase 13 §B) ---

/**
 * Per-plan debounced write-through. Every plan/phase/task/doc
 * mutation calls this; if the plan has a directory on disk, we
 * re-export 200ms later (coalescing rapid edits into a single write).
 *
 * Pure best-effort: errors are logged, not thrown. A failed
 * write-through doesn't roll back the DB mutation — the file is the
 * source of truth eventually, but the in-memory state stays correct
 * until the user resolves whatever caused the write to fail.
 */
const writeThroughTimers = new Map<string, NodeJS.Timeout>();
const WRITE_THROUGH_DEBOUNCE_MS = 200;

/**
 * Set inside `importPlan` so any DB mutations the import triggers
 * (upserts via plan/phase/task/doc services) don't re-trigger a
 * write-through. The self-write stamp on `writeFileAtomic` already
 * blocks the file→DB→file ping-pong, but suppressing at this layer
 * too means we skip the debounced timer + DB lookup entirely.
 */
let importDepth = 0;

export function scheduleWriteThrough(planUid: string, projectRoot?: string): void {
  if (importDepth > 0) return;
  // Caller may not know the project path (e.g. a deep service that
  // only has the planUid). Look it up from the plan row.
  const plan = planService.getPlan(planUid);
  if (!plan) return;
  const root = projectRoot ?? plan.projectPath;
  if (!root) return;
  if (!getLinkedPlanDir(planUid, root)) return; // not linked → no-op

  const existing = writeThroughTimers.get(planUid);
  if (existing) clearTimeout(existing);
  writeThroughTimers.set(planUid, setTimeout(() => {
    writeThroughTimers.delete(planUid);
    try {
      const result = exportPlan(planUid, root);
      // Best-effort broadcast (server module may not be imported yet
      // in tests).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { broadcast } = require('../server');
        broadcast('plan-exported', { planUid, planDir: result.planDir, source: 'auto-sync', files: result.files.length });
      } catch { /* ignore */ }
    } catch (err) {
      console.warn(`[Auto-sync] Failed to export plan ${planUid}:`, err);
    }
  }, WRITE_THROUGH_DEBOUNCE_MS));
}

/**
 * Watch `<projectRoot>/.codetrellis/plans/` for external edits.
 * On a change to a `plan.yaml` / `phases/*.yaml` / `tasks/*.yaml` /
 * `docs/*.md` file, re-import the parent plan directory. Skips files
 * we just wrote ourselves (see `recentSelfWrites`) so the
 * write-through-then-watcher doesn't ping-pong.
 */
const watchersByProject = new Map<string, FSWatcher>();

export function startPlanFileWatcher(projectRoot: string): void {
  if (watchersByProject.has(projectRoot)) return; // already watching

  const plansRoot = path.join(projectRoot, '.codetrellis', 'plans');

  // Pre-create the plans dir before binding chokidar to it. Without
  // this, chokidar v4 + `ignoreInitial: true` + a target that comes
  // into existence shortly after `watch()` sometimes buckets the
  // first writes inside it as "initial" and silently drops them —
  // which broke the auto-sync UX (~30 % flake) for the very first
  // export of any plan in a project.
  //
  // Pre-creating costs us nothing: the dir is empty, takes one
  // syscall, and matches what `exportPlan` would do anyway on the
  // first write-through. After this, chokidar always binds to a
  // real, empty directory and `ignoreInitial: true` does the right
  // thing — only later additions fire events.
  try {
    fs.mkdirSync(plansRoot, { recursive: true });
  } catch (err) {
    // Permissions / read-only FS / etc. — log and continue. The
    // watcher will still attempt to bind; users on RO filesystems
    // just won't get auto-sync.
    console.warn('[Auto-sync] Could not pre-create plans dir:', err);
  }

  const watcher = chokidar.watch(plansRoot, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: 4, // plans/<slug>/{phases|tasks|docs}/file.yaml
  });

  watcher.on('all', (event, filePath) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
    if (!filePath) return;

    // Skip self-writes (we just stamped them in writeFileAtomic).
    if (wasJustWrittenByUs(filePath)) return;

    // Resolve the plan directory containing this file.
    const planDir = findContainingPlanDir(filePath, plansRoot);
    if (!planDir) return;

    // Detect YAML conflict markers — we don't try to resolve them
    // in-app, but we surface a clear banner pointing at the file so
    // the user knows where to look.
    if (filePath.endsWith('.yaml') || filePath.endsWith('.md')) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (hasGitConflictMarkers(content)) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { broadcast } = require('../server');
            broadcast('plan-file-conflict', { filePath, planDir });
          } catch { /* ignore */ }
          return; // don't try to import a half-merged file
        }
      } catch {
        // file disappeared / unreadable — fall through to attempt
        // the import which will then no-op.
      }
    }

    // Re-import. Idempotent — upsert by UID. We import the whole plan
    // directory rather than just the changed file because tasks /
    // phases reference each other (phaseUid) and a single file can't
    // be safely upserted in isolation if its parent is missing.
    try {
      const result = importPlan(planDir);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { broadcast } = require('../server');
        broadcast('plan-imported', {
          planUid: result.plan.uid,
          source: 'file-watcher',
          planDir,
          warnings: result.warnings,
        });
      } catch { /* ignore */ }
    } catch (err) {
      console.warn(`[Auto-sync] Failed to re-import ${planDir}:`, err);
    }
  });

  watcher.on('error', (err) => {
    console.warn('[Auto-sync] Plan file watcher error:', err);
  });

  watchersByProject.set(projectRoot, watcher);
  console.log(`[Auto-sync] Watching ${plansRoot}`);
}

export function stopPlanFileWatcher(projectRoot: string): void {
  const w = watchersByProject.get(projectRoot);
  if (w) {
    w.close().catch(() => {});
    watchersByProject.delete(projectRoot);
  }
}

function findContainingPlanDir(filePath: string, plansRoot: string): string | null {
  // filePath looks like:
  //   <plansRoot>/<slug>/plan.yaml
  //   <plansRoot>/<slug>/phases/01-foundation.yaml
  //   <plansRoot>/<slug>/tasks/001-add-types.yaml
  //   <plansRoot>/<slug>/docs/00-overview.md
  // We want <plansRoot>/<slug>.
  if (!filePath.startsWith(plansRoot)) return null;
  const rel = path.relative(plansRoot, filePath);
  const firstSegment = rel.split(path.sep)[0];
  if (!firstSegment) return null;
  const planDir = path.join(plansRoot, firstSegment);
  if (!fs.existsSync(path.join(planDir, 'plan.yaml'))) return null;
  return planDir;
}

function hasGitConflictMarkers(content: string): boolean {
  // Match the canonical 7-character markers at line start. False
  // positives on prose mentioning "<<<<<<<" are accepted — the
  // banner is a hint, not a hard error.
  return /^<{7} |^={7}$|^>{7} /m.test(content);
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

function serializeTask(task: Task, attachments: TaskAttachment[], comments: Comment[]) {
  return {
    uid: task.uid,
    sortOrder: task.sortOrder,
    phaseUid: task.phaseUid,
    parentTaskUid: task.parentTaskUid ?? null,
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
    // Phase 14 §A
    body: task.body ?? null,
    prompt: task.prompt ?? null,
    scopePath: task.scopePath ?? null,
    fileSpecs: task.fileSpecs ?? [],
    progressPercent: task.progressPercent ?? null,
    blockedReason: task.blockedReason ?? null,
    attachments: attachments.map((a) => ({
      uid: a.uid,
      kind: a.kind,
      value: a.value,
      label: a.label ?? null,
      contentType: a.contentType ?? null,
      author: a.author,
      authorType: a.authorType,
      createdAt: new Date(a.createdAt).toISOString(),
    })),
    comments: comments.map((c) => ({
      uid: c.uid,
      parentUid: c.parentUid,
      author: c.author,
      authorType: c.authorType,
      body: c.body,
      commentType: c.commentType,
      kind: c.kind ?? null,
      source: c.source ?? null,
      metadata: c.metadata ?? null,
      createdAt: new Date(c.createdAt).toISOString(),
    })),
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
  const fileSpecs: FileSpec[] | undefined = Array.isArray(raw.fileSpecs) ? raw.fileSpecs : undefined;
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
      // Phase 14 §A
      parentTaskUid: raw.parentTaskUid ?? null,
      body: typeof raw.body === 'string' ? raw.body : raw.body === null ? null as unknown as string : undefined,
      prompt: typeof raw.prompt === 'string' ? raw.prompt : raw.prompt === null ? null as unknown as string : undefined,
      scopePath: raw.scopePath ?? null,
      fileSpecs,
      progressPercent: typeof raw.progressPercent === 'number' ? raw.progressPercent : raw.progressPercent === null ? null : undefined,
      blockedReason: typeof raw.blockedReason === 'string' ? raw.blockedReason : raw.blockedReason === null ? null : undefined,
    });
  } else {
    // Insert with the file's UID preserved.
    const db = getDb();
    const now = Date.now();
    db.run(
      `INSERT INTO tasks (uid, plan_uid, sort_order, description, status, assignee, assignee_type, assignee_model, affected_files, affected_symbols, new_connections, removed_connections, dependencies, file_spec, symbol_specs, phase_uid, parent_task_uid, body, prompt, scope_path, file_specs, progress_percent, blocked_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        raw.parentTaskUid ?? null,
        raw.body ?? null,
        raw.prompt ?? null,
        raw.scopePath ?? null,
        JSON.stringify(fileSpecs ?? []),
        typeof raw.progressPercent === 'number' ? raw.progressPercent : null,
        raw.blockedReason ?? null,
        toEpoch(raw.createdAt) ?? now,
        toEpoch(raw.updatedAt) ?? now,
      ],
    );
  }

  // Phase 14 §A — round-trip attachments + comments alongside the task.
  if (Array.isArray(raw.attachments)) {
    for (const a of raw.attachments) {
      if (!a?.uid || !a?.kind || a?.value == null) continue;
      taskAttachmentsService.upsertAttachment({
        uid: String(a.uid),
        targetType: 'task',
        targetUid: String(raw.uid),
        kind: String(a.kind) as AttachmentKind,
        value: String(a.value),
        label: a.label ?? null,
        contentType: a.contentType ?? null,
        author: String(a.author ?? 'human'),
        authorType: String(a.authorType ?? 'human'),
        createdAt: toEpoch(a.createdAt) ?? Date.now(),
      });
    }
  }
  if (Array.isArray(raw.comments)) {
    for (const c of raw.comments) {
      if (!c?.uid || !c?.body) continue;
      upsertComment({
        uid: String(c.uid),
        targetType: 'task',
        targetUid: String(raw.uid),
        parentUid: c.parentUid ?? null,
        author: String(c.author ?? 'human'),
        authorType: String(c.authorType ?? 'human'),
        body: String(c.body),
        commentType: (c.commentType as CommentType | undefined) ?? 'comment',
        kind: (c.kind as CommentKind | null) ?? null,
        source: (c.source as CommentSource | null) ?? null,
        metadata: c.metadata ?? null,
        createdAt: toEpoch(c.createdAt) ?? Date.now(),
      });
    }
  }
}

/**
 * Upsert a comment row by uid. Used by the importer to round-trip
 * task chatter without mutating the public comment-service API.
 */
function upsertComment(input: {
  uid: string;
  targetType: 'plan' | 'task';
  targetUid: string;
  parentUid: string | null;
  author: string;
  authorType: string;
  body: string;
  commentType: CommentType;
  kind: CommentKind | null;
  source: CommentSource | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}): void {
  const db = getDb();
  const exists = db.exec(`SELECT uid FROM comments WHERE uid = ?`, [input.uid]);
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  if (exists[0]?.values[0]) {
    db.run(
      `UPDATE comments SET target_type = ?, target_uid = ?, parent_uid = ?, author = ?, author_type = ?, body = ?, comment_type = ?, kind = ?, source = ?, metadata = ?, created_at = ? WHERE uid = ?`,
      [input.targetType, input.targetUid, input.parentUid, input.author, input.authorType,
       input.body, input.commentType, input.kind, input.source, metadataJson, input.createdAt, input.uid],
    );
  } else {
    db.run(
      `INSERT INTO comments (uid, target_type, target_uid, parent_uid, author, author_type, body, comment_type, kind, source, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.uid, input.targetType, input.targetUid, input.parentUid, input.author, input.authorType,
       input.body, input.commentType, input.kind, input.source, metadataJson, input.createdAt],
    );
  }
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
  stampSelfWrite(filePath);
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
