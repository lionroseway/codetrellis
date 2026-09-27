export interface GraphSnapshot {
  timestamp: number;
  files: Map<string, { hash: string; symbolCount: number }>;
  edges: Set<string>; // "source->target"
  commitHash?: string | null;
  shortCommitHash?: string | null;
}

/**
 * Where a baseline came from (Phase 32 §0.4h, bug 29). It was labelled
 * with the HEAD hash whatever it held, so "baseline: HEAD" could include
 * uncommitted work.
 *  - `scan`: the working tree when the project was opened. `dirty` says
 *    whether that tree had uncommitted changes.
 *  - `commit`: a commit's own contents (Pin, the commit picker, set_baseline).
 *  - `working-tree`: the working tree of a project that is not a git repo.
 */
export interface BaselineMeta {
  commitHash?: string | null;
  shortCommitHash?: string | null;
  source?: 'scan' | 'commit' | 'working-tree';
  dirty?: boolean;
  projectPath?: string | null;
}

export type Baseline = GraphSnapshot & Required<Pick<BaselineMeta, 'source' | 'dirty'>> & {
  capturedAt: number;
  projectPath: string | null;
};

/** What the window shows for a baseline: never a bare hash for a tree that was not that commit. */
export function baselineLabel(b: Pick<Baseline, 'shortCommitHash' | 'dirty'>): string {
  if (!b.shortCommitHash) return 'working tree';
  return b.dirty ? `${b.shortCommitHash} + uncommitted changes` : b.shortCommitHash;
}

export interface ArchDiff {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  addedEdges: Array<{ source: string; target: string }>;
  removedEdges: Array<{ source: string; target: string }>;
  blastRadius: string[]; // files affected by changes (dependents of modified/added)
  summary: { added: number; removed: number; modified: number; edgesAdded: number; edgesRemoved: number };
}

let baselineSnapshot: Baseline | null = null;

/**
 * Capture the current graph state as a snapshot.
 */
export function captureSnapshot(
  fileData: Array<{ path: string; hash: string; symbolCount: number }>,
  depEdges: Array<{ sourceRelative: string; targetRelative: string }>,
): GraphSnapshot {
  const files = new Map<string, { hash: string; symbolCount: number }>();
  for (const f of fileData) {
    files.set(f.path, { hash: f.hash, symbolCount: f.symbolCount });
  }

  const edges = new Set<string>();
  for (const e of depEdges) {
    edges.add(`${e.sourceRelative}->${e.targetRelative}`);
  }

  return { timestamp: Date.now(), files, edges };
}

/**
 * Save current state as the baseline snapshot.
 */
export function setBaseline(snapshot: GraphSnapshot, metadata?: BaselineMeta): void {
  baselineSnapshot = {
    ...snapshot,
    commitHash: metadata?.commitHash ?? snapshot.commitHash ?? null,
    shortCommitHash: metadata?.shortCommitHash ?? snapshot.shortCommitHash ?? null,
    source: metadata?.source ?? 'scan',
    dirty: metadata?.dirty ?? false,
    projectPath: metadata?.projectPath ?? null,
    capturedAt: Date.now(),
  };
  console.log(`[Diff] Baseline set (${baselineSnapshot.source}): ${snapshot.files.size} files, ${snapshot.edges.size} edges`);
}

/** No baseline: the diff says so until the next scan or capture sets one. */
export function clearBaseline(): void {
  baselineSnapshot = null;
}

export function getBaseline(): Baseline | null {
  return baselineSnapshot;
}

/**
 * Diff any two snapshots.
 *
 * Phase 25 — extracted from `computeDiff`, which could only ever compare
 * against the module-level baseline. Making it a pure function of two
 * snapshots is what lets the UI compare *any* two points: baseline, a
 * named checkpoint, a git commit, the planned projection, or the live
 * working tree. `computeDiff` now delegates, so there is one
 * implementation rather than two that can disagree.
 */
export function diffSnapshots(before: GraphSnapshot, current: GraphSnapshot): ArchDiff {
  const baselineSnapshot = before;
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: string[] = [];

  // Files added or modified
  for (const [path, data] of current.files) {
    const baseline = baselineSnapshot.files.get(path);
    if (!baseline) {
      addedFiles.push(path);
    } else if (baseline.hash !== data.hash) {
      modifiedFiles.push(path);
    }
  }

  // Files removed
  for (const path of baselineSnapshot.files.keys()) {
    if (!current.files.has(path)) {
      removedFiles.push(path);
    }
  }

  // Edge diffs
  const addedEdges: Array<{ source: string; target: string }> = [];
  const removedEdges: Array<{ source: string; target: string }> = [];

  for (const edge of current.edges) {
    if (!baselineSnapshot.edges.has(edge)) {
      const [source, target] = edge.split('->');
      addedEdges.push({ source, target });
    }
  }
  for (const edge of baselineSnapshot.edges) {
    if (!current.edges.has(edge)) {
      const [source, target] = edge.split('->');
      removedEdges.push({ source, target });
    }
  }

  // Blast radius: files that import any changed file
  const changedFiles = new Set([...addedFiles, ...modifiedFiles]);
  const blastRadius: string[] = [];

  for (const edge of current.edges) {
    const [source, target] = edge.split('->');
    if (changedFiles.has(target) && !changedFiles.has(source)) {
      blastRadius.push(source);
    }
  }

  return {
    addedFiles,
    removedFiles,
    modifiedFiles,
    addedEdges,
    removedEdges,
    blastRadius: [...new Set(blastRadius)],
    summary: {
      added: addedFiles.length,
      removed: removedFiles.length,
      modified: modifiedFiles.length,
      edgesAdded: addedEdges.length,
      edgesRemoved: removedEdges.length,
    },
  };
}

/**
 * Compute the diff between the pinned baseline and the current state.
 * Null when no baseline has been captured yet.
 */
export function computeDiff(current: GraphSnapshot): ArchDiff | null {
  if (!baselineSnapshot) return null;
  return diffSnapshots(baselineSnapshot, current);
}
