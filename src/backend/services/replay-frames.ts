/**
 * Replay frames (Phase 32 B5.1, observability doc §6.2 and §6.4).
 *
 * Replay steps between recorded moments, never animating in between, so it
 * needs a graph at each moment worth stepping to. Checkpoints were the only
 * snapshots, taken when a person pressed a button or a plan was approved.
 * This takes one at three natural moments, for any MCP client alike:
 *
 *  - **a turn ends**: a session goes quiet for `TURN_GAP_MS`, the rule the
 *    Timeline groups turns by, so no client's own notion of a turn is needed;
 *  - **an item's status changes**, from the window, an agent or a plan file;
 *  - **a commit lands** on a workstream: its checkout's HEAD moved.
 *
 * Four rules keep it honest and cheap:
 *
 *  - **Only the project the server holds.** The graph is the one project
 *    last scanned. A frame for any other project is refused, never scanned
 *    for: a frame must not switch the project under the window. During a
 *    scan the files table is being rewritten, so the frame waits for it.
 *  - **At most one per project every `FRAME_INTERVAL_MS`.** Moments inside
 *    that window become one frame that names all of them (trailing, so the
 *    last moment is never lost).
 *  - **An unchanged graph is not copied.** Each frame has a digest of its
 *    files and edges; one matching the frame before points at the frame
 *    that holds the copy (`same_as`) and stores none.
 *  - **Kept 14 days**, like the agent event log; a frame another still
 *    points at is kept until nothing does.
 *
 * Frames live in `trellis_snapshots` as `snapshot_type = 'frame'`, so
 * `getSnapshot` and the diff against now work on them as on checkpoints;
 * the checkpoint list leaves them out.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { getDb } from './database';
import { markDirty } from './persistence';
import { currentBranch } from './git-checkout';
import { readLiveGraph, type TrellisSnapshotData } from './trellis-service';
import { watchRefs } from './workstream-watch-service';
import { retentionCutoff } from './retention';
import { TURN_GAP_MS } from '../../shared/lib/turn-gap';

export type FrameReason = 'turn-end' | 'status' | 'commit';

/** One moment that asks for a frame. */
export interface FrameTrigger {
  projectPath: string;
  reason: FrameReason;
  /** What it was about: the item for a status change, the commit for a commit. */
  ref?: string | null;
  sessionId?: string | null;
  agentType?: string | null;
  workstreamRoot?: string | null;
  /** For a commit: the commit that landed. Otherwise the project's HEAD is read. */
  commitSha?: string | null;
}

export interface ReplayFrame {
  id: number;
  at: number;
  projectPath: string;
  /** Every moment this frame stands for, in the order they happened. */
  reasons: FrameReason[];
  ref: string | null;
  sessionId: string | null;
  agentType: string | null;
  workstreamRoot: string | null;
  /** The commit: the one that landed, or the project's HEAD when taken. */
  commitSha: string | null;
  branch: string | null;
  digest: string;
  /** The frame whose graph this one shares, when nothing changed. */
  sameAs: number | null;
  fileCount: number;
  edgeCount: number;
}

export type FrameSkip = 'other-project' | 'scanning';

/** Test knobs, read when used: the harness cannot wait 30 s for a turn to end. */
export const frameIntervalMs = (): number => Number(process.env.CODETRELLIS_FRAME_INTERVAL_MS) || 10_000;
export const turnGapMs = (): number => Number(process.env.CODETRELLIS_TURN_GAP_MS) || TURN_GAP_MS;

export const DEFAULT_FRAME_LIMIT = 500;
export const MAX_FRAME_LIMIT = 2000;

const trimRoot = (p: string): string => p.replace(/[\\/]+$/, '');

// ── What server.ts hands over ───────────────────────────────────────

/** The project the server holds, and the one being scanned, if any. */
export interface HeldProject { path: string | null; scanning: string | null }
let held: () => HeldProject = () => ({ path: null, scanning: null });
export function setHeldProject(fn: () => HeldProject): void { held = fn; }

type Publish = (type: string, payload: unknown) => void;
let publisher: Publish | null = null;
export function setFramePublisher(fn: Publish | null): void { publisher = fn; }

// ── Pure parts (unit-tested) ────────────────────────────────────────

/**
 * A digest of a graph, the same whatever order its files and edges came
 * in: two frames with equal digests show the same graph.
 */
export function graphDigest(graph: TrellisSnapshotData): string {
  const files = graph.files.map((f) => `${f.path}\u0000${f.contentHash}`).sort();
  const edges = graph.edges.map((e) => `${e.source}\u0000${e.target}\u0000${[...e.specifiers].sort().join(',')}`).sort();
  return createHash('sha256').update(files.join('\n')).update('\u0001').update(edges.join('\n')).digest('hex');
}

/**
 * Several moments inside one interval, as one frame: every reason once, in
 * order; the latest session, workstream and ref any of them named; the
 * commit that landed, if one did.
 */
export function mergeTriggers(triggers: readonly FrameTrigger[]): FrameTrigger & { reasons: FrameReason[] } {
  const reasons: FrameReason[] = [];
  const merged: FrameTrigger & { reasons: FrameReason[] } = { projectPath: triggers[0].projectPath, reason: triggers[0].reason, reasons };
  for (const t of triggers) {
    if (!reasons.includes(t.reason)) reasons.push(t.reason);
    if (t.ref) merged.ref = t.ref;
    if (t.sessionId) { merged.sessionId = t.sessionId; merged.agentType = t.agentType ?? null; }
    if (t.workstreamRoot) merged.workstreamRoot = t.workstreamRoot;
    if (t.commitSha) merged.commitSha = t.commitSha;
  }
  return merged;
}

/** Whether a frame of `projectPath` may be taken now. */
export function frameRefusal(projectPath: string, now: HeldProject): FrameSkip | null {
  if (now.scanning) return 'scanning';
  if (!now.path || trimRoot(now.path) !== trimRoot(projectPath)) return 'other-project';
  return null;
}

/** Whether the server's graph is `projectPath`'s now (held, and no scan running). */
export function holdsProject(projectPath: string): boolean {
  return frameRefusal(projectPath, held()) === null;
}

// ── Taking a frame ──────────────────────────────────────────────────

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function headSha(root: string): string | null {
  const out = git(root, ['rev-parse', 'HEAD'])?.trim() ?? '';
  return /^[0-9a-f]{40,64}$/.test(out) ? out : null;
}

const canonical = (p: string): string => {
  try { return fs.realpathSync(p); } catch { return trimRoot(p); }
};

/**
 * Each checkout of the repository at `project`, with its HEAD, from
 * `git worktree list`. Read from git alone on purpose: `listWorkstreams`
 * also reads the project's config, and doing that during a scan cached it
 * before a config written just after could be seen (webhook-ssrf's control
 * test caught it).
 */
export function parseWorktreeList(porcelain: string): Map<string, string> {
  const heads = new Map<string, string>();
  for (const block of porcelain.split(/\n\s*\n/)) {
    const root = /^worktree (.+)$/m.exec(block)?.[1];
    const head = /^HEAD ([0-9a-f]{40,64})$/m.exec(block)?.[1];
    if (root && head && !/^bare$/m.test(block)) heads.set(root, head);
  }
  return heads;
}

function checkoutHeads(project: string): Map<string, string> {
  const out = git(project, ['worktree', 'list', '--porcelain']);
  return out ? parseWorktreeList(out) : new Map();
}

/** Take a frame now, if the server holds `m.projectPath` and is not scanning. */
export function takeFrame(m: FrameTrigger & { reasons?: FrameReason[] }): ReplayFrame | FrameSkip {
  const refusal = frameRefusal(m.projectPath, held());
  if (refusal) return refusal;

  const db = getDb();
  const project = trimRoot(m.projectPath);
  const reasons = m.reasons ?? [m.reason];
  const graph = readLiveGraph();
  const digest = graphDigest(graph);

  const last = db.exec(
    `SELECT id, digest, same_as FROM trellis_snapshots
     WHERE snapshot_type = 'frame' AND project_path = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [project],
  )[0]?.values[0];
  const sameAs = last && last[1] === digest ? ((last[2] as number | null) ?? (last[0] as number)) : null;

  const commitSha = m.commitSha ?? headSha(m.projectPath);
  const branch = currentBranch(m.projectPath);
  const at = Date.now();
  db.run(
    `INSERT INTO trellis_snapshots
       (name, snapshot_type, plan_uid, git_branch, files_json, edges_json, created_at,
        project_path, reason, ref, session_id, agent_type, workstream_root, commit_sha, digest, same_as)
     VALUES (?, 'frame', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `Frame: ${reasons.join(', ')}`, branch,
      sameAs ? '[]' : JSON.stringify(graph.files), sameAs ? '[]' : JSON.stringify(graph.edges), at,
      project, reasons.join(','), m.ref ?? null, m.sessionId ?? null, m.agentType ?? null,
      m.workstreamRoot ?? null, commitSha, digest, sameAs,
    ],
  );
  const id = (db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] as number) || 0;
  markDirty();

  const frame: ReplayFrame = {
    id, at, projectPath: project, reasons, ref: m.ref ?? null, sessionId: m.sessionId ?? null,
    agentType: m.agentType ?? null, workstreamRoot: m.workstreamRoot ?? null, commitSha, branch,
    digest, sameAs, fileCount: graph.files.length, edgeCount: graph.edges.length,
  };
  try { publisher?.('replay-frame', frame); } catch { /* a frame is kept whether or not anyone hears of it */ }
  return frame;
}

// ── One frame per interval per project ──────────────────────────────

const lastFrameAt = new Map<string, number>();
const pending = new Map<string, { triggers: FrameTrigger[]; timer: ReturnType<typeof setTimeout> }>();

/**
 * Ask for a frame. It is taken on the next tick, or when the project's
 * interval since its last frame is up; every moment asked for until then is
 * part of it. Never throws.
 */
export function requestFrame(trigger: FrameTrigger): void {
  if (!trigger.projectPath) return;
  const key = trimRoot(trigger.projectPath);
  const open = pending.get(key);
  if (open) { open.triggers.push(trigger); return; }
  const wait = Math.max(0, (lastFrameAt.get(key) ?? 0) + frameIntervalMs() - Date.now());
  const timer = setTimeout(() => flush(key), wait);
  timer.unref?.();
  pending.set(key, { triggers: [trigger], timer });
}

function flush(key: string): void {
  const open = pending.get(key);
  pending.delete(key);
  if (!open) return;
  lastFrameAt.set(key, Date.now());
  try {
    const result = takeFrame(mergeTriggers(open.triggers));
    // A scan rewrites the files table; the moments wait for it rather than be lost.
    if (result === 'scanning') for (const t of open.triggers) requestFrame(t);
  } catch (err) {
    console.warn('[Replay] Frame not taken:', err instanceof Error ? err.message : err);
  }
}

// ── Turn ends ───────────────────────────────────────────────────────

const turns = new Map<string, ReturnType<typeof setTimeout>>();

/** Whether `root` is the held project or one of its checkouts. */
function heldProjectOf(root: string | null): string | null {
  const project = held().path;
  if (!project) return null;
  if (!root || trimRoot(root) === trimRoot(project)) return project;
  const target = canonical(root);
  return [...checkoutHeads(project).keys()].some((r) => canonical(r) === target) ? project : null;
}

/**
 * A recorded agent event: its session's turn goes on. When the session is
 * quiet for `turnGapMs()`, the turn has ended and a frame is asked for, for
 * the held project if the session works in it.
 */
export function noteAgentActivity(e: { sessionId: string | null; agentType: string | null; workstreamRoot: string | null }): void {
  const key = e.sessionId ?? (e.workstreamRoot ? `workstream:${e.workstreamRoot}` : null);
  if (!key) return;
  const running = turns.get(key);
  if (running) clearTimeout(running);
  const timer = setTimeout(() => {
    turns.delete(key);
    const project = heldProjectOf(e.workstreamRoot);
    if (project) {
      requestFrame({
        projectPath: project, reason: 'turn-end',
        sessionId: e.sessionId, agentType: e.agentType, workstreamRoot: e.workstreamRoot,
      });
    }
  }, turnGapMs());
  timer.unref?.();
  turns.set(key, timer);
}

// ── Commits ─────────────────────────────────────────────────────────

/** Each checkout's HEAD as last seen, for the held project. */
const heads = new Map<string, string>();

/** The held project changed: note each checkout's HEAD, so the next move is a commit. */
export function seedHeads(project: string | null): void {
  heads.clear();
  if (!project) return;
  for (const [root, head] of checkoutHeads(project)) heads.set(root, head);
  // The refs watcher starts when workstreams are first listed; a commit
  // frame should not wait for someone to open the strip.
  watchRefs(project).catch(() => { /* not a git project */ });
}

/**
 * The repository's refs moved. Each checkout of the held project whose HEAD
 * moved has had a commit land (or a checkout or reset, which moves what the
 * graph shows just the same): one frame for each.
 */
export function noteRefsChanged(): void {
  const project = held().path;
  if (!project) return;
  const now = checkoutHeads(project);
  for (const [root, head] of now) {
    const before = heads.get(root);
    if (before && before !== head) {
      requestFrame({ projectPath: project, reason: 'commit', ref: head, commitSha: head, workstreamRoot: root });
    }
  }
  heads.clear();
  for (const [root, head] of now) heads.set(root, head);
}

// ── Reading frames ──────────────────────────────────────────────────

export interface FrameQuery { from?: number; to?: number; limit?: number; newestFirst?: boolean }

/** A project's frames between two times, oldest first (or newest first). */
/**
 * Who CodeTrellis saw working when each of these commits landed (Phase 32
 * E3): the agent and session a commit frame recorded beside it, by full sha.
 */
export function framesByCommit(projectPath: string, shas: readonly string[]): Map<string, { agentType: string | null; sessionId: string | null; workstreamRoot: string | null }> {
  const out = new Map<string, { agentType: string | null; sessionId: string | null; workstreamRoot: string | null }>();
  const wanted = shas.filter((s) => /^[0-9a-f]{40,64}$/.test(s));
  for (let i = 0; i < wanted.length; i += 200) {
    const batch = wanted.slice(i, i + 200);
    const rows = getDb().exec(
      `SELECT commit_sha, agent_type, session_id, workstream_root FROM trellis_snapshots
       WHERE snapshot_type = 'frame' AND project_path = ? AND commit_sha IN (${batch.map(() => '?').join(',')})
       ORDER BY created_at ASC`,
      [trimRoot(projectPath), ...batch],
    )[0]?.values ?? [];
    for (const r of rows as unknown[][]) {
      const prior = out.get(r[0] as string);
      // The frame that named an agent wins over one that did not.
      if (prior?.agentType && !r[1]) continue;
      out.set(r[0] as string, { agentType: (r[1] as string | null) ?? null, sessionId: (r[2] as string | null) ?? null, workstreamRoot: (r[3] as string | null) ?? null });
    }
  }
  return out;
}

export function listFrames(projectPath: string, q: FrameQuery = {}): ReplayFrame[] {
  const where = [`t.snapshot_type = 'frame'`, 't.project_path = ?'];
  const params: Array<string | number> = [trimRoot(projectPath)];
  if (Number.isFinite(q.from)) { where.push('t.created_at >= ?'); params.push(q.from as number); }
  if (Number.isFinite(q.to)) { where.push('t.created_at <= ?'); params.push(q.to as number); }
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? DEFAULT_FRAME_LIMIT)), MAX_FRAME_LIMIT);
  params.push(limit);
  const rows = getDb().exec(
    `SELECT t.id, t.created_at, t.project_path, t.reason, t.ref, t.session_id, t.agent_type, t.workstream_root,
            t.commit_sha, t.git_branch, t.digest, t.same_as,
            json_array_length(COALESCE(o.files_json, t.files_json)), json_array_length(COALESCE(o.edges_json, t.edges_json))
     FROM trellis_snapshots t LEFT JOIN trellis_snapshots o ON o.id = t.same_as
     WHERE ${where.join(' AND ')} ORDER BY t.created_at ${q.newestFirst ? 'DESC' : 'ASC'}, t.id ${q.newestFirst ? 'DESC' : 'ASC'} LIMIT ?`,
    params,
  )[0]?.values ?? [];
  return rows.map((r: unknown[]) => ({
    id: r[0] as number,
    at: r[1] as number,
    projectPath: r[2] as string,
    reasons: String(r[3] ?? '').split(',').filter(Boolean) as FrameReason[],
    ref: (r[4] as string | null) ?? null,
    sessionId: (r[5] as string | null) ?? null,
    agentType: (r[6] as string | null) ?? null,
    workstreamRoot: (r[7] as string | null) ?? null,
    commitSha: (r[8] as string | null) ?? null,
    branch: (r[9] as string | null) ?? null,
    digest: String(r[10] ?? ''),
    sameAs: (r[11] as number | null) ?? null,
    fileCount: Number(r[12]) || 0,
    edgeCount: Number(r[13]) || 0,
  }));
}

// ── Keeping ─────────────────────────────────────────────────────────

/** Drop frames older than the retention window that no kept frame points at. */
export function pruneFrames(now = Date.now()): number {
  // The window the person set (B10.2); keeping everything prunes nothing.
  const cutoff = retentionCutoff(now);
  if (cutoff === null) return 0;
  const db = getDb();
  const before = Number(db.exec(`SELECT COUNT(*) FROM trellis_snapshots WHERE snapshot_type = 'frame'`)[0]?.values[0]?.[0]) || 0;
  db.run(
    `DELETE FROM trellis_snapshots WHERE snapshot_type = 'frame' AND created_at < ?
       AND id NOT IN (SELECT same_as FROM trellis_snapshots WHERE same_as IS NOT NULL AND created_at >= ?)`,
    [cutoff, cutoff],
  );
  const after = Number(db.exec(`SELECT COUNT(*) FROM trellis_snapshots WHERE snapshot_type = 'frame'`)[0]?.values[0]?.[0]) || 0;
  // Signal spans (B5.2) last as long, counted from when they closed.
  db.run('DELETE FROM awareness_signal_spans WHERE closed_at IS NOT NULL AND closed_at < ?', [cutoff]);
  if (after !== before) markDirty();
  return before - after;
}

let pruneTimer: ReturnType<typeof setInterval> | null = null;

/** Index the frame columns (added by the reconciler on older databases) and prune hourly. */
export function startReplayFrames(): void {
  getDb().run('CREATE INDEX IF NOT EXISTS idx_trellis_frames ON trellis_snapshots(project_path, created_at)');
  pruneFrames();
  if (!pruneTimer) {
    pruneTimer = setInterval(() => { try { pruneFrames(); } catch { /* next hour */ } }, 60 * 60 * 1000);
    pruneTimer.unref?.();
  }
}
