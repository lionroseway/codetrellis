import initSqlJs, { type Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import type { ParsedFile, ParsedSymbol, AliasMapping, DiscoveredSystem, SupportedLanguage } from '../../shared/types';
import { loadFromDisk } from './persistence';
import { getResolverForLanguage } from './resolvers';

let db: Database | null = null;

export async function initDatabase(): Promise<void> {
  if (db) return;

  const SQL = await initSqlJs();

  // Try loading persisted database
  const savedData = loadFromDisk();
  if (savedData) {
    db = new SQL.Database(savedData);
    console.log('[DB] Loaded persisted database');
  } else {
    db = new SQL.Database();
  }

  // AST tables (ephemeral — rebuilt on scan)
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      relative_path TEXT NOT NULL,
      language TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      last_parsed INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      parent_symbol_id INTEGER REFERENCES symbols(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      modifiers TEXT,
      FOREIGN KEY (file_id) REFERENCES files(id)
    );

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      specifiers TEXT,
      is_default INTEGER DEFAULT 0,
      is_namespace INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);
  `);

  // Plan tables (persistent — survive restarts)
  db.run(`
    CREATE TABLE IF NOT EXISTS plans (
      uid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      author TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'human',
      project_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_uid TEXT NOT NULL REFERENCES plans(uid),
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      change_summary TEXT,
      author TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(plan_uid, version)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      uid TEXT PRIMARY KEY,
      plan_uid TEXT NOT NULL REFERENCES plans(uid),
      sort_order INTEGER NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      assignee TEXT,
      assignee_type TEXT,
      assignee_model TEXT,
      affected_files TEXT DEFAULT '[]',
      affected_symbols TEXT DEFAULT '[]',
      new_connections TEXT DEFAULT '[]',
      removed_connections TEXT DEFAULT '[]',
      dependencies TEXT DEFAULT '[]',
      file_spec TEXT,
      symbol_specs TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

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
    );

    CREATE INDEX IF NOT EXISTS idx_plan_phases_plan ON plan_phases(plan_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_phases_unique ON plan_phases(plan_uid, phase_number);

    CREATE TABLE IF NOT EXISTS comments (
      uid TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_uid TEXT NOT NULL,
      parent_uid TEXT,
      author TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'human',
      body TEXT NOT NULL,
      comment_type TEXT NOT NULL DEFAULT 'comment',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      model TEXT,
      active_plan_uid TEXT REFERENCES plans(uid),
      connected_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS deviations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_uid TEXT NOT NULL REFERENCES plans(uid),
      deviation_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      description TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT 'pending',
      detected_at INTEGER NOT NULL,
      resolved_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_uid);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_uid);
    CREATE INDEX IF NOT EXISTS idx_plan_versions_plan ON plan_versions(plan_uid);
    CREATE INDEX IF NOT EXISTS idx_sessions_plan ON agent_sessions(active_plan_uid);
    CREATE INDEX IF NOT EXISTS idx_deviations_plan ON deviations(plan_uid);

    CREATE TABLE IF NOT EXISTS trellis_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      plan_uid TEXT REFERENCES plans(uid),
      git_branch TEXT,
      files_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trellis_plan ON trellis_snapshots(plan_uid);
    CREATE INDEX IF NOT EXISTS idx_trellis_type ON trellis_snapshots(snapshot_type);

    CREATE TABLE IF NOT EXISTS plan_documents (
      uid TEXT PRIMARY KEY,
      plan_uid TEXT NOT NULL REFERENCES plans(uid),
      doc_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      author TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'human',
      order_hint TEXT,
      parent_doc_uid TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plan_docs_plan ON plan_documents(plan_uid);
    CREATE INDEX IF NOT EXISTS idx_plan_docs_type ON plan_documents(doc_type);
    CREATE INDEX IF NOT EXISTS idx_plan_docs_parent ON plan_documents(parent_doc_uid);

    CREATE TABLE IF NOT EXISTS plan_document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_uid TEXT NOT NULL REFERENCES plan_documents(uid),
      version INTEGER NOT NULL,
      body TEXT NOT NULL,
      change_summary TEXT,
      author TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(doc_uid, version)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_doc_versions ON plan_document_versions(doc_uid);

    CREATE TABLE IF NOT EXISTS recent_projects (
      path TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      branch TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      last_opened_at INTEGER NOT NULL,
      first_opened_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recent_projects_opened ON recent_projects(last_opened_at DESC);
  `);

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
  d.run(`DELETE FROM imports`);
  d.run(`DELETE FROM symbols`);
  d.run(`DELETE FROM files`);
}

/**
 * Store a parsed file's data. Replaces existing data for that file.
 */
export function storeParsedFile(parsed: ParsedFile, projectRoot: string): void {
  const d = getDb();
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

  return results[0].values.map((row) => ({
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

  return results[0].values.map((row) => ({
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

  return results[0].values.map((row) => ({
    source: row[0] as string,
    target: row[1] as string,
    sourceRelative: row[2] as string,
    targetRelative: row[3] as string,
    specifiers: JSON.parse((row[4] as string) || '[]'),
  }));
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
    imports: (importsResult[0]?.values || []).map((row) => ({
      path: row[0] as string,
      relativePath: row[1] as string,
      specifiers: JSON.parse((row[2] as string) || '[]'),
    })),
    importedBy: (importedByResult[0]?.values || []).map((row) => ({
      path: row[0] as string,
      relativePath: row[1] as string,
      specifiers: JSON.parse((row[2] as string) || '[]'),
    })),
  };
}

/**
 * Get stats about the database.
 */
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
