# V2 MCP Migration Plan

> Systematic migration of MCP tool surface from V1 (tasks/phases/docs)
> to V2 (unified plan_items). Triggered by a live agent session that
> made 34 MCP tool calls with **zero observable UI updates** because
> V1 tools write to tables the V2 workspace doesn't render.

---

## 1. The Problem (What Happened)

An AI agent connected via MCP and built a full plan:
- 1× `create_plan`
- 12× `add_plan_phase`
- 11× `add_plan_doc`
- 6× `update_task`
- 1× `set_active_plan`
- 3× `list_plans` / `get_plan` / `list_plan_phases`

**Result: nothing appeared in the UI.** The V2 workspace (the one with
the "V2" badge, "PAGES" sidebar, item tree) reads exclusively from
`plan_items` and responds only to `plan-item-*` WebSocket events.
Every V1 write went to `plans`, `plan_tasks`, `plan_phases`,
`plan_docs` — tables the V2 workspace ignores entirely.

### Agent's Own Observations

The agent flagged five issues after its session:

1. **`list_plans` overflow** — 69 plans produced 76KB response,
   exceeding context limits. Needs pagination or summary mode.
2. **No UI navigation** — `set_active_plan` only sets session
   metadata; doesn't actually show the plan in the UI. Agent expected
   the app to navigate.
3. **No broadcast confirmation** — Tool results don't indicate whether
   a WebSocket broadcast fired or how many clients received it. Agent
   had no way to know the UI wasn't updating.
4. **No batching** — Agent had to call `add_plan_phase` 12 times and
   `add_plan_doc` 11 times sequentially. Needs bulk variants.
5. **Misleading `set_active_plan`** — Description says "associate this
   agent session with a plan" but agent assumed it would make the plan
   visible in the UI.

---

## 2. Root Cause: V1 vs V2 Data Model Split

### V1 Tables (old, still written to by old MCP tools)
- `plans` — plan metadata (title, description, project_path)
- `plan_tasks` / `tasks` — flat task list per plan
- `plan_phases` — phase checkpoints
- `plan_docs` — spec documents (markdown bodies)

### V2 Tables (new, what the UI actually renders)
- `plan_items` — unified tree of Objects + Actions (replaces tasks,
  phases, and docs in a single nested structure)
- `plan_item_versions` — version history per item
- `plan_events` — structural event log (drives activity rail)

### V2 WebSocket Events (what the frontend listens for)
- `plan-item-created`, `plan-item-updated`, `plan-item-moved`,
  `plan-item-deleted`
- `plan-item-claimed`, `plan-item-progress`, `plan-item-blocked`
- `plan-item-comment-added`, `plan-item-attachment-added`,
  `plan-item-version-saved`
- `plan-event` (activity feed)

V1 broadcasts (`plan-phase-created`, `plan-doc-created`,
`task-updated`) are handled in the frontend but only update the old
`usePlanStore` — the V2 workspace shell reads from
`usePlanItemsStore` which ignores them.

---

## 3. Current Tool Inventory (74 tools)

### Graph / Codebase (4) — KEEP, unrelated to plans
- `search_symbols`
- `get_dependencies`
- `check_architecture`
- `list_cross_system_edges`

### Plan-Level CRUD (4) — KEEP, V2 items still need a parent plan
- `create_plan` — creates plan container + V1 tasks
- `get_plan`
- `update_plan`
- `list_plans`

**Action needed:** `create_plan` currently also creates V1 tasks
inline. Needs rework — either strip the task-creation side (plan
metadata only) or have it create V2 items instead.

`list_plans` needs pagination/summary mode (76KB overflow at 69
plans).

### V1 Task Tools (10) — REMOVE
- `claim_task`
- `update_task`
- `get_next_task`
- `read_task_full`
- `add_subtask`
- `list_task_comments`
- `add_task_comment`
- `update_task_progress`
- `set_task_blocked`
- `add_task_attachment`

All write to `plan_tasks` / `tasks` which V2 doesn't render. V2
equivalents exist for every one of these.

### V1 Phase Tools (4) — REMOVE
- `add_plan_phase`
- `list_plan_phases`
- `update_plan_phase`
- `delete_plan_phase`

Phases are now Objects (kind='object', template='phase') in V2.
`add_item` replaces `add_plan_phase`.

### V1 Spec Doc Tools (5) — REMOVE
- `add_plan_doc`
- `update_plan_doc`
- `get_plan_doc`
- `list_plan_docs`
- `search_plan_docs`

Spec docs are now Objects (kind='object') in V2. `add_item` replaces
`add_plan_doc`. Body search can be done via `list_items` or a new
search tool if needed.

### V2 Item Tools (19) — KEEP, this is the future
- `add_item` — creates Object or Action
- `get_item` — lightweight single-row fetch
- `read_item_full` — item + children + comments + attachments + versions
- `update_item` — update any field
- `move_item` — re-parent / reorder
- `delete_item` — soft-delete with cascade
- `list_items` — tree query (title + kind + status, no bodies)
- `claim_item` — atomically claim an Action
- `get_next_item` — next claimable Action respecting dependencies
- `approve_gate` — clear approval gate
- `update_item_progress` — set progress % + auto-comment
- `set_item_blocked` — block Action with reason
- `restore_item_version` — rollback to prior version
- `add_item_comment` — structured comment (note/blocker/progress/question)
- `list_item_comments` — read comments
- `add_item_attachment` — pin URL/image/file/code/transcript
- `get_plan_timeline` — plan-level event feed
- `list_external_refs` / `add_external_ref` / `remove_external_ref`

### Plan Files / Templates (7) — ✅ V2 migrated (Phase C)
- `export_plan_to_files` — ✅ V2 tree layout (items/ directory)
- `import_plan_from_files` — ✅ V2 items from disk, V1 backward compat
- `discover_plan_files` — reads `.codetrellis/` directory (no change)
- `unlink_plan_from_files` — no change needed
- `publish_plan_as_template` — ✅ V2 item tree snapshot
- `list_plan_templates` — ✅ returns version + itemCount for V2 templates
- `create_plan_from_template` — ✅ creates V2 items from V2 templates

### Changes / Deviations (7) — ✅ V2 migrated (Phase B)
- `detect_deviations` — ✅ reads both V1 tasks and V2 plan_items
- `get_deviations`
- `reconcile`
- `check_conformity`
- `list_proposed_changes` — ✅ already dual-reads V1 + V2
- `get_changes_summary`
- `get_change_status`
- `get_drift_report`
- `capture_checkpoint`
- `report_plan`

### Session / UI (8) — KEEP, fix `set_active_plan`
- `register_session`
- `set_active_plan` — ⚠️ needs to also broadcast `ui-navigate`
- `add_comment` / `get_comments` — plan-level comments
- `navigate_to` / `open_plan` / `toggle_panel` / `refresh_ui`
- `delete_plan` / `bulk_delete_plans`

---

## 4. Gap Analysis

### No Gap (V2 fully covers V1)
| Capability | V2 Tool | Notes |
|---|---|---|
| File specs / symbol specs | `add_item`, `update_item` | Same fields, same JSON schema |
| Connections (new/removed) | `add_item`, `update_item` | Identical |
| Proposed changes | `list_proposed_changes` | Already dual-reads V1+V2, dedupes via `migratedFrom` |
| Comments | `add_item_comment` | Reads both target_type='item' and 'task' |
| Attachments | `add_item_attachment` | Same table, same kinds |
| External refs | `add_external_ref` | V2-only feature, no V1 equivalent |

### Gaps to Fix

| # | Gap | Severity | What's Needed |
|---|---|---|---|
| G1 | `create_plan` creates V1 tasks inline | **Critical** | Rework to create plan metadata only, or create V2 items |
| G2 | `list_plans` overflows at scale | **High** | Add limit/offset and summary mode (no description/task list) |
| G3 | `set_active_plan` doesn't navigate UI | **High** | Also broadcast `ui-navigate` with plan_uid |
| G4 | `detect_deviations` ignores V2 items | **Critical** | Read `plan_items` (kind='action') alongside tasks |
| G5 | File export ignores V2 items | **Critical** | Serialize plan_items tree to `.codetrellis/` YAML |
| G6 | File import creates V1 tasks only | **Critical** | Create V2 items from YAML |
| G7 | Template create seeds V1 tasks | **Critical** | Apply template as V2 items |
| G8 | Template publish snapshots V1 only | **Critical** | Snapshot V2 item tree |
| G9 | No bulk item creation | **High** | Accept arrays in `add_item` or add `bulk_add_items` |
| G10 | No broadcast confirmation in tool results | **Medium** | Return `_meta: { broadcast: true }` in tool responses |
| G11 | No graph→specs population tool | **Medium** | `suggest_specs(scope_path)` queries graph, returns candidate fileSpecs/symbolSpecs |
| G12 | No search across item bodies | **Medium** | `search_items(query)` — FTS or LIKE across plan_items bodies |
| G13 | V1 plan-level comments (`add_comment`) separate from V2 item comments | **Low** | Decide if plan-level comments remain or fold into root item |
| G14 | `list_items` has no status filter | **High** | Agent can't ask "show blocked actions" or "show done items" |
| G15 | `list_items` has no limit/offset | **High** | Large plans could overflow context just like `list_plans` did |
| G16 | `list_items` has no title/body search | **High** | Agent can't find specific items without reading everything — V1 had `search_plan_docs` |
| G17 | `get_plan` returns V1 task array | **High** | Once V1 tools removed, the task list in `get_plan` is meaningless. Should return V2 item count/summary instead |

---

## 5. Migration Phases

### Phase A — Core Agent Flow (do now)
**Goal:** An agent connecting via MCP can create plans, populate them
with items, and see updates in the V2 UI in real time.

- [x] **A1.** Remove 19 V1 tools: all task (10), phase (4), doc (5) tools
- [x] **A2.** Rework `create_plan` — strip inline task creation, return
      plan UID only. Agents use `add_item` to populate.
- [x] **A3.** `list_plans` — add `limit` (default 20) and `summary`
      mode (title + uid + status + item_count, no descriptions)
- [x] **A4.** `set_active_plan` — also broadcast `ui-navigate` so UI
      shows the plan
- [x] **A5.** Add `bulk_add_items` tool — accept array of items,
      create in order, return UIDs. Cuts 23 sequential calls to 1-2.
- [x] **A6.** Tool result payloads include `_meta: { broadcast: true }`
      so agents know the UI was notified
- [x] **A7.** `list_items` — add `status` filter, `limit`/`offset`,
      and `title_contains` search so agents can query efficiently
- [x] **A8.** `get_plan` — stop returning V1 task array; return plan
      metadata + V2 item count + top-level item summary instead
- [x] **A9.** `search_items` — body search across items in a plan
      (replaces V1 `search_plan_docs`). Can be LIKE for now, FTS later.
- [x] **A10.** Clean up V1 service imports from mcp/server.ts that are
      no longer used

### Phase B — Deviation & Conformity (do next)
**Goal:** Drift detection and conformity checking work against V2 items.

- [x] **B1.** `detect_deviations` reads `plan_items` (kind='action')
      in addition to V1 tasks via unified WorkUnit abstraction
- [x] **B2.** `check_conformity` is architecture-level (no plan data).
      `report_plan` now creates V2 items instead of V1 tasks.
- [x] **B3.** `get_drift_report` uses V2 item counts (falls back to
      V1 tasks for legacy plans with no V2 items)

### Phase C — File Sync & Templates (done)
**Goal:** Plans can be exported/imported/templated using V2 item trees.

- [x] **C1.** New YAML schema for V2 items — tree layout under `items/`
      directory mirrors parent/child nesting. Items with children become
      directories with `_self.yaml`; leaves are plain `.yaml` files.
      `plan.yaml` gets `version: 2` field. All V2 fields serialised
      (kind, template, skills, constraints, claimPolicy, executionConfig,
      requiresApproval, inline comments + attachments).
- [x] **C2.** `export_plan_to_files` detects V2 items via
      `planItemService.listAllItems()` — routes to V2 tree writer.
      V1 fallback for legacy plans without V2 items.
- [x] **C3.** `import_plan_from_files` detects V2 format via
      `version: 2` in plan.yaml or existence of `items/` directory.
      Recursively walks the tree, upserts items via
      `planItemService.createItem / updateItem`. Broadcasts
      `plan-item-created` events so V2 UI updates in real time.
- [x] **C4.** `publish_plan_as_template` snapshots V2 item tree as
      nested `items` array in `template.yaml`. Large bodies written
      as separate markdown files via `bodyPath`. Runtime fields
      (status, assignee, progress) stripped. Cascading properties
      (skills, constraints, executionConfig) preserved.
- [x] **C5.** `create_plan_from_template` detects V2 templates
      (has `items` array) and creates V2 plan_items recursively.
      Broadcasts `plan-item-created` events. Response includes
      `version: 2` and `itemCount`.
- [x] **C6.** Backward compat: V1 YAML import still works (phases/
      tasks/docs) — detected by absence of `version: 2` and `items/`
      directory. V1 templates (phases+docs shape) still apply via
      the legacy path. Both formats coexist.

### Phase D — Intelligence (future)
**Goal:** Agents get richer context from the codebase graph.

- [ ] **D1.** `suggest_specs(scope_path)` — queries dependency graph,
      returns candidate fileSpecs and symbolSpecs for a given scope
- [ ] **D2.** `search_items(query)` — full-text search across item
      bodies within a plan
- [ ] **D3.** Plan-level summary tool — returns plan health (% done,
      blocked count, drift score) in a single call

---

## 6. V1 Tools to Remove (19 total)

```
# Tasks (10)
claim_task
update_task
get_next_task
read_task_full
add_subtask
list_task_comments
add_task_comment
update_task_progress
set_task_blocked
add_task_attachment

# Phases (4)
add_plan_phase
list_plan_phases
update_plan_phase
delete_plan_phase

# Spec Docs (5)
add_plan_doc
update_plan_doc
get_plan_doc
list_plan_docs
search_plan_docs
```

---

## 7. V2 Tools That Stay (with any needed changes)

| Tool | Change Needed |
|---|---|
| `add_item` | None — already complete |
| `get_item` | None |
| `read_item_full` | None |
| `update_item` | None |
| `move_item` | None |
| `delete_item` | None |
| `list_items` | **Add**: status filter, limit/offset, title_contains search |
| `claim_item` | None |
| `get_next_item` | None |
| `approve_gate` | None |
| `update_item_progress` | None |
| `set_item_blocked` | None |
| `restore_item_version` | None |
| `add_item_comment` | None |
| `list_item_comments` | None |
| `add_item_attachment` | None |
| `get_plan_timeline` | None |
| `list_external_refs` | None |
| `add_external_ref` | None |
| `remove_external_ref` | None |
| `create_plan` | **Rework**: plan metadata only, no inline tasks |
| `get_plan` | **Rework**: return plan metadata + V2 item summary, not V1 tasks |
| `update_plan` | None |
| `list_plans` | **Add**: limit, offset, summary mode |
| `set_active_plan` | **Add**: broadcast `ui-navigate` |
| `navigate_to` | None |
| `open_plan` | None |
| `toggle_panel` | None |
| `refresh_ui` | None |
| `delete_plan` | None |
| `bulk_delete_plans` | None |
| `register_session` | None |
| `add_comment` | None (plan-level, not item-level) |
| `get_comments` | None |

### New Tools to Add
| Tool | Purpose |
|---|---|
| `bulk_add_items` | Create multiple items in one call |
| `search_items` | Body/title search across items in a plan (replaces `search_plan_docs`) |

---

## 8. Data Migration Notes

V1 tables (`plan_tasks`, `plan_phases`, `plan_docs`) remain in the
database for historical data. The `plan_items.migrated_from` column
tracks lineage when V1 records are migrated to V2.
`list_proposed_changes` already dedupes via this field.

No automatic migration of existing V1 data to V2 is planned — old
plans stay readable through the V1 code paths that still exist in the
frontend (non-V2 workspace). New plans created by agents will use V2
exclusively once Phase A is complete.

---

## 9. Frontend Implications

The V2 workspace (`PlanWorkspaceShellV2`) already handles all
`plan-item-*` events correctly via `usePlanItemsStore`. Once the MCP
tools write to V2, the UI will update in real time with no frontend
changes needed for Phase A.

The V1 workspace code can remain for viewing legacy plans but should
not be the default for new plans.

`onPlanCreated` in `usePlanStore` was already patched to re-fetch from
the server (handles path normalisation). `plan-deleted` broadcast and
handler already added. `ui-navigate` / `ui-toggle` / `ui-refresh`
WebSocket handlers already wired.
