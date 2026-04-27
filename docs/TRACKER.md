# Implementation Tracker

Last updated: 2026-04-27
Supersedes: `CODE-GRAPH-CHECKLIST.md`, `IMPLEMENTATION-PHASES.md`, `GAP-ANALYSIS.md` (consolidated here)

This is the running source of truth for what CodeTrellis ships, what's
in flight, and what's still missing — in one place. Vision and design
docs ([CORE-VISION.md](CORE-VISION.md), [THREE-TRELLIS.md](THREE-TRELLIS.md),
[CLUSTER-FIRST-VISION.md](CLUSTER-FIRST-VISION.md),
[GRAPH-UX-REFINEMENT.md](GRAPH-UX-REFINEMENT.md),
[DATA-MODEL.md](DATA-MODEL.md), [MCP-INTEGRATION.md](MCP-INTEGRATION.md),
[UI-DESIGN.md](UI-DESIGN.md), [ARCHITECTURE.md](ARCHITECTURE.md))
remain canonical for *what* and *why*; this doc is for *where things
stand*.

---

## 0. Architecture Note

Running in web mode (Express :3001 + Vite :5173) due to macOS 26
Electron SIGKILL bug. Electron wrapper exists but is untested. Code is
shared via the bridge abstraction.

---

## 1. Domain Status (rough completion against [CORE-VISION.md](CORE-VISION.md))

| Domain | % | Quality | Key state |
|---|---|---|---|
| Data Model & Types | 100 | High | Plan, Task, Comment, PlanDocument, ProjectionData, Trellis snapshots all typed |
| Database Persistence | 100 | Good | sql.js with file export — survives restarts |
| AST Parsing (7 langs) | 100 | High | TS/TSX/JS/JSX, Python, Rust, PHP, Java — all with proper per-language symbol AND import extraction via the plugin architecture (parsers/ + resolvers/). Go and SQL pending. |
| Multi-System Ingestion | 70 | High | Phase 1 + 2 + plugin refactor done. Real swf scan: 2552 edges (1688 Py + 591 tsx + 273 ts), 13 systems discovered, all `@swf/*` aliases resolve, services/realtime + backend/fastapi visible. Remaining: systems DB + UI, cross-system links, server-side per-scope views. |
| MCP Server | 100 | High | 24 tools across architecture queries / plans / tasks / spec docs / comments / sessions / drift / trellis snapshots |
| Claude Code Watcher | 100 | High | Tails session JSONL, extracts tool calls + plan heuristics |
| Generic MCP-agent activity | 0 | – | MCP tool calls don't surface in Timeline; only Claude Code does. Top of front-to-back gap list. |
| Plan CRUD + Comments + Versions | 95 | Good | Missing: version viewer UI; task-level comments. Phase 12 will add explicit Phases entity + Proposed Changes view + plan templates so plans can scale from light (one-line title) to deep (swf-style multi-phase migration). |
| Spec Room (typed plan docs) | 100 | High | 12 doc types, MCP + REST + UI + version history + restore + Phase 12 §C orderHint + parentDocUid (swf-style `00-…/01-…` nesting; tree-rendered in the spec room). |
| Agent skill / instructions resource | 100 | High | Phase 12 §E shipped. Three MCP resources: `codetrellis://skill` (project-tailored summary), `…/quickstart` (first-time flow), `…/power-user` (deep usage). Markdown-only so any MCP-capable agent can ingest. |
| Multi-agent visibility (TopBar) | 100 | High | Phase 12 §D2 shipped. `ConnectedAgents` widget replaces the single-agent pill; popover shows every active MCP session (type, model, active plan, last seen) and refreshes live on session events. `register_session` / `set_active_plan` keyed off the caller's transport sessionId. |
| Three Trellis States | 85 | Medium | Snapshots + projection + baseline pin/auto/branch — modes don't yet read as visually unmistakable |
| Architecture Diffing | 90 | High | File-level + edge-level drift; per-line git annotations; pluggable plan scope |
| Inspector + Code Viewer | 100 | High | Cluster/file/symbol routing + Prism syntax highlighting + git gutter + drift coloring + selection-to-task |
| Graph Visualization | 75 | Medium | Glassmorphic nodes, curved edges, cluster discovery, selection emphasis, per-system scope filter, files-view no longer hides files silently, regular edges no longer animated (perf fix). **Missing: node-level drift ring, semantic zoom, mode visual distinctness, system-aware clustering, server-side per-scope views.** |
| Real-time Activity Visualization | 60 | Medium | recently-changed pulse + edge drift; node drift not yet wired |
| Toast Notifications | 100 | Good | Wired to plans, tasks, deviations, conflicts, sessions, plan-doc events |
| Deviation Detection | 75 | Medium | Service + MCP tools + file-watcher hook; needs more detection types and graph surfacing |
| Conflict Detection | 70 | Medium | File-level conflict on claim_task with broadcast |
| Onboarding | 100 | High | Welcome + recent projects + Getting Started checklist |
| Multi-tab projects | 100 | Good | Open multiple projects/worktrees as TopBar tabs |
| Visual Plan Builder | 35 | Medium | "Add to plan" from the inspector exists; clicking nodes-on-graph to author isn't wired |
| Multi-Agent Dashboard | 0 | – | Not started |

---

## 2. Recently Shipped

### Apr 27, 2026 — Multi-System Ingestion + perf

- **Multi-system ingestion (Phase 1 + 2)**: opening a real mixed-language repo (swf) now produces **2552 edges** including 1688 Python, 314 into workspace packages — was 597 edges TS-only before this sprint.
- **System discovery**: 13 systems detected from any manifest (`package.json`, `pyproject.toml`, `setup.py`, `requirements.txt`, `Cargo.toml`, `go.mod`, `composer.json`, `pom.xml`, `build.gradle`, `Gemfile`, standalone `tsconfig.json`).
- **Workspace alias resolution**: `@swf/ui` etc. now resolve dynamically from every `package.json` in the repo + `tsconfig.json` `paths`.
- **Modular parser/resolver plugin architecture**: each language is one file in `parsers/` + `resolvers/`. Adding a language = drop two files. No core changes.
- **Per-language extraction**: Python (`import_statement` + `import_from_statement` + relative + aliased + project-anchored absolute), Rust (`use_declaration` + crate / self / super / sibling-crate), PHP (`namespace_use_declaration` + PSR-4 from `composer.json`), Java (`import_declaration` + standard source roots).
- **Proper `.gitignore` semantics**: `ignore` npm package — globs, negation (`!path`), nested .gitignore inheritance. Plus optional `.codetrellis-ignore` per-directory override.
- **Heavy non-source dirs ignored** (venv / env / build / vendor / target / __pycache__ / coverage / test-results / playwright-report / cypress) — stops drowning the scanner.
- **Per-project AST scoping**: `clearAstData()` on every scan. Switching projects no longer leaves stale rows or unioned search results.
- **EMFILE survival in file watcher**: function-based ignore predicate; backend stays alive even when chokidar can't watch every file in a giant repo.
- **`/api/diff` regression fix**: was re-parsing all 2k+ files every 10s AND wiping every workspace-aliased + Python edge each cycle. Now reads from DB. 30s → 193ms.
- **Graph scope filter**: top-right of canvas — pick any discovered system to filter the graph to that subtree. Stops RAM blow-up on big repos.
- **Files-depth view stops hiding files**: when scoped, shows every file (no threshold, no cap). Unscoped: threshold 3→2, cap 40→200.
- **Edge animation perf**: regular edges no longer animated (~5000 SVG animations per frame killed pan/zoom). Motion only on `active` and `planned_add` edges where it conveys meaning.
- **System discovery REST**: `GET /api/systems?project=...` returns all detected systems for a project.

### Apr 23–26, 2026 — Architectural authoring tool

This sprint focused on making CodeTrellis usable as an *architectural
authoring* tool, not just a viewer: agents and humans co-author plans
+ spec docs, the inspector becomes a code-level surface for marking
changes, and drift is visible at the node, edge, and code-line level.

- **Plan + Task data model** with versioning, comments, deviation tracking
- **MCP plan + spec API** — agents create plans, attach typed spec docs
  (executive_summary / architecture / patterns / examples / research /
  testing / security / ux_ui / constraints / acceptance_criteria /
  rollout / custom), fetch them granularly without bloating context
- **Spec Room UI** — markdown viewer + editor with version history and
  restore
- **Three Trellis states** (baseline / live / planned / diff) with
  pin / auto-track / branch baseline selection
- **Kind-aware Inspector** — cluster click shows files, file click shows
  imports / symbols / source code, symbol click shows scoped code slice
- **Code viewer** — Prism syntax highlighting (nightOwl), git per-line
  gutter (+/~ markers), drift status border + clickable badge with plan
  picker, line selection → "Add to plan" with three modes (existing
  task, new task, new plan)
- **Drift visualization** at three layers:
  - Per-file (inspector badge + colored border, plan-pickable)
  - Per-edge (planned_add / added / unexpected / planned_remove distinct)
  - Per-line code annotations (git-driven; plan-aware drift is file-level for now)
- **Recent projects + Getting Started** onboarding state API and checklist
- **Branch baseline picker** — click any branch in the TopBar popover
  to pin its HEAD as the diff baseline
- **Cluster discovery** — 3-phase (path-seed → dependency-refine →
  singleton-merge), full file list now exposed on cluster nodes for
  inspector drill-in
- **Multi-tab project support** with worktree opening from BranchPopover
- **Auto-track HEAD bug fixed** — sidebar/canvas no longer carry stale
  dirty markers for ~30s after a commit
- **Modal portal fixes** — PlanCreateModal / SpecDocViewer /
  SpecDocCreateModal / AddToTaskPopover all escape glass-panel
  containing block via createPortal
- **File watcher fix** — re-parses .py / .rs / .php / .java in addition
  to TS/JS so non-JS edits actually update the dependency graph

---

## 3. Phase Status

The original `IMPLEMENTATION-PHASES.md` defined Phases 1–6 with goals +
verification. Phases 7–10 were added as we discovered the product is
more than what those original phases captured. Each phase keeps its
original *Goal* and *Verification* criteria so they stay testable.

### Phase 1 — Foundation
**Goal:** Electron app launches, shows a shell layout, can open a project
and display its structure.
**Status: DONE**

| Task | Status | Notes |
|------|--------|-------|
| Scaffold (Vite + React 19 + TS) | ✅ | Web mode via Express + Vite |
| Tailwind CSS 4 + dark theme | ✅ | Custom theme vars in globals.css |
| Shell layout (Sidebar, TopBar, Canvas, Inspector, PlanPanel, StatusBar) | ✅ | All panels render |
| Resizable panels | ✅ | Allotment wired; PlanPanel + Inspector also have programmatic expand toggles |
| Typed bridge abstraction | ✅ | HTTP bridge for web, Electron stub exists |
| ProjectScanner + .gitignore | ✅ | Recursive scan, respects .gitignore |
| MonorepoDetector | ✅ | npm / pnpm / nx / turbo detection |
| SQLite database | ✅ | sql.js, persisted snapshot survives restarts |
| Zustand stores | ✅ | graph, agent, project, plan, ui, toast |
| Shared types | ✅ | Plan, Task, Comment, PlanDocument, ProjectionData, etc. |
| Project open dialog | ✅ | Folder picker modal with server-side directory browser |
| File tree sidebar | ✅ | Per-file git status markers |
| Multi-tab projects | ✅ | Open multiple projects/worktrees as TopBar tabs |

**Verification (current):** App opens with dark theme; open a project →
sidebar shows tree; resizable panels work; status bar shows project info.

### Phase 2 — AST Engine
**Goal:** Parse source files to function/class level, persist in SQLite,
search symbols.
**Status: DONE (core); optimization deferred.**

| Task | Status | Notes |
|------|--------|-------|
| Tree-sitter WASM setup | ✅ | web-tree-sitter in backend |
| TS / TSX / JS / JSX grammars | ✅ | |
| Python / Rust / PHP / Java grammars | ✅ | |
| Symbol extraction | ✅ | functions, classes, methods, interfaces, types, enums |
| Import / export extraction | ✅ | Specifiers extracted |
| Import resolution (paths, aliases) | ✅ | Resolves relative + @shared alias |
| SQLite persistence | ✅ | files, symbols, imports tables populated |
| Symbol search | ✅ | LIKE-based |
| FileWatcher (chokidar) | ✅ | Re-parses TS/JS/Python/Rust/PHP/Java on change |
| Dependency graph API | ✅ | GET /api/dependencies |
| File dependency API | ✅ | GET /api/dependencies/file?path= |
| File content API | ✅ | GET /api/file/content with optional language detect, git per-line annotations, plan drift status, line-range slicing |
| Incremental parsing (tree-sitter edit deltas) | ⏸ | DEFERRED — full re-parse on change |
| Worker pool | ⏸ | DEFERRED — synchronous parsing |
| Parse progress reporting | ⏸ | DEFERRED |

**Verification (current):** TS project parses; symbol search returns
results; edit a file externally → re-parsed automatically.
**Open verification:** Large repo (500+ files) parses without freezing
the main thread — see Phase 6 perf pass.

### Phase 3 — Graph Visualization
**Goal:** Interactive ReactFlow graph showing codebase architecture at
multiple depths.
**Status: DONE (core); polish + drift surfacing in progress.**

| Task | Status | Notes |
|------|--------|-------|
| ReactFlow integration | ✅ | |
| Custom nodes (Package / Directory / File / Symbol) | ✅ | Glassmorphic, variable-sized cluster cards |
| Custom edges (ImportEdge with state-aware visuals) | ✅ | regular / planned_add / planned_remove / added / removed / **unexpected** / active / symbol_link with animated flow dots |
| Cluster discovery (3-phase) | ✅ | path inference → dependency refinement → singleton merge |
| Cluster file list on node data | ✅ | Inspector reads `data.files` to drill into a cluster |
| GraphBuilder | ✅ | buildClusterView, buildHubView, buildFocusView |
| dagre + force layouts | ✅ | Tree mode + Map mode (default) |
| Expand / collapse | ✅ | Click ▶/▼ on nodes |
| Depth selector (Clusters / Files / Symbols) | ✅ | TopBar segmented control + Cmd+1/2/3 |
| Minimap + zoom controls | ✅ | |
| Click sidebar → focus graph | ✅ | Sets selectedNodeId, canvas reflects |
| Click graph → inspector content routing | ✅ | cluster / file / symbol / directory / ghost kinds |
| Edge drift visualization | ✅ | live × planned cross-product computed correctly |
| Auto-fit on initial render | ✅ | |
| Export graph as PNG | ✅ | Top-right of canvas |
| **Node-level drift ring** | ❌ | Same backend data we already use for inspector badge — needs node visual |
| Filter bar | ❌ | |
| Semantic zoom (cluster → file → symbol via zoom level) | ❌ | Currently a discrete depth toggle |

**Verification (current):** Cluster view shows clusters with dependency
edges; expanding shows children; layout is clean; smooth pan/zoom.

### Phase 4 — Agent Integration
**Goal:** Monitor agent activity in real-time, display plans and events.
**Status: DONE (Claude Code); generic MCP-agent timeline pending.**

| Task | Status | Notes |
|------|--------|-------|
| ClaudeCodeWatcher | ✅ | Scans ~/.claude/sessions/, finds active sessions by PID |
| Session correlation | ✅ | Matches session cwd to monitored project |
| Extract tool calls from JSONL | ✅ | Reads, Writes, Edits, Bash, Glob, Grep |
| Plan extraction (heuristic) | ✅ | Numbered + bullet lists |
| AgentEventBus → frontend | ✅ | WebSocket broadcasts events |
| Agent panel: timeline | ✅ | Inside PlanPanel as a tab |
| Agent panel: changes tab | ✅ | File writes/edits |
| Status bar agent indicator | ✅ | |
| MCP server | ✅ | SSE on localhost:19432, auto-starts |
| MCP guide modal + Connect Agent button | ✅ | |
| Recently-changed pulse on graph | ✅ | Via agent-store recentlyChangedFiles |
| **Generic MCP-agent timeline** | ❌ | Currently only Claude Code shows in Timeline; MCP tool calls don't surface — Codex/Cursor/aider don't appear |

**Verification (current):** Start Claude Code in a monitored project →
events appear in timeline; agent edits a file → file pulses; report a
plan via MCP → plan appears.
**Open verification:** Same flow with a non-Claude-Code MCP agent.

### Phase 5 — Architecture Diffing
**Goal:** Show before/after architectural impact of agent changes.
**Status: DONE (multi-layer).**

| Task | Status | Notes |
|------|--------|-------|
| Snapshot capture | ✅ | Files (with hashes) + edges at scan time |
| Auto-snapshot on scan | ✅ | Baseline set when project is opened |
| DiffEngine | ✅ | Computes added/removed/modified files and edges |
| Color-coded graph overlay | ✅ | Green=added, Orange=modified, Red=removed |
| Blast radius | ✅ | |
| Diff polling | ✅ | Frontend polls /api/diff every 10s |
| Pause / check now / interval controls | ✅ | |
| Diff summary panel | ✅ | Top-left of canvas; on-track / planned / pending / unexpected counts |
| Plan-vs-live edge state | ✅ | planned_add / added / unexpected / planned_remove distinct |
| Per-line git annotations | ✅ | /api/file/content returns per-line 'unchanged'/'added'/'modified' |
| File-level drift status | ✅ | /api/file/content returns drift {status, comparedAgainstPlanUid, comparedAgainstPlanTitle} |
| Drift plan picker (per-session override) | ✅ | ui-store.driftComparePlanUid; popover on the inspector badge |
| **Diff mode auto-shows projection** | ❌ | Currently still requires Projection toggle |
| **Per-line plan-aware drift** | ❌ | Drift is file-level; line-level requires plans to specify line ranges |
| Snapshot timeline (scrub past states) | ⏸ | DEFERRED |
| Before/after split view | ⏸ | DEFERRED |

### Phase 6 — Polish & Branding
**Status: DONE (practical items).**

| Task | Status | Notes |
|------|--------|-------|
| Rename to CodeTrellis | ✅ | |
| App icon + branding | ✅ | |
| Welcome screen | ✅ | With recent-projects list (pinned-first) |
| Lucide icons everywhere | ✅ | |
| Keyboard shortcuts | ✅ | Cmd+O, Cmd+1/2/3, Cmd+B, Cmd+J, Escape |
| Error boundaries | ✅ | React ErrorBoundary wraps App |
| Toast notifications | ✅ | Plan-created, task-claimed/updated, deviation, conflict, session, plan-doc events |
| Performance pass (large repos) | ⏸ | DEFERRED — works at current scale |
| Auto-update | 🚫 | BLOCKED — macOS 26 Electron bug |
| DMG / installer | 🚫 | BLOCKED — macOS 26 Electron bug |

### Phase 7 — Plan + Spec Authoring
**Goal:** Agents and humans co-author plans with structured context.
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| Plan tables (plans, plan_versions, tasks) | ✅ | Auto-versioned on update |
| Plan service CRUD | ✅ | createPlan, getPlan, updatePlan, listPlans, claimTask, updateTask (full field set), getNextTask |
| `appendTaskCodeReference` / `appendTaskToPlan` | ✅ | Used by inspector "Add to plan" flow |
| Comments table + service | ✅ | Threaded; typed (comment / suggestion / approval / concern / status_update) |
| Deviation detection service | ✅ | checkFileDeviation hooks into file watcher |
| Plan REST API | ✅ | Full surface — see §8 |
| Plan UI: list + detail + create modal | ✅ | |
| Spec docs table (plan_documents + plan_document_versions) | ✅ | Auto-versioned on body change |
| Spec docs service | ✅ | CRUD + version history + search with excerpts |
| Spec docs REST API | ✅ | Full surface — see §8 |
| Spec docs MCP tools | ✅ | add / update / get / list / search_plan_doc |
| Spec doc taxonomy + UI | ✅ | 12 canonical types with icons + chip colors |
| Spec doc viewer (markdown + version history + restore) | ✅ | Portaled modal |
| Spec doc create modal (type picker grid + starter skeletons) | ✅ | |
| **Plan templates** | ❌ | Common shapes (refactor / new feature / bug fix / migration) |
| **Plan-task progress auto-detection** | ❌ | Auto-advance task to in_progress when its affected files change |
| **Task-level comments** | ❌ | Plan-level only today |
| **Plan version viewer UI** | ❌ | API exists; no UI |

**Plan task fields (full data model):** `description` (required) ·
`affectedFiles[]` · `affectedSymbols[]` · `newConnections[]` ·
`removedConnections[]` · `dependencies[]` · `fileSpec` (markdown — file
responsibility, exports, code references via "Add to plan") ·
`symbolSpecs[]` (per-symbol intent: name, kind, action add/modify/
remove/move, signature, moveTo) · `status`, `assignee`, `assigneeType`,
`assigneeModel`.

### Phase 8 — Three Trellis State System
**Goal:** Render baseline / live / planned simultaneously and surface drift.
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| TrellisMode type | ✅ | 'current' \| 'planned' \| 'live' \| 'diff' |
| Trellis snapshot table + service | ✅ | trellis_snapshots; capture / list / diff / get |
| Snapshot REST API | ✅ | POST /api/trellis/capture; GET /api/trellis/snapshots, /:id, /:id/diff |
| Snapshot MCP tool | ✅ | capture_checkpoint |
| Baseline pin / auto-track HEAD / pin to commit | ✅ | TopBar canvas chrome |
| Baseline pin to a branch tip | ✅ | Branch popover row click → captureBaselineFromBranch |
| Auto-track HEAD: detect new commit + auto-recapture baseline | ✅ | Refactored after stale-dirty bug |
| Recent commits dropdown | ✅ | Cached per project |
| Mode selector chrome (Live / Baseline / Planned / Diff) | ✅ | |
| Projection service | ✅ | computeProjection(planUid) → ghostFiles / modifiedFiles / removedFiles / newEdges / removedEdges |
| Projection toggle | ✅ | Auto-enables when active plan is set |
| **Mode visual distinctness** | ❌ | Modes work but don't read as visually unmistakable (Immediate Focus #1) |

### Phase 9 — Inspector + Code Viewer
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| Kind-aware Inspector | ✅ | cluster / file / symbol / directory / ghost routing from MainCanvas onNodeClick |
| Cluster view | ✅ | Name, description, file list (each clickable to drill into file view) |
| File view | ✅ | Path, "View source" button, symbols, imports, importedBy (each clickable) |
| Symbol view | ✅ | Breadcrumb back to file, scoped code slice with start-line highlight |
| Inspector expand toggle | ✅ | Programmatic Allotment resize; ~55% of viewport when expanded |
| Code preview component | ✅ | Standalone in components/inspector/CodePreview.tsx |
| Syntax highlighting | ✅ | prism-react-renderer + nightOwl theme; auto-detected language from extension |
| Per-line git gutter | ✅ | + (added) / ~ (modified) markers, color-coded |
| Drift status visualization | ✅ | Outer border color + clickable badge with plan picker popover |
| Line selection (single + shift-extend) | ✅ | Selection bar appears with "Add to plan" / "Clear" |
| "Add to plan" flow | ✅ | AddToTaskPopover with three modes (existing task / new task / new plan) |
| Code reference appended to task | ✅ | Adds to `affectedFiles` and appends a markdown block to `fileSpec` |
| Drift plan picker | ✅ | Popover on the badge: "Follow active plan" or pick any plan |

### Phase 10 — Onboarding
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| Recent projects table + service | ✅ | Pinning, prune unpinned past 12 |
| Recent projects REST API | ✅ | GET /api/recent-projects, DELETE, POST /pin |
| Recent projects on Welcome screen | ✅ | Pinned-first sort, hover reveals pin/remove + relative time |
| Onboarding state API | ✅ | GET /api/onboarding-state?project=… returns hasMcpSession, hasPlan |
| Getting Started checklist | ✅ | Floating bottom-left panel, 4 steps; per-project dismiss + collapse + tried-trellis flags in localStorage |

### Phase 11 — Multi-System Ingestion ⚡ HIGH PRIORITY
**Goal:** Treat the codebase as `Project → System → Cluster → File →
Symbol`, where systems are detected from any manifest (npm / Python /
Rust / PHP / Java / Go / Ruby / standalone TS), not just npm
workspaces. Resolve workspace aliases dynamically. Extract imports for
every supported language.
**Status: Phase 1 + 2 + plugin refactor DONE. Phase 3+ open.**
**Spec: [SYSTEM-MODEL.md](SYSTEM-MODEL.md)**

#### Why this matters

CodeTrellis was npm-shaped. Real repos aren't. Without these phases:

- npm packages outside the `workspaces` glob (e.g. orphan `services/realtime/`) were invisible
- Python / Rust / PHP / Java backends had files in the tree but **zero edges** because per-language import extraction wasn't wired
- Workspace package imports (`@scope/name`) didn't resolve because the resolver only knew a hardcoded `@shared` alias → entire apps like `apps/admin` showed up disconnected from `packages/*`
- Heavy non-source dirs (`venv/`, `build/`, `vendor/`, `test-results/`) drowned the real code AND blew up chokidar with EMFILE

#### Verified against /path/to/sample-monorepo

Before this phase: **597 edges, 0 Python, 0 workspace-aliased.**
After: **2552 edges — 1688 Python + 591 .tsx + 273 .ts, 314 into `packages/*`.**

| Sub-phase | Status | Notes |
|---|---|---|
| **1.A** Better ignore list | ✅ | venv / env / build / vendor / target / __pycache__ / coverage / test-results / playwright-report / cypress; safety floor under proper gitignore semantics |
| **1.B** Generic system discovery | ✅ | `system-discovery.ts`. Walks tree, emits a `DiscoveredSystem` for every manifest. Detects: `package.json` (with/without workspaces), `pyproject.toml`, `setup.py`, `requirements.txt`, `Cargo.toml` (incl. `[workspace]`), `go.mod`, `composer.json`, `pom.xml`, `build.gradle(.kts)`, `Gemfile`, standalone `tsconfig.json`. Project root always informal-system if no manifest. |
| **1.C** Dynamic package alias map | ✅ | `@swf/ui` → `packages/ui/src/index.ts`, etc. — built from every discovered package.json's name + entry hints + tsconfig.paths. Sorted longest-first for greedy prefix matching. |
| **1.D** `tsconfig.json` `compilerOptions.paths` | ✅ | Respected per-system; comment-tolerant + trailing-comma-tolerant JSON parser. |
| **1.E** Proper `.gitignore` semantics | ✅ | `ignore` npm package — globs, negation (`!path`), nested .gitignore inheritance. Optional `.codetrellis-ignore` per directory for project-specific overrides. |
| **1.6** Modular plugin architecture | ✅ | `parsers/{base,index,typescript,python,rust,php,java}.ts` and `resolvers/` mirroring it. Adding a language = drop a new file in each dir, register in index. No core changes. |
| **2.A** Python parser plugin | ✅ | `function_definition` / `async_function_definition` / `class_definition` / `decorated_definition` (decorators captured as modifiers) / module-level UPPER_CASE constants. Imports: `import_statement`, `import_from_statement`, aliased + relative (`from . import x`, `from ..pkg import y`). |
| **2.B** Python resolver | ✅ | Relative (`.x`, `..x`) walks up from importer; absolute anchors at importer's nearest-ancestor system root with `src/` and `app/` fallbacks. Filters stdlib + common third-party (fastapi, pydantic, sqlalchemy, etc.) so we don't fail to "resolve" `os` / `json` / etc. |
| **2.C** Rust parser + resolver | ✅ | function_item / struct_item / enum_item / trait_item / impl_item / mod_item / type_item; use_declaration. Resolver: crate:: from src/, self/super:: relative, sibling-crate within Cargo workspace. |
| **2.D** PHP parser + resolver | ✅ | function_definition / class_declaration / interface_declaration / trait_declaration / enum_declaration; namespace_use_declaration with namespace_definition recursion. Resolver: PSR-4 lookup from nearest composer.json `autoload.psr-4` (cached). |
| **2.E** Java parser + resolver | ✅ | class / interface / enum / record / method declarations; import_declaration with wildcard support. Resolver: src/main/java + src/test/java + src/ + root layouts; skips java./javax./sun./com.sun.*. |
| **2.F** Go parser + resolver | ❌ | Pending. Need a tree-sitter-go grammar in resources/ + plugin file. |
| **2.G** SQL ref-tracker | ❌ | Pending. String-literal SQL parsing → table refs; migration parser builds the table index. Becomes a cross-system edge once Phase 5 lands. |
| **3** Systems table + DB persistence + MCP `list_systems` etc. | ⚠️ Partial | `GET /api/systems?project=` exists. Missing: `systems` SQLite table, `system_id` column on `files`, MCP tools (`list_systems`, `get_system_files`, `get_system_dependencies`). |
| **4** System-aware UI | ⚠️ Partial | Done: graph scope filter (top-right of canvas) — pick any system → graph filters to that subtree. Missing: sidebar "Systems" section, system-as-cluster-boundary in graph builder (currently cluster discovery merges across systems), system view kind in Inspector, plan tasks `affectedSystems[]`. |
| **5** Cross-system non-import links | ❌ | HTTP routes (FastAPI decorators ↔ frontend `fetch()`), SQL table refs, env vars, subprocess, OpenAPI contracts. The reason "PHP + Python + SQL together" actually works as a single architecture. |
| **6** External / submodule shared libs | ❌ | Mark a `node_modules` package as "interesting" → ingest its source as a virtual system. `.gitmodules` awareness. |

#### Performance + correctness fixes that landed alongside

| Fix | Status | Notes |
|---|---|---|
| EMFILE survival in file watcher | ✅ | Function-based ignore predicate (globs weren't reliable for nested layouts). `followSymlinks: false`. Watcher 'error' handler logs + continues instead of tearing down the backend. |
| Per-project AST scoping | ✅ | `clearAstData()` at start of every `/api/project/scan`. Switching projects no longer leaves stale rows / unioned search results. |
| `/api/diff` regression fix | ✅ | Endpoint was re-running scanDirectory + parseFiles + storeParsedFile + resolveImports on EVERY 10s poll, AND calling resolveImports with no alias map (which wiped every workspace-aliased + Python edge each cycle). Now reads current state from the DB. Response time: ~30s → 193ms. |
| Graph scope filter | ✅ | Picker top-right of canvas + `scopePath` in graph-store. Filters depEdges before clustering / layout. |
| Files-depth view stops hiding files | ✅ | When scoped to one system, shows every file (no threshold, no cap). Unscoped: threshold lowered 3 → 2, cap raised 40 → 200. |
| Edge animation perf fix | ✅ | `<animateMotion>` on every regular edge was 5000+ SVG animations per frame, killing pan/zoom. Now only `active` and `planned_add` edges animate. |

#### What's left in this phase (in the order I'd do them)

1. **System-aware clustering** — use discovered systems as primary cluster boundaries, so Python's 1688 internal edges don't all collapse into one mega-cluster and `apps/admin`'s clusters stay separate from `apps/web`'s. Sub-cluster within a system by directory.
2. **Server-side rendered graph views** (your "load JSON from DB on demand" suggestion) — backend computes and caches `{ nodes, edges }` per scope, frontend just fetches. Switching systems becomes truly per-scope load. Caches invalidated on scan.
3. **Phase 3** — `systems` SQLite table + `system_id` on files + MCP `list_systems` / `get_system_files` / `get_system_dependencies`. Without this, agents can't query system-scoped state.
4. **Phase 4** — system-aware sidebar (Systems section above the file tree), system view kind in Inspector, `affectedSystems[]` on plan tasks, drift attribution by system.
5. **Phase 2.F + 2.G** — Go plugin + SQL ref tracker, completing language coverage.
6. **Phase 5** — cross-system non-import links (HTTP / SQL / env / subprocess / OpenAPI contracts). The headline product story for "PHP + Python + SQL all in one project."
7. **Phase 6** — selected `node_modules` ingestion + `.gitmodules`.

---

### Phase 12 — Deepening Plans + Agent Skills ⚡ HIGH PRIORITY (in flight)
**Goal:** plans can be light *or* deep on a per-plan basis. Light = title
+ a few tasks (already works). Deep = phased structure with executive
overview, per-phase scope + acceptance criteria, structured spec docs,
and a granular "proposed changes" feed of CRUD operations on files /
symbols / connections — all so multiple AI agents can share rich context
without having to re-derive it from chat history.

**Inspiration:** swf's `docs/oms/002-oms-integration/` style:
`00-EXECUTIVE-OVERVIEW.md` + `01-PHASE-1-FOUNDATION.md` …
`06-PHASE-6-…md` + cross-cutting `DATA-MODEL.md`, `FRONTEND-AUDIT.md`,
`TRACKER.md`, plus a `testing/` subfolder. Each phase doc has its own
ToC: backend models → routes → auth → frontend types → API client →
testing → acceptance criteria. We want the same expressiveness, but
backed by the DB so agents can query slices via MCP rather than
parsing markdown.

**The use case driving this:** "the majority of AI tools are being used
for mass refactoring to modernise systems" — multiple agents working
in parallel on a big migration need a shared deep plan they can refer
to and update.

#### Sub-phases

| | Item | Size | Status |
|---|---|---|---|
| **A** | Explicit `Phase` entity (table + service + REST + MCP + UI). Each phase has number, title, scope, prerequisites, gitCheckpoint, acceptanceCriteria, status. Tasks gain optional `phaseUid`. Plans can have N phases or zero (light plans unchanged). MCP: `add_plan_phase`, `list_plan_phases`, `update_plan_phase`, `delete_plan_phase`; `update_task` and `get_next_task` extended with `phase_uid`. UI: `PlanPhases` renders phases above tasks, expandable rows show scope/prereqs/acceptance markdown + bound tasks; "Unphased" bucket lets you bind tasks via dropdown. Phase create/edit modal handles all fields incl. delete. | medium | ✅ |
| **B** | "Proposed Changes" first-class view. Aggregates `affectedFiles` / `symbolSpecs` / `newConnections` / `removedConnections` from every task into one CRUD feed. Each change row has operation (add / modify / remove / move), target (file / symbol / connection), expected vs actual state, drift status. New tab in the plan panel + MCP `list_proposed_changes(plan_uid)` + `get_change_status(plan_uid, change_id)`. | medium | ❌ |
| **C** | Spec docs gain `orderHint` (e.g. "00", "01") + `parentDocUid` (nesting). Schema migration in place; service + REST + MCP (`add_plan_doc` / `update_plan_doc`) accept both fields; SpecRoom renders as a tree with order-prefixed labels and indented children; SpecDocCreateModal auto-suggests the next order prefix and offers a parent dropdown. Search falls back to flat list. | small | ✅ |
| **D** | Generic MCP agent timeline — every MCP tool call from any agent (Claude Code, Codex, Cursor, aider, custom) flows into the Agent Timeline as an `agent-event`. `registerTool` is wrapped to broadcast `tool_call` / `tool_error` events with agent attribution; PlanPanel Timeline tab renders them with per-event icons + duration. Closes step 5 of front-to-back loop for any agent. | small | ✅ |
| **D2** | **Multi-agent visibility (TopBar).** New `ConnectedAgents` widget in the TopBar replaces the single "Agent active" pill — shows count + popover listing every active MCP session (agent type, model, active plan, last seen). WS auto-refetches on `mcp-session-changed` / `session-registered` / `session_start` / `session_end`. `register_session` and `set_active_plan` now use the caller's transport sessionId so multiple simultaneous agents stay attributed correctly. | small | ✅ |
| **E** | **Agent skill resource via MCP.** Three resources: `codetrellis://skill` (project-tailored summary listing current plans + connected agents), `codetrellis://skill/quickstart` (first-time agent flow), `codetrellis://skill/power-user` (deep usage — phased plans, granular task fields, drift verification, multi-agent coordination, spec docs as shared context, snapshots). Markdown so any MCP-capable agent can ingest. | small | ✅ |
| **F** | Multiple-docs-per-type support. swf has multiple "phase" overview docs; we currently treat doc_type as a single-instance taxonomy. Already supported by the data model (each doc has a uid) — UI just needs to stop assuming "one executive_summary, ever" and group by type with ordering. | small | ❌ |
| **G** | Plan templates seeded from common shapes — "swf-style mass refactor" template seeds: 1 executive_overview doc, N phase docs (numbered), 1 data_model doc, 1 frontend_audit doc, 1 testing strategy doc, plus task scaffolds per phase. One-click from a template. | medium | ❌ |

#### Suggested order
1. **D** (small, immediate value — closes front-to-back step 5 for any agent)
2. **C** (small — enables the swf-style document ordering)
3. **A** (medium — unlocks structured phased plans)
4. **F** (small — let multiple docs of same type coexist)
5. **G** (medium — make the swf-style structure one-click)
6. **B** (medium — granular CRUD-level proposed changes)
7. **E** (small — agent skill resource; can land any time but reads better once A+C are in)

#### Acceptance for the deepening push as a whole

A user can:
- Open a project, type a one-line plan title → light plan (current behavior, untouched)
- OR pick "Mass refactor" from plan templates → seeded with executive overview + 6 phase docs + tasks + audit + testing strategy in seconds (matches the swf shape exactly)
- Author or edit any of those docs in the spec room with markdown ordering / nesting that mirrors swf's `00-…`, `01-…` convention
- Have multiple agents (Claude Code + Codex side-by-side) connect via MCP and:
  - See each other's tool calls in a live Agent Timeline
  - Pull the agent skill from `codetrellis://skill` so they know how to operate the product without out-of-band briefing
  - Fetch only the spec slice they need (`get_plan_doc(plan_uid, doc_type='security')`)
  - Claim tasks scoped to a specific phase (`get_next_task(plan_uid, phase_uid)`)
  - Drop into "Proposed Changes" to see the granular CRUD operations they're about to make
- Watch tasks auto-advance as files change on disk (Phase 11 / front-to-back step 9)
- Hit a "Verify completion" panel that reads `get_drift_report` and shows planned vs landed at a glance

---

## 4. Trellis State Definitions (canonical mental model)

These are the precise meanings of the four graph modes. UI labels and
backend behaviors should match these meanings.

### Baseline
Original state with no local changes applied.
- The starting point; the committed reference state.
- What existed before untracked, staged, or unstaged work.

Answers: *Where are we starting from? What files, symbols, and
dependencies originally existed?*

### Live
The source of truth for how the workspace looks right now.
- Includes untracked, staged, unstaged, and deleted local files.
- Current architecture as it exists on disk.

Answers: *What is the codebase like right now? What has already
changed locally?*

### Planned
The plan for the currently selected branch or worktree — the intended
future state.

Answers: *What changes are expected? What files / symbols / dependencies
will be added, removed, or modified?*

### Diff
The difference between the plan and the live state — the monitoring view.

Answers: *Is the live state matching the plan? What's on track? What's
missing? What's unexpected? Where is the agent drifting?*

---

## 5. Graph Workstream Checklist

Granular checkboxes. Treated as the working list when iterating on the
graph specifically. Update checkboxes here as items land instead of
creating scattered notes.

### 5.1 State Meaning and Mode Behavior

- [ ] `Baseline` visually reads as frozen reference state
- [x] Baseline can be pinned, auto-tracked, pinned to a recent commit, or pinned to a branch tip
- [ ] `Live` visually reads as current truth, including local dirty state
- [ ] `Planned` visually reads as target state for the selected branch/worktree
- [ ] `Diff` visually reads as live-vs-plan comparison, not just generic file diff *(partial — edges done; nodes still need it; DiffSummary shows on/off-track counts)*
- [ ] Switching modes keeps enough context so the user does not feel lost
- [ ] Local Git state remains understandable across all modes

### 5.2 Node Clarity

- [ ] Added files are visually obvious *(partial — ghost styling for planned_add only)*
- [ ] Modified files are visually obvious *(partial — cluster summarized changeStatus only)*
- [ ] Removed files are visually obvious *(partial)*
- [ ] Planned add / planned modify / planned remove are visually distinct from live changes *(partial)*
- [ ] Untracked files are visually obvious *(sidebar yes; graph no)*
- [ ] Staged files are visually obvious *(sidebar yes; graph no)*
- [ ] Unstaged files are visually obvious *(sidebar yes; graph no)*
- [ ] Changed but unconnected files still appear in a sensible way *(partial via `extraPaths`)*
- [x] Node cards feel readable at a glance *(Codex polish landed; subjective — keep refining)*

### 5.3 Edge Clarity

- [x] New connections are visually obvious *(green solid)*
- [x] Removed connections are visually obvious *(red dashed)*
- [x] Changed import/call relationships are visually obvious
- [x] Planned edge changes are distinct from live edge changes *(planned_add green dashed vs added green solid; unexpected rose-red solid)*
- [ ] Edge labels are readable without cluttering the graph
- [x] When a node is selected, its relevant edges stand out strongly

### 5.4 Selection and Focus

- [x] Clicking a card selects it without collapsing the whole map
- [x] Selected cards are highlighted strongly and clearly
- [x] Related cards remain visible while unrelated cards fade appropriately
- [x] Selected node connections are easy to follow
- [ ] Focus / drill-down keeps enough surrounding context
- [ ] Leaving focus view is simple and obvious

### 5.5 Layout and Stability

- [ ] The graph no longer twitches during refreshes *(partial)*
- [ ] Polling updates data without re-throwing the whole map around
- [ ] The default layout feels spacious, not congested
- [x] Cards can be dragged manually
- [ ] Drill-down layout feels intentional and clean
- [ ] Cluster → file → symbol navigation feels top-down and readable
- [ ] Layout is good both for overview and for focused investigation

### 5.6 Refresh and Monitoring Controls

- [x] Auto-refresh can be paused
- [x] User can check now manually
- [x] Refresh interval can be adjusted
- [ ] Refresh behavior feels monitoring-grade and non-disruptive *(improving)*
- [ ] Diff refresh and graph refresh feel coordinated rather than confusing
- [x] Auto-track HEAD updates the sidebar and canvas correctly after new commits *(fixed — see §10)*

### 5.7 Cluster-First Graph Structure

- [x] Overview speaks in clusters rather than packages
- [x] Cluster names are consistently meaningful *(3-phase discovery)*
- [ ] Cluster descriptions feel helpful and accurate
- [ ] Cluster view clearly shows baseline, live, and planned context *(only via inspector today)*
- [ ] Files inside a cluster are organized by importance and change state *(partial — cluster nodes carry full file list now)*
- [ ] Saved/manual clusters exist
- [ ] Editable cluster names/descriptions exist
- [ ] MCP cluster actions exist *(create_cluster / rename_cluster / assign_files_to_cluster / annotate_cluster / suggest_cluster_changes)*

### 5.8 Git Working Tree Context

- [x] Diff summary includes staged / unstaged / untracked counts
- [x] Untracked changed files can appear in the graph
- [ ] Node cards show Git state more explicitly *(partial — sidebar yes, graph no)*
- [ ] Staged vs unstaged vs untracked are distinguishable on the graph itself
- [ ] Git working tree context stays visible across all relevant modes

### 5.9 Plan Monitoring

- [ ] Planned view clearly shows the intended future architecture *(partial — projection ghosts; mode itself doesn't read distinctly)*
- [x] Diff mode clearly shows live-vs-plan gaps *(edges done; node-level drift ring still missing)*
- [ ] Missing planned changes are obvious *(ghost edges visible; missing realization of plan less obvious)*
- [x] Unexpected live changes are obvious *(unexpected edges in red; drift badge in inspector)*
- [ ] Drift is visible enough that a human can intervene quickly *(partial — needs node-level drift ring)*
- [ ] Progress toward the plan is easy to understand visually *(task progress shown but not graph-overlaid)*

### 5.10 Non-Technical Readability

- [ ] A non-technical person can tell what changed
- [ ] A non-technical person can tell what is planned
- [ ] A non-technical person can tell whether the agent is on track
- [ ] The graph explains architecture intent, not just code structure

---

## 6. Visual Experience — Where We Are vs Where We're Going

The graph went from "developer wireframe" to "polished cluster-first
view with animated curved edges" in this sprint. Still not "Palantir /
flight-radar" yet — see what's done vs what's missing below. This
section preserves the design intent originally captured in the gap
analysis.

### What we have now

- **Glassmorphic card-style nodes** with backdrop blur, soft borders,
  and a description line per cluster
- **Variable-sized cluster nodes** based on file count
- **Custom curved bezier edges** with animated flow dots and direction
  indicators
- **State-aware edge visuals** (regular / planned_add / added / unexpected
  / planned_remove / removed / active / symbol_link)
- **Selection emphasis** — selected node highlights, related nodes stay
  visible, unrelated edges fade
- **Cluster-first layout** with discovered architectural groupings
- **Discrete depth selector** (Clusters / Files / Symbols)

### What still doesn't match the target

- **Node-level drift state** isn't surfaced — the inspector shows it,
  the edges show it, but you can't scan the graph for red rings yet
- **Selected node showing internal symbols** — only available via the
  Symbol depth toggle, not as a focus mode on a clicked node
- **Semantic zoom** — zooming doesn't progressively reveal cluster →
  file → symbol; depth is a manual toggle
- **Mode visual distinctness** — Live vs Baseline vs Planned vs Diff
  doesn't read as four unmistakable visual modes; chrome changes but
  the graph itself doesn't strongly signal which mode you're in
- **Filter bar** for the graph (by language, package, change state)
- **Task → graph linkage** — clicking a task in the Plan panel doesn't
  highlight its `affectedFiles` + planned edges on the graph

### Visual atmosphere (target)

Subtle particle/dot background giving depth; glow effects on
active/selected; radial gradient lighting (center brighter, edges
darker); smooth transitions when expanding/collapsing.

---

## 7. Open Items (priority order)

### ⚡ Top priority — Front-to-back workflow

The end-to-end product loop is **open project → see architecture →
plan changes → agent executes → see drift → adjust → verify**. Most
steps work; a few seams are still broken or only partially wired.
Closing these is the priority block before adding more surfaces.

| Step | State | What's missing |
|---|---|---|
| 1. Open project (any language mix) | ✅ | — |
| 2. See architecture (graph, multi-language, multi-system) | ✅ | — for visible scope. `system-aware clustering` would split mega-clusters; `server-side per-system view loading` would make scope-switching truly per-scope. |
| 3. Drill into a file (Inspector + code preview + drift coloring) | ✅ | — |
| 4. Author a plan (title + tasks + spec docs) | ✅ | Plan templates would speed it up. Plan version viewer UI missing. |
| 5. Connect a coding agent | ✅ | Only Claude Code surfaces in the Agent Timeline. Codex / Cursor / aider sessions are *invisible* even though MCP tool calls flow. |
| 6. Agent reads the plan via MCP | ✅ | — |
| 7. Agent writes code | ✅ | — file watcher detects changes (any language). |
| 8. See file/edge/code-line drift against the plan | ✅ | — |
| 9. **Track agent progress** (which tasks are in-flight / done) | ⚠️ | Task status is updated *only* when the agent calls `update_task`. Should auto-advance to `in_progress` when affected files change on disk; auto-advance to `done` when all expected changes land + tests pass. |
| 10. **Adjust the plan mid-flight** (revise tasks / spec docs) | ✅ | Works. No formal approval/rejection workflow yet. |
| 11. **Verify completion** ("are we actually done?") | ⚠️ | Drift is shown but no "all expected planned changes have landed" verification. `get_drift_report` returns the data — needs a UI summary panel. |
| 12. **Cross-system flows visible on the graph** (frontend → backend route → SQL table) | ❌ | Phase 11 §5 — HTTP / SQL / env / subprocess link extraction. Until this lands, "PHP + Python + SQL together" feels like three islands instead of one architecture. |
| 13. **Plan completion artifact** (commit / PR with the diff against baseline) | ❌ | Not started. Eventually: one-click "open PR with these changes" once a plan is verified. |

**Concrete next pushes (in order):**

1. ~~**Phase 12 §D — Generic MCP-agent Timeline**~~ ✅ shipped — every MCP tool call broadcasts `tool_call` / `tool_error` with agent attribution; PlanPanel renders.
2. ~~**Phase 12 §D2 — Multi-agent visibility (TopBar)**~~ ✅ shipped — `ConnectedAgents` widget shows count + per-session detail (type, model, active plan, last seen).
3. ~~**Phase 12 §E — Agent skill resource**~~ ✅ shipped — `codetrellis://skill` (summary + quickstart + power-user) MCP resources.
4. ~~**Phase 12 §C — Spec doc orderHint + parentDocUid**~~ ✅ shipped — schema migration + service + REST + MCP + SpecRoom tree render + create-modal pickers; supports the swf-style `00-OVERVIEW / 01-PHASE-1 / 02-…` layout.
5. ~~**Phase 12 §A — Explicit Phases entity**~~ ✅ shipped — first-class `plan_phases` table, MCP `add/list/update/delete_plan_phase` + `update_task`/`get_next_task` accept `phase_uid`, `PlanPhases` UI groups tasks by phase with expandable scope/prereqs/acceptance markdown.
6. **Phase 12 §F + §G — multiple docs per type + plan templates** — let multiple docs of the same type coexist; ship a "Mass refactor (swf-style)" template that seeds executive overview + N phase docs + audit + testing strategy in one click.
7. **Phase 12 §B — Proposed Changes view** — granular CRUD feed (add / modify / remove file or symbol or connection) aggregated from task fields, with drift status per change. New tab + MCP tools.
8. **Plan-task progress auto-detection** — task auto-advances to `in_progress` when affected files change. Closes step 9 of front-to-back loop.
9. **System-aware clustering** — use discovered systems as primary cluster boundaries so Python's 1688 internal edges aren't all one mega-cluster.
10. **Server-side per-system rendered views** — backend computes `{ nodes, edges }` per scope and caches in DB.
11. **Phase 11 §3 — systems table + MCP tools** (`list_systems`, etc.).
12. **Phase 11 §4 — system-aware Sidebar + Inspector + plan tasks `affectedSystems[]`**.
12. **"Plan completion" verification panel** — reads `get_drift_report` and shows planned vs landed at a glance. Closes step 11.
13. **Phase 11 §5 — cross-system non-import links** (HTTP routes, SQL refs). Closes step 12.

### Multi-System Ingestion — remaining sub-phases (see §3 Phase 11)
Already shipped: 1.A–1.E, 1.6 (plugin architecture), 2.A–2.E
(Python/Rust/PHP/Java parsers + resolvers), graph scope filter, AST
per-project scoping, /api/diff fix, EMFILE survival, animation perf.

Remaining: 2.F (Go), 2.G (SQL ref-tracker), 3 (systems DB + MCP),
4 (system-aware UI), 5 (cross-system links), 6 (external libs).

### Graph-quality blockers (Immediate Focus from previous tracker)
1. ❌ Make the four trellis modes visually unmistakable
2. ❌ Make node and edge state coloring much more obvious *(edges done; nodes still need it — see Quick wins #1 below)*
3. ❌ Keep Git working tree context visible across modes
4. ❌ Make Diff truly about live vs planned state *(edges done; nodes + auto-projection still open)*
5. ❌ Improve drill-down so context is preserved cleanly
6. ❌ Reduce congestion and make changed-but-unconnected files easier to place

### Quick wins (≤ a few hours each)
1. **Drift state on graph nodes** — emerald / amber / rose ring on each node in Diff mode (data already computed)
2. **Generic MCP-agent timeline** — surface MCP tool calls in the Timeline tab so Codex / Cursor / aider show alongside Claude Code
3. **Diff mode auto-engages projection** — drop the Projection toggle requirement when Diff is active and a plan exists
4. **AGENTS.md vs CLAUDE.md drift** — they disagree on which agents are monitored
5. **Verify auto-track HEAD fix end-to-end** with a real `git commit --amend`

### Medium-term
6. **Task ↔ graph linkage** — click a task in PlanPanel → graph highlights its affected files + planned edges; hover an affected file → corresponding node pulses
7. **Persisted clusters + cluster MCP** — let humans rename clusters and let agents propose changes (`create_cluster`, `rename_cluster`, `assign_files_to_cluster`, `annotate_cluster`, `suggest_cluster_changes`)
8. **Plan templates** — refactor / new feature / bug fix / migration starter shapes (with seeded spec doc skeletons + task scaffolds)
9. **Plan-task progress auto-detection** — advance a task to `in_progress` when its `affectedFiles` change on disk
10. **Spec-aware drift** — extend `get_drift_report` to flag "agent worked on file X without consulting `security` or `testing` doc"
11. **Task-level comments** + **Plan version viewer UI**
12. **Visual Plan Builder** — click nodes on the graph to add to a plan, draw connections between files, right-click context menu

### Larger pushes
13. **Make four trellis modes visually unmistakable** (Immediate Focus #1 spelled out): mode-tinted canvas / chrome / palette swap; "this is BASELINE" pulled out clearly; Diff feels different from Live at a glance
14. **Floating window primitive** — for plan + spec doc editors that don't block the graph (drag, resize, minimise to a corner chip)
15. **Filter bar** for the graph
16. **Semantic zoom** — cluster ↔ file ↔ symbol via zoom level
17. **Performance pass** — large repos (500+ files) currently block the main thread on parse / layout; needs worker pool for both
18. **Multi-Agent Dashboard** — cards per active agent, color-coded, conflict warnings

### Cleanup
19. [docs/CODEX-VISUAL-OVERHAUL.md](CODEX-VISUAL-OVERHAUL.md) — one-off prompt, archive or delete
20. E2E tests for Spec Room and Inspector
21. Pre-existing TS errors: `useRef()` initial value, `PlanStatus` ambiguous re-export between `agent.ts` and `plan.ts`, missing `sql.js` types

---

## 8. MCP API Surface (current)

### Tools

**Architecture queries**
`search_symbols`, `get_dependencies`, `check_architecture`, `check_conformity`

**Plan management**
`create_plan` (full schema: tasks with `affected_files`, `affected_symbols`,
`new_connections`, `removed_connections`, `dependencies`, `file_spec`,
`symbol_specs`), `get_plan`, `update_plan`, `list_plans`

**Task management**
`claim_task`, `update_task`, `get_next_task`

**Spec docs**
`add_plan_doc`, `update_plan_doc`, `get_plan_doc`,
`list_plan_docs` (cheap summary index), `search_plan_docs` (with excerpts)

**Comments**
`add_comment`, `get_comments`

**Sessions**
`register_session`, `set_active_plan`

**Deviations / drift**
`get_deviations`, `detect_deviations`, `reconcile`, `get_drift_report`

**Trellis snapshots**
`capture_checkpoint`

**Legacy (kept for back-compat)**
`report_plan` — prefer `create_plan`

### Resources

- `project://graph` — current dependency graph as JSON
- `project://stats` — file / symbol / import counts
- `codetrellis://plans` — list of all plans
- `codetrellis://sessions` — active agent sessions

### REST endpoints worth knowing

- `POST /api/project/scan` · `GET /api/dependencies` · `GET /api/dependencies/file?path=`
- `GET /api/symbols/file?path=` · `GET /api/symbols/search?q=`
- `GET /api/file/content?path=&start=&end=&project=&plan=` (returns content + per-line git annotations + plan drift status)
- `GET /api/git/branch` · `GET /api/git/info` · `GET /api/git/status` · `GET /api/git/head` · `GET /api/git/commits` · `GET /api/git/branch-tip?branch=`
- `GET /api/recent-projects` · `DELETE /api/recent-projects` · `POST /api/recent-projects/pin`
- `GET /api/onboarding-state?project=`
- `GET/POST /api/plans` · `GET/PUT/DELETE /api/plans/:uid` · `GET /api/plans/:uid/tasks` · `PUT /api/plans/:uid/tasks/:taskUid` · `POST /api/plans/:uid/tasks/:taskUid/{claim,code-reference}` · `GET /api/plans/:uid/projection` · `GET /api/plans/:uid/deviations` · `POST /api/plans/:uid/reconcile` · `GET /api/plans/:uid/versions`
- `GET/POST /api/plans/:uid/docs` · `GET /api/plans/:uid/docs/by-type/:docType` · `GET /api/plans/:uid/docs/search?q=` · `GET/PUT/DELETE /api/plan-docs/:docUid` · `GET /api/plan-docs/:docUid/versions`
- `POST /api/trellis/capture` · `GET /api/trellis/snapshots` · `GET /api/trellis/:id` · `GET /api/trellis/:id/diff`
- `GET/POST /api/comments`
- `GET /api/baseline` · `POST /api/baseline/capture`
- `GET /api/diff?project=`
- `GET /api/agent/status` + WebSocket `/ws` for real-time events

---

## 9. Technical Debt

| Item | Priority | Notes |
|---|---|---|
| TypeScript strict mode errors | Low | Many `any` types in backend; works but not type-safe. `useRef()` initial-value warnings on React 19. |
| `PlanStatus` re-export ambiguity | Low | Both `shared/types/agent.ts` and `shared/types/plan.ts` export `PlanStatus` |
| Missing `@types/sql.js` | Low | Untyped sql.js usage in `database.ts` |
| AST parsing runs synchronously | Medium | Blocks Express thread on large repos |
| sql.js in-memory limitation | Low | Works for current scale; might need migration to persistent DB for very large projects |
| No test coverage for plan + spec UI | Medium | E2e tests cover API but not plan/spec interaction flows |
| Screenshot tests unreliable | Low | Project-opening via folder picker is flaky in Playwright |
| Stale test plans in DB | Low | E2e tests create plans that persist across runs |
| Multi-agent contention not designed | Medium | conflict-detected broadcasts but no UI to resolve |

---

## 10. Known Gaps Resolved Recently

- ✅ **Auto-track HEAD bug** — sidebar/canvas no longer carry stale dirty markers for ~30s after a commit. Root cause: `mergeGitSources` was set-unioning dirty paths from a stale shared state with a fresh polled commit hash, then `reconcileGitStatus` debounced clearing for 3 polls. Fix: prefer the post-commit clean source when commit hashes mismatch + bump `refreshVersion` after `captureBaseline` so the sidebar re-polls immediately.
- ✅ **Modal clipping** — PlanCreateModal / SpecDocViewer / SpecDocCreateModal / AddToTaskPopover were trapped inside the bottom panel. Cause: `.glass-panel` uses `backdrop-filter`, which creates a containing block for `position: fixed`. Fix: `createPortal(..., document.body)` for all modals.
- ✅ **Allotment first-render crash** — `Cannot read properties of undefined (reading 'minimumSize')` on mount. Fix: skip the first useEffect run for programmatic resizes; defer subsequent ones via `requestAnimationFrame` and try/catch.
- ✅ **File watcher missed non-JS edits** — chokidar only re-parsed `.ts/.tsx/.js/.jsx`. Fixed to include `.py / .rs / .php / .java / .mjs / .cjs`.

---

## 11. File Map

```
src/
  backend/
    server.ts                          — Express API + WebSocket; all REST routes
    index.ts                           — Standalone web mode entry
    services/
      project-scanner.ts               — Recursive dir scan with .gitignore
      monorepo-detector.ts             — Workspace type detection
      ast-parser.ts                    — tree-sitter WASM (TS/TSX/JS/JSX/Python/Rust/PHP/Java)
      database.ts                      — sql.js wrapper, all table DDL
      file-watcher.ts                  — chokidar; re-parses all supported langs
      diff-engine.ts                   — In-memory baseline + diff computation
      trellis-service.ts               — Trellis snapshots (current / planned / checkpoint)
      projection-service.ts            — Compute planned graph state from a plan's tasks
      plan-service.ts                  — Plans + tasks CRUD; appendTaskCodeReference, appendTaskToPlan, getTaskByUid
      plan-documents-service.ts        — Spec docs CRUD + version history + search
      comment-service.ts               — Threaded comments on plans/tasks
      session-service.ts               — Agent session registry
      deviation-service.ts             — checkFileDeviation hook for plan drift
      recent-projects-service.ts       — Recent + pinned project list
      persistence.ts                   — DB autosave to disk
    agent/
      claude-code-watcher.ts           — Tails ~/.claude/sessions/<id>.jsonl
    mcp/
      server.ts                        — MCP SSE server (port 19432); all tools + resources
  frontend/
    App.tsx                            — Root layout; Allotment refs for programmatic panel resize
    bridge/                            — HTTP / Electron API abstraction
    hooks/
      useWebSocket.ts                  — WS handler; routes events to stores + toasts
      useKeyboardShortcuts.ts
    components/
      WelcomeScreen.tsx                — Logo + recent projects + open-another / explainer when empty
      FolderPickerModal.tsx
      McpGuideModal.tsx                — MCP setup wizard
      GettingStarted.tsx               — Floating onboarding checklist
      Toast.tsx
      ErrorBoundary.tsx
      layout/
        TopBar.tsx                     — Tabs, branch popover (with branch-pin baseline), depth selector, Connect Agent
        Sidebar.tsx                    — File tree with per-file git status markers
        MainCanvas.tsx                 — ReactFlow canvas, mode selector, baseline controls, refresh chrome
        InspectorPanel.tsx             — Kind-aware (cluster / file / symbol) routing, expand toggle
        PlanPanel.tsx                  — Tabs (Plans / Timeline / Changes / Comments), expand toggle
        StatusBar.tsx
      graph/
        nodes/                         — PackageNode, DirectoryNode, FileNode, SymbolNode (glassmorphic)
        edges/
          ImportEdge.tsx               — Custom edges with state-aware visuals + animated flow dots
      plan/
        PlanList.tsx
        PlanDetail.tsx                 — Plan header, progress, SpecRoom, tasks
        PlanCreateModal.tsx            — Portaled modal; basic create wizard
        SpecRoom.tsx                   — Inside PlanDetail; type chips, search, doc cards
        SpecDocViewer.tsx              — Portaled modal; markdown + edit + version history + restore
        SpecDocCreateModal.tsx         — Portaled modal; type picker grid + starter skeletons
        StatusBadge.tsx
        CommentThread.tsx
      inspector/
        CodePreview.tsx                — Prism syntax highlight + git gutter + drift border + line selection + DriftBadge
        AddToTaskPopover.tsx           — Portaled modal; three modes (existing / new task / new plan)
    lib/
      graph-builder.ts                 — Cluster discovery + view builders + edge change map (live × planned)
      graph-visuals.ts                 — Node sizing + visual data types
      markdown.tsx                     — Minimal markdown renderer for spec docs
      spec-doc-types.tsx               — Doc taxonomy with icons + chip colors
    stores/                            — Zustand: graph, agent, project, plan, ui, toast
  electron/                            — Electron main + preload (untested)
  shared/types/                        — Plan, Task, Comment, PlanDocument, ProjectionData, GraphNode/Edge, etc.
docs/                                  — TRACKER.md (this) + vision/design docs (CORE-VISION, THREE-TRELLIS, CLUSTER-FIRST-VISION, GRAPH-UX-REFINEMENT, DATA-MODEL, MCP-INTEGRATION, UI-DESIGN, ARCHITECTURE, RESEARCH-NOTES, TESTING-GUIDE)
```

---

## 12. Recent Sessions Commit Log (newest first)

```
41eeefa Stop animating regular edges — fixes pan/zoom slowness
27de688 Files-depth view no longer hides files silently
6e55646 Graph scope filter — limit canvas to one system / directory
2ebcc1e Stop /api/diff from re-parsing the entire project on every poll
00672ac Phase 1.6 + 2: language-plugin parsers/resolvers; Python edges; EMFILE survival; per-project AST scoping
ed3f346 Multi-system ingestion (Phase 1): discover every system, resolve workspace aliases, proper gitignore
5059f9f Consolidate trackers into a single TRACKER.md
7824b86 Edge drift visualization + watch all parseable extensions
734c957 Drift badge: pick which plan to compare against
27bf2ec Code viewer: syntax highlighting, git gutter, drift coloring, add-to-task
5e4ed58 Skip first-render Allotment.resize() to fix mount crash
5a25f90 Add panel expand toggle + kind-aware Inspector
63a7398 Add Spec Room — structured spec docs attached to plans
fdd93de Fix plan modal getting clipped to bottom panel
07d350d Add recent projects service and Getting Started onboarding
9c023f5 Make dev tasks idempotent by freeing ports before starting
9b8e53b Improve cluster discovery with dependency-based refinement
fe7fc63 Improve live git refresh behavior
4dc2efa Refine refresh handling for git state
b1b0d34 Fix auto-track head refresh state
232e1b1 Add baseline commit selection controls
4c4bb5e Add git status markers to sidebar explorer
c0cf5e0 Refine graph state handling and refresh stability
21b30e0 Add repository agent instructions
4a2657c Add polished graph nodes and import edges
1b0ea80 Fix critical bugs from testing report + entity-centric graph rewrite
d2c05db Implement Three Trellis State system
b99826f Add deviation detection, conflict warnings, toast system, and gap analysis
6b91e11 Add plan system, MCP expansion, force layout, persistence, and e2e tests
b7c8fa3 Initial commit — CodeTrellis v0.1.0
```
