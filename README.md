# CodeTrellis

<p align="center">
  <img src="resources/icon.png" alt="CodeTrellis" width="128" height="128" />
</p>

<p align="center">
  <strong>Plan, watch, and keep AI coding agents on track — and yourself too, even when no agent is involved.</strong>
</p>

<p align="center">
  <a href="https://codetrellis.dev">codetrellis.dev</a>
  ·
  <a href="https://github.com/lionroseway/codetrellis-releases/releases/latest">Download installers</a>
</p>

---

This is the **internal source repo** for CodeTrellis. The public-facing
README, downloads, and feedback issues live on the
[**`codetrellis-releases`**](https://github.com/lionroseway/codetrellis-releases)
repo — that's the one to point users at.

## What it is

CodeTrellis is a desktop app I built to help me plan work, run AI
coding agents against those plans, and catch drift early. It works
**with or without** an AI agent — I prefer to focus on architecture
and conformity, and the planning workflow is just as useful when I'm
the one writing the code.

The core ethos is built on git: every diff, every drift signal, every
"is this commit doing what the plan said it would" check goes through
version control. Plans scale from a one-line "do this thing" to
multi-phase migrations with spec docs, ADRs, UX journeys, success
metrics — as simple or as detailed as you want.

When an AI agent is in the loop, it connects via the local MCP server
(`127.0.0.1:19432`) — Claude Code, Codex, Cursor, aider, anything
MCP-capable. The agent reads plans, asks architecture questions, and
reports its tool calls back into the timeline. **The AI compute lives
in your agent**, not in CodeTrellis — no data leaves your machine, no
extra account, no TOS violation.

## Status

> **The source repo is private right now.** I'm collecting feedback on
> the product before opening up the source. Installers are public and
> free to download — try the app and tell me what's confusing,
> broken, or missing. The source goes public once the rough edges are
> smoothed.
>
> Public installer downloads: **[lionroseway/codetrellis-releases](https://github.com/lionroseway/codetrellis-releases/releases/latest)**

## Install

Pre-built installers for macOS, Windows, and Linux are published on
the [public releases repo](https://github.com/lionroseway/codetrellis-releases/releases/latest).

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `CodeTrellis-<version>-arm64.dmg` | Drag to /Applications |
| macOS (Intel) | `CodeTrellis-<version>-x64.dmg` | Drag to /Applications |
| Windows installer | `CodeTrellis-Setup-<version>.exe` | NSIS — installs into Programs |
| Windows portable | `CodeTrellis-Portable-<version>.exe` | Run anywhere |
| Linux AppImage (x64) | `CodeTrellis-<version>.AppImage` | All distros — `chmod +x` then run |
| Linux AppImage (arm64) | `CodeTrellis-<version>-arm64.AppImage` | ARM Linux — same install |

Builds aren't yet code-signed, so the OS will warn on first launch.
On macOS: right-click → **Open** → **Open**. On Windows: **More info**
→ **Run anyway**. The warning won't repeat.

## What it does

### 🕸 Dependency graph
- Multi-language graph (TS / TSX / JS / JSX / Python / Rust / PHP / Java)
  via web-tree-sitter
- Three depths — packages, files, symbols (functions / classes / methods)
- Cross-system edges: HTTP/SQL/subprocess coupling between
  micro-services or polyglot stacks (e.g. a TS frontend `fetch()` to a
  Python FastAPI route renders as one dashed edge)
- Architecture diffing: green/orange/red glow as files change,
  blast-radius highlighting, per-line git annotations
- Pan / zoom / minimap / PNG export

### 📋 Plans, phases, and spec rooms
- **Plans** group work with phases, tasks, comments, and a spec room
  (typed markdown docs: requirements, design, ADRs, runbooks, …)
- **Phases** are first-class checkpoints — scope, prereqs, acceptance
  criteria, all editable from the UI or from an MCP client
- **Templates** ship as portable directories — built-ins (e.g. mass
  refactor), `<project>/.codetrellis/templates/`, and
  `~/.codetrellis/templates/` with `{{key}}` placeholder substitution
- **Plan export** round-trips plans to disk as YAML + markdown so you
  can commit them, share them, or sync them across devices
- **Proposed Changes** view projects every task field as a diff row
  with computed drift status; the agent loop auto-advances tasks to
  `in_progress` when files change and signals `task-completion-suggested`
  when every change is satisfied

### 🤖 Multi-agent monitoring
- **MCP server** on `127.0.0.1:19432` — 30+ tools across architecture
  queries, plans, phases, tasks, spec docs, proposed changes,
  templates, comments, sessions, drift, and trellis snapshots
- **Skill resources** (`codetrellis://skill[/quickstart|/power-user]`)
  so any MCP-capable agent can self-onboard
- **Live timeline** — every tool call from any agent (Claude Code,
  Codex, Cursor, aider, custom) is broadcast as `tool_call` /
  `tool_error` with attribution
- **Connected Agents** widget in the TopBar shows every active session
  with type / model / active plan / last seen
- **Claude Code session-JSONL watcher** for richer chat-derived
  signals (plan heuristics, file activity)

### 🔍 Inspector + code viewer
- Click any node — inspector shows symbols, imports, dependents, drift
- Code viewer with Prism syntax highlighting, git gutter, drift colour-coding
- "Add to plan" from any selection writes a task with the right scope

## Quick start (development)

```bash
git clone <private-repo-url>
cd codetrellis
npm install
npm run dev
```

This starts the backend (Express on `127.0.0.1:3001` + MCP SSE on
`127.0.0.1:19432`) and the frontend (Vite on `127.0.0.1:5173`). Open
[http://localhost:5173](http://localhost:5173).

Click **Open Project** (or `Cmd+O`) and point it at any codebase.
CodeTrellis scans, parses, resolves imports, and renders the graph.

## Build the desktop app

```bash
npm run package:mac           # macOS arm64 DMG
npm run package:mac-x64       # macOS Intel DMG
npm run package:mac-universal # both arches
npm run package:win           # Windows NSIS installer + portable EXE
npm run package:linux         # Linux AppImage (deb/rpm need a Linux runner — see scripts/release.sh)
```

Outputs land in `out/make/`. The build is via **electron-builder +
electron-vite** — Windows EXEs build cleanly from macOS, no Wine
needed.

## Cut a release

```bash
npm run release        # builds all platforms + uploads to the public releases repo
npm run release:dry-run # build only, skip upload
```

The script (`scripts/release.sh`):
1. Builds DMG (arm64 + x64), Windows NSIS + Portable, Linux AppImage (arm64 + x64)
2. Uploads to **`lionroseway/codetrellis-releases`** as a tagged GitHub Release
3. Skips deb + rpm — `fpm` is broken on Apple Silicon and `rpmbuild`
   isn't on macOS at all. AppImage runs on Debian / Ubuntu / Fedora /
   RHEL / Arch unchanged. Switch to a Linux runner if you need deb/rpm.

The source repo (this one) stays private; only the public releases
repo gets the binaries. Source-side tags and CI runs are decoupled.

## Architecture

```
src/
  backend/
    services/
      ast-parser.ts          # tree-sitter WASM parsing (7 langs)
      database.ts            # sql.js SQLite (in-memory + persisted)
      project-scanner.ts     # .gitignore-aware walk
      monorepo-detector.ts
      file-watcher.ts        # chokidar live re-parse
      diff-engine.ts         # snapshot-based architecture diffing
      cross-system-service.ts
      callsites/<lang>.ts    # HTTP / SQL / subprocess / env extractors
      parsers/<lang>.ts      # per-language symbol + import extraction
      resolvers/<lang>.ts
      plan-*-service.ts      # plan, phases, spec docs, changes, templates
      plan-progress-service.ts # auto-advance + completion suggestions
      mcp/server.ts          # 30+ tools, SSE on 127.0.0.1:19432
      logger.ts              # daily file logs
      claude-code-watcher.ts
    server.ts                # Express on 127.0.0.1:3001 + WebSocket

  frontend/
    components/              # graph, layout, plan, inspector, settings
    stores/                  # zustand (graph, agent, project, plan, ui, toast)
    bridge/                  # HTTP for web mode, IPC for Electron
    lib/graph-builder.ts

  electron/                  # main + preload (electron-vite layout)
  shared/                    # types + build-info
```

### How it works

1. **Scan** — walk the codebase honouring `.gitignore`, detect monorepo workspaces
2. **Parse** — tree-sitter parses every source file, extracts symbols + imports
3. **Resolve** — `./foo`, `@shared/types`, `from app.routes import x` all resolve to actual files
4. **Cross-system** — HTTP / SQL / subprocess / env callsites pair across language boundaries
5. **Store** — sql.js SQLite, persisted to disk on a debounced autosave
6. **Graph** — dagre + d3-force layout, React Flow renders
7. **Watch** — chokidar live-rescans, drift overlay updates
8. **Plan** — author multi-phase plans with spec docs; agents pick them up via MCP
9. **Monitor** — every MCP tool call broadcasts to the renderer with agent attribution

## Tech stack

- **Frontend** — React 19, ReactFlow 12, Tailwind CSS 4, Zustand 5,
  Lucide, Allotment, Prism, react-markdown + remark-gfm
- **Backend** — Express 5, ws (WebSocket), sql.js (SQLite WASM)
- **AST** — web-tree-sitter (WASM) with grammars for TS / TSX / JS /
  JSX / Python / Rust / PHP / Java
- **Desktop** — Electron 33 packaged with electron-builder + electron-vite
- **MCP** — `@modelcontextprotocol/sdk` over SSE

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+O` | Open project |
| `Cmd+1` / `2` / `3` | Package / File / Symbol depth |
| `Cmd+B` | Toggle sidebar |
| `Cmd+J` | Toggle agent panel |
| `Cmd+,` | Settings |
| `Esc` | Deselect |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Backend + frontend in web mode |
| `npm run dev:backend` | Backend only |
| `npm run dev:frontend` | Frontend only |
| `npm run dev:electron` | Electron in dev mode |
| `npm run build` | Web-mode production build (typecheck + Vite) |
| `npm run package:mac` / `:win` / `:linux` | Build platform installer |
| `npm run release` | Build all + publish to public releases repo |
| `npm run typecheck` | tsc --noEmit |
| `npm run lint` | ESLint |
| `npm test` | Playwright E2E |

## Feedback

The source isn't open yet — I'm collecting feedback first to
sharpen the rough edges. Bug reports, "this confused me" moments,
missing use cases, and feature requests all welcome on the
[public releases repo](https://github.com/lionroseway/codetrellis-releases/issues)
or by email.

I'll announce there once the source goes public.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
