# CodeTrellis — Testing Guide

## What This App Is

CodeTrellis is a web-based tool that visualizes codebase architecture and monitors AI coding agents. It shows how files in a project connect to each other through imports/dependencies, lets you create structured plans for code changes, and tracks what AI agents are doing in real-time.

It runs as two servers:
- **Backend** on http://localhost:3001 (Express API + WebSocket + MCP server on :19432)
- **Frontend** on http://localhost:5173 (React + ReactFlow graph visualization)

---

## How The App Works

### Opening a Project

1. Go to http://localhost:5173
2. You'll see a **welcome screen** with CodeTrellis branding and step cards
3. Click **"Open Project"** (blue button at bottom of welcome, or "+" in the top bar)
4. A **folder picker modal** appears — it shows your filesystem directories
5. Navigate to a project directory OR paste a path in the text input at the top
6. Click **"Open"** to scan the project
7. The app parses all source files (TypeScript, JavaScript, Python, etc.), extracts imports, and builds a dependency graph

### The Interface Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Tab] [Branch] [+]  │  Depth: [Pkg][Files][Sym]  │ .. │  ← Top Bar
├─────────┬───────────────────────────────┬───────────────┤
│         │                               │               │
│ Sidebar │     Main Graph Canvas         │  Inspector    │
│ (files) │   (architecture visualization)│  (details)    │
│         │                               │               │
│         ├───────────────────────────────┤               │
│         │  Plan Panel                   │               │
│         │  [Plans][Timeline][Changes]   │               │
├─────────┴───────────────────────────────┴───────────────┤
│  Status Bar                                              │  ← Bottom
└─────────────────────────────────────────────────────────┘
```

### The Graph — Three Depth Levels

**Packages** (default): Shows high-level clusters — groups of related files discovered from import relationships. Each cluster node shows how many files it contains and its top files. Click a cluster to drill into it.

**Files**: Shows individual files that are architecturally important (hub files with 3+ connections). Each node shows the filename, connection count, and top exports. Edges are labeled with what's imported.

**Symbols**: Same as Files but you can click a file to see its functions/classes/interfaces inside it.

### Graph Interaction

- **Click a node**: In Package view, drills into that cluster. In File view, enters "focus mode" — that file goes to center and shows all its connections (blue = outbound imports, amber = inbound/imported by).
- **Click a connected node in focus mode**: Re-centers on that file (navigation).
- **Packages button**: Always resets back to the clean cluster overview.
- **Map vs Tree toggle** (top-right of graph): Switches between force-directed organic layout (Map) and hierarchical tree layout (Tree).

### Trellis Modes (top-right of graph)

The core feature — four views of the same architecture:

- **Live** (green, default): Real-time state of the codebase as it is right now
- **Baseline** (blue): Frozen snapshot captured when a plan was approved — the "before" state
- **Planned** (amber): What the codebase SHOULD look like after the plan is complete — shows ghost nodes for new files
- **Diff** (violet): Live state with color-coded markers showing what changed vs the baseline

### Plans

The bottom panel has tabs:

- **Plans**: List of all plans. Click to view details. Click "+ New" to create one.
- **Timeline**: Shows real-time agent events (file reads, writes, edits by Claude Code)
- **Changes**: Shows file modifications by the agent
- **Comments**: Threaded discussion on the active plan

**Creating a plan**: Click "+ New", enter title/description, add tasks with affected files. Plans can be vague ("refactor auth") or precise (list every file and function change).

**Plan workflow**: Draft → Review → Approved (auto-captures baseline snapshot) → In Progress → Completed

### Inspector Panel (right side)

Click any file in the sidebar or graph to see:
- File path
- Symbols inside it (functions, classes, interfaces with line numbers)
- What it imports (with specifiers)
- What imports it (dependents)

### Connect Agent (top bar)

Opens a guide for connecting AI coding agents via MCP (Model Context Protocol). The MCP server runs on localhost:19432. Agents can create plans, claim tasks, report progress, and query the architecture.

### Status Bar (bottom)

Shows: project status, event count, MCP server status, Claude Code agent connection status.

### Keyboard Shortcuts

- `Cmd+O` — Open project
- `Cmd+1/2/3` — Switch to Package/File/Symbol depth
- `Cmd+B` — Toggle sidebar
- `Cmd+J` — Toggle plan panel
- `Escape` — Deselect node

---

## API Reference (for automated testing)

### Core Endpoints

```
GET  /api/health                          — Health check
POST /api/project/scan                    — Scan a project (body: {projectPath})
GET  /api/dependencies                    — All file-to-file import edges
GET  /api/dependencies/file?path=...      — Imports + importedBy for one file
GET  /api/symbols/search?q=...            — Search symbols by name
GET  /api/symbols/file?path=...           — Symbols in a specific file
GET  /api/stats                           — Database statistics
GET  /api/git/branch?path=...             — Current git branch
GET  /api/git/info?path=...               — Branches, worktrees, commit status
GET  /api/fs/browse?path=...              — Browse directories
GET  /api/auto-detect                     — Find active Claude Code sessions
```

### Plan Endpoints

```
GET  /api/plans                           — List all plans
POST /api/plans                           — Create plan (body: {title, description, projectPath, tasks[]})
GET  /api/plans/:uid                      — Get plan with tasks
PUT  /api/plans/:uid                      — Update plan (body: {title?, description?, status?})
GET  /api/plans/:uid/tasks                — List tasks
PUT  /api/plans/:uid/tasks/:taskUid       — Update task status
GET  /api/plans/:uid/projection           — Projected graph changes
GET  /api/plans/:uid/deviations           — Detected deviations
GET  /api/plans/:uid/versions             — Version history
```

### Trellis Endpoints

```
POST /api/trellis/capture                 — Capture snapshot (body: {projectPath, planUid?, name?})
GET  /api/trellis/snapshots?plan=...      — List snapshots
GET  /api/trellis/:id                     — Get snapshot with full data
GET  /api/trellis/:id/diff                — Compare snapshot vs live state
```

### Comment Endpoints

```
GET  /api/comments?target=...             — Get comments for plan/task
POST /api/comments                        — Add comment (body: {targetType, targetUid, body, commentType?})
```

### MCP Server

SSE transport on http://127.0.0.1:19432/sse

Tools available: search_symbols, get_dependencies, check_architecture, create_plan, get_plan, update_plan, list_plans, claim_task, update_task, get_next_task, add_comment, get_comments, register_session, set_active_plan, get_drift_report, capture_checkpoint, get_deviations, reconcile, detect_deviations, check_conformity, report_plan

---

## Known Issues

- The graph can be slow to load on first scan (parsing all files)
- Trellis Baseline/Planned/Diff modes only work when a plan is approved (which captures the baseline snapshot)
- The folder picker requires typing/pasting the full project path
- Some edges may be missing if import paths use aliases not yet supported
- Toast notifications appear briefly in the bottom-right — easy to miss
