/**
 * Where a project's plans live on this device (Phase 32 C3.4a; shared-work
 * doc C-3, "A shared plans folder").
 *
 * A project's plans, task records and key introductions sit under
 * `.codetrellis/` in the project itself, unless its committed config names
 * a plans folder: a planning repository (by its remote) or a folder a sync
 * client carries (by its place under the provider's root). The config never
 * holds a full path, because every teammate's copy sits somewhere else.
 *
 * Naming a folder is not linking it. Each device's copy is confirmed by its
 * person, in the app window, and kept in this device's database: a cloned
 * repository must never point the app at a folder by itself (the rule C2.2a
 * set for review hosts). Until then, and whenever the config names another
 * folder than the one confirmed or the copy has gone, nothing is read or
 * written there, and `plansHome` says so by returning null.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDb } from './database';
import { markDirty } from './persistence';
import { getProjectConfig, updateProjectConfig } from './project-config-service';
import type { PlansFolderRef } from '../../shared/types';

export type PlansFolderState = 'here' | 'linked' | 'unlinked' | 'changed' | 'missing';

export interface PlansFolderStatus {
  project: string;
  /** What the committed config names, or null when the plans live in the project. */
  named: PlansFolderRef | null;
  state: PlansFolderState;
  /** This device's confirmed copy, when there is one. */
  linked: { path: string; confirmedAt: number; confirmedBy: string } | null;
  says: string;
}

export class PlansFolderError extends Error {}

interface LinkRow { path: string; ref: string; confirmedAt: number; confirmedBy: string }

function linkRow(projectRoot: string): LinkRow | null {
  const v = getDb().exec(
    'SELECT local_path, ref, confirmed_at, confirmed_by FROM linked_plans_folder WHERE project_root = ?', [projectRoot],
  )[0]?.values[0];
  return v ? { path: String(v[0]), ref: String(v[1]), confirmedAt: Number(v[2]), confirmedBy: String(v[3]) } : null;
}

const refKey = (ref: PlansFolderRef): string => JSON.stringify(ref);

/** The folder as people say it: "the planning repo github.com/acme/plans", "OneDrive: Board pack". */
export function folderWords(ref: PlansFolderRef): string {
  if (ref.kind === 'git') return `the planning repository ${normaliseRemote(ref.remote)}`;
  const provider = ref.provider === 'onedrive' ? 'OneDrive' : ref.provider === 'sharepoint' ? 'SharePoint' : 'a synced folder';
  return `${provider}: ${ref.place}`;
}

function stateOf(projectRoot: string): { named: PlansFolderRef | null; state: PlansFolderState; row: LinkRow | null } {
  const named = getProjectConfig(projectRoot).plans?.folder ?? null;
  const row = linkRow(projectRoot);
  if (!named) return { named, state: 'here', row };
  if (!row) return { named, state: 'unlinked', row };
  if (row.ref !== refKey(named)) return { named, state: 'changed', row };
  let dir = false;
  try { dir = fs.statSync(row.path).isDirectory(); } catch { /* gone */ }
  return { named, state: dir ? 'linked' : 'missing', row };
}

/**
 * The folder whose `.codetrellis/` holds this project's plans on this
 * device: the project itself, or its confirmed plans folder. Null when the
 * config names a folder this device has not linked, or no longer can.
 */
export function plansHome(projectRoot: string): string | null {
  const { state, row } = stateOf(projectRoot);
  if (state === 'here') return projectRoot;
  return state === 'linked' ? row!.path : null;
}

/** The project whose confirmed plans folder `dir` is, if any. */
export function projectOfPlansHome(dir: string): string | null {
  const canon = canonical(dir);
  if (!canon) return null;
  for (const r of getDb().exec('SELECT project_root, local_path FROM linked_plans_folder')[0]?.values ?? []) {
    if (canonical(String(r[1])) === canon && plansHome(String(r[0])) !== null) return String(r[0]);
  }
  return null;
}

/** Every confirmed plans folder, with its project. */
export function linkedPlansHomes(): Array<{ project: string; home: string }> {
  return (getDb().exec('SELECT project_root FROM linked_plans_folder')[0]?.values ?? [])
    .map((r) => String(r[0]))
    .map((project) => ({ project, home: plansHome(project) }))
    .filter((x): x is { project: string; home: string } => !!x.home && x.home !== x.project);
}

export function getPlansFolder(projectRoot: string): PlansFolderStatus {
  const { named, state, row } = stateOf(projectRoot);
  const linked = row && state !== 'unlinked' ? { path: row.path, confirmedAt: row.confirmedAt, confirmedBy: row.confirmedBy } : null;
  const where = named ? folderWords(named) : '';
  const says = {
    here: 'This project\'s plans live in the project itself, under .codetrellis/plans.',
    linked: `This project's plans live in ${where}. On this device that is ${row?.path}.`,
    unlinked: `This project's plans live in ${where}. Link your copy of it on this device to see them; until then nothing there is read.`,
    changed: `The project now names ${where} for its plans, not the folder linked on this device. Link your copy of it; until then nothing is read.`,
    missing: `This project's plans live in ${where}, linked on this device at ${row?.path}, which is not there now. Nothing is read until it is back or linked again.`,
  }[state];
  return { project: projectRoot, named, state, linked, says };
}

/** Name the project's plans folder in its committed config, or clear it (null). The caller checks the person asked. */
export function namePlansFolder(projectRoot: string, ref: PlansFolderRef | null): PlansFolderStatus {
  // `plans` is merged key by key, so a cleared folder is written as
  // undefined, which the file then leaves out.
  updateProjectConfig(projectRoot, { plans: { folder: ref ?? undefined } });
  return getPlansFolder(projectRoot);
}

// ── Linking this device's copy ───────────────────────────────────────────

function canonical(p: string): string | null {
  try { return fs.realpathSync.native(path.resolve(p)); } catch { return null; }
}

/**
 * A remote as one string whatever its spelling: `git@github.com:acme/plans.git`,
 * `https://github.com/acme/plans` and `ssh://git@github.com/acme/plans/` are
 * all `github.com/acme/plans`.
 */
export function normaliseRemote(remote: string): string {
  let r = remote.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(r);
  if (scp) r = `${scp[1]}/${scp[2]}`;
  else r = r.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '');
  r = r.replace(/\.git\/?$/i, '').replace(/\/+$/, '');
  const slash = r.indexOf('/');
  return slash < 0 ? r.toLowerCase() : r.slice(0, slash).toLowerCase() + r.slice(slash);
}

function remotesOf(dir: string): string[] {
  try {
    const out = execFileSync('git', ['-C', dir, 'remote', '-v'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return [...new Set(out.split('\n').map((l) => l.split(/\s+/)[1]).filter((x): x is string => !!x))];
  } catch { return []; }
}

/** Whether `dir` is a copy of the folder `ref` names, or why not. */
export function matchesRef(dir: string, ref: PlansFolderRef): { ok: true } | { ok: false; why: string } {
  if (ref.kind === 'git') {
    const want = normaliseRemote(ref.remote);
    const have = remotesOf(dir);
    if (have.length === 0) return { ok: false, why: 'it is not a git repository with a remote' };
    return have.some((r) => normaliseRemote(r) === want)
      ? { ok: true }
      : { ok: false, why: `its remote is ${normaliseRemote(have[0])}, not ${want}` };
  }
  const tail = ref.place.split('/');
  const segs = dir.split(/[\\/]/).filter(Boolean);
  const same = (a: string, b: string) => (process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase());
  const ends = segs.length >= tail.length && tail.every((t, i) => same(segs[segs.length - tail.length + i], t));
  return ends ? { ok: true } : { ok: false, why: `it is not a folder named ${ref.place}` };
}

/**
 * Confirm this device's copy of the project's plans folder. The caller has
 * checked that the person asked, in the app window. The folder must be a
 * real directory, not the project itself, and a copy of the folder the
 * config names.
 */
export function linkPlansFolder(projectRoot: string, localPath: unknown, by: string): PlansFolderStatus {
  const named = getProjectConfig(projectRoot).plans?.folder;
  if (!named) throw new PlansFolderError('This project keeps its plans in the project itself, so there is no folder to link.');
  if (typeof localPath !== 'string' || !path.isAbsolute(localPath)) throw new PlansFolderError('Choose the folder on this device: a full path.');
  const dir = canonical(localPath);
  if (!dir) throw new PlansFolderError(`${localPath} is not on this device.`);
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch { /* not there */ }
  if (!isDir) throw new PlansFolderError(`${localPath} is not a folder.`);
  const project = canonical(projectRoot);
  if (project && dir === project) throw new PlansFolderError('That is the project itself. Choose your copy of the plans folder.');
  const match = matchesRef(dir, named);
  if (!match.ok) throw new PlansFolderError(`${localPath} is not ${folderWords(named)}: ${match.why}.`);
  getDb().run(
    `INSERT INTO linked_plans_folder (project_root, local_path, ref, confirmed_at, confirmed_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_root) DO UPDATE SET local_path = excluded.local_path, ref = excluded.ref,
       confirmed_at = excluded.confirmed_at, confirmed_by = excluded.confirmed_by`,
    [projectRoot, dir, refKey(named), Date.now(), by],
  );
  markDirty();
  return getPlansFolder(projectRoot);
}

/** Forget this device's copy. Anyone may: it only stops reading there. */
export function unlinkPlansFolder(projectRoot: string): PlansFolderStatus {
  getDb().run('DELETE FROM linked_plans_folder WHERE project_root = ?', [projectRoot]);
  markDirty();
  return getPlansFolder(projectRoot);
}
