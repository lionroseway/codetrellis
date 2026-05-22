# MCP ↔ UI Coverage Matrix

Every user-facing action in CodeTrellis, mapped to whether an MCP tool
can do the same thing today. **Goal**: an AI agent should be able to
control every aspect of the app — plans, graph, terminals, navigation
— through MCP alone.

Legend: **Yes** = MCP tool exists | **Partial** = related tool but not
exact parity | **No** = no MCP coverage

---

## Project / Session

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Open a project folder | `open_project` | **Yes** | Opens + scans by path |
| Switch project tab | `open_project` | **Yes** | Opens project by path; UI switches tab |
| Close project tab | `close_project` | **Yes** | Closes by project path |
| Rescan project (re-parse AST) | `rescan_project` | **Yes** | |
| Select branch / set baseline | `set_baseline` | **Yes** | Set commit hash for diff mode |
| Register agent session | `register_session` | **Yes** | Identity, model, capabilities |
| Set active plan for session | `set_active_plan` | **Yes** | Links agent to a plan + navigates UI |

## Plan Management

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Create new plan | `create_plan` | **Yes** | |
| Open/view plan | `get_plan`, `open_plan` | **Yes** | `open_plan` also navigates the UI |
| Update plan title/description | `update_plan` | **Yes** | |
| Delete plan | `delete_plan` | **Yes** | |
| Bulk delete plans | `bulk_delete_plans` | **Yes** | |
| List plans | `list_plans` | **Yes** | Filterable by project, status |
| Get plan health summary | `get_plan_summary` | **Yes** | Completion %, status breakdown |
| Apply plan template | `create_plan_from_template` | **Yes** | With placeholder substitution |
| List available templates | `list_plan_templates` | **Yes** | Built-in + disk templates |
| Import plan from disk | `import_plan_from_files` | **Yes** | V1 + V2 YAML formats |
| Export plan to disk | `export_plan_to_files` | **Yes** | V1 + V2 tree layout |
| Discover plan files on disk | `discover_plan_files` | **Yes** | |
| Unlink plan from disk sync | `unlink_plan_from_files` | **Yes** | Shared → Local toggle |
| Publish plan as template | `publish_plan_as_template` | **Yes** | |
| Import from external (GitHub issue, conversation, etc.) | `import_external` | **Yes** | Conversation/markdown text import |
| Copy plan as prompt (handoff) | `copy_plan_as_prompt` | **Yes** | Returns markdown prompt text |
| Push plan to specific agent | — | **Partial** | `set_active_plan` exists but not push-to-other-agent |

## Plan Items (Objects & Actions)

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Create Object (page) | `add_item` | **Yes** | kind: 'object' |
| Create Action (task) | `add_item` | **Yes** | kind: 'action' |
| Bulk create items | `bulk_add_items` | **Yes** | With temp_uid parent refs |
| Read item (lightweight) | `get_item` | **Yes** | |
| Read item + children + comments + attachments | `read_item_full` | **Yes** | One-call bundle |
| Update item (title, body, status, etc.) | `update_item` | **Yes** | Writes version snapshot |
| Move / re-parent item | `move_item` | **Yes** | Drag-drop in tree |
| Delete item (cascade) | `delete_item` | **Yes** | |
| Claim action (assign to agent) | `claim_item` | **Yes** | With conflict detection |
| Get next available action | `get_next_item` | **Yes** | Respects deps + approval gates |
| Approve gate | `approve_gate` | **Yes** | Human-only |
| List/filter items | `list_items` | **Yes** | |
| Search items (FTS) | `search_items` | **Yes** | Title + body search |
| Restore item to prior version | `restore_item_version` | **Yes** | |
| Edit item title (inline) | `update_item` | **Yes** | |
| Edit item body (markdown) | `update_item` | **Yes** | |
| Change item status | `update_item` | **Yes** | |
| Toggle approval gate | `update_item` | **Yes** | requiresApproval field |
| Copy item context to clipboard | `clipboard_write` + `copy_plan_as_prompt` | **Yes** | Serialise then copy |
| View item version history | `list_item_versions`, `open_history_drawer` | **Yes** | Data via `list_item_versions`; UI drawer via `open_history_drawer` |
| Slash commands in body (/, @) | — | **No** | Rich text shortcuts, inline only |

## Item Comments / Progress / Attachments

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Add comment (note/blocker/progress/question) | `add_item_comment` | **Yes** | |
| List comments | `list_item_comments` | **Yes** | |
| Delete comment | `delete_item_comment` | **Yes** | |
| Report progress (%) | `update_item_progress` | **Yes** | |
| Mark item blocked | `set_item_blocked` | **Yes** | |
| Add attachment (URL/image/code/transcript) | `add_item_attachment` | **Yes** | |
| Remove attachment | `delete_item_attachment` | **Yes** | |
| Paste image/video from clipboard | `clipboard_read` + `add_item_attachment` | **Partial** | Text clipboard; images use attachment API |
| Drag-drop file as attachment | — | **No** | |

## Item Targets (fileSpecs / symbolSpecs / edges)

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Add file target via AnchorPicker | `update_item` | **Yes** | Append to fileSpecs array |
| Add symbol target via AnchorPicker | `update_item` | **Yes** | Append to symbolSpecs array |
| Edit file target (action, path, description) | `update_item` | **Yes** | |
| Edit symbol target (action, kind, signature) | `update_item` | **Yes** | |
| Remove file/symbol target | `update_item` | **Yes** | Remove from array |
| Add graph edge (new connection) | `update_item` | **Yes** | newConnections array |
| Remove graph edge | `update_item` | **Yes** | removedConnections array |
| Suggest specs from graph | `suggest_specs` | **Yes** | Returns pre-shaped fileSpec/symbolSpec |

## External References

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Add external ref (GitHub/Jira/Figma URL) | `add_external_ref` | **Yes** | Kind auto-detected |
| List external refs | `list_external_refs` | **Yes** | |
| Remove external ref | `remove_external_ref` | **Yes** | |

## Plan Timeline / Events

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| View activity feed | `get_plan_timeline` | **Yes** | Filterable by event type |
| Click event to jump to item | `select_item` | **Yes** | Agent uses `select_item` directly |

## Drift / Deviations

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| View deviations list | `get_deviations` | **Yes** | |
| Run deviation detection | `detect_deviations` | **Yes** | |
| Reconcile deviation (accept/revert/ignore) | `reconcile` | **Yes** | |
| Get drift report | `get_drift_report` | **Yes** | Baseline vs live comparison |
| Capture checkpoint | `capture_checkpoint` | **Yes** | Named snapshot |
| View drift badge / indicator | — | **Partial** | Data available via get_drift_report |

## Proposed Changes

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| List proposed changes | `list_proposed_changes` | **Yes** | |
| Get changes summary | `get_changes_summary` | **Yes** | |
| Get single change status | `get_change_status` | **Yes** | |

## Architecture Conformity

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Check for circular deps | `check_conformity` | **Yes** | |

## Graph / Architecture Queries

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Search symbols by name | `search_symbols` | **Yes** | |
| Get file dependencies (imports) | `get_dependencies` | **Yes** | |
| Query all dependency edges | `check_architecture` | **Yes** | |
| List cross-system edges | `list_cross_system_edges` | **Yes** | HTTP/SQL/subprocess couplings |

## Graph Canvas (Visual)

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Click node to select | `graph_select` | **Yes** | Select by path(s) |
| Right-click node context menu | — | **No** | |
| Multi-select nodes (shift-click) | `graph_select` | **Yes** | Pass array of paths |
| "Plan these" from selection | — | **Partial** | Select via `graph_select`, then use plan tools |
| "Add to task" from selection | — | **Partial** | Select via `graph_select`, then `update_item` |
| Set trellis mode (Live/Baseline/Planned/Diff) | `graph_set_mode` | **Yes** | |
| Set scope filter (directory) | `graph_set_scope` | **Yes** | |
| Set layout mode (Map/Tree) | `graph_set_layout` | **Yes** | |
| Toggle plan projection overlay | `graph_toggle_projection` | **Yes** | Enable/disable/toggle |
| Set view depth (package/file/symbol) | `graph_set_depth` | **Yes** | |
| Zoom to fit / focus node | `graph_focus` | **Yes** | Pan/zoom with highlight |
| Pan / zoom canvas | `graph_focus` | **Partial** | Focus on a specific node |
| Export graph as PNG | `graph_export` | **Yes** | Returns base64 PNG |
| Get graph data (structured) | `graph_snapshot` | **Yes** | Returns JSON nodes + edges |
| "Explain with agent" from context menu | — | **No** | Injects prompt into terminal |

## UI Navigation

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Navigate to view (plan/graph/split/timeline) | `navigate_to` | **Yes** | |
| Open specific plan | `open_plan` | **Yes** | With split-view option |
| Toggle sidebar | `toggle_panel` | **Yes** | |
| Toggle inspector | `toggle_panel` | **Yes** | |
| Toggle terminal | `toggle_panel` | **Yes** | |
| Toggle split panel | `toggle_panel` | **Yes** | |
| Force refresh UI | `refresh_ui` | **Yes** | |
| Select item in plan tree | `select_item` | **Yes** | Navigate to specific item by UID |
| Navigate back in item history | `navigate_item_back` | **Yes** | Cmd+[ equivalent |
| Navigate forward in item history | `navigate_item_forward` | **Yes** | Cmd+] equivalent |
| Toggle activity drawer | `toggle_activity_drawer` | **Yes** | |
| Open history drawer for item | `open_history_drawer` | **Yes** | Pass item UID |
| Open settings modal | `open_settings` | **Yes** | |
| Open MCP guide modal | `open_mcp_guide` | **Yes** | |

## Terminal Panel

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Create new terminal session | `terminal_create` | **Yes** | With agent preset (claude/codex/aider/shell) |
| Switch active terminal tab | — | **Partial** | Agents target sessions by ID directly |
| Kill terminal session | `terminal_kill` | **Yes** | |
| Toggle terminal panel | `toggle_panel` | **Yes** | Can show/hide |
| Type in terminal | `terminal_write` | **Yes** | Send keystrokes / commands |
| Read terminal output | `terminal_read` | **Yes** | Last N lines, ANSI-stripped |
| List active terminals | `terminal_list` | **Yes** | Preset, PID, status |
| Resize terminal | `terminal_resize` | **Yes** | Cols × rows |
| Inject prompt into terminal | `terminal_write` | **Yes** | Same as type |
| Screenshot terminal content | `screenshot` | **Yes** | Panel target: "terminal" |

## Settings

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Read all settings | `get_settings` | **Yes** | Returns full settings JSON |
| Change display name | `update_settings` | **Yes** | `identity.displayName` |
| Change email | `update_settings` | **Yes** | `identity.email` |
| Change MCP port | `update_settings` | **Yes** | `mcp.port` (restart needed) |
| Change plans visibility | `update_settings` | **Yes** | `plans.defaultVisibility` |
| Change attachment location | `update_settings` | **Yes** | `plans.attachmentLocation` |
| Check for updates | — | **No** | |

## Diagnostics / Help

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Read application logs | `get_logs` | **Yes** | Tail with optional grep filter |
| Get log file path | `get_log_path` | **Yes** | Current log file + directory |
| Get usage guide | `get_app_guide` | **Yes** | summary / quickstart / power-user flavors |

## Welcome Screen

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Open project from path | `open_project` | **Yes** | |
| List recent projects | `list_recent_projects` | **Yes** | |
| Pin/unpin project | `pin_project`, `unpin_project` | **Yes** | |
| Remove from recents | `remove_recent_project` | **Yes** | |

## MCP Resources

Read-only data endpoints agents can fetch via `resources/read`.

| Resource URI | What it provides |
|---|---|
| `codetrellis://skill` | Project-state-tailored agent guide (plans, systems, sessions) |
| `codetrellis://skill/quickstart` | First-time agent quickstart flow |
| `codetrellis://skill/power-user` | Deep usage guide (drift, multi-agent, phases) |
| `codetrellis://skill/ui-nav` | UI navigator skill for sub-agents |
| `project://graph` | Full dependency graph as JSON (all file-to-file import edges) |
| `codetrellis://plans` | List of all plans |
| `codetrellis://sessions` | Active agent sessions |
| `project://stats` | Database stats (file count, symbol count, edge count) |

---

## Coverage Summary

| Domain | Total Actions | MCP Covered | Partial | Not Covered |
|---|---|---|---|---|
| Plan management | 18 | 18 | 0 | 0 |
| Plan items (CRUD) | 22 | 20 | 0 | 2 |
| Comments / progress / attachments | 9 | 7 | 1 | 1 |
| Item targets (fileSpecs etc.) | 8 | 8 | 0 | 0 |
| External references | 3 | 3 | 0 | 0 |
| Timeline / events | 2 | 2 | 0 | 0 |
| Drift / deviations | 6 | 5 | 1 | 0 |
| Proposed changes | 3 | 3 | 0 | 0 |
| Graph queries (data) | 4 | 4 | 0 | 0 |
| Graph canvas (visual) | 15 | 10 | 3 | 2 |
| UI navigation | 13 | 12 | 0 | 1 |
| Terminal panel | 10 | 9 | 1 | 0 |
| Project / session | 7 | 7 | 0 | 0 |
| Settings | 7 | 6 | 0 | 1 |
| Welcome screen | 4 | 4 | 0 | 0 |
| Diagnostics / help | 3 | 3 | 0 | 0 |
| MCP resources | 7 | 7 | 0 | 0 |
| **Total** | **140** | **128** | **6** | **6** |

**99 MCP tools + 7 MCP resources = 106 endpoints.** UI action coverage
is **96%** — remaining uncovered items are slash commands in body,
drag-drop attachments, right-click context menus, "Explain with agent"
(doable via terminal_create + terminal_write), and check-for-updates.
