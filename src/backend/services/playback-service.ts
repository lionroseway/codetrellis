import { execFileSync } from 'node:child_process';
import { listComparands, resolveComparand } from './snapshot-compare-service';
import { diffSnapshots } from './diff-engine';

/**
 * Fast-forward — Phase 26, layer C.
 *
 * See [docs/PHASE-26-CODE-FIRST-SURFACE.md](../../../docs/PHASE-26-CODE-FIRST-SURFACE.md).
 *
 * An ordered sequence of points the UI can scrub through, and the delta
 * between each consecutive pair.
 *
 * ## Why this lives on the code surface rather than the graph
 *
 * No layout engine is involved, so it works on repositories where the
 * graph would struggle — which is the point of the whole phase. And
 * scrubbing a diff is more *useful* than scrubbing a picture: you can
 * read what changed, rather than watch a node pulse.
 *
 * ## What it refuses to do
 *
 * **It does not interpolate.** Between two frames a file either has a
 * recorded state or it does not; a tween of source code would be
 * fiction. Frames are discrete, and the transport moves between them.
 */

export interface PlaybackFrame {
  /** Comparand spec — `commit:<sha>`, `checkpoint:<id>`, `live`. */
  spec: string;
  label: string;
  kind: string;
  /** Epoch ms, when the point has a time. Null for `live`. */
  timestamp: number | null;
  /** Files added / removed / modified since the previous frame. */
  delta: {
    added: number;
    removed: number;
    modified: number;
    /** Null when the previous frame could not supply edges (a commit). */
    edgesAdded: number | null;
    edgesRemoved: number | null;
  } | null;
  /** Paths that changed since the previous frame, capped for transport. */
  changedFiles: string[];
  /** True when `changedFiles` was truncated. */
  truncated: boolean;
}

export interface PlaybackSequence {
  frames: PlaybackFrame[];
  notes: string[];
}

/** Keep a frame's file list bounded — a sequence is a timeline, not a payload. */
const MAX_FILES_PER_FRAME = 200;

/** Commit timestamps, so frames can be ordered and labelled by time. */
function commitTimes(projectPath: string, limit: number): Map<string, number> {
  const times = new Map<string, number>();
  try {
    const out = execFileSync('git', ['log', `-${limit}`, '--format=%h\t%ct'], {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    for (const line of out.split('\n')) {
      const [sha, ts] = line.split('\t');
      if (sha && ts) times.set(`commit:${sha}`, Number(ts) * 1000);
    }
  } catch {
    /* not a git repo */
  }
  return times;
}

/**
 * Build a playback sequence for a project.
 *
 * Oldest first, ending at the working tree, because that is the
 * direction a person reads history in — and "fast-forward" only means
 * anything if forward is later.
 */
export function buildPlaybackSequence(params: {
  projectPath: string;
  /** How many commits to include. */
  limit?: number;
  /** Include stored checkpoints alongside commits. */
  includeCheckpoints?: boolean;
}): PlaybackSequence {
  const limit = Math.min(Math.max(params.limit ?? 20, 2), 100);
  const notes: string[] = [];

  const comparands = listComparands(params.projectPath, limit);
  const times = commitTimes(params.projectPath, limit);

  const points = comparands
    .filter((c) => {
      if (c.kind === 'commit') return true;
      if (c.kind === 'checkpoint') return params.includeCheckpoints !== false;
      return false;
    })
    // A commit's time comes from git; a checkpoint carries its own.
    .map((c) => ({ ...c, timestamp: times.get(c.spec) ?? c.timestamp ?? null }));

  // `listComparands` returns commits newest-first; playback runs the
  // other way.
  points.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  // Trim COMMITS to the limit, not the sequence. Slicing the whole list threw
  // away whatever sorted earliest, and checkpoints sorted earliest precisely
  // because they had no timestamp — so `includeCheckpoints` defaulted to true
  // and produced no checkpoint frames on any repo with `limit` commits, with
  // nothing said about the ones dropped.
  const commits = points.filter((p) => p.kind === 'commit');
  const keptCommits = new Set(commits.slice(-limit).map((p) => p.spec));
  const kept = points.filter((p) => p.kind !== 'commit' || keptCommits.has(p.spec));
  if (commits.length > keptCommits.size) {
    notes.push(
      `Showing the ${keptCommits.size} most recent commits of ${commits.length}; raise \`limit\` for more.`,
    );
  }

  const ordered = [...kept, { spec: 'live', label: 'Live (working tree)', kind: 'live', timestamp: null }];

  const frames: PlaybackFrame[] = [];
  let previous: ReturnType<typeof resolveComparand> = null;

  for (const point of ordered) {
    const resolved = resolveComparand(point.spec, params.projectPath);
    if (!resolved) {
      notes.push(`Skipped ${point.spec}: could not be resolved.`);
      continue;
    }

    let delta: PlaybackFrame['delta'] = null;
    let changedFiles: string[] = [];
    let truncated = false;

    if (previous) {
      const diff = diffSnapshots(previous.snapshot, resolved.snapshot);
      const edgesComparable = previous.edgesKnown && resolved.edgesKnown;
      delta = {
        added: diff.addedFiles.length,
        removed: diff.removedFiles.length,
        modified: diff.modifiedFiles.length,
        // Null rather than zero: a commit contributes no edges, and
        // reporting "0 edges changed" for a comparison that never looked
        // at edges would read as a finding rather than an absence.
        edgesAdded: edgesComparable ? diff.addedEdges.length : null,
        edgesRemoved: edgesComparable ? diff.removedEdges.length : null,
      };

      const all = [...diff.addedFiles, ...diff.modifiedFiles, ...diff.removedFiles];
      truncated = all.length > MAX_FILES_PER_FRAME;
      changedFiles = all.slice(0, MAX_FILES_PER_FRAME);
    }

    frames.push({
      spec: point.spec,
      label: resolved.label,
      kind: point.kind,
      timestamp: point.timestamp,
      delta,
      changedFiles,
      truncated,
    });

    previous = resolved;
  }

  if (frames.length < 2) {
    notes.push(
      'Not enough history to play back. A repository needs at least two points — ' +
        'commits or checkpoints — before there is anything to scrub through.',
    );
  }

  if (frames.some((f) => f.delta?.edgesAdded === null)) {
    notes.push(
      'Edge counts are omitted for commit frames: a commit contributes its file list only, ' +
        'so its edges would have to be reconstructed by re-parsing the tree.',
    );
  }

  return { frames, notes };
}
