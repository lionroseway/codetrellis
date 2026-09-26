import { getDb, getDependencyEdges } from './database';
import { markDirty } from './persistence';
import { currentBranch } from './git-checkout';

export interface TrellisSnapshot {
  id: number;
  name: string;
  snapshotType: 'current' | 'planned' | 'checkpoint';
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
 * Capture the current codebase state as an immutable trellis snapshot.
 */
export function captureCurrentTrellis(
  projectPath: string,
  planUid?: string,
  name?: string,
): TrellisSnapshot {
  const db = getDb();

  // Get current dependency edges
  let edges: Array<{ sourceRelative: string; targetRelative: string; specifiers: string[] }> = [];
  try {
    edges = getDependencyEdges();
  } catch { /* no resolved imports yet */ }

  // Get file data from the files table
  const filesResult = db.exec(
    `SELECT relative_path, content_hash, language FROM files`
  );
  const files = (filesResult[0]?.values || []).map((r: any[]) => ({
    path: r[0] as string,
    contentHash: r[1] as string,
    language: r[2] as string,
    symbolCount: 0,
  }));

  // Get symbol counts
  for (const file of files) {
    const countResult = db.exec(
      `SELECT COUNT(*) FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.relative_path = ? AND s.parent_symbol_id IS NULL`,
      [file.path]
    );
    file.symbolCount = (countResult[0]?.values[0]?.[0] as number) || 0;
  }

  const edgesData = edges.map((e) => ({
    source: e.sourceRelative,
    target: e.targetRelative,
    specifiers: e.specifiers,
  }));

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
  const result = getDb().exec(
    `SELECT id, name, snapshot_type, plan_uid, git_branch, files_json, edges_json, created_at
     FROM trellis_snapshots WHERE id = ?`,
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
  let query = `SELECT id, name, snapshot_type, plan_uid, git_branch, files_json, edges_json, created_at FROM trellis_snapshots`;
  const params: string[] = [];

  if (planUid) {
    query += ` WHERE plan_uid = ?`;
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
