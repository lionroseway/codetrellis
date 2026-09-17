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

## Phase 19 — Security Hardening (in progress)

CodeTrellis runs on developer workstations with network reach into the
systems it maps, so the security posture has to match that trust tier
before it deploys into managed environments. Phase 19 commissions an
external review, works the findings through gated remediation, and
leaves behind a standing acceptance suite so posture is re-provable on
every release rather than asserted once.

**This repository is public. The finding register is not in it.** It
lives in `docs/private/` (gitignored, CI-enforced) because an open list
of unremediated issues with file paths is an exploitation roadmap, not
documentation. What belongs here is the *rules the review produced* —
those are architecture, and they are below.

### Security rules — these are not optional

Write new code to these regardless of what neighbouring code does. Where
existing code disagrees, the existing code is what Phase 19 is fixing.

- **Loopback is not an authorisation boundary.** Any page in any browser
  on the machine can reach `127.0.0.1`. Every local transport — Express,
  WebSocket, MCP — authenticates with the per-launch capability token.
  Never add surface that assumes the bind address protects it.
- **CORS is an exact allowlist**, never a reflected origin, and never
  with credentials. `Origin: null` is rejected, not trusted. Validate
  `Host` on every request.
- **All sensitive filesystem access goes through the single confined-file
  helper.** Lexical `path.resolve` / `path.relative` containment is
  insufficient — junctions and symlinks defeat it. Canonicalise, reject
  links at sensitive boundaries, re-check immediately before mutation.
- **Never accept `projectRoot` / `projectPath` from a request body.**
  Derive roots from the stored item, plan, or opened-project record.
- **Peer identity comes from the DTLS transport**, never from a
  fingerprint in a request body or in SDP text.
- **MCP tools authorise per tool by capability**, not per connection.
- **Remote surfaces are off by default** and require an explicit user
  action to enable. Discovery and API exposure are separate switches.
- **Chromium sandboxing stays on in every distributed format** that can
  enforce it. AppImage is the known exception and IS distributed — see the
  Tech Stack note below. Do not add another format that weakens the sandbox
  without raising it explicitly.

No release ships until the gates close and the acceptance suite passes on
a tagged candidate and on packaged artifacts.

## Tech Stack

- **Desktop runtime**: Electron (primary) — pinned `^33.4.11`; a major
  upgrade to a currently supported release is Phase 19 work. Embedded
  Express on `:3001`, Vite `^6` on `:5173` in dev. macOS arm64 + x64,
  Windows x64, Linux .deb / .rpm / AppImage. **AppImage IS distributed**,
  and has been in every release since v0.1.11 — an earlier note here claimed
  it was withheld, which was never true of the release script and misdescribed
  what users had already downloaded. The caveat is real though: an AppImage
  runs from a nosuid FUSE mount, so the setuid `chrome-sandbox` helper cannot
  be used and Electron falls back to user namespaces where the kernel allows
  it. `.deb` / `.rpm` keep the setuid helper (`after-install` chmods it) and
  are the better Linux option where a choice exists. Confirming what this
  AppImage actually does at runtime needs a Linux host and is still open.
  Session persistence and
  power-aware sleep prevention are wired in.
- **Mobile runtime**: Expo SDK 54 + React Native 0.81.5 companion app
  in `mobile/`. iOS + Android. Talks to desktop over WebRTC, not HTTP.
- **Frontend**: React 19 + TypeScript, Tailwind CSS 4 (dark theme),
  ReactFlow 11 (custom nodes/edges), Zustand 5, react-markdown +
  remark-gfm.
- **AST**: web-tree-sitter (WASM) — runs synchronously in the
  Express process. 7 languages: TS / TSX / JS / JSX / Python / Rust /
  PHP / Java. Plugin slots for parsers / resolvers / callsites
  per language.
- **Database**: **native SQLite via `better-sqlite3`** (disk-backed, WAL),
  behind a sql.js-shaped facade in `services/database.ts` — the codebase
  still reads as sql.js at the call sites, but storage is native and
  there is no export/autosave step (`persistence.ts` save is a no-op).
  Self-heals via `schema-reconciler`. FTS not yet enabled.
  **This is a native binding.** If it was installed under a different
  architecture or Node version you get `ERR_DLOPEN_FAILED` and *every*
  backend-booting test fails at once:

  ```
  npm rebuild better-sqlite3
  file node_modules/better-sqlite3/build/Release/better_sqlite3.node
  # must say arm64 on Apple Silicon — an x86_64 binary here is the bug
  ```

  This is the single highest-value thing to check when the E2E harness
  fails wholesale. It presented as 88 flaky tests and was one wrong-arch
  `.node` file. It is **not** a Node-version limit: 11.10.0 runs fine on
  Node 25 once rebuilt for the right arch.
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

## Electron + better-sqlite3 move together — always

These two are **one atomic upgrade**. Neither half works alone, and both
failure modes were measured on 2026-09-16, not inferred:

| | bundles Node | N-API |
|---|---|---|
| Electron 33 | 20.18.3 | 9 |
| Electron 44 | 24.21.0 | 10 |

- `better-sqlite3@11` uses **direct V8 APIs** (`Context::GetIsolate`,
  `PropertyCallbackInfo::This`, 2-arg `External::New`). Electron 44's V8
  removed or changed them, so `@electron/rebuild` **fails to compile it**
  and packaging dies outright. It is not N-API, so it must be rebuilt for
  every Electron version.
- `better-sqlite3@13` is N-API (`node-addon-api`) and ships per-platform
  prebuilds, but declares `engines.node >= 22`, so it needs Electron 44's
  Node 24. It also structurally removes the wrong-architecture class of
  failure v11 had.

So: **bump Electron and better-sqlite3 in the same commit.** Verified
together — packaged, launched, and a real 18MB database opened with its
18MB WAL intact (479 files / 2222 symbols / 8 plans / 21 items preserved,
`quick_check` ok).

### A packaged build is the only thing that proves this

Nothing in CI does. CI builds the **web** bundle, and the harness runs
under **Node**, not Electron. A broken pairing passes typecheck, passes
the web build, passes all 139 harness tests, and packages without a
warning — and then cannot open its own database.

When you touch either dependency:

```
npm ci                       # see the warning below — do not skip this
npm run package:mac
CODETRELLIS_DATA_DIR=/tmp/ct-probe \
  out/make/mac-arm64/CodeTrellis.app/Contents/MacOS/CodeTrellis
# confirm data.db appears and the log reaches "Backend initialised"
```

**Always `npm ci` before packaging.** A `node_modules` left over from
several successive `npm install`s produced a silent boot hang — no error,
no log past "App boot" — that looked exactly like a dependency
incompatibility and was not one. A clean install made the same commit boot
perfectly. Do not diagnose a packaging problem from a dirty tree.

To probe the native module alone under the packaged Electron:

```
ELECTRON_RUN_AS_NODE=1 \
  out/make/mac-arm64/CodeTrellis.app/Contents/MacOS/CodeTrellis probe.js
```

### Node 26 is a follow-on, not part of this

`.nvmrc` stays at 22. `better-sqlite3@11` cannot build on Node 26 at all,
so the dev/CI Node was blocked behind this upgrade; with v13 in place it
is now unblocked and can move in its own change.

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

**This source repo is public.** Releases (binaries + release notes) go
to a separate public repo,
[lionroseway/codetrellis-releases](https://github.com/lionroseway/codetrellis-releases),
so download URLs are stable and independent of the source tree — and so
the release resolver needs no authentication.

Two consequences of the source repo being public:

- **Actions minutes are free**, so CI runs on GitHub-hosted runners.
  No self-hosted runner is needed here (unlike `cocodraw`). If this repo
  ever goes private, minutes become metered and that decision flips.
- **Nothing sensitive goes in the tree.** No finding registers, no
  credentials, no customer names. `docs/private/` is gitignored and CI
  fails if anything under it is ever tracked.

#### Automated (preferred)

```bash
npm run release            # builds all platforms, uploads to GitHub
npm run release -- --dry-run   # build only, no upload
npm run release -- --skip-build  # upload existing out/make/* artifacts
```

Runs `scripts/release.sh`. Requires a clean working tree and
`gh auth status` to be logged in. Reads the version from
`package.json`.

How the script is shaped, and why (see [`saif-desktop-app-releases`]):

- **Clean tree is enforced**, so a release is reproducible from the
  commit it claims to be.
- **macOS is built and signed locally**; Windows and Linux are built on
  native CI runners (`.github/workflows/build-installers.yml`), because
  `node-pty` is a native module and cannot cross-compile.
- **CI artifacts move through a transient staging release**, not Actions
  artifacts — Actions storage has a quota and a retention window that
  release assets don't. The staging release is deleted after download.
- **Download globs are version-pinned** (`*-${VERSION}.deb`, not
  `*.deb`). An unpinned glob sweeps a stale build from a previous run
  into the release and nothing about the result looks wrong until a user
  reports the wrong version.
- **Signing identity comes from the environment**
  (`CSC_NAME="…" npm run package:mac`), never the build config — a
  machine with no certificate still produces a build instead of failing.
- **The release manifest is signed** — `SHA256SUMS` plus a detached Ed25519
  signature, generated by `scripts/sign-release-manifest.js` from the same
  file list that gets uploaded. The private key is `scripts/release-signing-key.pem`
  (gitignored, this machine only); the public half is committed at
  `src/backend/services/release-public-key.ts` on purpose, because the app has
  to verify a download without asking a server it would then have to trust.
  **Back the private key up with the Apple credentials** — losing it means
  shipping a new public key in an app update, and every older copy stops being
  able to verify.

### `npm run package:mac` DOES NOT SIGN

This caught us once already: v0.1.13 shipped to the public releases repo
completely unsigned (`spctl` → "no usable signature") even though the
certificate, the credentials and `electron-builder.signed.cjs` were all in
place. It was published with `npm run package:mac`, which is the UNSIGNED
target — `package:mac:signed` is a different script and only `scripts/release.sh`
calls it.

Use `scripts/release.sh` to release. `package:mac` is for local testing.

### Windows code signing: deliberately not done

An OV/EV certificate is a recurring cost (and EV needs a hardware token) to
remove a SmartScreen warning. No security finding depends on it — download
integrity is covered by the signed manifest above, which is platform-neutral.
Revisit only if Windows becomes a primary distribution channel.

The update server is **allowed to be down**: the desktop falls back to
the GitHub Releases API, so codetrellis.dev is a quality-of-life
upgrade, not a dependency. Keep the asset-name→platform resolver in one
module shared by both paths, or they disagree the first time an artifact
is renamed. A platform with no asset in a release must report **no
update** — never 404, and never offer a download the user cannot run.

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
| macOS Apple Silicon | `CodeTrellis-X.Y.Z-arm64.dmg` | Signed + notarised **via `scripts/release.sh` only** |
| macOS Intel | `CodeTrellis-X.Y.Z-x64.dmg` | Signed + notarised **via `scripts/release.sh` only** |
| Checksums | `SHA256SUMS` + `SHA256SUMS.sig` | Signed manifest — the app verifies against this |
| Windows installer | `CodeTrellis-Setup-X.Y.Z.exe` | NSIS, unsigned (SmartScreen warning) |
| Windows portable | `CodeTrellis-Portable-X.Y.Z.exe` | No install needed |
| Linux x64 / arm64 | `CodeTrellis-X.Y.Z-x86_64.AppImage`, `CodeTrellis-X.Y.Z-arm64.AppImage` | `chmod +x` to run |
| Linux x64 | `CodeTrellis-X.Y.Z.deb` / `.rpm` | Native installers |

### Mobile

`mobile/eas.json` exists with 5 build profiles, and **iOS production
submit is already configured** (`ascAppId 6777139934`, AILAR Limited,
team `35GKY9KGZ3`). Android submit is not.

**Expo does not require EAS's hosted builders.** EAS Build is the
optional hosted service; the framework builds locally. Three paths, in
order of preference:

| Path | Command | Queue? |
|---|---|---|
| Local native build | `npm run ios` / `npm run android` | None |
| EAS pipeline, own machine | `npx eas build --local --profile production` | None |
| EAS hosted | `npm run build:prod` | Yes — rate-limited |

Prefer `--local` for releases: identical config and credential handling
to the hosted service, same reproducible output, but it runs on this Mac
so there is no queue and no build quota. It needs `fastlane` for iOS
(`brew install fastlane`) — the only missing piece on this machine;
Xcode 26.4, CocoaPods and the Android SDK are all present.

Then `npx eas submit --platform ios` uses the submit block above.

**This is a CNG (managed) project** — `ios/` and `android/` are
gitignored and regenerated by `expo prebuild`. Never hand-edit the Xcode
project: changes are wiped on the next prebuild. Native config belongs
in `app.json` or a config plugin.

Release flow:

1. Bump version in `mobile/app.json`.
2. `npx eas build --local --profile production --platform ios`
3. `npx eas submit --platform ios`
4. Android: build locally, upload the AAB to Play Console by hand until
   an Android submit profile exists.

Mobile is not integrated into `scripts/release.sh`. Remaining gaps: an
Android submit profile and a `scripts/release-mobile.sh`. See
`docs/claude/mobile-companion.md`.

**Mobile stays Expo / React Native — this is a settled decision.** The
companion is a genuinely native client: WebRTC mesh, four data
channels, binary PTY, audio. That is the case where native modules are
the point, so a webview shell (Capacitor loading a remote URL) is the
wrong architecture — a shell cannot host `react-native-webrtc`. See
[`saif-webview-app-shell`] for the decision rule: the value here is in
the device, not in the pages. Build-queue frustration is not a reason to
re-platform — it is a reason to build locally, per the table above.

**Gate 1.2 of Phase 19 changes the pairing and reconnect
protocol**, so the next mobile release must ship in lockstep
with desktop and will force re-pairing for every existing user.
