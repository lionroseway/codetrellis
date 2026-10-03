/**
 * Phase 31 §4.4 — watch exactly the recorded artefacts, not the tree.
 *
 * One small chokidar instance per project over the paths in `attachments`
 * that have a role. On a change it re-takes the hash, and when that turns
 * an approved criterion `stale` it says so once: a `plan-item-criteria-
 * changed` broadcast for the open UI, and a `need-decision` channel event
 * so the person hears about it wherever they are.
 *
 * The watcher is for promptness, not correctness. Files change while the
 * app is closed, so every read re-checks (`refreshArtefactHashes`); this
 * only means nobody has to open the item to find out. Each change also
 * records a check run over the affected item (Phase 31 §8.3).
 */

import * as _lazy____server from '../server';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  artefactPathsForProject,
  itemsWithArtefactAt,
  projectRootForItem,
  refreshArtefactHashes,
  type Artefact,
} from './artefact-service';
import { listCriteria } from './criteria-service';
import { runCheckRun } from './criterion-loop-service';
import { postCriterionNotice } from './sensor-bridge-service';
import { getDb } from './database';
import { resolveTrustedProjectRoot } from './trusted-roots';
import * as awareness from './awareness-service';
import { locateStored, placeOf } from './material-place';

interface ProjectWatch {
  watcher: FSWatcher;
  /** The project path as plans store it — what the artefact queries match on. */
  projectPath: string;
  root: string;
}

const watches = new Map<string, ProjectWatch>();

function planUidOf(itemUid: string): string | null {
  return (getDb().exec(`SELECT plan_uid FROM plan_items WHERE uid = ?`, [itemUid])[0]?.values[0]?.[0] as string) ?? null;
}

function projectPathOf(itemUid: string): string | null {
  return (getDb().exec(
    `SELECT p.project_path FROM plan_items i JOIN plans p ON p.uid = i.plan_uid WHERE i.uid = ?`,
    [itemUid],
  )[0]?.values[0]?.[0] as string) ?? null;
}

async function onArtefactChanged(w: ProjectWatch, absPath: string): Promise<void> {
  // Its stored form: project-relative, or its place in the plans folder (C3.4c).
  const rel = placeOf(absPath, w.root) ?? path.relative(w.root, absPath).split(path.sep).join('/');
  let anyChanged = false;
  try {
    for (const itemUid of itemsWithArtefactAt(w.projectPath, rel)) {
      const moved = await onItemArtefactChanged(itemUid, rel);
      anyChanged ||= moved;
    }
  } finally {
    // Tasks that share the file are told (A6.3): the material signals are
    // recomputed with the rest of the project's, once per change.
    if (anyChanged) {
      await awareness.refreshSignals(w.projectPath).catch((err) => console.warn('[Artefacts] Signal refresh failed:', err));
    }
  }
}

/** One item's file changed: re-hash, and say what that did. True when its hash moved. */
async function onItemArtefactChanged(itemUid: string, rel: string): Promise<boolean> {
  const wasMet = new Set(listCriteria(itemUid).filter((c) => c.state === 'met').map((c) => c.uid));
  const changed = await refreshArtefactHashes(itemUid);
  if (changed.length === 0) return false;

  const nowStale = listCriteria(itemUid).filter((c) => c.state === 'stale' && wasMet.has(c.uid));
  try {
    _lazy____server.broadcast('plan-item-criteria-changed', { planUid: planUidOf(itemUid), itemUid });
  } catch { /* the server may not be up in a unit test */ }

  const planUid = planUidOf(itemUid);
  if (!planUid) return true;

  // §8.3 — the material-changed trigger: a check run over the affected
  // item only, recorded like any other, so the plan's run history shows
  // when the ground moved and what it did to the criteria.
  try {
    const run = await runCheckRun({
      planUid, trigger: 'material_changed', by: 'codetrellis', byType: 'system', itemUids: [itemUid],
    });
    _lazy____server.broadcast('plan-check-run', { planUid, runUid: run.uid });
  } catch (err) {
    console.warn('[Artefacts] Check run after a change failed:', err);
  }

  // Once per criterion, on the transition from met to stale — a second
  // edit to an already-stale file says nothing new.
  for (const c of nowStale) {
    postCriterionNotice({
      planUid,
      itemUid,
      criterionUid: c.uid,
      reason: 'stale',
      message: `"${c.text}" was approved, and ${rel} has changed since. Is it still met?`,
    });
  }
  return true;
}

/** Watch every recorded artefact in a project. Called when the project is opened. */
export function startArtefactWatcherForProject(projectPath: string): void {
  if (watches.has(projectPath)) return;
  let root: string;
  try {
    root = resolveTrustedProjectRoot(projectPath, 'artefact watcher');
  } catch {
    return;
  }
  const watcher = chokidar.watch([], {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    followSymlinks: false,
  });
  const w: ProjectWatch = { watcher, projectPath, root };
  watcher.on('all', (event, file) => {
    if (event !== 'change' && event !== 'add' && event !== 'unlink') return;
    void onArtefactChanged(w, file).catch((err) => console.warn('[Artefacts] Refresh failed:', err));
  });
  watcher.on('error', (err) => console.warn('[Artefacts] Watcher error:', err));
  for (const rel of artefactPathsForProject(projectPath)) {
    const at = locateStored(rel, root);
    if (at) watcher.add(path.join(at.root, at.rel));
  }
  watches.set(projectPath, w);
}

/** Start watching one newly recorded artefact. */
export function startArtefactWatching(artefact: Artefact): void {
  const projectPath = projectPathOf(artefact.itemUid);
  if (!projectPath) return;
  if (!watches.has(projectPath)) startArtefactWatcherForProject(projectPath);
  const w = watches.get(projectPath);
  if (!w) return;
  try {
    const at = locateStored(artefact.path, projectRootForItem(artefact.itemUid));
    if (at) w.watcher.add(path.join(at.root, at.rel));
  } catch { /* project no longer open */ }
}

/**
 * Watch the artefacts a plan brought in from its files (C3.4c): a teammate's
 * material arrives with a pull or a sync, not through recording here, and
 * must be watched like one recorded here. Adding a path already watched is
 * harmless.
 */
export function watchPlanArtefacts(projectPath: string, planUid: string): void {
  if (!watches.has(projectPath)) startArtefactWatcherForProject(projectPath);
  const w = watches.get(projectPath);
  if (!w) return;
  const values = (getDb().exec(
    `SELECT DISTINCT a.value FROM attachments a JOIN plan_items i ON i.uid = a.target_uid
     WHERE i.plan_uid = ? AND a.target_type = 'item' AND a.kind = 'file_ref' AND a.role IS NOT NULL`,
    [planUid],
  )[0]?.values ?? []).map((r) => String(r[0]));
  for (const v of values) {
    const at = locateStored(v, w.root);
    if (at) w.watcher.add(path.join(at.root, at.rel));
  }
}

export function stopArtefactWatchers(): void {
  for (const w of watches.values()) void w.watcher.close();
  watches.clear();
}
