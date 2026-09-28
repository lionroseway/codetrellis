/**
 * The awareness engine's plumbing (Phase 32 A1.6): gather footprints, run
 * the pure `computeSignals`, keep the result in `awareness_signals`, and say
 * so when it moves (awareness spec §5.4).
 *
 * Signals have their own table and broadcast. They are not channel events:
 * those are exported into the plan manifest, the wrong home for a collision
 * that lasts ten minutes.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { AwarenessSignal, SignalState, Workstream } from '../../shared/types';
import { getDb } from './database';
import { markDirty } from './persistence';
import { isSafeGitRef } from './git-safety';
import { listWorkstreams } from './workstream-service';
import { computeSignals, reconcileSignals, type FootprintInput } from './awareness-signals';

const SHA = /^[0-9a-f]{40}$/;

/**
 * Files main changed between a workstream's merge base and main's tip. Never
 * throws; both refs are checked before git sees them.
 */
export function mainChangesSince(folder: string, base: string | null, mainRef: string | null): string[] {
  if (!base || !SHA.test(base) || !mainRef || !isSafeGitRef(mainRef)) return [];
  try {
    return execFileSync('git', ['-C', folder, 'diff', '--name-only', '-z', base, mainRef, '--'], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 16 * 1024 * 1024,
    }).split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function rowToSignal(r: unknown[]): AwarenessSignal {
  return {
    id: r[0] as string,
    kind: r[1] as AwarenessSignal['kind'],
    severity: r[2] as AwarenessSignal['severity'],
    subject: JSON.parse(r[3] as string),
    workstreams: JSON.parse(r[4] as string),
    summary: r[5] as string,
    firstSeen: r[6] as number,
    lastSeen: r[7] as number,
    state: r[8] as SignalState,
  };
}

const COLUMNS = 'id, kind, severity, subject, workstreams, summary, first_seen, last_seen, state';

/** Every signal known for a project, resolved ones included. */
export function loadSignals(projectRoot: string): AwarenessSignal[] {
  const res = getDb().exec(`SELECT ${COLUMNS} FROM awareness_signals WHERE project_root = ?`, [projectRoot]);
  return (res[0]?.values ?? []).map(rowToSignal);
}

let onChanged: (projectRoot: string) => void = () => {};

/** Told when a project's signals change. The server broadcasts `awareness-changed`. */
export function setAwarenessListener(listener: (projectRoot: string) => void): void {
  onChanged = listener;
}

/** The footprints of a repository's active workstreams, with what main did since each branched. */
export function footprintsOf(all: readonly Workstream[]): FootprintInput[] {
  const main = all.find((w) => w.main);
  const mainRef = main?.branch ?? main?.head ?? null;
  return all.filter((w) => !w.idle).map((w) => ({
    root: w.root,
    branch: w.branch,
    main: w.main,
    files: w.changes.files,
    mainSinceBase: w.main ? [] : mainChangesSince(w.root, w.changes.base, mainRef),
  }));
}

/**
 * Recompute a project's signals and store what changed. Returns true when
 * anything did, after telling the listener. `projectRoot` is already
 * confined by the caller.
 */
export function refreshSignals(projectRoot: string, now = Date.now()): boolean {
  const drafts = computeSignals(footprintsOf(listWorkstreams(projectRoot, { includeIdle: true, fresh: true })));
  const { upserts, resolved } = reconcileSignals(loadSignals(projectRoot), drafts, now);
  if (upserts.length === 0 && resolved.length === 0) return false;

  const db = getDb();
  for (const s of upserts) {
    db.run(
      `INSERT INTO awareness_signals (${COLUMNS}, project_root, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         severity = excluded.severity, subject = excluded.subject, workstreams = excluded.workstreams,
         summary = excluded.summary, last_seen = excluded.last_seen, state = excluded.state, resolved_at = NULL`,
      [s.id, s.kind, s.severity, JSON.stringify(s.subject), JSON.stringify(s.workstreams), s.summary,
        s.firstSeen, s.lastSeen, s.state, projectRoot],
    );
  }
  for (const id of resolved) {
    db.run(`UPDATE awareness_signals SET state = 'resolved', resolved_at = ?, last_seen = ? WHERE id = ?`, [now, now, id]);
  }
  markDirty();
  onChanged(projectRoot);
  return true;
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * A project's live signals (not resolved), most severe and newest first.
 * With `workstream`, only those naming it — compared by real path, because
 * sessions are bound to roots as opened and signals name them as git lists
 * them.
 */
export function listSignals(projectRoot: string, opts: { workstream?: string | null } = {}): AwarenessSignal[] {
  const canon = (p: string) => {
    try { return fs.realpathSync.native(p); } catch { return p; }
  };
  const mine = opts.workstream ? canon(opts.workstream) : null;
  return loadSignals(projectRoot)
    .filter((s) => s.state !== 'resolved')
    .filter((s) => !mine || s.workstreams.some((w) => canon(w) === mine))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.lastSeen - a.lastSeen);
}
