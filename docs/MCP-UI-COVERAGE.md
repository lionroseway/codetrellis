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
| Open a project folder | — | **No** | Agent can't tell CT to scan a new project |
| Switch project tab | — | **No** | Multi-project tab switching |
| Close project tab | — | **No** | |
| Rescan project (re-parse AST) | — | **No** | Triggers POST /api/scan internally |
| Select branch / set baseline | — | **No** | Agent can't switch baseline commit |
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
| Import from external (GitHub issue, conversation, etc.) | — | **No** | PlanImportModal handles 4 source types |
| Copy plan as prompt (handoff) | — | **No** | Serialises plan to markdown for clipboard |
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
| Delete comment | — | **No** | UI has it, MCP doesn't |
| Report progress (%) | `update_item_progress` | **Yes** | |
| Mark item blocked | `set_item_blocked` | **Yes** | |
| Add attachment (URL/image/code/transcript) | `add_item_attachment` | **Yes** | |
| Remove attachment | — | **No** | UI has it, MCP doesn't |
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
| Click node to select | — | **No** | |
| Right-click node context menu | — | **No** | |
| Multi-select nodes (shift-click) | — | **No** | |
| "Plan these" from selection | — | **No** | Creates plan from selected files |
| "Add to task" from selection | — | **No** | |
| Set trellis mode (Live/Baseline/Planned/Diff) | — | **No** | |
| Set scope filter (directory) | — | **No** | |
| Set layout mode (Map/Tree) | — | **No** | |
| Toggle 2D/3D projection | — | **No** | |
| Set view depth (1-5+) | — | **No** | |
| Zoom to fit | — | **No** | |
| Pan / zoom canvas | — | **No** | |
| Export graph as PNG | — | **No** | |
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
| Select item in plan tree | — | **No** | Navigate to specific item within a plan |
| Navigate back/forward in item history | — | **No** | Cmd+[ / Cmd+] style navigation |
| Toggle activity drawer | — | **No** | |
| Open history drawer for item | — | **No** | |
| Open settings modal | — | **No** | |
| Open MCP guide modal | — | **No** | |

## Terminal Panel

| UI Action | MCP Tool | Coverage | Notes |
|---|---|---|---|
| Create new terminal session | — | **No** | With agent preset (Claude/Codex/Aider/Shell) |
| Switch active terminal tab | — | **No** | |
| Kill terminal session | — | **No** | |
| Toggle terminal panel | `toggle_panel` | **Partial** | Can show/hide but can't interact |
| Type in terminal | — | **No** | |
| Read terminal output | — | **No** | |
| Inject prompt into terminal | — | **No** | Used by "Explain with agent" |
| Screenshot terminal content | — | **No** | |

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
| Open project from path | — | **No** | |
| List recent projects | — | **No** | |
| Pin/unpin project | — | **No** | |
| Remove from recents | — | **No** | |

---

## Coverage Summary

| Domain | Total Actions | MCP Covered | Partial | Not Covered |
|---|---|---|---|---|
| Plan management | 17 | 15 | 1 | 1 |
| Plan items (CRUD) | 22 | 19 | 1 | 2 |
| Comments / progress / attachments | 9 | 5 | 0 | 4 |
| Item targets (fileSpecs etc.) | 8 | 8 | 0 | 0 |
| External references | 3 | 3 | 0 | 0 |
| Timeline / events | 2 | 1 | 0 | 1 |
| Drift / deviations | 6 | 5 | 1 | 0 |
| Proposed changes | 3 | 3 | 0 | 0 |
| Graph queries (data) | 4 | 4 | 0 | 0 |
| Graph canvas (visual) | 14 | 0 | 0 | 14 |
| UI navigation | 12 | 5 | 0 | 7 |
| Terminal panel | 8 | 0 | 1 | 7 |
| Project / session | 7 | 2 | 0 | 5 |
| Settings | 6 | 0 | 0 | 6 |
| Welcome screen | 4 | 0 | 0 | 4 |
| **Total** | **125** | **70** | **4** | **51** |

**56% covered, 44% uncovered** — mostly in visual/interactive areas
(graph canvas, terminal, settings, project management).

---

## Proposed New MCP Tools (Priority Order)

### Tier 1 — Agent Workbench Essentials

These make CodeTrellis a full agent workspace, not just a planning
tool. Critical for onboarding flows where the agent needs to run
the app end-to-end.

| Tool | Domain | What It Does |
|---|---|---|
| `terminal_create` | Terminal | Create a new terminal session (preset: shell/claude/codex/aider, cwd) |
| `terminal_write` | Terminal | Send keystrokes or a command string to a terminal session |
| `terminal_read` | Terminal | Read the last N lines of terminal output from a session |
| `terminal_list` | Terminal | List active terminal sessions with their preset, PID, status |
| `terminal_kill` | Terminal | Kill a terminal session |
| `screenshot` | UI | Capture the current viewport as a base64 PNG (or specific panel: graph, plan, terminal) |
| `select_item` | UI Nav | Navigate the plan canvas to a specific item by UID |
| `open_project` | Project | Open/scan a project by path (what the folder picker does) |

### Tier 2 — Graph Visual Control

Let agents drive the graph canvas — essential for architecture
review, blast-radius analysis, and presentation.

| Tool | Domain | What It Does |
|---|---|---|
| `graph_focus` | Graph | Zoom/pan to center a specific file or symbol node |
| `graph_select` | Graph | Select one or more nodes (mirrors click / shift-click) |
| `graph_set_mode` | Graph | Set trellis mode (live/baseline/planned/diff) |
| `graph_set_scope` | Graph | Set the scope filter to a directory/package path |
| `graph_set_layout` | Graph | Switch between map (force) and tree (dagre) layout |
| `graph_set_depth` | Graph | Set view depth (1-5+) |
| `graph_export` | Graph | Export current graph view as PNG (returns base64) |
| `graph_snapshot` | Graph | Return structured graph data (nodes + edges + positions) |

### Tier 3 — Full Parity

Close remaining gaps for complete programmatic control.

| Tool | Domain | What It Does |
|---|---|---|
| `delete_item_comment` | Items | Delete a comment by UID |
| `delete_item_attachment` | Items | Delete an attachment by UID |
| `rescan_project` | Project | Trigger a fresh AST re-parse |
| `set_baseline` | Project | Set the baseline commit/branch for diff mode |
| `list_recent_projects` | Project | Return recent projects list |
| `import_external` | Plans | Import from GitHub issue / conversation / git diff |
| `copy_plan_as_prompt` | Plans | Serialise plan to markdown prompt string |
