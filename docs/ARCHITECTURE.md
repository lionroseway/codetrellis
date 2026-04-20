# Architecture

## System Overview

```
┌─────────────────────────────────────────┐
│          Electron Main Process          │
│                                         │
│  ProjectScanner    MonorepoDetector     │
│  FileWatcher       ASTCoordinator       │
│  Database (SQLite) MCPServer (SSE)      │
│  ClaudeCodeWatcher AgentEventBus        │
│                                         │
├──────────── IPC (typed) ────────────────┤
│                                         │
│          Electron Renderer              │
│                                         │
│  React 19 + ReactFlow + shadcn/ui      │
│  Zustand stores                         │
│  Web Workers (tree-sitter, diff, layout)│
│                                         │
└─────────────────────────────────────────┘
```

## Main Process Services

### ProjectScanner (`src/main/services/project-scanner.ts`)
- Walks a project directory, respects `.gitignore`
- Identifies source files by extension/language
- Detects monorepo structure via MonorepoDetector
- Emits `ProjectStructure` with packages and file lists
- Does NOT parse AST — delegates to ASTCoordinator

### MonorepoDetector (`src/main/services/monorepo-detector.ts`)
- Reads `package.json` workspaces, `pnpm-workspace.yaml`, `nx.json`, `turbo.json`
- Returns `MonorepoConfig` with workspace root, package locations, inter-package deps
- No dependency on pnpm/nx CLIs — reads config files directly

### FileWatcher (`src/main/services/file-watcher.ts`)
- chokidar watching the project root
- On change: computes content hash → sends to ASTCoordinator if changed
- Emits `FileChanged` events to AgentEventBus for agent correlation
- 300ms debounce for rapid changes

### ASTCoordinator (`src/main/services/ast-coordinator.ts`)
- Receives file lists from ProjectScanner
- Delegates parsing to renderer-side Web Workers via IPC
- Manages parse queue with priority (recently changed files first)
- Caches results in SQLite
- Coordinates incremental re-parsing on file change

### Database (`src/main/services/database.ts`)
- Wraps better-sqlite3 with WAL mode for concurrent reads
- Tables: projects, packages, files, symbols, imports, agent_events
- FTS5 virtual table on symbol names for search
- Stores in Electron's `app.getPath('userData')`

### MCPServer (`src/main/mcp/server.ts`)
- Hosts MCP server on `localhost:19432` (SSE transport)
- Assist tools: `check_architecture`, `get_dependencies`, `search_symbols`
- Plan tool: `report_plan`
- Conformity tool: `check_conformity`
- Resources: `project://structure`, `project://graph`, `project://packages`
- Uses `@modelcontextprotocol/sdk`

### ClaudeCodeWatcher (`src/main/agent/claude-code-watcher.ts`)
- Zero-config integration: watches `~/.claude/projects/` and `~/.claude/sessions/`
- Parses JSONL entries for tool calls (file reads/writes/edits)
- Correlates sessions with monitored project via `cwd`
- Heuristically extracts plan-like content from assistant messages

### AgentEventBus (`src/main/agent/agent-event-bus.ts`)
- Receives events from MCPServer and ClaudeCodeWatcher
- Normalizes into common `AgentEvent` type
- Forwards to renderer via IPC
- Single source of truth for "what is the agent doing"

## Renderer Architecture

### Stores (Zustand)
- **graphStore**: nodes, edges, view depth, expanded nodes, selection, filters
- **agentStore**: events, current plan, active files, agent status
- **projectStore**: root path, monorepo config, packages, scan status
- **uiStore**: panel visibility, panel sizes, theme

### Graph Visualization
- ReactFlow canvas with custom node types (Package, File, Class, Function)
- Custom edge types (Import, Call, Dependency)
- Hierarchical layout via dagre (computed in Web Worker)
- Expand/collapse at each level
- Depth selector: package / file / symbol views

### Web Workers
- **ast-worker.ts**: Loads tree-sitter WASM, parses files, returns structured symbols
- **diff-worker.ts**: Computes architectural diffs between snapshots
- Pool of 4 workers sized by `navigator.hardwareConcurrency`

## Data Flows

### Codebase → Graph
```
Project folder → ProjectScanner → MonorepoDetector
  → ASTCoordinator → AST Web Workers (tree-sitter WASM)
  → SQLite (symbols, imports, files)
  → GraphBuilder → Zustand graphStore → ReactFlow canvas
```

### Agent → UI
```
Claude Code → JSONL → ClaudeCodeWatcher ──┐
Claude Code → MCP → MCPServer ────────────┤
                                           v
                                    AgentEventBus
                                           v
                              agentStore → AgentPanel, Timeline, ImpactOverlay
```

### Live Change Detection
```
Agent edits file → chokidar → ASTCoordinator re-parses
  → DiffEngine (old vs new snapshot) → ArchitectureDiff
  → graphStore.applyDiff() → ReactFlow re-renders
  (green = added, orange = modified, red = removed)
```

## Security Model
- Renderer has no `nodeIntegration` — all Node access via contextBridge preload
- SQLite runs in main process only, queried via IPC
- MCP server binds to localhost only
- File system access scoped to opened project + `~/.claude/`
