# Phase 32 — Log

> The source of truth for Phase 32 progress. Read **Now** first. Update
> it before you need to (see [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md)
> §1.2): at the start and end of every step, after every decision,
> before long commands, and at least every 30 minutes.

---

## Now

| | |
|---|---|
| **Stage / step** | 0.1 Baseline |
| **Status** | in progress: typecheck, lint and unit done; build running; harness next |
| **Next action** | Finish the build, then run `test:harness` in the background and record results below |
| **Blockers** | none |
| **Branch** | `claude/wizardly-thompson-v52j45` → PR [#111](https://github.com/lionroseway/codetrellis/pull/111) into `feat/phase-32` (plan docs, CI trigger) |
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
- [ ] 0.1 Baseline (Node 26, clean `npm ci`, all suites)
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
| `build` (web) | running | | |
| `test:harness` | not yet run | | CLAUDE.md: 328 passed + 16 skipped, ~17 min budget |
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
