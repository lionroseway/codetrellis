# Implementation Phases

## Phase 1: Foundation
**Goal**: Electron app launches, shows a shell layout, can open a project and display its structure.

### Tasks
- [ ] Scaffold Electron Forge + Vite + React 19 + TypeScript
- [ ] Set up Tailwind CSS 4 + shadcn/ui (dark theme)
- [ ] Build shell layout: Sidebar, TopBar, main canvas area, Inspector, StatusBar
- [ ] Resizable panels (CSS grid + drag handles or allotment library)
- [ ] Typed IPC infrastructure (preload contextBridge, channel types)
- [ ] ProjectScanner: walk directories, respect .gitignore
- [ ] MonorepoDetector: detect npm/pnpm/nx/turbo workspaces
- [ ] SQLite database: schema, migrations, WAL mode
- [ ] Zustand stores: project, graph, agent, ui
- [ ] Shared types: GraphNode, GraphEdge, ParsedFile, AgentEvent
- [ ] Project open dialog (native Electron dialog)
- [ ] File tree sidebar showing packages + files

### Verification
- `npm start` → Electron window opens with dark theme
- Open a monorepo → sidebar shows package/file tree
- Resizable panels work
- Status bar shows project info

---

## Phase 2: AST Engine
**Goal**: Parse source files to function/class level, persist in SQLite, search symbols.

### Tasks
- [ ] Web Worker setup for tree-sitter WASM
- [ ] TypeScript grammar integration
- [ ] JavaScript grammar integration
- [ ] Symbol extraction: functions, classes, methods, interfaces, types, enums
- [ ] Import/export extraction
- [ ] Import resolution: relative paths, package imports, tsconfig path aliases
- [ ] SQLite persistence: files, symbols, imports tables
- [ ] FTS5 virtual table + symbol search
- [ ] FileWatcher (chokidar): detect changes, trigger incremental re-parse
- [ ] Incremental parsing: tree-sitter edit deltas
- [ ] Worker pool (4 workers, sized by hardwareConcurrency)
- [ ] Parse progress reporting to UI

### Verification
- Open a TS project → symbols extracted and stored in SQLite
- Search for a function name → results appear
- Edit a file externally → re-parsed automatically
- Large repo (500+ files) parses without freezing UI

---

## Phase 3: Graph Visualization
**Goal**: Interactive ReactFlow graph showing codebase architecture at multiple depths.

### Tasks
- [ ] ReactFlow integration in main canvas
- [ ] Custom node components: PackageNode, FileNode, ClassNode, FunctionNode
- [ ] Custom edge components: ImportEdge, CallEdge, DependencyEdge
- [ ] GraphBuilder: transforms SQLite data → ReactFlow nodes/edges
- [ ] dagre layout engine (in Web Worker)
- [ ] Hierarchical expand/collapse (double-click)
- [ ] Depth selector: Package / File / Symbol views
- [ ] Filter bar: by language, package, search
- [ ] Minimap
- [ ] Zoom controls + fit-to-view
- [ ] Node inspector panel: details, dependencies, code preview
- [ ] Click node in sidebar → focus in graph
- [ ] Click node in graph → show in inspector

### Verification
- Package view shows monorepo packages with dependency edges
- Expanding a package shows its files
- Expanding a file shows its classes/functions
- Layout is clean and readable
- Smooth pan/zoom on 100+ visible nodes

---

## Phase 4: Agent Integration
**Goal**: Monitor Claude Code activity in real-time, display plans and events.

### Tasks
- [ ] ClaudeCodeWatcher: scan active sessions, tail JSONL
- [ ] Session correlation: match session cwd to monitored project
- [ ] Extract tool calls: file reads, writes, edits
- [ ] Heuristic plan extraction from assistant messages
- [ ] AgentEventBus: normalize events from all sources
- [ ] MCP server: SSE transport on localhost:19432
- [ ] MCP tools: report_plan, report_progress, report_file_change
- [ ] MCP tools: check_architecture, get_dependencies, search_symbols
- [ ] MCP resources: project://structure, project://graph, project://packages
- [ ] Agent panel UI: plan display with step checklist
- [ ] Agent timeline: chronological event log
- [ ] Graph highlighting: pulse active files, color agent-touched nodes
- [ ] "Copy MCP config" button for easy setup
- [ ] Agent status indicator in top bar and status bar

### Verification
- Start Claude Code in monitored project → events appear in timeline
- Agent edits a file → file node pulses in graph
- Report plan via MCP → plan appears in agent panel
- check_architecture via MCP → returns correct subgraph

---

## Phase 5: Architecture Diffing
**Goal**: Show before/after architectural impact of agent changes.

### Tasks
- [ ] Snapshot capture: save graph state at a point in time
- [ ] DiffEngine: compute added/removed/modified nodes and edges
- [ ] Color-coded graph overlay: green (added), orange (modified), red (removed)
- [ ] Diff summary panel: list of changes with counts
- [ ] Before/after split view (two graphs side by side)
- [ ] Impact analysis: highlight blast radius (transitive dependents)
- [ ] Snapshot timeline: scrub through past states
- [ ] Auto-snapshot on agent session start

### Verification
- Agent adds a new file → graph shows green node
- Agent modifies a function → node turns orange, edges update
- Agent deletes a file → node turns red
- Split view shows clear before/after comparison
- Blast radius highlights all affected dependents

---

## Phase 6: Polish & Extensibility
**Goal**: Production-ready with additional languages and quality-of-life features.

### Tasks
- [ ] Python grammar support
- [ ] Rust grammar support
- [ ] Export graph as SVG/PNG
- [ ] Session history: replay past agent sessions
- [ ] Keyboard shortcuts (Cmd+O, Cmd+F, Cmd+1/2/3, Esc)
- [ ] Welcome screen / onboarding flow
- [ ] Auto-update via Electron Forge / Squirrel
- [ ] Performance profiling and optimization
- [ ] Error boundaries and graceful error handling
- [ ] App icon and branding
- [ ] DMG/installer creation

### Verification
- Open a Python project → symbols extracted correctly
- Export graph → clean SVG output
- Keyboard shortcuts work as documented
- Auto-update downloads and applies an update
- Cold start < 2 seconds
