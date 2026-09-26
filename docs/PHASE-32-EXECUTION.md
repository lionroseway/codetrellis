# Phase 32 — Execution plan

> Step by step, PR by PR. Progress lives in
> [PHASE-32-LOG.md](PHASE-32-LOG.md). **Read that first** when picking
> the work up.

Design docs this plan executes:

| Track | Doc |
|---|---|
| 0: ground truth | this doc, §3 |
| A: awareness engine | [PHASE-32-PARALLEL-AWARENESS.md](PHASE-32-PARALLEL-AWARENESS.md) |
| B: observability surface | [PHASE-32-OBSERVABILITY.md](PHASE-32-OBSERVABILITY.md), [PHASE-32-WIREFRAMES.md](PHASE-32-WIREFRAMES.md) |
| C: shared ways of working | [PHASE-32-SHARED-WORK.md](PHASE-32-SHARED-WORK.md) |

The facts under all of them are in [PHASE-32-CURRENT-STATE.md](PHASE-32-CURRENT-STATE.md);
the stories are in [PHASE-32-JOURNEYS.md](PHASE-32-JOURNEYS.md).

---

## 1. How the work is run

This is long-running work across many sessions. Context gets compressed,
sessions end, and people pick things up cold. So the state of the work
lives **in the repo**, never only in a conversation.

### 1.1 The log is the source of truth

`docs/PHASE-32-LOG.md` holds:

- **Now:** current step, status, the very next action, blockers, last
  updated. It must always be true.
- **Checklist:** every step in this plan, with a box.
- **Baseline:** the test and tool numbers the work is measured against.
- **Decisions:** what was decided, why, and when.
- **Entries:** a dated, newest-first record of what happened.

### 1.2 When to update it

Update the log **before** it's needed, not after:

1. At the **start** of a step: set Now, and tick the step in progress.
2. After **every decision**, or anything surprising.
3. **Before** any command that takes more than a few minutes (harness,
   package, big refactor), with what's running and why.
4. At least every **30 minutes** of work, even if it's only "still on X,
   next is Y".
5. At the **end** of a step: tick it, record test counts, the PR link,
   and the next step.

If a session could end right now, the log must be enough for the next
one to continue without asking.

### 1.3 Branches and PRs

- **Integration branch:** `feat/phase-32`, cut from `main`. It merges
  into `main` once, when the phase is done.
- **One step = one branch = one PR** into `feat/phase-32`, named
  `feat/phase-32-<step>-<slug>` (for example
  `feat/phase-32-a0-parallel-bugs`).
- **CI runs on PRs into `feat/phase-*`** (`ci.yml`, `security.yml`).
- **Before a phase-end merge:** bring `main` into `feat/phase-32`, run
  everything, and verify a packaged build (CLAUDE.md: only a packaged
  build proves Electron + native modules).

### 1.4 Definition of done, for every step

- [ ] **Tests for the new behaviour**, plus tests for any existing gap
      the step touched.
- [ ] `npm run typecheck`: 0 errors.
- [ ] `npm run lint`: 0 errors (warnings allowed, count not increased).
- [ ] `npm run test:unit`: all pass.
- [ ] `npm run test:harness`: all pass, or the step changes nothing it
      covers and says so.
- [ ] **Guards green:**
  - `reachable.test.ts` (every component rendered)
  - `server-confinement.test.ts`
  - MCP capability coverage
  - peer-capability coverage
- [ ] **UX checked** against the rules (§1.6) for anything visible, with
      a screenshot in the PR.
- [ ] **Docs:**
  - CURRENT-STATE when a fact changes
  - the design doc when the design changes
  - `docs/claude/*` when a convention changes
- [ ] **Log updated:** step ticked, numbers, PR link, next action.

### 1.5 Test failures are ours

The suite was fully green at the start (Baseline, in the log). Any
failure after that is ours to fix, in the same PR. **Never skip,
disable or quarantine a test** to get green. If a test turns out to be
wrong, fix the test with a note saying why, in its own commit.

### 1.6 UX rules (from Phase 29 §3, Phase 31 §10.4, and the observability doc §2)

- Quiet by default. A count opens detail. No banners or modals, and no
  red unless something is wrong.
- Glyph + word, never colour alone.
- Say what it means, not what it counts.
- Discrete frames; name both sides of any comparison; unknown is
  unknown, not zero.
- Dark-first, in the existing visual language.
- Empty states are content.

### 1.7 Direction checks

At the end of each stage, a **direction review** entry in the log
answers:
- Which journeys (JOURNEYS.md) can be demonstrated end to end now?
- What did we learn that changes the plan?
- Is anything getting noisier, slower or harder to read?

If a review changes the plan, this doc is updated in the same PR.

---

## 2. Sequence

Stage 0 comes first and is not optional. Everything after it is ordered
so each step is usable by itself, and so the clearest value lands early.

```
0.1 → 0.2 → 0.3 → 0.4 (domains) → 0.5 → 0.6 → 0.7 review
  → A0 → A1 → B1 → B2 → C1 → A2 → B4 → B3 → A3 → review
  → B5 → A4 → A5 → B6 → B7 → A6 → C2 → C3 → B8 → B9 → C4 → A7 → B10 → review
  → phase-end: main merged in, full suite, packaged build, merge to main
```

Steps near the front are specified in detail. Later steps are specified
at the level of the design docs, and refined into sub-steps when they
become next ("rolling wave"). Refining a step is itself a log entry.

---

## 3. Stage 0: ground truth

> Don't trust what we have. Assert that everything exists and works as
> intended across the whole app, that the UI is clean, and that there
> are tests for everything.

Scale, measured 2026-09-26:

| Surface | Count |
|---|---|
| REST routes | 226 |
| MCP tools | 186 registered = 186 capability rows (reconciled in 0.2; an early grep said 165) |
| Mobile RPC methods | 72 |
| Frontend components | 98 |
| Mobile screens | 31 |
| Backend services | 110 |
| Unit test files | 99 |
| Harness specs | 118 |

### 0.1 Baseline

Establish, on Node 26 from a clean `npm ci`:
- typecheck
- lint
- unit tests
- web build
- harness

Record counts, timings and warnings in the log's Baseline section.

- **Done when:** every number is in the log, and anything not green is
  explained.
- **Can't be done here:** the packaged Electron build and on-device
  mobile. Both are recorded as "needs a person on macOS / a device", with
  the exact command from CLAUDE.md.

### 0.2 Inventory

A script (`tools/inventory/`) generates `docs/PHASE-32-VERIFICATION.md`,
a matrix with one row per:
- REST route
- MCP tool
- RPC method
- component
- mobile screen
- settings section

Columns: domain · what it is · unit tests · harness tests · behaviour
verified · UX checked · notes.

- The script is committed and re-runnable. The matrix is generated, and
  the human columns are preserved across runs.
- Reconcile the 165 registered tools against the 186 capability rows:
  the difference is either stale rows or registrations the count missed.
- **Done when:** the matrix exists, and every row has a domain.

### 0.3 Test mapping and coverage guards

- Fill the matrix's test columns by searching tests for each route path,
  tool name, RPC method and component name.
- Add **structural guards** in the style of `reachable.test.ts`, so
  "tests for everything" is enforced rather than hoped for:
  - every MCP tool is called by at least one test
  - every REST route is exercised by at least one test
  - every RPC method is exercised by at least one test

  Each guard starts with an **allowlist of today's gaps**. The allowlist
  may only shrink, and the guard fails if a new untested entry appears
  or if an allowlisted entry gains a test but isn't removed.
- **Done when:** the guards are in and green, and the allowlists are
  counted in the log.

### 0.3b Skipped tests

At baseline, 17 harness tests and 3 unit tests don't run. Each one gets
**unskipped** (reseeded or made deterministic) or **justified** as
conditional on the environment:

| Tests | Why skipped | Action |
|---|---|---|
| agent-loop (2), multi-agent (2), task-context (7) | Exercised V1 plan tools removed in the V2 migration | **Done:** rewritten onto V2. agent-loop 2 and multi-agent 2 unskipped. task-context: 3 of 7 were already covered by `plan-items.test.ts`, 4 were not and are now tested (bug 14). Rewriting agent-loop found bug 13 |
| full-loop (4) | Fixture seeded V1 tasks, so V2 deviation detection never saw their files | **Done:** also seeded as V2 Actions; 4 unskipped |
| plan-export (1) | chokidar auto-sync raced a timer | **Done:** stale skip. #73 already made the wait deterministic (awaits `ready`); verified under load and unskipped |
| build-artifacts (1) | `mobile/node_modules` absent | Justified: conditional on the environment. CI installs it where it matters |
| reader-host (1, unit) | Needs `npm run build:reader` | Justified: CI builds it first |
| release-signature (2, unit) | Private signing key lives only on the release machine | Justified: by design |

### 0.4 Behavioural sweep, by domain

One sub-step and one PR per domain. For each:
- drive the web build with the harness through the domain's journeys
- fill the matrix's "behaviour verified" column
- add the missing tests (shrinking the allowlists)
- fix what's broken

| # | Domain | Covers |
|---|---|---|
| 0.4a | Project and scan | open, scan, rescan, recent projects, worktrees, trusted roots |
| 0.4b | Graph | modes (current/planned/live/diff), layout, focus, projection, checkpoints, playback bar |
| 0.4c | Plans and items | create, tree, move, versions, restore, dependencies, claim, next item, templates and playbooks, import/export and write-through |
| 0.4d | Criteria and sign-off | criteria, evidence, checks, check runs, worklist, decide, sign-off pack |
| 0.4e | Brief and viewer | get_brief, materials, read_material, viewer formats, rendition fallbacks |
| 0.4f | Channels and presence | post, thread, resolve, routing rules, webhooks, presence pane, awaits |
| 0.4g | Agents and MCP | connector, sessions, identity, capabilities, project scope, timeline turns, stuck sensor |
| 0.4h | Drift, governance, review | deviations, freeze, baseline, review_plan, PR draft, compare snapshots |
| 0.4i | Terminals and audio | create, write, read, presets, remote terminals, audio capture |
| 0.4j | Mobile surface | every RPC method via the harness peer path, approvals, snapshot and patches, push rules |
| 0.4k | Settings, updates, privacy | every settings section, update check on/off, spell-check bundle, logs |
| 0.4l | System docs and intake | system docs, freshness, external intake, ticket sync state |

### 0.5 UX audit

- Screenshot every panel, tab, empty state and error state in the web
  build (the harness can capture them).
- Review each against §1.6, and list issues in the matrix's UX column
  with severity.
- Fix in batches by area. Each batch is a PR with before and after
  screenshots.
- **Done when:** no open issue above "minor", and minors are listed in
  the log.

### 0.6 Known bugs

Each gets its own regression test (from CURRENT-STATE):

| Bug | Fix in |
|---|---|
| 1 `claim_item` assignee is agent type | A0 |
| 2 `register_session` wipes plan and terminal link | A0 |
| 3 watcher reads first `tool_use` only | A0 |
| 4 `pushForInputRequest` unwired | B4 / A4 (reclassified: local agent prompts never reach the phone) |
| 5 guide and tool descriptions for architecture tools wrong | 0.6a (fixed) |
| 6 review `before` default misdescribed | 0.6a (fixed) |
| 7 skill-guide header out of date | 0.6a (fixed) |
| 8 remote-interaction relay unwired | not a defect: desktop-to-desktop relay, out of scope for Phase 32 |
| 9 scan baseline lost on restart | 0.6 |
| 10 spec body edits leave no event | B1 (event log) |
| 11 cross-plan dependencies never resolve | B6 |
| 12 CI lint step disabled on a stale premise | 0.3 |
| 13 auto-progress ignored V2 Actions | 0.3b (fixed) |
| 14 skipped test's coverage claim was false | 0.3b (fixed) |
| 15 guides documented arguments the tools don't take | 0.6a (fixed + guard) |

Anything the sweep (0.4) finds is added to this table and to
CURRENT-STATE.

### 0.7 Stage review

- The matrix is complete. The allowlists and UX issues are counted.
- Bugs 4–9 are fixed.
- A direction review is in the log.

---

## 4. Track A: awareness engine

### A0: Parallel-work bugs (bugs 1–3)

- `claim_item` records the **session** as assignee, and compares
  overlap by session.
- `register_session` updates in place: it keeps `active_plan_uid` and
  `host_terminal_id` unless given.
- The Claude Code watcher iterates **every** `tool_use` block.
- **Tests:**
  - unit: two same-type sessions see each other's claim overlap
  - unit: re-registering keeps the plan and terminal link
  - unit: a watcher fixture with two tool calls in one message yields
    two events

### A1: See every workstream, and collisions (spec M0 + M1)

| Sub-step | Delivers | Tests |
|---|---|---|
| A1.1 | Connector sends `x-codetrellis-cwd` and `x-codetrellis-host-terminal`; server reads them at connect; `roots/list` fallback; `workstream_root` column; validation against worktrees and the opened project | connector unit; server binding unit, including rejected paths; confinement guard |
| A1.2 | Claude Code watcher: set of sessions keyed by folder, events tagged with session and folder | unit with two fixture sessions in two worktrees |
| A1.3 | Workstream discovery (worktree, shared checkout), `list_workstreams`, capability rows, TopBar strip | unit discovery from porcelain fixtures; harness: strip shows N chips; reachable |
| A1.4 | `workstream-watch-service`: folder watchers, debounced diff and status, footprint changed files | unit with a temp repo and worktrees |
| A1.5 | Footprint symbols via `parseVirtualFile` (disk vs merge base) | unit per language fixture |
| A1.6 | `awareness_signals` table, pure `computeSignals` (collision, stale-base), `get_awareness`, `check_footprint` | unit: every kind, dedupe, resolve; MCP capability coverage |
| A1.7 | Branch and clone workstreams (refs watcher, clone consent) | unit ref fixture; harness consent prompt |
| A1.8 | Awareness tab in PlanPanel (digest placeholder, signals list, actions) | harness; reachable; UX screenshot |

### A2–A7

Refined into sub-steps when next. Scope is per the awareness spec:

| Step | Spec | Scope |
|---|---|---|
| A2 | M2 | Signatures (TS/JS, Python), import accuracy fixes, contract and drift signals, inline notices, `declare_intent` |
| A3 | M3 | Digest, intended and cooldown, `parallel` guide flavour, user skill and optional hook installer (Add to Claude Desktop pattern), `docs/claude/awareness.md` |
| A4 | M4 | Mobile: Needs you, workstreams, signal detail, push for high |
| A5 | M5, §9 | Review: other work in flight, `commit:` edges from footprints, queue with order, opt-in criterion check |
| A6 | M6, §10 | Brief: task binding via `get_brief`, `material_read` session and hash, grouped material signals, version-split |
| A7 | M7 | Rules format, `rule` signals, `check_conformity` made true |

## 5. Track B: observability surface

| Step | Scope (observability doc §13) |
|---|---|
| B1 | `agent_events` log (tool calls, watcher events, spec body edits), with session, workstream and time |
| B2 | Timeline lanes per workstream: ● ◆ ⚠ ✓ marks, live, hover and click |
| B3 | Overlay list in `graph-builder`; plan intent, workstreams and collision zones as overlays |
| B4 | Breakpoints: table, enforcement at interception, `await_decision`, inbox, phone, timeline span, breach wording |
| B5 | Replay: automatic snapshots (turn end, status change, commit) with SHA and session; one clock; catch-up |
| B6 | Stack view: multi-plan aggregate, overlap bands, drawn and cross-plan dependencies (bug 11) |
| B7 | Conferring: `propose_spec_change`, task → spec links, addressed events, decision as breakpoint |
| B8 | Grounding: per-test JUnit, tests → code via imports, overlay and task line |
| B9 | Play-forward: every active plan's projection, future zones |
| B10 | The record: hash-chained log, signed packs, retention settings, evidence export |

## 6. Track C: shared ways of working

| Step | Scope (shared-work doc) |
|---|---|
| C1 | Skills: model fields, skills index and picker, brief/claim/next delivery, proof of use, safety flag on pulled skills |
| C2 | Team status: STATUS.md per plan and index, ticket refs exported, signed approvals |
| C3 | Linked planning repo |
| C4 | Recurring playbooks |

## 7. Phase end

1. Merge `main` into `feat/phase-32`, and resolve conflicts.
2. Run the full suite on Node 26 from a clean `npm ci`.
3. Packaged build on macOS per CLAUDE.md; launch and confirm "Backend
   initialised".
4. Mobile build if the mobile surface changed (it will: A4, B4).
5. Final direction review. JOURNEYS updated with what shipped.
6. One PR, `feat/phase-32` → `main`.
