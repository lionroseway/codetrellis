# Implementation Tracker

Last updated: 2026-04-20

## Architecture Note
Running in web mode (Express :3001 + Vite :5173) due to macOS 26 Electron SIGKILL bug.
Electron wrapper exists but is untested. Code is shared via bridge abstraction.

---

## Phase 1: Foundation
**Status: MOSTLY DONE**

| Task | Status | Notes |
|------|--------|-------|
| Scaffold (Vite + React 19 + TS) | DONE | Web mode via Express + Vite, Electron wrapper exists |
| Tailwind CSS 4 + dark theme | DONE | Custom theme vars in globals.css |
| Shell layout (Sidebar, TopBar, Canvas, Inspector, AgentPanel, StatusBar) | DONE | All panels render |
| Resizable panels | NOT DONE | Panels have fixed widths, allotment installed but not wired |
| Typed IPC / Bridge abstraction | DONE | HTTP bridge for web, Electron bridge stub exists |
| ProjectScanner + .gitignore | DONE | Recursive scan, respects .gitignore patterns |
| MonorepoDetector | DONE | npm/pnpm/nx/turbo workspace detection |
| SQLite database | DONE | sql.js in-memory, schema for files/symbols/imports |
| Zustand stores | DONE | graph, agent, project, ui stores |
| Shared types | DONE | GraphNode, GraphEdge, AgentEvent, etc. |
| Project open dialog | DONE | Folder picker modal with server-side directory browser |
| File tree sidebar | DONE | Shows scanned file tree, click expands in sidebar |

**Verification:**
- [x] App opens in browser with dark theme
- [x] Open a project → sidebar shows file tree
- [ ] Resizable panels work — NOT IMPLEMENTED
- [x] Status bar shows project info

---

## Phase 2: AST Engine
**Status: DONE (core features) — optimization deferred**

| Task | Status | Notes |
|------|--------|-------|
| Tree-sitter WASM setup | DONE | web-tree-sitter in backend |
| TypeScript grammar | DONE | .ts and .tsx parsing works |
| JavaScript grammar | DONE | .js parsing works |
| Symbol extraction | DONE | functions, classes, methods, interfaces, types, enums |
| Import/export extraction | DONE | Import statements with specifiers extracted |
| Import resolution (paths, aliases) | DONE | Resolves relative imports, @shared alias. 54/109 resolved (rest are npm packages) |
| SQLite persistence | DONE | files, symbols, imports tables populated |
| FTS5 / symbol search | DONE | LIKE-based search (sql.js doesn't support FTS5, but works fine) |
| FileWatcher (chokidar) | DONE | Watches project, re-parses on change |
| Dependency graph API | DONE | GET /api/dependencies returns file-to-file edges |
| File dependency API | DONE | GET /api/dependencies/file?path=... returns imports + importedBy |
| Incremental parsing | DEFERRED | Full re-parse on change, no tree-sitter edit deltas |
| Worker pool | DEFERRED | Parsing is synchronous, fine for current scale |
| Parse progress reporting | DEFERRED | Not needed until large repo support |

**Verification (all tested via curl):**
- [x] Open a TS project → 42 files parsed, 102 symbols, 109 imports extracted
- [x] Import resolution → 54 local imports resolved to actual file paths
- [x] Dependency edges → server.ts imports 5 files, is imported by 3
- [x] Search for a function name → results appear with file path and line numbers
- [x] Edit a file externally → re-parsed automatically
- [ ] Large repo (500+ files) → deferred, likely blocks main thread

**APIs:**
- `POST /api/project/scan` — scans, parses AST, resolves imports, starts watcher
- `GET /api/symbols/search?q=...` — search symbols by name
- `GET /api/symbols/file?path=...` — get symbols for a file
- `GET /api/dependencies` — all file-to-file import edges
- `GET /api/dependencies/file?path=...` — imports + importedBy for one file
- `GET /api/stats` — file/symbol/import/resolved counts

---

## Phase 3: Graph Visualization
**Status: PARTIALLY DONE — basic graph renders, missing relationship edges**

| Task | Status | Notes |
|------|--------|-------|
| ReactFlow integration | DONE | ReactFlow renders in main canvas |
| Custom nodes: PackageNode | DONE | With expand/collapse button |
| Custom nodes: DirectoryNode | DONE | With expand/collapse button |
| Custom nodes: FileNode | DONE | With language color coding |
| Custom nodes: SymbolNode | DONE | Shows kind icon (f, C, I, T, etc.) |
| Custom edges: ImportEdge | NOT DONE | No import-based edges exist |
| Custom edges: CallEdge | NOT DONE | |
| Custom edges: DependencyEdge | NOT DONE | |
| GraphBuilder from SQLite data | PARTIAL | Builds from file tree only, not from dependency data |
| dagre layout | DONE | Auto-layout works |
| Expand/collapse | DONE | Click ▶/▼ button on nodes |
| Depth selector (Package/File/Symbol) | PARTIAL | Switches exist, Package and File work, Symbol fetches but untested |
| Filter bar | NOT DONE | |
| Minimap | DONE | |
| Zoom controls | DONE | |
| Node inspector panel | PARTIAL | Shows selected node path only, no details/deps/code |
| Click sidebar → focus graph | NOT DONE | Sidebar toggles graph expand but doesn't pan to node |
| Click graph → show in inspector | PARTIAL | Sets selectedNodeId but inspector shows minimal info |

**Verification:**
- [ ] Package view shows packages with dependency edges — NO, just file tree structure
- [x] Expanding a package/dir shows its children
- [ ] Expanding a file shows its classes/functions — only in Symbol depth, untested
- [x] Layout is clean and readable
- [x] Smooth pan/zoom

**CRITICAL GAP: The graph shows file TREE structure (parent→child), not code RELATIONSHIPS (file imports file, function calls function). Need import resolution (Phase 2) first, then build dependency edges.**

---

## Phase 3 update
**Status: DONE (core features)**

Graph now shows real dependency relationships (import edges), not just file tree.
Package view groups by directory, File view shows all files with import arrows,
Symbol view allows expanding files to see functions/classes.
Inspector panel shows symbols, imports, and importedBy for selected file.

---

## Phase 4: Agent Integration
**Status: DONE**

| Task | Status | Notes |
|------|--------|-------|
| ClaudeCodeWatcher | DONE | Scans ~/.claude/sessions/, finds active sessions by PID |
| Session correlation | DONE | Matches session cwd to monitored project |
| Extract tool calls | DONE | Reads, Writes, Edits, Bash, Glob, Grep from JSONL |
| Plan extraction | DONE | Heuristic: detects numbered lists and bullet-point plans |
| AgentEventBus → frontend | DONE | WebSocket broadcasts events, Zustand store receives |
| Agent panel: timeline | DONE | Chronological event log with Lucide icons |
| Agent panel: changes tab | DONE | Shows file writes/edits by agent |
| Agent panel: plan tab | DONE | Shows detected plans as checklists |
| Status bar indicator | DONE | Shows agent status + copy MCP config button |
| MCP server | DONE | SSE on localhost:19432, auto-starts with backend |
| MCP tools | DONE | search_symbols, get_dependencies, check_architecture, report_plan, check_conformity |
| MCP resources | DONE | project://graph, project://stats |
| MCP connection guide | DONE | Modal with 3-step setup, copy config, tool reference |
| "Connect Agent" button | DONE | In top bar, opens MCP guide modal |
| Graph highlighting | DEFERRED | Agent-touched files could pulse, not implemented yet |

**MCP tools:**
- `search_symbols` — find functions/classes by name
- `get_dependencies` — imports + importedBy for a file
- `check_architecture` — query full dependency graph
- `report_plan` — agent reports plan, shown in UI
- `check_conformity` — check for circular dependency violations

**APIs:**
- `GET /api/agent/status` — watcher state, active session ID
- WebSocket `agent-event` messages pushed to frontend in real-time

---

## Phase 5: Architecture Diffing
**Status: DONE (core)**

| Task | Status | Notes |
|------|--------|-------|
| Snapshot capture | DONE | Captures files (with hashes) + edges at scan time |
| Auto-snapshot on scan | DONE | Baseline set when project is opened |
| DiffEngine | DONE | Computes added/removed/modified files and edges |
| Color-coded graph overlay | DONE | Green=added, Orange=modified, Red=removed, Purple=affected |
| Blast radius | DONE | Files depending on changed files highlighted |
| Diff polling | DONE | Frontend polls /api/diff every 10s |
| Diff summary panel | DEFERRED | Counts available in diff response, no dedicated UI yet |
| Before/after split view | DEFERRED | |
| Snapshot timeline | DEFERRED | |

**APIs:**
- `GET /api/diff?project=...` — computes current vs baseline diff

---

## Phase 6: Polish & Extensibility
**Status: DONE (practical items)**

| Task | Status | Notes |
|------|--------|-------|
| Rename to CodeTrellis | DONE | Package, title, forge config, welcome screen |
| App icon + branding | DONE | Logo in resources/icon.png, wired as favicon |
| Welcome screen / onboarding | DONE | 4-step guide when no project open |
| Replace emojis with Lucide icons | DONE | All components use lucide-react |
| shadcn-style polish | DONE | Tighter spacing, proper borders, consistent styling |
| Python grammar | DONE | tree-sitter-python WASM |
| Rust grammar | DONE | tree-sitter-rust WASM |
| PHP grammar | DONE | tree-sitter-php WASM |
| Java grammar | DONE | tree-sitter-java WASM |
| Keyboard shortcuts | DONE | Cmd+O, Cmd+1/2/3, Cmd+B, Cmd+J, Escape |
| Error boundaries | DONE | React ErrorBoundary wraps App |
| Export graph as PNG | DONE | Export button in top-right of graph |
| Session history / replay | DEFERRED | Complex, needs persistence layer |
| Auto-update | BLOCKED | macOS 26 Electron bug |
| DMG/installer | BLOCKED | macOS 26 Electron bug |
| Performance optimization | DEFERRED | Works at current scale |

**Supported languages:** TypeScript, TSX, JavaScript, Python, Rust, PHP, Java

**Keyboard shortcuts:**
- Cmd+O — Open project
- Cmd+1/2/3 — Package/File/Symbol depth
- Cmd+B — Toggle sidebar
- Cmd+J — Toggle agent panel
- Escape — Deselect node

---

## Priority Fix List (in order)

1. **Import resolution** — resolve `./foo` → `/abs/path/to/foo.ts` so we can build file-to-file edges
2. **Dependency graph API** — endpoint that returns file-to-file import edges from SQLite
3. **Dependency edges in graph** — show which files import which, with directed arrows
4. **Inspector panel** — show file details, symbol list, imports/imported-by when a node is selected
5. **Symbol depth working** — double-click file in graph shows its functions/classes
6. **Search in frontend** — wire the search input to /api/symbols/search, show results

---

## File Map

```
src/
  backend/
    server.ts              — Express API server, all routes
    index.ts               — Entry point for standalone web mode
    services/
      project-scanner.ts   — Recursive dir scan with .gitignore
      monorepo-detector.ts — Workspace type detection
      ast-parser.ts        — tree-sitter WASM parsing
      database.ts          — sql.js SQLite wrapper
      file-watcher.ts      — chokidar file change watcher
  frontend/
    App.tsx                — Root layout component
    bridge/                — API abstraction (HTTP vs Electron IPC)
    components/
      FolderPickerModal.tsx — Project path picker
      layout/              — TopBar, Sidebar, MainCanvas, InspectorPanel, AgentPanel, StatusBar
      graph/nodes/         — PackageNode, DirectoryNode, FileNode, SymbolNode
    stores/                — Zustand: graph, agent, project, ui
    lib/graph-builder.ts   — Converts file tree → ReactFlow nodes/edges
  electron/                — Electron main + preload (untested)
  shared/types/            — Shared TypeScript types
```
