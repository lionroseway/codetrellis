import { execFileSync } from 'node:child_process';
import { assertSafeGitRef } from './git-safety';
import { getDb, getDependencyEdges, getAllFileHashes } from './database';
import { getBaseline, diffSnapshots, captureSnapshot, type GraphSnapshot, type ArchDiff } from './diff-engine';
import { getSnapshot, listSnapshots } from './trellis-service';
import path from 'node:path';

/**
 * Snapshot selection and comparison — Phase 25.
 *
 * See [docs/PHASE-25-REVIEW-AND-PLAYBACK.md](../../../docs/PHASE-25-REVIEW-AND-PLAYBACK.md).
 *
 * Lets a user pick **any two points** and see how the architecture
 * changed between them. Until now "Diff" meant one specific comparison
 * — live against the pinned baseline — which is also why the four
 * trellis modes never read as four distinct things: the chrome could
 * never say what it was showing, because the comparands were implicit.
 *
 * Making them explicit is most of what makes Diff legible.
 */

export type ComparandSpec =
  /** The working tree as last scanned. */
  | 'live'
  /** The pinned baseline. */
  | 'baseline'
  /** `checkpoint:<id>` — a stored trellis snapshot. */
  | `checkpoint:${string}`
  /** `commit:<ref>` — any git ref. See the caveat on edges. */
  | `commit:${string}`;

export interface ResolvedComparand {
  spec: string;
  label: string;
  snapshot: GraphSnapshot;
  /**
   * False when the comparand's edges could not be reconstructed.
   *
   * A git commit is the case that matters: reading its file list is
   * cheap (`git ls-tree`), but knowing its *edges* would mean checking
   * the tree out and re-parsing every file in it. Rather than pretend,
   * a commit comparand reports files only, and the diff says edges were
   * not comparable instead of quietly reporting "no edges changed" —
   * which would read as a finding rather than an absence.
   */
  edgesKnown: boolean;
}

export interface ComparisonResult {
  before: { spec: string; label: string; fileCount: number; edgesKnown: boolean };
  after: { spec: string; label: string; fileCount: number; edgesKnown: boolean };
  diff: ArchDiff;
  /** True only when BOTH sides know their edges. */
  edgesComparable: boolean;
  notes: string[];
}

// ── Resolving a comparand ────────────────────────────────────────────

/** The live state, from the scanned database. */
function liveSnapshot(projectPath: string): GraphSnapshot {
  const hashes = getAllFileHashes();
  const fileData = [...hashes.entries()].map(([absPath, hash]) => ({
    path: absPath.startsWith('/') ? path.relative(projectPath, absPath) : absPath,
    hash,
    symbolCount: 0,
  }));
  return captureSnapshot(fileData, getDependencyEdges());
}

/** A stored trellis checkpoint. */
function checkpointSnapshot(id: number): GraphSnapshot | null {
  const stored = getSnapshot(id);
  if (!stored) return null;

  const files = new Map<string, { hash: string; symbolCount: number }>();
  for (const f of stored.data.files) {
    files.set(f.path, { hash: f.contentHash, symbolCount: f.symbolCount });
  }
  const edges = new Set<string>();
  for (const e of stored.data.edges) edges.add(`${e.source}->${e.target}`);

  return { timestamp: stored.createdAt, files, edges };
}

/**
 * A git commit, files only.
 *
 * `git ls-tree -r` gives every path with its blob hash, which is exactly
 * a content hash — so added / removed / modified files are exact. Edges
 * are not available; see `edgesKnown`.
 */
function commitSnapshot(projectPath: string, ref: string): GraphSnapshot | null {
  assertSafeGitRef(ref, 'snapshot comparand');
  let out: string;
  try {
    out = execFileSync('git', ['ls-tree', '-r', ref], {
      cwd: projectPath,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }

  const files = new Map<string, { hash: string; symbolCount: number }>();
  for (const line of out.split('\n')) {
    // <mode> <type> <sha>\t<path>
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const filePath = line.slice(tab + 1);
    if (meta[1] !== 'blob') continue;
    files.set(filePath, { hash: meta[2], symbolCount: 0 });
  }
  if (files.size === 0) return null;

  return { timestamp: Date.now(), files, edges: new Set<string>() };
}

/**
 * Resolve a comparand spec to a snapshot. Null when it names something
 * that does not exist — an unknown checkpoint, an unreachable ref.
 */
export function resolveComparand(spec: string, projectPath: string): ResolvedComparand | null {
  if (spec === 'live') {
    return { spec, label: 'Live', snapshot: liveSnapshot(projectPath), edgesKnown: true };
  }

  if (spec === 'baseline') {
    const baseline = getBaseline();
    if (!baseline) return null;
    const label = baseline.shortCommitHash ? `Baseline (${baseline.shortCommitHash})` : 'Baseline';
    return { spec, label, snapshot: baseline, edgesKnown: true };
  }

  if (spec.startsWith('checkpoint:')) {
    const id = Number(spec.slice('checkpoint:'.length));
    if (!Number.isInteger(id)) return null;
    const snapshot = checkpointSnapshot(id);
    if (!snapshot) return null;
    const meta = listSnapshots().find((s) => s.id === id);
    return { spec, label: meta?.name ?? `Checkpoint ${id}`, snapshot, edgesKnown: true };
  }

  if (spec.startsWith('commit:')) {
    const ref = spec.slice('commit:'.length);
    const snapshot = commitSnapshot(projectPath, ref);
    if (!snapshot) return null;
    return { spec, label: `Commit ${ref}`, snapshot, edgesKnown: false };
  }

  return null;
}

/** Everything a picker needs to offer. */
export function listComparands(projectPath: string): Array<{ spec: string; label: string; kind: string }> {
  const out: Array<{ spec: string; label: string; kind: string }> = [
    { spec: 'live', label: 'Live (working tree)', kind: 'live' },
  ];

  if (getBaseline()) out.push({ spec: 'baseline', label: 'Baseline', kind: 'baseline' });

  for (const snap of listSnapshots()) {
    out.push({ spec: `checkpoint:${snap.id}`, label: snap.name, kind: 'checkpoint' });
  }

  // Recent commits, so the common case needs no typing.
  try {
    const log = execFileSync('git', ['log', '-20', '--format=%h\t%s'], {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    for (const line of log.split('\n')) {
      const [sha, subject] = line.split('\t');
      if (!sha) continue;
      out.push({ spec: `commit:${sha}`, label: `${sha} ${subject ?? ''}`.trim(), kind: 'commit' });
    }
  } catch {
    /* not a git repo, or no commits yet */
  }

  return out;
}

// ── Comparing ────────────────────────────────────────────────────────

export function compareSnapshots(
  beforeSpec: string,
  afterSpec: string,
  projectPath: string,
): { ok: true; result: ComparisonResult } | { ok: false; error: string } {
  const before = resolveComparand(beforeSpec, projectPath);
  if (!before) return { ok: false, error: `Could not resolve "${beforeSpec}"` };

  const after = resolveComparand(afterSpec, projectPath);
  if (!after) return { ok: false, error: `Could not resolve "${afterSpec}"` };

  const diff = diffSnapshots(before.snapshot, after.snapshot);
  const edgesComparable = before.edgesKnown && after.edgesKnown;

  const notes: string[] = [];
  if (!edgesComparable) {
    // Say it plainly. Reporting zero edge changes for a comparison that
    // never looked at edges would read as a finding rather than an
    // absence, which is worse than saying nothing.
    notes.push(
      'Edges were not compared: a git commit contributes its file list only. ' +
        'Reconstructing its edges would mean checking the tree out and re-parsing it. ' +
        'Compare against a checkpoint to include edges.',
    );
  }
  if (beforeSpec === afterSpec) {
    notes.push('Both sides are the same point, so the diff is empty by construction.');
  }

  return {
    ok: true,
    result: {
      before: {
        spec: before.spec,
        label: before.label,
        fileCount: before.snapshot.files.size,
        edgesKnown: before.edgesKnown,
      },
      after: {
        spec: after.spec,
        label: after.label,
        fileCount: after.snapshot.files.size,
        edgesKnown: after.edgesKnown,
      },
      // Edge fields are zeroed rather than left misleading when the
      // comparison could not see edges.
      diff: edgesComparable
        ? diff
        : {
            ...diff,
            addedEdges: [],
            removedEdges: [],
            blastRadius: [],
            summary: { ...diff.summary, edgesAdded: 0, edgesRemoved: 0 },
          },
      edgesComparable,
      notes,
    },
  };
}

/** Unused import guard — `getDb` is kept for future per-scope queries. */
void getDb;
