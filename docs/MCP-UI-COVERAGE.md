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
| Switch project tab | — | **No** | Multi-project tab switching |
| Close project tab | — | **No** | |
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
| Copy item context to clipboard | — | **No** | Serialises item for clipboard |
| View item version history | — | **Partial** | `read_item_full` returns versions but no dedicated history view tool |
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
| Paste image/video from clipboard | — | **No** | Canvas-level paste handler |
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
| Click event to jump to item | — | **No** | UI navigation from event row |

## Plan-Level Comments (Legacy)

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Add plan/task comment | `add_comment` | **Yes** | |
| List plan/task comments | `get_comments` | **Yes** | |

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
| Toggle 2D/3D projection | — | **No** | |
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
| Navigate back/forward in item history | — | **No** | Cmd+[ / Cmd+] style navigation |
| Toggle activity drawer | — | **No** | |
| Open history drawer for item | — | **No** | |
| Open settings modal | — | **No** | |
| Open MCP guide modal | — | **No** | |

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
| Change display name | — | **No** | |
| Change email | — | **No** | |
| Change MCP port | — | **No** | |
| Change plans visibility | — | **No** | |
| Change attachment location | — | **No** | |
| Check for updates | — | **No** | |

## Welcome Screen

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Open project from path | `open_project` | **Yes** | |
| List recent projects | `list_recent_projects` | **Yes** | |
| Pin/unpin project | — | **No** | |
| Remove from recents | — | **No** | |

---

## Coverage Summary

| Domain | Total Actions | MCP Covered | Partial | Not Covered |
|---|---|---|---|---|
| Plan management | 17 | 17 | 0 | 0 |
| Plan items (CRUD) | 22 | 19 | 1 | 2 |
| Comments / progress / attachments | 9 | 7 | 0 | 2 |
| Item targets (fileSpecs etc.) | 8 | 8 | 0 | 0 |
| External references | 3 | 3 | 0 | 0 |
| Timeline / events | 2 | 1 | 0 | 1 |
| Drift / deviations | 6 | 5 | 1 | 0 |
| Proposed changes | 3 | 3 | 0 | 0 |
| Graph queries (data) | 4 | 4 | 0 | 0 |
| Graph canvas (visual) | 15 | 9 | 2 | 4 |
| UI navigation | 12 | 6 | 0 | 6 |
| Terminal panel | 10 | 9 | 1 | 0 |
| Project / session | 7 | 5 | 0 | 2 |
| Settings | 6 | 0 | 0 | 6 |
| Welcome screen | 4 | 2 | 0 | 2 |
| **Total** | **128** | **98** | **5** | **25** |

**77% covered** (was 56%) — remaining gaps are mostly settings,
niche welcome screen actions, and a few UI-only interactions.

---

## Implemented MCP Tools (Phase 18)

### Tier 1 — Agent Workbench Essentials (DONE)

| Tool | Domain | Status |
|---|---|---|
| `terminal_create` | Terminal | Done |
| `terminal_write` | Terminal | Done |
| `terminal_read` | Terminal | Done |
| `terminal_list` | Terminal | Done |
| `terminal_kill` | Terminal | Done |
| `terminal_resize` | Terminal | Done |
| `screenshot` | UI | Done |
| `select_item` | UI Nav | Done |
| `open_project` | Project | Done |

### Tier 2 — Graph Visual Control (DONE)

| Tool | Domain | Status |
|---|---|---|
| `graph_focus` | Graph | Done |
| `graph_select` | Graph | Done |
| `graph_set_mode` | Graph | Done |
| `graph_set_scope` | Graph | Done |
| `graph_set_layout` | Graph | Done |
| `graph_set_depth` | Graph | Done |
| `graph_export` | Graph | Done |
| `graph_snapshot` | Graph | Done |

### Tier 3 — Full Parity (DONE)

| Tool | Domain | Status |
|---|---|---|
| `delete_item_comment` | Items | Done |
| `delete_item_attachment` | Items | Done |
| `rescan_project` | Project | Done |
| `set_baseline` | Project | Done |
| `list_recent_projects` | Project | Done |
| `import_external` | Plans | Done |
| `copy_plan_as_prompt` | Plans | Done |
