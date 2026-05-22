# CodeTrellis

## Project Overview

A web/desktop app (codetrellis.dev) that monitors AI coding agents and
visualises their impact on codebase architecture in real time. Provides
a dependency graph of codebases (packages → files → classes/functions
+ cross-system HTTP/SQL coupling), overlays agent plans and changes,
and lets developers understand what an AI agent is doing before /
during / after it acts.

CodeTrellis is *agent-agnostic*: any client that speaks MCP (Claude
Code, Codex, Cursor, aider, custom) appears in the timeline and the
TopBar `ConnectedAgents` widget. Claude Code additionally has a
session-JSONL watcher for richer chat-derived signals.

## Tech Stack

- **Runtime**: web mode (Express :3001 + Vite :5173). Electron 41
  wrapper exists but is untested due to the macOS 26 SIGKILL bug.
- **Frontend**: React 19 + TypeScript, Tailwind CSS 4 (dark theme),
  ReactFlow 11 (custom nodes/edges), Zustand 5, react-markdown +
  remark-gfm.
- **AST**: web-tree-sitter (WASM) — runs synchronously in the
  Express process. 7 languages: TS / TSX / JS / JSX / Python / Rust /
  PHP / Java. Plugin slots for parsers / resolvers / callsites
  per language.
- **Database**: sql.js (in-memory, persisted to disk via export +
  autosave). FTS not yet enabled.
- **Agent comms**: Local MCP server (SSE on :19432) — every tool call
  from any agent is broadcast as `tool_call` / `tool_error`. Claude
  Code session-JSONL watcher tails `~/.claude/sessions/<id>.jsonl`
  for chat-derived plan heuristics.
- **Cross-system extraction**: per-language callsite extractors
  (`callsites/<lang>.ts`) match HTTP / SQL / subprocess / env
  patterns; `cross-system-service` pairs them across languages.
- **Layout**: dagre + d3-force in the renderer.

## Architecture

- `src/backend/` — Express server, services (parsers, resolvers,
  callsites, plan + spec + phase + template + changes services,
  cross-system matcher, deviation detector, MCP server, file watcher,
  Claude Code watcher).
- `src/frontend/` — React app (components, stores, hooks, lib, bridge).
- `src/electron/` — untested Electron wrapper (preload + main).
- `src/shared/` — types shared between backend + frontend.

## Key Conventions

- Plan / phase / spec-doc / proposed-change / template authoring lives
  in dedicated services under `src/backend/services/plan-*-service.ts`.
- Plan templates are pure data in `services/plan-templates.ts`.
- Spec doc bodies are markdown; rendered with react-markdown + GFM.
- Per-language plugins live in `services/parsers/<lang>.ts`,
  `services/resolvers/<lang>.ts`, `services/callsites/<lang>.ts` —
  registered in the matching `index.ts`.
- Zustand stores in `src/frontend/stores/` — one per domain
  (graph, agent, project, plan, ui, toast).
- Tree-sitter WASM grammars stored in `resources/tree-sitter/`.
- Bridge abstraction in `src/frontend/bridge/` chooses HTTP or
  Electron IPC at runtime (`isElectron()`).
- All MCP tool calls broadcast on the `tool_call` / `tool_error`
  channel with agent attribution; PlanPanel Timeline tab renders.

## Commands

- `npm run dev` — Run in web mode with HMR (Express :3001 + Vite :5173)
- `npm run build` — Build for production
- `npm run package:mac` — Build macOS DMGs (arm64 + x64)
- `npm run package:win` — Build Windows installers (Setup + Portable exe)
- `npm run package:linux` — Build Linux packages (AppImage, deb, rpm)
- `npm run lint` — Run ESLint
- `npm run typecheck` — Run TypeScript type checking

## Releasing

Source stays in the private `codetrellis` repo. Releases (binaries +
release notes) go to the **public** repo
[lionroseway/codetrellis-releases](https://github.com/lionroseway/codetrellis-releases).

### Automated (preferred)

```bash
npm run release            # builds all platforms, uploads to GitHub
npm run release -- --dry-run   # build only, no upload
npm run release -- --skip-build  # upload existing out/make/* artifacts
```

Runs `scripts/release.sh`. Requires a clean working tree and
`gh auth status` to be logged in. Reads the version from
`package.json`.

### Manual steps

1. **Bump version** in `package.json`.
2. **Build artifacts** — from macOS you can build all three platforms:
   ```bash
   npm run package:mac          # arm64 + x64 DMGs and zips
   npm run package:win          # NSIS Setup + Portable exe (x64)
   npx electron-builder --linux AppImage --x64   # x64 AppImage
   ```
   `node-pty` prevents cross-compiling arm64 Linux from macOS.
   Artifacts land in `out/make/`.
3. **Update the releases repo README** — bump the version in the
   download table at `/Users/saif/Workspaces/AILAR/codetrellis-releases/README.md`,
   commit, and push to `main`.
4. **Create the GitHub release** on the releases repo:
   ```bash
   gh release create v0.1.X \
     out/make/CodeTrellis-0.1.X-arm64.dmg \
     out/make/CodeTrellis-0.1.X-x64.dmg \
     out/make/CodeTrellis-Setup-0.1.X.exe \
     out/make/CodeTrellis-Portable-0.1.X.exe \
     out/make/CodeTrellis-0.1.X.AppImage \
     --repo lionroseway/codetrellis-releases \
     --title "v0.1.X" \
     --notes-file <release-notes-file>
   ```
5. **Commit the version bump** in the source repo.

### Expected artifacts per release

| Platform | File | Notes |
|---|---|---|
| macOS Apple Silicon | `CodeTrellis-X.Y.Z-arm64.dmg` | Unsigned — users need `xattr -cr` |
| macOS Intel | `CodeTrellis-X.Y.Z-x64.dmg` | Unsigned |
| Windows installer | `CodeTrellis-Setup-X.Y.Z.exe` | NSIS, unsigned (SmartScreen warning) |
| Windows portable | `CodeTrellis-Portable-X.Y.Z.exe` | No install needed |
| Linux x64 | `CodeTrellis-X.Y.Z.AppImage` | `chmod +x` to run |
