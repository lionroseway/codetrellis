# Phase 32 — Log

> The source of truth for Phase 32 progress. Read **Now** first. Update
> it before you need to (see [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md)
> §1.2): at the start and end of every step, after every decision,
> before long commands, and at least every 30 minutes.

---

## Now

| | |
|---|---|
| **Stage / step** | 0.3 Coverage guards (0.2 merged as #112; 0.3b → #113, 0.6a → #114, both green) |
| **Status** | Guards and CI lint done on `feat/phase-32-0.3-coverage-guards`; unit 975/978; PR next |
| **Next action** | Open the 0.3 PR. Whichever of #113 / 0.3 merges second must shrink `untested.json`: #113 adds tests for items it lists. Then 0.4a (behavioural sweep: project and scan) |
| **Blockers** | none |
| **Branch** | `feat/phase-32-0.3-coverage-guards` (from `feat/phase-32` at `53576ca`) |
| **Last updated** | 2026-09-26 |

---

## Checklist

### Setup
- [x] Integration branch `feat/phase-32` cut from `main` (`a4665b2`)
- [x] Plan docs PR [#111](https://github.com/lionroseway/codetrellis/pull/111) into `feat/phase-32`
- [x] CI and security run on PRs into `feat/phase-*` (in #111)
- [x] Execution plan and this log
- [x] CLAUDE.md points every session here

### Stage 0: ground truth
- [x] 0.1 Baseline (Node 26, clean `npm ci`, all suites)
- [x] 0.2 Inventory and verification matrix
- [x] 0.3 Test mapping and coverage guards (+ enable CI lint, bug 12)
- [ ] 0.3b Skipped tests: 16 harness tests to reseed or make deterministic
- [ ] 0.4a Project and scan
- [ ] 0.4b Graph
- [ ] 0.4c Plans and items
- [ ] 0.4d Criteria and sign-off
- [ ] 0.4e Brief and viewer
- [ ] 0.4f Channels and presence
- [ ] 0.4g Agents and MCP
- [ ] 0.4h Drift, governance, review
- [ ] 0.4i Terminals and audio
- [ ] 0.4j Mobile surface
- [ ] 0.4k Settings, updates, privacy
- [ ] 0.4l System docs and intake
- [ ] 0.5 UX audit
- [ ] 0.6 Known bugs 4–9
- [ ] 0.7 Stage review

### Track A: awareness
- [ ] A0 Parallel-work bugs 1–3
- [ ] A1.1 Session binding
- [ ] A1.2 Multi-session Claude watcher
- [ ] A1.3 Workstream discovery and strip
- [ ] A1.4 Folder watching
- [ ] A1.5 Footprint symbols
- [ ] A1.6 Signals engine (collision, stale-base) and tools
- [ ] A1.7 Branch and clone workstreams
- [ ] A1.8 Awareness tab
- [ ] A2 Meaning (signatures, contract, drift, notices, intent)
- [ ] A3 Distilled (digest, guide, skill and hook)
- [ ] A4 Mobile
- [ ] A5 Review
- [ ] A6 The Brief
- [ ] A7 Rules

### Track B: observability
- [ ] B1 Agent event log
- [ ] B2 Timeline lanes
- [ ] B3 Overlay list
- [ ] B4 Breakpoints
- [ ] B5 Replay
- [ ] B6 Stack view
- [ ] B7 Conferring
- [ ] B8 Grounding
- [ ] B9 Play-forward
- [ ] B10 The record

### Track C: shared ways of working
- [ ] C1 Skills on tasks
- [ ] C2 Team status through git
- [ ] C3 Linked planning repo
- [ ] C4 Recurring playbooks

### Phase end
- [ ] `main` merged in, full suite green on Node 26
- [ ] Packaged macOS build verified (needs a person on macOS)
- [ ] Mobile build verified (needs a device)
- [ ] Final direction review
- [ ] `feat/phase-32` → `main`

---

## Baseline

Measured in the cloud container on **Node 26.10.0 / npm 11.19.1**, clean
`npm ci`. Harness and build at `1433770` plus the plan docs; typecheck, lint
and unit re-run at `1c6dd3c` (`feat/phase-32` after #111).

| Check | Result | Time | Notes |
|---|---|---|---|
| `npm ci` | ok | — | `install-scripts` warnings as expected (npm 11.19 skips them); `better-sqlite3` and `node-pty` load from prebuilds |
| `typecheck` | **0 errors** | 19 s | |
| `lint` | **0 errors, 291 warnings** | 13 s | CLAUDE.md says ~277; the warning count is the baseline to not increase |
| `test:unit` | **962 tests: 959 pass, 0 fail, 3 skipped** (at `1c6dd3c`; 950/947 at `1433770`) | 30 s | CLAUDE.md says 461; out of date |
| `build` (web) | **ok** | 33 s | one chunk-size warning (>500 kB), pre-existing |
| `test:harness` | **363 passed, 17 skipped, 0 failed, 0 flaky** | 18.6 min | CLAUDE.md says 328 + 16. Skips are in agent-loop (2), build-artifacts (1), full-loop (4), multi-agent (2), plan-export (1), task-context (7); each is explained or fixed in 0.3. Run with a git-excluded `playwright.local.config.ts` pointing at `/opt/pw-browsers/chromium`, because the container's Chromium doesn't match Playwright 1.63's pinned revision |
| Packaged Electron | can't run here | | needs macOS: `npm ci && npm run package:mac`, launch, confirm "Backend initialised" |

---

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-09-25 | Phase 32 is one developer, one machine. Nothing leaves the machine beyond what already does | Keeps the phase shippable and the public repo free of anything else |
| 2026-09-26 | Integration branch `feat/phase-32`; one PR per step into it; one merge to `main` at the end | Smaller reviewable PRs, one release-level merge |
| 2026-09-26 | CI and security run on PRs into `feat/phase-*` | Otherwise PRs into the integration branch were untested |
| 2026-09-26 | Stage 0 (verify everything, tests for everything, clean UX) before new features | Don't build on assumptions; the current-state audit already found 11 bugs |
| 2026-09-26 | Workstreams are deltas over the one project graph | The backend holds one project graph at a time (CURRENT-STATE §1) |
| 2026-09-26 | `rule` signals wait for a rules format (A7) | No architecture rules exist (CURRENT-STATE §4) |
| 2026-09-26 | Breakpoints distinguish enforced from detected | CodeTrellis can't stop editor-tool edits without a hook |
| 2026-09-26 | Security findings go to `docs/private/`, never these docs | CLAUDE.md Phase 19 rule; one finding raised to the owner in chat |

---

## Entries

### 2026-09-26: 0.3 coverage guards
- **`tools/inventory/coverage.test.ts`:** every REST route, MCP tool and
  RPC method must be reached by a test, or be listed in
  `tools/inventory/untested.json`. The list can only shrink. The guard
  fails on a new untested item, on a listed item that gained a test, and
  on a listed item that no longer exists. Verified: removing an entry
  fails with "has no test — write one".
- **Skipped tests no longer count as coverage** (`stripSkippedTests`):
  string-named `test.skip`, `test.describe.skip`, `describe.skip` and
  `it.skip` calls are removed before searching. Conditional
  `test.skip(!ok, …)` guards are kept.
- **Starting list:** 75 routes, 74 tools, 47 RPC methods. This branch
  predates #113, so its V1 skipped files no longer count and REST reads
  75. When #113 lands, entries its tests now reach must be deleted from
  the list, and the guard will name them.
- **Bug 12 fixed:** CI's lint step is enabled, and the header note
  corrected.
- `collect()` was split out of `build()`, so the guard and the matrix
  share one enumeration.
- `CLAUDE.md` counts corrected (lint ~291, unit ~975, harness ~380), and
  the shrinking-list rule documented.
- typecheck 0 errors; lint 0 errors / 291 warnings; unit 978 tests / 975
  pass / 3 skipped. Harness not re-run: no runtime code changed (tools,
  CI and docs only).

### 2026-09-26: 0.2 green
- Harness on `feat/phase-32-0.2-inventory`: 363 passed, 17 skipped,
  0 failed, no retries, 18.1 min. This is also the first harness run on
  the post-#110 base, and #110's connector change is clean.

### 2026-09-26: Skipped tests triaged (for 0.3b)
- **Harness 17:**
  - 11 exercise removed V1 tools (agent-loop, multi-agent,
    task-context).
  - 4 have a V1 fixture (full-loop).
  - 1 is a racy chokidar wait (plan-export).
  - 1 is environment-conditional (build-artifacts).
- **Unit 3:** reader-host needs `build:reader`; release-signature needs
  the release key (2).
- So 16 tests hide behaviour we want covered, and 4 are legitimately
  conditional. Added EXECUTION §0.3b.

### 2026-09-26: 0.2 inventory built
- `tools/inventory/` has pure extractors (`extract.ts`) and a runner
  (`run.ts`); `npm run inventory` generates
  `docs/PHASE-32-VERIFICATION.md`. 12 unit tests, including one that
  fails when the committed matrix is stale or any row has no domain.
  `test:unit` now also runs `tools/**/*.test.ts`; `tsconfig` includes
  `tools/inventory`.
- **The surface:**
  - 226 REST routes
  - 186 MCP tools
  - 72 RPC methods
  - 98 components
  - 31 mobile screens
  - 12 settings sections
- **MCP reconciled:** 186 registered = 186 capability rows, with no stale
  rows and no unauthorised tools. The earlier "165" was a grep that
  missed multi-line registrations.
- **Test-mention gaps**, meaning no test file mentions the item even via
  harness helpers:
  - 63 REST routes
  - 74 MCP tools
  - 47 RPC methods

  Spot-checked five tools and three RPC methods by hand; all are real
  gaps (one apparent hit was prose in a comment).
- The first freshness run caught the inventory's own test fixtures being
  counted as coverage. They're excluded now.
- **Finding 12:** CI's lint step is commented out with a note saying
  ESLint isn't installed. It is (`eslint ^9.39.5`, and lint passes with
  0 errors), so lint is currently ungated. Enable it in 0.3.

### 2026-09-26: #111 merged; 0.2 started
- #111 was squash-merged into `feat/phase-32` as `1c6dd3c`.
- **Baseline correction:** the 0.1 numbers were measured on `1433770`,
  not `a4665b2` as first written (my branch predated #110). Re-ran on
  the true base `1c6dd3c`:
  - typecheck: 0 errors
  - lint: 0 errors / 291 warnings
  - unit: **962 tests, 959 pass, 0 fail, 3 skipped** (+12 from #110's
    connector tests)

  The harness wasn't re-run. #110 touched the connector only; it gets
  re-run in 0.2's definition of done.
- Step branches follow the plan's naming. The old session branch can't
  be force-reset to the new base, so each step gets a fresh branch from
  `feat/phase-32`.

### 2026-09-26: 0.1 Baseline complete
- The full harness is green on Node 26.10.0: 363 passed, 17 skipped,
  0 failed, no retries needed, 18.6 min. The web build is ok.
- CLAUDE.md's counts are stale (unit 461 → 950, harness 328+16 →
  363+17, lint ~277 → 291 warnings). Update CLAUDE.md in 0.2, when the
  inventory gives exact numbers.
- The 17 skips are a stage-0 item. "Tests for everything" includes
  knowing why a test doesn't run.
- CI now runs on #111, since it's a PR into `feat/phase-*`. Subscribed
  to its activity.

### 2026-09-26: Setup and baseline started
- Cut `feat/phase-32` from `main` (`a4665b2`), and opened #111 (plan docs) into it.
- Added `feat/phase-*` to the `ci.yml` and `security.yml` PR triggers.
- Wrote EXECUTION (the step plan), SHARED-WORK (track C) and this log.
  Added the CLAUDE.md pointer.
- Installed Node 26.10.0 locally (the container default is 22).
  `npm ci` is clean.
- typecheck 0 errors; lint 0 errors / 291 warnings; unit 947/950 pass,
  3 skipped. Build running.
- Sized stage 0:
  - 226 REST routes
  - 165 MCP tool registrations vs 186 capability rows (to reconcile in
    0.2)
  - 72 RPC methods
  - 98 components
  - 31 mobile screens
  - 110 services
  - 99 unit test files
  - 118 harness specs

### 2026-09-25: Planning
- Wrote the awareness spec, CURRENT-STATE (verified line by line),
  JOURNEYS, OBSERVABILITY and WIREFRAMES.
- Found 11 existing bugs (CURRENT-STATE, "Bugs found along the way").
- Raised one security finding to the owner, kept out of the repo.
