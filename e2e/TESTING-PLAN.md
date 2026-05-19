# Frontend E2E Test Plan

Organised by feature area into folders. Each spec file covers a focused
surface with tests for every interaction, state, and edge case — not
just golden paths.

All browser tests use `playwright.config.ts` (backend :3001 + Vite :5173).

---

## Directory Structure

```
e2e/
├── helpers/
│   └── setup.ts                    — gotoWithProject, openPlan, seedPlan, etc.
│
├── onboarding/
│   ├── welcome-screen.spec.ts      — landing page, CTA, branding
│   ├── recent-projects.spec.ts     — pin, unpin, remove, click-to-open, empty state
│   ├── learn-trellis.spec.ts       — 9-step tutorial, nav, auto-open, dismiss
│   └── getting-started.spec.ts     — 4-step checklist, dismiss, auto-hide, per-project
│
├── project/
│   ├── folder-picker.spec.ts       — modal, path input, nav up, dir click, cancel, open
│   ├── tabs.spec.ts                — add, switch, close, last-tab-closes-to-welcome
│   └── scan.spec.ts                — scan triggers graph, sidebar populates, loading state
│
├── graph/
│   ├── depth-selector.spec.ts      — Clusters/Files/Symbols, Cmd+1/2/3 shortcuts
│   ├── trellis-modes.spec.ts       — Live/Baseline/Planned/Diff switching
│   ├── baseline-controls.spec.ts   — pin, auto-track, commit dropdown, branch-pin
│   ├── node-click.spec.ts          — single-click select, inspector opens, graph expand
│   ├── context-menu.spec.ts        — right-click: add to task, new task, scope, explain
│   ├── multi-select.spec.ts        — shift-click, drag-select, SelectionActionBar actions
│   ├── layout-controls.spec.ts     — Map↔Tree toggle, scope picker, auto-refresh, export
│   ├── node-visuals.spec.ts        — PackageNode expand/collapse, badges, change status colors
│   ├── file-node.spec.ts           — language icon, git badges, plan highlight, ghost nodes
│   ├── edge-visuals.spec.ts        — edge states, animated dots, hover label, emphasis/muting
│   └── loading-state.spec.ts       — animated logo during layout, progress bar
│
├── sidebar/
│   ├── file-tree.spec.ts           — expand/collapse dirs, click-to-select, auto-expand
│   ├── search.spec.ts              — filter input, narrowing, clear
│   └── git-indicators.spec.ts      — M/U/A/D badges, dir aggregates, color coding, polling
│
├── inspector/
│   ├── cluster-view.spec.ts        — package name, description, file list
│   ├── file-view.spec.ts           — symbols, imports, imported-by, view-source
│   ├── symbol-view.spec.ts         — breadcrumb, kind, line range, code slice
│   ├── panel-chrome.spec.ts        — expand/collapse, empty state
│   └── add-to-task.spec.ts         — AddToTaskPopover from code preview
│
├── plan/
│   ├── list.spec.ts                — plan rows, status badges, progress bars, empty state
│   ├── create.spec.ts              — quick-create, title edit, save, appears in list
│   ├── templates.spec.ts           — chooser, create from template, placeholder substitution
│   ├── import-export.spec.ts       — discover on disk, import, export, publish as template
│   ├── archive-delete.spec.ts      — archive, verify removed from active list
│   ├── workspace-shell.spec.ts     — 3-region layout, header, resize regions, back/minimize
│   ├── item-tree.spec.ts           — expand/collapse, status icons, drag reorder, new/delete
│   ├── item-canvas.spec.ts         — title edit, body editor, status dropdown, assignee chip
│   ├── body-editor.spec.ts         — slash menu (/), @-mention picker, Cmd+S save, Escape cancel
│   ├── context-rail.spec.ts        — file specs, targets strip, attachments, routing
│   ├── readiness-ring.spec.ts      — SVG ring, percentage, popover checklist (5 required + 4 suggested)
│   ├── git-context.spec.ts         — chip display, popover edit, base/target/worktree, auto-create
│   ├── comments.spec.ts            — kind selector (note/progress/blocker/question), post, delete, thread
│   ├── split-view.spec.ts          — Cmd+\, plan + graph side by side
│   └── navigation.spec.ts          — breadcrumbs, back/forward, item click history
│
├── plan-execution/
│   ├── agent-claim.spec.ts         — claim via API → "assigned" badge in UI
│   ├── progress.spec.ts            — progress report → bar + percentage in UI
│   ├── blocked.spec.ts             — blocked → warning indicator + reason banner
│   ├── completion.spec.ts          — done → checkmark, completion summary
│   ├── handoff.spec.ts             — button visibility, dropdown: copy prompt / copy task / push to agent
│   ├── proposed-changes.spec.ts    — drift filters (6 statuses), kind filter, refresh, grouped by task
│   ├── drift-indicator.spec.ts     — deviation rows, severity colors, accept/ignore, re-run, dismiss
│   ├── drift-badge.spec.ts         — unresolved count in header, hidden when 0
│   ├── activity-drawer.spec.ts     — Activity tab events, Live tab dashboard, collapse/expand, empty
│   └── execution-dashboard.spec.ts — quick stats, active tasks list, agents list, empty states
│
├── agent/
│   ├── mcp-guide.spec.ts           — 3-step modal, step indicators, copy config, Done button
│   ├── connected-agents.spec.ts    — count badge, popover, session rows, agent type colors, active plan link
│   └── mcp-config-copy.spec.ts     — StatusBar copy button, fallback, "Copied" feedback
│
├── terminal/
│   ├── panel.spec.ts               — toggle open/close, collapsed/expanded states, session count badge
│   ├── tabs.spec.ts                — tab click, preset colors, active styling, exited indicator, kill X
│   ├── presets.spec.ts             — + button dropdown, 4 presets (Claude/Codex/Aider/Shell), create
│   └── empty-state.spec.ts         — "New terminal" button when no sessions
│
├── settings/
│   ├── modal-chrome.spec.ts        — open, sidebar nav, close with Escape
│   ├── identity.spec.ts            — name/email inputs, pull from git config
│   ├── mcp-server.spec.ts          — port input, autodetect toggle, drifted warning, config snippet
│   ├── plans.spec.ts               — visibility toggle, attachment storage toggle
│   ├── data.spec.ts                — data dir override input
│   ├── logs.spec.ts                — log viewer, reveal button, refresh button
│   ├── updates.spec.ts             — check button, spinner, available/up-to-date/error cards
│   └── about.spec.ts               — version, build info, dirty badge, copy button
│
├── git/
│   ├── branch-popover.spec.ts      — open/close, branch list, worktree list, pin baseline from branch
│   └── status-bar.spec.ts          — scan status dot (4 states), project path, event count, agent status
│
├── realtime/
│   ├── plan-events.spec.ts         — item create/update/delete via API → UI updates live
│   ├── agent-events.spec.ts        — session register → connected agents widget + status bar update
│   ├── file-events.spec.ts         — file write → sidebar git indicator refresh
│   ├── toasts.spec.ts              — task completion toast, deviation warning toast, conflict error toast
│   └── auto-refresh.spec.ts        — graph auto-refresh cycle, pause/resume, interval change
│
├── keyboard/
│   └── shortcuts.spec.ts           — Cmd+1/2/3, Cmd+B, Cmd+J, Cmd+\, Cmd+`, Escape (multiple contexts)
│
├── external-refs/
│   └── refs-panel.spec.ts          — add URL, kind detection (9 types), icons, open link, remove, empty state
│
└── screenshots/
    └── capture.spec.ts             — (keep existing) visual regression utility
```

---

## Feature Coverage Matrix

### 1. ONBOARDING (4 files, ~20 tests)

#### `onboarding/welcome-screen.spec.ts`
| Test | Interactions |
|------|-------------|
| Renders CodeTrellis heading and logo | Navigate `/`, assert heading |
| Shows "Open Project" CTA button | Assert button visible |
| Shows 4-step workflow cards when no recents | Verify card content |
| TopBar renders with depth selector | Assert Clusters/Files/Symbols buttons |
| Sidebar renders with Explorer heading | Assert "Explorer" text |
| Connect Agent button visible | Assert button exists |

#### `onboarding/recent-projects.spec.ts`
| Test | Interactions |
|------|-------------|
| Recent projects list renders seeded projects | Seed via API, navigate, verify rows |
| Pinned projects sort to top | Pin one, reload, verify order |
| Pin button toggles pin state | Click pin icon, verify state changes |
| Unpin button toggles back | Click again, verify unpinned |
| Remove button removes from list (stopPropagation) | Click X, verify row gone, no nav |
| Click row opens that project | Click row, verify scan triggered |
| Keyboard: Enter activates row | Focus row, press Enter |
| Keyboard: Space activates row | Focus row, press Space |
| Hover shows relative timestamp | Hover row, verify "N ago" text |
| Empty state shows workflow cards + CTA | No recents, verify cards |

#### `onboarding/learn-trellis.spec.ts`
| Test | Interactions |
|------|-------------|
| Auto-opens on first visit (no localStorage flag) | Clear storage, navigate, verify fullscreen overlay |
| Does NOT auto-open when flag is set | Set flag, navigate, verify no overlay |
| Does NOT auto-open when project tabs exist | Have tabs, verify no overlay |
| Shows 9 steps with correct titles | Step through, verify titles |
| Next button advances step | Click Next, verify step indicator |
| Back button goes to previous step | Click Back, verify |
| Back button hidden on step 1 | Verify not visible |
| Done button shown on step 9 | Navigate to last, verify |
| Step dots are clickable (jump to step) | Click dot 5, verify step |
| Arrow Left goes back | Press key, verify |
| Arrow Right goes forward | Press key, verify |
| Escape closes tutorial | Press Escape, verify closed |
| Backdrop click closes tutorial | Click outside content, verify closed |
| MCP config snippet has Copy button | Navigate to step 7, verify copy button |
| Closing sets localStorage flag | Close, verify flag set |

#### `onboarding/getting-started.spec.ts`
| Test | Interactions |
|------|-------------|
| Appears when project open and not all steps done | Open project, verify checklist |
| Shows 4 steps with correct labels | Verify step text |
| "Project opened" always marked complete | Verify check icon |
| "Show MCP setup" link opens McpGuideModal | Click link, verify modal |
| Progress counter shows "N/4 complete" | Verify counter text |
| Collapse button toggles visibility | Click collapse, verify hidden |
| Collapse state persists per-project in localStorage | Collapse, reload, verify still collapsed |
| Dismiss button hides permanently for project | Click dismiss, reload, verify gone |
| Auto-hides when all 4 steps complete | Complete all steps, verify disappears |

---

### 2. PROJECT MANAGEMENT (3 files, ~15 tests)

#### `project/folder-picker.spec.ts`
| Test | Interactions |
|------|-------------|
| Modal opens on "Open Project" click | Click button, verify modal |
| Modal opens on Cmd+O / custom event | Dispatch event, verify |
| Path text input accepts manual entry | Type path, verify |
| Enter submits typed path | Type, press Enter, verify navigation |
| Escape closes modal | Press Escape, verify closed |
| Go button browses to typed path | Type, click Go, verify |
| Navigate up button moves to parent | Click up, verify path changes |
| Directory list items clickable to browse | Click dir, verify path changes |
| Cancel button closes without action | Click Cancel, verify no project opened |
| Open button opens current directory as project | Browse to dir, click Open |
| Empty state when directory has no subdirectories | Browse to leaf dir, verify message |

#### `project/tabs.spec.ts`
| Test | Interactions |
|------|-------------|
| Tab shows project name after scan | Open project, verify tab label |
| + button opens folder picker for new tab | Click +, verify picker |
| Switching tabs changes active project | Open 2, click each, verify sidebar updates |
| Close X removes tab (stopPropagation) | Click X, verify tab gone but no switch |
| Closing last tab returns to welcome screen | Close all, verify WelcomeScreen |

#### `project/scan.spec.ts`
| Test | Interactions |
|------|-------------|
| Scanning shows loading state | Trigger scan, verify progress indicator |
| Scan completion renders graph canvas | Wait for scan, verify `.react-flow` |
| Sidebar populates with file tree | Verify directory structure |
| StatusBar shows "Ready" after scan | Verify green dot + "Ready" text |
| StatusBar shows project path | Verify monospace path display |

---

### 3. GRAPH (11 files, ~55 tests)

#### `graph/depth-selector.spec.ts`
| Test | Interactions |
|------|-------------|
| Clusters button shows package-level nodes | Click, count nodes |
| Files button shows file-level nodes | Click, count nodes |
| Symbols button shows symbol-level nodes | Click, count nodes |
| Switching depth changes node count | Click each, verify different counts |
| Active depth button is visually highlighted | Verify active state styling |

#### `graph/trellis-modes.spec.ts`
| Test | Interactions |
|------|-------------|
| Live mode is default | Verify Live button active |
| Baseline button switches to baseline view | Click, verify mode indicator |
| Planned button requires active plan | Click without plan, verify no-op or message |
| Planned button works with active plan | Create plan, click, verify overlay |
| Diff button shows diff visualization | Click, verify diff summary panel |
| Active mode button is highlighted | Verify visual state per mode |

#### `graph/baseline-controls.spec.ts`
| Test | Interactions |
|------|-------------|
| Pin button pins current baseline (stops auto-track) | Click Pin, verify pinned state |
| Auto-track button resumes tracking HEAD | Click Auto-track, verify tracking |
| Commit dropdown lists recent commits | Open dropdown, verify 20 commit entries |
| Selecting a commit from dropdown sets baseline | Click commit, verify baseline changed |
| Branch popover pin-baseline-from-branch works | Open popover, click branch pin |

#### `graph/node-click.spec.ts`
| Test | Interactions |
|------|-------------|
| Clicking a package node selects it | Click, verify selection highlight |
| Clicking a file node selects it | Click, verify |
| Selection opens inspector panel | Click node, verify inspector populates |
| Clicking same node toggles selection off | Click twice, verify deselected |
| Auto-fit viewport when node count changes | Switch depth, verify viewport adjusts |

#### `graph/context-menu.spec.ts`
| Test | Interactions |
|------|-------------|
| Right-click node opens context menu | Right-click, verify menu visible |
| "Add to current task" menu item | Verify item present |
| "New task for this" menu item | Verify item present |
| "Scope plan to this" shown for packages | Right-click package, verify |
| "Explain with agent" menu item | Verify item present |
| Click outside closes menu | Click away, verify dismissed |

#### `graph/multi-select.spec.ts`
| Test | Interactions |
|------|-------------|
| Shift+click adds to multi-selection | Shift-click 2 nodes, verify both selected |
| SelectionActionBar appears with 2+ nodes | Multi-select, verify floating bar |
| File count badge shows correct number | Select 3, verify "3 files" |
| "Plan these" creates new action with selected files | Click button, verify action created |
| "Add to task" appends to existing action | Select action first, then click, verify |
| Clear selection button deselects all | Click clear, verify deselected |
| Escape clears multi-selection | Press Escape, verify cleared |

#### `graph/layout-controls.spec.ts`
| Test | Interactions |
|------|-------------|
| Map/Tree toggle switches layout | Click toggle, verify layout changes |
| Scope picker lists discovered systems | Open dropdown, verify items |
| Selecting scope filters graph | Select system, verify fewer nodes |
| Clear scope shows full graph | Click X, verify full graph |
| Projection toggle (plan active) | With plan, toggle projection, verify overlay |
| Projection hidden without active plan | No plan, verify button hidden |
| Auto-refresh pause/play toggle | Click pause, verify paused state |
| Check now button triggers refresh | Click, verify refresh |
| Interval selector changes refresh rate | Select 30s, verify |
| Export PNG button captures image | Click export, verify download |

#### `graph/node-visuals.spec.ts`
| Test | Interactions |
|------|-------------|
| PackageNode shows expand/collapse chevron | Verify toggle button |
| Expand/collapse toggles children visibility | Click chevron, verify children |
| File count badge shows correct count | Verify "N files" pill |
| Connection count badge when applicable | Verify "N links" |
| Change status colors (8 states) | Seed different states, verify colors |
| Local change count badge (amber) | Modify file, verify badge |
| Selection dimming (50% opacity for unrelated) | Select node, verify others dimmed |

#### `graph/file-node.spec.ts`
| Test | Interactions |
|------|-------------|
| Language-specific icon renders | Verify icon per .ts, .py, .tsx |
| Git state badges show on file nodes | Modify file, verify badges |
| Plan highlight ring when file in active plan | Create plan with file, verify ring |
| Ghost node for planned-but-not-existing files | Plan file that doesn't exist, verify dashed style |
| Task number badge on planned files | Verify task number |
| Done checkmark when task completed | Complete task, verify checkmark |

#### `graph/edge-visuals.spec.ts`
| Test | Interactions |
|------|-------------|
| Regular edges render as solid lines | Verify `.react-flow__edge` elements |
| Hover shows symbol label tooltip | Hover edge, verify label |
| Emphasis on edges connected to selected node | Select node, verify connected edges brighter |
| Muted edges for unrelated nodes | Verify dimmed edges |

#### `graph/loading-state.spec.ts`
| Test | Interactions |
|------|-------------|
| Animated logo during initial layout | Trigger scan, verify loading animation |
| Loading state clears when graph renders | Wait, verify loading gone |

---

### 4. SIDEBAR (3 files, ~12 tests)

#### `sidebar/file-tree.spec.ts`
| Test | Interactions |
|------|-------------|
| Tree renders correct directory structure | Verify known dirs/files |
| Directories at depth < 1 auto-expanded | Verify root dirs expanded |
| Click directory toggles expand/collapse | Click chevron, verify toggle |
| Click file selects it | Click file, verify selection highlight |
| Click file navigates graph to that node | Click, verify graph selection |

#### `sidebar/search.spec.ts`
| Test | Interactions |
|------|-------------|
| Search input visible | Verify input |
| Typing narrows file tree to matches | Type query, verify fewer items |
| Clearing search restores full tree | Clear input, verify all items |

#### `sidebar/git-indicators.spec.ts`
| Test | Interactions |
|------|-------------|
| Modified file shows M badge (orange) | Verify indicator |
| Untracked file shows U badge (emerald) | Verify indicator |
| Staged file shows A badge (sky) | Verify indicator |
| Directory aggregate counts shown | Verify count on parent dir |

---

### 5. INSPECTOR (5 files, ~15 tests)

#### `inspector/panel-chrome.spec.ts`
| Test | Interactions |
|------|-------------|
| Empty state when nothing selected | Verify "Click a cluster..." message |
| Expand/collapse button toggles panel | Click button, verify |

#### `inspector/cluster-view.spec.ts`
| Test | Interactions |
|------|-------------|
| Package name heading renders | Select package, verify heading |
| File list shows all files in package | Verify file count |

#### `inspector/file-view.spec.ts`
| Test | Interactions |
|------|-------------|
| Symbols list renders for selected file | Select file, verify symbols |
| Imports section shows dependencies | Verify import list |
| Imported-by section shows dependents | Verify dependents list |
| Clicking import navigates to that file | Click, verify navigation |
| View source opens CodePreview | Click button, verify code display |

#### `inspector/symbol-view.spec.ts`
| Test | Interactions |
|------|-------------|
| Breadcrumb shows parent file | Select symbol, verify breadcrumb |
| Breadcrumb is clickable | Click, verify navigation up |
| Symbol kind displayed | Verify function/class label |
| Code slice rendered with syntax highlighting | Verify code snippet |

#### `inspector/add-to-task.spec.ts`
| Test | Interactions |
|------|-------------|
| AddToTaskPopover opens from code preview | Trigger, verify popover |
| Options: new task, existing task, new plan | Verify options |

---

### 6. PLAN SYSTEM (15 files, ~70 tests)

#### `plan/list.spec.ts`
| Test | Interactions |
|------|-------------|
| Plans tab visible in plan panel | Click "Plans", verify |
| Plan rows show title, status badge, task count | Seed plans, verify rows |
| Plan row hover shows "Open ->" | Hover, verify text |
| Progress bar per plan (segmented) | Verify bar segments |
| Empty state "No plans yet" with CTA | No plans, verify message |
| Discovered plans section with Import buttons | Export plan to disk, verify discovery |

#### `plan/create.spec.ts`
| Test | Interactions |
|------|-------------|
| "New plan" button quick-creates blank plan | Click, verify workspace opens |
| Workspace opens with "Untitled plan" placeholder | Verify input placeholder |
| Typing title and tabbing away saves | Fill title, tab, verify via API |
| New plan appears in plan list | Verify row added |

#### `plan/templates.spec.ts`
| Test | Interactions |
|------|-------------|
| Template chooser shows available templates | Open chooser, verify list |
| Create plan from bug-fix template | Select template, verify plan created |
| Placeholder substitution works | Provide values, verify in result |
| Template creates phases and docs | Verify phases/docs via API |

#### `plan/import-export.spec.ts`
| Test | Interactions |
|------|-------------|
| Export plan to disk creates .codetrellis/plans/ | Export via API, verify dir |
| Exported plan discoverable in plan list | Verify discovery row |
| Import plan from disk works | Import, verify plan in list |
| Publish as template creates template | Publish, verify in template list |

#### `plan/archive-delete.spec.ts`
| Test | Interactions |
|------|-------------|
| Archive removes plan from active list | Archive via API, verify gone |
| Archived plan still accessible via API | GET by uid, verify status |

#### `plan/workspace-shell.spec.ts`
| Test | Interactions |
|------|-------------|
| 3-region layout renders (sidebar, canvas, drawer) | Open plan, verify regions |
| Header shows title, status badge, progress bar | Verify header elements |
| Readiness ring in header | Verify SVG element |
| Drift badge in header | Verify element |
| Handoff button in header | Verify element |
| Back/minimize returns to plan list | Click back, verify list |
| Escape minimizes workspace | Press Escape, verify graph |
| Regions are resizable via drag | Drag divider, verify width change |

#### `plan/item-tree.spec.ts`
| Test | Interactions |
|------|-------------|
| Tree shows items added via API | Seed items, verify tree rows |
| Status icons per item kind | Verify pending/assigned/in_progress/done/blocked/skipped icons |
| Progress percentage on action items | Verify percentage |
| "New" button dropdown: Page and Task options | Click +, verify dropdown |
| Creating page/task adds to tree | Click option, verify new row |
| More menu → History opens drawer | Click More > History, verify drawer |
| More menu → Delete shows confirmation | Click More > Delete, verify dialog |
| Delete confirmation Cancel aborts | Click Cancel, verify item still exists |
| Delete confirmation Delete removes item | Click Delete, verify gone |
| Empty state shows new page/task buttons | No items, verify empty state |

#### `plan/item-canvas.spec.ts`
| Test | Interactions |
|------|-------------|
| Click item shows detail canvas with title input | Click tree item, verify input |
| Title input autosaves on debounce | Edit title, wait 500ms, verify saved |
| Status dropdown with 6 options | Open dropdown, verify options |
| Changing status updates item | Select "in_progress", verify via API |
| Assignee chip shows when assigned | Claim item, verify chip |
| Progress chip shows percentage | Report progress, verify chip |
| Approval gate toggle | Toggle, verify |
| Copy context button | Click, verify clipboard |
| History button opens item history drawer | Click, verify drawer |
| Blocked reason banner when status=blocked | Set blocked, verify banner text |
| Paste handler for images/video | Paste content, verify attachment |

#### `plan/body-editor.spec.ts`
| Test | Interactions |
|------|-------------|
| Body area click-to-edit | Click area, verify editor mode |
| Typing in editor updates content | Type text, verify |
| Cmd+S saves body | Press shortcut, verify saved |
| Escape cancels edit without saving | Press Escape, verify reverted |
| Slash menu (/) opens command palette | Type /, verify menu |
| @-mention picker opens on @ | Type @, verify picker |
| Blur commits body | Click outside, verify saved |

#### `plan/context-rail.spec.ts`
| Test | Interactions |
|------|-------------|
| File specs section shows targeted files | Seed file specs, verify |
| Targets strip renders file paths | Verify strip content |
| Attachments section | Add attachment, verify |

#### `plan/readiness-ring.spec.ts`
| Test | Interactions |
|------|-------------|
| Ring renders SVG with percentage | Verify SVG + text |
| Color changes with score (red/amber/green) | Seed different plans, verify colors |
| Click expands checklist popover | Click ring, verify popover |
| Checklist shows 5 required checks | Verify labels |
| Checklist shows 4 suggested checks | Verify labels |
| Required check fails when no title | Empty title, verify red X |
| Required check fails when no tasks | No actions, verify red X |
| Required check fails when tasks lack targets | Action without files, verify red X |
| Suggested check: git context missing shows amber | No git context, verify warning |

#### `plan/git-context.spec.ts`
| Test | Interactions |
|------|-------------|
| Chip shows "Set git context" when unconfigured | Verify chip text |
| Chip click opens popover | Click, verify popover |
| Base ref input accepts text | Type value, verify |
| Target branch input accepts text | Type value, verify |
| Auto-create branch checkbox toggles | Click checkbox, verify |
| Save persists git context | Click Save, verify via API |
| Clear removes git context | Click Clear, verify |
| Cancel closes without saving | Click Cancel, verify unchanged |
| Click outside closes popover | Click away, verify closed |
| Chip shows "base → target" when configured | Set values, verify chip text |

#### `plan/comments.spec.ts`
| Test | Interactions |
|------|-------------|
| Kind selector shows 4 types | Verify note/progress/blocker/question buttons |
| Placeholder text changes per kind | Select each kind, verify placeholder |
| Post button submits comment | Type, click Post, verify |
| Comment thread shows posted comments | Post multiple, verify order |
| Delete button removes individual comment | Click delete, verify gone |
| Empty state when no comments | Verify message |

#### `plan/split-view.spec.ts`
| Test | Interactions |
|------|-------------|
| Cmd+\ toggles split view | Press shortcut, verify both plan + graph visible |
| Split view shows plan workspace and graph side by side | Verify both panels |
| Toggling off returns to single view | Press again, verify single |

#### `plan/navigation.spec.ts`
| Test | Interactions |
|------|-------------|
| Breadcrumb trail shows item hierarchy | Verify breadcrumb items |
| Clicking breadcrumb navigates up | Click parent, verify |
| Back/forward navigation through item click history | Click items, then back, verify |

---

### 7. PLAN EXECUTION (10 files, ~35 tests)

#### `plan-execution/agent-claim.spec.ts`
| Test | Interactions |
|------|-------------|
| Claim via API shows "assigned" badge in workspace | Claim, open workspace, verify badge |
| Assignee name appears on item | Verify agent name |

#### `plan-execution/progress.spec.ts`
| Test | Interactions |
|------|-------------|
| Progress report shows bar + percentage | POST progress, verify in UI |
| Progress updates in activity drawer | Verify event row |

#### `plan-execution/blocked.spec.ts`
| Test | Interactions |
|------|-------------|
| Blocked status shows warning indicator | POST blocked, verify indicator |
| Blocked reason text appears in banner | Verify reason text |

#### `plan-execution/completion.spec.ts`
| Test | Interactions |
|------|-------------|
| Done task shows checkmark | Set done, verify |
| PlanCompletionSummary shows when plan complete | Complete all tasks, verify summary |

#### `plan-execution/handoff.spec.ts`
| Test | Interactions |
|------|-------------|
| Button only visible when pending actions exist | With pending, verify shown |
| Button hidden when all actions done/skipped | Complete all, verify hidden |
| Dropdown: "Copy plan as prompt" | Click, verify clipboard content |
| Dropdown: "Copy this task" when action selected | Select action, verify option |
| Dropdown: "Push to agent" lists connected agents | Seed agents, verify list |
| Dropdown: empty state when no agents | No agents, verify message |
| Agent rows show type badge and model | Verify display |

#### `plan-execution/proposed-changes.spec.ts`
| Test | Interactions |
|------|-------------|
| Proposed tab shows changes list | Navigate to tab, verify |
| Filter buttons: All/Planned/In progress/Satisfied/Missing/Unexpected | Click each, verify count |
| Kind filter dropdown: All/Files/Symbols/Connections | Select each, verify |
| Refresh button re-fetches | Click, verify loading |
| Changes grouped by task | Verify task header groups |
| Change row shows operation icon + kind + target + drift status | Verify row structure |
| Empty state when no changes | No changes, verify message |
| Empty state when filter excludes all | Select filter with 0, verify message |

#### `plan-execution/drift-indicator.spec.ts`
| Test | Interactions |
|------|-------------|
| Deviation rows display | Seed deviations, verify rows |
| Accept button marks deviation | Click, verify state change |
| Ignore button dismisses | Click, verify |
| Re-run detection button | Click, verify refresh |

#### `plan-execution/drift-badge.spec.ts`
| Test | Interactions |
|------|-------------|
| Badge shows unresolved count | Seed deviations, verify number |
| Badge hidden when count is 0 | Resolve all, verify hidden |

#### `plan-execution/activity-drawer.spec.ts`
| Test | Interactions |
|------|-------------|
| Two tabs: Activity, Live | Verify tab buttons |
| Activity tab shows event feed | Seed events, verify rows |
| Event rows clickable to navigate to item | Click event, verify navigation |
| Live tab renders ExecutionDashboard | Switch tab, verify dashboard |
| Collapse/expand toggle | Click toggle, verify state |
| Empty state "Quiet. Item events will land here..." | No events, verify message |

#### `plan-execution/execution-dashboard.spec.ts`
| Test | Interactions |
|------|-------------|
| Quick stats: active, done/total, blocked | Verify 3 metrics |
| Active Tasks section lists in_progress items | Seed tasks, verify |
| Active task rows show progress bar | Verify bar |
| Agents section lists connected sessions | Seed agents, verify |
| Empty states per section | No data, verify messages |

---

### 8. AGENT (3 files, ~15 tests)

#### `agent/mcp-guide.spec.ts`
| Test | Interactions |
|------|-------------|
| Connect Agent button opens modal | Click, verify |
| Modal shows 3-step guide with indicators | Verify steps |
| Step 1: MCP config JSON preview | Verify code block |
| Step 1: Copy Config with "Copied!" feedback | Click, verify feedback |
| Step 2: Agent-specific file paths | Verify Claude/Cursor/Custom paths |
| Step 3: Available MCP tools list | Verify tool names |
| Done button closes modal | Click, verify closed |
| External link to codetrellis.dev | Verify link |

#### `agent/connected-agents.spec.ts`
| Test | Interactions |
|------|-------------|
| Count badge shows N connected agents | Seed sessions, verify count |
| Animated pulse dot visible | Verify animation |
| Click opens popover | Click badge, verify popover |
| Session rows show type, model, last-seen, session ID | Verify row fields |
| Agent type colors: Claude=amber, Codex=emerald, Cursor=cyan, Aider=purple | Verify colors |
| Active plan link clickable | Click link, verify plan activates |
| Empty state suggests Connect Agent button | No agents, verify message |

#### `agent/mcp-config-copy.spec.ts`
| Test | Interactions |
|------|-------------|
| StatusBar copy button fetches and copies config | Click, verify |
| "Copied" check icon appears for 2 seconds | Click, verify icon transition |

---

### 9. TERMINAL (4 files, ~15 tests)

#### `terminal/panel.spec.ts`
| Test | Interactions |
|------|-------------|
| Terminal button in status bar toggles panel | Click, verify toggle |
| Cmd+` keyboard shortcut toggles | Press, verify |
| Collapsed state shows 30px bar | Verify height |
| Expanded state shows ~40vh | Verify height |
| Session count badge | Seed sessions, verify count |

#### `terminal/tabs.spec.ts`
| Test | Interactions |
|------|-------------|
| Tab click switches active session | Create 2, click each, verify switch |
| Preset color accents (Claude=orange, Codex=green, etc.) | Verify colors |
| Active tab has colored background | Verify active styling |
| "exited" indicator on terminated session | Kill, verify indicator |
| Kill X button removes tab (stopPropagation) | Click X, verify gone |

#### `terminal/presets.spec.ts`
| Test | Interactions |
|------|-------------|
| + button opens preset dropdown | Click, verify dropdown |
| 4 presets: Claude, Codex, Aider, Shell | Verify items |
| Click preset creates terminal session | Click Shell, verify session |
| Click outside closes dropdown | Click away, verify closed |

#### `terminal/empty-state.spec.ts`
| Test | Interactions |
|------|-------------|
| "New terminal" button when no sessions | Verify button |
| Clicking empty-state button creates session | Click, verify session |

---

### 10. SETTINGS (8 files, ~30 tests)

#### `settings/modal-chrome.spec.ts`
| Test | Interactions |
|------|-------------|
| Settings gear button opens modal | Click, verify modal |
| Sidebar shows 8 section buttons | Verify all sections |
| Click section scrolls to that section | Click each, verify scroll |
| Escape closes modal | Press, verify closed |
| Update-available dot on settings button | Seed update, verify dot |

#### `settings/identity.spec.ts`
| Test | Interactions |
|------|-------------|
| Display name input renders with current value | Verify input |
| Email input renders with current value | Verify input |
| Editing name persists via API | Change, blur, verify saved |
| "Pull from git config" auto-fills fields | Click, verify populated |

#### `settings/mcp-server.spec.ts`
| Test | Interactions |
|------|-------------|
| Port input shows current port | Verify value |
| Autodetect checkbox toggles | Click, verify state |
| Config snippet shows JSON | Verify code block |
| Copy config button | Click, verify copied |
| Drifted port warning when mismatch | Seed mismatch, verify warning |

#### `settings/plans.spec.ts`
| Test | Interactions |
|------|-------------|
| Default visibility toggle (shared/local) | Toggle, verify |
| Attachment storage toggle (project/user) | Toggle, verify |

#### `settings/data.spec.ts`
| Test | Interactions |
|------|-------------|
| Data directory override input | Verify input |
| Editing path updates setting | Change, verify |

#### `settings/logs.spec.ts`
| Test | Interactions |
|------|-------------|
| Log content viewer shows log text | Verify content |
| Refresh button reloads logs | Click, verify |
| Reveal button (opens file location) | Click, verify action |

#### `settings/updates.spec.ts`
| Test | Interactions |
|------|-------------|
| Check for Updates button triggers check | Click, verify spinner |
| Up-to-date card when no update | Verify card |
| Error card with Retry on failure | Seed failure, verify card + retry |

#### `settings/about.spec.ts`
| Test | Interactions |
|------|-------------|
| Version string displayed | Verify text |
| Build info (commit, date) shown | Verify fields |
| Dirty badge when applicable | Verify badge |
| Copy build info button | Click, verify copied |

---

### 11. GIT (2 files, ~10 tests)

#### `git/branch-popover.spec.ts`
| Test | Interactions |
|------|-------------|
| Branch button opens popover | Click, verify popover |
| Branch list shows local branches | Verify branches |
| Worktree list shows worktrees | Verify entries |
| Pin baseline from branch | Click pin, verify baseline set |
| Click outside closes popover | Click away, verify closed |

#### `git/status-bar.spec.ts`
| Test | Interactions |
|------|-------------|
| idle: gray dot, "No project" | Before scan, verify |
| scanning: amber dot + pulse, "Scanning..." | During scan, verify |
| ready: green dot, "Ready" | After scan, verify |
| error: red dot, "Error" | Seed error, verify |
| Event count badge (hidden when 0) | Verify conditional |

---

### 12. EXTERNAL REFS (1 file, ~8 tests)

#### `external-refs/refs-panel.spec.ts`
| Test | Interactions |
|------|-------------|
| Add button reveals URL input | Click, verify input |
| Enter submits URL and adds ref | Type URL, press Enter, verify |
| Escape cancels input | Press Escape, verify hidden |
| URL kind auto-detection (github, jira, linear, etc.) | Add different URLs, verify icons |
| Ref display: icon, title, shortened URL | Verify row content |
| Open in browser link | Verify external link |
| Remove button visible on hover | Hover, verify X button |
| Empty state "Paste a URL..." | No refs, verify message |

---

### 13. REALTIME (5 files, ~15 tests)

#### `realtime/plan-events.spec.ts`
| Test | Interactions |
|------|-------------|
| Create item via API → appears in workspace tree | POST item, verify |
| Update item via API → status changes in UI | PUT status, verify |
| Delete item via API → removed from tree | DELETE, verify |

#### `realtime/agent-events.spec.ts`
| Test | Interactions |
|------|-------------|
| Agent registers → connected agents count updates | Register, verify count |
| Agent disconnects → count decreases | Disconnect, verify |
| StatusBar agent status updates | Verify indicator change |

#### `realtime/file-events.spec.ts`
| Test | Interactions |
|------|-------------|
| File write → sidebar git indicator refreshes | Write file, wait, verify |
| Graph nodes update after file change | Verify refresh |

#### `realtime/toasts.spec.ts`
| Test | Interactions |
|------|-------------|
| Task completion → success toast | Complete task, verify toast |
| Deviation detected → warning toast | Trigger deviation, verify |
| Conflict → error toast | Trigger conflict, verify |
| Toast auto-dismisses after timeout | Verify disappears |

#### `realtime/auto-refresh.spec.ts`
| Test | Interactions |
|------|-------------|
| Auto-refresh polls at configured interval | Set 5s, verify polling |
| Pause stops polling | Click pause, verify no refresh |
| Resume restarts polling | Click resume, verify refresh |

---

### 14. KEYBOARD (1 file, ~10 tests)

#### `keyboard/shortcuts.spec.ts`
| Test | Interactions |
|------|-------------|
| Cmd+1 switches to Clusters | Press, verify |
| Cmd+2 switches to Files | Press, verify |
| Cmd+3 switches to Symbols | Press, verify |
| Cmd+B toggles sidebar visibility | Press, verify hidden/shown |
| Cmd+J toggles plan panel | Press, verify |
| Cmd+\ toggles split view | Press, verify |
| Cmd+` toggles terminal | Press, verify |
| Escape: deselect node in graph | Select, press, verify cleared |
| Escape: cancel body edit in plan | Edit, press, verify reverted |
| Escape: close LearnTrellis | Open, press, verify closed |
| Escape: minimize plan workspace to graph | In workspace, press, verify graph |

---

## Files to Remove (Redundant)

| File | Reason |
|---|---|
| `e2e/api.spec.ts` | 111 harness tests cover all API endpoints |
| `e2e/plans.spec.ts` | Harness covers plan CRUD |
| `e2e/project-scan.spec.ts` | Harness covers scan/deps/symbols |
| `e2e/app-loads.spec.ts` | Absorbed into `onboarding/welcome-screen.spec.ts` |
| `e2e/ui-interactions.spec.ts` | Split across graph, settings, agent |
| `e2e/full-plan-flow.spec.ts` | Split across plan, plan-execution |

**Keep:** `e2e/screenshots/capture.spec.ts` (visual regression utility)

---

## Totals

| Folder | Files | Tests |
|--------|-------|-------|
| onboarding/ | 4 | ~20 |
| project/ | 3 | ~15 |
| graph/ | 11 | ~55 |
| sidebar/ | 3 | ~12 |
| inspector/ | 5 | ~15 |
| plan/ | 15 | ~70 |
| plan-execution/ | 10 | ~35 |
| agent/ | 3 | ~15 |
| terminal/ | 4 | ~15 |
| settings/ | 8 | ~30 |
| git/ | 2 | ~10 |
| external-refs/ | 1 | ~8 |
| realtime/ | 5 | ~15 |
| keyboard/ | 1 | ~10 |
| **Total** | **75** | **~325** |

## Implementation Priority

**Wave 1 — Core flows (blocks everything else):**
helpers/, onboarding/, project/

**Wave 2 — Product core:**
graph/, sidebar/, inspector/

**Wave 3 — Plan system:**
plan/, plan-execution/

**Wave 4 — Supporting surfaces:**
agent/, terminal/, settings/, git/

**Wave 5 — Advanced/integration:**
external-refs/, realtime/, keyboard/
