# Phase 32 — Log

> The source of truth for Phase 32 progress. Read **Now** first. Update
> it before you need to (see [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md)
> §1.2): at the start and end of every step, after every decision,
> before long commands, and at least every 30 minutes.

---

## Now

| | |
|---|---|
| **Stage / step** | 0.6a Descriptions (0.2 → #112 and 0.3b → #113, both green, awaiting merge) |
| **Status** | Bugs 5–7 fixed, and a wider class (bug 15: 21 guide entries with wrong argument names) fixed with a guard test. Bugs 4 and 8 reclassified. Harness running |
| **Next action** | Green harness → open the 0.6a PR. Merge order: #112, #113, 0.6a. After each merge, merge `feat/phase-32` into the next branch and run `npm run inventory` |
| **Blockers** | Merges of #112 / #113 (step 0.3 builds on #112's extractors) |
| **Branch** | `feat/phase-32-0.6a-descriptions` (from `feat/phase-32` at `1c6dd3c`) |
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
- [ ] 0.2 Inventory and verification matrix
- [ ] 0.3 Test mapping and coverage guards
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
`npm ci`, at `main` = `a4665b2` plus docs only.

| Check | Result | Time | Notes |
|---|---|---|---|
| `npm ci` | ok | — | `install-scripts` warnings as expected (npm 11.19 skips them); `better-sqlite3` and `node-pty` load from prebuilds |
| `typecheck` | **0 errors** | 19 s | |
| `lint` | **0 errors, 291 warnings** | 13 s | CLAUDE.md says ~277; the warning count is the baseline to not increase |
| `test:unit` | **950 tests: 947 pass, 0 fail, 3 skipped** | 30 s | CLAUDE.md says 461; out of date |
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

### 2026-09-26: 0.6a — descriptions that lied to agents
- While #112 and #113 await merge, took the independent 0.6 bugs.
- **Bugs 5–7 fixed:**
  - `check_conformity`'s description no longer promises layer rules;
    the guide's architecture table matches the real arguments.
  - The review tools' `before` default is described truthfully (newest
    commit, else baseline).
  - The skill-guide header lists all six resources.
- **Bug 15 (new, wider):** measured every `` `tool(args)` `` in every
  guide flavour against the arguments the server registers. 21 of 340
  documented calls named arguments that don't exist, e.g.:
  - `claim_item(item_uid)`, `update_item_progress(item_uid, note)`
  - the plan-history tools' `plan_uid` for `plan_slug`
  - `update_settings(path, value)`
  - `reconcile(deviation_uid, action)`

  All fixed. `server.ts` now records each tool's argument names at
  registration (`listRegisteredToolArgs`). A new guard in
  `skill-guide.test.ts` fails on any documented argument a tool doesn't
  take, and it was verified to catch a reintroduced mistake.
- **Bug 4 reclassified:** the missing push is the small part. A local
  agent's `await_user_input` never reaches the phone at all, because the
  snapshot only carries requests relayed from other desktops. That's the
  "answer an agent from the phone" feature, so it moves to B4/A4.
- **Bug 8 reclassified:** the unwired functions are the desktop-to-desktop
  relay, an unfinished multi-machine feature. Out of scope, not a
  defect.
- typecheck 0 errors; lint 0 errors / 291 warnings; unit 963 tests /
  960 pass / 3 skipped (+1 guard; this branch predates 0.2).

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
