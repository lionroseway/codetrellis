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
  <a href="https://github.com/lionroseway/codetrellis-releases/releases/latest">Download</a>
  ·
  <a href="https://github.com/lionroseway/codetrellis/issues">Issues</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="Apache 2.0" /></a>
  <a href="https://github.com/lionroseway/codetrellis-releases/releases/latest"><img src="https://img.shields.io/github/v/release/lionroseway/codetrellis-releases?label=latest&color=blue" alt="Latest release" /></a>
</p>

---

This is the source repo. It is **Apache 2.0 and open** — read it, fork it,
send a patch. Built installers and per-version release notes live on
[**`codetrellis-releases`**](https://github.com/lionroseway/codetrellis-releases/releases/latest),
which is where you should point someone who just wants the app.

That split is deliberate and stays that way: downloads do not depend on this
repo being reachable, so access here can change without taking the app's
distribution down with it. Please don't consolidate the two.

## What it is

CodeTrellis is a desktop app for planning work, running AI coding agents
against those plans, and catching drift early. It works **with or without**
an agent — the planning and architecture surfaces are just as useful when
you are the one writing the code.

The ethos is built on git: every diff, every drift signal, every "is this
commit doing what the plan said it would" check goes through version
control. Plans scale from a one-line "do this thing" to multi-phase
migrations with spec docs, ADRs, UX journeys and success metrics.

When an agent is in the loop it connects over the local MCP server
(`127.0.0.1:19432`) — Claude Code, Codex, Cursor, aider, Claude Desktop,
anything MCP-capable. It reads plans, asks architecture questions, and
reports its tool calls back into the timeline. **The AI compute lives in
your agent**, not in CodeTrellis: no data leaves your machine, no second
subscription, no TOS problem.

## Install

Installers for macOS, Windows and Linux — plus the mobile companion — are
published on the [releases repo](https://github.com/lionroseway/codetrellis-releases/releases/latest),
which carries the current download table and first-launch notes for each
platform. macOS builds are signed and notarized (Developer ID: AILAR
Limited) as of v0.1.10.

To build from this source instead, see [Develop](#develop) below.

## What it does

### 🕸 Dependency graph

- Eleven languages via web-tree-sitter — TypeScript, JavaScript (incl. TSX
  and JSX), Python, Go, Rust, Java, Kotlin, Swift, C#, Ruby, PHP — plus a
  SQL schema and reference tracker
- Three depths: packages, files, symbols (functions / classes / methods)
- Cross-system edges: HTTP / SQL / subprocess coupling across services and
  language boundaries, so a TS frontend `fetch()` into a Python FastAPI
  route renders as one dashed edge
- Architecture diffing — colour as files change, blast-radius
  highlighting, per-line git annotations
- Pan / zoom / minimap / PNG export

### 📄 Code-first surface

The graph is a rendering of the data, not the data — every signal it draws
is attached to files and lines first. So there is a mode where the graph
never mounts: your files, a CodeMirror 6 diff editor, and plan targets drawn
onto the code. Click a changed line and it names the item that wanted it.
On a large repository it is the same information for a fraction of the
layout cost.

### 📋 Plans, phases and spec rooms

- **Plans** group work with phases, items, comments and a spec room (typed
  markdown: requirements, design, ADRs, runbooks)
- **Phases** are first-class checkpoints — scope, prereqs, acceptance
  criteria, editable from the UI or from an MCP client
- **Templates** ship as portable directories: built-ins,
  `<project>/.codetrellis/templates/`, and `~/.codetrellis/templates/`
- **Plan export** round-trips to disk as YAML + markdown, so plans can be
  committed and shared
- **Intake** imports an epic or ticket from an external tracker as a plan

### ✅ Review — what actually landed

Compare any two points in a project's history — a tag, a commit, the
baseline scan, the working tree — and check the diff against the plan that
claimed it. Every item gets a verdict (landed / partly landed / untouched),
files that no item claimed are surfaced as the headline finding rather than
a footnote, and the whole thing drafts the pull request description.

### 🤖 Multi-agent monitoring

- **MCP server** on `127.0.0.1:19432` — ~175 tools across 21 domains:
  architecture, graph, plans, items, spec docs, review, drift, budgets,
  intake, channels, terminals, governance, presence, peers, mobile
- **Authorised per tool by capability**, not per connection — a client is
  granted capabilities, and a tool it was not granted is not there to call.
  Tools that take a path are confined to the projects you have opened
- **Live timeline** — every tool call from any agent is broadcast with
  attribution, so you can replay or audit the session
- **Claude Code session-JSONL watcher** for richer chat-derived signals

### 📱 Mobile companion

An Expo app that pairs with the desktop by QR over a peer-to-peer WebRTC
mesh — no central server, bring your own VPN for remote use. Watch agents,
browse plans, drive terminals and explore the graph from your phone.
Source lives in [`mobile/`](mobile).

### 📖 In-app guide

Seventeen topics on a rail across six groups, openable straight to the page
you need. Every topic carries prompts you can paste into a connected agent.

## Develop

```bash
git clone https://github.com/lionroseway/codetrellis.git
cd codetrellis
npm install
npm run dev
```

That starts the backend (Express on `127.0.0.1:3001` plus the MCP server on
`127.0.0.1:19432`) and the frontend (Vite on `127.0.0.1:5173`). Open
[http://localhost:5173](http://localhost:5173), hit **Open Project**
(`Cmd+O`) and point it at any codebase.

### Checks

```bash
npm run lint          # ESLint — severity policy lives in the flat config
npm run typecheck     # tsc --noEmit
npm run test:unit     # unit suite — pure logic, ~2s
npm run test:harness  # API-level E2E against a real backend, ~5 min
npm test              # browser E2E (Playwright, drives the actual UI)
```

Run `test:unit` as well as the harness rather than instead of it. Two of
its tests are structural guards the harness cannot express: one fails when
a component has no exported name referenced anywhere, i.e. nothing renders
it, and one asserts that no request handler reads a project root straight
off the request. Both exist because what they check is invisible to a grep
and to a green suite.

The browser suite needs a backend running and authenticates with the
per-launch capability token like any other client; the Playwright config
attaches it. It is not in CI, which is how it managed to sit broken for a
whole phase.

### See it work

```bash
npm run demo              # drives a running app through a real piece of work
npm run demo -- --list    # what the catalogue contains
npm run demo -- --pace=slow
```

`npm run demo` opens a codebase, plans a change from a ticket, does the
work, traces it back to the item that wanted it, reviews what landed and
drafts the PR — narrating each scene inside the app window. It is a
verification aid rather than a test: a suite proves the code is consistent
with itself, this proves the product does what it says. Catalogue:
[`docs/DEMO-JOURNEYS.md`](docs/DEMO-JOURNEYS.md).

### Package

```bash
npm run package:mac           # macOS arm64 DMG
npm run package:mac-x64       # macOS Intel DMG
npm run package:mac-universal # both arches
npm run package:mac:signed    # signed + notarized (needs a Developer ID)
npm run package:win           # Windows NSIS installer + portable EXE
npm run package:linux         # Linux AppImage / deb / rpm
```

Built with electron-builder + electron-vite. Windows EXEs build cleanly
from macOS, no Wine needed. `npm run package:mac` does **not** sign — use
`package:mac:signed` for anything you intend to ship.

### Release

```bash
npm run release          # build every platform, publish to the releases repo
npm run release:dry-run  # build only, skip upload
```

`scripts/release.sh` needs a clean tree and `gh auth status` logged in. It
builds and signs macOS **locally** — `node-pty` is a native module, so
Windows and Linux cannot cross-compile and are built on native CI runners
instead. Those runners upload to a transient staging release on this repo,
which the script downloads, publishes to
`lionroseway/codetrellis-releases`, and then deletes. Every artefact is
listed in a `SHA256SUMS` signed with a key that lives only on the release
machine, so the app can verify a download without trusting the server it
came from.

Two things about this that have each cost a release:

**`npm run package:mac` does not sign.** v0.1.13 shipped to the public
repo completely unsigned — `spctl` reported no usable signature — even
though the certificate and credentials were all in place, because that
target is the unsigned one. Only `scripts/release.sh` calls
`package:mac:signed`. Use `package:mac` for local testing and nothing else.

**The mobile half is not automated, and it is easy to lose.** Neither CI
nor the release script builds the companion; CI runs a mobile typecheck
and says so in its own comment rather than letting green imply more than
it means. Both mobile artefacts are built on a machine with the toolchains:

```bash
cd mobile
npx eas-cli build --local --profile production-apk --platform android \
  --output ../out/make/CodeTrellis-Companion-<version>.apk
npx eas-cli build --local --profile production --platform ios \
  --output ../out/make/CodeTrellis-Companion-<version>.ipa
npx eas-cli submit --platform ios --path ../out/make/CodeTrellis-Companion-<version>.ipa
```

`--local` is preferred over EAS's hosted builders: identical config and
credential handling, no queue, no build quota. Build the APK **before**
running the release script and it rides the same signed manifest as
everything else. v0.1.12 and v0.1.13 shipped an APK; v0.1.14 was the first
release cut by the script, which knew nothing about the artefact, so it
silently stopped being published and nothing said a word. The script now
picks it up when present and warns loudly when it is not — but it still
cannot build one for you.

Android has no submit profile yet; the AAB goes to Play Console by hand.
iOS submit is configured and goes to TestFlight.

## Architecture

```
src/
  backend/
    services/
      ast-parser.ts           # tree-sitter WASM parsing
      parsers/<lang>.ts       # per-language symbol + import extraction
      callsites/<lang>.ts     # HTTP / SQL / subprocess / env extractors
      resolvers/<lang>.ts     # import specifier → real file
      sql/                    # SQL schema, refs, embedded-query tracking
      database.ts             # SQLite via better-sqlite3
      project-scanner.ts      # .gitignore-aware walk
      file-watcher.ts         # chokidar live re-parse
      diff-engine.ts          # snapshot-based architecture diffing
      cross-system-service.ts
      plan-*-service.ts       # plans, phases, spec docs, changes, templates
      snapshot-compare-service.ts # comparands + diff between two points
      plan-review-service.ts  # the diff judged against the plan that claimed it
      pr-draft-service.ts     # the PR description that falls out of it
      capability-token.ts     # per-launch local auth
      confined-fs.ts          # project-root confinement
    mcp/tools/                # the MCP surface, grouped by domain
    server.ts                 # Express + WebSocket on 127.0.0.1:3001

  frontend/
    components/               # graph, code, plan, inspector, guide, settings
    stores/                   # zustand
    bridge/                   # HTTP in web mode, IPC in Electron

  electron/                   # main + preload
  shared/                     # types + build info

mobile/                       # Expo companion app
docs/                         # architecture, design and phase docs
```

### How it works

1. **Scan** — walk the codebase honouring `.gitignore`, detect monorepo workspaces
2. **Parse** — tree-sitter extracts symbols and imports per file
3. **Resolve** — `./foo`, `@shared/types`, `from app.routes import x` resolve to real files
4. **Cross-system** — HTTP / SQL / subprocess callsites pair across language boundaries
5. **Store** — SQLite on disk
6. **Graph** — dagre + d3-force layout, rendered by React Flow
7. **Watch** — chokidar re-scans, the drift overlay updates
8. **Plan** — author plans with spec docs; agents pick them up over MCP
9. **Monitor** — every MCP tool call broadcasts to the renderer with attribution
10. **Review** — compare two points, judge the diff against the plan, draft the PR

Deeper docs live in [`docs/claude/`](docs/claude) — runtime topology, the
peer network, the mobile companion, and the MCP tool categories.

## Tech stack

- **Frontend** — React 19, React Flow (`@xyflow/react`) 12, Tailwind CSS 4,
  Zustand 5, CodeMirror 6, Lucide
- **Backend** — Express 5, ws, better-sqlite3
- **AST** — web-tree-sitter with twelve grammars
- **Desktop** — Electron 44 via electron-builder + electron-vite
- **Mobile** — Expo 57 / React Native 0.86, WebRTC
- **MCP** — `@modelcontextprotocol/sdk` over SSE

## Contributing

Issues and pull requests are welcome. Before opening a PR:

- Branch off `main` — no direct pushes
- `npm run lint` and `npm run typecheck` pass
- Test the change **in the running app**, not only in unit tests
- No secrets or keys committed

[`CLAUDE.md`](CLAUDE.md) carries the conventions this codebase is written
to, including the security rules that are not optional. Read that first if
you are touching transports, MCP tools, or anything that takes a path.

## Security

CodeTrellis runs on developer workstations with network reach into the
systems it maps, so the posture is written to match: every local transport
authenticates with a per-launch capability token, loopback is not treated
as an authorisation boundary, CORS is an exact allowlist, and path-taking
surfaces are confined to opened project roots.

Please report vulnerabilities privately to **info@ailar.tech** rather than
in a public issue.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
