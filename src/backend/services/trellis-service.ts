import { getDb, getDependencyEdges } from './database';
import { markDirty } from './persistence';
import { currentBranch } from './git-checkout';

export interface TrellisSnapshot {
  id: number;
  name: string;
  snapshotType: 'current' | 'planned' | 'checkpoint' | 'frame';
  planUid: string | null;
  gitBranch: string | null;
  filesJson: string;
  edgesJson: string;
  createdAt: number;
}

export interface TrellisSnapshotData {
  files: Array<{
    path: string;
    contentHash: string;
    language: string;
    symbolCount: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    specifiers: string[];
  }>;
}

export interface TrellisDiff {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  addedEdges: Array<{ source: string; target: string }>;
  removedEdges: Array<{ source: string; target: string }>;
  progress: number;
}

/**
 * The graph the server holds now: every file with its hash, language and
 * top-level symbol count, and every resolved import edge. Symbol counts in
 * one query (it was one query per file, too slow to run at every turn end
 * for replay frames, B5.1).
 */
export function readLiveGraph(): TrellisSnapshotData {
  const db = getDb();
  let edges: Array<{ sourceRelative: string; targetRelative: string; specifiers: string[] }> = [];
  try {
    edges = getDependencyEdges();
  } catch { /* no resolved imports yet */ }

  const counts = new Map<string, number>();
  const countRows = db.exec(
    `SELECT f.relative_path, COUNT(s.id) FROM files f
     LEFT JOIN symbols s ON s.file_id = f.id AND s.parent_symbol_id IS NULL
     GROUP BY f.id`
  );
  for (const r of countRows[0]?.values ?? []) counts.set(r[0] as string, Number(r[1]) || 0);

  const filesResult = db.exec(`SELECT relative_path, content_hash, language FROM files`);
  const files = (filesResult[0]?.values || []).map((r: any[]) => ({
    path: r[0] as string,
    contentHash: r[1] as string,
    language: r[2] as string,
    symbolCount: counts.get(r[0] as string) ?? 0,
  }));

  return {
    files,
    edges: edges.map((e) => ({ source: e.sourceRelative, target: e.targetRelative, specifiers: e.specifiers })),
  };
}

/**
 * Capture the current codebase state as an immutable trellis snapshot.
 */
export function captureCurrentTrellis(
  projectPath: string,
  planUid?: string,
  name?: string,
): TrellisSnapshot {
  const db = getDb();
  const { files, edges: edgesData } = readLiveGraph();

  // Get git branch
  const gitBranch = currentBranch(projectPath);

  const snapshotName = name || `Snapshot at ${new Date().toLocaleString()}`;
  const now = Date.now();

  db.run(
    `INSERT INTO trellis_snapshots (name, snapshot_type, plan_uid, git_branch, files_json, edges_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshotName,
      planUid ? 'current' : 'checkpoint',
      planUid || null,
      gitBranch,
      JSON.stringify(files),
      JSON.stringify(edgesData),
      now,
    ]
  );

  const idResult = db.exec(`SELECT last_insert_rowid()`);
  const id = (idResult[0]?.values[0]?.[0] as number) || 0;

  markDirty();
  console.log(`[Trellis] Captured snapshot #${id}: "${snapshotName}" (${files.length} files, ${edgesData.length} edges)`);

  return {
    id,
    name: snapshotName,
    snapshotType: planUid ? 'current' : 'checkpoint',
    planUid: planUid || null,
    gitBranch,
    filesJson: JSON.stringify(files),
    edgesJson: JSON.stringify(edgesData),
    createdAt: now,
  };
}

/**
 * Get a snapshot by ID.
 */
export function getSnapshot(id: number): (TrellisSnapshot & { data: TrellisSnapshotData }) | null {
  // A replay frame whose graph matched the one before stores no copy and
  // points at the frame that does (B5.1); its data is that frame's.
  const result = getDb().exec(
    `SELECT t.id, t.name, t.snapshot_type, t.plan_uid, t.git_branch,
            COALESCE(o.files_json, t.files_json), COALESCE(o.edges_json, t.edges_json), t.created_at
     FROM trellis_snapshots t LEFT JOIN trellis_snapshots o ON o.id = t.same_as
     WHERE t.id = ?`,
    [id]
  );
  if (!result[0]?.values[0]) return null;

  const r = result[0].values[0];
  return {
    id: r[0] as number,
    name: r[1] as string,
    snapshotType: r[2] as TrellisSnapshot['snapshotType'],
    planUid: r[3] as string | null,
    gitBranch: r[4] as string | null,
    filesJson: r[5] as string,
    edgesJson: r[6] as string,
    createdAt: r[7] as number,
    data: {
      files: JSON.parse(r[5] as string),
      edges: JSON.parse(r[6] as string),
    },
  };
}

/**
 * List snapshots, optionally filtered by plan.
 */
export function listSnapshots(planUid?: string): Array<Omit<TrellisSnapshot, 'filesJson' | 'edgesJson'> & { fileCount: number; edgeCount: number }> {
  // Replay frames (B5.1) are listed by /api/replay/frames, not among the
  // checkpoints a person took: there can be hundreds a day.
  let query = `SELECT id, name, snapshot_type, plan_uid, git_branch, files_json, edges_json, created_at FROM trellis_snapshots
    WHERE snapshot_type != 'frame'`;
  const params: string[] = [];

  if (planUid) {
    query += ` AND plan_uid = ?`;
    params.push(planUid);
  }
  query += ` ORDER BY created_at DESC`;

  const result = getDb().exec(query, params);
  if (!result[0]) return [];

  return result[0].values.map((r: any[]) => ({
    id: r[0],
    name: r[1],
    snapshotType: r[2],
    planUid: r[3],
    gitBranch: r[4],
    createdAt: r[7],
    fileCount: JSON.parse(r[5]).length,
    edgeCount: JSON.parse(r[6]).length,
  }));
}

/**
 * Compare a snapshot against the current live state.
 */
export function computeTrellisDiff(snapshotId: number): TrellisDiff | null {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) return null;

  const snapshotFiles = new Map(snapshot.data.files.map((f) => [f.path, f.contentHash]));
  const snapshotEdges = new Set(snapshot.data.edges.map((e) => `${e.source}->${e.target}`));

  // Get current live state
  let liveEdges: Array<{ sourceRelative: string; targetRelative: string }> = [];
  try {
    liveEdges = getDependencyEdges();
  } catch { /* ignore */ }

  const liveFiles = new Map<string, string>();
  const filesResult = getDb().exec(`SELECT relative_path, content_hash FROM files`);
  if (filesResult[0]) {
    for (const r of filesResult[0].values) {
      liveFiles.set(r[0] as string, r[1] as string);
    }
  }

  const liveEdgeSet = new Set(liveEdges.map((e) => `${e.sourceRelative}->${e.targetRelative}`));

  // Compute diff
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: string[] = [];

  for (const [path, hash] of liveFiles) {
    const snapshotHash = snapshotFiles.get(path);
    if (!snapshotHash) {
      addedFiles.push(path);
    } else if (snapshotHash !== hash) {
      modifiedFiles.push(path);
    }
  }

  for (const path of snapshotFiles.keys()) {
    if (!liveFiles.has(path)) {
      removedFiles.push(path);
    }
  }

  const addedEdgesArr: Array<{ source: string; target: string }> = [];
  const removedEdgesArr: Array<{ source: string; target: string }> = [];

  for (const edge of liveEdgeSet) {
    if (!snapshotEdges.has(edge)) {
      const [source, target] = edge.split('->');
      addedEdgesArr.push({ source, target });
    }
  }
  for (const edge of snapshotEdges) {
    if (!liveEdgeSet.has(edge)) {
      const [source, target] = edge.split('->');
      removedEdgesArr.push({ source, target });
    }
  }

  const totalFiles = snapshotFiles.size;
  const changedFiles = addedFiles.length + modifiedFiles.length;
  const progress = totalFiles > 0 ? Math.round((changedFiles / Math.max(totalFiles, changedFiles)) * 100) : 0;

  return {
    addedFiles,
    removedFiles,
    modifiedFiles,
    addedEdges: addedEdgesArr,
    removedEdges: removedEdgesArr,
    progress,
  };
}
