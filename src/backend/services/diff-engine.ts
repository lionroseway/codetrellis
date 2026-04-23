import { getDependencyEdges, getDbStats } from './database';

export interface GraphSnapshot {
  timestamp: number;
  files: Map<string, { hash: string; symbolCount: number }>;
  edges: Set<string>; // "source->target"
  commitHash?: string | null;
  shortCommitHash?: string | null;
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

let baselineSnapshot: GraphSnapshot | null = null;

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
export function setBaseline(
  snapshot: GraphSnapshot,
  metadata?: { commitHash?: string | null; shortCommitHash?: string | null },
): void {
  baselineSnapshot = {
    ...snapshot,
    commitHash: metadata?.commitHash ?? snapshot.commitHash ?? null,
    shortCommitHash: metadata?.shortCommitHash ?? snapshot.shortCommitHash ?? null,
  };
  console.log(`[Diff] Baseline set: ${snapshot.files.size} files, ${snapshot.edges.size} edges`);
}

export function getBaseline(): GraphSnapshot | null {
  return baselineSnapshot;
}

/**
 * Compute diff between baseline and current state.
 */
export function computeDiff(current: GraphSnapshot): ArchDiff | null {
  if (!baselineSnapshot) return null;

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
