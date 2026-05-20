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

---

### 15. API COVERAGE (4 files, ~40 tests)

HTTP-only tests that exercise every backend route without a browser.
Fast, deterministic, no tree-sitter instability.

```
e2e/
├── api-coverage/
│   ├── baseline-snapshot.spec.ts    — trellis capture, list, get, diff
│   ├── graph-analysis.spec.ts       — dependencies, symbols, cross-system, architecture
│   ├── plan-changes.spec.ts         — proposed changes, deviations, drift, reconcile
│   ├── comments-global.spec.ts      — global comment CRUD (targetUid/targetType)
│   ├── git-advanced.spec.ts         — branch, info, diff, log, worktrees, onboarding, browse
│   └── remaining-routes.spec.ts     — attachments, external refs, sessions, settings, updates, templates
```

#### `api-coverage/baseline-snapshot.spec.ts`
| Test | Method |
|------|--------|
| POST /api/trellis/capture creates snapshot | POST, verify id |
| GET /api/trellis/snapshots lists snapshots | GET, verify array |
| GET /api/trellis/:id returns full snapshot | GET by id |
| GET /api/trellis/:id/diff returns diff vs live | GET diff |

#### `api-coverage/graph-analysis.spec.ts`
| Test | Method |
|------|--------|
| GET /api/dependencies returns all edges | GET |
| GET /api/dependencies/file returns per-file deps | GET with ?path= |
| GET /api/symbols/search finds symbols | GET with ?q= |
| GET /api/symbols/file returns file symbols | GET with ?path= |
| GET /api/cross-system-edges returns pairings | GET |
| GET /api/architecture returns analysis | GET |
| GET /api/conformity returns report | GET |

#### `api-coverage/remaining-routes.spec.ts`
| Test | Method |
|------|--------|
| DELETE /api/attachments/:uid removes attachment | DELETE |
| GET /api/plans/:uid/changes/:changeId (URL-encoded) | GET |
| POST /api/plans/import-external imports plan | POST |
| POST /api/recent-projects/pin pins project | POST |
| DELETE /api/recent-projects/:id removes project | DELETE |
| POST /api/terminals/:id/inject injects prompt | POST |
| POST /api/plans/from-template creates from template | POST |
| External refs CRUD (POST/GET/PUT/DELETE) | All methods |
| POST /api/sessions registers session | POST |
| GET+PUT /api/settings round-trip | GET, PUT |
| GET /api/updates/status returns update info | GET |

---

### 16. MCP WIRE PROTOCOL (5 files, ~39 tests)

Tests the real MCP SSE transport — the same JSON-RPC protocol that
Claude Code, Codex, Cursor, and custom agents use. Each test connects
over SSE, performs the initialize handshake, calls tools, and verifies
responses. Uses `helpers/mcp-client.ts` (lightweight JSON-RPC client).

```
e2e/
├── helpers/
│   └── mcp-client.ts                — JSON-RPC over SSE client
├── mcp-tools/
│   ├── protocol-handshake.spec.ts   — SSE connect, initialize, tools/list
│   ├── graph-tools.spec.ts          — search_symbols, get_dependencies, architecture, conformity
│   ├── plan-lifecycle.spec.ts       — plan CRUD, item CRUD, move, claim, progress, gate, timeline
│   ├── docs-phases-comments.spec.ts — plan docs, phases, comments, attachments, external refs
│   └── changes-drift-templates.spec.ts — changes, drift, templates, file sync, sessions, legacy tasks
```

#### `mcp-tools/protocol-handshake.spec.ts`
| Test | Interactions |
|------|-------------|
| SSE connect + initialize + tools/list | Connect, handshake, list all tools |
| Core tool names present | Verify known tool names in list |
| Session registration via wire | register_session via MCP |

#### `mcp-tools/graph-tools.spec.ts`
| Test | Interactions |
|------|-------------|
| search_symbols returns results | callTool, verify response |
| get_dependencies returns edges | callTool with file path |
| list_cross_system_edges returns data | callTool |
| check_architecture returns analysis | callTool |
| check_conformity returns report | callTool |

#### `mcp-tools/plan-lifecycle.spec.ts` (12 tests)
| Test | Interactions |
|------|-------------|
| create_plan → get_plan → update_plan → list_plans | Full CRUD lifecycle |
| add_item → get_item → update_item → list_items | Item CRUD |
| read_item_full returns bundled context | callTool, verify response |
| move_item changes parent | Create parent + child, move |
| claim_item assigns agent | callTool with agent_id |
| update_item_progress + set_item_blocked | Progress + blocked flow |
| delete_item removes item | callTool, verify gone |
| get_plan_timeline returns events | callTool after seeding events |
| report_plan returns summary | callTool |
| get_next_item returns pending | callTool |
| approve_gate clears gate | Mark done, then approve |

#### `mcp-tools/docs-phases-comments.spec.ts` (7 tests)
| Test | Interactions |
|------|-------------|
| Plan doc CRUD + search | add → get → list → update → search |
| Phase CRUD + delete | add → list → update → delete |
| Plan-level comments | add_comment → get_comments |
| Item comments | add_item_comment → list_item_comments |
| Item attachments | add_item_attachment |
| External refs lifecycle | add → list → remove |

#### `mcp-tools/changes-drift-templates.spec.ts` (12 tests)
| Test | Interactions |
|------|-------------|
| list_proposed_changes + get_changes_summary | callTool after seeding file_specs |
| detect_deviations + get_deviations + get_drift_report | Full drift pipeline |
| reconcile processes deviation | callTool with action='detect' |
| list_plan_templates | callTool |
| create_plan_from_template | List templates, create from first |
| export + import + discover + unlink | File sync round-trip |
| publish_plan_as_template | callTool |
| register_session + set_active_plan + capture_checkpoint | Session lifecycle |
| Legacy: add_subtask + claim_task + update_task + progress + blocked | Legacy task tools |
| Legacy: task comments + attachments | add_task_comment, list, attachment |
| get_next_task + read_task_full | Legacy task retrieval |
| restore_item_version | Create, update, restore to v1 |

---

### 17. LIVE AGENT GOLDEN CHAINS (NEW — the full loop)

The crown jewel. These tests use CodeTrellis's built-in terminal to
spawn a real Claude Code session, inject commands via the terminal
inject API, and verify the entire observable surface end-to-end:
terminal → agent → MCP tool calls → plan updates → graph changes →
WebSocket events → UI rendering → visual indicators.

The fixture repo at `tests/fixtures/sample-app/` is the target
codebase. Tests reset it via `git checkout HEAD --` between runs.

#### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Playwright (test runner)                                │
│                                                          │
│  1. Open CodeTrellis UI → scan fixture repo              │
│  2. Spawn terminal with "claude" preset                  │
│  3. Inject prompt: "build this plan, then execute it"    │
│  4. Agent authors plan via MCP (create_plan, add_item…)  │
│  5. Agent executes plan (claim, edit, progress, done)    │
│  6. Verify UI updates (graph, plan panel, status bar)    │
│  7. Screenshot for visual regression                     │
└────────────┬────────────────────────────────────────┬────┘
             │                                        │
    ┌────────▼────────┐                    ┌──────────▼──────────┐
    │  Terminal PTY    │                    │  Browser UI         │
    │  (node-pty)      │                    │  (React + ReactFlow)│
    │                  │                    │                     │
    │  claude --dan... │                    │  Graph nodes        │
    │  ← inject text   │                    │  Plan panel         │
    │  → MCP calls     │                    │  Status bar         │
    └────────┬─────────┘                    │  Agent widget       │
             │                              │  Toast notifications│
    ┌────────▼────────────┐                 └─────────────────────┘
    │  MCP Server (:19432)│
    │  ← tool calls       │
    │  → broadcast events │
    └─────────────────────┘
```

#### Two test modes: pre-seeded plan vs agent-authored plan

These are fundamentally different code paths and both need coverage:

| Mode | What's tested | Who builds the plan |
|------|---------------|---------------------|
| **Pre-seeded** | Execution engine, progress tracking, WebSocket delivery, UI updates | Test harness seeds plan via REST API before agent starts |
| **Agent-authored** | Full authoring loop (`create_plan`, `add_item`, `add_plan_doc`, `add_plan_phase`) + execution | Agent builds plan from scratch via MCP tools during the test |

Both use the same terminal inject → verify pattern. The difference
is what the injected prompt tells Claude to do.

#### How Claude knows it's being tested

The injected prompt gives Claude a deterministic script. We control
the output by being explicit about what to do and what markers to
emit so Playwright knows when each phase completes.

**Prompt A — Execute a pre-seeded plan:**

The test harness creates the plan via the REST API, then tells Claude
to find and execute it:

```
You are being used inside a CodeTrellis E2E test harness.
Do NOT improvise, create new plans, or deviate from these instructions.

A plan called "E2E Pre-seeded: Error Handling" already exists in CodeTrellis.
Use `list_plans` to find it, then `set_active_plan` to activate it.

Then execute every action item in the plan:
1. Use `get_next_item` to get the next pending item
2. Call `claim_item` for it
3. Read the affected file(s) listed in the item's file_specs
4. Make the exact edit described in the item body
5. Call `update_item_progress` with percent=100, message="Complete"
6. Call `update_item` with status="done"
7. Repeat from step 1 until `get_next_item` returns no more items

When all items are done, say "ALL_TASKS_COMPLETE" on a new line.
```

**Prompt B — Author a plan from scratch, then execute:**

No pre-seeding. Claude builds the entire plan via MCP tools. The
prompt specifies the exact structure to create:

```
You are being used inside a CodeTrellis E2E test harness.
Your job is to build a plan from scratch and then execute it.
Do NOT improvise or add extra steps beyond what is specified.

STEP 1 — BUILD THE PLAN:
Use `create_plan` with these exact parameters:
  - title: "E2E Agent-Authored: Error Handling"
  - project_path: "/path/to/tests/fixtures/sample-app"
  - tasks: []

Then use `add_item` to add these exact items:
  Item 1 (kind: "action"):
    - title: "Add try-catch to API fetch calls"
    - body: "Wrap the fetch() calls in api.ts with try-catch blocks"
    - file_specs: [{ path: "packages/web/src/api.ts", action: "modify" }]
  Item 2 (kind: "action"):
    - title: "Add error boundary to UserList"
    - body: "Add React error boundary wrapper to UserList.tsx"
    - file_specs: [{ path: "packages/web/src/UserList.tsx", action: "modify" }]

Then use `add_plan_doc` to add an executive summary:
  - doc_type: "executive"
  - title: "Error Handling Improvement"
  - body: "This plan adds error handling to the web frontend."

Then use `add_plan_phase`:
  - title: "Phase 1: Core error handling"
  - phase_number: 1

When the plan is fully built, say "PLAN_READY" on a new line.

STEP 2 — EXECUTE THE PLAN:
For each action item you just created:
1. Call `claim_item` for the item
2. Read the affected file using your Read tool
3. Make the edit described in the item body
4. Call `update_item_progress` with percent=100, message="Complete"
5. Call `update_item` with status="done"

When all items are done, say "ALL_TASKS_COMPLETE" on a new line.
```

**Prompt C — Author then deliberately deviate:**

Same authoring as Prompt B, but the execution deviates:

```
You are being used inside a CodeTrellis E2E test harness.
Build the plan exactly as specified in STEP 1 below, but when
executing, deliberately deviate as described in STEP 2.

STEP 1 — BUILD THE PLAN:
(same as Prompt B — create_plan, add_item × 2, add_plan_doc, add_plan_phase)
When built, say "PLAN_READY" on a new line.

STEP 2 — EXECUTE WITH DEVIATIONS:
- Complete Item 1 (api.ts) as specified — claim, edit, progress, done
- SKIP Item 2 entirely — do NOT touch UserList.tsx
- ALSO edit a file NOT in the plan: add a comment to
  services/api/app/db.py saying "// modified outside plan scope"
When done, say "DEVIATION_COMPLETE" on a new line.
```

**Prompt D — Execute pre-seeded plan with deviations:**

Same as Prompt C's deviation behavior, but against a pre-seeded plan:

```
You are being used inside a CodeTrellis E2E test harness.
A plan called "E2E Pre-seeded: Error Handling" already exists.
Use `list_plans` to find it and `set_active_plan` to activate it.

Execute with these deliberate deviations:
- Complete the first action item as specified
- SKIP the second action item — do NOT touch the file it targets
- ALSO edit services/api/app/db.py (not in the plan) — add a comment
When done, say "DEVIATION_COMPLETE" on a new line.
```

This gives us a 2×2 matrix:

| | Normal execution | Deliberate deviation |
|---|---|---|
| **Pre-seeded plan** | Prompt A | Prompt D |
| **Agent-authored plan** | Prompt B | Prompt C |

All four combinations are tested. Each exercises different code paths
through the plan authoring, execution, and drift detection systems.

#### Test structure

```
e2e/
├── live-agent/
│   ├── helpers/
│   │   ├── agent-harness.ts         — spawn terminal, inject, wait for events
│   │   ├── fixture-reset.ts         — git checkout HEAD -- tests/fixtures/sample-app
│   │   ├── prompts.ts               — all inject prompts (A/B/C/D) as constants
│   │   └── mock-agent.ts            — scripted MCP agent for CI (no Claude needed)
│   │
│   ├── preseeded-execution.spec.ts  — Prompt A: agent executes pre-seeded plan
│   ├── agent-authored-flow.spec.ts  — Prompt B: agent builds + executes plan
│   ├── preseeded-deviation.spec.ts  — Prompt D: pre-seeded plan, deliberate drift
│   ├── authored-deviation.spec.ts   — Prompt C: agent-built plan, deliberate drift
│   ├── file-watcher-pipeline.spec.ts— agent edits file → re-parse → graph update
│   ├── multi-agent-contention.spec.ts — two agents claim same task
│   ├── visual-indicators.spec.ts    — color coding, status icons, badges
│   └── claude-jsonl-watcher.spec.ts — JSONL tail → agent events → timeline
```

#### `live-agent/helpers/agent-harness.ts`

```typescript
// Core harness utilities for live agent tests.

export interface AgentHarness {
  /** Spawn a terminal with Claude preset, return terminal ID. */
  spawnAgent(cwd: string): Promise<string>;

  /** Inject a prompt into the terminal (types it as if user typed). */
  inject(termId: string, text: string): Promise<void>;

  /** Seed a plan via REST API (for pre-seeded test modes). */
  seedPlan(opts: {
    title: string;
    items: Array<{ title: string; body: string; fileSpecs: Array<{ path: string; action: string }> }>;
    doc?: { title: string; body: string };
    phase?: { title: string; number: number };
  }): Promise<{ planUid: string; itemUids: string[] }>;

  /** Wait for a specific WebSocket broadcast event. */
  waitForEvent(
    eventType: string,
    match?: Record<string, unknown>,
    timeout?: number
  ): Promise<unknown>;

  /** Wait for terminal output containing a string. */
  waitForOutput(termId: string, needle: string, timeout?: number): Promise<void>;

  /** Reset the fixture repo to a clean state. */
  resetFixture(): Promise<void>;

  /** Kill the terminal and clean up. */
  cleanup(termId: string): Promise<void>;
}
```

#### `live-agent/preseeded-execution.spec.ts` (~8 tests)

**Prompt A path**: test harness creates the plan, agent finds and
executes it. Tests the execution engine in isolation — plan already
exists with known structure, agent just needs to work through it.

| Test | What it verifies |
|------|------------------|
| Pre-seed plan + items + doc + phase via REST API | Plan exists before agent starts |
| Agent connects and appears in ConnectedAgents widget | Terminal spawn → MCP register_session → UI widget |
| Agent finds plan via list_plans → set_active_plan | Agent discovers existing plan, activates it |
| Agent claims first task → "assigned" badge appears | claim_item → plan-item-claimed → UI badge |
| Agent reads affected file → file-read event in timeline | Read tool use → agent-event → Timeline tab row |
| Agent edits file → file-changed event + graph re-renders | Write tool → file watcher → broadcast → graph update |
| Agent reports progress → progress bar updates | update_item_progress → plan-item-progress → UI bar |
| Agent marks all tasks done → completion summary appears | Terminal "ALL_TASKS_COMPLETE", PlanCompletionSummary renders |

#### `live-agent/agent-authored-flow.spec.ts` (~12 tests)

**Prompt B path**: agent builds the plan from scratch via MCP tools,
then executes it. Tests the full authoring → execution loop.

| Test | What it verifies |
|------|------------------|
| **Plan authoring phase** | |
| Agent connects and appears in ConnectedAgents widget | Terminal spawn → MCP register_session → UI widget updates |
| Agent creates plan via MCP → plan appears in Plans list | create_plan → plan-created broadcast → UI list row |
| Agent adds action items → items appear in item tree | add_item × N → plan-item-created → tree rows render |
| Agent adds plan doc → doc appears in plan workspace | add_plan_doc → plan-doc-created → doc tab content |
| Agent adds phase → phase appears in phase list | add_plan_phase → plan-phase-created → phase row |
| Terminal shows "PLAN_READY" → plan is fully authored | PTY output marker, all items/docs/phases exist via API |
| **Plan execution phase** | |
| Agent claims first task → "assigned" badge appears | claim_item → plan-item-claimed broadcast → UI badge |
| Agent reads affected file → file-read event in timeline | Read tool use → agent-event broadcast → Timeline tab row |
| Agent edits file → file-changed event + graph re-renders | Write tool → file watcher → broadcast → graph node update |
| Agent reports progress → progress bar updates | update_item_progress → plan-item-progress → UI bar |
| Agent marks task done → checkmark + next task auto-selected | update_item status=done → broadcast → UI checkmark |
| All tasks complete → plan completion summary appears | Terminal shows "ALL_TASKS_COMPLETE", PlanCompletionSummary renders |

#### `live-agent/preseeded-deviation.spec.ts` (~6 tests)

**Prompt D path**: pre-seeded plan, agent deliberately deviates.
Tests drift detection against a known, stable plan structure.

| Test | What it verifies |
|------|------------------|
| Pre-seed plan with 2 items via REST API | Plan exists with known scope before agent starts |
| Agent completes item 1 correctly → "satisfied" change | Item done, file edited as planned → green status |
| Agent skips item 2 → "missing" change detected | Plan expects edit to UserList.tsx, not touched |
| Agent edits unplanned file → "unexpected" change detected | db.py edited outside plan scope → red drift row |
| Drift badge shows unresolved count > 0 | Deviation count → drift-badge → number visible |
| Deviation rows render with correct severity colors | Red=unexpected, amber=missing, green=satisfied |

#### `live-agent/authored-deviation.spec.ts` (~8 tests)

**Prompt C path**: agent builds the plan itself, then deliberately
deviates during execution. Tests the full authoring + drift loop —
the plan the agent drifts from is also the plan the agent created.

| Test | What it verifies |
|------|------------------|
| **Plan authoring** | |
| Agent builds plan with 2 action items targeting specific files | create_plan + add_item × 2 → plan exists with known scope |
| Terminal shows "PLAN_READY" | Authoring complete marker |
| **Deliberate deviation during execution** | |
| Agent completes item 1 correctly → "satisfied" change | Item done, file edited as planned → green status |
| Agent skips item 2 → "missing" change detected | Plan expects edit to UserList.tsx, agent doesn't touch it |
| Agent edits unplanned file (db.py) → "unexpected" change | File edit outside plan scope → drift report shows unexpected |
| Drift badge shows unresolved count in plan header | Deviation count → drift-badge component → number > 0 |
| Deviation rows show all three severity states | satisfied (green), missing (amber), unexpected (red) |
| Accept deviation → row clears, count decreases | Click accept → reconcile → badge updates |

#### `live-agent/file-watcher-pipeline.spec.ts` (~5 tests)

Verifies the chokidar → tree-sitter → graph → WebSocket pipeline.

| Test | What it verifies |
|------|------------------|
| File edit triggers `file-changed` broadcast | Write to fixture file → chokidar detects → broadcast |
| New file triggers `file-added` broadcast + appears in sidebar | Create file → broadcast → sidebar git indicator "U" |
| Deleted file triggers `file-removed` broadcast + removed from graph | Delete → broadcast → node disappears |
| AST re-parse updates symbol count in inspector | Edit to add a function → re-scan → inspector shows new symbol |
| Cross-system edge updates when HTTP callsite added | Add fetch('/api/new') → cross-system-changed → new edge in graph |

#### `live-agent/multi-agent-contention.spec.ts` (~4 tests)

Two terminal sessions, two agents, same plan.

| Test | What it verifies |
|------|------------------|
| Two agents register → ConnectedAgents shows count=2 | Two register_session calls → widget shows "2" |
| Both claim same task → one wins, one gets conflict | Concurrent claim_item → conflict-detected broadcast |
| Conflict toast appears in UI | conflict-detected → toast notification renders |
| Agents can work different tasks concurrently | Agent A claims task 1, Agent B claims task 2 → both succeed |

#### `live-agent/visual-indicators.spec.ts` (~10 tests)

Screenshot-verified visual regression for status states.

| Test | What it verifies |
|------|------------------|
| Pending item → gray circle icon in item tree | Status icon rendering |
| In-progress item → blue spinner/arrow icon | Status icon rendering |
| Done item → green checkmark icon | Status icon rendering |
| Blocked item → red warning icon + reason banner | Status + banner text |
| Skipped item → gray strike-through icon | Status icon rendering |
| Plan node in graph has highlight ring (amber) | Graph overlay when plan active |
| Ghost node for planned-but-not-existing file | Dashed border, reduced opacity |
| File node shows git badge (M/U/A) with correct colors | Orange=modified, emerald=untracked, sky=staged |
| Agent type color in ConnectedAgents: Claude=amber | Agent widget color coding |
| Progress bar segments: done=green, in_progress=blue, blocked=red | Segmented progress bar colors |

#### `live-agent/claude-jsonl-watcher.spec.ts` (~4 tests)

Tests the Claude Code session JSONL watcher pipeline. Requires either
a real Claude Code session or a mock JSONL file.

| Test | What it verifies |
|------|------------------|
| JSONL watcher detects active Claude Code session | findActiveSession returns match for project path |
| Tool use entry in JSONL → agent-event broadcast | Write JSONL line → watcher parses → broadcast fires |
| File read events appear in Timeline tab | agent-event with action=read → Timeline row |
| File write events appear in Timeline tab | agent-event with action=write → Timeline row |

**Mock strategy**: Create a temp directory mimicking
`~/.claude/sessions/` and `~/.claude/projects/`, write a fake session
JSON + JSONL file, and point the watcher at the temp dir via an env
var `CLAUDE_CODE_DIR` override.

---

### 18. PARSER & CALLSITE VALIDATION (2 files, ~15 tests)

Unit-style E2E tests that scan the fixture repo and verify the parser
pipeline produces correct output. No browser needed.

```
e2e/
├── parsers/
│   ├── tree-sitter-languages.spec.ts — per-language parse verification
│   └── callsite-extractors.spec.ts   — HTTP/SQL/subprocess pattern matching
```

#### `parsers/tree-sitter-languages.spec.ts` (~8 tests)

Scans `tests/fixtures/sample-app/` and verifies symbol extraction.

| Test | What it verifies |
|------|------------------|
| TypeScript: extracts functions, interfaces, classes from .ts | Symbol count + names from types.ts |
| TSX: extracts React components from .tsx | Component names from UserList.tsx |
| JavaScript: extracts exports from .js | (add a .js fixture file) |
| Python: extracts functions, classes from .py | Symbol names from main.py, users.py |
| Import resolution: TS relative imports resolved | api.ts imports from shared → edge exists |
| Import resolution: workspace alias @sample/shared resolved | Alias → real path mapping |
| Cross-file dependency count matches expected | Known edge count for fixture |
| Sequential scan stability (no WASM crash under 20 files) | Scan all fixture files, no crash |

#### `parsers/callsite-extractors.spec.ts` (~7 tests)

Verifies pattern matching for cross-system coupling.

| Test | What it verifies |
|------|------------------|
| TS: fetch('/api/users') extracted as HTTP callsite | Pattern match on fetch() |
| TS: axios.get('/api/orders') extracted | Pattern match on axios |
| Python: @router.get('/api/users') extracted as HTTP endpoint | FastAPI decorator pattern |
| Python: requests.get() extracted as HTTP callsite | requests library pattern |
| Cross-system pairing: TS fetch ↔ Python route matched | Same path → edge created |
| SQL: CREATE TABLE extracted from .sql | SQL pattern match |
| subprocess: os.system() / exec() extracted | Subprocess pattern match |

---

### 19. WEBSOCKET EVENT DELIVERY (1 file, ~15 tests)

Verifies that all 44+ broadcast event types are actually delivered to
connected WebSocket clients with the correct payload shape.

```
e2e/
├── websocket/
│   └── broadcast-events.spec.ts     — event delivery + payload shape verification
```

#### `websocket/broadcast-events.spec.ts`

Strategy: Open a WebSocket connection to the backend, trigger each
event via the corresponding API call, verify the event arrives with
the expected `type` field and payload keys.

| Test | Events verified |
|------|----------------|
| Plan CRUD events | plan-created, plan-updated |
| Plan item events | plan-item-created, plan-item-updated, plan-item-deleted, plan-item-moved |
| Plan item lifecycle events | plan-item-claimed, plan-item-progress, plan-item-blocked, plan-item-version-saved |
| Plan item comment/attachment | plan-item-comment-added, plan-item-attachment-added |
| Plan doc events | plan-doc-created, plan-doc-updated, plan-doc-deleted |
| Plan phase events | plan-phase-created, plan-phase-updated, plan-phase-deleted |
| Plan file sync events | plan-exported, plan-imported, plan-unlinked, plan-template-published |
| Legacy task events | task-created, task-updated, task-claimed, task-progress, task-blocked |
| Legacy task comment/attachment | task-comment-added, task-attachment-added, task-attachment-removed |
| Comment events | comment-added, comment-deleted |
| External ref events | external-ref-added, external-ref-updated, external-ref-deleted |
| Conflict events | conflict-detected |
| Session events | mcp-session-changed |
| Settings events | settings-changed, mcp-port-config-changed |
| Terminal events | terminal-created, terminal-killed |
| Trellis events | trellis-captured |
| System events | update-available |

---

## Totals (Updated)

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
| api-coverage/ | 6 | ~40 |
| mcp-tools/ | 5 | ~39 |
| live-agent/ | 8 | ~57 |
| parsers/ | 2 | ~15 |
| websocket/ | 1 | ~15 |
| **Total** | **97** | **~491** |

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

**Wave 6 — API & MCP contract tests (no browser):**
api-coverage/, mcp-tools/

**Wave 7 — Live agent golden chains (full loop):**
live-agent/, parsers/, websocket/

---

## Wave 7 — Live Agent Testing Strategy

### Prerequisites

Before live-agent tests can run:

1. **Fixture repo** — `tests/fixtures/sample-app/` (already exists)
   with known file structure, import graph, and cross-system pairings.

2. **Terminal inject API** — `POST /api/terminals/:id/inject` (already
   exists) to pipe commands into a running PTY session.

3. **Claude Code availability** — Either Claude Code CLI installed on
   the test machine, OR a mock agent that responds to MCP tool calls
   in a scripted manner. CI uses the mock; local dev can use real
   Claude.

4. **Fixture reset** — `git checkout HEAD -- tests/fixtures/sample-app`
   in `beforeEach` to ensure clean state between tests.

5. **WebSocket test helper** — A utility that connects to the backend
   WS and collects broadcast events, with `waitForEvent(type, match)`
   for assertions.

### The inject-and-verify pattern

Every live-agent test follows the same structural pattern, but with
different setup and prompts depending on which quadrant of the 2×2
matrix it covers.

**Pre-seeded plan + normal execution (Prompt A):**

```typescript
test('agent executes pre-seeded plan end-to-end', async ({ page, request }) => {
  // 1. Open project (fixture repo) in the UI
  await gotoWithProject(page, FIXTURE_PATH);

  // 2. PRE-SEED the plan via REST API — agent doesn't author this one
  const { planUid, itemUids } = await harness.seedPlan({
    title: 'E2E Pre-seeded: Error Handling',
    items: [
      {
        title: 'Add try-catch to API fetch calls',
        body: 'Wrap the fetch() calls in api.ts with try-catch blocks',
        fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
      },
      {
        title: 'Add error boundary to UserList',
        body: 'Add React error boundary wrapper to UserList.tsx',
        fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
      },
    ],
    doc: { title: 'Error Handling Improvement', body: 'Adds error handling.' },
    phase: { title: 'Phase 1: Core error handling', number: 1 },
  });

  // 3. Verify plan is visible in UI before agent starts
  await expect(page.locator('text=E2E Pre-seeded: Error Handling')).toBeVisible();

  // 4. Spawn terminal, inject Prompt A — "find this plan and execute it"
  const termId = await harness.spawnAgent(FIXTURE_PATH);
  await harness.inject(termId, PROMPT_A);  // "list_plans, find it, execute it"

  // 5. Wait for execution
  await wsHelper.waitForEvent('plan-item-updated', { status: 'done' }, 60_000);
  await harness.waitForOutput(termId, 'ALL_TASKS_COMPLETE', 120_000);

  // 6. Verify all items done
  const items = await (await request.get(`/api/plans/${planUid}/items`)).json();
  expect(items.every((i: any) => i.status === 'done')).toBe(true);
  await expect(page.locator('[data-testid="item-status-done"]')).toBeVisible();

  await harness.cleanup(termId);
});
```

**Agent-authored plan + normal execution (Prompt B):**

```typescript
test('agent authors and executes plan end-to-end', async ({ page, request }) => {
  // 1. Open project — NO pre-seeding, plan list should be empty
  await gotoWithProject(page, FIXTURE_PATH);

  // 2. Spawn terminal, inject Prompt B — "build this plan, then execute it"
  const termId = await harness.spawnAgent(FIXTURE_PATH);
  await harness.inject(termId, PROMPT_B);

  // 3. Wait for plan AUTHORING to complete
  await wsHelper.waitForEvent('plan-created', {}, 30_000);
  await wsHelper.waitForEvent('plan-item-created', {}, 10_000);
  await wsHelper.waitForEvent('plan-doc-created', {}, 10_000);
  await wsHelper.waitForEvent('plan-phase-created', {}, 10_000);
  await harness.waitForOutput(termId, 'PLAN_READY', 60_000);

  // 4. Verify the agent-authored plan appeared in the UI
  await expect(page.locator('text=E2E Agent-Authored: Error Handling')).toBeVisible();
  const plans = await (await request.get('/api/plans')).json();
  const plan = plans.find((p: any) => p.title === 'E2E Agent-Authored: Error Handling');
  expect(plan).toBeTruthy();

  // 5. Verify items, doc, phase exist — all created by the agent
  const items = await (await request.get(`/api/plans/${plan.uid}/items`)).json();
  expect(items.length).toBe(2);
  const docs = await (await request.get(`/api/plans/${plan.uid}/docs`)).json();
  expect(docs.length).toBeGreaterThanOrEqual(1);

  // 6. Wait for EXECUTION to complete
  await wsHelper.waitForEvent('plan-item-updated', { status: 'done' }, 60_000);
  await harness.waitForOutput(termId, 'ALL_TASKS_COMPLETE', 120_000);

  // 7. Verify completion
  await expect(page.locator('[data-testid="item-status-done"]')).toBeVisible();

  await harness.cleanup(termId);
});
```

### Deviation test patterns

Both deviation specs share the same assertion tail — the difference
is how the plan gets created.

**Pre-seeded plan deviation (Prompt D):**

```typescript
test('pre-seeded plan: agent deviates → drift detected', async ({ page, request }) => {
  await gotoWithProject(page, FIXTURE_PATH);

  // Plan exists before agent starts
  const { planUid } = await harness.seedPlan({
    title: 'E2E Pre-seeded: Error Handling',
    items: [
      { title: 'Edit api.ts', body: '...', fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }] },
      { title: 'Edit UserList.tsx', body: '...', fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }] },
    ],
  });

  const termId = await harness.spawnAgent(FIXTURE_PATH);
  await harness.inject(termId, PROMPT_D);  // "find plan, execute with deviations"

  // ...shared assertion tail (see below)
});
```

**Agent-authored plan deviation (Prompt C):**

```typescript
test('agent-authored plan: agent deviates → drift detected', async ({ page, request }) => {
  await gotoWithProject(page, FIXTURE_PATH);

  // No pre-seeding — agent creates the plan itself
  const termId = await harness.spawnAgent(FIXTURE_PATH);
  await harness.inject(termId, PROMPT_C);  // "build plan, then deviate"

  // Wait for authoring
  await wsHelper.waitForEvent('plan-created', {}, 30_000);
  await harness.waitForOutput(termId, 'PLAN_READY', 60_000);
  const plans = await (await request.get('/api/plans')).json();
  const planUid = plans.find((p: any) => p.title.includes('Agent-Authored')).uid;

  // ...shared assertion tail (see below)
});
```

**Shared assertion tail (both tests):**

```typescript
// Wait for partial execution + deviation marker
await wsHelper.waitForEvent('plan-item-updated', { status: 'done' }, 60_000);
await harness.waitForOutput(termId, 'DEVIATION_COMPLETE', 120_000);

// Trigger drift detection
await request.post(`/api/plans/${planUid}/detect-deviations`);

// Verify drift badge shows unresolved count > 0
await expect(page.locator('[data-testid="drift-badge"]')).toContainText(/[1-9]/);

// Verify all three deviation states rendered:
// ✅ satisfied (api.ts edited as planned) → green
// ⚠️ missing (UserList.tsx never touched) → amber
// 🔴 unexpected (db.py edited outside plan) → red
await expect(page.locator('[data-testid="deviation-row-unexpected"]')).toBeVisible();
await expect(page.locator('[data-testid="deviation-row-missing"]')).toBeVisible();

const unexpected = page.locator('[data-testid="deviation-row-unexpected"]');
await expect(unexpected).toHaveCSS('border-left-color', /red|rgb\(239/);

const missing = page.locator('[data-testid="deviation-row-missing"]');
await expect(missing).toHaveCSS('border-left-color', /amber|rgb\(245/);

// Screenshot for visual regression
await page.screenshot({ path: 'screenshots/deviation-detected.png' });

await harness.cleanup(termId);
```

### Mock agent fallback (CI without Claude Code)

For CI environments without Claude Code installed, the mock agent
connects via MCP and makes the same tool calls Claude would — just
scripted. Two modes mirror the two plan origins:

```typescript
// e2e/live-agent/helpers/mock-agent.ts

/**
 * Mock agent that AUTHORS a plan via MCP then executes it.
 * Mirrors Prompt B (agent-authored flow).
 */
export async function runMockAgentAuthored(fixture: string) {
  const client = await createMcpClient();

  await client.callTool('register_session', {
    agent_type: 'mock-test',
    agent_model: 'harness/1.0',
    project_path: fixture,
  });

  // ── Author the plan (same calls real Claude would make) ──

  const planResult = await client.callTool('create_plan', {
    tasks: [],
    title: 'E2E Agent-Authored: Error Handling',
    project_path: fixture,
  });
  const planUid = JSON.parse(planResult.content[0].text).uid;

  await client.callTool('set_active_plan', { plan_uid: planUid });

  const item1 = await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'action',
    title: 'Add try-catch to API fetch calls',
    body: 'Wrap the fetch() calls in api.ts with try-catch blocks',
    file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
  });
  const item1Uid = JSON.parse(item1.content[0].text).uid;

  const item2 = await client.callTool('add_item', {
    plan_uid: planUid,
    kind: 'action',
    title: 'Add error boundary to UserList',
    body: 'Add React error boundary wrapper to UserList.tsx',
    file_specs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
  });
  const item2Uid = JSON.parse(item2.content[0].text).uid;

  await client.callTool('add_plan_doc', {
    plan_uid: planUid,
    doc_type: 'executive',
    title: 'Error Handling Improvement',
    body: 'This plan adds error handling to the web frontend.',
  });

  await client.callTool('add_plan_phase', {
    plan_uid: planUid,
    title: 'Phase 1: Core error handling',
    phase_number: 1,
  });

  // ── Execute ──
  await executePlanItems(client, fixture, [item1Uid, item2Uid]);

  client.close();
  return planUid;
}

/**
 * Mock agent that EXECUTES a pre-seeded plan.
 * Mirrors Prompt A (pre-seeded flow).
 */
export async function runMockAgentPreseeded(fixture: string, planUid: string) {
  const client = await createMcpClient();

  await client.callTool('register_session', {
    agent_type: 'mock-test',
    agent_model: 'harness/1.0',
    project_path: fixture,
  });

  await client.callTool('set_active_plan', { plan_uid: planUid });

  // Work through items using get_next_item (same as Prompt A)
  let next = await client.callTool('get_next_item', { plan_uid: planUid });
  while (next?.content?.[0]?.text) {
    const item = JSON.parse(next.content[0].text);
    if (!item?.uid) break;
    await executeSingleItem(client, fixture, item.uid);
    next = await client.callTool('get_next_item', { plan_uid: planUid });
  }

  client.close();
}

/** Shared: claim → edit → progress → done for one item. */
async function executeSingleItem(client: McpClient, fixture: string, itemUid: string) {
  await client.callTool('claim_item', {
    item_uid: itemUid,
    agent_id: 'mock-agent',
    agent_type: 'test',
  });

  const item = await client.callTool('get_item', { item_uid: itemUid });
  const parsed = JSON.parse(item.content[0].text);
  for (const spec of parsed.fileSpecs || []) {
    fs.appendFileSync(
      path.join(fixture, spec.path),
      `\n// Modified by mock agent at ${Date.now()}\n`
    );
  }

  await client.callTool('update_item_progress', {
    item_uid: itemUid, percent: 100, message: 'Complete',
  });

  await client.callTool('update_item', {
    item_uid: itemUid, status: 'done',
  });
}

async function executePlanItems(client: McpClient, fixture: string, uids: string[]) {
  for (const uid of uids) await executeSingleItem(client, fixture, uid);
}
```

### Environment detection

Each test supports both real Claude and mock agent, with the same
assertions either way. The `CODETRELLIS_REAL_AGENT` env var controls
which path runs:

```typescript
const USE_REAL_CLAUDE = process.env.CODETRELLIS_REAL_AGENT === '1';

// ── Agent-authored path (Prompt B) ──
test('agent-authored: full plan lifecycle', async ({ page, request }) => {
  let planUid: string;

  if (USE_REAL_CLAUDE) {
    const termId = await harness.spawnAgent(FIXTURE_PATH);
    await harness.inject(termId, PROMPT_B);
    await wsHelper.waitForEvent('plan-created', {}, 30_000);
    planUid = await getPlanUidByTitle(request, 'E2E Agent-Authored: Error Handling');
    await harness.waitForOutput(termId, 'ALL_TASKS_COMPLETE', 120_000);
    await harness.cleanup(termId);
  } else {
    planUid = await runMockAgentAuthored(FIXTURE_PATH);
  }

  // Same assertions — plan was authored + executed by agent
  const items = await (await request.get(`/api/plans/${planUid}/items`)).json();
  expect(items.every((i: any) => i.status === 'done')).toBe(true);
  expect(items.length).toBe(2);
  const docs = await (await request.get(`/api/plans/${planUid}/docs`)).json();
  expect(docs.length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-testid="item-status-done"]')).toBeVisible();
});

// ── Pre-seeded path (Prompt A) ──
test('pre-seeded: agent executes existing plan', async ({ page, request }) => {
  // Seed the plan before the agent starts
  const { planUid } = await harness.seedPlan({
    title: 'E2E Pre-seeded: Error Handling',
    items: [
      { title: 'Edit api.ts', body: '...', fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }] },
      { title: 'Edit UserList.tsx', body: '...', fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }] },
    ],
  });

  if (USE_REAL_CLAUDE) {
    const termId = await harness.spawnAgent(FIXTURE_PATH);
    await harness.inject(termId, PROMPT_A);
    await harness.waitForOutput(termId, 'ALL_TASKS_COMPLETE', 120_000);
    await harness.cleanup(termId);
  } else {
    await runMockAgentPreseeded(FIXTURE_PATH, planUid);
  }

  // Same assertions — plan items should all be done
  const items = await (await request.get(`/api/plans/${planUid}/items`)).json();
  expect(items.every((i: any) => i.status === 'done')).toBe(true);
  await expect(page.locator('[data-testid="item-status-done"]')).toBeVisible();
});
```

### Visual regression baselines

Live-agent tests capture screenshots at key moments:

| Moment | Filename | What it captures |
|--------|----------|------------------|
| Agent connected | `agent-connected.png` | ConnectedAgents widget showing 1 agent |
| Task claimed | `task-claimed.png` | Item tree with "assigned" badge |
| Progress 50% | `progress-halfway.png` | Progress bar at 50% |
| Task done | `task-done.png` | Green checkmark on item |
| Deviation detected | `deviation-detected.png` | Drift badge + deviation rows |
| Plan complete | `plan-complete.png` | Completion summary panel |
| Graph with plan overlay | `graph-plan-overlay.png` | Highlight rings on planned files |
| Ghost node | `ghost-node.png` | Dashed border for planned-but-not-existing file |

These are stored in `e2e/screenshots/baselines/` and compared via
`expect(screenshot).toMatchSnapshot()` with a configurable threshold.

---

## Remaining Gaps (honest assessment)

After all waves are implemented, these areas would still lack coverage:

| Area | Risk | Reason |
|------|------|--------|
| Electron wrapper | Low | Untested on macOS 26 (SIGKILL bug). Desktop-only concern. |
| Performance under load | Medium | No benchmarks for large repos (10k+ files). |
| Browser cross-matrix | Low | Only Chromium tested. Firefox/Safari not core targets. |
| Real LLM reasoning quality | N/A | Out of scope — we test plumbing, not AI judgment. |
| Offline / network failure modes | Low | Desktop scenario, not web service. |
