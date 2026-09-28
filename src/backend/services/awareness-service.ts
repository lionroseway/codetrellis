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
import path from 'node:path';
import type { AwarenessSignal, SettableSignalState, SignalState, SignalStateBy, Workstream } from '../../shared/types';
import { getDb } from './database';
import { markDirty } from './persistence';
import { isSafeGitRef } from './git-safety';
import { listWorkstreams } from './workstream-service';
import { importersOf } from './importers';
import { intentFiles } from './intent-service';
import { computeSignals, contractCandidates, importableName, reconcileSignals, type ContractChange, type FootprintInput } from './awareness-signals';

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
    ...(r[9] ? { stateBy: JSON.parse(r[9] as string) as SignalStateBy } : {}),
    ...(r[10] != null ? { stateAt: r[10] as number } : {}),
  };
}

const COLUMNS = 'id, kind, severity, subject, workstreams, summary, first_seen, last_seen, state';
const READ_COLUMNS = `${COLUMNS}, state_by, state_at`;

/** Every signal known for a project, resolved ones included. */
export function loadSignals(projectRoot: string): AwarenessSignal[] {
  const res = getDb().exec(`SELECT ${READ_COLUMNS} FROM awareness_signals WHERE project_root = ?`, [projectRoot]);
  return (res[0]?.values ?? []).map(rowToSignal);
}

let onChanged: (projectRoot: string) => void = () => {};

/** Told when a project's signals change. The server broadcasts `awareness-changed`. */
export function setAwarenessListener(listener: (projectRoot: string) => void): void {
  onChanged = listener;
}

/**
 * A workstream's contract changes with who imports each (A2.3). Importers
 * come from the opened project's graph, under the path the project was
 * opened at: every workstream is a checkout of the same repository, so a
 * relative path names the same file in each.
 */
export function contractsOf(projectRoot: string, w: Pick<Workstream, 'changes'>): ContractChange[] {
  return contractCandidates(w.changes.files).map((c) => ({
    ...c,
    importers: importersOf(path.join(projectRoot, c.file), [importableName(c.symbol)])
      .map((i) => ({ path: i.relativePath, possibly: i.possibly })),
  }));
}

/**
 * The footprints of a repository's active workstreams, with what main did
 * since each branched and, given the project, who imports what each changed.
 */
export function footprintsOf(all: readonly Workstream[], projectRoot?: string): FootprintInput[] {
  const main = all.find((w) => w.main);
  const mainRef = main?.branch ?? main?.head ?? null;
  return all.filter((w) => !w.idle).map((w) => ({
    root: w.root,
    branch: w.branch,
    main: w.main,
    files: w.changes.files,
    // A branch workstream has no folder of its own: git runs in the main checkout.
    mainSinceBase: w.main ? [] : mainChangesSince(w.shape === 'branch' && main ? main.root : w.root, w.changes.base, mainRef),
    ...(projectRoot ? { contracts: contractsOf(projectRoot, w) } : {}),
    ...(w.intents?.length ? { intended: declaredFiles(w.intents) } : {}),
  }));
}

/**
 * Where a bare symbol name is defined in a project, relative, for an intent
 * that names a function without saying which file (A2.4). At most `limit`.
 */
export function filesDefining(projectRoot: string, name: string, limit = 5): string[] {
  const root = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
  const res = getDb().exec(
    `SELECT DISTINCT f.relative_path FROM symbols s JOIN files f ON s.file_id = f.id
      WHERE s.name = ? AND substr(f.path, 1, ?) = ? ORDER BY f.relative_path LIMIT ?`,
    [name, root.length, root, limit],
  );
  return (res[0]?.values ?? []).map((r) => r[0] as string);
}

/** The files a workstream's agents declared, merged across its sessions (A2.4). */
export function declaredFiles(intents: NonNullable<Workstream['intents']>): Array<{ path: string; symbols: string[] }> {
  const merged = new Map<string, Set<string>>();
  for (const i of intents) {
    for (const f of intentFiles(i)) {
      const set = merged.get(f.path) ?? new Set<string>();
      f.symbols.forEach((s) => set.add(s));
      merged.set(f.path, set);
    }
  }
  return [...merged].map(([p, s]) => ({ path: p, symbols: [...s].sort() })).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Recompute a project's signals and store what changed. Returns true when
 * anything did, after telling the listener. `projectRoot` is already
 * confined by the caller.
 */
export function refreshSignals(projectRoot: string, now = Date.now()): boolean {
  const drafts = computeSignals(footprintsOf(listWorkstreams(projectRoot, { includeIdle: true, fresh: true }), projectRoot));
  const { upserts, resolved } = reconcileSignals(loadSignals(projectRoot), drafts, now);
  if (upserts.length === 0 && resolved.length === 0) return false;

  const db = getDb();
  for (const s of upserts) {
    db.run(
      `INSERT INTO awareness_signals (${COLUMNS}, project_root, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         severity = excluded.severity, subject = excluded.subject, workstreams = excluded.workstreams,
         summary = excluded.summary, last_seen = excluded.last_seen, resolved_at = NULL,
         -- A signal that resolved and came back is open again: whoever
         -- answered it before answered a different occurrence.
         state_by = CASE WHEN awareness_signals.state = excluded.state THEN awareness_signals.state_by END,
         state_at = CASE WHEN awareness_signals.state = excluded.state THEN awareness_signals.state_at END,
         state = excluded.state`,
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

/**
 * A person's answer to a signal (A1.8): seen, meant, not worth attention, or
 * back to open. Only a live signal of this project can be answered; a
 * resolved one has nothing left to answer. `by` comes from how the call
 * arrived (`actorFrom`), never from what was sent. Returns the signal as it
 * now stands, or null when there is no such live signal.
 *
 * The answer holds while the signal keeps firing (`reconcileSignals` keeps
 * the state); when its cause goes and comes back it is open again.
 */
export function setSignalState(
  projectRoot: string, id: string, state: SettableSignalState, by: SignalStateBy, now = Date.now(),
): AwarenessSignal | null {
  const signal = loadSignals(projectRoot).find((s) => s.id === id && s.state !== 'resolved');
  if (!signal) return null;
  getDb().run(
    'UPDATE awareness_signals SET state = ?, state_by = ?, state_at = ? WHERE id = ? AND project_root = ?',
    [state, JSON.stringify(by), now, id, projectRoot],
  );
  markDirty();
  onChanged(projectRoot);
  return { ...signal, state, stateBy: by, stateAt: now };
}
