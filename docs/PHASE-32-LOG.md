# Phase 32 — Log

> The source of truth for Phase 32 progress. Read **Now** first. Update
> it before you need to (see [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md)
> §1.2): at the start and end of every step, after every decision,
> before long commands, and at least every 30 minutes.

---

## Now

| | |
|---|---|
| **Stage / step** | 0.4j Mobile surface |
| **Status** | Started. #127 (0.4i, bug 35) merged; its full harness at `efb8be0` was 530 passed, 0 retries |
| **Next action** | `tests/harness/peer.ts` done (a werift phone paired through the real ceremony). `phone-plans.test.ts` (11) green after fixes: phone item edits never saved (no author, bug 36); phone plan and item edits, plan delete, links, item comments and channel posts never reached the desktop windows, delete left the files, channel post took its author from the request and skipped routing and export (bug 37); plan and item status unchecked on REST and phone (bug 38). Next: channels, projects, power, diagnostics, settings over the phone |
| **Blockers** | none |
| **Branch** | `feat/phase-32-0.4j-mobile` |
| **Last updated** | 2026-09-27 |

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
- [x] 0.3b Skipped tests: 16 harness tests to reseed or make deterministic (#115)
- [x] 0.4a Project and scan (#116)
- [x] 0.4b Graph (#117)
- [x] 0.4c-1 Plans (#118)
- [x] 0.4c-3 Plan deletion only by human confirmation (MCP can ask, not delete) (#119)
- [x] 0.4c-2 Items, incl. retiring the V1 task API (#120)
- [x] 0.4d Criteria and sign-off (#121)
- [x] 0.4e Brief and viewer (#122)
- [x] 0.4f Channels and presence (#123)
- [x] 0.4g Agents and MCP (#124)
- [x] 0.4h Drift, governance, review (#125)
- [x] 0.4i Terminals and audio (#127)
- [ ] 0.4j Mobile surface
- [ ] 0.4k Settings, updates, privacy
- [ ] 0.4l System docs and intake
- [ ] 0.5 UX audit
- [ ] 0.6 Known bugs 4–9
- [ ] 0.7 Stage review
- [ ] 0.8 Release (Stage 0 ships before Tracks A–C)

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
| 2026-09-26 | One Phase 32 step PR open at a time; each step branches from `feat/phase-32` after the previous merge | Squash merges plus shared docs made parallel and stacked PRs conflict (#113–#115) |
| 2026-09-26 | Git checkout facts (branch, git dir, branches) are read from git's on-disk layout, not by running `git` | Auto-detect asks about unopened directories; `safe.directory` would blank the branch where the file read worked (0.4a) |
| 2026-09-26 | `project.*` RPC methods are verified in 0.4j, not 0.4a | No harness path to the peer RPC surface yet; 0.4j builds it |
| 2026-09-26 | Step PRs into `feat/phase-32` are merged by the agent once green (squash); no waiting on the owner | Owner's instruction |
| 2026-09-26 | Retire the V1 task API: `/api/tasks/*`, `/api/plans/:uid/tasks*` and the dead plan-store functions (in 0.4c-2) | Owner's decision. Nothing live calls them since bug 21's fix; tests for dead surface would be waste |
| 2026-09-26 | Plan deletion leaves MCP. An agent may ask; the app shows a confirmation where the person types the plan's name (0.4c-3) | Owner's decision. Deleting shared plan files is a human act |
| 2026-09-26 | Cut a release at the end of Stage 0 (new step 0.8), before Tracks A–C | Owner's decision. Stage 0 has found and fixed a lot across the app |
| 2026-09-26 | Cloud-environment CLI is follow-on work, specified in `docs/FOLLOW-ON-CLOUD-ENVIRONMENTS.md`, not part of Phase 32 | Widens Phase 32's one-machine scope |
| 2026-09-26 | Agents are co-workers: they may add and (where policy allows) close criteria. Every criterion and decision is tagged with who did it, taken from how the call arrived — MCP = that agent, paired phone = the person on that device, the app window (Electron IPC) = the person in the app, plain HTTP = "local API, unverified". Policies unchanged; the sign-off pack shows agent and unverified decisions separately (0.4d) | Owner's decision. Honest provenance over blocking agents |
| 2026-09-26 | Agents may change a plan's budget; each change is recorded (who, how it arrived, before and after) and an agent's change is flagged on the budget chip until a person marks it seen (0.4g) | Owner's decision ("budget changes can be flagged"). Same stance as 0.4d: tag, don't block |
| 2026-09-26 | Security findings go to `docs/private/`, never these docs | CLAUDE.md Phase 19 rule; one finding raised to the owner in chat |

---

## Entries

### 2026-09-27: 0.4i — terminals and audio (bug 35)

- `tests/e2e/audio-rest.test.ts` (4): the 5 untested audio routes.
  **Bug 35:** none of them checked their input; a non-number window made
  the buffer unbounded, a text length concatenated, and a start with no
  size kept the last one's. Validated in the service (so REST, MCP and
  the phone's path all get it), with matching bounds in the MCP schemas;
  the phone's estimated chunk length is clamped into range so a tiny chunk
  is not dropped.
- `tests/e2e/terminal-surface.test.ts` (5): injected text runs and lands
  in scrollback; history pages backwards and a missing id creates
  nothing; resize (the shell sees 120 columns) and focus; the self-write
  guard; a killed terminal refused everywhere with its scrollback kept.
  No terminal defects.
- The existing audio MCP test (cdev-phase8) asserts behaviour. Domain i's
  behaviour column is complete; the 8 terminal RPC methods stay with 0.4j.

### 2026-09-27: budget flags on the phone (owner's request; bug 34)

The owner asked for the 0.4g budget flagging on mobile.

- **`budget.get` / `budget.acknowledge`** in a new `mobile-budget.ts`,
  shaped like `mobile-approvals.ts`: the plan's ceiling and spend, and the
  agent changes still flagged, in the desktop chip's own words (the
  describer moved to `shared/lib/budget-words.ts`, so there is one copy).
  Marking a change seen needs a pairing confirmed on the desktop, is
  recorded in the person's name, goes in the device audit and tells the
  desktop windows. Capabilities `read` / `write`. Unit-tested
  (`mobile-budget.test.ts`, 5).
- **Budget card** on the phone's plan screen: spend against the ceiling,
  each flagged change with a **Seen** button, and the advisory note.
- **Push** when an agent changes a budget (`pushForBudgetChange`), to a
  phone that is not connected live, ids only, rate-limited like the rest;
  the tap opens the plan. Only when something changed. Unit-tested with
  Expo stubbed (`push-budget.test.ts`).
- **Bug 34**, found in the same screen: the phone read the wrong
  deviation fields and filtered out every pending one (`'pending'` is
  truthy), so it never listed a deviation; a failed resolve was silent.
  Fixed.
- Inventory: `budget` RPC methods map to domain g; an unmapped RPC prefix
  now gets the inventory's "rows with no domain" message instead of a
  crash in the sort.

Mobile typecheck and lint clean (0 errors). The phone UI is not exercised
by any automated test yet; that is 0.4j's harness peer path.

Full harness at `8314ea8`: 521 passed, 0 retries. CI green; merged as #126.

### 2026-09-26: 0.4h — the existing domain-h tests, audited (bug 33)

A read-only audit of the tests for the other 23 domain-h items found
`PUT /api/freeze` untested; `compare_snapshots`, `review_plan` and
`get_pr_draft` never run through MCP; `get_drift_report`, the baseline
routes, `get_plan_history` and `get_team_activity` checked for shape or a
count. `tests/e2e/review-governance-tools.test.ts` (7) checks their
answers; `baseline.test.ts` covers the baseline routes.

**Bug 33:** `PUT /api/freeze` stored what it was sent; `active: "no"`
froze the project and a non-date `until` never expired. Validated now.

**For the owner:** as with budgets before 0.4g, an agent can lift a freeze
or exempt its own plan (`set_freeze`, `exempt_plan_from_freeze`,
`governance · write`). Left as is; asked whether freezes should be flagged
like budget changes.

Domain h's behaviour column is complete. The 6 mobile RPC methods in
domain h stay with 0.4j.

Full harness at `a2b92385`: 519 passed, 1 skipped, 1 flaky, now fixed.
The flaky one was `plan-tools` "after a rename, write-through keeps
writing", root-caused: it waited for plan.yaml's new title, which the
previous test's export had already written, then read the items before
the debounced write-through (200 ms) of its `add_item` had run. Before
bug 31 an item change scheduled no write, and the test passed only on
update_plan's debounce. It now waits for the item. 3 of 3 clean.

### 2026-09-26: 0.4h — the drift and review tools (bugs 30, 31, 32)

`tests/e2e/drift-review-tools.test.ts` covers the 9 untested tools:
deviations (get, reconcile), proposed changes (list, summary, one),
`capture_checkpoint` and `list_comparands`, `resolve_conflict` by side,
and `search_plan_history`.

- **Bug 30, reconcile.** Resolved deviations by bare id, across plans;
  counted unknown ids as resolved; REST stored any action; credited the
  plan change to "codetrellis". Now `reconcileDeviations` checks every id
  and action against the plan first and records the resolver (new
  `resolved_by` / `resolved_by_type` columns; the reconciler adds them).
  The phone's `deviation.resolve` goes through it too. Plan checks on
  `get_deviations`, `detect_deviations` (no more `process.cwd()`
  fallback) and `capture_checkpoint`; `get_change_status` not-found is an
  error.
- **Bug 31, write-through.** Item and criterion changes never scheduled
  the write to `.codetrellis/plans/`. Found because the history test's
  item never reached disk; the 0.4c-1 rename test had passed on the rename
  debounce firing after its `add_item`. Every item mutation now schedules
  it. 36 plan, cdev, manifest, worktree and item specs (175 tests) pass.
- **Bug 32, history search.** The record separator ended each record, so
  file lists fell into the next one: no `matchedFiles`, and only the
  first match survived. The separator now starts each record.

Each fix's test fails without it. Untested MCP tools: 4 (mobile_* and
read_system_doc, later steps).

### 2026-09-26: 0.4h — what the baseline is, and says it is (bug 29)

Logged in 0.4b for decision here. The baseline is what the graph's diff
compares against, and it was wrong three ways:
- every scan re-pinned it to the working tree, so a rescan emptied the
  diff, labelled with the HEAD hash even over uncommitted work;
- "Pin current HEAD" pinned the working tree, not HEAD;
- `set_baseline` only broadcast: the window changed its label and the diff
  kept comparing against the old snapshot.

Decided (reversible; told the owner):
- A baseline records its source (`scan` / `commit` / `working-tree`), when
  it was taken, and whether the tree was dirty. The label is the backend's
  own: `abc1234`, or `abc1234 + uncommitted changes`, never a bare hash
  for a tree that was not that commit.
- A rescan of the same project keeps the baseline. Opening another
  project, or a capture, sets a new one.
- Pinning with no commit named pins HEAD's contents (via git), so
  uncommitted work shows against it. A non-git project pins its tree.
- `set_baseline` pins on the backend (`pinBaseline`, shared with the
  capture route) and the window reads the baseline back; null clears it.
  Only an agent's pin switches the window from auto-track to pinned.
- A commit to capture is checked with `isSafeGitRef` before git sees it.

`tests/e2e/baseline.test.ts` (6) fails on the old code at the first test.
The 13 harness specs and 7 browser specs that touch the baseline, diff,
compare or review pass unchanged.

### 2026-09-26: 0.4g — agents and MCP (bugs 27, 28)

`tests/e2e/agent-ui-tools.test.ts` covers the 2 untested routes and the 20
untested tools in domain g: every UI tool's broadcast, the budget tools,
logs, the app guide, the doc-check sensor, and the capture and settings
tools once granted. `e2e/agent/mcp-ui-tools.spec.ts` (serial) checks the
window follows them: the plan opens, the item is selected and
back/forward step through the selection, the activity and history drawers
and the settings and guide dialogs open. The Activity toggle got
`aria-pressed` and the selected tree row `aria-current` so a test (and a
screen reader) can tell.

**Bug 27, uids taken on trust.** Five UI tools, the three budget tools and
`POST /api/sessions/:id/assign-plan` never checked the plan, item, file or
session existed. A wrong uid was reported to the agent as shown while the
window said "Could not load plan"; `set_budget` stored a ceiling for no
plan. All refuse now, and nothing reaches the window.

**Bug 28, the log file.** Naming the log path rotated the logger, so in a
web or dev build it created an empty file and opened a write stream
nothing used, and `get_logs` said "(no log entries found)". Now the path
is only named, and `get_logs` says file logging is the desktop app's. A
unit test (`logger-path.test.ts`) fails without the fix.

`setup_agent_permissions` now reads and writes through the confined-file
helper (Phase 19 rule); a harness test covers it.

Strengthened four shape-only tests (`/api/agent/status`,
`/api/mcp/status`, assign-plan). Untested: 21 REST routes, 13 MCP tools,
all in later steps. Domain g's behaviour column is complete.

Housekeeping: a scratch probe (`.probe.mjs`) from the bug-26 investigation
was committed by mistake in #123; removed here. It was outside `src/`, so
neither lint nor any test saw it. Commits now stage named paths, not
`git add -A`.

**Budget changes are flagged (owner's decision).** I raised that an agent
can raise, clear or exempt the ceiling it is asked to respect. The owner:
"budget changes can be flagged". So every change is recorded in
`plan_budget_changes` (actor, actor type, channel, before, after); a
change an agent made is flagged until a person marks it seen. The chip
shows a flag, its popover says what changed in words ("codex (agent)
raised the time ceiling 2h → 4h") with a Seen button, and `get_budget` /
`check_budget` report `flagged_changes` so other agents see it too. A
person's change (desktop, or local-api over HTTP) is recorded and not
flagged; a change to the same values is not recorded. The chip also
refreshes on `plan-budget-changed` now; it loaded once on mount, so an
agent's change never showed until the plan was reopened. New routes:
`GET /api/plans/:uid/budget/changes`, `POST …/changes/:id/acknowledge`,
both tested; `GET` and `PUT /budget` now 404 an unknown plan.

Full harness at `36b3ff7`: 499/1/0, and at `3808be1` (with flagging):
500 passed, 1 skipped, 0 retries. CI green; merged as #124.

### 2026-09-26: 0.4f — presence waits and the watcher flake (bugs 25, 26)

`tests/e2e/presence-channels.test.ts` covers the four untested routes
(thread, status, presence ack and reply) and four untested tools
(await_ack, await_user_input, dismiss_presence, dismiss_channel_event),
plus present and the channel read tools.

**Bug 25, presence waits.** `await_user_input` stored its waiting nonce
in one global; a second agent's question overwrote it and the first agent
waited out its timeout (up to 5 min), told nothing. `dismiss_presence`
left every `await_ack` waiting; `await_ack` on an unknown card waited the
full timeout. Fixed as the owner's rule for agents implies: tell the
agent. A replaced wait returns `{text: null, superseded: true}` at once,
dismiss releases waiters with `via: "dismissed"`, an unknown card is an
error. A reply that answered someone is no longer also queued. That part
is defensive: its test passes on the old code too, because a later
question already skipped older replies. The other three bug-25 tests fail
without the fix. An unknown channel event's status change is now 404.

**Bug 26, the cdev-channels flake.** 0.4a saw `cdev-channels` step 6
("external channel event imported by watcher") time out once, never
reproduced. The watcher's own comment names a chokidar v4 behaviour with
new folders, so I probed chokidar alone with the app's options: a file
written into a folder immediately after the folder is created was missed
11 times in 60; with a 5 ms or longer gap, never, even under CPU load. The
product case is a pull that brings a teammate's first channel events on a
shared plan as a new `channels/` folder with its files. The harness test
does exactly that (8 plans × 3 files) and lost an event in 2 of 3 unfixed
runs. Fix: when a folder appears in the plans tree, the watcher looks in
it 500 ms later and hands over what it was not told about (one plan import
per plan folder, which reads the channel files too). 6 of 6 with the fix.
Whether this is what the 0.4a flake was is not proven. That step writes
into a `channels/` folder the app created moments earlier, so it is the
same mechanism only if the machine was loaded enough to delay the attach.

Untested: 23 REST routes, 33 MCP tools. The 7 mobile RPC methods in
domain f stay with 0.4j.

Full harness at `8d62634`: 489 passed, 1 skipped, 0 retries. CI green;
merged as #123.

### 2026-09-26: 0.4e — an agent could cite a CSV cell it could not read (bug 24)

Writing `tests/e2e/brief-surface.test.ts` (the five artefact routes and
get_brief / list_materials / read_material against the real server):
`read_material` with `{"range": "A2:B3"}` on a CSV was refused, "read by
{lines}, {text}". But `check_criterion` accepts that locator on a CSV,
the viewer opens a CSV at the cited cell, and the tool's description says
the locator you read with is the one you cite. So an agent could only
cite a CSV cell by guessing it.

The check also counted columns by splitting each line on commas, so
`"APAC, East"` made a third column: `C3` passed in a two-column file.

Fix: the viewer's RFC 4180 parser moved to `shared/lib/csv.ts`, and all
three use it. `read_material` reads a CSV by `{range}` (format csv,
"cells A2:B3"); without one a CSV still reads as numbered lines. Tests:
`read.test.ts` (range, quoted comma, outside, lines), a new
`criterion-checks.test.ts` (fails 2 of 3 without the fix), and the
harness spec.

Also covered in this step, no defects: recording refuses a bad role, an
unshowable type, a missing file, a path outside, a link and an unknown
item; the bytes route sends nosniff / no-store / a sandbox CSP and serves
ranges (206, 416); the rendition route says 415 for a type it does not
convert and 503 with `fallback: true` when the build has no engine;
`get_brief` gives the item's own files plus the pages' materials (not the
pages' outputs). Untested REST routes: 27. `artefact.preview` (mobile)
stays with 0.4j; the three domain-e components get their UX pass in 0.5.

Full harness at `95b28c4`: 480 passed, 1 skipped, 0 retries. CI green;
merged as #122.

### 2026-09-26: 0.4d — decisions and criteria say who made them

Owner's decision: agents are co-workers, so an agent adding a criterion
as it works is fine, as long as everything is tagged with who did it.

**The problem.** Every REST decision was issued as a person's
(`issueHumanDecision('desktop', …)`), whatever sent it. The token proves
a caller may use the API, not that a person is there: any script that
reads the token file could approve a criterion "as the person". And the
Brief said "approved by Claude" for every agent, whichever one it was.

**What changed.**
- `ipc-dispatcher` marks the requests it builds for the app window
  (`dispatchAuthorised`) in a WeakSet; `cameFromAppWindow(req)` reads it.
  Nothing a caller sends can set it: no header or property is involved.
- `server.ts` `decisionFrom(req)`: app window → `HumanDecision`
  (`desktop`); anything else over HTTP → `UnverifiedDecision`
  (`local-api`). The phone stays `phone`, from the DTLS identity.
- `criteria-service` accepts either, and records `actor_type` as
  `human` or `unverified`. **Unverified decisions count.** The web build
  and the harness both use HTTP, so refusing them would break the web
  build, and they are no weaker than before. What changes is that they are
  labelled: on the item card ("(local API, unverified)"), in the Brief, in
  the PR table note, and in their own section of the sign-off pack.
  (Earlier in chat I said they would not count. That changed while I was
  building it, for the reason above; raised with the owner.)
- The Brief names the agent ("approved by codex-cli (agent)"), not
  "Claude".
- Criteria show who added them: "added by <agent> (agent)", or "through
  the local API", "from a template", "from the plan file". Nothing is
  shown for a person's lines or for the system's.

**Tests.** `ipc-dispatcher.test.ts` (new unit test: the mark, and that
nothing in a request forges it); `human-decision.test.ts` (static: only
`server.ts` issues unverified decisions; only the authorised dispatch
marks); `signoff-pack.test.ts` (the unverified section, the summary line,
the PR note); `criterion-origin.test.ts`; `brief-vocabulary.test.ts`;
`criteria.spec.ts` (browser: agent tag, then unverified decision);
`criteria-signoff` / `criteria-loops` updated to assert `unverified` /
`local-api` over HTTP.

The 5 untested domain-d routes (check, worklist, pack JSON, pack page,
verify) are covered by the new `tests/e2e/signoff-surface.test.ts`, and
the untested list is down to 32 REST routes. The matrix behaviour column
is filled for all 9 routes and 7 tools in domain d. The 3 mobile RPC
methods in domain d stay with 0.4j.

Full harness at `c56646b`: 471 passed, 1 skipped, 0 retries. CI green;
merged as #121.

### 2026-09-26: 0.4c-2 — items could be moved out of the tree (bug 23)
- **`tests/e2e/item-surface.test.ts` (8):** versions, events and restore;
  move; comments (REST and MCP, threaded); attachments; external refs;
  plan summary; suggest_specs.
- **Bug 23:** no parent validation anywhere. Moving an item under its own
  sub-item returned 200 and both disappeared from the tree; so did
  self-parenting, a parent in another plan, or a missing parent. Fixed
  with `assertValidParent` in the item service (create, update, move):
  REST 400 through the global error handler (and the create route's own
  catch), MCP an error result, the phone an RPC error. The test fails
  without the fix (200 where 400 is expected). Plan import is unaffected:
  it creates parents before children from the directory tree.
- The item artefact routes move to domain e (Brief materials).
- `untested.json`: 8 tools and 8 routes removed (now 37 routes, 37 tools,
  47 RPC).

### 2026-09-26: 0.4c-2 — the V1 task API is retired
- **Removed:** 14 REST routes (`/api/plans/:uid/tasks*`, `/api/tasks/*`),
  and from `plan-store` the 24 functions and 5 state fields nothing read
  (V1 task context, comments, attachments, progress, subtasks, phases,
  spec docs), about 410 lines. `setActivePlan` no longer fetches docs and
  phases into fields no component reads.
- **Kept, because live code uses them:** `GET /api/plans/:uid/next-task`
  (serves V2 Actions) and `DELETE /api/attachments/:uid` (the V2 item
  store). The plan docs and phases routes stay too: they have no UI
  caller, but they feed plan export and have their own tests, and were
  not part of the decision. Raise at 0.7.
- **Tests:** `full-loop` now drives V2 throughout (claim via
  `/api/items/:uid/claim`, status via `PUT /api/items/:uid`), which also
  covers the claim route. `e2e/tasks-legacy/` is deleted with the API it
  tested (removed feature, not a skipped test).
- `untested.json`: 13 V1 routes gone, and the claim route is now tested
  (45 routes, 45 tools, 47 RPC).

### 2026-09-26: 0.4c-3 — plan deletion is a person's decision
- **Removed from MCP:** `delete_plan`, `bulk_delete_plans` (and their
  capability rows, guide entries and timeline phrasing).
- **Added:** `request_plan_deletion(plan_uids, reason)`. It refuses
  unknown, archived and unopened-project plans, broadcasts
  `ui-confirm-plan-deletion`, and deletes nothing.
- **In the app:** `PlanDeletionRequest` shows the plans, the agent's
  reason and what deletion does; Delete stays disabled until the person
  types the plan's name (or "delete N plans"). "Keep it" leaves
  everything as it was. The person's own delete buttons (Plans panel,
  phone) are unchanged.
- **Tests:** `plan-tools` (the tools are gone; the request asks and
  deletes nothing; the three refusals; deleting a renamed plan through
  the app's path still removes its directory) and browser
  `e2e/plan/plan-deletion-request.spec.ts` (disabled until typed, wrong
  text stays disabled, correct text deletes, "Keep it" keeps). Serial,
  because the request reaches every open page.

### 2026-09-26: browser suite — how to run a targeted check fairly
- A targeted run (`npx playwright test e2e/plan e2e/inspector`) makes the
  `serial` project depend only on `setup`, so it runs ALONGSIDE the
  parallel specs (playwright.config `TARGETED`). Serial specs then share
  the one backend project and the windows `ui_ready` asks: `brief-mode`
  read another spec's page, and a spec that opens the sample app swaps
  the project under the parallel ones. The base branch shows the same
  class of failure (2 of 153, different specs).
- **Run them apart:** `--project=setup --project=chromium <dirs>`, then
  `--project=setup --project=serial <dirs>`. On this branch: 152/152 and
  5/5.
- **Mine, fixed:** `e2e/inspector/add-to-plan.spec.ts` opens the sample
  app, so it is in `SERIAL_SPECS`.
- **Helper fixed:** `gotoWithProject` now waits out "scan already in
  progress" (200 with `astError`) the way `openProject` does, instead of
  timing out on `.react-flow` whenever workers overlapped.

### 2026-09-26: 0.4c-1 — plan REST routes
- **`tests/e2e/plan-rest.test.ts` (9):** discover, reconcile and prune
  (the Plans panel's disk hygiene), bulk delete, apply-template,
  import-external from an issue checklist, doc search, projection and a
  single proposed change, and plan history through real git commits.
- **prune-orphans now takes the project** (`?project=`, confined like
  every root) and removes only directories that are that project's
  orphans at the moment of the call, re-checked just before removal;
  anything else is skipped and reported. The Plans panel passes the
  project. `discoverPlanDirs` uses lstat, so a link in the plans dir is
  not a plan directory. (Rationale is with the owner, per CLAUDE.md.)
- 11 routes leave `untested.json` (now 58 routes, 45 tools, 47 RPC).

### 2026-09-26: 0.4c-1 — renaming a plan disconnected it from the repo (bug 22)
- **`tests/e2e/plan-tools.test.ts` (10):** the ten plan tools with no
  test: update, delete, bulk delete, copy as prompt, list / create-from /
  publish templates, discover, unlink, home repo.
- **Bug 22:** the plan directory is `<title-slug>-<uid prefix>`, looked
  up by the current title. After a rename, write-through silently
  stopped for good, channel events went to a new directory with no
  plan.yaml, and unlink / delete left the real directory behind (to be
  re-imported on the next pull). Found by the probe:
  `unlink_plan_from_files` said `removed: false` for a directory
  `discover_plan_files` had just listed. Fixed by finding the linked
  directory by uid prefix, confirmed by the uid in plan.yaml (through the
  confined helper; dirents don't follow symlinks). The directory keeps
  its name; titles live in plan.yaml, so no churn in the repo. The
  write-through, unlink and delete tests fail without the fix.
- **Raised with the owner, not in these docs:** a concern about the
  reach of the plan-deletion tools (Phase 19 class; handled per the
  CLAUDE.md rule).
- 10 tools leave `untested.json`.

### 2026-09-26: 0.4c-1 — "Add to plan" wrote into V1 (bug 21)
- **Which V1 task routes are still called?** The plan store's V1 task,
  phase and doc functions (`fetchTaskContext`, `addTaskComment`,
  `createPlanPhase`, `createPlanDoc` and 20 more) are referenced by
  nothing outside the store. One live caller remained: the inspector's
  "Add to plan" popover (`AddToTaskPopover`, reached by selecting lines
  in the code view).
- **Bug 21:** on a V2 plan the popover listed no tasks (V1 can't see V2
  items), and what it created was a V1 task the workspace never shows.
  Ported to V2 Actions. The new `POST /api/items/:uid/code-reference`
  merges the line range into the Action's fileSpecs on the backend
  (a renderer read-modify-write could race an agent), and the reference
  shows in the code overlay.
- **Tests:** `tests/e2e/code-reference.test.ts` (4: first and second
  reference, overlay, refusals); browser
  `e2e/inspector/add-to-plan.spec.ts` drives select lines → existing
  Action and → new Action, and fails on the old popover. `data-line` on
  code rows gives it a stable selector.
- **Proposed to the owner, not done:** with the popover ported, nothing
  live calls the V1 task REST routes (`/api/tasks/*`,
  `/api/plans/:uid/tasks*`) or the dead plan-store functions. Retiring
  them is the honest fix for their untested entries; writing tests for
  dead surface is not.

### 2026-09-26: 0.4b full harness — clean
- 430 passed, 1 skipped (environment), 0 retries, 18.5 min, with nothing
  else running. `cdev-channels` passed first time, consistent with the
  0.4a flake being load from the parallel unit/lint run. It stays open
  for 0.4f until the watcher path is understood.

### 2026-09-26: 0.4b — matrix filled; shape-only tests replaced
- `baselines`: the trellis snapshot records its branch, and its diff is
  empty at capture, then reports a file and edge added afterwards (live,
  no rescan); unknown id 404. Was `toBeTruthy()`.
- `misc-endpoints`: `/api/file/content` returns the file's exact content
  (was "non-empty string").
- `untested.json`: 11 tools and 2 routes removed (now 69 routes, 55
  tools, 47 RPC). Behaviour column filled for all 17 routes and 15 tools
  of 0.4b. The 8 graph/changes RPC methods are deferred to 0.4j.
- Checks: typecheck 0; lint 0 errors / 290 warnings (one fewer: an
  `as any` went with the mode fix); unit 995 / 992 / 3 skipped.

### 2026-09-26: 0.4b — the live graph degraded with every edit (bugs 19, 20)
- **Bug 19:** `graph_set_mode('baseline')` sent `baseline`; the renderer's
  mode is `current`. Nothing changed on screen. Found by
  `e2e/graph/mcp-view-tools.spec.ts`, which drives the view tools over
  MCP against a real page (it fails without the fix).
- **`aria-pressed`** on the mode, layout and depth toggles: their state
  was colour only. That also gives the spec a stable assertion.
- **Bug 20, the big one:** the file watcher stored a re-parsed file's
  imports unresolved and never resolved them, and `unlink` only
  broadcast. Between scans a new file had no edges, an edited file LOST
  its outgoing edges, and a deleted file stayed. Fixed:
  `resolvePendingImports` (unresolved rows only, with the scan's alias map
  and systems) after each re-parse, and `removeStaleFiles` on unlink.
  Measured about 3 ms per save on this repo (856 files, 1,718 unresolved
  rows).
- **`tests/e2e/graph-rest.test.ts` (6):** the architecture summary and
  systems by content; `/api/diff` empty after a scan, then reporting an
  added file, its edge, a modified file, the blast radius and git
  untracked; an edit keeping its edges (through a workspace alias); a
  delete leaving the graph. No rescan in the file, on purpose.
- **`e2e/mcp-tools/graph-tools.spec.ts`** was answering about the wrong
  project (the backend holds one graph; setup scans the fixture last)
  while asserting `toBeTruthy()`. It now opens the fixture, runs serially
  and checks the answers.
- **For 0.4h (baseline):** every scan re-pins the baseline to the
  working tree at scan time, labelled with the HEAD hash. So a rescan
  empties the diff, and "baseline: HEAD" includes uncommitted work.
  Known (review_plan works around it), but the label is misleading.
  Decide the semantics in 0.4h.

### 2026-09-26: 0.4b — graph queries that answered wrongly (bugs 17, 18)
- **`tests/e2e/graph-tools.test.ts` (22):** the 15 graph MCP tools with
  no harness test, plus `/api/dependencies/file` (no test at all). The
  view tools' broadcasts are asserted with `openEventStream`; for
  `graph_snapshot`, `graph_export` and `ui_ready` the harness answers as
  the renderer through `/api/screenshot-response`.
- **Bug 17:** `get_dependencies` with a project-relative path returned
  empty lists ("no dependencies"); `check_conformity` with absolute paths
  reported everything conformant. The only earlier test (`e2e/mcp-tools`)
  asserted `toBeTruthy()`. Both now accept either form.
- **Bug 18:** `graph_snapshot` defaulted to full metadata despite
  promising a compact default.
- 3 of 22 failed before the fixes, each one a bug above.

### 2026-09-26: 0.4a full harness — one flaky, not reproduced
- **Result on `2ec3da5`:** 400 passed, 1 skipped (environment), 1 flaky.
- **The flaky one:** `cdev-channels` step 6, "external channel event
  imported by watcher", timed out at 10 s on the first attempt and
  passed on retry. It ran at test 24/402, when I had started the unit
  suite, lint and inventory alongside.
- **Not ours by code path:** the chokidar channel import in
  `plan-file-service.ts`; nothing in 0.4a touches it. The later
  "committed" step, which uses the changed commit path, passed.
- **Not reproduced:** 8 runs with 4 CPU burners and 10 runs with the
  unit suite looping alongside all passed (one worker, as the harness
  config). An earlier "repro" with `--workers=2` was my artefact: two
  copies sharing one fixture dir.
- **Open item for 0.4f** (channels owns this path). Candidate: chokidar
  attaching to a just-created `<slug>/channels/` asynchronously, so a
  file written in that window is missed. The watcher does await
  `ready`, so it is not the plan-export race #73 fixed.

### 2026-09-26: 0.4a — project lifecycle verified; two more fixes
- **`rescan_project` with no path scanned `process.cwd()`** — the
  backend's working directory, `/` in a packaged app — instead of the
  open project its description promises. The project-scope check, keyed
  on `project_path`, never saw it. Now it uses the active project and
  refuses when none is open. The regression test fails on the old code
  (it scanned the whole codetrellis repo).
- **`pin_project` / `unpin_project` / `remove_recent_project`** reported
  success for a path with no recent-projects row (reachable with scope
  "anywhere"). They now say "not in recents".
- **New harness helper `openEventStream`** records `/ws` broadcasts, so
  tools whose only UI effect is a broadcast (`close_project`,
  `open_project`'s tab switch, alias and origin changes) are asserted,
  not assumed. Every later 0.4 step can use it.
- **New tests:** `project-lifecycle` (11, MCP), `project-open` (6, REST:
  identity seeding on first scan had no test anywhere; pin order;
  removing a deleted project; onboarding state; rescan add/delete),
  `worktree-project` +1 (`/api/git/worktrees`), browser
  `e2e/git/worktree-checkout.spec.ts`. Shape-only assertions on pin,
  delete and onboarding-state now check behaviour.
- **Inventory:** the lifecycle tools move to domain a (they were 0.4g by
  file). 8 leave `untested.json` (now 71 routes, 66 tools, 47 RPC).
  Behaviour column filled for all 19 routes and 12 tools of 0.4a.
- **Decision:** the 10 `project.*` / `fs.browse` / `diagnostics.flush`
  RPC methods move to 0.4j. There is no harness path to the peer RPC
  surface, and building one is 0.4j's job.
- **Browser suite:** `e2e/project`, `e2e/onboarding`, `e2e/git` — 55/55
  pass here, plus the new worktree spec.
- **For 0.5 (UX):** at 1280×720 the canvas toolbar rows overlap the
  cluster card and hide its title; a worktree in the branch popover
  reads only "main", which is ambiguous next to the branch of that name.
- Checks: typecheck 0; lint 0 errors / 291 warnings; unit 992 / 989
  pass / 3 skipped.

### 2026-09-26: 0.4a — a linked worktree was a second-class project (bug 16)
- **Found by reading the routes, confirmed by a failing test.** Six
  places read `<root>/.git/HEAD`, `.git/MERGE_HEAD`, `.git/refs/heads`
  or wrote a temp file into `.git/` by path. In a linked worktree `.git`
  is a file, so from any worktree:
  - `/api/git/branch` and the recent-projects entry said no branch;
  - `/api/git/info` said "no commits", no branches, no other checkouts;
  - `.codetrellis` merge conflicts were never detected;
  - `commit_manifest_changes` failed with ENOTDIR.

  Branch listing also missed packed refs (any clone, any `git gc`).
- **Fix:** `services/git-checkout.ts` reads git's on-disk layout
  properly (the `.git` file's `gitdir:`, `commondir`, HEAD, loose and
  packed refs) and every site uses it. The commit message goes in on
  stdin instead of a temp file.
- **Decision: file reads, not `git`.** First draft ran `git rev-parse` /
  `symbolic-ref`. Changed because `/api/auto-detect` asks about
  directories named in Claude Code's session files (not opened
  projects), and git refuses repos owned by another user
  (`safe.directory`), which would blank the branch chip where the old
  read worked.
- **Tests:** `tests/e2e/worktree-project.test.ts` (6, all from inside a
  linked worktree; all 6 failed before the fix) and
  `git-checkout.test.ts` (13 unit). `git-integration` still green.

### 2026-09-26: Stacking failed under squash merges; consolidated into #115
- A local simulation of squash-merging #113 → #114 → #115 still
  conflicted at #114. A squash merge drops the branch's history, so the
  stacked branch re-applies 0.3b's doc edits against the squashed copy.
- **Fix:** #115 already contains 0.3b, 0.6a and 0.3, and merges cleanly
  alone, so it becomes the single PR. #113 and #114 are closed as
  superseded (re-openable).
- **New rule** (EXECUTION §1.3, Decisions): one step PR open at a time;
  each step branches from `feat/phase-32` after the previous merge.

### 2026-09-26: PRs stacked to remove merge conflicts
- #113, #114 and #115 each merged cleanly into `feat/phase-32` alone,
  but they all edit the Phase 32 docs, so merging one made the others
  conflict.
- **Now stacked:** 0.6a contains 0.3b, and 0.3 contains both. Merge
  #113 → #114 → #115 in that order and none conflicts. The overlaps are
  resolved once per branch: bug tables 12–15 in order, and every log
  entry kept.
- **The coverage guard's first real use:** stacking brought 0.3b's tests
  into 0.3, and the guard named the four routes they now cover (items
  full / blocked / progress, plans reconcile). All deleted from
  `untested.json`, which now lists 71 routes, 74 tools and 47 RPC
  methods.
- On the stacked 0.3 branch: typecheck 0 errors; lint 0 errors / 291
  warnings; unit 979 tests / 976 pass / 3 skipped.

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

### 2026-09-26: #112 merged; feat/phase-32 merged into 0.3b
- Resolved the Phase 32 doc overlaps (bug tables 12–14 kept in order;
  both branches' log entries kept) and filled EXECUTION §0.3b's outcome
  column.
- **Regenerated matrix:** REST routes with no test went from 63 to 71.
  This isn't a regression. The inventory counted mentions inside
  *skipped* test files as coverage, so 8 V1 `/api/tasks/*` routes looked
  tested while only a skipped file named them. With the V1 files
  rewritten, the true number shows. V2 `/api/items/*` routes gained real
  coverage.
- **Blind spot for 0.3:** the coverage guards must not count skipped
  tests.
- Unit on the merged branch: 974 tests, 971 pass, 3 skipped.

### 2026-09-26: 0.3b complete — harness 377 passed / 1 skipped / 0 failed
- **full-loop (4):** deviation detection reads V2 Actions, so the same
  work is now also seeded as Actions (`add_item` with `file_specs`) and
  marked done via `update_item`. 4 unskipped plus a seeding step; 21/21
  over 3 repeats. `next-task` now offers the V2 Action.
- **plan-export chokidar (1):** a stale skip. #55 skipped it, and #73
  fixed the race three days later (`scanProject` awaits the watcher's
  `ready`). 10/10 alone and 10/10 with all cores saturated. Unskipped.
- **agent-loop (2):** rewritten onto V2. The auto-progress scenario
  exposed **bug 13**: `plan-progress-service` only advanced V1 tasks,
  so V2 Actions never lit up on a file edit. Fixed. The test times out
  without the fix and passes with it.
- **multi-agent (2):** rewritten onto `claim_item`; 6/6 over 3 repeats.
- **task-context (7):** its header claimed V2 coverage in
  `plan-items.test.ts`. Checked each scenario: 3 were covered, 4 were not
  (**bug 14**). The file now tests those four:
  - the full `claim_item` context
  - child context, url attachment and file-spec update
  - export → import through `items/`
  - REST ↔ MCP parity and validation

  12/12 over 3 repeats. The import comes from the project's plans dir,
  because imports are confined to opened projects (Phase 19).
- Scripted-agent's V1 helpers, which called tools that no longer exist,
  are replaced by `claimItem`, `updateItemStatus` and `getNextItem`.
- Remaining harness skips are environment-conditional only:
  build-artifacts, and the terminals tests' `ptyAvailable` guard.
- On this branch (which predates 0.2): typecheck 0 errors, lint 0 errors
  / 291 warnings, unit 962 tests / 959 pass / 3 skipped.

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
