# Implementation Tracker

Last updated: 2026-04-28 (post E2E harness Phase 1)
Supersedes: `CODE-GRAPH-CHECKLIST.md`, `IMPLEMENTATION-PHASES.md`, `GAP-ANALYSIS.md` (consolidated here)

This is the running source of truth for what CodeTrellis ships, what's
in flight, and what's still missing — in one place. Vision and design
docs ([CORE-VISION.md](CORE-VISION.md), [THREE-TRELLIS.md](THREE-TRELLIS.md),
[CLUSTER-FIRST-VISION.md](CLUSTER-FIRST-VISION.md),
[GRAPH-UX-REFINEMENT.md](GRAPH-UX-REFINEMENT.md),
[DATA-MODEL.md](DATA-MODEL.md), [MCP-INTEGRATION.md](MCP-INTEGRATION.md),
[UI-DESIGN.md](UI-DESIGN.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[PLAN-EXPORT.md](PLAN-EXPORT.md), [E2E-HARNESS.md](E2E-HARNESS.md))
remain canonical for *what* and *why*; this doc is for *where things
stand*.

---

## 0. Architecture Note

Running in web mode (Express :3001 + Vite :5173) due to macOS 26
Electron SIGKILL bug. Electron wrapper exists but is untested. Code is
shared via the bridge abstraction.

---

## 1. Domain Status (rough completion against [CORE-VISION.md](CORE-VISION.md))

| Domain | % | Quality | Key state |
|---|---|---|---|
| Data Model & Types | 100 | High | Plan, Task, Comment, PlanDocument, ProjectionData, Trellis snapshots all typed |
| Database Persistence | 100 | Good | sql.js with file export — survives restarts |
| AST Parsing (7 langs) | 100 | High | TS/TSX/JS/JSX, Python, Rust, PHP, Java — all with proper per-language symbol AND import extraction via the plugin architecture (parsers/ + resolvers/). Go and SQL pending. |
| Multi-System Ingestion | 75 | High | Phase 1 + 2 + plugin refactor done. Real swf scan: 2552 edges (1688 Py + 591 tsx + 273 ts), 13 systems discovered, all `@swf/*` aliases resolve. Cross-system MVP shipped (HTTP TS↔Python). Remaining: systems DB + UI, SQL / subprocess / env matchers, server-side per-scope views. |
| Cross-system edges | 30 | Medium | MVP shipped: TS/JS `fetch(...)` + `axios.*` ↔ Python FastAPI/Flask route matcher. New `callsites/<lang>.ts` plugin slot + `cross-system-service` matcher + dashed protocol-tinted graph edges. REST + MCP (`list_cross_system_edges`). Pending: SQL ref tracker, subprocess, env-configured URLs, OpenAPI contracts. |
| MCP Server | 100 | High | 30+ tools across architecture queries / plans / phases / tasks / spec docs / proposed-changes / templates / comments / sessions / drift / trellis snapshots. Skill resources (`codetrellis://skill[/quickstart|/power-user]`). |
| Claude Code Watcher | 100 | High | Tails session JSONL, extracts tool calls + plan heuristics |
| Generic MCP-agent activity | 100 | High | Phase 12 §D — `registerTool` wrapper broadcasts `tool_call` / `tool_error` events with agent attribution. Codex / Cursor / aider / any MCP client now surfaces in the Agent Timeline alongside Claude Code. |
| Plan CRUD + Comments + Versions | 100 | High | Phase 12 done end-to-end: §A Phases, §B Proposed Changes, §C doc ordering, §D + §D2 multi-agent timeline + visibility, §E skill, §F multi-doc-per-type, §G Mass-refactor template. Plans scale from light one-liners to deep swf-style multi-phase migrations with their own granular CRUD feed. Outstanding: version viewer UI, task-level comments. |
| Spec Room (typed plan docs) | 100 | High | 12 doc types, MCP + REST + UI + version history + restore + Phase 12 §C orderHint + parentDocUid (swf-style `00-…/01-…` nesting; tree-rendered in the spec room) + §F multi-doc per type with auto-numbered defaults. |
| Plan Phases (first-class checkpoints) | 100 | High | Phase 12 §A. `plan_phases` table + service + REST + 4 MCP tools (`add/list/update/delete_plan_phase`); `update_task` / `get_next_task` accept `phase_uid`. UI: `PlanPhases` groups tasks by phase with expandable scope/prereqs/acceptance markdown + "Unphased" bucket. |
| Proposed Changes view | 100 | High | Phase 12 §B. `plan-changes-service` projects every task field into ProposedChange rows with computed drift status. REST + MCP (`list_proposed_changes` / `get_changes_summary` / `get_change_status`) + new "Proposed" tab in PlanPanel with status filter chips. |
| Agent loop closure | 100 | High | `plan-progress-service` auto-advances `pending`/`assigned` tasks to `in_progress` when an `affectedFiles` entry changes on disk; broadcasts `task-completion-suggested` when every ProposedChange for an in-flight task is `satisfied`. `VerificationPanel` on PlanDetail shows planned-vs-landed at a glance with a colour-coded "Ready to ship / Mid-flight / Drifted" readout. Closes front-to-back loop steps 9 + 11. |
| Plan Templates | 100 | High | Phase 12 §G. `plan-templates.ts` (pure data); `applyTemplate` seeds plan + phases + spec docs in one sweep. First template: **mass-refactor** (6 phases + 10 docs incl. swf-style numbering + cross-cutting patterns/testing/security). REST + MCP (`list_plan_templates` / `create_plan_from_template`) + PlanCreateModal "From template" tab. |
| Agent skill / instructions resource | 100 | High | Phase 12 §E. Three MCP resources: `codetrellis://skill` (project-tailored summary listing current plans + connected agents), `…/quickstart` (first-time flow), `…/power-user` (deep usage incl. phase + template guidance). Markdown so any MCP-capable agent can ingest. |
| Multi-agent visibility (TopBar) | 100 | High | Phase 12 §D2. `ConnectedAgents` widget replaces the single-agent pill; popover shows every active MCP session (type, model, active plan, last seen) and refreshes live on session events. `register_session` / `set_active_plan` keyed off the caller's transport sessionId so multiple simultaneous agents stay attributed. |
| Three Trellis States | 85 | Medium | Snapshots + projection + baseline pin/auto/branch — modes don't yet read as visually unmistakable |
| Architecture Diffing | 90 | High | File-level + edge-level drift; per-line git annotations; pluggable plan scope |
| Inspector + Code Viewer | 100 | High | Cluster/file/symbol routing + Prism syntax highlighting + git gutter + drift coloring + selection-to-task |
| Graph Visualization | 75 | Medium | Glassmorphic nodes, curved edges, cluster discovery, selection emphasis, per-system scope filter, files-view no longer hides files silently, regular edges no longer animated (perf fix). **Missing: node-level drift ring, semantic zoom, mode visual distinctness, system-aware clustering, server-side per-scope views.** |
| Real-time Activity Visualization | 60 | Medium | recently-changed pulse + edge drift; node drift not yet wired |
| Toast Notifications | 100 | Good | Wired to plans, tasks, deviations, conflicts, sessions, plan-doc events |
| Deviation Detection | 75 | Medium | Service + MCP tools + file-watcher hook; needs more detection types and graph surfacing |
| Conflict Detection | 70 | Medium | File-level conflict on claim_task with broadcast |
| Onboarding | 100 | High | Welcome + recent projects + Getting Started checklist |
| Multi-tab projects | 100 | Good | Open multiple projects/worktrees as TopBar tabs |
| Visual Plan Builder | 35 | Medium | "Add to plan" from the inspector exists; clicking nodes-on-graph to author isn't wired |
| Multi-Agent Dashboard | 25 | Medium | TopBar `ConnectedAgents` (Phase 12 §D2) is the v1 — count + popover per session. Dedicated dashboard with per-agent cards, drift attribution, and conflict resolution UI not yet started. |
| Plan export / source-controllable plans | 100 | High | Phase 13 §A + §B + §C all shipped. Plans round-trip to disk as YAML + markdown (§A), linked plans auto-sync via write-through + chokidar (§B), and templates ship as portable directories (§C — built-ins + `<project>/.codetrellis/templates/` + `~/.codetrellis/templates/` with `{{key}}` placeholder substitution). Multi-device + multi-team workflows fully covered via git. Spec: [PLAN-EXPORT.md](PLAN-EXPORT.md). |
| Electron desktop build | 100 | High | `npm run package:mac` / `:win` / `:linux` (electron-builder + electron-vite) produces working DMG (arm64 + x64, ~115 MB), NSIS installer EXE + Portable EXE (90 MB), DEB / RPM / AppImage. **Windows EXE builds cleanly from macOS** — no Wine. Backend embedded; loopback-only (127.0.0.1); CORS for `file://`; sql.js + web-tree-sitter shipped via `extraResources`; tree-sitter WASM grammars same. Build metadata generated at packaging time (`scripts/generate-build-info.js` via the `prepackage` npm hook) and exposed via `/api/build-info` + Settings → About. File logging at `<dataDir>/logs/<YYYY-MM-DD>.log` with daily rollover; Settings → Logs shows live tail + Reveal. **GitHub Actions release workflow** (`.github/workflows/release.yml`) builds DMG / EXE / DEB / RPM / AppImage on native runners on every `v*` tag push and attaches them to a Release. Code-signing scaffolding conditional on repo secrets. Outstanding: real signing certs, auto-updater. |
| Auto-updater | 5 | – | **Spec'd, not wired.** Currently users have to download a fresh installer to update. Plan: in-app polls a website-mediated OTA endpoint (see Website domain), surfaces a non-blocking banner when a newer build exists, opens the platform installer URL in the system browser on click. Auto-download + apply on quit comes after code-signing lands (too easy to corrupt installs without it). Settings → About already shows build time + commit + a "Check for updates" affordance can re-poll on demand. |
| Website (codetrellis.dev) | 0 | – | **Specs done, not built.** Design + build specs drafted (lives in the AILAR-Website monorepo, not here, to avoid leaking internal infra into a soon-to-be-public source repo). Three jobs: marketing pages, the right installer for the visitor's platform, and the OTA update API the desktop app polls. **Headline contract:** the website is the single source of truth for "what's the latest version + where do I download it" — moves installer hosting (S3, R2, anywhere) become URL changes on the site, not desktop-app re-shipments. Endpoints: `/api/updates/check` (desktop-app polled), `/api/updates/latest` (downloads metadata), `/api/revalidate` (webhook from `release.sh` to flush cache on publish). Built on the AILAR Next.js workspace conventions (port 3003, PORT env-overridable for nginx). |
| Code-signing | 0 | – | **Not done — biggest first-impression cliff.** Builds are unsigned; first launch warns on macOS (Gatekeeper) and Windows (SmartScreen). Bypassable but rough. macOS needs Apple Developer ID (~$99/y) + notarization; Windows needs an EV cert (~$200-400/y) for instant SmartScreen trust. CI workflow already wires the env-var-conditional signing path (`CSC_LINK`, `WIN_CSC_LINK`, `APPLE_ID`, `APPLE_TEAM_ID`); it's a no-op until secrets are added. Blocks proper auto-updater (electron-updater needs signed builds for trust verification). |
| Public releases repo | 100 | High | `lionroseway/codetrellis-releases` — public repo seeded with README + Apache 2.0 LICENSE that hosts every installer release. Decoupled from the (currently private) source repo so download URLs can be shared without exposing source. `scripts/release.sh` (`npm run release`) builds DMG / NSIS / Portable / AppImage in one shot from macOS host and uploads to a tagged Release on this repo. v0.1.0 live with 6 platform installers. |
| Settings surface | 100 | High | Phase 13 §D shipped. Gear icon in TopBar → modal with 5 sections (Identity / MCP Server / Plans / Data / Telemetry). Persisted to `<dataDir>/settings.json`. REST `GET/PUT /api/settings`, `GET /api/identity/git-defaults`. MCP port now reads from settings + autodetects on collision (walks forward up to 10 ports). `CODETRELLIS_DATA_DIR` env var honoured (used by E2E harness per [E2E-HARNESS.md §7](E2E-HARNESS.md)). |
| Learn Trellis (in-app onboarding) | 0 | – | Full-screen UI-takeover that walks users through CodeTrellis end-to-end: open a project → see graph → make a plan → wire an agent → watch it land → verify completion. Tooltip-driven wizard with skippable steps; designed so a developer becomes productive in under 10 minutes without reading docs. Needs design pass before code. |
| E2E test harness | 50 | Medium | **Phase 1 shipped (Apr 28, 2026).** `tests/fixtures/sample-app/` (27-file TS workspace + Python FastAPI fixture) + `tests/harness/` (fixture lifecycle with `git init`, free-port allocator, child-process backend, typed REST client, one-call `setupHarness()`) + `tests/e2e/smoke.test.ts` (~4 s green). `npm run test:harness` boots a fresh backend in a tmp data dir, scans the fixture, asserts deterministic counts, tears everything down — no developer's `~/.codetrellis/` touched. Phase 2 (loop tests with scripted MCP agent), Phase 3 (plan-export round-trip), Phase 4 (visual snapshots) still pending. Originally designed: Today's Playwright suite hits the real running app and is flaky (folder-picker, stale plans, port collisions, no clock control, no agent simulation). Design covers: in-tree fixture repo (`tests/fixtures/sample-app/` — TS + Python, 25 files, known cross-system pairs), a scripted MCP agent (deterministic, no real LLM), per-test tmp data dir (`CODETRELLIS_DATA_DIR` env var), dynamic port allocation, an in-process `services/clock.ts` for timestamp control, and a 4-phase delivery (scaffolding → loop tests → plan-export round-trip → optional visual diffs). |

---

## 2. Recently Shipped

### Apr 28, 2026 — E2E harness Phase 1 (fixture + scaffolding + smoke test)

The first slice of the [E2E-HARNESS.md](E2E-HARNESS.md) design. Until
this landed, every "shipped" feature was effectively shipped to a
state that worked once on the maintainer's machine — there was no way
to re-prove the loop on a clean checkout.

**Fixture repo** (`tests/fixtures/sample-app/`, 27 files): TS workspace
(`@sample/shared` + `@sample/web`) plus a Python FastAPI service.
Cross-system HTTP coupling between `packages/web/src/api.ts`'s
`fetch('/api/users')` calls and `services/api/app/routes/{users,orders}.py`'s
`@router.{get,post}('/api/...')` decorators — known matchable pairs the
matcher can find. Fixture template stays pristine in the repo; tests
clone it into a tmp dir and `git init` for the diff engine.

**Harness scaffolding** (`tests/harness/`):
- `paths.ts` — REPO_ROOT, fixture template, tmp-dir helpers
- `fixture.ts` — clones template → `tests/.tmp/<test-id>/sample-app/`,
  runs `git init` + commit with pinned author/committer/timestamp
  (stable initial-commit SHA across runs from a clean checkout),
  returns a `cleanup()` that wipes the whole tmp dir
- `ports.ts` — free-port allocator via `net.listen(0)` (no `get-port` dep)
- `backend.ts` — spawns the backend as a child process with isolated
  `CODETRELLIS_DATA_DIR`, `CODETRELLIS_BACKEND_PORT`,
  `CODETRELLIS_MCP_PORT`, waits for `/api/build-info` to answer 200,
  buffers stderr for diagnostics, kills cleanly on teardown
- `client.ts` — typed REST helpers (scan, stats, plans, cross-system,
  build-info, raw escape hatch)
- `index.ts` — `setupHarness(name)` one-call: fixture + backend +
  client + `teardown()`

**Backend additions:**
- `services/clock.ts` — abstraction over `Date.now()` /
  `new Date().toISOString()` so tests can pin time. Default
  byte-identical to the real clock; `_setClockForTesting()` swaps in
  a controllable one. Codemod of existing `Date.now()` sites
  intentionally deferred — partial migration is safe.

**Smoke test** (`tests/e2e/smoke.test.ts`):
- Boots the harness, asserts the fixture is materialised + git-init'd,
  hits `/api/build-info`, scans the fixture (file/symbol/import
  counts), checks ≥ 2 cross-system HTTP edges (TS↔Python pairings),
  searches for the `User` symbol, asserts the tmp dir is deleted on
  teardown.
- Second test boots two harnesses in a row and verifies isolation:
  different tmp dirs, different ports, plans don't leak.

**Wiring:**
- `playwright.harness.config.ts` — separate from the legacy
  `playwright.config.ts` (which still hits the dev backend on
  hardcoded ports). No `webServer` block — the harness manages its
  own subprocesses. `testDir: tests/e2e/`, `testMatch: *.test.ts`.
- `npm run test:harness` runs the suite. Total runtime: ~4 s.

**Result:** `npm run test:harness` from a clean checkout boots a fresh
backend in a tmp dir, scans a known fixture, asserts deterministic
counts, and tears everything down — without touching
`~/.codetrellis/`. Phase 2 (loop tests with a scripted MCP agent) and
Phase 3 (plan-export round-trip) can now be built on this.

Tracker §1 E2E test harness 35 → 50 (Phase 1 complete; Phase 2-4 still
pending).

### Apr 28, 2026 — Public releases pipeline + Apache 2.0 + website specs

After the electron-builder migration landed, focus shifted to making
the product actually distributable while keeping the source private
during the feedback phase.

**Public releases repo + script.** Created `lionroseway/codetrellis-releases`
(public) as the dedicated home for installer downloads. Source stays
in the (currently private) `lionroseway/codetrellis` until the
feedback round is done. `scripts/release.sh` (`npm run release` /
`:dry-run`) builds DMG (arm64 + x64), NSIS Setup + Portable EXE, and
Linux AppImage (arm64 + x64) from a single macOS host, then uploads
all six to a tagged GitHub Release on the public repo. rpm + deb
intentionally skipped — `rpmbuild` isn't on macOS at all and
electron-builder's bundled `fpm` produces 96-byte truncated archives
on Apple Silicon (open issue upstream). AppImage runs unchanged on
Debian / Ubuntu / Fedora / RHEL / Arch so the userbase is covered.
Switch to a Linux runner if/when deb/rpm need to come back.

**v0.1.0 published.** 6 installers live at
[codetrellis-releases/releases/tag/v0.1.0](https://github.com/lionroseway/codetrellis-releases/releases/tag/v0.1.0).
Tag-trigger on the GitHub Actions release workflow temporarily
disabled (`workflow_dispatch` only) while the source repo is private
and Actions minutes count against quota.

**Apache 2.0 license.** LICENSE swapped from MIT to Apache 2.0;
`license` field added to `package.json` plus `homepage` + `repository`
pointers to the public releases repo. Carried through to the public
releases repo too.

**README rewrite.** Both READMEs (private + public) rewritten in
first-person voice with the actual product story: why the tool was
built (architecture-and-conformity focus, drift catching, planning
discipline borrowed from the maintainer's best AI sessions), how it's
actually used in real workflows (re-running with different agents,
splitting work across agents, recursive runs, high-level monitoring,
context refresh + multi-device), and a prominent privacy / cost block
("no data leaves your machine; AI compute lives in your agent; AI
cost stays inside your existing AI usage; no TOS violation"). Public
README leads with a 6-row download table.

**codetrellis.dev specs drafted.** Design + build specs for the
public marketing + OTA-update site. Specs live in the AILAR-Website
monorepo (not in this repo — the build spec necessarily references
internal infra paths and sister-app conventions). Headline build
decision: a website-mediated OTA update API. Desktop app will poll
`/api/updates/check?platform=…&current=…` — the website is the only
place that knows where downloads live, so the installer hosting
backend can move (GitHub Releases → S3 → CDN) by editing one resolver
on the site, no desktop-app re-shipment. `/api/updates/latest` for
public download metadata; `POST /api/revalidate` webhook from
`release.sh` flushes the cache the moment a new release is published.

Tracker §1 row adjustments: `Auto-updater` clarified (waits on
signing for full electron-updater); new rows for `Website` and
`Code-signing`; `Public releases repo` 100. §7 picks up new top-tier
items for OTA wiring + website build.

### Apr 28, 2026 — Migrated to electron-builder + electron-vite (Windows EXE from macOS works)

Replaced the electron-forge + plugin-vite + maker-squirrel stack
with **electron-builder + electron-vite**, mirroring the swf
project's setup. Headline win: `npm run package:win` now produces
`CodeTrellis-Setup-0.1.0.exe` (NSIS, 94 MB) **from macOS** —
no Wine, no Mono, no opaque Squirrel exit codes. NSIS is a native
binary builder-binaries ships, so cross-compilation Just Works.

Surface area:
- `electron.vite.config.ts` consolidates the three per-target Vite
  configs (`vite.main.config.ts`, `vite.preload.config.ts`,
  `vite.renderer.config.ts` — all deleted) into one. Output lands
  at `out/{main,preload,renderer}` instead of the old
  `.vite/build/` + `.vite/renderer/` split.
- `forge.config.ts` deleted. Its packaging config translated into
  the `build` block in `package.json` (electron-builder's
  convention): `appId`, `productName`, `directories.output`,
  `extraResources` for tree-sitter / sql.js / web-tree-sitter,
  `mac.target` (dmg + zip, arm64 + x64), `win.target` (nsis +
  portable, x64), `linux.target` (deb + rpm + AppImage), DMG
  layout with the Applications shortcut preserved.
- Build-info + icon scripts now run via the `prepackage` npm-script
  hook (was a Forge `generateAssets` hook).
- `src/electron/main.ts` reads `ELECTRON_RENDERER_URL` (electron-
  vite's dev convention) instead of `MAIN_WINDOW_VITE_DEV_SERVER_URL`;
  renderer + preload paths updated for the new layout.
- `.github/workflows/release.yml` switched to `package:mac-universal`
  / `package:linux` / `package:win` and the new `out/make/*.{dmg,
  exe,deb,rpm,AppImage}` artefact globs. Standard
  electron-builder env names (`CSC_LINK`, `WIN_CSC_LINK`,
  `APPLE_ID` …) for code-signing — no-op without secrets.

Verified locally on macos-15 / arm64:
- `npm run package:mac` → `CodeTrellis-0.1.0-arm64.dmg` (111 MB) +
  `CodeTrellis-0.1.0-x64.dmg` (115 MB) + zips.
- `npm run package:win` → `CodeTrellis-Setup-0.1.0.exe` (90 MB) +
  `CodeTrellis-Portable-0.1.0.exe` (89 MB).
- `app.asar` + `Resources/{tree-sitter,sql.js,web-tree-sitter}` all
  present in the unpacked bundle.

Tracker §1 Electron desktop build kept at 100. New baseline: cross-
platform installers from a single host.

### Apr 27, 2026 — Electron DMG / EXE shipped

The audit's five-point punch list cleared. `npm run make`
produces a launchable `CodeTrellis-0.1.0-arm64.dmg` (98 MB) on
macOS plus a cross-platform zip. Windows installer config in place
(needs a Windows host to actually build).

The renderer-bundling miss was the headline bug: vite's `root:
'src/frontend'` made it write the build to
`src/frontend/.vite/renderer/main_window/` while Forge looked at
`<repo>/.vite/renderer/main_window/`. Window opened on a blank
screen because the `.app` shipped with `package.json` + `main.js`
+ `preload.js` and nothing else.

Plus tree-sitter WASMs now ship via `extraResource` and
`ast-parser.ts` probes `process.resourcesPath` in production;
icons regenerate from `resources/icon.png` via `png2icons` in a
Forge `generateAssets` hook; maker-squirrel + maker-deb +
maker-rpm wired alongside maker-dmg; `osxSign` / `osxNotarize` /
Squirrel `certificateFile` all conditional on env vars so
unsigned builds still work for testing.

Tracker §1 Electron desktop build 30 → 90. §7 #8 ✅. Outstanding:
GitHub Actions release workflow, real signing certs.

### Apr 27, 2026 — Templates as publishable repos (Phase 13 §C)

Phase 13 closes out. Plan templates are now portable directories
that travel through git like any other repo artifact.

- **Disk template loading** — `plan-templates.ts` walks built-ins
  + `~/.codetrellis/templates/<id>/` (user-global) +
  `<projectRoot>/.codetrellis/templates/<id>/` (project-local;
  highest priority — project wins ID collisions). Each template
  is a directory with `template.yaml` + `docs/<order>-<slug>.md`.
- **Publish service** — `plan-template-publish-service.ts`
  snapshots a plan to disk in the same format. Strips
  project-specific bits: task statuses → `pending`, assignees
  cleared, phase status reset, git checkpoints null. Doc bodies
  go to separate `.md` files referenced via `bodyPath`.
- **Placeholders** — templates can declare `placeholders:` in
  `template.yaml` (each with `key`, optional `label`, `default`).
  At apply time, `{{key}}` tokens in every string field — phase
  titles, scope, doc bodies, file paths in tasks — get
  substituted from the user's input (or the placeholder default).
  Templates without placeholders work unchanged.
- **Source merging** — `listTemplates(projectRoot)` returns built-
  ins + user-global + project-local with a `source` discriminator.
  UI shows a Project / User badge so the user can tell where each
  template came from.
- **REST**: `POST /api/plans/:uid/publish-as-template`,
  `GET /api/plan-templates?project=<root>`,
  `POST /api/plans/from-template` accepts `placeholderValues`.
- **MCP**: new `publish_plan_as_template`. `list_plan_templates`
  takes `project_root`. `create_plan_from_template` takes
  `placeholder_values`.
- **UI**: "Publish as template" button on the plan header opens
  a small modal asking only for the slug + label + short
  description. PlanCreateModal "From template" tab now shows
  source badges and renders a placeholder-collection form when
  the chosen template declares any.

The flow: a team writes one canonical "Company Mass Refactor"
template, publishes it, commits to git. Other projects
`git clone https://github.com/team/codetrellis-templates
.codetrellis/templates/team`. The CodeTrellis instance picks it
up automatically on next project open. No registry, no cloud.

Tracker §1 Plan-export domain row 70 → 100. §3 Phase 13 marked
DONE. §7 next-pushes shifts to Electron build fixes (DMG / EXE).

### Apr 27, 2026 — Auto-sync (Phase 13 §B)

The file is the source of truth now. Every plan / phase / task / doc
mutation auto-exports to `.codetrellis/plans/<slug>/` (debounced 200ms);
external edits to those files (after `git pull`, hand-edit, another
tool) re-import idempotently into the DB.

- **Write-through**: `plan-file-service.scheduleWriteThrough(planUid)`
  is called from `notifyMutation` helpers added to plan-service,
  plan-phases-service, plan-documents-service. Lazy-required to dodge
  the import cycle. No-op if the plan isn't linked (no
  `.codetrellis/plans/<slug>/plan.yaml` on disk) — opt-in per plan.
- **File watcher**: `startPlanFileWatcher(projectRoot)` runs chokidar
  against `<projectRoot>/.codetrellis/plans/` (depth 4 covers slug /
  phases|tasks|docs / file). On change/add/unlink: locate the
  containing plan dir, re-import.
- **Self-write stamping**: every `writeFileAtomic` call stamps
  `recentSelfWrites`; the watcher skips files we just wrote (1s TTL).
  Plus an `importDepth` guard suppresses write-through during a
  re-import — belt-and-braces against the file→DB→file ping-pong.
- **YAML conflict markers**: detected (`<<<<<<<` / `=======` /
  `>>>>>>>`) and broadcast as `plan-file-conflict`. Frontend toasts
  with the file path; we don't try to in-app resolve — the user fixes
  in their editor and the watcher picks up the clean file.
- **REST**: `GET /api/plans/:uid/file-status` (is it linked?) +
  `POST /api/plans/:uid/unlink` (delete the dir; DB rows survive).
- **MCP**: `unlink_plan_from_files(plan_uid, project_root)`.
- **UI**: PlanDetail header shows a green **Linked** pill when the
  plan is on disk; hover flips it to **Unlink** with confirm. The
  not-linked state shows **Link to disk** (renamed from "Export").
  WS handler distinguishes `source: 'file-watcher'` imports from
  manual ones — toast text matches.

Tracker §1 Plan export 35 → 70. §3 Phase 13 §B row ✅. §7
next-pushes shifts to §C (templates as publishable repos).

### Apr 27, 2026 — Manual plan export / import (Phase 13 §A)

The headline multi-device feature is real now. `git push` your
plans alongside the code; teammates / your other machines
`git pull` and one-click import.

- **`plan-file-service.ts`** round-trips plan + phases + tasks +
  spec docs between SQL and disk per the layout in
  [PLAN-EXPORT.md §3](PLAN-EXPORT.md): `plan.yaml`, `phases/NN-slug.yaml`,
  `tasks/NNN-slug.yaml`, `docs/order-slug.md` (with YAML front-
  matter for metadata, markdown body untouched). Slug = title-slug
  + 8-char UID prefix to avoid clashes.
- **Idempotent**: re-export overwrites the same files; re-import
  upserts by UID (existing rows get updated, new ones created).
  UID is canonical — renaming a file doesn't fork its history.
- **Auto-creates** `<project>/.codetrellis/.gitignore` with
  `cache/` so runtime state never gets committed.
- **REST**: `POST /api/plans/:uid/export?path=…`,
  `POST /api/plans/import?path=…`,
  `GET /api/plans/discover?project=…`.
- **MCP**: `export_plan_to_files`, `import_plan_from_files`,
  `discover_plan_files`. Surfaced in the skill cheat sheet.
- **UI**: Export button on the plan header. PlanList grows a
  "Found N plans on disk" callout when the project has committed
  plans not yet in the DB, with one-click Import per plan.
- **WS**: `plan-imported` / `plan-exported` broadcasts so other
  windows refresh.
- **MCP autodetect logging fix**: when port 19432 was busy, the
  console double-printed "Server running on…" because the failing
  `app.listen()` callback was still attached when the retry
  succeeded. Now uses paired `once('listening')` + `once('error')`
  with mutual cleanup. One log line per successful bind.

Tracker §1 Plan-export domain row 0 → 35 (§A done; §B + §C
pending). §3 Phase 13 §A row updated to ✅. §7 next-pushes shifts
to §B (auto-sync).

### Apr 27, 2026 — Settings surface + identity (Phase 13 §D + §E)

First code from Phase 13. Unblocks everything else.

- **`settings-service.ts`** owns `<dataDir>/settings.json`. Lazy
  cached, additive schema (older files missing new fields stay
  valid via `mergeWithDefaults`). `getAuthorKey()` returns the
  configured identity email or falls back to the legacy
  `'human'`/`'agent'` role string — backwards compatible with
  every existing row.
- **`readGitIdentity(projectPath?)`** shells out to `git config
  --get user.name` / `user.email` so the Identity section
  pre-fills from the user's existing git config — zero-config for
  the 95% case.
- **MCP port**: was hardcoded `19432`. Now reads from
  `settings.mcp.port` (env var `CODETRELLIS_MCP_PORT` overrides
  for tests), and on `EADDRINUSE` walks forward up to 10 ports if
  `mcp.autodetectOnCollision` is on. The actually-bound port is
  reported via `getMcpStatus()` and broadcast as
  `mcp-port-changed` so the "Copy MCP config" snippets stay
  accurate.
- **Persistence env var**: `~/.codetrellis/` becomes
  `resolveDataDir()` with priority env > settings override >
  default. Required by [E2E-HARNESS.md §7](E2E-HARNESS.md) for
  per-test data isolation.
- **REST**: `GET/PUT /api/settings`, `GET /api/identity/git-defaults`.
  Save broadcasts `settings-changed` (other open windows refresh
  on next open) and `mcp-port-config-changed` if the port
  preference moved.
- **REST authoring sites** now resolve `author` via
  `getAuthorKey('human')` — `POST /api/plans`, plan-doc create,
  comment create. New plans/tasks/comments carry the user's email
  once the Identity section is filled.
- **UI**: new gear icon in the TopBar → `SettingsModal` with
  5 sections (Identity, MCP Server, Plans, Data, Telemetry).
  Identity has a "Pull from `git config`" button. MCP shows the
  bound port if it differs from configured + a Copy button for
  the agent config JSON. Plans has a Shared/Local toggle for
  the default visibility (used once §A lands). Data has the dir
  override. Telemetry says "Off." with a paragraph on why.
- **Skill cheat sheet** updated: agents are told the MCP port may
  not be the default and how to fetch the bound port from
  `/api/mcp/status`.

### Apr 27, 2026 — Phase 13 + E2E design + Electron build audit

Not code — design + tracker hygiene to set the next phase up cleanly.

- **[PLAN-EXPORT.md](PLAN-EXPORT.md)** — full design for plans as
  source-controllable artefacts. Directory of YAML + markdown under
  `<project>/.codetrellis/plans/`, file-as-source-of-truth with DB
  cache, auto-sync via file watcher, `git config`-derived identity,
  configurable MCP port via settings panel, three-phase delivery
  (manual → auto-sync → publishable templates). The headline
  feature for the multi-device + multi-agent story.
- **[E2E-HARNESS.md](E2E-HARNESS.md)** — full design for the E2E
  test harness that catches loop regressions on PR. In-tree
  fixture repo (`tests/fixtures/sample-app/` — TS + Python, ~25
  files, known cross-system pairs), scripted MCP agent (no real
  LLM), per-test tmp data dir, dynamic port allocation,
  controllable clock, four-phase delivery (scaffolding → loop
  tests → plan-export round-trip → optional visual diffs).
- **Electron build verified non-functional** — `npm run package`
  runs to completion but the resulting `.app` is missing the
  renderer, tree-sitter WASM, and a proper icon. Five small fixes
  documented in §7 #8.
- **Tracker reshape** — new Phase 13 section, new domain rows for
  Plan Export, Electron desktop build, Settings surface, Learn
  Trellis, and E2E test harness. Next-pushes queue reordered to
  put Phase 13 §D/§E (settings + identity) at the top since they
  unblock everything else.

### Apr 27, 2026 — Polish pass for "ready to use"

Push 3 of "ready-to-use" — friction items that snag real use:

- **Diff mode auto-engages projection** — switching to `diff`
  trellis mode now auto-flips `projectionEnabled` if a projection
  is loaded. No more "why is the diff blank?" surprise.
- **All pre-existing TS errors fixed**. `npm run typecheck` is now
  clean (was 18 errors). Specifically:
  - `PlanStatus` re-export ambiguity resolved by renaming
    `agent.ts`'s legacy type → `AgentPlanStatus` (the AgentPlan
    chat-derived shape's status, distinct from the persisted
    `Plan.status`).
  - `useRef<ReturnType<typeof setTimeout>>()` initial-value
    warnings cleaned up.
  - `electronAPI` `possibly 'undefined'` warnings — env.d.ts now
    explicitly notes the bridge is gated by `isElectron()`, with
    `!` assertions on the call sites.
  - `bridge/index.ts` BridgeAPI null narrowing.
  - `http-bridge.ts` WSHandler callback typing.
  - `database.ts` row implicit-any annotations on every
    `.values.map((row) => …)`.
  - New `src/backend/types/sql-js.d.ts` shim for the missing
    `@types/sql.js` (declares the exact subset we use).
- **AGENTS.md / CLAUDE.md reconciled** — both files now describe
  the agent-agnostic MCP model (any tool-call broadcasts
  attribution; Claude Code adds the JSONL watcher) and reflect
  the actual `src/backend/` + `src/frontend/` structure, sql.js
  storage, plugin slots, and synchronous AST.

### Apr 27, 2026 — Cross-system MVP (TS ↔ Python HTTP)

Push 2 of "ready-to-use". Mixed repos no longer look like islands.

- **New plugin slot**: `callsites/<lang>.ts` mirrors the existing
  `parsers/` / `resolvers/` shape. Adding a new language's
  callsite extraction = drop a file, list it in the index.
- **TS / JS extractors**: regex-match `fetch('/api/...')`,
  `axios.get/post/put/...`. Method inferred from `{ method: 'POST' }`
  options or the axios verb. Template-literal placeholders
  `${id}` normalise to `:id`.
- **Python extractor**: regex-match FastAPI/APIRouter `@router.get(...)`,
  Flask `@app.route(..., methods=[...])` (fans out one row per
  method), and outbound `requests.get/post/...`. FastAPI `{user_id}`
  normalises to `:id` so routes match the TS template-literal style.
- **Schema**: `callsites` (per-file row per extracted callsite) +
  `cross_system_edges` (matched pairs). Both wiped + re-derived on
  every scan; `clearAstData` knows about them.
- **Matcher**: `cross-system-service.recomputeCrossSystemEdges()`
  groups routes by `${METHOD} ${path}`, scans calls, emits one
  edge per pair. Self-loops + ambiguous matches dropped.
- **Graph render**: cross-system edges split out of the main
  import pipeline at the top of `buildDependencyGraph`, then
  appended after layout as dashed protocol-tinted edges
  (purple HTTP) with the route as the label.
- **Wire-up**: scan orchestrator calls
  `recomputeCrossSystemEdges()` after `resolveImports()`.
- **REST**: `/api/dependencies?include=cross_system` merges them
  into the existing edge list with a `kind` discriminator;
  `/api/cross-system` returns just the cross-system edges +
  stats.
- **MCP**: `list_cross_system_edges` exposes the full feed (with
  per-protocol stats) so agents can ask "how does the frontend
  talk to the backend?" in one call.

### Apr 27, 2026 — Agent loop closure (front-to-back step 9 + 11)

Push 1 of the "ready-to-use" sprint. The agent loop now closes
without the human having to read every diff:

- **`plan-progress-service`** — file watcher hook auto-advances
  `pending`/`assigned` tasks to `in_progress` when one of their
  `affectedFiles` changes on disk. Toast notes the auto-promotion
  ("Task auto-started · A file in this task changed"). Avoids the
  "agent forgot to call update_task" silent-progress problem.
- **`task-completion-suggested` event** — once every
  ProposedChange for an in-flight task reads as `satisfied`, the
  service broadcasts a one-shot suggestion (deduped per task). The
  toast tells the human "all N proposed changes satisfied — review
  and mark done if you agree." We deliberately don't auto-mark
  `done`; false positives would erode trust.
- **`VerificationPanel`** — new card on PlanDetail. Reads
  `/api/plans/:uid/changes?summary=1` and renders a stacked bar
  with a colour-coded headline: green "Ready to ship", accent
  "Mid-flight", amber "Drifted" (if any change is `missing` or
  `unexpected`). Re-runs on click. Hidden for plans with no
  proposed changes so light plans don't get a confusing "0%" card.

### Apr 27, 2026 — Phase 12 complete (Deepening Plans + Agent Skills)

All seven sub-phases shipped end-to-end across schema, service, REST,
MCP, and UI. Plans now scale from a one-line title to a full swf-style
multi-phase migration without changing how light plans work.

- **§A — Plan Phases (first-class checkpoints)**: `plan_phases` table
  with phase_number / scope / prerequisites / git_checkpoint /
  acceptance_criteria / status; `tasks.phase_uid` nullable column.
  MCP: `add_plan_phase`, `list_plan_phases`, `update_plan_phase`,
  `delete_plan_phase`; `update_task` and `get_next_task` extended with
  `phase_uid` (empty string clears / scopes to unphased). UI:
  `PlanPhases` renders phases above tasks, expandable rows show
  markdown scope/prereqs/acceptance + bound tasks; "Unphased" bucket
  lets the user reassign loose tasks via dropdown.
- **§B — Proposed Changes view**: `plan-changes-service` projects every
  task field (`affectedFiles`, `symbolSpecs`, `newConnections`,
  `removedConnections`) into a CRUD-style row with operation /
  kind / target / freshly computed drift status (planned /
  in_progress / satisfied / missing / unexpected). REST + MCP
  (`list_proposed_changes` / `get_changes_summary` /
  `get_change_status`) + new "Proposed" tab in PlanPanel.
- **§C — Spec doc ordering + nesting**: `plan_documents.order_hint` +
  `parent_doc_uid` columns; SpecRoom now renders as a tree with
  order-prefixed labels; SpecDocCreateModal auto-suggests the next
  prefix and offers a parent dropdown. Supports the swf
  "00-EXECUTIVE / 01-PHASE-1 / …" pattern natively.
- **§D — Generic MCP-agent timeline**: `registerTool` wrapper
  broadcasts `tool_call` / `tool_error` events with agent attribution
  inferred from the SSE session. PlanPanel Timeline tab renders them
  with per-event icons + duration. Codex / Cursor / aider / any MCP
  client now visible alongside Claude Code.
- **§D2 — Multi-agent visibility (TopBar)**: `ConnectedAgents` widget
  replaces the single-agent pill — shows count + popover listing
  every active MCP session (type, model, active plan, last seen);
  WS auto-refreshes on session events. `register_session` /
  `set_active_plan` keyed off the caller's transport sessionId so
  N simultaneous agents stay attributed.
- **§E — Agent skill resource via MCP**: `codetrellis://skill`
  (project-tailored summary), `…/quickstart` (first-time flow),
  `…/power-user` (deep usage incl. phase + template guidance).
  Markdown so any MCP-capable agent can ingest.
- **§F — Multi-doc per type**: `SpecDocCreateModal` auto-numbers the
  default title ("Patterns 2", "Patterns 3") so a second doc of the
  same type doesn't clash. The data model already allowed it; this
  unblocks the UX. SpecRoom tree handles ordering via §C.
- **§G — Plan templates**: `plan-templates.ts` declares templates as
  pure data; `applyTemplate` seeds plan + phases + spec docs in one
  sweep. First template: **mass-refactor** (6 phases + 10 docs incl.
  executive overview, per-phase docs, cross-cutting patterns /
  testing / security). REST + MCP (`list_plan_templates` /
  `create_plan_from_template`); PlanCreateModal has a "From template"
  tab with phase + doc count preview.
- **Markdown rendering**: replaced hand-rolled markdown with
  `react-markdown` + `remark-gfm` so spec docs and skill guides
  render with full GFM (tables, task lists, autolinks,
  strikethrough).

### Apr 27, 2026 — Multi-System Ingestion + perf

- **Multi-system ingestion (Phase 1 + 2)**: opening a real mixed-language repo (swf) now produces **2552 edges** including 1688 Python, 314 into workspace packages — was 597 edges TS-only before this sprint.
- **System discovery**: 13 systems detected from any manifest (`package.json`, `pyproject.toml`, `setup.py`, `requirements.txt`, `Cargo.toml`, `go.mod`, `composer.json`, `pom.xml`, `build.gradle`, `Gemfile`, standalone `tsconfig.json`).
- **Workspace alias resolution**: `@swf/ui` etc. now resolve dynamically from every `package.json` in the repo + `tsconfig.json` `paths`.
- **Modular parser/resolver plugin architecture**: each language is one file in `parsers/` + `resolvers/`. Adding a language = drop two files. No core changes.
- **Per-language extraction**: Python (`import_statement` + `import_from_statement` + relative + aliased + project-anchored absolute), Rust (`use_declaration` + crate / self / super / sibling-crate), PHP (`namespace_use_declaration` + PSR-4 from `composer.json`), Java (`import_declaration` + standard source roots).
- **Proper `.gitignore` semantics**: `ignore` npm package — globs, negation (`!path`), nested .gitignore inheritance. Plus optional `.codetrellis-ignore` per-directory override.
- **Heavy non-source dirs ignored** (venv / env / build / vendor / target / __pycache__ / coverage / test-results / playwright-report / cypress) — stops drowning the scanner.
- **Per-project AST scoping**: `clearAstData()` on every scan. Switching projects no longer leaves stale rows or unioned search results.
- **EMFILE survival in file watcher**: function-based ignore predicate; backend stays alive even when chokidar can't watch every file in a giant repo.
- **`/api/diff` regression fix**: was re-parsing all 2k+ files every 10s AND wiping every workspace-aliased + Python edge each cycle. Now reads from DB. 30s → 193ms.
- **Graph scope filter**: top-right of canvas — pick any discovered system to filter the graph to that subtree. Stops RAM blow-up on big repos.
- **Files-depth view stops hiding files**: when scoped, shows every file (no threshold, no cap). Unscoped: threshold 3→2, cap 40→200.
- **Edge animation perf**: regular edges no longer animated (~5000 SVG animations per frame killed pan/zoom). Motion only on `active` and `planned_add` edges where it conveys meaning.
- **System discovery REST**: `GET /api/systems?project=...` returns all detected systems for a project.

### Apr 23–26, 2026 — Architectural authoring tool

This sprint focused on making CodeTrellis usable as an *architectural
authoring* tool, not just a viewer: agents and humans co-author plans
+ spec docs, the inspector becomes a code-level surface for marking
changes, and drift is visible at the node, edge, and code-line level.

- **Plan + Task data model** with versioning, comments, deviation tracking
- **MCP plan + spec API** — agents create plans, attach typed spec docs
  (executive_summary / architecture / patterns / examples / research /
  testing / security / ux_ui / constraints / acceptance_criteria /
  rollout / custom), fetch them granularly without bloating context
- **Spec Room UI** — markdown viewer + editor with version history and
  restore
- **Three Trellis states** (baseline / live / planned / diff) with
  pin / auto-track / branch baseline selection
- **Kind-aware Inspector** — cluster click shows files, file click shows
  imports / symbols / source code, symbol click shows scoped code slice
- **Code viewer** — Prism syntax highlighting (nightOwl), git per-line
  gutter (+/~ markers), drift status border + clickable badge with plan
  picker, line selection → "Add to plan" with three modes (existing
  task, new task, new plan)
- **Drift visualization** at three layers:
  - Per-file (inspector badge + colored border, plan-pickable)
  - Per-edge (planned_add / added / unexpected / planned_remove distinct)
  - Per-line code annotations (git-driven; plan-aware drift is file-level for now)
- **Recent projects + Getting Started** onboarding state API and checklist
- **Branch baseline picker** — click any branch in the TopBar popover
  to pin its HEAD as the diff baseline
- **Cluster discovery** — 3-phase (path-seed → dependency-refine →
  singleton-merge), full file list now exposed on cluster nodes for
  inspector drill-in
- **Multi-tab project support** with worktree opening from BranchPopover
- **Auto-track HEAD bug fixed** — sidebar/canvas no longer carry stale
  dirty markers for ~30s after a commit
- **Modal portal fixes** — PlanCreateModal / SpecDocViewer /
  SpecDocCreateModal / AddToTaskPopover all escape glass-panel
  containing block via createPortal
- **File watcher fix** — re-parses .py / .rs / .php / .java in addition
  to TS/JS so non-JS edits actually update the dependency graph

---

## 3. Phase Status

The original `IMPLEMENTATION-PHASES.md` defined Phases 1–6 with goals +
verification. Phases 7–10 were added as we discovered the product is
more than what those original phases captured. Each phase keeps its
original *Goal* and *Verification* criteria so they stay testable.

### Phase 1 — Foundation
**Goal:** Electron app launches, shows a shell layout, can open a project
and display its structure.
**Status: DONE**

| Task | Status | Notes |
|------|--------|-------|
| Scaffold (Vite + React 19 + TS) | ✅ | Web mode via Express + Vite |
| Tailwind CSS 4 + dark theme | ✅ | Custom theme vars in globals.css |
| Shell layout (Sidebar, TopBar, Canvas, Inspector, PlanPanel, StatusBar) | ✅ | All panels render |
| Resizable panels | ✅ | Allotment wired; PlanPanel + Inspector also have programmatic expand toggles |
| Typed bridge abstraction | ✅ | HTTP bridge for web, Electron stub exists |
| ProjectScanner + .gitignore | ✅ | Recursive scan, respects .gitignore |
| MonorepoDetector | ✅ | npm / pnpm / nx / turbo detection |
| SQLite database | ✅ | sql.js, persisted snapshot survives restarts |
| Zustand stores | ✅ | graph, agent, project, plan, ui, toast |
| Shared types | ✅ | Plan, Task, Comment, PlanDocument, ProjectionData, etc. |
| Project open dialog | ✅ | Folder picker modal with server-side directory browser |
| File tree sidebar | ✅ | Per-file git status markers |
| Multi-tab projects | ✅ | Open multiple projects/worktrees as TopBar tabs |

**Verification (current):** App opens with dark theme; open a project →
sidebar shows tree; resizable panels work; status bar shows project info.

### Phase 2 — AST Engine
**Goal:** Parse source files to function/class level, persist in SQLite,
search symbols.
**Status: DONE (core); optimization deferred.**

| Task | Status | Notes |
|------|--------|-------|
| Tree-sitter WASM setup | ✅ | web-tree-sitter in backend |
| TS / TSX / JS / JSX grammars | ✅ | |
| Python / Rust / PHP / Java grammars | ✅ | |
| Symbol extraction | ✅ | functions, classes, methods, interfaces, types, enums |
| Import / export extraction | ✅ | Specifiers extracted |
| Import resolution (paths, aliases) | ✅ | Resolves relative + @shared alias |
| SQLite persistence | ✅ | files, symbols, imports tables populated |
| Symbol search | ✅ | LIKE-based |
| FileWatcher (chokidar) | ✅ | Re-parses TS/JS/Python/Rust/PHP/Java on change |
| Dependency graph API | ✅ | GET /api/dependencies |
| File dependency API | ✅ | GET /api/dependencies/file?path= |
| File content API | ✅ | GET /api/file/content with optional language detect, git per-line annotations, plan drift status, line-range slicing |
| Incremental parsing (tree-sitter edit deltas) | ⏸ | DEFERRED — full re-parse on change |
| Worker pool | ⏸ | DEFERRED — synchronous parsing |
| Parse progress reporting | ⏸ | DEFERRED |

**Verification (current):** TS project parses; symbol search returns
results; edit a file externally → re-parsed automatically.
**Open verification:** Large repo (500+ files) parses without freezing
the main thread — see Phase 6 perf pass.

### Phase 3 — Graph Visualization
**Goal:** Interactive ReactFlow graph showing codebase architecture at
multiple depths.
**Status: DONE (core); polish + drift surfacing in progress.**

| Task | Status | Notes |
|------|--------|-------|
| ReactFlow integration | ✅ | |
| Custom nodes (Package / Directory / File / Symbol) | ✅ | Glassmorphic, variable-sized cluster cards |
| Custom edges (ImportEdge with state-aware visuals) | ✅ | regular / planned_add / planned_remove / added / removed / **unexpected** / active / symbol_link with animated flow dots |
| Cluster discovery (3-phase) | ✅ | path inference → dependency refinement → singleton merge |
| Cluster file list on node data | ✅ | Inspector reads `data.files` to drill into a cluster |
| GraphBuilder | ✅ | buildClusterView, buildHubView, buildFocusView |
| dagre + force layouts | ✅ | Tree mode + Map mode (default) |
| Expand / collapse | ✅ | Click ▶/▼ on nodes |
| Depth selector (Clusters / Files / Symbols) | ✅ | TopBar segmented control + Cmd+1/2/3 |
| Minimap + zoom controls | ✅ | |
| Click sidebar → focus graph | ✅ | Sets selectedNodeId, canvas reflects |
| Click graph → inspector content routing | ✅ | cluster / file / symbol / directory / ghost kinds |
| Edge drift visualization | ✅ | live × planned cross-product computed correctly |
| Auto-fit on initial render | ✅ | |
| Export graph as PNG | ✅ | Top-right of canvas |
| **Node-level drift ring** | ❌ | Same backend data we already use for inspector badge — needs node visual |
| Filter bar | ❌ | |
| Semantic zoom (cluster → file → symbol via zoom level) | ❌ | Currently a discrete depth toggle |

**Verification (current):** Cluster view shows clusters with dependency
edges; expanding shows children; layout is clean; smooth pan/zoom.

### Phase 4 — Agent Integration
**Goal:** Monitor agent activity in real-time, display plans and events.
**Status: DONE (Claude Code); generic MCP-agent timeline pending.**

| Task | Status | Notes |
|------|--------|-------|
| ClaudeCodeWatcher | ✅ | Scans ~/.claude/sessions/, finds active sessions by PID |
| Session correlation | ✅ | Matches session cwd to monitored project |
| Extract tool calls from JSONL | ✅ | Reads, Writes, Edits, Bash, Glob, Grep |
| Plan extraction (heuristic) | ✅ | Numbered + bullet lists |
| AgentEventBus → frontend | ✅ | WebSocket broadcasts events |
| Agent panel: timeline | ✅ | Inside PlanPanel as a tab |
| Agent panel: changes tab | ✅ | File writes/edits |
| Status bar agent indicator | ✅ | |
| MCP server | ✅ | SSE on localhost:19432, auto-starts |
| MCP guide modal + Connect Agent button | ✅ | |
| Recently-changed pulse on graph | ✅ | Via agent-store recentlyChangedFiles |
| **Generic MCP-agent timeline** | ❌ | Currently only Claude Code shows in Timeline; MCP tool calls don't surface — Codex/Cursor/aider don't appear |

**Verification (current):** Start Claude Code in a monitored project →
events appear in timeline; agent edits a file → file pulses; report a
plan via MCP → plan appears.
**Open verification:** Same flow with a non-Claude-Code MCP agent.

### Phase 5 — Architecture Diffing
**Goal:** Show before/after architectural impact of agent changes.
**Status: DONE (multi-layer).**

| Task | Status | Notes |
|------|--------|-------|
| Snapshot capture | ✅ | Files (with hashes) + edges at scan time |
| Auto-snapshot on scan | ✅ | Baseline set when project is opened |
| DiffEngine | ✅ | Computes added/removed/modified files and edges |
| Color-coded graph overlay | ✅ | Green=added, Orange=modified, Red=removed |
| Blast radius | ✅ | |
| Diff polling | ✅ | Frontend polls /api/diff every 10s |
| Pause / check now / interval controls | ✅ | |
| Diff summary panel | ✅ | Top-left of canvas; on-track / planned / pending / unexpected counts |
| Plan-vs-live edge state | ✅ | planned_add / added / unexpected / planned_remove distinct |
| Per-line git annotations | ✅ | /api/file/content returns per-line 'unchanged'/'added'/'modified' |
| File-level drift status | ✅ | /api/file/content returns drift {status, comparedAgainstPlanUid, comparedAgainstPlanTitle} |
| Drift plan picker (per-session override) | ✅ | ui-store.driftComparePlanUid; popover on the inspector badge |
| **Diff mode auto-shows projection** | ❌ | Currently still requires Projection toggle |
| **Per-line plan-aware drift** | ❌ | Drift is file-level; line-level requires plans to specify line ranges |
| Snapshot timeline (scrub past states) | ⏸ | DEFERRED |
| Before/after split view | ⏸ | DEFERRED |

### Phase 6 — Polish & Branding
**Status: DONE (practical items).**

| Task | Status | Notes |
|------|--------|-------|
| Rename to CodeTrellis | ✅ | |
| App icon + branding | ✅ | |
| Welcome screen | ✅ | With recent-projects list (pinned-first) |
| Lucide icons everywhere | ✅ | |
| Keyboard shortcuts | ✅ | Cmd+O, Cmd+1/2/3, Cmd+B, Cmd+J, Escape |
| Error boundaries | ✅ | React ErrorBoundary wraps App |
| Toast notifications | ✅ | Plan-created, task-claimed/updated, deviation, conflict, session, plan-doc events |
| Performance pass (large repos) | ⏸ | DEFERRED — works at current scale |
| Auto-update | 🚫 | BLOCKED — macOS 26 Electron bug |
| DMG / installer | 🚫 | BLOCKED — macOS 26 Electron bug |

### Phase 7 — Plan + Spec Authoring
**Goal:** Agents and humans co-author plans with structured context.
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| Plan tables (plans, plan_versions, tasks) | ✅ | Auto-versioned on update |
| Plan service CRUD | ✅ | createPlan, getPlan, updatePlan, listPlans, claimTask, updateTask (full field set), getNextTask |
| `appendTaskCodeReference` / `appendTaskToPlan` | ✅ | Used by inspector "Add to plan" flow |
| Comments table + service | ✅ | Threaded; typed (comment / suggestion / approval / concern / status_update) |
| Deviation detection service | ✅ | checkFileDeviation hooks into file watcher |
| Plan REST API | ✅ | Full surface — see §8 |
| Plan UI: list + detail + create modal | ✅ | |
| Spec docs table (plan_documents + plan_document_versions) | ✅ | Auto-versioned on body change |
| Spec docs service | ✅ | CRUD + version history + search with excerpts |
| Spec docs REST API | ✅ | Full surface — see §8 |
| Spec docs MCP tools | ✅ | add / update / get / list / search_plan_doc |
| Spec doc taxonomy + UI | ✅ | 12 canonical types with icons + chip colors |
| Spec doc viewer (markdown + version history + restore) | ✅ | Portaled modal |
| Spec doc create modal (type picker grid + starter skeletons) | ✅ | |
| **Plan templates** | ❌ | Common shapes (refactor / new feature / bug fix / migration) |
| **Plan-task progress auto-detection** | ❌ | Auto-advance task to in_progress when its affected files change |
| **Task-level comments** | ❌ | Plan-level only today |
| **Plan version viewer UI** | ❌ | API exists; no UI |

**Plan task fields (full data model):** `description` (required) ·
`affectedFiles[]` · `affectedSymbols[]` · `newConnections[]` ·
`removedConnections[]` · `dependencies[]` · `fileSpec` (markdown — file
responsibility, exports, code references via "Add to plan") ·
`symbolSpecs[]` (per-symbol intent: name, kind, action add/modify/
remove/move, signature, moveTo) · `status`, `assignee`, `assigneeType`,
`assigneeModel`.

### Phase 8 — Three Trellis State System
**Goal:** Render baseline / live / planned simultaneously and surface drift.
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| TrellisMode type | ✅ | 'current' \| 'planned' \| 'live' \| 'diff' |
| Trellis snapshot table + service | ✅ | trellis_snapshots; capture / list / diff / get |
| Snapshot REST API | ✅ | POST /api/trellis/capture; GET /api/trellis/snapshots, /:id, /:id/diff |
| Snapshot MCP tool | ✅ | capture_checkpoint |
| Baseline pin / auto-track HEAD / pin to commit | ✅ | TopBar canvas chrome |
| Baseline pin to a branch tip | ✅ | Branch popover row click → captureBaselineFromBranch |
| Auto-track HEAD: detect new commit + auto-recapture baseline | ✅ | Refactored after stale-dirty bug |
| Recent commits dropdown | ✅ | Cached per project |
| Mode selector chrome (Live / Baseline / Planned / Diff) | ✅ | |
| Projection service | ✅ | computeProjection(planUid) → ghostFiles / modifiedFiles / removedFiles / newEdges / removedEdges |
| Projection toggle | ✅ | Auto-enables when active plan is set |
| **Mode visual distinctness** | ❌ | Modes work but don't read as visually unmistakable (Immediate Focus #1) |

### Phase 9 — Inspector + Code Viewer
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| Kind-aware Inspector | ✅ | cluster / file / symbol / directory / ghost routing from MainCanvas onNodeClick |
| Cluster view | ✅ | Name, description, file list (each clickable to drill into file view) |
| File view | ✅ | Path, "View source" button, symbols, imports, importedBy (each clickable) |
| Symbol view | ✅ | Breadcrumb back to file, scoped code slice with start-line highlight |
| Inspector expand toggle | ✅ | Programmatic Allotment resize; ~55% of viewport when expanded |
| Code preview component | ✅ | Standalone in components/inspector/CodePreview.tsx |
| Syntax highlighting | ✅ | prism-react-renderer + nightOwl theme; auto-detected language from extension |
| Per-line git gutter | ✅ | + (added) / ~ (modified) markers, color-coded |
| Drift status visualization | ✅ | Outer border color + clickable badge with plan picker popover |
| Line selection (single + shift-extend) | ✅ | Selection bar appears with "Add to plan" / "Clear" |
| "Add to plan" flow | ✅ | AddToTaskPopover with three modes (existing task / new task / new plan) |
| Code reference appended to task | ✅ | Adds to `affectedFiles` and appends a markdown block to `fileSpec` |
| Drift plan picker | ✅ | Popover on the badge: "Follow active plan" or pick any plan |

### Phase 10 — Onboarding
**Status: DONE (v1).**

| Task | Status | Notes |
|------|--------|-------|
| Recent projects table + service | ✅ | Pinning, prune unpinned past 12 |
| Recent projects REST API | ✅ | GET /api/recent-projects, DELETE, POST /pin |
| Recent projects on Welcome screen | ✅ | Pinned-first sort, hover reveals pin/remove + relative time |
| Onboarding state API | ✅ | GET /api/onboarding-state?project=… returns hasMcpSession, hasPlan |
| Getting Started checklist | ✅ | Floating bottom-left panel, 4 steps; per-project dismiss + collapse + tried-trellis flags in localStorage |

### Phase 11 — Multi-System Ingestion ⚡ HIGH PRIORITY
**Goal:** Treat the codebase as `Project → System → Cluster → File →
Symbol`, where systems are detected from any manifest (npm / Python /
Rust / PHP / Java / Go / Ruby / standalone TS), not just npm
workspaces. Resolve workspace aliases dynamically. Extract imports for
every supported language.
**Status: Phase 1 + 2 + plugin refactor DONE. Phase 3+ open.**
**Spec: [SYSTEM-MODEL.md](SYSTEM-MODEL.md)**

#### Why this matters

CodeTrellis was npm-shaped. Real repos aren't. Without these phases:

- npm packages outside the `workspaces` glob (e.g. orphan `services/realtime/`) were invisible
- Python / Rust / PHP / Java backends had files in the tree but **zero edges** because per-language import extraction wasn't wired
- Workspace package imports (`@scope/name`) didn't resolve because the resolver only knew a hardcoded `@shared` alias → entire apps like `apps/admin` showed up disconnected from `packages/*`
- Heavy non-source dirs (`venv/`, `build/`, `vendor/`, `test-results/`) drowned the real code AND blew up chokidar with EMFILE

#### Verified against a real mixed-language monorepo (swf)

Before this phase: **597 edges, 0 Python, 0 workspace-aliased.**
After: **2552 edges — 1688 Python + 591 .tsx + 273 .ts, 314 into `packages/*`.**

| Sub-phase | Status | Notes |
|---|---|---|
| **1.A** Better ignore list | ✅ | venv / env / build / vendor / target / __pycache__ / coverage / test-results / playwright-report / cypress; safety floor under proper gitignore semantics |
| **1.B** Generic system discovery | ✅ | `system-discovery.ts`. Walks tree, emits a `DiscoveredSystem` for every manifest. Detects: `package.json` (with/without workspaces), `pyproject.toml`, `setup.py`, `requirements.txt`, `Cargo.toml` (incl. `[workspace]`), `go.mod`, `composer.json`, `pom.xml`, `build.gradle(.kts)`, `Gemfile`, standalone `tsconfig.json`. Project root always informal-system if no manifest. |
| **1.C** Dynamic package alias map | ✅ | `@swf/ui` → `packages/ui/src/index.ts`, etc. — built from every discovered package.json's name + entry hints + tsconfig.paths. Sorted longest-first for greedy prefix matching. |
| **1.D** `tsconfig.json` `compilerOptions.paths` | ✅ | Respected per-system; comment-tolerant + trailing-comma-tolerant JSON parser. |
| **1.E** Proper `.gitignore` semantics | ✅ | `ignore` npm package — globs, negation (`!path`), nested .gitignore inheritance. Optional `.codetrellis-ignore` per directory for project-specific overrides. |
| **1.6** Modular plugin architecture | ✅ | `parsers/{base,index,typescript,python,rust,php,java}.ts` and `resolvers/` mirroring it. Adding a language = drop a new file in each dir, register in index. No core changes. |
| **2.A** Python parser plugin | ✅ | `function_definition` / `async_function_definition` / `class_definition` / `decorated_definition` (decorators captured as modifiers) / module-level UPPER_CASE constants. Imports: `import_statement`, `import_from_statement`, aliased + relative (`from . import x`, `from ..pkg import y`). |
| **2.B** Python resolver | ✅ | Relative (`.x`, `..x`) walks up from importer; absolute anchors at importer's nearest-ancestor system root with `src/` and `app/` fallbacks. Filters stdlib + common third-party (fastapi, pydantic, sqlalchemy, etc.) so we don't fail to "resolve" `os` / `json` / etc. |
| **2.C** Rust parser + resolver | ✅ | function_item / struct_item / enum_item / trait_item / impl_item / mod_item / type_item; use_declaration. Resolver: crate:: from src/, self/super:: relative, sibling-crate within Cargo workspace. |
| **2.D** PHP parser + resolver | ✅ | function_definition / class_declaration / interface_declaration / trait_declaration / enum_declaration; namespace_use_declaration with namespace_definition recursion. Resolver: PSR-4 lookup from nearest composer.json `autoload.psr-4` (cached). |
| **2.E** Java parser + resolver | ✅ | class / interface / enum / record / method declarations; import_declaration with wildcard support. Resolver: src/main/java + src/test/java + src/ + root layouts; skips java./javax./sun./com.sun.*. |
| **2.F** Go parser + resolver | ❌ | Pending. Need a tree-sitter-go grammar in resources/ + plugin file. |
| **2.G** SQL ref-tracker | ❌ | Pending. String-literal SQL parsing → table refs; migration parser builds the table index. Becomes a cross-system edge once Phase 5 lands. |
| **3** Systems table + DB persistence + MCP `list_systems` etc. | ⚠️ Partial | `GET /api/systems?project=` exists. Missing: `systems` SQLite table, `system_id` column on `files`, MCP tools (`list_systems`, `get_system_files`, `get_system_dependencies`). |
| **4** System-aware UI | ⚠️ Partial | Done: graph scope filter (top-right of canvas) — pick any system → graph filters to that subtree. Missing: sidebar "Systems" section, system-as-cluster-boundary in graph builder (currently cluster discovery merges across systems), system view kind in Inspector, plan tasks `affectedSystems[]`. |
| **5** Cross-system non-import links | ❌ | HTTP routes (FastAPI decorators ↔ frontend `fetch()`), SQL table refs, env vars, subprocess, OpenAPI contracts. The reason "PHP + Python + SQL together" actually works as a single architecture. |
| **6** External / submodule shared libs | ❌ | Mark a `node_modules` package as "interesting" → ingest its source as a virtual system. `.gitmodules` awareness. |

#### Performance + correctness fixes that landed alongside

| Fix | Status | Notes |
|---|---|---|
| EMFILE survival in file watcher | ✅ | Function-based ignore predicate (globs weren't reliable for nested layouts). `followSymlinks: false`. Watcher 'error' handler logs + continues instead of tearing down the backend. |
| Per-project AST scoping | ✅ | `clearAstData()` at start of every `/api/project/scan`. Switching projects no longer leaves stale rows / unioned search results. |
| `/api/diff` regression fix | ✅ | Endpoint was re-running scanDirectory + parseFiles + storeParsedFile + resolveImports on EVERY 10s poll, AND calling resolveImports with no alias map (which wiped every workspace-aliased + Python edge each cycle). Now reads current state from the DB. Response time: ~30s → 193ms. |
| Graph scope filter | ✅ | Picker top-right of canvas + `scopePath` in graph-store. Filters depEdges before clustering / layout. |
| Files-depth view stops hiding files | ✅ | When scoped to one system, shows every file (no threshold, no cap). Unscoped: threshold lowered 3 → 2, cap raised 40 → 200. |
| Edge animation perf fix | ✅ | `<animateMotion>` on every regular edge was 5000+ SVG animations per frame, killing pan/zoom. Now only `active` and `planned_add` edges animate. |

#### What's left in this phase (in the order I'd do them)

1. **System-aware clustering** — use discovered systems as primary cluster boundaries, so Python's 1688 internal edges don't all collapse into one mega-cluster and `apps/admin`'s clusters stay separate from `apps/web`'s. Sub-cluster within a system by directory.
2. **Server-side rendered graph views** (your "load JSON from DB on demand" suggestion) — backend computes and caches `{ nodes, edges }` per scope, frontend just fetches. Switching systems becomes truly per-scope load. Caches invalidated on scan.
3. **Phase 3** — `systems` SQLite table + `system_id` on files + MCP `list_systems` / `get_system_files` / `get_system_dependencies`. Without this, agents can't query system-scoped state.
4. **Phase 4** — system-aware sidebar (Systems section above the file tree), system view kind in Inspector, `affectedSystems[]` on plan tasks, drift attribution by system.
5. **Phase 2.F + 2.G** — Go plugin + SQL ref tracker, completing language coverage.
6. **Phase 5** — cross-system non-import links (HTTP / SQL / env / subprocess / OpenAPI contracts). The headline product story for "PHP + Python + SQL all in one project."
7. **Phase 6** — selected `node_modules` ingestion + `.gitmodules`.

---

### Phase 12 — Deepening Plans + Agent Skills ✅ DONE (Apr 27, 2026)
**Goal:** plans can be light *or* deep on a per-plan basis. Light = title
+ a few tasks (already works). Deep = phased structure with executive
overview, per-phase scope + acceptance criteria, structured spec docs,
and a granular "proposed changes" feed of CRUD operations on files /
symbols / connections — all so multiple AI agents can share rich context
without having to re-derive it from chat history.

**Inspiration:** swf's `docs/oms/002-oms-integration/` style:
`00-EXECUTIVE-OVERVIEW.md` + `01-PHASE-1-FOUNDATION.md` …
`06-PHASE-6-…md` + cross-cutting `DATA-MODEL.md`, `FRONTEND-AUDIT.md`,
`TRACKER.md`, plus a `testing/` subfolder. Each phase doc has its own
ToC: backend models → routes → auth → frontend types → API client →
testing → acceptance criteria. We want the same expressiveness, but
backed by the DB so agents can query slices via MCP rather than
parsing markdown.

**The use case driving this:** "the majority of AI tools are being used
for mass refactoring to modernise systems" — multiple agents working
in parallel on a big migration need a shared deep plan they can refer
to and update.

#### Sub-phases

| | Item | Size | Status |
|---|---|---|---|
| **A** | Explicit `Phase` entity (table + service + REST + MCP + UI). Each phase has number, title, scope, prerequisites, gitCheckpoint, acceptanceCriteria, status. Tasks gain optional `phaseUid`. Plans can have N phases or zero (light plans unchanged). MCP: `add_plan_phase`, `list_plan_phases`, `update_plan_phase`, `delete_plan_phase`; `update_task` and `get_next_task` extended with `phase_uid`. UI: `PlanPhases` renders phases above tasks, expandable rows show scope/prereqs/acceptance markdown + bound tasks; "Unphased" bucket lets you bind tasks via dropdown. Phase create/edit modal handles all fields incl. delete. | medium | ✅ |
| **B** | "Proposed Changes" first-class view. `plan-changes-service` projects every task field (`affectedFiles`, `symbolSpecs`, `newConnections`, `removedConnections`) into a CRUD-style `ProposedChange` row with operation (add/modify/remove/move), kind (file/symbol/connection), target, optional detail, and a freshly computed `driftStatus` (planned / in_progress / satisfied / missing / unexpected). REST `/api/plans/:uid/changes` + `/changes/:changeId`; MCP `list_proposed_changes` / `get_changes_summary` / `get_change_status`. New "Proposed" tab in PlanPanel groups by task with status filter chips and kind selector. | medium | ✅ |
| **C** | Spec docs gain `orderHint` (e.g. "00", "01") + `parentDocUid` (nesting). Schema migration in place; service + REST + MCP (`add_plan_doc` / `update_plan_doc`) accept both fields; SpecRoom renders as a tree with order-prefixed labels and indented children; SpecDocCreateModal auto-suggests the next order prefix and offers a parent dropdown. Search falls back to flat list. | small | ✅ |
| **D** | Generic MCP agent timeline — every MCP tool call from any agent (Claude Code, Codex, Cursor, aider, custom) flows into the Agent Timeline as an `agent-event`. `registerTool` is wrapped to broadcast `tool_call` / `tool_error` events with agent attribution; PlanPanel Timeline tab renders them with per-event icons + duration. Closes step 5 of front-to-back loop for any agent. | small | ✅ |
| **D2** | **Multi-agent visibility (TopBar).** New `ConnectedAgents` widget in the TopBar replaces the single "Agent active" pill — shows count + popover listing every active MCP session (agent type, model, active plan, last seen). WS auto-refetches on `mcp-session-changed` / `session-registered` / `session_start` / `session_end`. `register_session` and `set_active_plan` now use the caller's transport sessionId so multiple simultaneous agents stay attributed correctly. | small | ✅ |
| **E** | **Agent skill resource via MCP.** Three resources: `codetrellis://skill` (project-tailored summary listing current plans + connected agents), `codetrellis://skill/quickstart` (first-time agent flow), `codetrellis://skill/power-user` (deep usage — phased plans, granular task fields, drift verification, multi-agent coordination, spec docs as shared context, snapshots). Markdown so any MCP-capable agent can ingest. | small | ✅ |
| **F** | Multiple-docs-per-type support. swf has multiple "phase" overview docs; the data model already allowed it (each doc has its own uid) — `SpecDocCreateModal` now auto-numbers default titles ("Patterns 2", "Patterns 3", …) so a second doc of the same type doesn't clash, and the SpecRoom tree (Phase 12 §C) renders multiples cleanly via `orderHint`. | small | ✅ |
| **G** | Plan templates from common shapes. Templates declared in `plan-templates.ts` as pure data (no schema dep). Ships **"Mass refactor (swf-style)"**: 1 executive overview + 6 numbered phase docs + 1 architecture overview + cross-cutting patterns / testing / security docs + 6 phases with scope/prereqs/acceptance/git-checkpoint placeholders, all wired up via `parentDocUid` + `orderHint`. REST `/api/plan-templates` and `/api/plans/from-template`; MCP `list_plan_templates` + `create_plan_from_template`. PlanCreateModal has a "From template" tab that previews phase + doc count and confirms with a "Seed plan (6+10)" button. | medium | ✅ |

#### Shipped order (for posterity)
D → C → A → D2 → E → F → G → B. All landed Apr 27, 2026.

#### Acceptance for the deepening push as a whole

✅ Achieved:
- Open a project, type a one-line plan title → light plan (current behavior, untouched).
- OR pick "Mass refactor" from plan templates → seeded with executive overview + 6 phase docs + 1 architecture overview + cross-cutting patterns / testing / security docs in one click.
- Author or edit any of those docs in the spec room with markdown ordering / nesting that mirrors swf's `00-…`, `01-…` convention.
- Have multiple agents (Claude Code + Codex side-by-side) connect via MCP and:
  - See each other's tool calls in a live Agent Timeline
  - See each other in the TopBar `ConnectedAgents` widget (type, model, active plan, last seen)
  - Pull the agent skill from `codetrellis://skill` so they operate the product without out-of-band briefing
  - Fetch only the spec slice they need (`get_plan_doc(plan_uid, doc_type='security')`)
  - Claim tasks scoped to a specific phase (`get_next_task(plan_uid, phase_uid)`)
  - Use the "Proposed Changes" tab (or `list_proposed_changes` MCP) to see what the plan promises vs what's landed.

⚠️ Still open (rolled into next pushes — see §7):
- Tasks auto-advance as files change on disk (front-to-back step 9). ✅ shipped Apr 27 (Push 1).
- "Verify completion" panel that reads `get_drift_report` and shows planned vs landed at a glance (front-to-back step 11). ✅ shipped Apr 27 (Push 1).

---

### Phase 13 — Plan Export + Multi-Device + Settings ✅ DONE (Apr 27, 2026)
**Goal:** Plans, phases, tasks, spec docs, and templates round-trip
between the DB and a directory of YAML + markdown checked into the
project repo at `<project>/.codetrellis/plans/`. The file is canonical;
the DB is a fast-rebuild index. Multi-device / multi-agent
collaboration becomes "just `git pull`."

**Design doc:** [PLAN-EXPORT.md](PLAN-EXPORT.md) covers format, sync
model, conflict resolution, identity, settings surface (incl.
configurable MCP port), and three-phase delivery. Read that before
writing code.

**Why now:** This is the headline feature for "multi-device" and
"team collaboration on a plan." Without it, every device is an
island. The DB-only path that ships today is fine for a single-user
single-machine workflow but breaks the moment two people want to
share a plan or someone moves between laptop and desktop.

**Sub-phases**

| | Item | Size | Status |
|---|---|---|---|
| **A** | Manual export / import shipped. `plan-file-service.ts` round-trips plan + phases + tasks + spec docs to `<project>/.codetrellis/plans/<slug>/` (YAML + markdown with front-matter, per [PLAN-EXPORT.md §3](PLAN-EXPORT.md)). REST: `POST /api/plans/:uid/export`, `POST /api/plans/import`, `GET /api/plans/discover`. MCP: `export_plan_to_files`, `import_plan_from_files`, `discover_plan_files`. UI: "Export" button on PlanDetail header; PlanList shows a "Found N plans on disk" panel for plans committed via git but not yet in the local DB, with one-click Import. Idempotent — re-export overwrites; re-import upserts by UID. WS broadcasts `plan-imported` so other windows refresh. | medium | ✅ |
| **B** | Auto-sync shipped. `plan-file-service` exposes `scheduleWriteThrough(planUid)` (debounced 200ms per plan) — hooked into every mutation site in plan / plan-phases / plan-documents services via lazy-required notifyMutation helpers. Linked plans (those with `<projectRoot>/.codetrellis/plans/<slug>/plan.yaml` on disk) auto-export on every change. File watcher (`startPlanFileWatcher`) monitors `.codetrellis/plans/` with self-write stamping (1s TTL) so the write-through-then-watcher loop is broken; external edits re-import the plan idempotently. Import-depth guard suppresses write-through during a re-import. YAML conflict markers detected and surfaced as a `plan-file-conflict` toast. UI: per-plan "Linked / Unlink" toggle on the plan header; toast on file-watcher-driven imports. REST `GET /api/plans/:uid/file-status` + `POST /api/plans/:uid/unlink`; MCP `unlink_plan_from_files`. | medium | ✅ |
| **C** | Templates as publishable repos shipped. `plan-templates.ts` now loads templates from built-ins + `~/.codetrellis/templates/<id>/` + `<project>/.codetrellis/templates/<id>/` (project wins ID collisions); a `template.yaml` + `docs/<order>-<slug>.md` shape mirrors the plan-export format. New `plan-template-publish-service.ts` snapshots a plan as a template, scrubbing statuses / assignees / git checkpoints. Placeholder system: `{{key}}` tokens substituted in every string field at apply time, with optional defaults declared in `placeholders:`. REST `POST /api/plans/:uid/publish-as-template`; MCP `publish_plan_as_template`; `list_plan_templates` and `create_plan_from_template` accept `project_root` / `placeholder_values`. UI: "Publish as template" button on PlanDetail header; PlanCreateModal "From template" tab shows source badge (Project / User) and a placeholder-collection form. | small | ✅ |
| **D** | **Settings surface.** Gear icon in TopBar opens a modal with 5 sections — Identity (name + email defaulting from `git config user.name`/`user.email`), MCP Server (configurable port + autodetect-on-collision + copy-config snippet), Plans (default visibility), Data (dir override + `CODETRELLIS_DATA_DIR` env var honoured for tests), Telemetry (off; explicit). Persisted at `<dataDir>/settings.json`. REST `GET/PUT /api/settings`, `GET /api/identity/git-defaults`. WS broadcasts `settings-changed` + `mcp-port-changed`. | small | ✅ |
| **E** | **Identity in attributions.** REST authoring sites (`POST /api/plans`, plan-doc create, comment create) now resolve `author` via `getAuthorKey('human')` — returns the user's settings email if configured, falls back to the legacy `'human'` role string. Old rows stay valid; new rows pick up the email once set. | small | ✅ |

**Suggested order:** D + E first (small, unlocks everyone-else's
attribution + settings), then A (manual export — biggest UX win),
then B (auto-sync), then C (template publishing).

**Acceptance for the deepening as a whole** (per [PLAN-EXPORT.md §16](PLAN-EXPORT.md)):
A user can author a plan on laptop A, `git push`, `git pull` on
desktop B, and see the plan instantly. Both devices' agents read the
same plan from disk. Templates publish as git repos.

---

## 4. Trellis State Definitions (canonical mental model)

These are the precise meanings of the four graph modes. UI labels and
backend behaviors should match these meanings.

### Baseline
Original state with no local changes applied.
- The starting point; the committed reference state.
- What existed before untracked, staged, or unstaged work.

Answers: *Where are we starting from? What files, symbols, and
dependencies originally existed?*

### Live
The source of truth for how the workspace looks right now.
- Includes untracked, staged, unstaged, and deleted local files.
- Current architecture as it exists on disk.

Answers: *What is the codebase like right now? What has already
changed locally?*

### Planned
The plan for the currently selected branch or worktree — the intended
future state.

Answers: *What changes are expected? What files / symbols / dependencies
will be added, removed, or modified?*

### Diff
The difference between the plan and the live state — the monitoring view.

Answers: *Is the live state matching the plan? What's on track? What's
missing? What's unexpected? Where is the agent drifting?*

---

## 5. Graph Workstream Checklist

Granular checkboxes. Treated as the working list when iterating on the
graph specifically. Update checkboxes here as items land instead of
creating scattered notes.

### 5.1 State Meaning and Mode Behavior

- [ ] `Baseline` visually reads as frozen reference state
- [x] Baseline can be pinned, auto-tracked, pinned to a recent commit, or pinned to a branch tip
- [ ] `Live` visually reads as current truth, including local dirty state
- [ ] `Planned` visually reads as target state for the selected branch/worktree
- [ ] `Diff` visually reads as live-vs-plan comparison, not just generic file diff *(partial — edges done; nodes still need it; DiffSummary shows on/off-track counts)*
- [ ] Switching modes keeps enough context so the user does not feel lost
- [ ] Local Git state remains understandable across all modes

### 5.2 Node Clarity

- [ ] Added files are visually obvious *(partial — ghost styling for planned_add only)*
- [ ] Modified files are visually obvious *(partial — cluster summarized changeStatus only)*
- [ ] Removed files are visually obvious *(partial)*
- [ ] Planned add / planned modify / planned remove are visually distinct from live changes *(partial)*
- [ ] Untracked files are visually obvious *(sidebar yes; graph no)*
- [ ] Staged files are visually obvious *(sidebar yes; graph no)*
- [ ] Unstaged files are visually obvious *(sidebar yes; graph no)*
- [ ] Changed but unconnected files still appear in a sensible way *(partial via `extraPaths`)*
- [x] Node cards feel readable at a glance *(Codex polish landed; subjective — keep refining)*

### 5.3 Edge Clarity

- [x] New connections are visually obvious *(green solid)*
- [x] Removed connections are visually obvious *(red dashed)*
- [x] Changed import/call relationships are visually obvious
- [x] Planned edge changes are distinct from live edge changes *(planned_add green dashed vs added green solid; unexpected rose-red solid)*
- [ ] Edge labels are readable without cluttering the graph
- [x] When a node is selected, its relevant edges stand out strongly

### 5.4 Selection and Focus

- [x] Clicking a card selects it without collapsing the whole map
- [x] Selected cards are highlighted strongly and clearly
- [x] Related cards remain visible while unrelated cards fade appropriately
- [x] Selected node connections are easy to follow
- [ ] Focus / drill-down keeps enough surrounding context
- [ ] Leaving focus view is simple and obvious

### 5.5 Layout and Stability

- [ ] The graph no longer twitches during refreshes *(partial)*
- [ ] Polling updates data without re-throwing the whole map around
- [ ] The default layout feels spacious, not congested
- [x] Cards can be dragged manually
- [ ] Drill-down layout feels intentional and clean
- [ ] Cluster → file → symbol navigation feels top-down and readable
- [ ] Layout is good both for overview and for focused investigation

### 5.6 Refresh and Monitoring Controls

- [x] Auto-refresh can be paused
- [x] User can check now manually
- [x] Refresh interval can be adjusted
- [ ] Refresh behavior feels monitoring-grade and non-disruptive *(improving)*
- [ ] Diff refresh and graph refresh feel coordinated rather than confusing
- [x] Auto-track HEAD updates the sidebar and canvas correctly after new commits *(fixed — see §10)*

### 5.7 Cluster-First Graph Structure

- [x] Overview speaks in clusters rather than packages
- [x] Cluster names are consistently meaningful *(3-phase discovery)*
- [ ] Cluster descriptions feel helpful and accurate
- [ ] Cluster view clearly shows baseline, live, and planned context *(only via inspector today)*
- [ ] Files inside a cluster are organized by importance and change state *(partial — cluster nodes carry full file list now)*
- [ ] Saved/manual clusters exist
- [ ] Editable cluster names/descriptions exist
- [ ] MCP cluster actions exist *(create_cluster / rename_cluster / assign_files_to_cluster / annotate_cluster / suggest_cluster_changes)*

### 5.8 Git Working Tree Context

- [x] Diff summary includes staged / unstaged / untracked counts
- [x] Untracked changed files can appear in the graph
- [ ] Node cards show Git state more explicitly *(partial — sidebar yes, graph no)*
- [ ] Staged vs unstaged vs untracked are distinguishable on the graph itself
- [ ] Git working tree context stays visible across all relevant modes

### 5.9 Plan Monitoring

- [ ] Planned view clearly shows the intended future architecture *(partial — projection ghosts; mode itself doesn't read distinctly)*
- [x] Diff mode clearly shows live-vs-plan gaps *(edges done; node-level drift ring still missing)*
- [ ] Missing planned changes are obvious *(ghost edges visible; missing realization of plan less obvious)*
- [x] Unexpected live changes are obvious *(unexpected edges in red; drift badge in inspector)*
- [ ] Drift is visible enough that a human can intervene quickly *(partial — needs node-level drift ring)*
- [ ] Progress toward the plan is easy to understand visually *(task progress shown but not graph-overlaid)*

### 5.10 Non-Technical Readability

- [ ] A non-technical person can tell what changed
- [ ] A non-technical person can tell what is planned
- [ ] A non-technical person can tell whether the agent is on track
- [ ] The graph explains architecture intent, not just code structure

---

## 6. Visual Experience — Where We Are vs Where We're Going

The graph went from "developer wireframe" to "polished cluster-first
view with animated curved edges" in this sprint. Still not "Palantir /
flight-radar" yet — see what's done vs what's missing below. This
section preserves the design intent originally captured in the gap
analysis.

### What we have now

- **Glassmorphic card-style nodes** with backdrop blur, soft borders,
  and a description line per cluster
- **Variable-sized cluster nodes** based on file count
- **Custom curved bezier edges** with animated flow dots and direction
  indicators
- **State-aware edge visuals** (regular / planned_add / added / unexpected
  / planned_remove / removed / active / symbol_link)
- **Selection emphasis** — selected node highlights, related nodes stay
  visible, unrelated edges fade
- **Cluster-first layout** with discovered architectural groupings
- **Discrete depth selector** (Clusters / Files / Symbols)

### What still doesn't match the target

- **Node-level drift state** isn't surfaced — the inspector shows it,
  the edges show it, but you can't scan the graph for red rings yet
- **Selected node showing internal symbols** — only available via the
  Symbol depth toggle, not as a focus mode on a clicked node
- **Semantic zoom** — zooming doesn't progressively reveal cluster →
  file → symbol; depth is a manual toggle
- **Mode visual distinctness** — Live vs Baseline vs Planned vs Diff
  doesn't read as four unmistakable visual modes; chrome changes but
  the graph itself doesn't strongly signal which mode you're in
- **Filter bar** for the graph (by language, package, change state)
- **Task → graph linkage** — clicking a task in the Plan panel doesn't
  highlight its `affectedFiles` + planned edges on the graph

### Visual atmosphere (target)

Subtle particle/dot background giving depth; glow effects on
active/selected; radial gradient lighting (center brighter, edges
darker); smooth transitions when expanding/collapsing.

---

## 7. Open Items (priority order)

### 🐛 Bugs surfaced by the harness (added Apr 28)

The act of writing the harness already paid off — these gaps were
silently in the codebase and nobody noticed.

| Bug | Found by | Fix effort | Status |
|---|---|---|---|
| **Cross-system matcher doesn't re-run on file change.** Edges stale until manual re-scan. `recomputeCrossSystemEdges()` runs in `/api/project/scan` only; the file-watcher's `change`/`add` handlers re-parse but don't recompute. The "I edited a route file, where's my updated edge?" gap. | `tests/e2e/cross-system.test.ts` (mutation tests had to re-scan to pass) | XS — call `recomputeCrossSystemEdges()` from the file-watcher's `change`/`add` handlers, debounced. Tracker §1 Cross-system bumped from 30 → ~35 once shipped. | ❌ open |
| **`tests/.tmp/` was silently ignored by chokidar.** Any harness test that mutated files inside the tmp dir would hang because the watcher's ignore regex skips dot-prefixed segments. Caught by the loop test's first failed run. Renamed to `tests/_tmp/`. | `tests/e2e/loop.test.ts` first run | n/a — fixed | ✅ shipped |

### ⚡⚡ Distribution + first-impression block (added Apr 28)

The product is downloadable but the loop *around* the download —
how users find it, how they get told there's a newer version, how
much friction the first launch is — has gaps. These are the items
that affect every visitor before they've even opened the app.

| Item | State | Why it matters | Effort |
|---|---|---|---|
| **Build codetrellis.dev** (Next.js, sits in AILAR-Website monorepo) | ❌ specs done, not built | The front door. No website = no canonical place to pull installers from = no OTA endpoint. | M (~3-5 days) |
| **Wire desktop OTA poll** | ❌ | Without it, every install is stuck on whatever version they downloaded. Specs nailed the `/api/updates/check` contract — desktop side: poll on launch + every 24h, surface a non-blocking banner that opens the URL in browser. | S (~1 day, post-website) |
| **Code-signing — macOS Apple Developer ID + notarization** | ❌ | Biggest first-impression cliff. Right now every macOS install warns "can't be opened, Apple cannot check…". Bypassable but it costs trust on launch #1. ~$99/y. | S once cert in hand |
| **Code-signing — Windows EV cert** | ❌ | SmartScreen "Windows protected your PC" warning until the cert builds reputation. ~$200-400/y. | S once cert in hand |
| **Full electron-updater integration** | ❌ | After signing — auto-download + apply-on-quit instead of just opening the browser. Needs signed builds to verify the update came from us. | M post-signing |
| **More plan templates** *(quick win)* | ❌ | Mass-refactor template ships; need "new feature", "bug fix", "library migration", "perf pass". One entry each in `plan-templates.ts`. Makes the "From template" picker feel alive on first open. | XS (an hour each) |

### ⚡ Top priority — Front-to-back workflow

The end-to-end product loop is **open project → see architecture →
plan changes → agent executes → see drift → adjust → verify**. Most
steps work; a few seams are still broken or only partially wired.
Closing these is the priority block before adding more surfaces.

| Step | State | What's missing |
|---|---|---|
| 1. Open project (any language mix) | ✅ | — |
| 2. See architecture (graph, multi-language, multi-system) | ✅ | — for visible scope. `system-aware clustering` would split mega-clusters; `server-side per-system view loading` would make scope-switching truly per-scope. |
| 3. Drill into a file (Inspector + code preview + drift coloring) | ✅ | — |
| 4. Author a plan (title + tasks + spec docs) | ✅ | Plan templates ship a one-click swf-style "Mass refactor" seed (Phase 12 §G). Plan version viewer UI still missing. |
| 5. Connect a coding agent | ✅ | Generic MCP-agent timeline (Phase 12 §D) — every MCP client (Codex / Cursor / aider / custom) shows in the Timeline. Multi-agent visibility (§D2) — `ConnectedAgents` TopBar widget shows every active session. |
| 6. Agent reads the plan via MCP | ✅ | — |
| 7. Agent writes code | ✅ | — file watcher detects changes (any language). |
| 8. See file/edge/code-line drift against the plan | ✅ | — |
| 9. **Track agent progress** (which tasks are in-flight / done) | ✅ | `plan-progress-service` auto-advances `pending` / `assigned` tasks to `in_progress` when one of their `affectedFiles` changes on disk. Toast surfaces the auto-promotion. We don't auto-mark `done` (false positives); instead we broadcast `task-completion-suggested` once every ProposedChange for the task is `satisfied`. |
| 10. **Adjust the plan mid-flight** (revise tasks / spec docs) | ✅ | Works. No formal approval/rejection workflow yet. |
| 11. **Verify completion** ("are we actually done?") | ✅ | `VerificationPanel` on PlanDetail reads `plan-changes-service` summary and shows planned vs landed at a glance: green "Ready to ship" / amber "Drifted" / accent "Mid-flight" with a satisfied/total bar and per-status legend. Re-runs on click. |
| 12. **Cross-system flows visible on the graph** (frontend → backend route → SQL table) | ⚠️ | MVP shipped: TS/JS `fetch(...)` + `axios.*` matched against Python FastAPI / Flask routes via the new `callsites/<lang>.ts` plugin slot + `matchers/http`. Dashed protocol-tinted edges render between matched files. Still missing: SQL ref tracker, subprocess, env-configured URLs, OpenAPI contract awareness. |
| 13. **Plan completion artifact** (commit / PR with the diff against baseline) | ❌ | Not started. Eventually: one-click "open PR with these changes" once a plan is verified. |

**Concrete next pushes (in order):**

> **Phase 12 ✅ DONE** (Apr 27, 2026) — A, B, C, D, D2, E, F, G all shipped.
> See §3 Phase 12 for the per-sub-phase detail.

The active queue is now driven by:
- **Phase 13** — Plan Export + Multi-Device + Settings (designed in [PLAN-EXPORT.md](PLAN-EXPORT.md), not yet built; the headline feature for actual team use)
- **Electron build fixes** — needed before any DMG/EXE distribution
- **Phase 11** Multi-System follow-ups
- Graph quality + UX polish

##### Recently shipped (Apr 27, 2026)

1. ~~**Plan-task progress auto-detection**~~ ✅ — `plan-progress-service` hooks the file watcher; `pending`/`assigned` tasks auto-advance to `in_progress`; `task-completion-suggested` event fires once every ProposedChange is `satisfied`.
2. ~~**"Plan completion" verification panel**~~ ✅ — `VerificationPanel` on PlanDetail reads `/api/plans/:uid/changes?summary=1` and renders a colour-coded readiness card.
3. ~~**Cross-system MVP**~~ ✅ — TS/JS `fetch(...)` + `axios.*` matched against Python FastAPI / Flask routes via `callsites/<lang>.ts` + `cross-system-service`. Dashed protocol-tinted edges (purple HTTP) render alongside imports. MCP `list_cross_system_edges`. SQL / subprocess / env / OpenAPI matchers still pending.
4. ~~**Pre-existing TS errors**~~ ✅ — `npm run typecheck` returns zero.

##### Next up (in order)

5. ~~**Phase 13 §D + §E — Settings surface + Identity in attributions**~~ ✅ shipped — gear icon in TopBar opens a 5-section modal; identity defaults from `git config`; MCP port configurable + autodetects on collision; `CODETRELLIS_DATA_DIR` env var supported for the E2E harness; REST authoring sites use the configured identity email (falls back to `'human'`).
6. ~~**Phase 13 §A — Manual plan export / import**~~ ✅ shipped — `plan-file-service.ts` round-trips plan + phases + tasks + spec docs to disk; REST + MCP + UI. Multi-device works via `git push` / `git pull`.
7. ~~**Phase 13 §B — Auto-sync**~~ ✅ shipped — debounced write-through on every plan/phase/task/doc mutation, chokidar file watcher with self-write stamping, import-depth guard, YAML conflict-marker detection, per-plan Linked/Unlink toggle.
8. ~~**Electron build fixes (real DMG + EXE)**~~ ✅ shipped — vite renderer outDir absolute (was misplaced under src/frontend/.vite); tree-sitter WASMs via extraResource + dual-path probe in ast-parser; png2icons-driven icon.icns + icon.ico generation as a Forge generateAssets hook; maker-squirrel + maker-deb + maker-rpm added; conditional osxSign / osxNotarize wiring. **macOS DMG verified at 98 MB.** Windows EXE needs a Windows host or CI matrix.
9. **System-aware clustering** *(graph quality)* — use discovered systems as primary cluster boundaries so Python's 1688 internal edges aren't all one mega-cluster. Lets users actually navigate big repos.
10. ~~**Phase 13 §C — Templates as publishable repos**~~ ✅ shipped — disk templates from `<project>/.codetrellis/templates/` + `~/.codetrellis/templates/` merged with built-ins; "Publish as template" UI; `{{key}}` placeholder substitution.
11. **Server-side per-system rendered views** — backend computes `{ nodes, edges }` per scope and caches in DB so scope-switching is instant on big repos.
12. **Phase 11 §3 — systems table + MCP tools** (`list_systems`, etc.) — exposes the discovered system list as a queryable surface.
13. **Phase 11 §4 — system-aware Sidebar + Inspector + plan tasks `affectedSystems[]`** — Systems section above the file tree, system view kind in Inspector, drift attribution by system.
14. **Phase 11 §5 — cross-system non-import links (full)** — extends the HTTP MVP with SQL ref tracker, subprocess/env, OpenAPI contracts.
15. **Drift state on graph nodes** — emerald / amber / rose ring on each node in Diff mode (data already computed via `plan-changes-service`; just needs node visual wiring).
16. **Task ↔ graph linkage** — click a task in PlanPanel → graph highlights its affected files + planned edges; hover an affected file → corresponding node pulses.
17. **Learn Trellis (in-app onboarding takeover).** Full-screen UI walkthrough that teaches a new user the loop end-to-end: open project → see graph → make a plan → connect an agent → watch tasks land → verify completion. Tooltip-driven, skippable, designed so a developer is productive in < 10 min without docs. Needs design pass before code (sketch what each step covers; map to existing surfaces; decide on dismissibility + "show this again" behaviour).
18. **E2E test harness overhaul.** Designed in [E2E-HARNESS.md](E2E-HARNESS.md). Four phases: (1) fixture repo at `tests/fixtures/sample-app/` (TS + Python, ~25 files, known cross-system pairs) + harness scaffolding (per-test tmp data dir, dynamic ports, `services/clock.ts`, scripted MCP agent) + smoke test; (2) loop tests covering scan→plan-from-template→agent→auto-progress→verification; (3) plan-export round-trip tests (depends on Phase 13 §A); (4) optional visual diffs. Catches the loop regressions we keep shipping.

### Multi-System Ingestion — remaining sub-phases (see §3 Phase 11)
Already shipped: 1.A–1.E, 1.6 (plugin architecture), 2.A–2.E
(Python/Rust/PHP/Java parsers + resolvers), graph scope filter, AST
per-project scoping, /api/diff fix, EMFILE survival, animation perf.

Remaining: 2.F (Go), 2.G (SQL ref-tracker), 3 (systems DB + MCP),
4 (system-aware UI), 5 (cross-system links), 6 (external libs).

### Graph-quality blockers (Immediate Focus from previous tracker)
1. ❌ Make the four trellis modes visually unmistakable
2. ❌ Make node and edge state coloring much more obvious *(edges done; nodes still need it — see Quick wins #1 below)*
3. ❌ Keep Git working tree context visible across modes
4. ❌ Make Diff truly about live vs planned state *(edges done; nodes + auto-projection still open)*
5. ❌ Improve drill-down so context is preserved cleanly
6. ❌ Reduce congestion and make changed-but-unconnected files easier to place

### Quick wins (≤ a few hours each)
1. **Drift state on graph nodes** — emerald / amber / rose ring on each node in Diff mode (data already computed via `plan-changes-service`)
2. ~~**Diff mode auto-engages projection**~~ ✅ shipped — `setTrellisMode('diff')` auto-flips `projectionEnabled` when a projection is loaded.
3. ~~**AGENTS.md vs CLAUDE.md drift**~~ ✅ shipped — both files reconciled with the multi-agent MCP reality + actual repo structure.
4. **Verify auto-track HEAD fix end-to-end** with a real `git commit --amend`
5. **More plan templates** — alongside the shipped `mass-refactor`: ship "new feature", "bug fix", "library migration", "perf pass" templates. One new entry in `plan-templates.ts` per template; no schema work.
6. **Auto-updater** — `update-electron-app` against a GitHub Releases feed. App checks on launch + once a day; toast if a newer build exists; download + apply on next quit. Settings → About already shows the local build's metadata so manual checks work in the meantime.

### Medium-term
6. **Task ↔ graph linkage** — click a task in PlanPanel → graph highlights its affected files + planned edges; hover an affected file → corresponding node pulses
7. **Persisted clusters + cluster MCP** — let humans rename clusters and let agents propose changes (`create_cluster`, `rename_cluster`, `assign_files_to_cluster`, `annotate_cluster`, `suggest_cluster_changes`)
8. **Plan-task progress auto-detection** — advance a task to `in_progress` when its `affectedFiles` change on disk; auto-suggest `done` once every ProposedChange for the task is `satisfied`
9. **Spec-aware drift** — extend `get_drift_report` to flag "agent worked on file X without consulting `security` or `testing` doc"
10. **Task-level comments** + **Plan version viewer UI**
11. **Visual Plan Builder** — click nodes on the graph to add to a plan, draw connections between files, right-click context menu

### Larger pushes
12. **Make four trellis modes visually unmistakable** (Immediate Focus #1 spelled out): mode-tinted canvas / chrome / palette swap; "this is BASELINE" pulled out clearly; Diff feels different from Live at a glance
13. **Floating window primitive** — for plan + spec doc editors that don't block the graph (drag, resize, minimise to a corner chip)
14. **Filter bar** for the graph
15. **Semantic zoom** — cluster ↔ file ↔ symbol via zoom level
16. **Performance pass** — large repos (500+ files) currently block the main thread on parse / layout; needs worker pool for both
17. **Multi-Agent Dashboard** — cards per active agent, color-coded, conflict warnings (the TopBar `ConnectedAgents` widget is the v1; this is the dedicated multi-agent surface)
18. **Plan-template authoring UI** — humans can save the current plan shape as a new reusable template

### Cleanup
19. [docs/CODEX-VISUAL-OVERHAUL.md](CODEX-VISUAL-OVERHAUL.md) — one-off prompt, archive or delete
20. E2E tests for Spec Room, Inspector, and the new Phase 12 surfaces (Phases UI, Proposed Changes tab, Template picker, VerificationPanel, cross-system edges)
21. ~~Pre-existing TS errors~~ ✅ all clean (Apr 27, 2026). `npm run typecheck` returns zero errors.

---

## 8. MCP API Surface (current)

### Tools

**Architecture queries**
`search_symbols`, `get_dependencies`, `check_architecture`, `check_conformity`

**Plan management**
`create_plan` (full schema: tasks with `affected_files`, `affected_symbols`,
`new_connections`, `removed_connections`, `dependencies`, `file_spec`,
`symbol_specs`), `get_plan`, `update_plan`, `list_plans`

**Plan templates** *(Phase 12 §G)*
`list_plan_templates`, `create_plan_from_template` *(seeds plan + phases + spec docs in one sweep; first template: `mass-refactor`)*

**Plan phases** *(Phase 12 §A)*
`add_plan_phase`, `list_plan_phases`, `update_plan_phase`, `delete_plan_phase`

**Task management**
`claim_task`, `update_task` *(now accepts `phase_uid`)*, `get_next_task` *(now accepts `phase_uid`; empty string = unphased only)*

**Proposed changes** *(Phase 12 §B)*
`list_proposed_changes`, `get_changes_summary`, `get_change_status`

**Spec docs**
`add_plan_doc` *(accepts `order_hint` + `parent_doc_uid`)*, `update_plan_doc` *(same)*, `get_plan_doc`,
`list_plan_docs` (cheap summary index — includes order/parent), `search_plan_docs` (with excerpts)

**Comments**
`add_comment`, `get_comments`

**Sessions**
`register_session` *(now keys off the caller's transport sessionId so multiple agents stay attributed)*, `set_active_plan` *(same)*

**Deviations / drift**
`get_deviations`, `detect_deviations`, `reconcile`, `get_drift_report`

**Trellis snapshots**
`capture_checkpoint`

**Legacy (kept for back-compat)**
`report_plan` — prefer `create_plan`

### Resources

- `project://graph` — current dependency graph as JSON
- `project://stats` — file / symbol / import counts
- `codetrellis://plans` — list of all plans
- `codetrellis://sessions` — active agent sessions
- `codetrellis://skill` — project-tailored summary (current plans + connected agents + cheat sheet)
- `codetrellis://skill/quickstart` — first-time agent flow
- `codetrellis://skill/power-user` — deep usage (phased plans, granular task fields, drift verification, multi-agent coordination, spec docs as shared context, snapshots)

### REST endpoints worth knowing

- `POST /api/project/scan` · `GET /api/dependencies` · `GET /api/dependencies/file?path=`
- `GET /api/symbols/file?path=` · `GET /api/symbols/search?q=`
- `GET /api/file/content?path=&start=&end=&project=&plan=` (returns content + per-line git annotations + plan drift status)
- `GET /api/git/branch` · `GET /api/git/info` · `GET /api/git/status` · `GET /api/git/head` · `GET /api/git/commits` · `GET /api/git/branch-tip?branch=`
- `GET /api/recent-projects` · `DELETE /api/recent-projects` · `POST /api/recent-projects/pin`
- `GET /api/onboarding-state?project=`
- `GET/POST /api/plans` · `GET/PUT/DELETE /api/plans/:uid` · `GET /api/plans/:uid/tasks` · `PUT /api/plans/:uid/tasks/:taskUid` · `POST /api/plans/:uid/tasks/:taskUid/{claim,code-reference}` · `GET /api/plans/:uid/projection` · `GET /api/plans/:uid/deviations` · `POST /api/plans/:uid/reconcile` · `GET /api/plans/:uid/versions`
- `GET/POST /api/plans/:uid/docs` *(POST accepts `orderHint` + `parentDocUid`)* · `GET /api/plans/:uid/docs/by-type/:docType` · `GET /api/plans/:uid/docs/search?q=` · `GET/PUT/DELETE /api/plan-docs/:docUid` · `GET /api/plan-docs/:docUid/versions`
- `GET/POST /api/plans/:uid/phases` · `PUT/DELETE /api/plan-phases/:phaseUid` *(Phase 12 §A)*
- `GET /api/plans/:uid/changes` *(or `?summary=1` for counts)* · `GET /api/plans/:uid/changes/:changeId` *(Phase 12 §B)*
- `GET /api/plan-templates` · `POST /api/plans/from-template` *(Phase 12 §G)*
- `POST /api/trellis/capture` · `GET /api/trellis/snapshots` · `GET /api/trellis/:id` · `GET /api/trellis/:id/diff`
- `GET/POST /api/comments`
- `GET /api/baseline` · `POST /api/baseline/capture`
- `GET /api/diff?project=`
- `GET /api/agent/status` + WebSocket `/ws` for real-time events

---

## 9. Technical Debt

| Item | Priority | Notes |
|---|---|---|
| TypeScript strict mode errors | Low | Many `any` types in backend; works but not type-safe. `useRef()` initial-value warnings on React 19. |
| `PlanStatus` re-export ambiguity | Low | Both `shared/types/agent.ts` and `shared/types/plan.ts` export `PlanStatus` |
| Missing `@types/sql.js` | Low | Untyped sql.js usage in `database.ts` |
| AST parsing runs synchronously | Medium | Blocks Express thread on large repos |
| sql.js in-memory limitation | Low | Works for current scale; might need migration to persistent DB for very large projects |
| No test coverage for plan + spec UI | Medium | E2e tests cover API but not plan/spec interaction flows |
| Screenshot tests unreliable | Low | Project-opening via folder picker is flaky in Playwright |
| Stale test plans in DB | Low | E2e tests create plans that persist across runs |
| Multi-agent contention not designed | Medium | conflict-detected broadcasts but no UI to resolve |

---

## 10. Known Gaps Resolved Recently

- ✅ **Auto-track HEAD bug** — sidebar/canvas no longer carry stale dirty markers for ~30s after a commit. Root cause: `mergeGitSources` was set-unioning dirty paths from a stale shared state with a fresh polled commit hash, then `reconcileGitStatus` debounced clearing for 3 polls. Fix: prefer the post-commit clean source when commit hashes mismatch + bump `refreshVersion` after `captureBaseline` so the sidebar re-polls immediately.
- ✅ **Modal clipping** — PlanCreateModal / SpecDocViewer / SpecDocCreateModal / AddToTaskPopover were trapped inside the bottom panel. Cause: `.glass-panel` uses `backdrop-filter`, which creates a containing block for `position: fixed`. Fix: `createPortal(..., document.body)` for all modals.
- ✅ **Allotment first-render crash** — `Cannot read properties of undefined (reading 'minimumSize')` on mount. Fix: skip the first useEffect run for programmatic resizes; defer subsequent ones via `requestAnimationFrame` and try/catch.
- ✅ **File watcher missed non-JS edits** — chokidar only re-parsed `.ts/.tsx/.js/.jsx`. Fixed to include `.py / .rs / .php / .java / .mjs / .cjs`.

---

## 11. File Map

```
src/
  backend/
    server.ts                          — Express API + WebSocket; all REST routes
    index.ts                           — Standalone web mode entry
    services/
      project-scanner.ts               — Recursive dir scan with .gitignore
      monorepo-detector.ts             — Workspace type detection
      ast-parser.ts                    — tree-sitter WASM (TS/TSX/JS/JSX/Python/Rust/PHP/Java)
      database.ts                      — sql.js wrapper, all table DDL
      file-watcher.ts                  — chokidar; re-parses all supported langs
      diff-engine.ts                   — In-memory baseline + diff computation
      trellis-service.ts               — Trellis snapshots (current / planned / checkpoint)
      projection-service.ts            — Compute planned graph state from a plan's tasks
      plan-service.ts                  — Plans + tasks CRUD; appendTaskCodeReference, appendTaskToPlan, getTaskByUid; updateTask + getNextTask accept phase_uid (Phase 12 §A)
      plan-documents-service.ts        — Spec docs CRUD + version history + search; orderHint + parentDocUid (Phase 12 §C)
      plan-phases-service.ts           — Phase 12 §A: plan phases CRUD; createPhase auto-numbers; deletePhase detaches bound tasks
      plan-changes-service.ts          — Phase 12 §B: projects task fields into ProposedChange rows with computed drift status
      plan-templates.ts                — Phase 12 §G: pure-data template definitions (mass-refactor + future)
      plan-templates-service.ts        — Phase 12 §G: applyTemplate seeds plan + phases + spec docs in one sweep
      comment-service.ts               — Threaded comments on plans/tasks
      session-service.ts               — Agent session registry
      deviation-service.ts             — checkFileDeviation hook for plan drift
      recent-projects-service.ts       — Recent + pinned project list
      persistence.ts                   — DB autosave to disk
    agent/
      claude-code-watcher.ts           — Tails ~/.claude/sessions/<id>.jsonl
    mcp/
      server.ts                        — MCP SSE server (port 19432); all tools + resources; registerTool wrapper broadcasts tool_call/tool_error per Phase 12 §D
      skill-guide.ts                   — Phase 12 §E: markdown for codetrellis://skill[/quickstart|/power-user] resources
  frontend/
    App.tsx                            — Root layout; Allotment refs for programmatic panel resize
    bridge/                            — HTTP / Electron API abstraction
    hooks/
      useWebSocket.ts                  — WS handler; routes events to stores + toasts
      useKeyboardShortcuts.ts
    components/
      WelcomeScreen.tsx                — Logo + recent projects + open-another / explainer when empty
      FolderPickerModal.tsx
      McpGuideModal.tsx                — MCP setup wizard
      GettingStarted.tsx               — Floating onboarding checklist
      Toast.tsx
      ErrorBoundary.tsx
      layout/
        TopBar.tsx                     — Tabs, branch popover (with branch-pin baseline), depth selector, Connect Agent, ConnectedAgents widget
        ConnectedAgents.tsx            — Phase 12 §D2: count + popover listing every active MCP session (type / model / active plan / last seen)
        Sidebar.tsx                    — File tree with per-file git status markers
        MainCanvas.tsx                 — ReactFlow canvas, mode selector, baseline controls, refresh chrome
        InspectorPanel.tsx             — Kind-aware (cluster / file / symbol) routing, expand toggle
        PlanPanel.tsx                  — Tabs (Plans / Timeline / Changes / Proposed / Comments), expand toggle
        StatusBar.tsx
      graph/
        nodes/                         — PackageNode, DirectoryNode, FileNode, SymbolNode (glassmorphic)
        edges/
          ImportEdge.tsx               — Custom edges with state-aware visuals + animated flow dots
      plan/
        PlanList.tsx
        PlanDetail.tsx                 — Plan header, progress, SpecRoom, PlanPhases, fallback flat task list
        PlanPhases.tsx                 — Phase 12 §A: groups tasks by phase; expandable scope/prereqs/acceptance; "Unphased" bucket; create/edit modal
        ProposedChanges.tsx            — Phase 12 §B: ProposedChange feed grouped by task with status filter chips + kind selector
        PlanCreateModal.tsx            — Portaled modal; "Blank" + "From template" tabs (Phase 12 §G)
        SpecRoom.tsx                   — Inside PlanDetail; type chips, search, tree-rendered doc list (Phase 12 §C)
        SpecDocViewer.tsx              — Portaled modal; markdown + edit + version history + restore
        SpecDocCreateModal.tsx         — Portaled modal; type picker grid + starter skeletons; orderHint + parent dropdown; auto-numbered titles for repeat types (Phase 12 §C, §F)
        StatusBadge.tsx
        CommentThread.tsx
      inspector/
        CodePreview.tsx                — Prism syntax highlight + git gutter + drift border + line selection + DriftBadge
        AddToTaskPopover.tsx           — Portaled modal; three modes (existing / new task / new plan)
    lib/
      graph-builder.ts                 — Cluster discovery + view builders + edge change map (live × planned)
      graph-visuals.ts                 — Node sizing + visual data types
      markdown.tsx                     — react-markdown + remark-gfm wrapper (tables, task lists, autolinks); used by spec docs + skill guides + phase markdown
      spec-doc-types.tsx               — Doc taxonomy with icons + chip colors
    stores/                            — Zustand: graph, agent, project, plan, ui, toast
  electron/                            — Electron main + preload (untested)
  shared/types/                        — Plan, Task, Comment, PlanDocument, ProjectionData, GraphNode/Edge, etc.
docs/                                  — TRACKER.md (this) + vision/design docs (CORE-VISION, THREE-TRELLIS, CLUSTER-FIRST-VISION, GRAPH-UX-REFINEMENT, DATA-MODEL, MCP-INTEGRATION, UI-DESIGN, ARCHITECTURE, RESEARCH-NOTES, TESTING-GUIDE)
```

---

## 12. Recent Sessions Commit Log (newest first)

```
7d9f6cd Proposed Changes view — granular CRUD feed per plan (Phase 12 §B ✅)
2e6237e Plan templates + multi-doc-per-type ("Mass refactor" template) (Phase 12 §F + §G ✅)
865e057 Plan Phases — first-class checkpoints (swf-style "01 Foundation/…") (Phase 12 §A ✅)
ccf4d2e Spec docs: orderHint + parentDocUid (swf-style ordering + nesting) (Phase 12 §C ✅)
51e1b72 Add ConnectedAgents widget — multi-agent MCP visibility (Phase 12 §D2 ✅)
5bb2f88 Add MCP agent skill guide + generic per-tool timeline (Phase 12 §D + §E ✅)
dcf3b98 TRACKER: add Phase 12 — Deepening Plans + Agent Skills
669156e Update TRACKER through 2026-04-27 with multi-system progress + front-to-back gaps
41eeefa Stop animating regular edges — fixes pan/zoom slowness
27de688 Files-depth view no longer hides files silently
6e55646 Graph scope filter — limit canvas to one system / directory
2ebcc1e Stop /api/diff from re-parsing the entire project on every poll
00672ac Phase 1.6 + 2: language-plugin parsers/resolvers; Python edges; EMFILE survival; per-project AST scoping
ed3f346 Multi-system ingestion (Phase 1): discover every system, resolve workspace aliases, proper gitignore
5059f9f Consolidate trackers into a single TRACKER.md
7824b86 Edge drift visualization + watch all parseable extensions
734c957 Drift badge: pick which plan to compare against
27bf2ec Code viewer: syntax highlighting, git gutter, drift coloring, add-to-task
5e4ed58 Skip first-render Allotment.resize() to fix mount crash
5a25f90 Add panel expand toggle + kind-aware Inspector
63a7398 Add Spec Room — structured spec docs attached to plans
fdd93de Fix plan modal getting clipped to bottom panel
07d350d Add recent projects service and Getting Started onboarding
9c023f5 Make dev tasks idempotent by freeing ports before starting
9b8e53b Improve cluster discovery with dependency-based refinement
fe7fc63 Improve live git refresh behavior
4dc2efa Refine refresh handling for git state
b1b0d34 Fix auto-track head refresh state
232e1b1 Add baseline commit selection controls
4c4bb5e Add git status markers to sidebar explorer
c0cf5e0 Refine graph state handling and refresh stability
21b30e0 Add repository agent instructions
4a2657c Add polished graph nodes and import edges
1b0ea80 Fix critical bugs from testing report + entity-centric graph rewrite
d2c05db Implement Three Trellis State system
b99826f Add deviation detection, conflict warnings, toast system, and gap analysis
6b91e11 Add plan system, MCP expansion, force layout, persistence, and e2e tests
b7c8fa3 Initial commit — CodeTrellis v0.1.0
```
