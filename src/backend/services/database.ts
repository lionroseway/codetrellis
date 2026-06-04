import type { Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import type { ParsedFile, ParsedSymbol, AliasMapping, DiscoveredSystem, SupportedLanguage } from '../../shared/types';
import { getDataDir, ensureDataDir } from './persistence';
import { getResolverForLanguage } from './resolvers';
import { reconcileSchemaFromSql } from './schema-reconciler';
import {
  SCHEMA_AST,
  SCHEMA_PLANS_CORE,
  SCHEMA_ATTACHMENTS,
  SCHEMA_PLAN_ITEMS,
  SCHEMA_SYSTEM_DOCS,
  SCHEMA_EXTERNAL_REFS,
  PERSISTENT_SCHEMA_SQL,
  EPHEMERAL_TABLES,
} from './db-schema';

/**
 * Native SQLite via better-sqlite3, exposed through a thin
 * sql.js-compatible shim (`run` / `exec` / `export` / `close`) so the
 * ~290 existing call sites stay unchanged.
 *
 * Replaces sql.js (SQLite-in-WASM), which held the entire database in a
 * fixed Emscripten heap and re-exported the whole DB to disk after every
 * mutation — faulting with "memory access out of bounds" once the DB grew
 * past tens of MB. better-sqlite3 is disk-backed (WAL): no memory ceiling,
 * persists in place (no export churn), and far faster.
 *
 * Loaded via require (computed-free) + marked external in
 * electron.vite.config so the native .node binary isn't bundled.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3: any = require('better-sqlite3');

let bdb: any = null;
let db: Database | null = null;

/** A sql.js-shaped facade over a better-sqlite3 connection. */
function makeShim(conn: any): Database {
  return {
    run(sql: string, params?: unknown[]): void {
      if (params && params.length) {
        conn.prepare(sql).run(...(params as any[]));
      } else {
        // No params → may be multi-statement DDL; exec() handles both.
        conn.exec(sql);
      }
    },
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: any[][] }> {
      const stmt = conn.prepare(sql);
      if (!stmt.reader) {
        // Non-SELECT issued through exec() — run it, return no rows.
        stmt.run(...((params as any[]) ?? []));
        return [];
      }
      stmt.raw(true); // rows as arrays → matches sql.js `values: any[][]`
      const values = stmt.all(...((params as any[]) ?? [])) as any[][];
      if (values.length === 0) return [];
      const columns = stmt.columns().map((c: { name: string }) => c.name);
      return [{ columns, values }];
    },
    export(): Uint8Array {
      return conn.serialize();
    },
    close(): void {
      conn.close();
    },
  };
}

export async function initDatabase(): Promise<void> {
  if (db) return;

  ensureDataDir();
  const dbPath = path.join(getDataDir(), 'data.db');
  bdb = new BetterSqlite3(dbPath);
  // WAL = concurrent reads + in-place durable writes (no full-DB export).
  bdb.pragma('journal_mode = WAL');
  bdb.pragma('synchronous = NORMAL');
  bdb.pragma('busy_timeout = 5000');
  db = makeShim(bdb);
  console.log(`[DB] Opened native SQLite (better-sqlite3) at ${dbPath}`);

  // AST tables (ephemeral — rebuilt on scan). Schema lives in
  // ./db-schema.ts so the reconciler reads the same source of truth.
  db.run(SCHEMA_AST);

  // Plan tables (persistent — survive restarts). Schema lives in
  // ./db-schema.ts; the reconciler at end-of-init backfills any
  // columns that were added later than this DB was first created.
  db.run(SCHEMA_PLANS_CORE);

  // Phase 15 §15.D — plan-level git context. Captures user intent
  // ("base off `main`, land on `feat/auth`, optionally use this
  // worktree") so the runner / agent integration knows where to diff
  // and commit. No git commands are executed at write time — these
  // are pure metadata for now.
  try { db.run(`ALTER TABLE plans ADD COLUMN base_ref TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plans ADD COLUMN target_branch TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plans ADD COLUMN target_worktree TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plans ADD COLUMN auto_create_branch INTEGER DEFAULT 0`); } catch { /* exists */ }

  // Phase 14 §A — task-as-context fields. Run as ALTER TABLE inside
  // try/catch so existing DBs migrate cleanly and fresh installs land
  // in the same shape. Mirrors the lazy-migration pattern already used
  // by `resolved_path`, `phase_uid`, `order_hint`, `parent_doc_uid`.
  //
  // - `parent_task_uid` — subtask parent (one level for v1, tree later)
  // - `body`            — markdown design notes / agent-readable detail
  // - `prompt`          — markdown ready to paste at an agent
  // - `scope_path`      — folder this task is rooted at; relative paths
  //                       in `file_specs` resolve from here
  // - `file_specs`      — JSON FileSpec[] — explicit CRUD intent on file ops
  // - `progress_percent`— 0..100, free-form `update_task_progress`
  // - `blocked_reason`  — free-form reason when status === 'blocked'
  try { db.run(`ALTER TABLE tasks ADD COLUMN parent_task_uid TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE tasks ADD COLUMN body TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE tasks ADD COLUMN prompt TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE tasks ADD COLUMN scope_path TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE tasks ADD COLUMN file_specs TEXT DEFAULT '[]'`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE tasks ADD COLUMN progress_percent INTEGER`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE tasks ADD COLUMN blocked_reason TEXT`); } catch { /* exists */ }
  // `phase_uid` was historically added lazily by resolveImports() (so it
  // depended on whether a project scan ran). Pulled into initDatabase here
  // so the schema is consistent regardless of scan history — fresh boots
  // without a scan still get the column. The matching ALTER in
  // resolveImports stays for back-compat (try/catch swallows the
  // duplicate-column error harmlessly).
  try { db.run(`ALTER TABLE tasks ADD COLUMN phase_uid TEXT`); } catch { /* exists */ }
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_uid)`); } catch { /* exists */ }

  // Phase 14 §A — first-class task chatter:
  //   - `kind`     — 'note' | 'blocker' | 'progress' | 'question'
  //   - `source`   — 'agent' | 'human'
  //   - `metadata` — JSON bag (today: progressPercent for kind='progress')
  // The existing `comment_type` column stays so old plans keep
  // rendering with their legacy taxonomy.
  try { db.run(`ALTER TABLE comments ADD COLUMN kind TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE comments ADD COLUMN source TEXT`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE comments ADD COLUMN metadata TEXT`); } catch { /* exists */ }

  // Phase 14 §A — task / plan-doc attachments rail. Schema in ./db-schema.ts.
  db.run(SCHEMA_ATTACHMENTS);

  // Phase 15 §15.A — Object/Action unified model. plan_items,
  // plan_item_versions, plan_events, channel_events. Schema in
  // ./db-schema.ts.
  db.run(SCHEMA_PLAN_ITEMS);

  // Phase 17.N-Q — add routing/execution columns to existing plan_items tables
  try { db.run(`ALTER TABLE plan_items ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plan_items ADD COLUMN skills_mode TEXT DEFAULT 'inherit'`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plan_items ADD COLUMN claim_policy TEXT DEFAULT NULL`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plan_items ADD COLUMN claim_policy_mode TEXT DEFAULT 'inherit'`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plan_items ADD COLUMN execution_config TEXT DEFAULT NULL`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plan_items ADD COLUMN execution_config_mode TEXT DEFAULT 'inherit'`); } catch { /* exists */ }

  // Phase 17.F — constraints & guardrails columns
  try { db.run(`ALTER TABLE plan_items ADD COLUMN constraints TEXT DEFAULT NULL`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plan_items ADD COLUMN constraints_mode TEXT DEFAULT 'inherit'`); } catch { /* exists */ }
  // Phase 17.K — approval gate
  try { db.run(`ALTER TABLE plan_items ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }

  // Phase 17.N — agent capabilities for skill matching
  try { db.run(`ALTER TABLE agent_sessions ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }

  // Phase 17.B+ — host terminal ID for self-write detection
  try { db.run(`ALTER TABLE agent_sessions ADD COLUMN host_terminal_id TEXT DEFAULT NULL`); } catch { /* exists */ }

  // Deviation file_path — stores the concrete path so accepted can amend the plan
  try { db.run(`ALTER TABLE deviations ADD COLUMN file_path TEXT DEFAULT NULL`); } catch { /* exists */ }

  // CDev Phase 3.1 — normalised git origin URL as the cross-machine
  // identifier for a recent project. Used by cross-repo pointer
  // resolution and central-oversight setups. Local-only column;
  // never travels in the manifest.
  try { db.run(`ALTER TABLE recent_projects ADD COLUMN origin_url TEXT DEFAULT NULL`); } catch { /* exists */ }
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_recent_projects_origin ON recent_projects(origin_url)`); } catch { /* exists */ }

  // CDev Phase 3.2 — per-item sharing visibility. `visibility` is the
  // user's intent ('shared' default, 'local' opts out of disk export);
  // `visibility_override` is the escape hatch for the rare case where
  // a user keeps a parent local but still wants a specific child to
  // ride to git (the child appears top-level on disk because its
  // parent isn't there to anchor it).
  try { db.run(`ALTER TABLE plan_items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared'`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plan_items ADD COLUMN visibility_override INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }

  // CDev Phase 3.3 — cross-repo plan scope. `home_repo` is the
  // normalised git origin URL of the repo that canonically owns this
  // plan; `scope` is a JSON array of other repo URLs that contribute
  // to the same work. Both are stable across clones (URLs, not local
  // paths). home_repo is captured at plan creation from the current
  // project's origin URL.
  try { db.run(`ALTER TABLE plans ADD COLUMN home_repo TEXT DEFAULT NULL`); } catch { /* exists */ }
  try { db.run(`ALTER TABLE plans ADD COLUMN scope TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_plans_home_repo ON plans(home_repo)`); } catch { /* exists */ }

  // CDev Phase 3.4 — repo-wide system documentation. Schema in ./db-schema.ts.
  db.run(SCHEMA_SYSTEM_DOCS);

  // Phase 17.R — external references table
  db.run(SCHEMA_EXTERNAL_REFS);

  // Schema reconciler — catches the "added a column to CREATE TABLE
  // but forgot the matching ALTER" class of bug. Diffs the declared
  // persistent schema against the live DB and ALTERs in any column
  // that's declared but missing (additive only — never drops or
  // renames). The lazy `ALTER TABLE` block above stays the right
  // place for non-additive changes (NOT NULL with backfill, renames,
  // indexes, data migrations); the reconciler is the safety net.
  const reconcile = reconcileSchemaFromSql(db, PERSISTENT_SCHEMA_SQL, {
    skipTables: EPHEMERAL_TABLES,
  });
  if (reconcile.columnsAdded.length > 0) {
    console.log(
      `[DB] Schema reconciler added ${reconcile.columnsAdded.length} column(s):`,
      reconcile.columnsAdded.map((c) => `${c.table}.${c.column}`).join(', '),
    );
  }
  if (reconcile.errors.length > 0) {
    for (const e of reconcile.errors) {
      console.warn(`[DB] Schema reconciler failed for ${e.table}.${e.column}: ${e.error}`);
    }
  }

  console.log('[DB] SQLite initialized');
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

/**
 * Export the database as a binary buffer for persistence.
 */
export function exportDatabase(): Uint8Array {
  return getDb().export();
}

/**
 * Drop all AST data (files / symbols / imports). Called at the start of
 * every project scan so a project switch doesn't leave behind stale
 * rows from a previously-scanned project. The AST tables are
 * "ephemeral — rebuilt on scan" by design; the persistent stuff
 * (plans, spec docs, comments, agent sessions, snapshots, recent
 * projects) is in separate tables and is preserved.
 */
export function clearAstData(): void {
  const d = getDb();
  d.run('BEGIN');
  try {
    // Order matters: cross_system_edges + callsites reference files via
    // FK; clear them first so the cascading deletes don't surprise us.
    try { d.run(`DELETE FROM cross_system_edges`); } catch { /* table may not exist on first run */ }
    try { d.run(`DELETE FROM callsites`); } catch { /* same */ }
    d.run(`DELETE FROM imports`);
    d.run(`DELETE FROM symbols`);
    d.run(`DELETE FROM files`);
    d.run('COMMIT');
  } catch (err) {
    try { d.run('ROLLBACK'); } catch { /* rollback best-effort */ }
    throw err;
  }
}

/**
 * Store a parsed file's data. Replaces existing data for that file.
 */
export function storeParsedFile(parsed: ParsedFile, projectRoot: string): void {
  const d = getDb();
  // Wrap in a transaction so last_insert_rowid() is guaranteed to return
  // *this* file's ID, and a mid-write failure leaves no partial data.
  d.run('BEGIN');
  try {
    const relativePath = path.relative(projectRoot, parsed.path);

    // Upsert file record
    d.run(`DELETE FROM files WHERE path = ?`, [parsed.path]);
    d.run(
      `INSERT INTO files (path, relative_path, language, content_hash, last_parsed) VALUES (?, ?, ?, ?, ?)`,
      [parsed.path, relativePath, parsed.language, parsed.contentHash, Date.now()]
    );

    const fileIdResult = d.exec(`SELECT last_insert_rowid() as id`);
    const fileId = fileIdResult[0]?.values[0]?.[0] as number;

    // Store symbols
    for (const sym of parsed.symbols) {
      insertSymbol(d, fileId, null, sym);
    }

    // Store imports
    for (const imp of parsed.imports) {
      d.run(
        `INSERT INTO imports (file_id, source_path, specifiers, is_default, is_namespace) VALUES (?, ?, ?, ?, ?)`,
        [fileId, imp.source, JSON.stringify(imp.specifiers), imp.isDefault ? 1 : 0, imp.isNamespace ? 1 : 0]
      );
    }

    // Store callsites (cross-system MVP). Replace any existing rows for
    // this file so re-parsing on save doesn't accumulate stale rows.
    d.run(`DELETE FROM callsites WHERE file_id = ?`, [fileId]);
    for (const cs of parsed.callsites ?? []) {
      d.run(
        `INSERT INTO callsites (file_id, kind, protocol, method, url_pattern, sql_text, line, context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileId,
          cs.kind,
          cs.protocol,
          cs.method ?? null,
          cs.urlPattern ?? null,
          cs.sqlText ?? null,
          cs.line ?? null,
          cs.context ?? null,
        ]
      );
    }
    d.run('COMMIT');
  } catch (err) {
    try { d.run('ROLLBACK'); } catch { /* rollback best-effort */ }
    throw err;
  }
}

function insertSymbol(d: Database, fileId: number, parentId: number | null, sym: ParsedSymbol): void {
  d.run(
    `INSERT INTO symbols (file_id, parent_symbol_id, name, kind, start_line, end_line, modifiers) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [fileId, parentId, sym.name, sym.kind, sym.startLine, sym.endLine, JSON.stringify(sym.modifiers)]
  );

  if (sym.children.length > 0) {
    const symIdResult = d.exec(`SELECT last_insert_rowid() as id`);
    const symId = symIdResult[0]?.values[0]?.[0] as number;
    for (const child of sym.children) {
      insertSymbol(d, fileId, symId, child);
    }
  }
}

/**
 * Search symbols by name (case-insensitive substring match).
 */
export function searchSymbols(query: string): Array<{
  name: string;
  kind: string;
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
}> {
  const d = getDb();
  const results = d.exec(
    `SELECT s.name, s.kind, f.path, f.relative_path, s.start_line, s.end_line
     FROM symbols s
     JOIN files f ON s.file_id = f.id
     WHERE s.name LIKE ?
     ORDER BY s.name
     LIMIT 50`,
    [`%${query}%`]
  );

  if (!results[0]) return [];

  return results[0].values.map((row: any[]) => ({
    name: row[0] as string,
    kind: row[1] as string,
    filePath: row[2] as string,
    relativePath: row[3] as string,
    startLine: row[4] as number,
    endLine: row[5] as number,
  }));
}

/**
 * Get all symbols for a file.
 */
export function getFileSymbols(filePath: string): Array<{
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers: string[];
}> {
  const d = getDb();
  const results = d.exec(
    `SELECT s.name, s.kind, s.start_line, s.end_line, s.modifiers
     FROM symbols s
     JOIN files f ON s.file_id = f.id
     WHERE f.path = ? AND s.parent_symbol_id IS NULL
     ORDER BY s.start_line`,
    [filePath]
  );

  if (!results[0]) return [];

  return results[0].values.map((row: any[]) => ({
    name: row[0] as string,
    kind: row[1] as string,
    startLine: row[2] as number,
    endLine: row[3] as number,
    modifiers: JSON.parse((row[4] as string) || '[]'),
  }));
}

/**
 * Get file hash to check if re-parse is needed.
 */
export function getFileHash(filePath: string): string | null {
  const d = getDb();
  const results = d.exec(`SELECT content_hash FROM files WHERE path = ?`, [filePath]);
  if (!results[0]?.values[0]) return null;
  return results[0].values[0][0] as string;
}

/**
 * Bulk-fetch every stored file path → content_hash. Used by
 * incremental scan to decide which files actually need re-parsing.
 */
export function getAllFileHashes(): Map<string, string> {
  const d = getDb();
  const results = d.exec(`SELECT path, content_hash FROM files`);
  const map = new Map<string, string>();
  if (results[0]) {
    for (const row of results[0].values) {
      map.set(row[0] as string, row[1] as string);
    }
  }
  return map;
}

/**
 * Remove DB rows for files that no longer exist on disk (deleted /
 * renamed). Cascading FKs take care of symbols, imports, callsites.
 */
export function removeStaleFiles(stalePaths: string[]): void {
  if (stalePaths.length === 0) return;
  const d = getDb();
  d.run('BEGIN');
  try {
    // cross_system_edges reference file_id; delete those first to
    // avoid FK constraint errors on DBs without deferred FK support.
    for (const p of stalePaths) {
      try {
        d.run(
          `DELETE FROM cross_system_edges WHERE source_file_id IN (SELECT id FROM files WHERE path = ?) OR target_file_id IN (SELECT id FROM files WHERE path = ?)`,
          [p, p],
        );
      } catch { /* table may not exist */ }
      try { d.run(`DELETE FROM callsites WHERE file_id IN (SELECT id FROM files WHERE path = ?)`, [p]); } catch { /* same */ }
      d.run(`DELETE FROM imports WHERE file_id IN (SELECT id FROM files WHERE path = ?)`, [p]);
      d.run(`DELETE FROM symbols WHERE file_id IN (SELECT id FROM files WHERE path = ?)`, [p]);
      d.run(`DELETE FROM files WHERE path = ?`, [p]);
    }
    d.run('COMMIT');
  } catch (err) {
    try { d.run('ROLLBACK'); } catch { /* best-effort */ }
    throw err;
  }
}

/**
 * Resolve import paths to absolute file paths and update the database.
 *
 * Dispatches per-language: TS imports go through resolvers/typescript,
 * Python through resolvers/python, etc. The importer's language is
 * pulled from the files table so each row gets the right resolver.
 *
 * Without per-language dispatch the resolver was TS-only and Python /
 * Rust / PHP / Java imports silently dropped.
 */
export function resolveImports(
  projectRoot: string,
  aliasMap: AliasMapping[] = [],
  systems: DiscoveredSystem[] = [],
): void {
  const d = getDb();

  // Get all files so we can build a lookup
  const filesResult = d.exec(`SELECT id, path, language FROM files`);
  if (!filesResult[0]) return;

  const filePathSet = new Set<string>();
  const fileLangByPath = new Map<string, SupportedLanguage>();
  for (const row of filesResult[0].values) {
    const fp = row[1] as string;
    filePathSet.add(fp);
    fileLangByPath.set(fp, row[2] as SupportedLanguage);
  }

  // Add resolved_file_id column if it doesn't exist
  try {
    d.run(`ALTER TABLE imports ADD COLUMN resolved_path TEXT`);
  } catch { /* column already exists */ }

  // Phase 12 §C: spec doc ordering + nesting. order_hint is a sortable
  // string like "00", "01", "01.5" (matches the swf-style "00-…/01-…"
  // doc-name convention). parent_doc_uid lets docs nest into folder-
  // like groupings (e.g. a "testing" parent with phase-test children).
  try { d.run(`ALTER TABLE plan_documents ADD COLUMN order_hint TEXT`); } catch { /* exists */ }
  try { d.run(`ALTER TABLE plan_documents ADD COLUMN parent_doc_uid TEXT`); } catch { /* exists */ }
  // Index created here (not in the schema CREATE block) so existing
  // databases that have plan_documents without parent_doc_uid migrate
  // cleanly: the ALTER TABLE adds the column, then the index lands.
  try { d.run(`CREATE INDEX IF NOT EXISTS idx_plan_docs_parent ON plan_documents(parent_doc_uid)`); } catch { /* should not happen post-ALTER */ }

  // Phase 12 §A: explicit Phase entity + tasks.phase_uid. A phase is a
  // first-class checkpoint within a plan with its own scope, prereqs,
  // git checkpoint, and acceptance criteria — matches the swf
  // 01-PHASE-1-FOUNDATION.md / 02-PHASE-2-… shape but is DB-backed
  // so agents can query slices and the UI can group tasks by phase.
  try {
    d.run(`
      CREATE TABLE IF NOT EXISTS plan_phases (
        uid TEXT PRIMARY KEY,
        plan_uid TEXT NOT NULL REFERENCES plans(uid),
        phase_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        prerequisites TEXT NOT NULL DEFAULT '',
        git_checkpoint TEXT,
        acceptance_criteria TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    d.run(`CREATE INDEX IF NOT EXISTS idx_plan_phases_plan ON plan_phases(plan_uid)`);
    d.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_phases_unique ON plan_phases(plan_uid, phase_number)`);
  } catch { /* table or index already exists */ }
  try { d.run(`ALTER TABLE tasks ADD COLUMN phase_uid TEXT`); } catch { /* exists */ }

  // Get all imports
  const importsResult = d.exec(`SELECT i.id, i.source_path, f.path FROM imports i JOIN files f ON i.file_id = f.id`);
  if (!importsResult[0]) return;

  let resolved = 0;
  for (const row of importsResult[0].values) {
    const importId = row[0] as number;
    const sourcePath = row[1] as string;
    const importerPath = row[2] as string;

    const language = fileLangByPath.get(importerPath);
    const resolver = language ? getResolverForLanguage(language) : null;
    const resolvedPath = resolver
      ? resolver.resolve({
          importSource: sourcePath,
          importerPath,
          projectRoot,
          knownFiles: filePathSet,
          aliasMap,
          systems,
        })
      : null;
    if (resolvedPath) {
      d.run(`UPDATE imports SET resolved_path = ? WHERE id = ?`, [resolvedPath, importId]);
      resolved++;
    }
  }

  console.log(`[DB] Resolved ${resolved} import paths`);
}

/**
 * Get file-to-file dependency edges (who imports whom).
 */
export interface GraphEdge {
  source: string;
  target: string;
  sourceRelative: string;
  targetRelative: string;
  specifiers: string[];
  /** "import" (default — language-level dep) or "cross_system" (HTTP / SQL / …). */
  kind?: 'import' | 'cross_system';
  /** For cross_system edges only — "http" / "sql" / "subprocess" / "env". */
  protocol?: string;
  /** Human-readable label for cross_system edges, e.g. "GET /api/users". */
  label?: string;
}

export function getDependencyEdges(): Array<{
  source: string;
  target: string;
  sourceRelative: string;
  targetRelative: string;
  specifiers: string[];
}> {
  const d = getDb();
  let results;
  try {
    results = d.exec(`
      SELECT f1.path, f2.path, f1.relative_path, f2.relative_path, i.specifiers
      FROM imports i
      JOIN files f1 ON i.file_id = f1.id
      JOIN files f2 ON i.resolved_path = f2.path
      WHERE i.resolved_path IS NOT NULL
      ORDER BY f1.path
    `);
  } catch {
    // resolved_path column might not exist yet (no scan done)
    return [];
  }

  if (!results[0]) return [];

  return results[0].values.map((row: any[]) => ({
    source: row[0] as string,
    target: row[1] as string,
    sourceRelative: row[2] as string,
    targetRelative: row[3] as string,
    specifiers: JSON.parse((row[4] as string) || '[]'),
  }));
}

/**
 * Like getDependencyEdges() but also includes cross-system edges
 * (HTTP / SQL / subprocess / …) tagged with `kind: 'cross_system'`
 * and a `protocol` discriminator. The frontend renders cross-system
 * edges with a distinct (dashed, protocol-tinted) style.
 */
export function getAllGraphEdges(): GraphEdge[] {
  const imports: GraphEdge[] = getDependencyEdges().map((e) => ({ ...e, kind: 'import' }));

  const d = getDb();
  let xs;
  try {
    xs = d.exec(`
      SELECT sf.path, tf.path, sf.relative_path, tf.relative_path, e.protocol, e.label
      FROM cross_system_edges e
      JOIN files sf ON e.source_file_id = sf.id
      JOIN files tf ON e.target_file_id = tf.id
    `);
  } catch {
    return imports;
  }

  if (!xs[0]) return imports;
  const crossSystem: GraphEdge[] = xs[0].values.map((row: any[]) => ({
    source: row[0] as string,
    target: row[1] as string,
    sourceRelative: row[2] as string,
    targetRelative: row[3] as string,
    specifiers: [],
    kind: 'cross_system',
    protocol: row[4] as string,
    label: row[5] as string,
  }));

  return [...imports, ...crossSystem];
}

/**
 * Get what a specific file imports and what imports it.
 */
export function getFileDependencies(filePath: string): {
  imports: Array<{ path: string; relativePath: string; specifiers: string[] }>;
  importedBy: Array<{ path: string; relativePath: string; specifiers: string[] }>;
} {
  const d = getDb();

  // What this file imports
  const importsResult = d.exec(`
    SELECT f2.path, f2.relative_path, i.specifiers
    FROM imports i
    JOIN files f1 ON i.file_id = f1.id
    JOIN files f2 ON i.resolved_path = f2.path
    WHERE f1.path = ?
  `, [filePath]);

  // What imports this file
  const importedByResult = d.exec(`
    SELECT f1.path, f1.relative_path, i.specifiers
    FROM imports i
    JOIN files f1 ON i.file_id = f1.id
    WHERE i.resolved_path = ?
  `, [filePath]);

  return {
    imports: (importsResult[0]?.values || []).map((row: any[]) => ({
      path: row[0] as string,
      relativePath: row[1] as string,
      specifiers: JSON.parse((row[2] as string) || '[]'),
    })),
    importedBy: (importedByResult[0]?.values || []).map((row: any[]) => ({
      path: row[0] as string,
      relativePath: row[1] as string,
      specifiers: JSON.parse((row[2] as string) || '[]'),
    })),
  };
}

/**
 * Get stats about the database.
 */
/**
 * Phase 17.A — Architecture summary data. Returns a breakdown of the
 * codebase by top-level directory, language distribution, symbol counts
 * by kind, and most-imported files. Used by the orientation panel.
 */
export function getArchitectureSummary(): {
  fileCount: number;
  symbolCount: number;
  importCount: number;
  topDirectories: Array<{ dir: string; fileCount: number }>;
  languageBreakdown: Array<{ language: string; count: number }>;
  symbolsByKind: Array<{ kind: string; count: number }>;
  mostImported: Array<{ path: string; importerCount: number }>;
} {
  const d = getDb();
  const fileCount = (d.exec(`SELECT COUNT(*) FROM files`)[0]?.values[0]?.[0] as number) || 0;
  const symbolCount = (d.exec(`SELECT COUNT(*) FROM symbols`)[0]?.values[0]?.[0] as number) || 0;
  const importCount = (d.exec(`SELECT COUNT(*) FROM imports`)[0]?.values[0]?.[0] as number) || 0;

  // Top-level directories
  const topDirs: Array<{ dir: string; fileCount: number }> = [];
  try {
    const r = d.exec(`
      SELECT
        CASE
          WHEN INSTR(relative_path, '/') > 0
          THEN SUBSTR(relative_path, 1, INSTR(relative_path, '/') - 1)
          ELSE '(root)'
        END AS dir,
        COUNT(*) AS cnt
      FROM files
      GROUP BY dir
      ORDER BY cnt DESC
      LIMIT 15
    `);
    for (const row of r[0]?.values ?? []) {
      topDirs.push({ dir: row[0] as string, fileCount: row[1] as number });
    }
  } catch { /* old schema */ }

  // Language breakdown
  const langs: Array<{ language: string; count: number }> = [];
  try {
    const r = d.exec(`SELECT language, COUNT(*) AS cnt FROM files GROUP BY language ORDER BY cnt DESC`);
    for (const row of r[0]?.values ?? []) {
      langs.push({ language: row[0] as string, count: row[1] as number });
    }
  } catch { /* */ }

  // Symbols by kind
  const kindBreakdown: Array<{ kind: string; count: number }> = [];
  try {
    const r = d.exec(`SELECT kind, COUNT(*) AS cnt FROM symbols GROUP BY kind ORDER BY cnt DESC`);
    for (const row of r[0]?.values ?? []) {
      kindBreakdown.push({ kind: row[0] as string, count: row[1] as number });
    }
  } catch { /* */ }

  // Most imported files (highest fan-in)
  const mostImported: Array<{ path: string; importerCount: number }> = [];
  try {
    const r = d.exec(`
      SELECT i.source_path, COUNT(DISTINCT i.file_id) AS cnt
      FROM imports i
      GROUP BY i.source_path
      ORDER BY cnt DESC
      LIMIT 10
    `);
    for (const row of r[0]?.values ?? []) {
      mostImported.push({ path: row[0] as string, importerCount: row[1] as number });
    }
  } catch { /* */ }

  return {
    fileCount,
    symbolCount,
    importCount,
    topDirectories: topDirs,
    languageBreakdown: langs,
    symbolsByKind: kindBreakdown,
    mostImported,
  };
}

export function getDbStats(): { fileCount: number; symbolCount: number; importCount: number; resolvedImports: number } {
  const d = getDb();
  const files = d.exec(`SELECT COUNT(*) FROM files`);
  const symbols = d.exec(`SELECT COUNT(*) FROM symbols`);
  const imports = d.exec(`SELECT COUNT(*) FROM imports`);
  let resolvedImports = 0;
  try {
    const resolved = d.exec(`SELECT COUNT(*) FROM imports WHERE resolved_path IS NOT NULL`);
    resolvedImports = (resolved[0]?.values[0]?.[0] as number) || 0;
  } catch { /* column may not exist yet */ }
  return {
    fileCount: (files[0]?.values[0]?.[0] as number) || 0,
    symbolCount: (symbols[0]?.values[0]?.[0] as number) || 0,
    importCount: (imports[0]?.values[0]?.[0] as number) || 0,
    resolvedImports,
  };
}
