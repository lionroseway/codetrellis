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
  const rel = path.relative(w.root, absPath).split(path.sep).join('/');
  for (const itemUid of itemsWithArtefactAt(w.projectPath, rel)) {
    const wasMet = new Set(listCriteria(itemUid).filter((c) => c.state === 'met').map((c) => c.uid));
    const changed = await refreshArtefactHashes(itemUid);
    if (changed.length === 0) continue;

    const nowStale = listCriteria(itemUid).filter((c) => c.state === 'stale' && wasMet.has(c.uid));
    try {
      _lazy____server.broadcast('plan-item-criteria-changed', { planUid: planUidOf(itemUid), itemUid });
    } catch { /* the server may not be up in a unit test */ }

    const planUid = planUidOf(itemUid);
    if (!planUid) continue;

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
  }
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
  for (const rel of artefactPathsForProject(projectPath)) watcher.add(path.join(root, rel));
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
    w.watcher.add(path.join(projectRootForItem(artefact.itemUid), artefact.path));
  } catch { /* project no longer open */ }
}

export function stopArtefactWatchers(): void {
  for (const w of watches.values()) void w.watcher.close();
  watches.clear();
}
