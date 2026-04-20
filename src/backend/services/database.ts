import initSqlJs, { type Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import type { ParsedFile, ParsedSymbol } from '../../shared/types';

let db: Database | null = null;

export async function initDatabase(): Promise<void> {
  if (db) return;

  const SQL = await initSqlJs();
  db = new SQL.Database();

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

  console.log('[DB] SQLite initialized (in-memory)');
}

function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
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
 * e.g. "./services/project-scanner" → "/abs/path/src/backend/services/project-scanner.ts"
 */
export function resolveImports(projectRoot: string): void {
  const d = getDb();

  // Get all files so we can build a lookup
  const filesResult = d.exec(`SELECT id, path FROM files`);
  if (!filesResult[0]) return;

  const filePathSet = new Set<string>();
  const fileIdByPath = new Map<string, number>();
  for (const row of filesResult[0].values) {
    const id = row[0] as number;
    const fp = row[1] as string;
    filePathSet.add(fp);
    fileIdByPath.set(fp, id);
  }

  // Add resolved_file_id column if it doesn't exist
  try {
    d.run(`ALTER TABLE imports ADD COLUMN resolved_path TEXT`);
  } catch { /* column already exists */ }

  // Get all imports
  const importsResult = d.exec(`SELECT i.id, i.source_path, f.path FROM imports i JOIN files f ON i.file_id = f.id`);
  if (!importsResult[0]) return;

  let resolved = 0;
  for (const row of importsResult[0].values) {
    const importId = row[0] as number;
    const sourcePath = row[1] as string;
    const importerPath = row[2] as string;

    const resolvedPath = resolveImportPath(sourcePath, importerPath, projectRoot, filePathSet);
    if (resolvedPath) {
      d.run(`UPDATE imports SET resolved_path = ? WHERE id = ?`, [resolvedPath, importId]);
      resolved++;
    }
  }

  console.log(`[DB] Resolved ${resolved} import paths`);
}

function resolveImportPath(
  importSource: string,
  importerPath: string,
  projectRoot: string,
  knownFiles: Set<string>,
): string | null {
  // Skip package imports (node_modules, built-in)
  if (!importSource.startsWith('.') && !importSource.startsWith('/') && !importSource.startsWith('@shared')) {
    return null;
  }

  // Handle @shared alias
  let basePath: string;
  if (importSource.startsWith('@shared')) {
    basePath = path.join(projectRoot, 'src/shared', importSource.replace('@shared/', '').replace('@shared', ''));
  } else {
    const importerDir = path.dirname(importerPath);
    basePath = path.resolve(importerDir, importSource);
  }

  // Try extensions
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
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
  const results = d.exec(`
    SELECT f1.path, f2.path, f1.relative_path, f2.relative_path, i.specifiers
    FROM imports i
    JOIN files f1 ON i.file_id = f1.id
    JOIN files f2 ON i.resolved_path = f2.path
    WHERE i.resolved_path IS NOT NULL
    ORDER BY f1.path
  `);

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
