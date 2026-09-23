/**
 * Declared schema for the CodeTrellis SQLite store.
 *
 * These constants are the **single source of truth** for what tables
 * and columns the running app expects. Two callers use them:
 *   1. `database.ts` — runs each block via `db.run(...)` on init so
 *      fresh installs land on the declared shape.
 *   2. `schema-reconciler.ts` — parses the same blocks and ALTERs any
 *      columns the declaration adds that the live DB is missing. This
 *      catches the "added a column to CREATE TABLE but forgot the
 *      ALTER" class of bug that bit `tasks.file_spec` in v0.1.8.
 *
 * Keep CREATE TABLE / CREATE INDEX in here. Lazy `ALTER TABLE` calls
 * for non-additive changes (NOT NULL with backfill, renames, data
 * migrations) stay in `database.ts` — the reconciler only handles
 * additive column drift.
 */

// AST tables (ephemeral — dropped + rebuilt on every project scan).
// Listed for completeness but excluded from reconciliation by name.
export const SCHEMA_AST = `
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
    is_namespace INTEGER DEFAULT 0,
    is_relative INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
  CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
  CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
  CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_id);

  -- Callsites are non-import couplings. The columns are generic "what was
  -- referenced" slots shared across protocols, not HTTP-specific ones:
  --   HTTP: method = GET/POST…,  url_pattern = /api/orders
  --   SQL:  method = READ/WRITE, url_pattern = table name, sql_text = snippet
  -- idx_callsites_url therefore serves both the route matcher and the
  -- table matcher. See services/sql/index.ts.
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
`;

export const SCHEMA_PLANS_CORE = `
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
`;

export const SCHEMA_ATTACHMENTS = `
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
    created_at INTEGER NOT NULL,
    -- Phase 31 §4.2 — an artefact is an attachment with a role and a hash.
    -- role: 'material' (input) · 'output' (produced by the work) ·
    -- 'evidence' (captured to prove something) · NULL for everything else.
    -- sha256/size/mtime are taken when recorded and re-taken whenever the
    -- file's size or mtime moves, so a decision can notice the file changed.
    role TEXT,
    sha256 TEXT,
    size INTEGER,
    mtime INTEGER,
    recorded_by TEXT,
    recorded_by_type TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_target ON attachments(target_uid);
  CREATE INDEX IF NOT EXISTS idx_attachments_target_type ON attachments(target_type, target_uid);
`;

export const SCHEMA_PLAN_ITEMS = `
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
    skills             TEXT NOT NULL DEFAULT '[]',
    skills_mode        TEXT DEFAULT 'inherit',
    claim_policy       TEXT DEFAULT NULL,
    claim_policy_mode  TEXT DEFAULT 'inherit',
    execution_config   TEXT DEFAULT NULL,
    execution_config_mode TEXT DEFAULT 'inherit',
    constraints        TEXT DEFAULT NULL,
    constraints_mode   TEXT DEFAULT 'inherit',
    requires_approval  INTEGER NOT NULL DEFAULT 0,
    author           TEXT NOT NULL,
    author_type      TEXT NOT NULL DEFAULT 'human',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    migrated_from    TEXT,
    estimate_minutes   INTEGER,
    estimate_cost_usd  REAL
  );
  CREATE INDEX IF NOT EXISTS idx_plan_items_plan       ON plan_items(plan_uid);
  CREATE INDEX IF NOT EXISTS idx_plan_items_parent     ON plan_items(parent_uid);
  CREATE INDEX IF NOT EXISTS idx_plan_items_kind       ON plan_items(kind);
  CREATE INDEX IF NOT EXISTS idx_plan_items_status     ON plan_items(status);
  CREATE INDEX IF NOT EXISTS idx_plan_items_sort       ON plan_items(plan_uid, parent_uid, sort_order);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_items_migrated ON plan_items(migrated_from);

  -- Phase 31 §4.1 — acceptance criteria as rows. A line of prose has no
  -- state, no owner and no evidence; a row has all three. text is
  -- VERBATIM — the requester's wording is what they will check against.
  -- state is derived (see criteria-service) and never stored.
  CREATE TABLE IF NOT EXISTS item_criteria (
    uid          TEXT PRIMARY KEY,
    item_uid     TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    text         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'manual',
    policy       TEXT NOT NULL DEFAULT 'propose',
    source       TEXT,
    author       TEXT NOT NULL,
    author_type  TEXT NOT NULL,
    origin_uid   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    -- When the wording last changed. Submissions and decisions older than
    -- this were about different words, so they no longer count.
    text_updated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_item_criteria_item ON item_criteria(item_uid, sort_order);

  -- One row per submission. attachment_uid is nullable: a submission can
  -- be a note alone ("done — see the body"), and that is still a claim
  -- someone has to judge.
  CREATE TABLE IF NOT EXISTS criterion_evidence (
    uid               TEXT PRIMARY KEY,
    criterion_uid     TEXT NOT NULL,
    submission_uid    TEXT NOT NULL,
    attachment_uid    TEXT,
    locator           TEXT,
    note              TEXT,
    sha256_at_submit  TEXT,
    submitted_by      TEXT NOT NULL,
    submitted_by_type TEXT NOT NULL,
    submitted_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_criterion_evidence_criterion ON criterion_evidence(criterion_uid, submitted_at);

  -- Append-only. A decision is a record, never a flag that approving
  -- destroys. evidence_hashes is filled from 31.2 on, when artefacts
  -- carry a hash; until then it is '{}'.
  CREATE TABLE IF NOT EXISTS criterion_signoffs (
    uid             TEXT PRIMARY KEY,
    criterion_uid   TEXT NOT NULL,
    decision        TEXT NOT NULL,
    actor           TEXT NOT NULL,
    actor_type      TEXT NOT NULL,
    channel         TEXT NOT NULL,
    note            TEXT,
    evidence_hashes TEXT NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_criterion_signoffs_criterion ON criterion_signoffs(criterion_uid, created_at);

  -- Items whose '## Acceptance criteria' body section has been read into
  -- rows. Kept apart from plan_items, whose reader maps columns by
  -- position, and so the pass can never run twice for an item.
  CREATE TABLE IF NOT EXISTS item_criteria_migrated (
    item_uid    TEXT PRIMARY KEY,
    migrated_at INTEGER NOT NULL
  );

  -- Phase 23 — time and cost. One row per closed TURN (see
  -- budget-service), not per tool call: an agent's wall-clock is mostly
  -- model thinking between calls, so summing tool durations would
  -- undercount it several-fold.
  --
  -- item_uid is nullable on purpose. Time an agent spends before
  -- claiming anything is real time and belongs to the plan; dropping it
  -- would make every plan look cheaper than it was.
  --
  -- cost_usd is nullable for the same reason costOf returns null:
  -- an agent that does not report its model has an unknown cost, and
  -- zero would read as free.
  CREATE TABLE IF NOT EXISTS item_time_entries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_uid           TEXT NOT NULL,
    item_uid           TEXT,
    session_id         TEXT,
    agent_type         TEXT,
    agent_model        TEXT,
    started_at         INTEGER NOT NULL,
    ended_at           INTEGER NOT NULL,
    input_tokens       INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cost_usd           REAL,
    pricing_version    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_time_entries_plan ON item_time_entries(plan_uid);
  CREATE INDEX IF NOT EXISTS idx_time_entries_item ON item_time_entries(item_uid);

  -- A ceiling is advisory, the same posture as the stuck sensor: we have
  -- no mechanism to halt an agent, and pretending otherwise would be
  -- worse than honest advice. notified_at exists so the 80% warning
  -- fires once rather than on every tool call.
  CREATE TABLE IF NOT EXISTS plan_budgets (
    plan_uid    TEXT PRIMARY KEY,
    minutes     INTEGER,
    cost_usd    REAL,
    exempt      INTEGER NOT NULL DEFAULT 0,
    notified_at INTEGER,
    updated_at  INTEGER NOT NULL
  );

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
`;

export const SCHEMA_SYSTEM_DOCS = `
  CREATE TABLE IF NOT EXISTS system_docs (
    uid TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    owner TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    "references" TEXT NOT NULL DEFAULT '{}',
    captured_against_commit TEXT,
    last_verified_at INTEGER,
    author TEXT NOT NULL DEFAULT 'human',
    author_type TEXT NOT NULL DEFAULT 'human',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_path, slug)
  );
  CREATE INDEX IF NOT EXISTS idx_system_docs_project ON system_docs(project_path);
  CREATE INDEX IF NOT EXISTS idx_system_docs_slug ON system_docs(slug);
  CREATE INDEX IF NOT EXISTS idx_system_docs_updated ON system_docs(updated_at DESC);
`;

export const SCHEMA_EXTERNAL_REFS = `
  CREATE TABLE IF NOT EXISTS external_refs (
    uid TEXT PRIMARY KEY,
    item_uid TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'url',
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    metadata TEXT DEFAULT NULL,
    external_key TEXT,
    author TEXT NOT NULL DEFAULT 'human',
    author_type TEXT NOT NULL DEFAULT 'human',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_external_refs_item ON external_refs(item_uid);
  CREATE INDEX IF NOT EXISTS idx_external_refs_kind ON external_refs(kind);

  -- Phase 24 — the ticket key (PROJ-412, ENG-88) as its own column.
  -- The URL already encodes it, but write-back needs to match on the key
  -- and re-import needs it to be idempotent, and re-parsing a URL at
  -- every comparison would make the key a derived value in two places.
  -- Nullable, so the reconciler adds it with no migration.

  -- Plan-level external refs. An epic maps to a PLAN, not to an item,
  -- and external_refs.item_uid is NOT NULL — a constraint the reconciler
  -- cannot relax. A separate table is honest about that rather than
  -- storing a plan uid in a column named item_uid.
  CREATE TABLE IF NOT EXISTS plan_external_refs (
    uid          TEXT PRIMARY KEY,
    plan_uid     TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'url',
    url          TEXT NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    external_key TEXT,
    metadata     TEXT DEFAULT NULL,
    author       TEXT NOT NULL DEFAULT 'human',
    author_type  TEXT NOT NULL DEFAULT 'human',
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_plan_external_refs_plan ON plan_external_refs(plan_uid);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_external_refs_key ON plan_external_refs(plan_uid, external_key);

  -- The write-back watermark. CodeTrellis never talks to Jira: the
  -- agent holds that credential and does the writing. All we owe it is
  -- "what changed since you last synced", which is this one timestamp.
  CREATE TABLE IF NOT EXISTS external_sync_state (
    plan_uid       TEXT PRIMARY KEY,
    last_synced_at INTEGER NOT NULL,
    synced_by      TEXT,
    note           TEXT
  );
`;

/**
 * Every table the reconciler keeps in sync with the live DB, in
 * declaration order.
 *
 * `SCHEMA_AST` is in here, and its absence was a bug — see
 * `EPHEMERAL_TABLES` below for what it cost. The old name
 * (`PERSISTENT_SCHEMA_SQL`) is kept as an alias because "persistent" was
 * never the distinction that mattered: the AST tables persist perfectly
 * well, they are just emptied on each scan.
 */
export const RECONCILED_SCHEMA_SQL = [
  SCHEMA_AST,
  SCHEMA_PLANS_CORE,
  SCHEMA_ATTACHMENTS,
  SCHEMA_PLAN_ITEMS,
  SCHEMA_SYSTEM_DOCS,
  SCHEMA_EXTERNAL_REFS,
].join('\n');

/** @deprecated Use `RECONCILED_SCHEMA_SQL`. */
export const PERSISTENT_SCHEMA_SQL = RECONCILED_SCHEMA_SQL;

/**
 * Table names the reconciler should ignore.
 *
 * **Nothing is ignored, and that is the fix.** This list held the five AST
 * tables, excluded on the grounds that they are "dropped + rebuilt on every
 * project scan, so reconciling them is wasted work". They are not dropped.
 * `storeParsedFile` and its neighbours clear them with `DELETE FROM`, and the
 * DDL is `CREATE TABLE IF NOT EXISTS` — which is a no-op against a table that
 * already exists. So a column added to an AST table reached new installs only.
 *
 * Phase 27 added `imports.is_relative`. On any database created before it,
 * every scan then failed with `table imports has no column named is_relative`
 * and fell back to "serving file tree only": no graph, no symbols, no edges,
 * with the failure logged once at info level and the UI showing an empty
 * project. Upgrading users would have lost the product's entire output.
 *
 * The reconciler is precisely the safety net for this, and it had been told
 * to look away from the tables most likely to need it. The cost of not
 * looking away is one `PRAGMA table_info` per table, once, at boot.
 */
export const EPHEMERAL_TABLES: string[] = [];
