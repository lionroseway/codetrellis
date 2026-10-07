# Phase 33 — Execution plan

> Step by step, PR by PR. Progress lives in
> [LOG.md](LOG.md). **Read that first** when picking the
> work up. The design is [RULES-AND-CLARITY.md](RULES-AND-CLARITY.md) and
> [AGENT-CHECKS-AND-REVIEW.md](AGENT-CHECKS-AND-REVIEW.md).

---

## 1. How the work is run

Phase 33 runs exactly as Phase 32 did ([PHASE-32-EXECUTION.md](../PHASE-32-EXECUTION.md)
§1), with the phase number changed. In brief:

- **The log is the source of truth.**
  - `docs/phase-33/STATUS.yaml` holds intent: steps, titles, order, parts,
    the next action and blockers.
  - `npm run status` reads each step's state from git and GitHub, and
    writes the log's Now and Checklist.
  - `tools/status/status.test.ts` fails when the log's items differ from
    the YAML.
  - The tool picks the newest phase with a status file. Pass `--phase 32`
    to touch Phase 32.
- **Branches.**
  - The integration branch is `feat/phase-33`, cut from `main` at `5fb23f4`.
  - One step = one branch `feat/phase-33-<id>-<slug>` (dots become dashes,
    lowercase) = one PR into `feat/phase-33`.
  - The squash commit is titled `Phase 33 <id>: … (#N)`. Git reads that
    title, so name every merge that way.
  - **One step PR is open at a time.** Every step edits the log, so two
    always conflict.
- **When to update the log:**
  - at the start and end of every step;
  - after every decision;
  - before any long command;
  - at least every 30 minutes.

  If a session could end now, the log must be enough to continue.
- **The suite is green at the start** (0.1 records it). Any failure is
  ours. Never skip, disable or quarantine a test.
- **Every new REST route, MCP tool and RPC method gets a test.** Re-run
  `npm run inventory` and commit the result. `tools/inventory/untested.json`
  only shrinks.
- **New MCP tools get a `TOOL_CAPABILITIES` entry**
  (`services/mcp-capabilities.ts`). A tool without one is refused.

### 1.1 The progress page

The owner reads progress on one page:

**Phase 33 Progress: <https://claude.ai/artifact/1C1s7saFkBgCeXAMUbRWXi>**

It is generated from the same YAML and git facts as the log:

```
git fetch origin feat/phase-33
npm run status:page       # rewrites the log's block and writes out/status/phase-33.html
```

Then publish `out/status/phase-33.html` to that artifact. A session with
the Artifact tool passes the link above as `url`.

Do this whenever the log's Now block changes:
- at the start and end of every step;
- after a decision;
- at least daily while work is moving.

The page is only a view: when it and the log differ, the log is right.

### 1.2 Definition of done, for every step

Phase 32's list (§1.4 there) holds:

- tests for the new behaviour;
- typecheck: 0 errors;
- lint: 0 errors, warning count not increased;
- unit tests and harness green;
- the structural guards green;
- UX checked, with a screenshot in the PR;
- docs;
- the log.

Phase 33 adds:

- [ ] **Every new state the app draws is in the visual vocabulary** once
      G1 lands, so it is in the legend. Before G1, the PR names the colour
      and the meaning.
- [ ] **Anything that changes what is enforced is a person's explicit
      act** (design §2.1), and has a test proving an agent cannot do it.
- [ ] The progress page republished (§1.1).

### 1.3 UX rules

Phase 32's (§1.6 there):
- quiet by default;
- glyph and word, never colour alone;
- say what it means;
- unknown is not zero;
- dark-first;
- empty states are content.

Two more:

- **A burst is one notice.** Never one toast, reload or broadcast per file.
- **A rule is shown where the code is.** On the graph, in the inspector and
  in the brief, not only in a list.

---

## 2. Order of work

The order puts relief first, then safety, then the cheap wins, then the
rulebook's breadth.

1. **Setup and Stage 0.** Docs, tooling, the progress page; baseline;
   measure the reload storm; audit the colours.
2. **Track S** (S1–S3). The freeze is the owner's most painful report.
3. **R1–R3.** Rule files, base-branch judging and the person's approval.
   Today a pull request can weaken the rules that judge it, which
   undermines everything after.
4. **G6, G5, G3, G4.** Opening restores a plan, the inspector lists plan
   items, edge toggles, full screen. Small and visible.
5. **R4–R5, C8, C1–C3.** Strength and package rules. Then the one
   renderer, so every output after it shares the words. Then scoped checks,
   SARIF, recipes and debt.
6. **G1–G2.** The visual vocabulary and the legend. They come before rules
   are drawn, so rules join one vocabulary.
7. **C7, G7–G10.** Check runs as records. The Rules view, rules on the
   graph, the Checks view, and findings where the code is.
8. **R6–R9.** Symbol, call, folder and guide rules.
9. **C4, C4b, C5, C6.** Agent checks locally, your own agent locally, then
   in CI, then graduation.
   **R10**, this repository's own rulebook, follows C6 (the owner,
   2026-10-07): deterministic rules before agent review in this repo's CI.
   Then **Track B** (B1 to B6), **C9**, and **B7** (the owner, 2026-10-07):
   the building blocks and a review on your own device, before Z.
10. **Track V**, the review features the owner chose (2026-10-06): V1, V2
    and V3, then V6.
11. **Z.** Docs, phase review, into `main`, release.

The checklist in the log is grouped by track; this list is the order.
Now's next action always names the next step in this order.

---

## 3. Steps

### Setup

- Integration branch `feat/phase-33` from `main` (`5fb23f4`).
- **Status tooling serves any phase:**
  - `--phase`, defaulting to the newest;
  - Phase 32's block format unchanged, and its D and E steps read from
    git too;
  - tests for both phases.
- **The progress page:**
  - `tools/status/page.ts`;
  - `npm run status:page`;
  - the artifact (§1.1).
- These docs.
- `CLAUDE.md` points every session at the Phase 33 log.

### Stage 0: ground truth

**0.1 Baseline.** Node 26 and a clean `npm ci`. Then record:
- typecheck;
- the lint warning count;
- `test:unit`;
- `test:harness`;
- the browser suite;
- `test:phone`.

Done when: every number is in the log's Baseline, all green.

**0.2 Measure the reload storm.** A harness test changes N task files in
one plan directory at once (N = 1, 10, 50), and counts:
- `importPlan` calls;
- `plan-imported` broadcasts;
- the backend's response time to a request made meanwhile.

It asserts today's numbers, so it is green. S1 then tightens the
assertion.

Done when:
- the numbers are in the log;
- the test is committed, with today's behaviour asserted and a comment
  naming S1.

**0.3 Colour audit.** A table in the design doc covering every colour the
graph, file tree, plan canvas, Timeline and Awareness tab draw. For each
colour:
- the meaning;
- the file and line;
- the glyph, if any.

Done when:
- the table is complete;
- each collision is marked;
- G1's vocabulary is drafted from it and the owner has seen it.

### Track S: quiet under load

**S1 One import per plan per burst.**
- The plan watcher gathers changed files per plan directory.
- It imports once after 250 ms of quiet, and at most once a second during a
  long burst.
- One `plan-imported` per plan, carrying `files: N`.
- Channel event files keep their own path.
- Conflict markers are still caught per file.

Done when 0.2's test asserts:
- N files in one plan → 1 import and 1 broadcast;
- the response time meanwhile is within 2× the idle time.

**S2 The window takes a burst as one.**
- `plan-imported` events are coalesced in the window.
- One plan-list fetch and one open-plan fetch per burst.
- At most one toast, "Plan reloaded from disk (N files)", replaced, not
  stacked, if another burst follows.

Done when a browser test sends 40 events and sees two fetches and one
toast.

**S3 Under load, end to end.**
- A 200-file change across 5 plans, through the real watcher, in the
  harness.
- The owner repeats it on a Mac with a real `git pull`.

Done when:
- the harness passes;
- the owner's run is noted in the log;
- if anything else storms, it becomes a follow-up.

### Track R: the rulebook

**R1 Rules live in `.codetrellis/rules/*.yaml`.**
- The schema and a loader, with errors in words.
- One file per suite.
- SQLite keeps an index and breaches only.
- Today's `config.json` rules keep working until a person confirms the
  move, which the Rules section offers.
- `list_rules` and `check_conformity` read the new files.

Done when:
- old and new formats load;
- the move is a confirmed action with a test;
- design §3.1 matches.

**R2 CI judges with the base branch's rules.**
- `codetrellis check` reads the rulebook at the merge base.
- It compares the base and branch rulebooks, and reports each change as
  loosen, tighten or neutral.
- `.codetrellis/rules/` is no longer ignored as "the plan changing".

Done when:
- a test pull request that removes a rule and adds its breach fails;
- one that only tightens passes with a warning.

**R3 A person's approval, signed.**
- In the app, every rule change previews its effect against the code
  (forbidden, allowed, breaching today), then is confirmed.
- `propose_rule` (MCP) makes an inbox proposal. Agents cannot apply one.
- A confirmed loosening is signed with the device key (namespace
  `codetrellis-rule-change`). CI verifies it with the base branch's keys.
- Every change goes into the record.

Done when:
- a loosening signed in the app passes R2's gate;
- an unsigned or self-keyed one fails;
- a test proves an MCP call cannot apply a rule.

**R4 Strength.**
- `block`, `warn` or `guide` on every rule. The default for new rules is
  `warn`.
- Exit codes by strength: 3 only for `block`.
- `--strict`.
- Signals: high for block, medium for warn, none for guide.

Done when every combination is covered by tests and the CLI docs say it.

**R5 Package rules.**
- Outside imports are kept as package entries (`npm:`, `pypi:`, `go:`,
  `cargo:`, `maven:`, `nuget:`, `gem:`, `composer:`, `swift:`) at the point
  imports are collected, for all eleven languages.
- `kind: package` with `only` and `except`.

Done when the Stripe example (design §3.1) blocks a stray import in a TS
fixture and in one other language.

**R6 Symbol rules.** `kind: symbol` reads `imports.specifiers`, following
re-exports, to say who may import a named export.

Done when:
- `createCharge` imported from outside `only` breaches;
- importing it through a barrel file also breaches.

**R7 Call rules.** `kind: calls` over callsite data: an HTTP host or path,
a subprocess command, a SQL table, an env var. Normalised with
`callsites/shared.ts`.

Done when a direct `fetch('https://api.stripe.com/…')` outside
`src/payments/` breaches, in TS and Python fixtures.

**R8 Folder rules.** `kind: folder`: file name patterns, one export per
file, and allowed file kinds, plus `guide` prose.

Done when this repo's `services/*-service.ts` convention can be written
and checked.

**R9 Guide rules in scope.**
- `get_brief`, the Brief and `codetrellis brief` list the rules covering
  the task's files, guides included.
- The awareness `drift` signal names a rule when drift crosses one.

Done when a task touching `src/payments/` shows the payments suite in its
brief.

**R10 This repository's own rulebook.** Added by the owner (2026-10-07),
who deferred agent review in this repo's CI: on a public repository a pull
request's code can read the repository's secrets, so architecture here is
held by deterministic rules first.
- `.codetrellis/rules/` for this repository, written from what CLAUDE.md
  already says: the frontend, backend and shared layers, the native and
  peer packages each kept to the module that wraps it, and the services
  folder's naming.
- Every rule measured against today's code first. A breach is either a
  real exception, written into the rule with why, or counted debt in
  `baseline.yaml`, which may only fall.
- No AI and no secret: `ci.yml`'s conformity step already runs `codetrellis
  check` on every pull request.

Done when a pull request that breaks one of the rules fails that step.

### Track C: checks anywhere

**C1 Scoped checks.**
- `check --suite`, `--rule` and `--path`, on the CLI.
- The same scopes on `check_changes`, `check_conformity`, and the REST
  route the Rules view uses.

Done when:
- each scope selects exactly its rules, by test;
- `codetrellis check --suite payments` runs locally and in CI.

**C2 SARIF and recipes.**
- `--format sarif` (2.1.0, validated against the schema in a test).
- Recipes for GitLab CI, Azure Pipelines, Bitbucket Pipelines and Jenkins.
- This repo's CI uploads it.

No CI host comes first (the owner, 2026-10-06). The recipes are examples
for GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines,
Jenkins, and a plain shell script any runner can call.

Done when:
- the SARIF validates;
- GitHub shows a breach on the changed line in a test pull request;
- the shell recipe runs unchanged in a second, non-GitHub runner (a GitLab
  CI job is enough).

**C3 Debt ratchet.**
- `codetrellis rules baseline` records the existing breaches per rule.
- `check` fails on new ones, and reports the count falling.
- The baseline file may only shrink.

Done when:
- adding a breach fails;
- fixing one passes and lowers the count;
- raising the baseline fails.

**C4 Agent checks, locally: the orchestrator.** `codetrellis review`,
designed in AGENT-CHECKS-AND-REVIEW §1:
- `--endpoint`, `--model`, `--auth env:VAR | oidc:<provider>`;
- `--skills <dir>`;
- the same scopes as `check`.

The orchestrator assembles the bundle, runs passes (each an isolated
session with one skill and one scope), checks citations, and records the
run.

Every pass runs under the contract (§1.2 there):
- tools are an allowlist: read, search, list, and CodeTrellis's `read`
  tools — no shell, network, write or ask;
- it must end by calling `report`;
- budgets on turns, tokens, time and tool calls;
- untrusted text is passed as data;
- refused calls are recorded.

The outcome is `pass`, `findings`, `inconclusive` or `error`.

Done when:
- it runs through the first agent CLI adapter on the user's own model and
  key, with the CLI held to a deny-by-default tool set (AGENT-CHECKS-AND-REVIEW
  §1.4);
- for a bare OpenAI-compatible endpoint, an existing open-source runner
  that meets the contract is chosen, or the log says why none fits (a
  local stub endpoint in tests);
- a pass that asks a question yields a `question` finding and the run
  completes;
- a pass that never reports ends `inconclusive` after one retry;
- a pass that exhausts its budget ends `inconclusive: budget`;
- a finding citing lines not in the diff is dropped and counted;
- a prompt-injection fixture cannot make it run a command, reveal an
  environment variable, or call a tool off the allowlist (the attempt is
  recorded).

**C4b Bring your own agent, locally.**
- `get_review_bundle` gives an interactive agent the same bundle.
- `report_review` takes the same schema.
- The orchestrator verifies the citations either way.
- Both tools get `read` in `TOOL_CAPABILITIES`, and tests.

Done when Claude Code, connected through the stdio connector, reviews a
fixture change and its grounded findings land as a check run.

**C5 Agent checks in CI.**
- The same command in CI.
- The optional verify pass: a second agent tries to refute each finding.
- Output is host-neutral (SARIF, markdown, JSON). Posting comments is
  optional, through the review-host adapters that exist (GitHub, GitLab,
  Bitbucket), with a token the model never sees.
- OIDC to Bedrock, Vertex and Azure.
- Recipes. A cost dial: auto, on request, off.

Done when this repo runs it on a pull request beside `claude-review.yml`,
advisory.

**C6 Graduation.** Agent-check findings of the same kind twice become a
`propose_rule` at `guide`, through R3.

Done when a repeated fixture finding produces one proposal, not two.

**C7 Check runs are records that travel.** Every check, deterministic or
agent, from the CLI, CI, the app or MCP, is a run. A run records:
- where and by whom;
- the scope;
- the rulebook's commit;
- the outcome;
- its findings and their marks.

With shared task state on, runs are written to `.codetrellis/runs/checks/`
and read after a pull, as test runs are (Phase 32 D1.5a).

Done when a run made in CI appears in a teammate's app after a pull, with
where it ran.

**C8 One renderer.**
- `src/shared/lib/check-words.ts` writes every rule and finding in words.
- The terminal, markdown and SARIF render from it, and the app and phone
  use the same words.
- The terminal layout is AGENT-CHECKS-AND-REVIEW §3.1: grouped by suite,
  the summary first, the fix after →, glyph and word, no colour when not
  a terminal, the exit code in words.

Done when:
- one fixture run renders identically in words in all four formats
  (snapshot tests);
- `NO_COLOR` and a pipe give plain text.

### Track G: graph and clarity

**G1 One visual vocabulary.**
- `lib/visual-language.ts`: every state with its colour token, glyph,
  dash and words, drafted from 0.3.
- Nodes, edges, overlays, the file tree, the plan canvas and the Timeline
  read from it.
- A guard test forbids literal colours in graph components.

Done when:
- the collisions in design §1.3 are gone;
- the guard is green.

**G2 The legend.**
- One component built from G1.
- It lists only the states on screen.
- Hovering highlights the matching nodes and edges.
- It sits on the graph, the plan canvas, the file tree and the Timeline.
- Collapsed state is remembered.

Done when:
- each surface shows it;
- a test proves an entry appears only when its state is drawn.

**G3 Edge toggles.**
- Import edges, cross-system edges and symbol links can each be turned
  off, beside Overlays.
- Remembered per machine.
- `cross_system` gets its own style.

Done when turning imports off removes them from the rendered graph (a
browser test).

**G4 Full screen and back.**
- A toolbar button and a shortcut hide the sidebar, the inspector and the
  plan panel, then restore them as they were.
- Every Allotment pane gets `visible`, so hiding leaves no gap.
- A shortcut for the inspector.

Done when:
- a browser test enters and leaves full screen and the layout matches;
- hiding the sidebar leaves no empty pane.

**G5 The inspector lists plan items.** On selecting a file, the inspector
shows the plans and tasks that touch it:
- grouped by plan;
- each with its status glyph and holder;
- a click opens the task.

Directories and clusters show counts. This no longer waits for "View
source".

Done when:
- a browser test selects a file in a plan's footprint and sees its task;
- clicking opens the plan at that task.

**G6 Opening a plan shows it.**
- `showPlan(uid, { item? })` restores a minimised plan.
- Every caller in design §1.4 uses it; the Brief keeps its exception.
- A test enumerates callers of `setActivePlan` / `fetchPlan` that open a
  plan.

Done when:
- opening the already-active, minimised plan from each place shows it;
- the enumeration test is green.

**G7 The Rules view.**
- A workspace of its own, not Settings: suites, status, breaches, debt,
  proposals and history.
- Making and changing rules goes through R3's preview and confirm.
- Settings keeps only switches.

Done when:
- the owner can make the Stripe rule, see its effect, confirm it, and see
  it in the history;
- `ArchitectureRulesSection` is reduced to switches, or removed with its
  route kept.

**G8 Rules on the graph.**
- A Rules overlay draws breaches in G1's breach style.
- The inspector lists the rules covering the selected file.
- "Show this suite" fades the rest.

Done when a breaching import is drawn and named on the graph, and the
legend explains it.

**G9 The Checks view.** One workspace with the Rules view, in two tabs:
the rules, and what the checks say.
- Run any check at any scope, deterministic or agent.
- The runs, from anywhere, marked with where they ran.
- Open a run.
- Compare two runs: new, fixed, unchanged.

Done when:
- the owner runs the payments suite from the app and sees the same
  findings the CLI printed;
- a CI run appears beside it.

**G10 Findings where the code is.**
- The graph: the breaching edge, and a mark on nodes with findings.
- The code: gutter marks in CodePreview and the diff view, with the
  finding on hover.
- The inspector: rules covering the file and its open findings, beside G5's
  plan items.
- The brief: the latest run over the task's files.
- The phone: runs that block or ask, in Needs you.

Done when a single finding can be reached from each of those places, and
each place links to the others (browser tests).

**C9 A review on your device counts on the pull request.** Added by the
owner (2026-10-07). It is the second way to run agent review, beside C5's CI
token, for repositories that will not hold a secret.
- A review run on the developer's own device, by any agent. That means
  `codetrellis review` on their own login, or Cursor, Codex, Claude Code or any
  MCP client through `get_review_bundle` and `report_review`.
- It is signed with their device key, the same Ed25519 key as rule approvals
  (`.codetrellis/keys/`), after the findings are checked. The signing is done
  by CodeTrellis, never by the agent.
- It is pushed as a git note, so it changes neither the commit nor the diff.
- CI reads it, verifies the key against keys already on the base, and checks
  that it is for the head commit. A forged review says so, and so does a review
  of an older commit. CI shows the findings as a check and on the changed
  lines, with no secret and no AI.

Done when a review made in Cursor on one machine shows on the pull request in
CI, a forged one is refused, and a push after the review makes it stale.

### Track B: building blocks (the owner, 2026-10-07)

The design is [BUILDING-BLOCKS.md](BUILDING-BLOCKS.md). Every block is YAML
beside the code, explained in words wherever it reports, and runs in every
place a check runs.

**B1 Matchers.** `match: exact | glob | regex | fuzzy` on every rule target:
packages, call hosts and paths, SQL tables, export names, folder names and grep
text. The defaults stay as today.
Done when `http:*.stripe.com` catches `api.stripe.com` and `files.stripe.com`,
a regex target holds, and every existing rule reads as before.

**B2 Grep rules.** `kind: grep` with `in`, `except`, and `mustNot` or `must`.
- `mustNot` reports the lines a change adds that match.
- `must` reports each file in scope that never matches.
- Baselined like any rule.

Done when a `console.log` added to the backend is reported at its line, and an
old one already in the file is not.

**B3 Fuzzy matching.** A deterministic similarity score over normalised
names, with a `threshold`. It says what a name was close to, and how close.
Done when `npm:reqeusts` is reported as 0.88 like `npm:requests` (the draft
said 0.93, a number made up before the measure was chosen), the same way
on every run.

**B4 Your own patterns.** `.codetrellis/patterns/*.yaml` turn source into
entries, by a matcher, with `is`:
- an HTTP or SQL call;
- or a kind of entry of the team's own, such as `queue:`, `event:` or `flag:`.

The entries go through the same normalisation as the built-in extractors, and
reach rules, the cross-system map and reviews.
Done when `paymentsClient.charge()` is caught by a calls rule on
`api.stripe.com`, and a rule holds `queue:orders.*`.

**B5 Engine per rule.** `engine: deterministic | fuzzy | agent`, independent of
`strength`.
- An agent rule is words, sent to the review in its bundle.
- With no review configured, it is a guide.
- It blocks only when its owner sets `block`.

Done when an agent rule reaches the bundle, a finding citing it is held to the
contract, and it does not block at `warn`.

**B6 Pipelines.** `.codetrellis/pipeline.yaml`:
- `stages`, each with `rules` selected by suite, engine, strength, id or tag;
- `parallel`, `needs` and `when`;
- `grounding`, which gives a stage the findings of the stages it names.

`codetrellis check --pipeline` runs it all, and `--stage <id>` runs one. Each
stage is a check run. The file is under change control.
Done when a three-stage pipeline runs with one stage in parallel, its agent
stage's bundle carries the earlier stages' findings, and removing a stage is
refused as a loosening.

**B7 Docs for the blocks.** A Building blocks section in
`docs/claude/rules.md`, with a worked example per block, and
`docs/recipes/pipeline.sh` with its CI variants.
Done when each example in the docs is a test.

### Track V: review (the owner chose V1, V2, V3 and V6, 2026-10-06)

Designed in AGENT-CHECKS-AND-REVIEW §2. Each feature must be useful on a
pull request with no plan behind it: "a bit of meat to the bones" (the
owner).

- **V1 What this change does to the architecture.** A structural diff at
  the top of the review: imports between folders, new packages, new
  cross-system calls, rules touched.
  Done when a fixture change's review names each.
- **V2 Review in order of risk.** Files ordered by dependents, rule scope,
  test grounding and other work, each with its reason.
  Done when the order is stable and explained in a test.
- **V3 Re-review only what changed.** Each reviewer's last commit is
  remembered; later pushes show only what moved, and which findings a push
  addressed.
- **V6 Did it do what the task said.** Criteria results and planned
  against actual footprint in the review, only when the change is linked
  to a task. Without one, the section is absent.
  Done when a linked fixture shows both and an unlinked one shows neither.

### Stage Z: close

**Z1 Docs.**
- `docs/claude/rules.md`: the rulebook, change control and checks.
- `cli.md` and `mcp-tools.md` updated.
- The CLAUDE.md security rules gain the change-control rule.

**Z2 Phase review.** The owner walks the outcomes in the design doc on a
packaged build. Anything that falls short becomes a step or a follow-up.

**Z3 Into `main` and release.** Bring `main` in, run everything, verify a
packaged build, follow `docs/releases/RUNBOOK.md`.

---

## 4. Refinements

When a step is refined before it starts, the refinement goes here, dated,
with the owner's decision if one was needed.
