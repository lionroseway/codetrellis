# CodeTrellis

<p align="center">
  <img src="resources/icon.png" alt="CodeTrellis" width="128" height="128" />
</p>

<p align="center">
  <strong>Visualize your codebase architecture and monitor AI coding agents in real-time</strong>
</p>

<p align="center">
  <a href="https://codetrellis.dev">codetrellis.dev</a>
</p>

---

CodeTrellis is an open-source tool that sits alongside AI coding agents (starting with Claude Code) and provides real-time visibility into what the agent is doing to your codebase. It parses your project's AST, builds a dependency graph, and overlays agent activity so you can understand architectural impact before, during, and after the agent acts.

## Features

### Dependency Graph Visualization
- Interactive graph showing how files connect through imports
- Three depth levels: **Packages** (grouped by directory), **Files** (individual files with import edges), **Symbols** (functions, classes, interfaces)
- Auto-layout with dagre, pan/zoom, minimap
- Click any node to inspect its symbols, imports, and dependents
- Export graph as PNG

### AST Parsing
- Powered by tree-sitter (WASM) — no native dependencies
- **Supported languages:** TypeScript, TSX, JavaScript, Python, Rust, PHP, Java
- Extracts functions, classes, methods, interfaces, types, enums
- Resolves import paths to build file-to-file dependency edges
- Monorepo support: npm workspaces, pnpm, Nx, Turborepo

### AI Agent Monitoring
- **Zero-config Claude Code integration** — automatically detects active sessions by watching `~/.claude/` session files
- Real-time event timeline: see every file read, write, edit, and bash command as it happens
- Plan detection: heuristically extracts numbered/bulleted plans from agent output
- Changes tab: tracks which files the agent has written or edited
- Agent status indicator in the status bar

### Architecture Diffing
- Captures a baseline snapshot when you open a project
- Polls for changes and highlights what's different:
  - **Green glow** — new files
  - **Orange glow** — modified files
  - **Red glow** — deleted files
  - **Purple glow** — files affected by changes (blast radius)
- Detects added/removed import edges

### MCP Server (Agent Integration)

CodeTrellis hosts an MCP (Model Context Protocol) server on `localhost:19432`, making it compatible with **any MCP-enabled AI agent** — not just Claude Code.

**Tools available to agents:**
| Tool | Description |
|------|-------------|
| `search_symbols` | Search functions, classes, interfaces by name |
| `get_dependencies` | Get imports and importedBy for a file |
| `check_architecture` | Query the full dependency graph |
| `report_plan` | Report intended plan (shown in CodeTrellis UI) |
| `check_conformity` | Check if proposed imports create circular dependencies |

**Resources:**
| URI | Description |
|-----|-------------|
| `project://graph` | Full dependency graph as JSON |
| `project://stats` | File/symbol/import counts |

**Connect any agent** — add to your agent's MCP config:
```json
{
  "codetrellis": {
    "type": "sse",
    "url": "http://127.0.0.1:19432/sse"
  }
}
```
Or click the "MCP :19432" button in the status bar to copy the config to your clipboard.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/yourusername/codetrellis.git
cd codetrellis

# Install dependencies
npm install

# Start in web mode (backend + frontend)
npm run dev
```

Open `http://localhost:5173` in your browser.

Click **Open Project** (or `Cmd+O`) and enter the path to any codebase. CodeTrellis will scan it, parse the AST, resolve imports, and render the dependency graph.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open project |
| `Cmd+1` | Package view |
| `Cmd+2` | File view |
| `Cmd+3` | Symbol view |
| `Cmd+B` | Toggle sidebar |
| `Cmd+J` | Toggle agent panel |
| `Escape` | Deselect node |

## Architecture

```
src/
  backend/              # Express API + WebSocket server
    services/
      ast-parser.ts     # tree-sitter WASM parsing
      database.ts       # sql.js SQLite (in-memory)
      project-scanner.ts # Directory scanner with .gitignore
      monorepo-detector.ts
      file-watcher.ts   # chokidar for live re-parsing
      diff-engine.ts    # Architecture snapshot diffing
    agent/
      claude-code-watcher.ts  # Tails Claude Code JSONL sessions
    server.ts           # Express routes + WebSocket

  frontend/             # React 19 + ReactFlow
    components/
      graph/nodes/      # Custom ReactFlow nodes (Package, File, Symbol)
      layout/           # TopBar, Sidebar, MainCanvas, Inspector, AgentPanel, StatusBar
      WelcomeScreen.tsx
      ErrorBoundary.tsx
    stores/             # Zustand (graph, agent, project, ui)
    bridge/             # API abstraction (HTTP for web, IPC for Electron)
    lib/graph-builder.ts # Converts dependency data to ReactFlow graph

  shared/types/         # TypeScript types shared between backend/frontend
  electron/             # Electron wrapper (main + preload)
```

### How It Works

1. **Scan** — ProjectScanner walks your codebase respecting `.gitignore`, detects monorepo workspaces
2. **Parse** — tree-sitter parses every source file, extracts symbols and imports
3. **Resolve** — Import paths (`./foo`, `@shared/types`) are resolved to actual file paths
4. **Store** — Everything persisted in SQLite (in-memory via sql.js)
5. **Graph** — Dependency edges built from resolved imports, rendered with ReactFlow + dagre layout
6. **Watch** — chokidar monitors file changes, re-parses and updates the graph
7. **Monitor** — Claude Code watcher tails JSONL session files, broadcasts events via WebSocket

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/project/scan` | POST | Scan a project, parse AST, resolve imports |
| `/api/dependencies` | GET | All file-to-file import edges |
| `/api/dependencies/file?path=...` | GET | Imports and importedBy for a file |
| `/api/symbols/search?q=...` | GET | Search symbols by name |
| `/api/symbols/file?path=...` | GET | Symbols in a specific file |
| `/api/diff?project=...` | GET | Architecture diff (current vs baseline) |
| `/api/agent/status` | GET | Claude Code watcher status |
| `/api/fs/browse?path=...` | GET | Browse directories (for folder picker) |
| `/api/stats` | GET | Database stats |

WebSocket on `/ws` broadcasts real-time events: agent activity, file changes.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend (web mode) |
| `npm run dev:backend` | Backend only (Express on :3001) |
| `npm run dev:frontend` | Frontend only (Vite on :5173) |
| `npm run start:electron` | Electron mode (requires macOS fix) |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type checking |

## Tech Stack

- **Frontend:** React 19, ReactFlow, Tailwind CSS 4, Zustand, Lucide icons
- **Backend:** Express, WebSocket (ws), sql.js (SQLite WASM)
- **AST:** web-tree-sitter with grammars for TS, JS, Python, Rust, PHP, Java
- **Desktop:** Electron (optional, blocked by macOS 26 bug)

## Roadmap

- [ ] Session history — replay past agent sessions
- [ ] Search UI in frontend (backend search API exists)
- [ ] Resizable panels
- [ ] Go and C# grammar support
- [ ] Performance optimization for 1000+ file repos
- [ ] Electron desktop app (blocked by macOS 26 bug)

## License

MIT
