import type { Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import type { ParsedFile, ParsedSymbol, AliasMapping, DiscoveredSystem, SupportedLanguage } from '../../shared/types';
import { loadFromDisk } from './persistence';
import { getResolverForLanguage } from './resolvers';

/**
 * Dynamically load sql.js. Two paths:
 *   - **Dev / web mode**: `require('sql.js')` walks `node_modules`
 *     normally. The string is computed (`'sql' + '.js'`) so Vite's
 *     bundler doesn't statically resolve and try to bundle it — the
 *     Emscripten UMD wrapper breaks when bundled (see
 *     vite.main.config.ts).
 *   - **Packaged Electron**: Forge's `extraResource` copies
 *     `node_modules/sql.js/` to `<app>/Contents/Resources/sql.js/`;
 *     we resolve that absolute path and require it directly.
 */
function loadSqlJs(): typeof import('sql.js').default {
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    const packagedPath = path.join(resourcesPath, 'sql.js', 'dist', 'sql-wasm.js');
    if (fs.existsSync(packagedPath)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(packagedPath);
    }
  }
  // Computed string keeps Vite from bundling it during the main
  // build (it gets externalized regardless, but belt and braces).
  const sqlJsName = 'sql' + '.js';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(sqlJsName);
}

const initSqlJs = loadSqlJs();

let db: Database | null = null;

export async function initDatabase(): Promise<void> {
  if (db) return;

  // sql.js's `locateFile` callback tells the Emscripten loader where
  // to find `sql-wasm.wasm`. In dev it lives next to sql-wasm.js
  // inside node_modules; in production we point at the packaged
  // resources path.
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      if (resourcesPath) {
        const packaged = path.join(resourcesPath, 'sql.js', 'dist', file);
        if (fs.existsSync(packaged)) return packaged;
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require.resolve(`sql.js/dist/${file}`);
    },
  });

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

    -- Cross-system callsites — non-import couplings (HTTP fetches /
    -- routes, SQL queries, subprocess calls). Populated per-file by
    -- the language-specific extractors in callsites/<lang>.ts.
    CREATE TABLE IF NOT EXISTS callsites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      protocol TEXT NOT NULL,
      method TEXT,
      url_pattern TEXT,
      sql_text TEXT,
      line INTEGER,
      context TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_callsites_file ON callsites(file_id);
    CREATE INDEX IF NOT EXISTS idx_callsites_kind ON callsites(kind);
    CREATE INDEX IF NOT EXISTS idx_callsites_url ON callsites(url_pattern);

    -- Cross-system edges produced by the matchers. Refreshed at the
    -- end of every project scan from the callsites + files tables.
    CREATE TABLE IF NOT EXISTS cross_system_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      target_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      protocol TEXT NOT NULL,
      label TEXT,
      confidence REAL DEFAULT 1.0
    );
    CREATE INDEX IF NOT EXISTS idx_xs_edges_source ON cross_system_edges(source_file_id);
    CREATE INDEX IF NOT EXISTS idx_xs_edges_target ON cross_system_edges(target_file_id);
    CREATE INDEX IF NOT EXISTS idx_xs_edges_protocol ON cross_system_edges(protocol);
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
    -- idx_plan_docs_parent is created in the migration block below
    -- (after the ALTER TABLE that adds parent_doc_uid). Defining it
    -- here would fail on databases that pre-date Phase 12 §C — the
    -- table exists, the column doesn't, CREATE INDEX errors. Fresh
    -- installs still get the index via the migration block too.

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

  // Phase 14 §A — task / plan-doc attachments rail. Single table covers
  // both targets via target_type so the UI can render task and doc
  // rails uniformly without a second table.
  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      uid TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_uid TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      content_type TEXT,
      author TEXT NOT NULL,
      author_type TEXT NOT NULL DEFAULT 'human',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_target ON attachments(target_uid);
    CREATE INDEX IF NOT EXISTS idx_attachments_target_type ON attachments(target_type, target_uid);
  `);

  // Phase 15 §15.A — Object/Action unified model. Replaces (eventually)
  // plan_documents + plan_phases + tasks. For now the new tables are
  // built alongside; nothing reads from them until §15.C wires the
  // service layer + MCP tools. See `docs/PLAN-WORKSPACE-DESIGN.md`
  // (v0.5) for the full schema design.
  //
  //   - plan_items          — unified tree (kind = 'object' | 'action')
  //   - plan_item_versions  — per-item edit history (M1)
  //   - plan_events         — append-only structural mutation log
  //                           (drives the activity rail + timeline
  //                            scrubber — "show how plans shift")
  //
  // Old tables stay readable; the service layer dual-reads during
  // the cutover window. Migration script lives in §15.B.
  db.run(`
    CREATE TABLE IF NOT EXISTS plan_items (
      uid              TEXT PRIMARY KEY,
      plan_uid         TEXT NOT NULL REFERENCES plans(uid),
      parent_uid       TEXT REFERENCES plan_items(uid),
      sort_order       INTEGER NOT NULL DEFAULT 0,
      kind             TEXT NOT NULL,
      title            TEXT NOT NULL,
      body             TEXT NOT NULL DEFAULT '',
      template         TEXT,
      status           TEXT,
      assignee         TEXT,
      assignee_type    TEXT,
      assignee_model   TEXT,
      progress_percent INTEGER,
      blocked_reason   TEXT,
      scope_path       TEXT,
      file_specs       TEXT NOT NULL DEFAULT '[]',
      symbol_specs     TEXT NOT NULL DEFAULT '[]',
      new_connections  TEXT NOT NULL DEFAULT '[]',
      removed_conns    TEXT NOT NULL DEFAULT '[]',
      dependencies     TEXT NOT NULL DEFAULT '[]',
      -- Phase 17.N-Q: routing & execution rules
      skills             TEXT NOT NULL DEFAULT '[]',
      skills_mode        TEXT DEFAULT 'inherit',
      claim_policy       TEXT DEFAULT NULL,
      claim_policy_mode  TEXT DEFAULT 'inherit',
      execution_config   TEXT DEFAULT NULL,
      execution_config_mode TEXT DEFAULT 'inherit',
      -- Phase 17.F: constraints & guardrails
      constraints        TEXT DEFAULT NULL,
      constraints_mode   TEXT DEFAULT 'inherit',
      -- Phase 17.K: approval gate
      requires_approval  INTEGER NOT NULL DEFAULT 0,
      author           TEXT NOT NULL,
      author_type      TEXT NOT NULL DEFAULT 'human',
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      migrated_from    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_plan_items_plan       ON plan_items(plan_uid);
    CREATE INDEX IF NOT EXISTS idx_plan_items_parent     ON plan_items(parent_uid);
    CREATE INDEX IF NOT EXISTS idx_plan_items_kind       ON plan_items(kind);
    CREATE INDEX IF NOT EXISTS idx_plan_items_status     ON plan_items(status);
    CREATE INDEX IF NOT EXISTS idx_plan_items_sort       ON plan_items(plan_uid, parent_uid, sort_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_items_migrated ON plan_items(migrated_from);

    CREATE TABLE IF NOT EXISTS plan_item_versions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      item_uid        TEXT NOT NULL REFERENCES plan_items(uid),
      version         INTEGER NOT NULL,
      body_snapshot   TEXT,
      meta_snapshot   TEXT,
      change_summary  TEXT,
      author          TEXT NOT NULL,
      author_type     TEXT NOT NULL DEFAULT 'human',
      created_at      INTEGER NOT NULL,
      UNIQUE(item_uid, version)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_item_versions_item ON plan_item_versions(item_uid);

    CREATE TABLE IF NOT EXISTS plan_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_uid     TEXT NOT NULL REFERENCES plans(uid),
      item_uid     TEXT,
      event_type   TEXT NOT NULL,
      before_state TEXT,
      after_state  TEXT,
      summary      TEXT NOT NULL,
      author       TEXT NOT NULL,
      author_type  TEXT NOT NULL DEFAULT 'human',
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plan_events_plan ON plan_events(plan_uid, created_at);
    CREATE INDEX IF NOT EXISTS idx_plan_events_item ON plan_events(item_uid, created_at);
    CREATE INDEX IF NOT EXISTS idx_plan_events_type ON plan_events(event_type);

    -- CDev Phase 1.3 — channel events (peer-to-peer team coordination).
    -- Distinct from plan_events: channel events are durable manifest
    -- content (exported to .codetrellis/plans/<slug>/channels/*.yaml),
    -- carry a fixed vocabulary of six types (stuck, need-decision,
    -- need-context, handing-off, steer, weigh-in), and support threading
    -- via responds_to.
    CREATE TABLE IF NOT EXISTS channel_events (
      uid          TEXT PRIMARY KEY,
      plan_uid     TEXT NOT NULL REFERENCES plans(uid),
      item_uid     TEXT,
      event_type   TEXT NOT NULL,
      payload      TEXT NOT NULL DEFAULT '{}',
      author       TEXT NOT NULL,
      author_type  TEXT NOT NULL DEFAULT 'human',
      agent_model  TEXT,
      responds_to  TEXT REFERENCES channel_events(uid),
      status       TEXT NOT NULL DEFAULT 'open',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_events_plan ON channel_events(plan_uid, created_at);
    CREATE INDEX IF NOT EXISTS idx_channel_events_item ON channel_events(item_uid, created_at);
    CREATE INDEX IF NOT EXISTS idx_channel_events_type ON channel_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_channel_events_thread ON channel_events(responds_to);
    CREATE INDEX IF NOT EXISTS idx_channel_events_status ON channel_events(status, plan_uid);
  `);

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

  // Phase 17.R — external references table
  db.run(`
    CREATE TABLE IF NOT EXISTS external_refs (
      uid TEXT PRIMARY KEY,
      item_uid TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'url',
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      metadata TEXT DEFAULT NULL,
      author TEXT NOT NULL DEFAULT 'human',
      author_type TEXT NOT NULL DEFAULT 'human',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_external_refs_item ON external_refs(item_uid);
    CREATE INDEX IF NOT EXISTS idx_external_refs_kind ON external_refs(kind);
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
