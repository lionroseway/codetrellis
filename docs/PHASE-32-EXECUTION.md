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

Now and the checklist are **generated**, and only the intent is written.
`docs/PHASE-32-STATUS.yaml` holds the steps (id, title, order, parts),
follow-ups, the next action and blockers. A step's state is read, not
kept: `npm run status` reads git and GitHub (`tools/status/git-facts.ts`)
and writes both into the log between its status markers.

- **done**: a first-parent squash commit on `feat/phase-32` titled
  `Phase 32 <id>: … (#N)`. The title is the record, so name every step's
  merge that way.
- **in review**: an open PR from the step's branch.
- **building**: the step's branch `feat/phase-32-<id>-<slug>` exists with
  no PR yet (offline: only the branch checked out).
- Only what git cannot see may be written (`status: done`, `prs`): Stage
  0, whose merges came in through `main`, and follow-ups with no branch.

The block is a snapshot labelled with the commit it was read at.
`tools/status/status.test.ts` fails when the log's items differ from the
YAML (it needs no history, so CI's shallow checkout runs it), and
`npm run status:check` says, with history, whether the snapshot is
behind. (The owner's ask and then his point, 2026-09-30: status a program
can read, and the state of a step with a branch is a fact to read, not a
line to keep. The end state is C2: the plan lives in CodeTrellis, and
status is what the app itself reads from git, for any host: C2.6.) The rest of the log stays
prose:
- **Baseline:** the test and tool numbers the work is measured against.
- **Decisions:** what was decided, why, and when.
- **Entries:** a dated, newest-first record of what happened.

### 1.2 When to update it

Update the log **before** it's needed, not after:

1. At the **start** of a step: set Now's step and next action in the
   YAML, cut the step's branch, and run `npm run status` (it reads the
   branch as `building`).
2. After **every decision**, or anything surprising.
3. **Before** any command that takes more than a few minutes (harness,
   package, big refactor), with what's running and why.
4. At least every **30 minutes** of work, even if it's only "still on X,
   next is Y".
5. At the **end** of a step: open its PR (git and GitHub then say
   `in review`, and `done` once the squash merge lands), record test
   counts in an entry, set Now to the next step, and run `npm run status`.

If a session could end right now, the log must be enough for the next
one to continue without asking.

### 1.3 Branches and PRs

- **Integration branch:** `feat/phase-32`, cut from `main`. It merges
  into `main` once, when the phase is done.
- **One step = one branch = one PR** into `feat/phase-32`, named
  `feat/phase-32-<step>-<slug>` (for example
  `feat/phase-32-a0-parallel-bugs`).
- **CI runs on PRs into `feat/phase-*`** (`ci.yml`, `security.yml`).
- **One step PR open at a time.** PRs are squash-merged, and every step
  edits the Phase 32 docs (at least the log's Now block). So two open
  step PRs always conflict, and stacking one branch on another doesn't
  help, because a squash merge drops the branch's history. Start the
  next step's branch from `feat/phase-32` **after** the previous PR
  merges. Work done ahead goes onto that fresh branch by cherry-picking
  its own commits. (Learned on #113–#115, 2026-09-26.)
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
0.1 → 0.2 → 0.3 → 0.4 (domains) → 0.5 → 0.6 → 0.7 review → 0.8 release
  → A0 → A1 → A2 → A3 → B1 → B2 → C1 → B4 → C5 → B3 → A8 → A2.7 → review
  → HD1 → HD2 → B5 → A4 → A5 → B6 → B7 → A6 → C2.1 → HD3 → C2.2–C2.6 → C3 → B8 → B9 → C4 → A7 → B10 → review
  → phase-end: main merged in, full suite, packaged build, merge to main
```

A2 and A3 ran ahead of B1 (see the log's decisions). C5, B3's line
changes and A8 come from the owner's asks of 2026-09-28: one plan worked
in several worktrees, line-level changes per workstream, and CodeTrellis
staying agent-agnostic rather than tuned to Claude Code.
Within B4, B4.3b comes first and B4.4 (the phone) moves after A8.
Wave 2 opens with two hardening steps (the Wave 1 direction review and
the owner's answer, 2026-09-29): **HD1** ends the extra graph nodes left by
another project's scan (the server answering for whichever project was
scanned last), and **HD2** moves the browser specs that click graph nodes
onto the committed sample app (`tests/fixtures/sample-app`), so a PR that
adds files to this repository no longer moves the graph they click. The
phone (A4, and a way to render its screens) stays after B5.

Work that is not code gets the same footing from 2026-09-30 (the owner's
questions after A6, log entry "Business work in the plan"). A6 made a task
a workstream and its materials a footprint; four places still saw only
code, and each is fixed where it already lives, on telemetry the app
already records:

- **HD3**, straight after C2.1: a clash between two plans' tasks over a
  shared spreadsheet or document is an overlap in the Stack tab, live and
  at a past moment, as a clash over code already is; and a task at a past
  moment says which version of each material it had read.
- **C2.4**: status is read, not written. No STATUS.md: intent stays in
  the plan's YAML, state is derived (git for a task on a branch, the plan
  for everything else), and each state says its source.
- **B9**: play-forward projects the materials tasks say they rely on as
  well as the code they plan to change.
- **C3**: the shared plans folder can be carried by git or by a
  cloud-synced folder (OneDrive, SharePoint, Google Drive, Dropbox), laid
  out so a sync can never clash: every file has one writer and is only
  ever added, records are signed, and a real disagreement is a signal.

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
| 0.4f | Channels and presence | post, thread, resolve, routing rules, webhooks, presence pane, awaits; the watcher-import flake seen once in 0.4a (log 2026-09-26) |
| 0.4g | Agents and MCP | connector, sessions, identity, capabilities, project scope, timeline turns, stuck sensor |
| 0.4h | Drift, governance, review | deviations, freeze, baseline (incl. every scan re-pinning it to the working tree under the HEAD label, log 2026-09-26), review_plan, PR draft, compare snapshots |
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
| 9 scan baseline lost on restart | 0.6 (fixed) |
| 10 spec body edits leave no event | B1 (event log) |
| 11 cross-plan dependencies never resolve | B6.1 (fixed) |
| 12 CI lint step disabled on a stale premise | 0.3 (fixed) |
| 13 auto-progress ignored V2 Actions | 0.3b (fixed) |
| 14 skipped test's coverage claim was false | 0.3b (fixed) |
| 15 guides documented arguments the tools don't take | 0.6a (fixed + guard) |

Anything the sweep (0.4) finds is added to this table and to
CURRENT-STATE.

### 0.7 Stage review

- The matrix is complete. The allowlists and UX issues are counted.
- Bugs 4–9 are fixed.
- A direction review is in the log.

### 0.8 Release

Stage 0 has found and fixed enough across the app that it ships before
Phase 32's features begin (owner's decision, 2026-09-26).

- `feat/phase-32` is merged into `main` at the end of Stage 0. Tracks A,
  B and C then continue on `feat/phase-32` cut again from `main`, with
  the same one-merge-at-the-end rule for the phase proper.
- The release goes out through `scripts/release.sh` (signing and the
  signed manifest need the release machine, so this step needs the owner
  on macOS). Release notes via the `codetrellis-release-notes` skill,
  drawn from the CURRENT-STATE bugs table.
- Mobile ships only if something in it changed; the pairing protocol has
  not.
- **Done when:** the release is published and the packaged app is
  verified to open its database (CLAUDE.md, "A packaged build is the
  only thing that proves this").

---

## 4. Track A: awareness engine

### Carried from the Stage 0 review (0.7)

The review changed the plan in four places. Each is small; they come
first because Track A leans on them.

- **The coverage guard credits calls, not names.** It counted three MCP
  tools as tested because a unit test that phrases tool calls for the
  Timeline mentions their names (bug 49). Credit a test only where it
  calls the route, tool or method (the harness client, `callTool`,
  `rpc`), and keep the phrasing test out of it.
- **No tool writes a fixed author.** Authorship was wrong in the same way
  four times (bugs 43, 47, 49 and the grant escalation): a handler that
  forgot `authorFromExtra`, or wrote a literal. Workstream attribution is
  Track A's core, so add a structural test like `server-confinement`:
  every handler that creates or changes a record takes its author from
  the caller.
- **Identity across checkouts is A1.7's**, with bug 46 as its first case:
  a second checkout takes the first one's system docs, and plans are keyed
  the same way.
- **The harness and browser suites do not run on PRs** (their CI jobs are
  skipped); every step ran them by hand. At 632 harness tests and 28
  minutes in a 4-core container, run them in CI, sharded, before Track A
  adds more.

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

### A2: Meaning (spec M2)

*Done when* (spec §11): changing a function's parameters in one workstream
tells the agent in another workstream that imports it, on that agent's next
tool call, without anyone asking; changing only the body does not.

| Sub-step | Delivers | Tests |
|---|---|---|
| A2.1 | `ParsedSymbol.signature` for TS/JS and Python (parameters, return type, type parameters; a type's or interface's shape), comment- and whitespace-insensitive; a footprint symbol says when its signature changed, before and after; the strip shows it (the tab, once a signal carries one: A2.3) | unit per language: a body edit keeps the signature, a parameter change does not; harness: a worktree's parameter change is reported as a signature change |
| A2.2 | Import accuracy: Python records original names (not aliases), `export … from` is captured with its names, `imports.resolved_path` is indexed | unit per parser; harness: a re-export and an aliased Python import reach the importer lookup |
| A2.3 | `contract` signal (high): a workstream changes an exported symbol's signature and another workstream's changed files import that name (a namespace import is "possibly"). Python's "exported": no leading `_`, or listed in `__all__` | unit `computeSignals`; harness across two worktrees, including a body-only edit that raises nothing |
| A2.4 | `declare_intent(summary, paths?, symbols?)` (capability `write`), held per session until it ends or re-declares; intent joins the footprint, so an overlap is seen before any file changes | unit; harness; capability coverage |
| A2.5 | `drift` signal (medium): a workstream edits outside the scope its claimed item's `fileSpecs` and its declared intent give it | unit; harness |
| A2.6 | Inline notices (§6.2): an unseen high or medium signal for the caller's workstream is appended once to its next tool result, off with `sensors.awareness.inlineNotices`; `acknowledge_signal(id, note?)` records the **agent's** note, per session, beside the person's answer and separate from it (A1.8); the tab shows who was told and what they said. Closes with the M2 "done when" as a harness test | unit; harness end to end; capability coverage |

| A2.7 | Signatures for the other languages with a parser: Go, Rust, Java, C#, Kotlin, Swift, Ruby, PHP, to the same contract as A2.1 (parameters, return type, type parameters; comment- and whitespace-insensitive), so `contract` signals and "signature changed" reach them. A language that cannot be done says "signature: unknown", never "unchanged" | unit per language (body edit keeps it, parameter change does not); harness: a Go and a Kotlin worktree raise `contract` |

The spec lists the collision overlay under M2. It needs the overlay list
in `graph-builder`, which is B3's, so it lands there rather than hard-wiring
a second overlay now.

### A3: distilled (M3)

| Sub-step | Delivers | Tests |
|---|---|---|
| A3.1 | The digest (§4.5): signals grouped by kind and pair into a few lines a person reads at a glance — what changed, who is affected, agents told, waiting on you — with "and N more" past a cap; the same text for agents in `get_awareness`; new since the person last looked | unit (grouping, cap, words); harness (`get_awareness` digest); browser (tab) |
| A3.2 | Intended and cooldown (§4.4): an answered signal (acknowledged, intended) stays quiet until its subject changes shape, then opens again and agents are told again | unit `reconcileSignals`; harness |
| A3.3 | `parallel` guide flavour (§6.3), served as `codetrellis://skill/parallel` and from `get_app_guide`; the `multi-agent` guide points to it | unit (guide content); harness (resource read) |
| A3.4 | A `codetrellis-parallel` Claude Code skill and an optional `PreToolUse` hook that runs `check_footprint`, offered from Settings with the Add to Claude Desktop pattern, never installed silently | unit; harness (install writes only what was confirmed); browser |
| A3.5 | `docs/claude/awareness.md`; M3 "done when" as a test: five workstreams' worth of signals produce a digest readable in under a minute (a line budget), and intended stays quiet until a side changes shape | harness end to end |

### A4: Mobile (M4)

Refined 2026-09-29 (log entry "A4 refined"). The phone's approvals flow is
the template (awareness spec §8): lists and details are pulled over RPC, and
only a count rides in the live snapshot.

| Sub-step | Delivers | Tests |
|---|---|---|
| A4.1 | Reply to the agents about a signal, one path for desktop and phone: `POST /api/awareness/:id/reply {message}` keeps the person's words beside the signal (author from `actorFrom`), and each session placed in one of the signal's workstreams reads it once, on its next tool call, as a clearly marked message from the person (the notice interception, A2.6). Where an agent there holds a task, the reply is also a `steer` on that plan's channel, so it shows where plan messages do. The Awareness tab gains "Message the agents" on each signal, and shows the replies and who has read them | unit (the delivery text, once per session); harness: a reply reaches the scripted agent on its next call, once, and not an agent in another workstream; the steer is on the plan; browser, with a screenshot |
| A4.2 | The phone's signal RPC, as approvals do it (list and detail pulled, a count in the snapshot): `awareness.needsYou` (the digest's lines and the high and medium signals, in the desktop's words, both sides named with `sideLabel`), `awareness.signal` (one signal: both sides, the files, who was told and what they said, the replies), `awareness.answer` (acknowledge or intended) and `awareness.reply` (A4.1's path), both needing a pairing confirmed on the desktop, audited, the author `phonePerson()`. The snapshot's `openSignals` counts live high and medium signals not set aside. A `peer-capabilities` row for each method | unit (the words); harness: list, detail, answer, reply from a paired phone; a read-only phone sees but cannot answer; the count moves |
| A4.3 | Workstreams on the phone: `workstreams.list` (branch, agents, task, signal count) and `workstreams.detail` (its changed files and its recent turns from `agent_events`), the folder never from the request | harness |
| A4.4 | Push for a high signal: when a high signal opens or reopens, a phone that is not watching live is told, with ids only (the words load over the mesh), at most one push per kind per minute, through the existing service; the tap opens that signal. The harness can point pushes at a local receiver | unit (rate, ids only); harness: a contract signal pushes once; an open phone is not pushed |
| A4.5a | A way to see the phone's screens: `tools/phone-preview` renders the real screens from `mobile/` through react-native-web, with native modules stubbed and RPC answered from fixtures; `npm run test:phone` photographs them (`tests/phone/`), a CI job uploads the shots, and the inventory credits each screen a spec renders. The screens that exist are seen first: Home, Activity, Plans, Waiting on you, Waiting for you | the specs themselves, with screenshots; the phone's typecheck |
| A4.5b | The phone's new screens, seen through A4.5a: a "Needs you" section at the top of Activity (the digest line, then breakpoints and signals, one count as the Home badge implies), `signal-detail.tsx` (both sides in plain words, the files, Acknowledge, Intended, Reply to agent), `workstreams.tsx` with its detail, and the push tap routed | phone specs with screenshots; mobile typecheck and lint |
| A4.6 | M4 done-when as a test: a contract signal on the desktop reaches the phone as a push; the phone reads it and replies; the reply reaches the agent as a steer on its next step. `docs/claude/awareness.md` and `docs/claude/mobile-companion.md` gain the phone's part | harness end to end |

### A5: Review (M5)

Refined 2026-09-29 (log entry "A5 refined"). Review already exists for one
change at a time (`review_plan`, `get_pr_draft`, criteria and sign-off,
Phases 25 and 31). A5 adds the work that is not under review. A5.1 comes
first because it is a bug as much as a feature. The default review compares
against the newest commit, and a `commit:` side has files but no import
edges. So "dependencies nobody planned" is switched off in the common case,
and it is off for every branch review parallel work produces.

| Sub-step | Delivers | Tests |
|---|---|---|
| A5.1 | A `commit:` side gets its dependency edges. Its unchanged files keep the opened graph's edges. The files that differ from the working tree are parsed at that ref with their imports kept, not only their symbols, and resolved by the project's own resolvers, the path the footprint engine already reads through (`showAt`, `withSymbolChanges`). The side is then `edgesKnown`, so unplanned dependencies and blast radius come back for commit and branch reviews. `list_comparands` also lists each workstream branch, as `commit:<ref>` with its name | unit (edges for a commit side; a file changed at the ref); harness: `review_plan` against a commit reports a dependency nobody planned that it suppressed before |
| A5.2 | "Other work in flight" in `review_plan` and `get_pr_draft`, for the workstream under review (the branch the plan's items name, else the current branch). It lists:<br>• the open signals involving that workstream, and what happened to each: fixed, acknowledged with the agent's note, or marked intended by the person, written down as a decision;<br>• the other open workstreams that import what it changes ("merging this changes `createInvoice`; `checkout-fix` imports it and will need updating").<br>A PR draft with an open high signal gains a warning. The words come from `signal-words.ts` | unit (the section's words); harness: a branch that changes a function another workstream imports says so in the review and in the PR body |
| A5.3 | The opt-in "no open high signals" check, inside the existing `code` criterion kind rather than a new kind. It is a project setting, off by default. When on, `runChecks` fails a `code` criterion while the item's workstream has an open high signal, naming it in the desktop's words. It gates sign-off the way a failing test does, and never blocks a tool call | unit (`runChecks` with and without the setting); harness: the check fails while the signal is open and passes once it is answered or fixed |
| A5.4 | The review queue, keyed by (plan, branch): each workstream that has plan items, ready or nearly ready. For each: criteria status, blast radius (`diff-engine`), unplanned dependencies (A5.1), open signals, and whether it is ready (criteria pass and no open high signal). A suggested merge order: when A changes something B imports, A goes first and B gets a heads-up, with the reason shown. It is never enforced. `GET /api/review-queue`, and a read-only `get_review_queue` MCP tool with its `TOOL_CAPABILITIES` row | unit (the order and its reasons, including a cycle); harness: the queue lists two branches, and orders the one whose change the other imports first |
| A5.5 | A Review tab next to Awareness in `PlanPanel`: the queue, in order, with each reason. Opening a line shows its review (the existing `PlanReviewPanel`) with the new section. It is empty when nothing is in review, and says so | browser, with a screenshot of the queue and of one review |
| A5.6 | The queue on the phone: a `review.queue` RPC with its `peer-capabilities` row, and a screen listing the queue with the order and reasons. It opens to the existing `plan-review` and approvals screens (31.6b) | harness (the RPC from a paired phone); phone spec with a screenshot |
| A5.7 | M5 done-when as a test: reviewing a branch that changes a function another open workstream imports says so in the review and in the PR body, and the queue puts it first with that reason. `docs/claude/awareness.md`, `docs/claude/mcp-tools.md` and `docs/claude/mobile-companion.md` gain review | harness end to end |

### A6: The Brief (M6)

Refined 2026-09-30 (log entry "A6 refined"). Work that is not code has the
same parallel problem (awareness spec §10): one analyst runs several Claude
Desktop sessions on several tasks, and the tasks share source material.
Phase 31 already records materials, outputs and citations, hashes them and
watches them (`artefact-watcher.ts`), but it handles each task on its own:
a check run and a notice per task, and nothing names the others. A6 makes
a task a workstream and its materials a footprint, so the awareness engine
that already tells code agents tells these ones too, in the same inbox.

Three things decide the shape:

- **A task workstream is `task:<item uid>`**, beside the folder roots in a
  signal's `workstreams`. Claude Desktop has no folder, so a session binds
  to the task it calls `get_brief` on (the latest wins), kept on the session
  as its brief task, separate from its folder. `noticeFor` tells a session
  about signals naming its folder or its task.
- **Material signals come from the same refresh.** `refreshSignals`
  reconciles every signal of a project at once, so the material rules run
  inside it (`computeMaterialSignals`, pure, beside `computeSignals`).
  Otherwise each refresh would resolve the other's signals.
- **What is recorded is added to the one `read_material` handler**: which
  session read which material, and the file's hash when it did. Nothing is
  read back out of the materials themselves.

| Sub-step | Delivers | Tests |
|---|---|---|
| A6.1 | Task workstreams. `get_brief(item_uid)` binds the calling session to that task (`sessions.brief_item_uid`, latest wins, never from a request body naming another session). `list_workstreams` and `/api/workstreams` list each task with a bound session or a recorded material as a workstream: kind `task`, its title and plan, its sessions and agents. The lines-of-work strip and the phone's list show them ("Task · Q3 summary · Claude Desktop"). `noticeFor` also matches a session's task | unit (binding, latest wins); harness: two MCP clients call `get_brief` on two tasks and both tasks are listed with their sessions; a signal naming one task is told to that task's session only |
| A6.2 | Material footprints. `read_material` records the session and the file's sha256 at the read (`material_reads`: item, session, attachment, path, hash, locator, at). A task's footprint is what its sessions read (paths, hashes, locators), the outputs it recorded, and the parts its citations name (Phase 31 §7.5). `get_brief` shows what the task has read. The file's hash at the read comes from the attachment's current hash, re-taken as every read already does | unit (the footprint of a task); harness: two reads of one material by two sessions keep who and which hash |
| A6.3 | Material signals, in `refreshSignals`: `contract` (a material changed and outputs in other tasks cite the part that changed; high when one was signed off), `stale-base` (a material changed after a task started using it), `version-split` (new kind: two tasks read different versions of one material), `collision` (two tasks record the same output file), `drift` (a task reads a material that is not in its brief). One signal per material, naming every task, in words from `signal-words.ts` ("`sales-2026.xlsx` changed. Two reports in two tasks cite `Summary!B2:F9`; one was already signed off"). The artefact watcher refreshes on a change; each task's criteria still go stale as they do now | unit (each rule, and no signal from one task alone); harness: replacing a spreadsheet two tasks read raises one signal naming both |
| A6.4 | Where it shows. The Brief page (`BriefWorkspace`) gains "Other work affected" per task, in words: "The sales spreadsheet changed. This report and the board pack both use it." `get_brief` gains `affectedByOtherWork`, because a Claude Desktop agent reads its brief first. The inline notice, the digest, the Awareness tab and the phone's Needs you carry material signals like any other: one inbox | browser with screenshots (the Brief line, the Awareness card); phone spec with a screenshot |
| A6.5 | Sign-off packs (31.7b) list the signals that touched the task and how each was resolved, as PR bodies do (A5.2) | unit (the pack's rows); harness: a pack for a task a material signal named lists it with its outcome |
| A6.6 | M6 done-when: replacing a spreadsheet that two tasks cite tells both tasks' agents on their next call, and shows once in the digest. `docs/claude/awareness.md` gains the Brief; the guide tells a Claude Desktop agent what "Other work affected" means | harness end to end |

### A3–A7

Refined into sub-steps when next. Scope is per the awareness spec:

| Step | Spec | Scope |
|---|---|---|
| A2 | M2 | Signatures (TS/JS, Python), import accuracy fixes, contract and drift signals, inline notices, `declare_intent` |
| A3 | M3 | Digest, intended and cooldown, `parallel` guide flavour, user skill and optional hook installer (Add to Claude Desktop pattern), `docs/claude/awareness.md` |
| A4 | M4 | Mobile: Needs you, workstreams, signal detail, push for high |
| A5 | M5, §9 | Review: other work in flight, `commit:` edges from footprints, queue with order, opt-in criterion check |
| A6 | M6, §10 | Refined above (A6.1–A6.6) |
| A7 | M7 | Rules format, `rule` signals, `check_conformity` made true |

### A8: Any agent

CodeTrellis is agent-agnostic (CLAUDE.md), but several things now work
best, or only, with Claude Code: the session watcher, the `PreToolUse`
hook that pauses an edit before it is made (B4.2, B4.2c), proof of skill
use (C1.3), and the Settings installer. A8 closes that gap, and keeps it
closed. The rule it leaves behind: a feature ships with the path every
MCP client has (tool calls, folder watching, git), and a client's own
hook or log may only make it earlier or richer, never be the only way.

| Sub-step | Delivers | Tests |
|---|---|---|
| A8.1 | The parity table in `docs/claude/awareness.md`: every awareness, breakpoint and skill feature, what any MCP client gets, and what a client-specific hook adds. The guide tells every agent to call `check_breakpoint(path, old_text)` before an edit, the same check the hook makes. A plain MCP client with no hook and no watcher runs the journeys end to end (sees workstreams and signals, is held by a task breakpoint, gets a function breakpoint's answer, is told of a breach, sees line changes) | harness, one journey per row, as `codex` with no hook |
| A8.2 | A client-neutral pre-edit check in the connector: `--check-edit <path> [--old-text-file f]` exits 0 (go ahead), 2 (held, the reason on stderr) or 0 silently on any failure, so any client whose hooks can run a command, and any wrapper script, gets the pause without CodeTrellis knowing its format | unit; harness (held, released, app not running) |
| A8.3 | Hook adapters for the other clients that have pre-edit hooks, each added only once its hook format is checked against that client's current docs, each with a fixture test of its real input and output, offered from Settings with the same diff-first, window-only installer as Claude Code's (A3.4) | unit per adapter; harness (install writes only what was ticked) |
| A8.4 | Proof of use and session signals for others: what the Claude Code watcher gives, derived for any client from its MCP calls (a `get_skill` read, the tools it used) and labelled by source, so "unknown" is left only where nothing at all was seen | unit; harness |

## 5. Track B: observability surface

| Step | Scope (observability doc §13) |
|---|---|
| B1 | `agent_events` log (tool calls, watcher events, spec body edits), with session, workstream and time |
| B2 | Timeline lanes per workstream: ● ◆ ⚠ ✓ marks, live, hover and click |
| B3 | Line changes per workstream in the code view, from git, for any agent (owner's ask, 2026-09-28); overlay list in `graph-builder` with plan intent, workstreams, collision zones and breakpoints as overlays; a signal chip focuses the graph on its files |
| B4 | Breakpoints: table, enforcement at interception, `await_decision`, inbox, phone, timeline span, breach wording |
| B5 | Replay: automatic snapshots (turn end, status change, commit) with SHA and session; one clock; catch-up |
| B6 | Stack view: multi-plan aggregate, overlap bands, drawn and cross-plan dependencies (bug 11) |
| B7 | Conferring: `propose_spec_change`, task → spec links, addressed events, decision as breakpoint |
| B8 | Grounding: per-test JUnit, tests → code via imports, overlay and task line |
| B9 | Play-forward: every active plan's projection, future zones; the materials tasks rely on as well as the code they plan to change (HD3's overlaps, projected) |
| B10 | The record: hash-chained log, signed packs, retention settings, evidence export |

### B1: agent event log

| Sub-step | Delivers | Tests |
|---|---|---|
| B1.1 | `agent_events`: every broadcast agent event kept by a passive tap, stamped with session, agent and workstream (from `agent_sessions`, whatever the session's state), with launch-unique ids, secrets masked, 14 days and 100,000 rows kept; `GET /api/agent-events` (time, session, workstream); the window loads the last 400 when it connects, so the Timeline survives a reload | unit; harness including a restart; browser (reload) |
| B1.2 | Spec and plan-item body edits as events (who, which document, which version); watcher events at the time the agent acted, not when they were read; calls the SDK refuses on their arguments recorded too | unit; harness |

### B2: Timeline lanes

| Sub-step | Delivers | Tests |
|---|---|---|
| B2.1 | Lanes above the turn list, one per workstream (main first; a "No workstream" lane only when used): ● a turn, placed by the workstream its events name or its session's; ✎ a turn that edited a spec; ⚠ each signal on every lane it names. The window runs from the earliest mark (15 min to 2 h). Hover says what a mark is in words; click opens the turn below, or goes to Awareness. Live. Tool events carry their workstream as they are broadcast | unit; harness; browser |
| B2.2 | ◆ commits and merges per workstream (and main), ✓ / ✗ check runs and criterion decisions; the lanes follow refs changes | unit; harness; browser |

### B3: Line changes and overlays

Line changes come from git and the parser, never from an agent's report,
so they are the same for every client. A workstream's change to a file is
its copy against its merge base with main, committed and uncommitted
(`git diff <merge-base> -- <file>` run in that worktree). An agent may see
another workstream's changed lines: they are git's output about the
repository, not another agent's words (awareness rules, principle 5).

| Sub-step | Delivers | Tests |
|---|---|---|
| B3.1 | Line changes: `GET /api/workstreams/:id/changes?path=` returns that workstream's hunks for one file (line ranges old and new, added / changed / removed, the functions they fall in, committed or not); the workstream is chosen by id among known ones, never a root from the request, and the read goes through the confined helper. MCP `get_line_changes(path, workstream?)` (capability `read`) gives any agent the same: by default ranges and function names for every other workstream changing that file, the diff text when asked. Binary and very large files say so instead | unit (hunk parsing, function placement); harness across two worktrees, as a client with no hook |
| B3.2 | The code view shows them. A gutter marks each line this workstream changed (＋ added, ～ changed, − removed below) and, separately, lines other workstreams change, with their name in words on hover ("billing-v2 changed 40–52, in validateCreateOrder, not committed"). "Compare with…" opens the existing diff view (`CodeDiffView`) between main, this copy, and any other workstream's copy, both sides named. A file no one else changes says so | unit; browser (journey below, screenshots) |
| B3.3a | The overlay list: plan intent, workstreams, collision zones and breakpoints are overlays a person turns on and off (the canvas applies the list; plan intent on the live graph is one of them rather than hard-wired); a file node shows each other workstream's line count (＋12 −3, in words on hover) from `git diff --numstat` in the watcher, and a dashed ring with ⚠ in an open overlap | unit; browser |
| B3.3b | A signal chip focuses the graph on its files; "Show changes" on a file node opens B3.2 | unit; browser |

**Journey (B3.2).** Sam opens `validators.ts` from a collision signal. The
gutter shows two runs of marks: billing-v2's in `validateCreateOrder`, and
exports' in `validateCreateUser`. Hovering one says who, which lines,
which function and whether it is committed. "Compare with… billing-v2"
opens both copies side by side, named. From the graph, the same file node
reads "2 workstreams: ＋12 −3, ＋4".

### B4: Breakpoints

| Sub-step | Delivers | Tests |
|---|---|---|
| B4.1 | `breakpoints` and `breakpoint_hits` tables; task breakpoints (claim, mark done) and spec breakpoints (an agent's edit of a spec or item body) enforced at the MCP interception: the call returns "paused: waiting for a decision" with a reference instead of acting; `await_decision(ref)` returns the answer or "still waiting", from the database, so it survives timeouts and restarts; a person answers continue, continue with a steer, or stop over REST (author from how the call arrived); set and clear over REST; hits and answers are Timeline events | unit; harness incl. restart |
| B4.2 | Code breakpoints on a file, folder or a function's file: with the Claude Code hook the edit is denied as "paused: waiting for a decision" until a person answers (continue covers that file for that workstream; stop keeps refusing it); for other clients, a change to one surfaces on the next tool call as a breach ("you changed a file with a breakpoint; stop and wait"), recorded and shown as a breach, never as a pause | unit; harness |
| B4.2c | Function-level breakpoints (the owner's ask, 2026-09-28): the hook sends the text each edit replaces, and a breakpoint on one function holds only an edit that touches its lines; a breach counts only when that function changed. What cannot be told (a whole-file write, text not found, no parser, the function not in the file) is held as the whole file | unit; harness |
| B4.2b | Signal breakpoints: a project rule (a breakpoint row, not the committed config) that makes a kind of serious signal a breakpoint for the workstreams it names, while it is open | unit; harness |
| B4.3a | The person's side in the inbox: "Waiting on you" first in Awareness (a pause says who wants to do what and why; a breach says what happened), answered continue / continue with steer / stop; the Awareness count includes them; "Ask me first" on a task's Routing panel (task and spec, inherited from a parent shown); the breakpoints set, with Clear, and rules on serious signals | unit; browser |
| B4.3b | On the graph and the lanes: "Ask me before this changes" on a file or folder node, ⏸ on nodes with a breakpoint, ⏸ spans on the Timeline lanes from hit to answer (a breach its own mark) | unit; browser |
| B4.4 | The phone: waiting breakpoints first in its list, answered from the phone (author the phone), push for a breakpoint | unit; harness |

### B5: Replay

| Sub-step | Delivers | Tests |
|---|---|---|
| B5.1 | Frames: `trellis_snapshots` gains project, commit SHA, session, workstream, reason and a digest. A frame is taken when a session's turn ends (30 s quiet, the window's rule, moved to `src/shared`), an item's status changes, or a commit lands on a workstream; only when the server holds that project; one per project at most every 10 s; a frame whose graph matches the last one points at it instead of copying. Symbol counts in one query. 14 days kept, as `agent_events`. `GET /api/replay/frames?project&from&to` | unit (digest, debounce, the held-project refusal); harness: a turn end, a status change and a commit each make a frame with its SHA and session; another project held makes none |
| B5.2 | The state at a moment: `GET /api/replay/state?project&at` answers the graph of the frame at or before `at` (with what differs from now), each item's status, the breakpoint hits waiting and the signals open at `at` (each opening of a signal kept from here as a span, so a reopened signal keeps its earlier ones); the lanes up to it are `/api/agent-events?before=` | harness: states at three moments of one scripted run, each matching what the window showed live |
| B5.3 | One clock in the window: a replay store holds the cursor; the transport bar drives the Timeline cursor, the graph (frames step, never animate), the plan list's statuses and the inbox. The chrome says "Replaying 10:02 → 12:04" with a way back to live; live events keep arriving underneath | browser, with screenshots: step, play, back to live |
| B5.4 | Catch-up: the window remembers when the person last looked; the digest (C1) offers "Watch at 4×" from there to now. Any MCP client gets the same moment with `get_state_at` | browser: G1 end to end; harness: the MCP tool |

### B6: Stack view

Refined 2026-09-30 (log entry "B6 refined"). No view shows several plans
together: plans are a flat list and items a tree for one plan at a time.
Dependencies are never drawn, and they stop at the plan boundary: both
"what is next" rules looked a dependency up in the item's own plan, so one
on another plan's task was never found and its dependant never offered
(bug 11). Overlap signals are keyed by workstream, not plan. The review
queue already maps plan → branch → workstream → signals, and replay's
`stateAt` already lists every plan's tasks.

| Sub-step | Delivers | Tests |
|---|---|---|
| B6.1 | Dependencies resolve across plans (bug 11): one rule (`plan-dependencies.ts`) behind `get_next_item`, `/next-task` (the window and the phone) and the claim; a dependency is met when its task is done or skipped, wherever it is; a held task says what it waits on and where ("waits on 'Migrate schema' in plan 'Billing v2'"), and so does `get_next_item` when nothing is ready; `GET /api/plans/:uid/waits`; the plan's Next up strip lists each wait, with another plan's task as a link to it; a claim on a waiting task goes through and says what it waits on; REST and MCP refuse a dependency that names nothing, the item itself or a page | unit (the rule); harness (waits, then offered by every door once done; the claim warning; refusals); browser, with screenshots: the wait, the link, Next up once done |
| B6.2 | The stack: `GET /api/stack?project` and a read-only `get_stack` MCP tool (its own `TOOL_CAPABILITIES` row), for any opened project (plans are rows per project, not part of the held graph): every plan not completed or archived, labelled with its ticket key when it has one, with progress and what waits on a person; its tasks with status, assignee, workstream and dependencies resolved across plans (B6.1) | unit; harness (two plans and a completed one, a cross-plan dependency, a ticket key, an agent's answer equal to REST, a project never opened refused) |
| B6.3 | Overlap bands: two plans touch the same files or functions, declared (their tasks' file and symbol specs) or actual (open collision and contract signals, mapped from workstream to plan the way the review queue maps them), in words: "⚠ overlaps JIRA-150", the plan title when there is no key | unit (declared and actual, the words); harness (a declared overlap, then an actual one from two worktrees) |
| B6.4 | The Stack tab beside Plans: one row per plan (its ticket key, progress, what waits on a person), tasks nested with who is on each and in which workstream, overlap bands in words, dependencies drawn with their words, including across plans (one in another plan is a link to it); "Show on graph" puts a plan's footprint on the graph, clusters included | browser, with screenshots: the stack, a band, a cross-plan dependency and its link, a plan on the graph and off again, a met dependency |
| B6.4b | One selection, the Timeline half: selecting a plan in the stack filters the Timeline to its work (its workstreams and the sessions on its tasks) | browser |
| B6.5 | One clock: the stack follows the replay cursor and shows what was in flight then (`stateAt` gains each task's assignee, workstream and dependencies, rebuilt from `plan_item_versions`) | harness `stack-at.test.ts` (the state at a moment); browser `stack-replay.spec.ts` (the stack at a past moment) |
| B6.6 | The stack on the phone, summarised: plans with progress and "⚠ overlaps" in words; `stack.summary` RPC with a `read` row; a screen reached from Plans | harness `stack.test.ts` (the phone's stack equals REST); phone `stack.spec.ts` with screenshots |
| B6.7 | Done-when and docs: H1 end to end (two agents in two plans, a cross-plan dependency, an overlap) seen the same by the window, an MCP client and the phone; `docs/claude/awareness.md` and the guides | harness end to end: `awareness-h1.test.ts` |

**Journey (H1).** The person opens the Stack tab and sees every plan in the
project at once, by ticket key: who is on what, in which worktree, and
"⚠ overlaps JIRA-150" where two plans meet. A task waiting on another plan
says so and leads there. Selecting a plan shows its footprint on the graph
and its work in the Timeline; moving the clock back shows what was in
flight then.

### HD3: Business clashes in the Stack

Added 2026-09-30 (log entry "Business work in the plan"). A6 raises one
signal when tasks clash over a material, naming each task as a workstream
`task:<item uid>`. The Stack (B6.3) counts only `collision` and `contract`
signals, and maps a signal's workstreams to plans through the plans'
branch folders, so a task workstream never reaches a plan and a clash
between two plans' tasks over a spreadsheet is never an overlap band. The
declared side reads only file and symbol specs, not the materials a task's
brief lists. Replay's `stateAt` rebuilds tasks and signals at a moment but
not which version of a material each task had read, though
`material_reads` keeps it with its time.

| Sub-step | Delivers | Tests |
|---|---|---|
| HD3 | `stackOverlaps` maps a `task:` workstream to its task's plan, and counts the material kinds (`contract`, `stale-base`, `version-split`, `collision`) between two plans' tasks; the declared side adds the materials each plan's tasks list in their briefs (`materialInputsOf`). The words say what is shared: "⚠ overlaps Q3 board pack: both use `sales-2026.xlsx`". The same at a past moment (B6.5 reads signal spans) and on the phone's stack summary (B6.6). `stateAt` gains each task's material reads up to the moment, so a task in the past stack says "read `sales-2026.xlsx` (22 Sept version)" | unit (task workstreams mapped to plans; material kinds counted; declared materials; a task alone makes no band); harness: two plans' tasks read a spreadsheet, it is replaced, both plans show the band live and at a moment, the phone's summary equals REST; browser with screenshots: the band in the Stack tab, the past stack with the version |

**Journey.** Dana leads a finance team. The Q3 board pack and the
forecast refresh are two plans, each with a Claude Desktop task that reads
`sales-2026.xlsx`. Someone replaces the spreadsheet. Dana opens the Stack
tab and both plans carry "⚠ overlaps" naming the spreadsheet, as two code
plans touching one file would. Moving the clock back to Monday, each task
says which version of the spreadsheet it had read then.

### B7: Conferring

Refined 2026-09-30 (log entry "B7 refined"). An agent that finds the spec
is wrong can only edit the page directly or not at all. Spec pages are
versioned plan items (`kind = 'object'`) and every body edit records a
`spec_edited` agent event, but nothing links a task to the page or section
it relies on, so nobody can be told when it changes. Channel events carry
the right words (`weigh-in`, `need-decision`, `steer`) but are addressed to
a plan, never to an agent, and agents only see them by polling. Breakpoints
already raise decisions from services (signals, breaches) and deliver the
answer; the inline notices of A2.6 already tell a session once on its next
call. The "Proposed" tab is the code-change feed and keeps its name; B7
says "spec change".

| Sub-step | Delivers | Tests |
|---|---|---|
| B7.1 | Tasks say what they rely on: a page, or a section of it (a markdown heading, addressed by its slug: `shared/lib/spec-sections.ts`). Set on `add_item` / `update_item` (`relies_on`) and REST, refused when it names no page or no heading; kept in `spec_links`. The reverse, "who relies on this", across every plan in the project. A task shows "Relies on: Invoice format › Fields"; a page shows "Relied on by 3 tasks in 2 plans" | unit `spec-sections.test.ts`; harness `spec-links.test.ts` (links across plans, refusals); browser `spec-links.spec.ts`, with screenshots |
| B7.2 | Propose: `propose_spec_change(page, section?, text, why, evidence?)` (capability `write`) and REST. A `spec_proposals` row keeps the page's version it was made against, the proposed text, why, the evidence (a failing test, a file, a commit) and the author from the transport. It lists every task relying on that page or section, in any plan, when it is made. A direct edit to a page other tasks rely on still works but its result says who relies on it and suggests proposing instead | unit `spec-sections.test.ts` (`withSectionText`); harness `spec-proposals.test.ts` (a proposal naming tasks in two plans; the author is the calling session; a page changed since the proposal's version is said so); browser `spec-links.spec.ts` (the page shows it) |
| B7.3 | Addressed, once: each session holding an affected task is told on its next call ("── CodeTrellis: spec change proposed ──", with the change, why and the page), once per session, never to the proposer or anyone else. `reply_to_spec_proposal(uid, impact, words)` (`none` / `changes` with a sentence and a task count) records the impact from that plan, and a `weigh-in` in the proposer's plan | unit (who is told); harness (two agents told once each, a third not; their replies kept with who and which plan) |
| B7.4 | The decision is a person's: a `proposal` breakpoint kind, raised by the service when the proposal is made, so the inbox (Awareness tab, count, push) shows "✎ Spec change proposed" with every impact beside it and Accept, Amend (edit the text, then accept) and Reject. Decided over REST (`personFrom`) and the phone only, never by an MCP tool. Accept writes the page's new version (author: the person, change summary naming the proposal); every relying task is marked "spec changed" (a `plan_events` row, and a flag until its agent reads it) and its agent is told once. Reject tells the proposer. `await_decision` works on it | harness (accept: a new version, tasks marked, agents told once; reject; an MCP client cannot decide); browser, with screenshots: the card, amend, accept |
| B7.5a | A `spec` breakpoint on a relied-on page holds a direct edit (`update_item` body, `restore_item_version`) and its paused result names who relies on the page and says to propose instead; the inbox card says the same ("3 tasks in 2 plans rely on this page"). A proposal to that page is not held (a person decides it already), and its card shows the person's note on the breakpoint | harness (held, the words, a proposal not held and carrying the note); unit (the words) |
| B7.5b | Legacy plan documents are guarded like pages: a `spec` breakpoint can be set on a plan document (REST, `docUid`). An agent can change one only by editing the plan's files on disk, which cannot be paused, so the import is held instead: the app keeps its version, the inbox shows "changed on disk" with the difference, continue applies the file's version, stop keeps the app's and the next export writes it back | harness (a guarded document's file edited: not applied, held; continue applies; stop restores the file) |
| B7.6 | The phone: the proposal in Needs you with every impact, Accept / Reject from the phone (the person, from their phone); `proposal.list`, `proposal.get`, `proposal.decide` RPCs with their capability rows | harness (the phone's view equals REST; a decision is the person's); phone spec with screenshots |
| B7.7 | Done-when and docs: I1 end to end. The billing agent proposes adding `currency` to the invoice format with a failing test; two other plans rely on that section; their agents are told once and reply "no change needed" and "one new column"; Sam sees one proposal with both impacts and accepts; the page has a new version, both plans' tasks are marked "spec changed" and their agents are told. The window, an MCP client and the phone agree. `docs/claude/awareness.md` and the guides | harness end to end |

**Journey (I1).** The billing agent finds the invoice format cannot carry
currency and proposes the change with the failing test as evidence.
CodeTrellis finds the two other plans relying on that section and tells
their agents on their next step; they reply with the impact. Sam sees one
proposal with both impacts, in the window or on the phone, and accepts. The
spec gets a new version, the linked tasks say "spec changed", and their
agents re-plan.

**Rules.** Only a person decides a proposal (the transport's author, never
a name in the request). A proposal never edits the page until accepted.
Agents are told what changed and by whom, never another agent's words
verbatim in a notice title.

## 6. Track C: shared ways of working

| Step | Scope (shared-work doc) |
|---|---|
| C1 | Skills: model fields, skills index and picker, brief/claim/next delivery, proof of use, safety flag on pulled skills |
| C2 | Team status through git: state read from git for any host, a host adapter only when turned on (GitHub, GitLab, Bitbucket), status read from the plan files and git with no written summary, ticket refs exported, signed approvals, Phase 32's own plan moved in |
| C3 | A shared plans folder, carried by git or by a cloud-synced folder: one writer per file, only ever added, signed records; a code project links to it; teammates' material reads shared when the team turns it on |
| C4 | Recurring playbooks |
| C5 | One plan across worktrees: sections of a plan assigned to workstreams (owner's ask, 2026-09-28) |

### C1: Skills on plans and tasks

| Sub-step | Delivers | Tests |
|---|---|---|
| C1.1 | `Skill` gains `use: 'recommended'`, `why`, `where` (repo, plugin, mcp, playbook, link), normalised on every write (panel, plan file, template) and refused over REST when bad; the project's skills index (`GET /api/skills`, `.claude/skills/*/SKILL.md` front-matter, read through confined-fs); `get_brief`, `claim_item` and `get_next_item` say which skills to use and where in one line; a `link` never reaches an agent; a repo skill missing from the agent's checkout is said to be, with how to get it | unit; harness |
| C1.2 | The picker in the routing panel: required or recommended, why, where; the project's skills searchable, inherited ones shown as such, a link marked "people only" | unit; browser |
| C1.3 | Proof of use: the Claude Code watcher records each `Skill` call as `skill_used` against the session's task; the task, the Timeline and the sign-off pack say "✓ used", "○ recommended, not used", or unknown for other clients; a task launched from a CodeTrellis terminal preset gets the skills line in its opening prompt | unit; harness; browser |
| C1.4 | A new skill arriving in a pulled plan file is flagged once in the inbox, with who added it and in which commit, before any agent is told to use it | unit; harness; browser |

### C2: Team status through git

Refined 2026-09-30 from the owner's two points: status a program can
read, and read from git rather than kept; and not everyone is on GitHub.
Design: shared-work doc C-2, §5 and §6. Git is the catch-all for what it
can prove (building, pushed, merged, for any host or none); what only a
host knows (in review, checks, approvals, closed) comes through an
adapter the person turns on per project.

| Sub-step | Delivers | Tests |
|---|---|---|
| C2.1 | Each item's state from git, for any host: `building` (its workstream branch exists), `pushed` (on the remote), `merged` (ancestry for a merge or fast-forward; the branch's changes in the base for a squash or rebase, reusing bug 53's check; or the merge commit naming the item's key), each with its source and the commit that proves it. In the plan tree, the item page and the plan's MCP tools; no network | unit (the three merge shapes); harness with real repositories: merge, squash, rebase, a branch that stopped (stays "pushed", never "merged") |
| C2.2a | Turning a review host on, with no request yet (refined 2026-09-30, log entry "C2.2a"): the host read from the `origin` remote (`review-host/detect.ts`; GitHub supported, GitLab and Bitbucket recognised for C2.3, others named); a per-device switch per project in this device's database, never the committed config, recording the repository it was turned on for so a changed remote switches it off; turning on and saving a token are grants (the app window only), turning off and forgetting are anyone's; the token per host in the secret store (`secret-store.ts`: Electron `safeStorage` with the OS keychain, else memory only and saying so; never plain text on disk, the database or a response); `GET/PUT /api/review-host`, `PUT/DELETE /api/review-host/token`; Settings → Review hosts says the host, what it would read, and where a token is kept; Telemetry lists it | unit (detection in each spelling; the store's ciphertext and file mode; keys); harness `review-host-switch.test.ts` against a stand-in GitHub that must be asked nothing (off, on, token never echoed, a changed remote, GitLab refused, the grant refusal from plain HTTP); browser `review-host-settings.spec.ts` with a screenshot |
| C2.2b | GitHub behind it: the adapter (open, merged, closed for each branch's pull request, its checks and approvals), read only when `activeReviewHost` allows, cached, with the token only in its request; `in review` and `closed` states with `source: 'github'`; the plan tree, the task line, `get_plan` and `get_brief` say which host said it. Without it the words are git's ("pushed, not merged") | unit on recorded API answers; harness against the stand-in host: nothing requested until turned on, then open / merged / closed |
| C2.3 | GitLab (merge requests, pipelines) and Bitbucket (pull requests, build statuses) on the same interface, each read against its API documentation; Azure DevOps and Gitea recorded as follow-ups on the same shape | unit on recorded answers per host; harness: the same journey on each stand-in |
| C2.4 | Status read, not written (C-2 §1, the owner's point of 2026-09-30): every item has a state with its source. Intent is the plan's YAML; state is derived: git for a task on a branch (C2.1), a host when one is on (C2.2), and the plan itself (status, evidence, sign-off, who recorded each) for everything else, saying "from the plan". Lineage "ticket → plan → PR #N (open)" only when a host says so, else "branch pushed". One status view in the window, the phone and `get_plan`; no STATUS.md, and no state change writes a file | unit (a task with no branch says "from the plan"; with and without a host); harness: every item in `get_plan` and the plan tree has a state and a source, and a state change writes no file |
| C2.4a | Every item a state with its source, and one status view (refined 2026-10-01, log entry "C2.4a"): `shared/lib/item-status.ts` (pure) and `services/plan-status.ts`. Git or the host for an item on a branch git can see; the plan itself for everything else, in words ("in progress, 60%", "blocked: …", "done, signed off by Priya" from its criteria) with who recorded it (the newest `status_changed` event); a section sums its tasks; a branch git has not seen yet keeps the plan's state with a note. The view: progress (done in the plan or merged by git or a host), waiting on someone (blocked, or a criterion waiting for sign-off), in progress, and a lineage per branch (ticket → this plan → "PR #118 (open)" only from a host, else what git proves). `GET /api/plans/:uid/status`, the phone's `plan.status`, `get_plan`'s `state`; in the window the header chip opens the view, every tree row says its state and source on hover, and the item page has a State line; on the phone a Status card on the plan. Reading writes nothing | unit (`item-status.test.ts`: plan words, criteria and sign-off, sections, git vs plan, a branch not made yet, host lineage vs git lineage, the view); harness (`plan-status.test.ts`: every item a state and a source, the plan's state with who recorded it, waiting and in progress, lineage without a host, `get_plan` and the phone equal to the route, reading writes nothing, 404); browser (`plan-status.spec.ts`, shots `plan-status-view`, `item-state-line`); phone (`plan-status.spec.ts`, shot `plan-status`) |
| C2.4b | No state change writes a file (log entry "C2.4b"): an item's file carries no `status`, `progressPercent`, `blockedReason`, claim, progress report or `updatedAt` (every change bumps it); an update that changes only state (`isStateOnly`) and a claim schedule no write-through; a file whose content would not change is not rewritten. Import still reads an older file's `status`, and a file without a claim or blocked reason leaves this machine's alone. Until C3's signed records, a teammate does not see a no-branch task's recorded state | unit (`isStateOnly`); harness (`plan-state-writes.test.ts`: a status change, a claim, progress by REST and by `update_item_progress`, and a blocker leave `git status` clean while each state is still read; the file has no state fields; a rename still writes; an older file's status is read and a file without a claim keeps it); `task-context.test.ts` updated: progress no longer round-trips through a file |
| C2.5 | Ticket refs in the plan files; approvals as signed statements, verified on import (C-2 §2–3) | unit; harness |
| C2.5a | Ticket refs in the plan files (refined 2026-10-01, log entry "C2.5a"): `plan.yaml` gains `refs` (the plan's tickets: url, key, kind, title) and each item's file gains `refs` (its links). Import adds a ref this machine lacks and updates a title; it never removes one. What is read is cleaned (`plan-file-refs.ts`): http(s) only, keys and titles bounded, at most 50. Adding, editing or removing a ref schedules the write-through, as an item change does. After a pull, the plan's lineage starts with its ticket | unit (`cleanRefs`); harness (`plan-file-refs.test.ts`: both files name their refs; adding a link writes; a teammate's import has the ticket in the lineage and the links; a link that is not http(s) is dropped and a file without a ref takes none away) |
| C2.5b | Approvals as signed statements: a person's approval of a criterion, where git signing is set up with an SSH key (`gpg.format ssh`, `user.signingkey`), is also written as its own record under the plan's `approvals/` (one file per approval, only ever added), signed with `ssh-keygen -Y sign` under the namespace `codetrellis-approval` over the criterion, its text's hash, the evidence hashes, who and when. Import verifies each with `ssh-keygen -Y verify` against git's `gpg.ssh.allowedSignersFile`: a verified approval shows "✓ verified, signed by …" and counts as that person's sign-off; anything else shows "⚠ can't verify" with why and counts for nothing. Without signing set up, approvals stay local, and the sign-off says so | unit (record canonical form; verify: valid, tampered, unknown signer, no allowed-signers file); harness: a signed approval round-trips to a teammate verified; a tampered or unsigned one does not count; without signing nothing is written |
| C2.6 | Teammates' plans after a pull (C-2 §4); and Phase 32's own plan in CodeTrellis, each step an item whose workstream is its branch: `npm run status` reads from the app, or goes. C2 done-when | harness (journey below); browser with screenshots |
| C2.6a | Teammates' plans after a pull (refined 2026-10-01, log entry "C2.6a"): a plan that first reaches this machine through its files is recorded with who added it and in which commit, as `git log` says (`plan-arrivals.ts`; the file's own `author` is anyone's text). The plans list, the Stack (window and phone) and `get_plan` say "from Priya Shah, in 3f9c2e1"; a folder not committed yet says so, and learns its commit on a later import. A plan made here has none. Nothing is fetched | harness (`plan-arrivals.test.ts`: a commit fast-forwarded in as a pull would, imported; the Stack and `get_plan` agree; your own plan has none; uncommitted, then committed; once only); browser (`plan-arrivals.spec.ts`, shot `plan-arrivals`); phone (`stack.spec.ts`) |
| C2.6b | Phase 32's own plan in CodeTrellis (proposal, owner's choice first): each step an item whose workstream is its branch, in this repository's `.codetrellis/plans/`; `npm run status` reads state through the app's own readers (git and the plan), or goes. The choice: keep `PHASE-32-STATUS.yaml` as intent and import it as a plan, or replace it with the plan's files. Then the C2 done-when: the journey above on this repository | harness; the status test against the plan |

**Journey (C2).** Priya's team is on Bitbucket; Sam's on GitHub. Each
opens a plan whose tasks are worked on branches. With nothing turned on,
both see the same honest states from git: "building", "pushed, not
merged", "merged (squash, 3 Oct)". Sam turns on GitHub for his project:
Settings says it will read pull requests and checks for
`github.com/acme/app`, and his tasks now say "in review (#118), checks
passing". Priya turns on Bitbucket, and hers say the same from Bitbucket.
An agent asking either plan for its state gets the same words, with where
they came from. Nothing was requested from any host before it was turned
on. Priya's analyst has a task in the same plan with no branch at all; it
reads "in progress, from the plan", never less certain than the code
tasks beside it.

### C3: A shared plans folder

Design settled 2026-09-30 (shared-work doc C-3, log entry "Business work
in the plan"); refined into parts when next. Business teams share a
OneDrive or SharePoint folder the way developers share a git repository,
so the plans folder can be carried by either, with one layout:

- **One writer per file, only ever added.** Each person's app writes only
  its own records (`.codetrellis/records/<plan>/<task>/<writer>-<counter>.yaml`),
  and the state everyone sees is read from all of them. Two people acting
  at once make two files, so neither git nor a sync can clash. The same
  layout ends merge conflicts in a git planning repo too.
- **Partial arrival is normal.** A record not yet synced leaves a
  teammate behind, never wrong; reading one twice changes nothing; a
  "conflicted copy" a sync client makes is read as one more record.
- **A real disagreement is a signal**, never a silent pick: two people
  set one task two ways at once, and both are named.
- **Signed.** Anyone who can write to the folder can write a file, so
  each device signs its records with the key it already has for pairing;
  an unsigned record reads "unverified", as a plain HTTP call does.
- **Off by default, per folder.** The sync client moves the files; the
  app makes no request of its own. Files on demand are never downloaded
  to be read: only files already local, or cited by a task, are hashed.
- **Teammates' material reads**, shared only when the team turns it on,
  give A6's clashes across people: "Alex's task used last week's version;
  Sam replaced it on Tuesday."

### C5: One plan, several worktrees

Today a plan has one `targetWorktree`. The owner's ask: one plan whose
sections are worked in different worktrees by different agents, of any
client. A section is any item with children (a phase, a feature); its
workstream is inherited by everything under it, the way breakpoints and
skills are, and the plan's `targetWorktree` becomes the default for a
section with none.

| Sub-step | Delivers | Tests |
|---|---|---|
| C5.1 | `workstream` on an item (the branch it is worked on, resolved to the worktree that has it checked out; validated against the known workstreams, never a path from the request), inherited down the tree, set over REST (author from how the call arrived) and by MCP `assign_workstream(item_uid, workstream)` (capability `write`, refused for an unknown one). `get_next_item` offers an agent only items in its own workstream or unassigned; `claim_item` of an item assigned elsewhere is refused with where it is worked ("this section is worked in ../app-billing (billing-v2); start a session there"); `get_brief` says which workstream the task belongs to | unit; harness: two agents in two worktrees on one plan, each offered only its section, a cross-claim refused, as `codex` and a Claude Code session |
| C5.2 | Start a worktree for a section: "Work this section in a new worktree" creates it with `git worktree add` from the plan's `baseRef`, on a branch named from the section, beside the project; from the app window only; the section is assigned to it. The hand-off menu copies the start command for whichever agent the person uses (`cd <path>`, then the task prompt), not only `claude` | unit (branch naming, refusals); harness (created, assigned, refused from plain HTTP) |
| C5.3 | Seeing it: each section in the plan tree carries its workstream chip; the plan's progress reads per worktree ("billing-v2: 3 of 5 · exports: 1 of 4"); a Timeline lane names the sections worked in it; a collision between two sections of one plan says both section names; readiness to merge per section (ahead / behind main, open signals) | unit; browser (journey below, screenshots) |

**Journey (C5).** Sam splits "Checkout v2" into Billing and Exports.
Billing gets "Work this section in a new worktree", making
`../app-billing` on `checkout-v2-billing`; Exports is assigned to the
existing `../app-exports`. Sam copies the start command for each, one for
Codex and one for Claude Code. In the plan tree, Billing and Exports
each show their worktree; progress reads per worktree. Codex, in
exports, asks for the next task and gets only Exports' tasks; when it
tries to claim a Billing task it is told where that section is worked.
When both touch `validators.ts`, the collision names the two sections.

## 7. Phase end

1. Merge `main` into `feat/phase-32`, and resolve conflicts.
2. Run the full suite on Node 26 from a clean `npm ci`.
3. Packaged build on macOS per CLAUDE.md; launch and confirm "Backend
   initialised".
4. Mobile build if the mobile surface changed (it will: A4, B4).
5. Final direction review. JOURNEYS updated with what shipped.
6. One PR, `feat/phase-32` → `main`.
