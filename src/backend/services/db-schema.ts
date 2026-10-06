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
    is_relative INTEGER DEFAULT 0,
    -- Phase 32 A2.2: \`export … from\` — the file passes these names on
    -- rather than using them, so an importer lookup follows it.
    is_reexport INTEGER DEFAULT 0
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
    -- How the edit arrived (carried 2b). Null on rows from before it was kept.
    author_type TEXT,
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
    status TEXT NOT NULL DEFAULT 'active',
    -- The workstream it works in (Phase 32 A1.1): a trusted root or one of
    -- its worktrees, as the user opened it. Re-derived on every connect.
    workstream_root TEXT
  );

  -- Phase 32 B1: every agent event that was broadcast (tool calls, watcher
  -- events, sessions starting and ending), kept so the Timeline survives a
  -- reload and replay has a record. Stamped at the tap with the session, the
  -- agent and the workstream it works in. Kept 14 days (agent-event-log.ts).
  CREATE TABLE IF NOT EXISTS agent_events (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    session_id TEXT,
    agent_type TEXT,
    workstream_root TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_events_at ON agent_events(at);
  CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id, at);
  CREATE INDEX IF NOT EXISTS idx_agent_events_workstream ON agent_events(workstream_root, at);

  -- Phase 32 B10.1: the record. One link per agent event, each hashing the
  -- one before it, so a change, a removal or a forged row is found by
  -- walking it (record-chain.ts). The anchor is the last link retention
  -- trimmed, so what is kept still verifies.
  CREATE TABLE IF NOT EXISTS record_chain (
    seq INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    linked_at INTEGER NOT NULL,
    digest TEXT NOT NULL,
    prev TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_record_chain_linked ON record_chain(linked_at);
  CREATE TABLE IF NOT EXISTS record_anchor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    through_seq INTEGER NOT NULL,
    hash TEXT NOT NULL,
    at INTEGER NOT NULL
  );

  -- Phase 32 C1.3: proof a skill was used on a task. Claude Code records each
  -- skill it loads as a Skill tool call; the watcher stores one row per task
  -- that a Claude Code session in the same workstream is working. Kept with
  -- the task, not the 14-day event log: the sign-off pack cites it.
  CREATE TABLE IF NOT EXISTS skill_uses (
    item_uid TEXT NOT NULL,
    skill TEXT NOT NULL,
    session_id TEXT,
    workstream_root TEXT,
    at INTEGER NOT NULL,
    -- Phase 32 A8.4: how it was seen. 'session_log' (Claude Code's own log,
    -- read by the watcher) or 'mcp' (read through get_skill, any client).
    source TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_skill_uses_item ON skill_uses(item_uid, skill);

  -- Phase 32 A6.2: which session read which material through read_material,
  -- and the file's hash when it did. item_uid is the task the read counts
  -- for: the session's brief task, or the material's own task when the
  -- session has none. path is the attachment's value (project-relative for
  -- a recorded file), so two tasks' attachments of one file name the same
  -- material.
  CREATE TABLE IF NOT EXISTS material_reads (
    item_uid TEXT NOT NULL,
    session_id TEXT,
    attachment_uid TEXT NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT,
    locator TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_material_reads_item ON material_reads(item_uid, at);
  CREATE INDEX IF NOT EXISTS idx_material_reads_path ON material_reads(path);

  -- Phase 32 C2.2a: a review host turned on for a project, on this device.
  -- Kept here and not in .codetrellis/config.json, which is committed: a
  -- cloned repository must never be able to turn on a request to a host.
  -- slug is the repository it was turned on for; if the remote later names
  -- another, the switch no longer applies. No token is ever stored here
  -- (secret-store.ts).
  CREATE TABLE IF NOT EXISTS review_hosts (
    project_root TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    slug TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    changed_at INTEGER NOT NULL,
    changed_by TEXT NOT NULL
  );

  -- Phase 32 B8.1: test reports an agent or a test criterion handed over,
  -- and each test's last result from them. CodeTrellis never runs tests:
  -- these are what the runs said, with when they ran (the report's mtime).
  CREATE TABLE IF NOT EXISTS test_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_root TEXT NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    tests INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    failed INTEGER NOT NULL,
    errors INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    ran_at INTEGER NOT NULL,
    reported_at INTEGER NOT NULL,
    reported_by TEXT NOT NULL,
    reported_by_type TEXT NOT NULL,
    UNIQUE (project_root, sha256)
  );
  CREATE TABLE IF NOT EXISTS test_results (
    project_root TEXT NOT NULL,
    test_key TEXT NOT NULL,
    suite TEXT,
    classname TEXT,
    name TEXT NOT NULL,
    file TEXT,
    result TEXT NOT NULL,
    duration_ms INTEGER,
    message TEXT,
    report_id INTEGER NOT NULL,
    ran_at INTEGER NOT NULL,
    PRIMARY KEY (project_root, test_key)
  );
  -- Phase 32 B8.4b: every report's own cases, so replay can say what the
  -- tests said at a past moment (test_results keeps only the latest). Kept
  -- as long as replay frames are.
  CREATE TABLE IF NOT EXISTS test_report_cases (
    report_id INTEGER NOT NULL,
    test_key TEXT NOT NULL,
    suite TEXT,
    classname TEXT,
    name TEXT NOT NULL,
    file TEXT,
    result TEXT NOT NULL,
    duration_ms INTEGER,
    message TEXT,
    PRIMARY KEY (report_id, test_key)
  );

  -- Phase 32 B9.3a: what a person did about a planned overlap (re-sequenced
  -- the plans, told the agents, or left it), by its id (the subject and the
  -- plans it is between), with who from the transport and when.
  CREATE TABLE IF NOT EXISTS planned_overlap_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    overlap_id TEXT NOT NULL,
    project_root TEXT NOT NULL,
    action TEXT NOT NULL,
    words TEXT NOT NULL,
    by_name TEXT NOT NULL,
    by_type TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  -- Phase 32 B9.3b: a plan approved into planned overlaps, said once in the
  -- inbox until a person marks it seen.
  CREATE TABLE IF NOT EXISTS planned_overlap_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_root TEXT NOT NULL,
    plan_uid TEXT NOT NULL,
    plan_label TEXT NOT NULL,
    words_json TEXT NOT NULL,
    at INTEGER NOT NULL,
    seen_at INTEGER,
    seen_by TEXT
  );
  -- Phase 32 C4.1: a recurring playbook's run, as started here: its series,
  -- period, the run before it and the tasks carried from it. A run started on
  -- another machine is found by its id (derived from rule and period), not here.
  CREATE TABLE IF NOT EXISTS recurring_runs (
    plan_uid TEXT PRIMARY KEY,
    project_root TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    period TEXT NOT NULL,
    label TEXT NOT NULL,
    previous_uid TEXT,
    carried_json TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER NOT NULL,
    started_by TEXT NOT NULL
  );
  -- Phase 32 C4.2a: a due run the person chose not to start this time, on
  -- this device. It stays due until its period ends, then reads missed.
  CREATE TABLE IF NOT EXISTS recurring_dismissed (
    project_root TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    period TEXT NOT NULL,
    by_name TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (project_root, rule_id, period)
  );
  -- Phase 32 C4.3b: on this device, start an agent on each run of a rule.
  -- Off unless the person turned it on here; never in the committed config.
  CREATE TABLE IF NOT EXISTS recurring_agents (
    project_root TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    agent TEXT NOT NULL,
    by_name TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (project_root, rule_id)
  );
  -- Each session told of a planned overlap its task is in, read once.
  CREATE TABLE IF NOT EXISTS planned_overlap_tells (
    overlap_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    PRIMARY KEY (overlap_id, session_id)
  );

  -- Phase 32 C3.1: task state shared as records in the project's files, per
  -- project, on this device only (never the committed config). Off until
  -- the person turns it on.
  CREATE TABLE IF NOT EXISTS shared_task_state (
    project_root TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    changed_at INTEGER NOT NULL,
    changed_by TEXT NOT NULL
  );

  -- Phase 32 C3.1: this device's writer id for task-state records (one row),
  -- and, per item, the record whose state this machine last took or wrote:
  -- reading the same records again changes nothing.
  CREATE TABLE IF NOT EXISTS task_record_writer (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    writer TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_record_heads (
    item_uid TEXT PRIMARY KEY,
    writer TEXT NOT NULL,
    counter INTEGER NOT NULL,
    split TEXT,
    verdict TEXT
  );

  -- Phase 32 C3.3: this device's own signing key for its records (one row),
  -- used when git signing has no SSH key; the private half stays here. And
  -- teammates' device keys, as introduced in a project's .codetrellis/keys:
  -- 'new' until the person trusts or refuses one, in Settings.
  -- Phase 32 C3.4a: this device's copy of a project's plans folder, as the
  -- person confirmed it. The committed config only names the folder; a
  -- cloned repository never points the app at one by itself.
  CREATE TABLE IF NOT EXISTS linked_plans_folder (
    project_root TEXT PRIMARY KEY,
    local_path TEXT NOT NULL,
    ref TEXT NOT NULL,
    confirmed_at INTEGER NOT NULL,
    confirmed_by TEXT NOT NULL
  );

  -- Phase 32 C3.5: teammates' material reads. The switch, per project on this
  -- device: no row means on whenever task state is shared (the owner's
  -- choice); a row says the person turned it off, or back on. And each
  -- teammate's read record read here, with whether it verified (C3.3); none
  -- of this device's own, which material_reads already has.
  CREATE TABLE IF NOT EXISTS shared_material_reads (
    project_root TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    changed_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teammate_material_reads (
    writer TEXT NOT NULL,
    item_uid TEXT NOT NULL,
    counter INTEGER NOT NULL,
    plan_uid TEXT NOT NULL,
    name TEXT NOT NULL,
    reader TEXT NOT NULL,
    attachment_uid TEXT,
    path TEXT NOT NULL,
    sha256 TEXT,
    at INTEGER NOT NULL,
    verdict TEXT,
    PRIMARY KEY (writer, item_uid, counter)
  );
  CREATE INDEX IF NOT EXISTS idx_teammate_material_reads_item ON teammate_material_reads(item_uid, at);

  -- Phase 32 D1.5a: each teammate device's latest test run in a project, read
  -- from its run record in the plans folder (.codetrellis/runs/). One row per
  -- device: a newer run replaces it. Forgotten when sharing is turned off.
  CREATE TABLE IF NOT EXISTS teammate_test_runs (
    project_root TEXT NOT NULL,
    writer TEXT NOT NULL,
    counter INTEGER NOT NULL,
    name TEXT NOT NULL,
    by_author TEXT NOT NULL,
    by_type TEXT NOT NULL,
    commit_sha TEXT,
    dirty TEXT NOT NULL,
    at INTEGER NOT NULL,
    report TEXT NOT NULL,
    totals TEXT NOT NULL,
    files TEXT NOT NULL,
    verdict TEXT,
    PRIMARY KEY (project_root, writer)
  );

  -- Phase 33 C7: every rule check is a run (not Phase 31's criterion check_runs). This device's runs (mine = 1) and
  -- teammates' latest, read from their check-run records in the plans folder
  -- (.codetrellis/runs/checks/). Teammates' are forgotten when sharing is off.
  CREATE TABLE IF NOT EXISTS rule_check_runs (
    project_root TEXT NOT NULL,
    id TEXT NOT NULL,
    mine INTEGER NOT NULL,
    writer TEXT NOT NULL,
    counter INTEGER NOT NULL,
    name TEXT NOT NULL,
    by_author TEXT NOT NULL,
    by_type TEXT NOT NULL,
    ran_in TEXT NOT NULL,
    commit_sha TEXT,
    dirty TEXT NOT NULL,
    base TEXT,
    rulebook TEXT,
    scope TEXT,
    strict INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    says TEXT NOT NULL,
    findings TEXT NOT NULL,
    at INTEGER NOT NULL,
    verdict TEXT,
    PRIMARY KEY (project_root, id)
  );
  CREATE INDEX IF NOT EXISTS idx_rule_check_runs_at ON rule_check_runs(project_root, at);

  CREATE TABLE IF NOT EXISTS task_record_device_key (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_record_keys (
    writer TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    public_key TEXT NOT NULL,
    name TEXT NOT NULL,
    project_root TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'new',
    first_seen INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by TEXT,
    PRIMARY KEY (writer, fingerprint)
  );

  -- Phase 32 C2.6a: a plan that first reached this machine through its files
  -- (a pull, a copy, an import), with who added it and in which commit, as
  -- git says; nulls when it was not committed yet. A plan made here has none.
  CREATE TABLE IF NOT EXISTS plan_arrivals (
    plan_uid TEXT PRIMARY KEY,
    added_by TEXT,
    commit_sha TEXT,
    arrived_at INTEGER NOT NULL
  );

  -- Phase 32 C2.5b: approvals as signed statements. One row per approval
  -- this machine signed (or could not), and per signed record read from a
  -- plan's approvals/ folder, with whether it verified and why not. A
  -- verified record also adds the person's sign-off to criterion_signoffs.
  CREATE TABLE IF NOT EXISTS signed_approvals (
    uid TEXT PRIMARY KEY,
    plan_uid TEXT NOT NULL,
    item_uid TEXT NOT NULL,
    criterion_uid TEXT NOT NULL,
    signer TEXT,
    origin TEXT NOT NULL,
    state TEXT NOT NULL,
    reason TEXT,
    file TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_signed_approvals_item ON signed_approvals(item_uid);

  -- Phase 32 C1.4: a skill that arrived in a plan file (pulled through git,
  -- or edited by hand) is held back from agents until a person accepts it.
  -- One row per arrival: who added it and in which commit, as git says.
  CREATE TABLE IF NOT EXISTS skill_arrivals (
    item_uid TEXT NOT NULL,
    skill TEXT NOT NULL,
    added_by TEXT,
    commit_sha TEXT,
    arrived_at INTEGER NOT NULL,
    accepted_at INTEGER,
    accepted_by TEXT,
    accepted_by_type TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_skill_arrivals_item ON skill_arrivals(item_uid, skill);

  -- Phase 32 B4: a place a person has said "stop and ask me". A task
  -- breakpoint fires when an agent claims or finishes the task (or anything
  -- under it); a spec breakpoint when an agent changes its description; a
  -- code breakpoint (B4.2) when a workstream changes a file under it, its
  -- target a repository-relative path (a folder ends in /, a function is
  -- path#name) in project_root; a signal breakpoint (B4.2b) is a project
  -- rule whose target is a signal kind. Kept after it is cleared, because
  -- the hits it caused cite it.
  CREATE TABLE IF NOT EXISTS breakpoints (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    plan_uid TEXT,
    project_root TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_by_type TEXT NOT NULL,
    cleared_at INTEGER,
    cleared_by TEXT,
    cleared_by_type TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_breakpoints_target ON breakpoints(target);

  -- Phase 32 B4: one agent call held at a breakpoint, and the person's
  -- answer. The agent waits on it by ref (await_decision), from the database,
  -- so the wait survives timeouts and restarts. \`consumed_at\` is set when
  -- the agent's next matching call spends the answer. A code hit (B4.2) names
  -- the file in \`path\` (item_uid is empty); \`breach\` is 1 when the change was
  -- only seen after it was made, never paused. A signal hit (B4.2b) names
  -- the signal that held the call in \`signal_id\`.
  CREATE TABLE IF NOT EXISTS breakpoint_hits (
    ref TEXT PRIMARY KEY,
    breakpoint_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    action TEXT NOT NULL,
    item_uid TEXT NOT NULL,
    path TEXT,
    breach INTEGER NOT NULL DEFAULT 0,
    signal_id TEXT,
    plan_uid TEXT,
    agent TEXT,
    session_id TEXT,
    workstream_root TEXT,
    hit_at INTEGER NOT NULL,
    decision TEXT,
    note TEXT,
    answered_at INTEGER,
    answered_by TEXT,
    answered_by_type TEXT,
    consumed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_breakpoint_hits_waiting ON breakpoint_hits(answered_at, hit_at);

  -- Phase 32 A1.6: one thing worth knowing about parallel work. Deduplicated
  -- by id (kind, subject, workstreams); resolved when its cause goes away.
  CREATE TABLE IF NOT EXISTS awareness_signals (
    id TEXT PRIMARY KEY,
    project_root TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    subject TEXT NOT NULL,
    workstreams TEXT NOT NULL,
    summary TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    resolved_at INTEGER,
    -- A1.8: who set the state (JSON, from actorFrom) and when.
    state_by TEXT,
    state_at INTEGER,
    -- A3.2: what it is about, fingerprinted; an answer holds while it does.
    shape TEXT,
    -- A3.2: it was acknowledged or intended, and opened again when its shape changed.
    reopened_from TEXT,
    reopened_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_awareness_project ON awareness_signals(project_root);

  -- Phase 32 A2.6: which agent session was told about a signal (once), and
  -- the note it left with acknowledge_signal. The agent's own words: shown
  -- to the person, never to another agent.
  CREATE TABLE IF NOT EXISTS awareness_signal_notes (
    signal_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    told_at INTEGER,
    note TEXT,
    noted_at INTEGER,
    PRIMARY KEY (signal_id, session_id)
  );

  -- Phase 32 B5.2: each time a signal was open, for replay. A signal keeps
  -- one row in awareness_signals and is reopened in place, so its earlier
  -- openings would be lost; here each opening is a row, closed when it
  -- resolves. Kept 14 days after it closes, like the agent event log.
  CREATE TABLE IF NOT EXISTS awareness_signal_spans (
    signal_id TEXT NOT NULL,
    project_root TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    summary TEXT NOT NULL,
    workstreams TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    PRIMARY KEY (signal_id, opened_at)
  );
  CREATE INDEX IF NOT EXISTS idx_signal_spans_project ON awareness_signal_spans(project_root, opened_at);

  -- Phase 32 A4.1: a person's message to the agents about a signal, and
  -- which agent sessions have read it (once each, on their next tool call).
  CREATE TABLE IF NOT EXISTS awareness_signal_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id TEXT NOT NULL,
    project_root TEXT NOT NULL,
    message TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_signal_replies_signal ON awareness_signal_replies(signal_id, created_at);
  CREATE TABLE IF NOT EXISTS awareness_signal_reply_reads (
    reply_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (reply_id, session_id)
  );

  -- Phase 32 B7.1: what a task relies on, a spec page or one section of it
  -- (a heading, by slug; '' for the whole page). Who relies on a page is
  -- read back across every plan of its project.
  CREATE TABLE IF NOT EXISTS spec_links (
    item_uid TEXT NOT NULL,
    page_uid TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL,
    author_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (item_uid, page_uid, section)
  );
  CREATE INDEX IF NOT EXISTS idx_spec_links_page ON spec_links(page_uid);

  -- Phase 32 B7.2: a proposed change to a spec page, made against a version
  -- of it, with why and the evidence. The page is not touched until a person
  -- accepts (B7.4). \`affected\` is who relied on it when it was made.
  CREATE TABLE IF NOT EXISTS spec_proposals (
    uid TEXT PRIMARY KEY,
    page_uid TEXT NOT NULL,
    plan_uid TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    base_version INTEGER NOT NULL,
    before_text TEXT NOT NULL,
    proposed_text TEXT NOT NULL,
    why TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '{}',
    affected TEXT NOT NULL DEFAULT '[]',
    author TEXT NOT NULL,
    author_type TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by TEXT,
    decided_by_type TEXT,
    decision_note TEXT,
    hit_ref TEXT,
    decided_text TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_spec_proposals_page ON spec_proposals(page_uid, status);

  -- Phase 33 R3: an agent proposes a change to an architecture rule; a
  -- person sees what it would do against the code and decides. The rule is
  -- the body an agent proposed, by field; null for stopping the rule.
  CREATE TABLE IF NOT EXISTS rule_proposals (
    uid TEXT PRIMARY KEY,
    project_root TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    body TEXT,
    why TEXT NOT NULL,
    effect TEXT,
    words TEXT NOT NULL,
    author TEXT NOT NULL,
    author_type TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by TEXT,
    decided_by_type TEXT,
    decision_note TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rule_proposals_project ON rule_proposals(project_root, status);

  -- Phase 33 V3: the commit each reviewer last looked at, per line of work,
  -- with what the review said then, so a later look shows only what moved
  -- and which findings the pushes since addressed.
  CREATE TABLE IF NOT EXISTS review_marks (
    project_root TEXT NOT NULL,
    target TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    reviewer_type TEXT NOT NULL,
    base TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    findings TEXT NOT NULL DEFAULT '[]',
    at INTEGER NOT NULL,
    PRIMARY KEY (project_root, target, reviewer)
  );

  -- Phase 32 B7.3: each session holding an affected task is told of an open
  -- proposal once; this is who has been.
  CREATE TABLE IF NOT EXISTS spec_proposal_reads (
    proposal_uid TEXT NOT NULL,
    session_id TEXT NOT NULL,
    agent_type TEXT,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (proposal_uid, session_id)
  );

  -- Phase 32 B7.3: what a proposal would mean for the work relying on it,
  -- from the agent doing that work: none, or changes with a sentence.
  CREATE TABLE IF NOT EXISTS spec_proposal_impacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_uid TEXT NOT NULL,
    impact TEXT NOT NULL,
    words TEXT NOT NULL DEFAULT '',
    tasks INTEGER,
    item_uid TEXT,
    plan_uid TEXT,
    author TEXT NOT NULL,
    author_type TEXT NOT NULL,
    session_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spec_proposal_impacts ON spec_proposal_impacts(proposal_uid);

  -- Phase 32 B7.4: a task whose spec changed under it, by an accepted
  -- proposal. Flagged until the agent holding it has been told (read_at).
  CREATE TABLE IF NOT EXISTS spec_change_flags (
    item_uid TEXT NOT NULL,
    proposal_uid TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    read_by_session TEXT,
    PRIMARY KEY (item_uid, proposal_uid)
  );

  -- Phase 32 B7.4: the proposing session told of the decision, once.
  CREATE TABLE IF NOT EXISTS spec_proposal_outcome_reads (
    proposal_uid TEXT NOT NULL,
    session_id TEXT NOT NULL,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (proposal_uid, session_id)
  );

  -- Phase 32 A1.7c: folders an agent reported that the person said "not now"
  -- to. Asked once per folder, not once per connection.
  CREATE TABLE IF NOT EXISTS folder_request_dismissals (
    folder TEXT PRIMARY KEY,
    dismissed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deviations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_uid TEXT NOT NULL REFERENCES plans(uid),
    deviation_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    description TEXT NOT NULL,
    resolution TEXT NOT NULL DEFAULT 'pending',
    detected_at INTEGER NOT NULL,
    resolved_at INTEGER,
    file_path TEXT,
    -- Who resolved it, tagged as everything else is (Phase 32 §0.4h).
    resolved_by TEXT,
    resolved_by_type TEXT
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
    created_at INTEGER NOT NULL,
    -- Phase 32 B5.1: a replay frame (snapshot_type 'frame') says whose graph
    -- it is, what caused it and at which commit. A frame whose graph matches
    -- the one before points at it (same_as) and stores no copy. Indexed by
    -- replay-frames.ts once these columns exist on an older database.
    project_path TEXT,
    reason TEXT,
    ref TEXT,
    session_id TEXT,
    agent_type TEXT,
    workstream_root TEXT,
    commit_sha TEXT,
    digest TEXT,
    same_as INTEGER
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
    -- How the edit arrived (carried 2b). Null on rows from before it was kept.
    author_type TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(doc_uid, version)
  );

  CREATE INDEX IF NOT EXISTS idx_plan_doc_versions ON plan_document_versions(doc_uid);

  -- A guarded plan document's file changed on disk (Phase 32 B7.5b): the
  -- file's version, kept beside the breakpoint hit until a person decides.
  -- The app's own version stays in plan_documents meanwhile.
  CREATE TABLE IF NOT EXISTS plan_doc_disk_holds (
    ref TEXT PRIMARY KEY,
    doc_uid TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_plan_doc_disk_holds_doc ON plan_doc_disk_holds(doc_uid);

  CREATE TABLE IF NOT EXISTS recent_projects (
    path TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    branch TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    last_opened_at INTEGER NOT NULL,
    first_opened_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_recent_projects_opened ON recent_projects(last_opened_at DESC);

  -- Projects pushed off recent_projects by the unpinned cap. Read ONLY to
  -- explain a refusal ("this was opened, then dropped off"); it is never a
  -- source of trust. Cleared when the project is opened again.
  CREATE TABLE IF NOT EXISTS evicted_projects (
    path TEXT PRIMARY KEY,
    evicted_at INTEGER NOT NULL
  );
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
    -- The MCP session that claimed it (Phase 32 bug 1): two agents of one
    -- type are two claimants. Runtime only, never written to plan files.
    assignee_session TEXT,
    -- Phase 32 C5.1 — the branch this section is worked on, inherited by
    -- everything under it. A branch, not a folder: plan files are shared
    -- across checkouts and machines, and a folder means nothing on another.
    workstream       TEXT,
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
    created_at      INTEGER NOT NULL,
    -- Phase 31 §8.2: a send-back taken from the exact place — the file and
    -- the locator (cell, lines, page) the note is about.
    anchor_attachment_uid TEXT,
    anchor_locator        TEXT,
    -- Phase 31 §13: which device a person decided on — a paired phone's
    -- alias. NULL for the desktop and for anything decided before this.
    device                TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_criterion_signoffs_criterion ON criterion_signoffs(criterion_uid, created_at);

  -- Items whose '## Acceptance criteria' body section has been read into
  -- rows. Kept apart from plan_items, whose reader maps columns by
  -- position, and so the pass can never run twice for an item.
  CREATE TABLE IF NOT EXISTS item_criteria_migrated (
    item_uid    TEXT PRIMARY KEY,
    migrated_at INTEGER NOT NULL
  );

  -- Phase 31 §8.3 — a check run: every criterion's mechanical checks
  -- re-run and recorded. Append-only; a run never approves anything, so a
  -- plan can say "passed its last three runs" and mean it.
  CREATE TABLE IF NOT EXISTS check_runs (
    uid          TEXT PRIMARY KEY,
    plan_uid     TEXT NOT NULL,
    trigger      TEXT NOT NULL,
    by_actor     TEXT NOT NULL,
    by_type      TEXT NOT NULL,
    -- JSON array of item uids when the run covered only some items
    -- (a material changed); NULL for the whole plan.
    scope        TEXT,
    outcomes     TEXT NOT NULL,
    since_last   TEXT NOT NULL DEFAULT '[]',
    started_at   INTEGER NOT NULL,
    finished_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_check_runs_plan ON check_runs(plan_uid, started_at);

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

  -- Every change to a plan's ceiling, append-only: who made it, how it
  -- arrived, and what it was before. An agent may change a budget (it is
  -- advisory), and a change an agent made is flagged until a person has
  -- seen it (Phase 32 §0.4g, owner's decision).
  CREATE TABLE IF NOT EXISTS plan_budget_changes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_uid         TEXT NOT NULL,
    actor            TEXT NOT NULL,
    actor_type       TEXT NOT NULL,
    channel          TEXT NOT NULL,
    before_json      TEXT,
    after_json       TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    acknowledged_at  INTEGER,
    acknowledged_by  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_plan_budget_changes_plan ON plan_budget_changes(plan_uid, created_at);

  -- Every change to a project's freeze, who made it and how it arrived
  -- (owner's decision, Phase 32 §0.4k). The freeze itself lives in the
  -- project's .codetrellis/config.json; this is the record of who changed it.
  CREATE TABLE IF NOT EXISTS project_freeze_changes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path     TEXT NOT NULL,
    actor            TEXT NOT NULL,
    actor_type       TEXT NOT NULL,
    channel          TEXT NOT NULL,
    before_json      TEXT,
    after_json       TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    acknowledged_at  INTEGER,
    acknowledged_by  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_project_freeze_changes_project ON project_freeze_changes(project_path, created_at);

  -- The graph diff's baseline, per project, so a restart restores it
  -- instead of re-capturing the tree at launch (Phase 32 §0.6, bug 9).
  CREATE TABLE IF NOT EXISTS project_baselines (
    project_path  TEXT PRIMARY KEY,
    data_json     TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
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
