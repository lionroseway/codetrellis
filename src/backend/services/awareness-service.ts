/**
 * The awareness engine's plumbing (Phase 32 A1.6): gather footprints, run
 * the pure `computeSignals`, keep the result in `awareness_signals`, and say
 * so when it moves (awareness spec §5.4).
 *
 * Signals have their own table and broadcast. They are not channel events:
 * those are exported into the plan manifest, the wrong home for a collision
 * that lasts ten minutes.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AwarenessSignal, SettableSignalState, SignalState, SignalStateBy, Workstream } from '../../shared/types';
import { getDb } from './database';
import { recordDecision } from './agent-event-log';
import { markDirty } from './persistence';
import { isSafeGitRef } from './git-safety';
import { gitAsync } from './git-env';
import { coalesced } from './coalesce';
import { listWorkstreams } from './workstream-service';
import { importersOf } from './importers';
import { intentFiles } from './intent-service';
import { computeSignals, contractCandidates, importableName, reconcileSignals, newlySerious, type ContractChange, type FootprintInput, type WorkstreamScope } from './awareness-signals';
import { pushForSignal } from './push-notification-service';
import { computeMaterialSignals } from './material-signals';
import { materialInputsOf } from './material-footprints';
import { stateSplitDrafts } from './task-records/split-signals';
import { checkEdges, rulesOf } from './architecture-rules';
import { ruleStatement } from './architecture-rule';
import { importsAdded, importsReadableFor } from './workstream-imports';
import type { FileSpec } from '../../shared/types';

const SHA = /^[0-9a-f]{40}$/;

/**
 * Files main changed between a workstream's merge base and main's tip. Never
 * throws; both refs are checked before git sees them.
 */
export async function mainChangesSince(folder: string, base: string | null, mainRef: string | null): Promise<string[]> {
  if (!base || !SHA.test(base) || !mainRef || !isSafeGitRef(mainRef)) return [];
  try {
    return (await gitAsync(folder, ['diff', '--name-only', '-z', base, mainRef, '--'])).split('\0').filter(Boolean);
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
    ...(r[11] ? { shape: r[11] as string } : {}),
    ...(r[12] ? { reopened: { from: r[12] as 'acknowledged' | 'intended', at: r[13] as number } } : {}),
  };
}

const COLUMNS = 'id, kind, severity, subject, workstreams, summary, first_seen, last_seen, state';
const READ_COLUMNS = `${COLUMNS}, state_by, state_at, shape, reopened_from, reopened_at`;

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
export async function footprintsOf(all: readonly Workstream[], projectRoot?: string): Promise<FootprintInput[]> {
  const main = all.find((w) => w.main);
  const mainRef = main?.branch ?? main?.head ?? null;
  const out: FootprintInput[] = [];
  for (const w of all.filter((x) => !x.idle)) {
    out.push({
      root: w.root,
      branch: w.branch,
      main: w.main,
      files: w.changes.files,
      // A branch workstream has no folder of its own: git runs in the main checkout.
      mainSinceBase: w.main ? [] : await mainChangesSince(w.shape === 'branch' && main ? main.root : w.root, w.changes.base, mainRef),
      ...(projectRoot ? { contracts: contractsOf(projectRoot, w) } : {}),
      ...(w.intents?.length ? { intended: declaredFiles(w.intents) } : {}),
      ...scopeEntry(scopeOf(w)),
      ...(projectRoot ? await ruleEntry(projectRoot, w, main?.root ?? null) : {}),
      ...(projectRoot && scopeOf(w) ? rulesAboutEntry(projectRoot) : {}),
    });
  }
  return out;
}

/**
 * The imports a workstream adds across the project's architecture rules
 * (A7.2). Only for the project whose import context is held, since resolving
 * needs its aliases and systems; and only when it has rules, so a project
 * without any parses nothing more.
 */
async function ruleEntry(projectRoot: string, w: Workstream, mainRoot: string | null): Promise<Pick<FootprintInput, 'ruleBreaches'>> {
  const rules = rulesOf(projectRoot);
  if (rules.length === 0 || w.changes.files.length === 0) return {};
  if (!importsReadableFor(projectRoot)) return {};
  const breaches = checkEdges(rules, await importsAdded(projectRoot, w, mainRoot, { packages: true, symbols: rules.some((r) => r.kind === 'symbol'), calls: rules.some((r) => r.kind === 'calls'), files: rules.some((r) => r.kind === 'folder'), grep: rules.filter((r) => r.kind === 'grep' && r.strength !== 'guide') }));
  if (breaches.length === 0) return {};
  return {
    ruleBreaches: rules
      .map((rule) => ({ rule, edges: breaches.filter((b) => b.rule === rule.id).map((b) => ({ from: b.from, to: b.to })) }))
      .filter((r) => r.edges.length > 0),
  };
}

const scopeEntry = (scope: WorkstreamScope | null) => (scope ? { scope } : {});

/** Phase 33 R9: the project's rules in words, for drift to name the ones it reaches. */
function rulesAboutEntry(projectRoot: string): Pick<FootprintInput, 'rules'> {
  const rules = rulesOf(projectRoot);
  if (rules.length === 0) return {};
  return { rules: rules.map((r) => ({ id: r.id, suite: r.suite, words: ruleStatement(r), strength: r.strength, kind: r.kind, from: r.from, mayNotImport: r.mayNotImport, only: r.only, ...(r.in ? { in: r.in, except: r.except } : {}) })) };
}

/**
 * What a workstream was given to change (A2.5): the files and folders of the
 * items its agents have claimed and not finished, and what they declared.
 * Null when nothing was given, so there is nothing to drift from.
 */
export function scopeOf(w: Pick<Workstream, 'agents' | 'intents'>): WorkstreamScope | null {
  const sessions = w.agents.map((a) => a.sessionId);
  const paths = new Set<string>();
  const dirs = new Set<string>();
  const items: string[] = [];
  if (sessions.length) {
    const res = getDb().exec(
      `SELECT uid, file_specs, scope_path FROM plan_items
        WHERE assignee_session IN (${sessions.map(() => '?').join(',')})
          AND COALESCE(status, '') NOT IN ('done', 'skipped')`,
      sessions,
    );
    for (const [uid, specsJson, scopePath] of res[0]?.values ?? []) {
      let specs: FileSpec[] = [];
      try { specs = JSON.parse((specsJson as string) || '[]') as FileSpec[]; } catch { /* unreadable: no scope from it */ }
      const before = paths.size + dirs.size;
      for (const s of specs) {
        const clean = (p: string) => p.replace(/^\.\//, '');
        (s.isDir ? dirs : paths).add(clean(s.path));
        if (s.moveTo) paths.add(clean(s.moveTo));
      }
      if (typeof scopePath === 'string' && scopePath.trim()) dirs.add(scopePath.trim().replace(/^\.\//, ''));
      if (paths.size + dirs.size > before) items.push(uid as string);
    }
  }
  const declared = declaredFiles(w.intents ?? []);
  for (const f of declared) paths.add(f.path);
  if (paths.size === 0 && dirs.size === 0) return null;
  return { paths: [...paths].sort(), dirs: [...dirs].sort(), items, declared: declared.length > 0 };
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
 * Each opening of a signal as a span, for replay (B5.2). A signal that is
 * new, or came back after resolving, opens a span; one already open keeps
 * its span, with the latest wording; a resolved one closes it. A signal
 * open since before spans were kept opens its span at its first sighting.
 */
function recordSignalSpans(projectRoot: string, previous: readonly AwarenessSignal[], upserts: readonly AwarenessSignal[], resolved: readonly string[], now: number): void {
  const db = getDb();
  const before = new Map(previous.map((s) => [s.id, s]));
  for (const s of upserts) {
    const open = db.exec('SELECT opened_at FROM awareness_signal_spans WHERE signal_id = ? AND closed_at IS NULL', [s.id])[0]?.values[0];
    if (open) {
      db.run('UPDATE awareness_signal_spans SET severity = ?, summary = ?, workstreams = ? WHERE signal_id = ? AND opened_at = ?',
        [s.severity, s.summary, JSON.stringify(s.workstreams), s.id, open[0]]);
      continue;
    }
    const cameBack = before.get(s.id)?.state === 'resolved';
    db.run(
      `INSERT OR IGNORE INTO awareness_signal_spans (signal_id, project_root, kind, severity, summary, workstreams, opened_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [s.id, projectRoot, s.kind, s.severity, s.summary, JSON.stringify(s.workstreams), cameBack ? now : s.firstSeen],
    );
  }
  for (const id of resolved) {
    db.run('UPDATE awareness_signal_spans SET closed_at = ? WHERE signal_id = ? AND closed_at IS NULL', [now, id]);
  }
}

/** One refresh per project at a time, and one after it for whoever asked meanwhile. */
const refreshes = coalesced((projectRoot: string) => runRefresh(projectRoot));

/**
 * Recompute a project's signals and store what changed. Resolves true when
 * anything did, after telling the listener. `projectRoot` is already
 * confined by the caller.
 *
 * Git runs without blocking the server, so a refresh takes as long as it
 * did but no request waits behind it. **One runs at a time per project.** A
 * call while one runs may have just changed something that run already
 * read past, so it waits for one more run after it; every call in that
 * window shares that one, so a burst of changes costs two runs, not one each.
 */
export function refreshSignals(projectRoot: string): Promise<boolean> {
  return refreshes(projectRoot);
}

/**
 * Start a refresh unless one is already running, for a reader that has
 * changed nothing (the window's Awareness tab): what is stored is answered
 * at once, and the listener tells the window if this moves anything.
 */
export function refreshSignalsSoon(projectRoot: string): void {
  (refreshes.running(projectRoot) ?? refreshes(projectRoot)).catch((err) => console.warn('[Awareness] refresh failed:', err));
}

async function runRefresh(projectRoot: string): Promise<boolean> {
  const footprints = await footprintsOf(await listWorkstreams(projectRoot, { includeIdle: true, fresh: true }), projectRoot);
  // From here to the end nothing waits, so no other write lands between
  // reading the stored signals and writing what changed.
  // Tasks' materials in the same pass (A6.3): a refresh reconciles every
  // signal of the project, so computed apart each would resolve the other's.
  const materials = materialInputsOf(projectRoot);
  const drafts = [
    ...computeSignals(footprints),
    ...computeMaterialSignals(materials.tasks, materials.current),
    // Teammates' records that set a task two ways at once (C3.2).
    ...stateSplitDrafts(projectRoot),
  ];
  // Stamped when the answer is known, not when it was asked for: git may
  // have taken a while, and a signal is first seen when it is found.
  const now = Date.now();
  const previous = loadSignals(projectRoot);
  const { upserts, resolved, reopened } = reconcileSignals(previous, drafts, now);
  if (upserts.length === 0 && resolved.length === 0) return false;

  const db = getDb();
  for (const s of upserts) {
    db.run(
      `INSERT INTO awareness_signals (${COLUMNS}, project_root, resolved_at, shape, reopened_from, reopened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         severity = excluded.severity, subject = excluded.subject, workstreams = excluded.workstreams,
         summary = excluded.summary, last_seen = excluded.last_seen, resolved_at = NULL, shape = excluded.shape,
         -- Set when it reopens (A3.2); kept until the person answers again.
         reopened_from = COALESCE(excluded.reopened_from, awareness_signals.reopened_from),
         reopened_at = COALESCE(excluded.reopened_at, awareness_signals.reopened_at),
         -- A signal that resolved and came back is open again: whoever
         -- answered it before answered a different occurrence.
         state_by = CASE WHEN awareness_signals.state = excluded.state THEN awareness_signals.state_by END,
         state_at = CASE WHEN awareness_signals.state = excluded.state THEN awareness_signals.state_at END,
         state = excluded.state`,
      [s.id, s.kind, s.severity, JSON.stringify(s.subject), JSON.stringify(s.workstreams), s.summary,
        s.firstSeen, s.lastSeen, s.state, projectRoot, s.shape ?? null, s.reopened?.from ?? null, s.reopened?.at ?? null],
    );
  }
  // Reopened (A3.2): the agents concerned are told again, their notes kept.
  for (const id of reopened) {
    db.run('UPDATE awareness_signal_notes SET told_at = NULL WHERE signal_id = ?', [id]);
  }
  for (const id of resolved) {
    db.run(`UPDATE awareness_signals SET state = 'resolved', resolved_at = ?, last_seen = ? WHERE id = ?`, [now, now, id]);
  }
  recordSignalSpans(projectRoot, previous, upserts, resolved, now);
  markDirty();
  onChanged(projectRoot);
  // A person away from the desk is told of a serious one (A4.4).
  for (const s of newlySerious(previous, upserts, reopened)) void pushForSignal(s).catch(() => {});
  return true;
}

/**
 * How many signals need the person (A4.2): open, high or medium, as the
 * tab's count. One indexed count, cheap enough for the phone's snapshot,
 * which is built every 100 ms.
 */
export function countNeedsYou(projectRoot: string): number {
  const res = getDb().exec(
    `SELECT COUNT(*) FROM awareness_signals WHERE project_root = ? AND state = 'open' AND severity IN ('high', 'medium')`,
    [projectRoot],
  );
  return Number(res[0]?.values[0]?.[0] ?? 0);
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
  // A new answer replaces the reason it had reopened (A3.2).
  getDb().run(
    'UPDATE awareness_signals SET state = ?, state_by = ?, state_at = ?, reopened_from = NULL, reopened_at = NULL WHERE id = ? AND project_root = ?',
    [state, JSON.stringify(by), now, id, projectRoot],
  );
  markDirty();
  // The row keeps only the latest answer; the record keeps each (B10.1).
  recordDecision('signal_answered', {
    signalId: id, kind: signal.kind, severity: signal.severity, state, projectRoot,
    workstreams: signal.workstreams, summary: signal.summary.slice(0, 200),
    actor: by.actor, actorType: by.actorType, channel: by.channel,
  }, by.actorType);
  onChanged(projectRoot);
  const { reopened: _was, ...rest } = signal;
  return { ...rest, state, stateBy: by, stateAt: now };
}
