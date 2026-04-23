# CodeTrellis

## Project Overview
A web/desktop app (codetrellis.dev) that monitors AI coding agents (starting with Codex) and visualizes their impact on codebase architecture in real-time. Provides a dependency graph of codebases (packages → files → classes/functions), overlays agent plans and changes, and lets developers understand what an AI agent is doing before/during/after it acts.

## Tech Stack
- **Runtime**: Electron 41 + Electron Forge + Vite
- **Frontend**: React 19 + TypeScript
- **UI**: shadcn/ui + Tailwind CSS 4 (dark theme first)
- **Graph**: ReactFlow 11 (custom nodes/edges)
- **State**: Zustand 5
- **AST**: web-tree-sitter (WASM) in Web Workers
- **Database**: better-sqlite3 (WAL mode, FTS5)
- **Agent comms**: Local MCP server (SSE on :19432) + Codex JSONL watcher
- **Layout**: dagre + ELK in Web Workers

## Architecture
- `src/main/` — Electron main process (services, IPC handlers, MCP server, agent watchers)
- `src/preload/` — contextBridge API (no nodeIntegration)
- `src/renderer/` — React app (components, stores, hooks, lib)
- `src/workers/` — Web Workers (AST parsing, diff computation)
- `src/shared/` — Types and constants shared between main/renderer

## Key Conventions
- All IPC channels are typed via `IpcChannelMap` in `src/shared/types/ipc.ts`
- Zustand stores in `src/renderer/stores/` — one per domain (graph, agent, project, ui)
- shadcn/ui components go in `src/renderer/components/ui/`
- Tree-sitter WASM grammars stored in `resources/tree-sitter/`
- SQLite database stored in Electron's `userData` directory
- All agent events normalized through `AgentEventBus` before reaching the renderer

## Commands
- `npm start` — Run in development mode with HMR
- `npm run build` — Build for production
- `npm run package` — Package the Electron app
- `npm run make` — Create distributable installers
- `npm run lint` — Run ESLint
- `npm run typecheck` — Run TypeScript type checking
