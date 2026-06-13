# CodeTrellis

## Project Overview

A desktop + mobile app (codetrellis.dev) that monitors AI coding agents and
visualises their impact on codebase architecture in real time. Provides a
dependency graph of codebases (packages → files → classes/functions +
cross-system HTTP/SQL coupling), overlays agent plans and changes, and
lets developers understand what an AI agent is doing before / during /
after it acts.

CodeTrellis is **agent-agnostic**: any client that speaks MCP (Claude
Code, Codex, Cursor, aider, Claude Desktop, custom) appears in the
timeline and the TopBar `ConnectedAgents` widget. Claude Code
additionally has a session-JSONL watcher for richer chat-derived signals.

CodeTrellis is also **device-agnostic**: the desktop pairs with a mobile
companion app over a peer-to-peer WebRTC mesh (no central server, "bring
your own VPN" for remote use), letting users monitor and steer agents
from their phone.

## Reference docs

Deep-dive docs live in `docs/claude/`:

- [`docs/claude/architecture.md`](docs/claude/architecture.md) — runtime topology, directory layout, service domains, session persistence, power awareness.
- [`docs/claude/peer-network.md`](docs/claude/peer-network.md) — BYO-VPN model, mDNS discovery, WebRTC mesh, the four data channels, QR pairing.
- [`docs/claude/mobile-companion.md`](docs/claude/mobile-companion.md) — Expo app, routes, RPC/bridge layers, mobile MCP commands, release flow.
- [`docs/claude/mcp-tools.md`](docs/claude/mcp-tools.md) — the 18 MCP tool categories grouped by domain.

The team's design docs (vision, UX, plans) live alongside these at the
`docs/` root — `ARCHITECTURE.md`, `MCP-INTEGRATION.md`, etc.

## Tech Stack

- **Desktop runtime**: Electron 41 (primary). Embedded Express on `:3001`,
  Vite on `:5173` in dev. macOS arm64 + x64, Windows x64, Linux
  AppImage / .deb / .rpm. Session persistence and power-aware sleep
  prevention are wired in.
- **Mobile runtime**: Expo SDK 54 + React Native 0.81.5 companion app
  in `mobile/`. iOS + Android. Talks to desktop over WebRTC, not HTTP.
- **Frontend**: React 19 + TypeScript, Tailwind CSS 4 (dark theme),
  ReactFlow 11 (custom nodes/edges), Zustand 5, react-markdown +
  remark-gfm.
- **AST**: web-tree-sitter (WASM) — runs synchronously in the
  Express process. 7 languages: TS / TSX / JS / JSX / Python / Rust /
  PHP / Java. Plugin slots for parsers / resolvers / callsites
  per language.
- **Database**: sql.js (in-memory, persisted to disk via export +
  autosave). Self-heals via `schema-reconciler`. FTS not yet enabled.
- **Peer transport**: WebRTC mesh — `werift` on desktop,
  `react-native-webrtc` on mobile. Four named data channels:
  `control` (JSON-RPC), `ui` (snapshots + JSON patches), `terminal`
  (binary PTY), `audio` (WebM/Opus). mDNS discovery via
  `_codetrellis._tcp`.
- **Agent comms**: Local MCP server (SSE on `:19432`) — every tool call
  from any agent is broadcast as `tool_call` / `tool_error`. Claude
  Code session-JSONL watcher tails `~/.claude/sessions/<id>.jsonl`
  for chat-derived plan heuristics.
- **Cross-system extraction**: per-language callsite extractors
  (`callsites/<lang>.ts`) match HTTP / SQL / subprocess / env
  patterns; `cross-system-service` pairs them across languages;
  `system-discovery` auto-detects microservices and endpoints.
- **Layout**: dagre + d3-force in the renderer.

## Directory layout

- `src/backend/` — Express server + ~50 services (grouped by domain in
  `docs/claude/architecture.md`) + MCP server + parsers/resolvers/callsites.
- `src/frontend/` — React app: components, Zustand stores, hooks, lib,
  bridge.
- `src/electron/` — Main process + preload (now production, not the
  untested stub it used to be).
- `src/shared/` — Types shared backend ↔ frontend.
- `mobile/` — Expo / React Native companion (see `docs/claude/mobile-companion.md`).
- `resources/tree-sitter/` — WASM grammars.

## Key Conventions

- Plan / phase / spec-doc / proposed-change / template authoring lives
  in dedicated services under `src/backend/services/plan-*-service.ts`.
- Plan templates are pure data in `services/plan-templates.ts`.
- Spec doc bodies are markdown; rendered with react-markdown + GFM.
- Per-language plugins live in `services/parsers/<lang>.ts`,
  `services/resolvers/<lang>.ts`, `services/callsites/<lang>.ts` —
  registered in the matching `index.ts`.
- Zustand stores in `src/frontend/stores/` — one per domain
  (graph, agent, project, plan, ui, toast, presence, channels,
  terminal, system-docs).
- Tree-sitter WASM grammars stored in `resources/tree-sitter/`.
- Bridge abstraction in `src/frontend/bridge/` picks transport at
  runtime: HTTP for web/dev, Electron IPC for desktop, WebRTC data
  channels for peer-routed calls.
- All MCP tool calls broadcast on the `tool_call` / `tool_error`
  channel with agent attribution; PlanPanel Timeline tab renders.
- MCP tools group into 18 files under `src/backend/mcp/tools/` —
  one file per domain (plans, items, channels, peers, terminals,
  audio, mobile, system docs, git, governance, drift, architecture,
  contributions, graph, presence, sessions, project config, UI).
- Mobile uses `mobile/lib/rpc.ts` for JSON-RPC over the `control`
  channel; state syncs via snapshots + `fast-json-patch` diffs on
  the `ui` channel.
- Per-service services follow `*-service.ts` naming; remote variants
  (`remote-terminal-service`, `remote-audio-service`,
  `remote-interaction-service`, `mobile-rpc-service`) wrap local
  services and route through WebRTC.

## Commands

### Desktop

- `npm run dev` — Run with HMR (Express :3001 + Vite :5173, Electron shell)
- `npm run build` — Build for production
- `npm run package:mac` — Build macOS DMGs (arm64 + x64)
- `npm run package:win` — Build Windows installers (Setup + Portable exe)
- `npm run package:linux` — Build Linux packages (AppImage, deb, rpm)
- `npm run lint` — Run ESLint
- `npm run typecheck` — Run TypeScript type checking

### Mobile

Run from `mobile/`:

- `npm start` — Expo dev server
- `npm run dev` — `expo start --dev-client` (required for `react-native-webrtc`)
- `npm run ios` / `npm run android` — Local build + run
- `npm run build:dev` / `build:preview` / `build:prod` — EAS builds
- `npm run lint`, `npm run typecheck`

## Releasing

### Desktop

Source stays in the private `codetrellis` repo. Releases (binaries +
release notes) go to the **public** repo
[lionroseway/codetrellis-releases](https://github.com/lionroseway/codetrellis-releases).

#### Automated (preferred)

```bash
npm run release            # builds all platforms, uploads to GitHub
npm run release -- --dry-run   # build only, no upload
npm run release -- --skip-build  # upload existing out/make/* artifacts
```

Runs `scripts/release.sh`. Requires a clean working tree and
`gh auth status` to be logged in. Reads the version from
`package.json`.

#### Manual steps

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

#### Expected desktop artifacts per release

| Platform | File | Notes |
|---|---|---|
| macOS Apple Silicon | `CodeTrellis-X.Y.Z-arm64.dmg` | Unsigned — users need `xattr -cr` |
| macOS Intel | `CodeTrellis-X.Y.Z-x64.dmg` | Unsigned |
| Windows installer | `CodeTrellis-Setup-X.Y.Z.exe` | NSIS, unsigned (SmartScreen warning) |
| Windows portable | `CodeTrellis-Portable-X.Y.Z.exe` | No install needed |
| Linux x64 | `CodeTrellis-X.Y.Z.AppImage` | `chmod +x` to run |
| Linux x64 | `CodeTrellis-X.Y.Z.deb` / `.rpm` | Native installers |

### Mobile

Mobile release is **build-only today** — no `eas.json` and no submit
configuration yet, so App Store / Play Console submission is manual:

1. Bump version in `mobile/app.json`.
2. `cd mobile && npm run build:prod` — kicks off EAS build for both
   platforms (project ID `47be6d4e-2e16-47a9-958d-afb4ebaab412`,
   org `ailar`).
3. Download IPA / AAB from EAS once builds complete.
4. Submit manually to TestFlight / Play Console.

Mobile is not integrated into `scripts/release.sh`. When mobile
release is formalised, add `mobile/eas.json` with build + submit
profiles and a `scripts/release-mobile.sh`. See
`docs/claude/mobile-companion.md` for the full gap list.
