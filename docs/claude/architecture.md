# Architecture

CodeTrellis is an Electron desktop app with an embedded Express backend, a Vite-served React renderer, and an Expo/React Native mobile companion. The desktop and mobile communicate peer-to-peer over WebRTC under a "bring your own VPN" connectivity model — see `peer-network.md`.

## Runtime topology

- **Desktop (primary)** — Electron 41, ships installers for macOS (arm64 + x64 DMG), Windows (NSIS Setup + Portable exe), Linux (AppImage, .deb, .rpm).
- **Embedded Express** — runs in-process on `:3001`. Same server is used in Electron and in web/dev mode; web mode is a fallback for browser-based development.
- **Vite dev server** — `:5173`, HMR for the renderer in development.
- **MCP server** — SSE transport on `:19432`. Any MCP-speaking client (Claude Code, Codex, Cursor, aider, Claude Desktop, …) appears as an attributed agent in the timeline. See `mcp-tools.md`.
- **Mobile companion** — Expo SDK 54 + React Native 0.81.5, iOS + Android. Discovers desktops on the LAN and connects over WebRTC. See `mobile-companion.md`.

## Directory layout

```
src/
  backend/              Express app + services + MCP server
    services/           ~50 services, grouped by domain (see below)
    tools/              MCP tool definitions, ~18 categories
    parsers/            Per-language tree-sitter parser plugins
    resolvers/          Per-language import/symbol resolvers
    callsites/          Per-language HTTP/SQL/subprocess callsite extractors
  frontend/             React 19 + Tailwind 4 + ReactFlow 11 renderer
    components/         Domain component trees
    stores/             Zustand stores, one per domain
    bridge/             Runtime transport switch (HTTP / IPC / WebRTC)
    lib/, hooks/
  electron/             Main process + preload
  shared/               Types shared backend ↔ frontend
mobile/                 Expo companion app (see mobile-companion.md)
resources/tree-sitter/  WASM grammars (TS/TSX/JS/JSX/Py/Rust/PHP/Java)
docs/claude/            Reference docs for Claude/agent context (this folder)
```

## Backend service domains

The `src/backend/services/` directory holds ~50 services. Grouped by responsibility:

- **AST & code analysis** — parsers, resolvers, callsites, `cross-system-service`, `system-discovery`, `projection-service`.
- **Peer & pairing** — `peer-connection-service`, `webrtc-service`, `pairing-service`, `pairing-server`, `paired-device-service`, `mdns-service`.
- **Remote execution** — `remote-terminal-service`, `remote-audio-service`, `remote-interaction-service`, `mobile-rpc-service`, `mobile-api-server`, `audio-buffer-service`.
- **Power & lifecycle** — `power-service`, `power-signals`, `state-sync-service`.
- **Plans & collaboration** — `plan-service`, `plan-import-service`, `plan-history-service`, `plan-conflict-service`, `plan-progress-service`, `plan-event-service`, `plan-documents-service`, `plan-templates`, `phase-service`, `spec-service`, `template-service`, `channel-event-service`, `channel-event-file-service`, `channel-dispatcher-service`, `comment-service`, `task-attachments-service`.
- **Governance & drift** — `freeze-service`, `contribution-service`, `deviation-service`, `schema-reconciler`.
- **Persistence & filesystem** — `file-watcher`, `claude-code-watcher`, `recent-projects-service`, `project-config-service`, `settings-service`, `system-docs-service`.
- **Agent comms** — MCP server, `session-service`, `stuck-sensor-service`, `sensor-bridge-service`, `self-write-tracker`.
- **Cross-system & external** — `cross-system-service`, `external-refs-service`, `external-pointer-service`, `pantry-resolution-service`, `personal-sync-service`.
- **Utilities** — `update-service`, `push-notification-service`, `git-activity-service`, `git-commit-service`, `ipc-dispatcher`, `terminal-service`, `trellis-service`.

## Frontend

- **Stores** (Zustand, one per domain) — graph, plan, agent, project, ui, toast, presence, channels, terminal, system-docs.
- **Bridge abstraction** at `src/frontend/bridge/` — picks transport at runtime: HTTP for web/dev, Electron IPC in the desktop app, WebRTC data channels for peer-routed calls. `isElectron()` is the original switch but peer routing extends it.
- **Component trees** — graph (ReactFlow custom nodes + edges, dagre + d3-force layout), plan editor (react-markdown + remark-gfm), terminal (xterm.js), pairing (QR), presence (peer avatars + status), audio (capture/stream UI), settings, top-bar `ConnectedAgents` widget.

## Data layer

- **sql.js** in-memory with autosave to disk + manual export. No FTS yet.
- **Schema self-heal** via `schema-reconciler` — recovers from drift in user-owned data.
- **Tree-sitter WASM** grammars for AST analysis (TS/TSX/JS/JSX/Python/Rust/PHP/Java). Per-language plugins live under `services/parsers/<lang>.ts`, `services/resolvers/<lang>.ts`, `services/callsites/<lang>.ts` and register in the matching `index.ts`.

## Session persistence & power awareness

CodeTrellis treats long-running agent sessions as first-class — desktops don't sleep while agents are working, and reconnects rehydrate state rather than starting fresh.

- **`power-service`** wraps Electron `powerMonitor` + `powerSaveBlocker`. Blocks app/system sleep while agents are active; emits suspend/resume/ac-state events.
- **`power-signals`** is the event stream + heartbeat that other services subscribe to.
- **`state-sync-service`** rehydrates terminal scrollback, plan state, and agent-session metadata when a peer reconnects.
- **`session-service`** tracks agent sessions and attributes tool calls to the originating client.

## Cross-system extraction

Per-language callsite extractors match HTTP / SQL / subprocess / env patterns. `cross-system-service` pairs them across languages to build cross-system edges (e.g. a TS `fetch('/api/foo')` paired with a Python Flask route). System-discovery auto-detects microservices, endpoints, and data flows.
