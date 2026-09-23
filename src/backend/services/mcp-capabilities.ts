import { type PeerCapability, DEFAULT_GRANTS } from './peer-capabilities';
import { evictedHint, isTrustedProjectRoot, isTrustedPlanDir } from './trusted-roots';
import type { McpProjectScope } from '../../shared/types/settings';

/**
 * What an MCP client is allowed to ask the desktop to do — Phase 30.
 *
 * WHAT WAS WRONG
 *
 * The MCP server exposed 174 tools and authorised none of them. Holding the
 * per-launch capability token granted every tool to every caller, and among
 * those tools are `terminal_create`, `terminal_write`, `terminal_kill` and
 * `write_remote_terminal` — arbitrary command execution on the user's
 * machine.
 *
 * The product had already decided this question the other way on its other
 * surface: a paired phone must hold the `terminal` capability AND have a
 * confirmed pairing before it can drive a terminal. An MCP client needed
 * nothing. `CLAUDE.md` states the rule — "MCP tools authorise per tool by
 * capability, not per connection" — and nothing implemented it. What existed
 * was `register_session`, where an agent DECLARES its capabilities, and a
 * self-declaration is a description rather than an authorisation.
 *
 * THE ARGUMENT THAT DOES NOT SAVE US
 *
 * The usual defence is that an MCP client is a local process that could run
 * commands itself, so gating them is theatre. That fails here, for a reason
 * the product states about itself: CodeTrellis is agent-agnostic on purpose
 * and names Claude Desktop among its clients. Claude Desktop has no shell.
 * Neither does a hosted or sandboxed runtime. For any client that cannot
 * already execute, CodeTrellis was a privilege-escalation route — connect
 * it, and it gains a shell it did not have.
 *
 * DENY BY DEFAULT
 *
 * Every tool must appear below with an explicit capability. A tool that is
 * not listed is REFUSED, so registering a tool without thinking about
 * authorisation fails closed rather than shipping open. `mcp-authorisation.test.ts`
 * asserts the matrix covers every name the server ACTUALLY registered —
 * enumerated at runtime, not from a hand-kept list, because a list checked
 * against itself verifies nothing.
 *
 * WHAT THIS DOES NOT SOLVE
 *
 * Stated so the feature is not oversold:
 *
 *  - An agent holding `write` can still change any plan it can reach.
 *  - The token remains all-or-nothing for WHO MAY CONNECT. This governs what
 *    a connected client may do, not whether it may connect.
 *  - An agent that has its own shell is unaffected; it never needed ours.
 *    The win is specifically against clients that CANNOT execute.
 *  - Grants are per-installation, not per-agent. One user enabling `terminal`
 *    enables it for every client on that machine. Per-agent grants are a
 *    second phase (see the spec's §4.5 option B).
 */

/**
 * Every MCP tool, mapped to the capability it needs.
 *
 * Grouped by the file that registers it, in registration order, so this can
 * be eyeballed against `mcp/tools/` side by side.
 */
export const TOOL_CAPABILITIES: Readonly<Record<string, PeerCapability>> = Object.freeze({
  // ── architecture-tools ──────────────────────────────────────────────
  search_symbols: 'read',
  get_dependencies: 'read',
  check_architecture: 'read',
  list_cross_system_edges: 'read',
  check_conformity: 'read',

  // ── budget-tools ────────────────────────────────────────────────────
  get_budget: 'read',
  set_budget: 'write',
  check_budget: 'read',

  // ── channel-tools ───────────────────────────────────────────────────
  post_channel_event: 'write',
  list_channel_events: 'read',
  get_channel_thread: 'read',
  resolve_channel_event: 'write',
  dismiss_channel_event: 'write',

  // ── drift-tools ─────────────────────────────────────────────────────
  get_deviations: 'read',
  reconcile: 'write',
  detect_deviations: 'read',
  list_proposed_changes: 'read',
  get_changes_summary: 'read',
  get_change_status: 'read',
  get_drift_report: 'read',
  capture_checkpoint: 'write',

  // ── git-tools ───────────────────────────────────────────────────────
  // `commit_manifest_changes` and `resolve_conflict` mutate the repository,
  // but only under `.codetrellis/` — the manifest this product owns. That is
  // persisting plan state, which is what `write` means here.
  commit_manifest_changes: 'write',
  get_team_activity: 'read',
  get_plan_history: 'read',
  get_plan_at_commit: 'read',
  diff_plan_between_commits: 'read',
  search_plan_history: 'read',
  detect_conflicts: 'read',
  resolve_conflict: 'write',

  // ── governance-tools ────────────────────────────────────────────────
  get_freeze_status: 'read',
  set_freeze: 'write',
  check_freeze: 'read',
  exempt_plan_from_freeze: 'write',

  // ── graph-tools ─────────────────────────────────────────────────────
  // Driving the graph changes what is on the user's screen. That is not
  // `read`, even though no data is written: an agent granted only `read`
  // should not be able to move the view the user is looking at. `graph_export`
  // and `graph_snapshot` return the graph's own contents and are `read`.
  graph_focus: 'write',
  graph_set_mode: 'write',
  graph_set_scope: 'write',
  graph_select: 'write',
  graph_set_layout: 'write',
  graph_set_depth: 'write',
  graph_toggle_projection: 'write',
  graph_export: 'read',
  graph_snapshot: 'read',
  // Not `capture`: this returns whether the window is usable, never what
  // is on it. Any agent about to drive the UI should be able to ask
  // first — gating it behind a capability most installs withhold would
  // leave exactly the agents that need it unable to check.
  ui_ready: 'read',

  // ── intake-tools ────────────────────────────────────────────────────
  create_plan_from_external: 'write',
  set_plan_external_ref: 'write',
  get_external_sync_state: 'read',
  mark_external_synced: 'write',
  list_plan_external_refs: 'read',

  // ── mobile-tools ────────────────────────────────────────────────────
  // These drive a PAIRED DEVICE. `mobile_screenshot` returns a picture of
  // someone's phone screen, which is `capture` for the same reason the
  // desktop screenshot is.
  mobile_navigate: 'write',
  mobile_screenshot: 'capture',
  mobile_present: 'write',

  // ── plan-item-tools ─────────────────────────────────────────────────
  add_item: 'write',
  bulk_add_items: 'write',
  get_item: 'read',
  read_item_full: 'read',
  update_item: 'write',
  move_item: 'write',
  delete_item: 'write',
  claim_item: 'write',
  get_next_item: 'read',
  // Retired in Phase 31.1 — it refuses. Kept one release so an agent that
  // learned it gets a direction rather than a missing tool.
  approve_gate: 'read',
  list_criteria: 'read',
  record_artefact: 'write',
  add_criterion: 'write',
  submit_criterion: 'write',
  // Phase 31 §8 — the loops. Reads: they report, and a check run is a
  // record of what was found, never a decision.
  check_criterion: 'read',
  get_worklist: 'read',
  run_checks: 'read',
  list_items: 'read',
  search_items: 'read',
  get_plan_timeline: 'read',
  restore_item_version: 'write',
  list_item_versions: 'read',
  list_item_comments: 'read',
  resolve_reference: 'read',
  add_item_comment: 'write',
  update_item_progress: 'write',
  set_item_blocked: 'write',
  add_item_attachment: 'write',
  delete_item_comment: 'write',
  delete_item_attachment: 'write',
  list_external_refs: 'read',
  add_external_ref: 'write',
  remove_external_ref: 'write',
  suggest_specs: 'read',
  get_plan_summary: 'read',

  // ── plan-tools ──────────────────────────────────────────────────────
  // The four file-mapping tools are `files`: they read and write plan
  // documents on disk rather than rows in the database.
  create_plan: 'write',
  get_plan: 'read',
  update_plan: 'write',
  list_plans: 'read',
  delete_plan: 'write',
  bulk_delete_plans: 'write',
  export_plan_to_files: 'files',
  import_plan_from_files: 'files',
  discover_plan_files: 'files',
  unlink_plan_from_files: 'write',
  publish_plan_as_template: 'write',
  list_plan_templates: 'read',
  create_plan_from_template: 'write',
  import_external: 'write',
  copy_plan_as_prompt: 'read',
  set_plan_home_repo: 'write',
  add_plan_scope: 'write',
  remove_plan_scope: 'write',
  list_plan_pointers: 'read',
  list_plans_by_repo: 'read',

  // ── presence-tools ──────────────────────────────────────────────────
  // These interrupt the user with a modal and wait for them. Intrusive,
  // and squarely a change to desktop state.
  present: 'write',
  await_ack: 'write',
  dismiss_presence: 'write',
  await_user_input: 'write',

  // ── project-config-tools ────────────────────────────────────────────
  get_project_config: 'read',
  update_project_config: 'write',

  // ── review-tools ────────────────────────────────────────────────────
  // Read-only by construction: review and pr-draft never touch the
  // repository, and comparands / compare only read snapshots. Same call
  // the peer matrix makes for the identical four methods.
  list_comparands: 'read',
  compare_snapshots: 'read',
  review_plan: 'read',
  get_pr_draft: 'read',

  // ── session-tools ───────────────────────────────────────────────────
  // `register_session` is the handshake and is deliberately the cheapest
  // grant: an agent that cannot register cannot report itself at all, and
  // refusing it would make the Timeline lie about who is connected.
  //
  // `setup_agent_permissions` WRITES `.claude/settings.local.json` to
  // auto-approve every CodeTrellis MCP tool. That is a tool which widens the
  // caller's own approval posture, so it sits with `settings` and out of the
  // defaults — the same reasoning that keeps `settings.update` off a paired
  // phone.
  register_session: 'read',
  set_active_plan: 'write',
  navigate_to: 'write',
  open_plan: 'write',
  toggle_panel: 'write',
  refresh_ui: 'write',
  rescan_project: 'project',
  set_baseline: 'write',
  list_recent_projects: 'read',
  pin_project: 'project',
  unpin_project: 'project',
  remove_recent_project: 'project',
  close_project: 'project',
  get_repo_identity: 'read',
  set_repo_alias: 'project',
  refresh_repo_origin: 'project',
  navigate_item_back: 'write',
  navigate_item_forward: 'write',
  toggle_activity_drawer: 'write',
  open_history_drawer: 'write',
  open_settings: 'write',
  open_mcp_guide: 'write',
  setup_agent_permissions: 'settings',

  // ── system-docs-tools ───────────────────────────────────────────────
  list_system_docs: 'read',
  read_system_doc: 'read',
  write_system_doc: 'write',
  delete_system_doc: 'write',
  verify_system_doc: 'write',
  check_doc_freshness: 'read',

  // ── terminal-tools — COMMAND EXECUTION ──────────────────────────────
  // Every one of them, including the read-shaped ones. A terminal's
  // scrollback is the output of commands and frequently holds secrets; the
  // peer matrix makes the same call for `terminal.read` and `terminal.list`.
  terminal_create: 'terminal',
  terminal_write: 'terminal',
  terminal_read: 'terminal',
  terminal_list: 'terminal',
  terminal_kill: 'terminal',
  terminal_resize: 'terminal',
  terminal_focus: 'terminal',

  // ── ui-tools ────────────────────────────────────────────────────────
  // `screenshot` captures the CodeTrellis window and `clipboard_read` returns
  // whatever the user last copied — which is routinely a password or a token.
  // Neither is a file, so `files` does not describe them, and putting them in
  // `read` would have handed both to every client by default.
  screenshot: 'capture',
  select_item: 'write',
  open_project: 'project',
  clipboard_write: 'write',
  clipboard_read: 'capture',
  get_settings: 'read',
  update_settings: 'settings',
  get_logs: 'read',
  get_log_path: 'read',
  get_app_guide: 'read',

  // ── contribution-tools ──────────────────────────────────────────────
  resolve_pantry_references: 'read',
  promote_to_contribution: 'write',
  list_contributions: 'read',
  accept_contributions: 'write',
  prepare_contributor_branch: 'write',

  // ── audio-tools — THE USER'S MICROPHONE ─────────────────────────────
  start_audio_capture: 'capture',
  stop_audio_capture: 'capture',
  push_audio_chunk: 'capture',
  get_audio_context: 'capture',
  get_audio_status: 'capture',

  // ── peer-tools ──────────────────────────────────────────────────────
  // `write_remote_terminal` drives a terminal on a PAIRED DEVICE. It is
  // command execution wearing a different name, and it is the single tool
  // this whole phase exists for: it was registered through the deprecated
  // `server.tool()` API, so it was not even visible in the Agent Timeline.
  get_peer_status: 'read',
  list_discovered_peers: 'read',
  list_paired_devices: 'read',
  list_peer_connections: 'read',
  unpair_device: 'settings',
  get_remote_state: 'read',
  list_remote_terminals: 'terminal',
  write_remote_terminal: 'terminal',
  get_remote_audio: 'capture',
  list_remote_input_requests: 'read',
  respond_remote_input: 'write',
});

export class McpAuthorizationError extends Error {
  readonly code = 'EMCP_FORBIDDEN';
  /** The capability the caller was missing, for the settings hint. */
  readonly required: PeerCapability | null;
  constructor(message: string, required: PeerCapability | null) {
    super(message);
    this.name = 'McpAuthorizationError';
    this.required = required;
  }
}

/**
 * Authorise one tool call, or throw.
 *
 * The refusal is deliberately actionable: it names the capability and where
 * to grant it, so an agent can tell the user what to turn on instead of
 * retrying blindly against a wall.
 */
export function assertMcpMayCall(
  tool: string,
  grants: readonly PeerCapability[] | undefined,
): PeerCapability {
  const required = TOOL_CAPABILITIES[tool];

  if (!required) {
    // DENY BY DEFAULT. An unlisted tool is refused rather than allowed, so a
    // newly registered tool that nobody classified fails closed.
    throw new McpAuthorizationError(
      `Tool "${tool}" is not authorised for MCP clients. Every tool must be listed in ` +
        'TOOL_CAPABILITIES; unlisted tools are refused.',
      null,
    );
  }

  const held = grants ?? DEFAULT_GRANTS;
  if (!held.includes(required)) {
    throw new McpAuthorizationError(
      `"${tool}" needs the "${required}" capability, which this installation does not grant to MCP ` +
        'clients. Turn it on in Settings → MCP Server, then try again.',
      required,
    );
  }

  return required;
}

/** Every tool the matrix knows about — used by the coverage test. */
export function listAuthorisedTools(): string[] {
  return Object.keys(TOOL_CAPABILITIES).sort();
}

/**
 * Confine a path-taking tool to a project the user actually opened — M34.
 *
 * A DIFFERENT AXIS from the capability matrix above. Capabilities answer
 * which tools may be called at all; this answers which projects those tools
 * may reach. 38 tools take a caller-supplied `project_path` and ran git,
 * read files and wrote plans in it with no check at all.
 *
 * VALIDATES, DOES NOT SUBSTITUTE — and that is deliberate.
 * `resolveTrustedProjectRoot` returns the REALPATH, which is the right value
 * for policing paths beneath a root and the wrong one to hand onward here:
 * rows are stored under the path the user OPENED, and the two drift apart
 * for any project reached through a symlink (on macOS, anything under
 * /tmp). Substituting the canonical form would re-introduce exactly the bug
 * M33 was raised for. So membership is checked and the caller's own string
 * is passed through untouched — a pure narrowing, with no behaviour change
 * for a legitimate call.
 *
 * `open_project` is not caught by this and must not be: it takes `path`
 * rather than `project_path`, because opening is how a directory BECOMES a
 * project. Nothing else needs an exemption, which is why there is no
 * exemption list to rot.
 *
 * WHAT THIS BUYS, precisely. `open_project` broadcasts `ui-open-project`,
 * which opens a tab and switches to it — it is VISIBLE. `get_budget` is not.
 * Confining the rest gives the property "nothing reaches a path you did not
 * watch get opened". That is weaker than isolation and much stronger than
 * nothing, and it must not be described as sandboxing.
 */
export function assertMcpProjectInScope(
  tool: string,
  args: unknown,
  scope: McpProjectScope,
): void {
  if (scope === 'anywhere') return;

  // `plan_dir` names a directory to READ (import_plan_from_files), so it
  // is held to the same scope as a project path: inside an opened
  // project's .codetrellis/plans/. It used to pass unchecked.
  const planDir = (args as { plan_dir?: unknown } | null | undefined)?.plan_dir;
  if (typeof planDir === 'string' && planDir.trim().length > 0 && !isTrustedPlanDir(planDir)) {
    throw new McpAuthorizationError(
      `"${tool}" named a plan directory outside the projects this app has opened: "${planDir}". ` +
        'Plan directories are read from <opened project>/.codetrellis/plans/<slug>. Open the project ' +
        'first, or set MCP project scope to "anywhere" in Settings → MCP Server.',
      null,
    );
  }

  const candidate = (args as { project_path?: unknown } | null | undefined)?.project_path;
  // Absent or empty is not this function's business: the tool's own schema
  // decides whether the argument was required.
  if (typeof candidate !== 'string' || candidate.trim().length === 0) return;

  if (!isTrustedProjectRoot(candidate)) {
    const evicted = evictedHint(candidate);
    throw new McpAuthorizationError(
      `"${tool}" named a project that is not open: "${candidate}". ` +
        (evicted
          ? evicted
          : 'Project roots come from the projects this app has opened, not from the request. ' +
            'Open it first, or set MCP project scope to "anywhere" in Settings → MCP Server.'),
      null,
    );
  }
}
