# Phase 29 — Surfacing what we already collect

> Opened: 2026-09-18. **Living register — add to it.**
> Audit method and findings are in §2; the work items are in §4 and are
> ordered. Tick them off in place.

---

## 1. Why this phase exists

Phases 20–28 spent their time on a single failure mode: **a confident
picture with something missing from it.** Ruby declared and unparsed. A
watcher list that had gone stale. Nested symbols written and never read.
A highlighter naming six grammars it did not have.

Every one was the same shape — two things that had to agree, and nothing
checking that they did. The fix each time was structural: derive the
second list from the first, or assert they match in a test.

This phase is that same audit pointed at the **last hop**: the backend
computes something, stores it, serves it — and no part of the interface
reads it. The data is right. Nobody can see it.

That is not a smaller problem than the others. A number that is correct
and invisible is worth exactly as much as a number that was never
computed, and it costs more, because it looks done.

## 2. The audit, and how to redo it

Run these when adding to this register. They are cheap and they are what
produced §4.

**Endpoints the frontend never calls.** 26 of 172, at the time of
writing:

```bash
grep -oE "app\.(get|post|put|patch|delete)\('/api/[^']+" src/backend/server.ts \
  | sed "s/.*'//" | sort -u > /tmp/eps.txt
while read ep; do
  stem=$(echo "$ep" | cut -d: -f1 | sed 's#/$##'); short=${stem#/api}
  grep -rqF "$stem" src/frontend/ || grep -rqF "$short" src/frontend/ || echo "$ep"
done < /tmp/eps.txt
```

**Mind the bridge.** The frontend calls through `src/frontend/bridge/`,
which uses `${API_BASE}/project/scan` — no `/api` in the literal. A grep
for the full path alone reports false positives. The loop above checks
both spellings; the first version of this audit did not and wrongly
listed `/api/project/scan` as dead.

**Mind the `:params` — this one bit.** `cut -d: -f1` turns
`/api/plans/:uid/budget` into `/api/plans/`, which matches almost
anything in the frontend. **Every parameterised endpoint was silently
excluded from the first run of this audit**, and that is how the
register initially missed `/api/plans/:uid/budget`,
`/api/plans/:uid/review`, `/api/plans/:uid/pr-draft`,
`/api/plans/:uid/next-task` and `/api/plans/:uid/file-status` — five
endpoints, two of them built in Phase 25. A check that passes for the
wrong reason, which is the exact bug class this whole run keeps finding,
committed inside the tool built to find it.

The second pass matches the endpoint's **last literal segment** instead:

```bash
while read -r ep; do
  last=$(echo "$ep" | tr '/' '\n' | grep -v '^:' | grep -v '^$' | grep -v '^api$' | tail -1)
  grep -rqiE "[\"'\`/]$last[\"'\`?/)]" src/frontend/ || echo "$ep"
done < /tmp/eps.txt
```

**Neither version is trustworthy on its own.** The second over-reports
(`claim` and `unlink` appear in the frontend for unrelated reasons) and
under-reports (a segment mentioned only in a *comment* counts as a use —
including, comically, the comments written by this phase). So:

> **Run both, take the union, and confirm each hit by hand.** The audit
> narrows 172 endpoints to about 30 candidates; it does not decide.

**Tables with no reader.** Crude but a useful starting point — cross-check
by hand, since the UI reaches tables through endpoints, not names:

```bash
grep -oE "CREATE TABLE IF NOT EXISTS [a-z_]+" src/backend/services/db-schema.ts \
  | awk '{print $NF}' | sort
```

**Some of this is deliberate.** Agents are a first-class consumer of this
product; an MCP-only surface can be a design choice rather than an
omission. Every item below says which it is believed to be, and an item
whose answer is "ask" says so instead of assuming.

## 3. UX rules for this phase — these are the point

Everything here adds information to an interface that is already dense.
The failure mode is obvious and it is worse than the gap being fixed:
**turning a clean graph into a wall of caveats.** So:

- **Quiet by default, loud on demand.** A count in the status bar that
  opens a panel. Never a banner, never a modal, never red unless
  something is actually wrong. "14 endpoints have no caller" is
  information, not an error.
- **Match the existing register exactly.** `glass-panel`, `text-[10px]`,
  `text-foreground-subtle`, the semantic tokens (`bg-success`,
  `bg-warning`, `bg-danger`), lucide icons at 10–12px, `gap-1.5`. A new
  surface that is visually louder than `StatusBar` is wrong however
  useful its content.
- **Say what it means, not what it counts.** "41 of 58 imports resolved"
  is a number. "17 imports we could not resolve — Swift files in a module
  import each other implicitly, so this is expected" is an answer. Where
  the reason is knowable, give it.
- **Never imply a defect we cannot substantiate.** An unresolved import
  in Ruby is Rails autoloading working normally. Presenting it as a
  problem would be the same over-claim this phase exists to remove.
- **Empty states are content.** "No unresolved imports" earns its space
  once; a panel that renders blank does not.
- **Dark theme first, and check both.** The app is dark-themed; anything
  added is read there first.

## 4. The register

Status: ☐ not started · ◑ in progress · ☑ done · ⊘ ruled out

### 4.1 ☑ Coverage: what links inside the project, and what does not

**Already computed and served.** `/api/stats` returns `importCount` and
`resolvedImports`. `/api/cross-system` returns `callsiteCount`,
`routeCount`, `edgeCount` and `byProtocol`. Neither endpoint is called by
the frontend.

Measured on the test fixture: 34 callsites extracted, 12 cross-system
edges drawn, and of 22 routes the scan knows these services expose,
**8 have a caller in the repo and 14 do not.**

Why it matters more than the raw numbers suggest: several resolvers
*correctly* refuse to guess. Swift files inside a module import each
other with no import statement at all. Rails autoloading writes no
requires. C# `using` names a namespace, not a type. Each refusal is
right, and each renders identically to "this code is not coupled".
**"We could not tell" and "there is nothing there" are currently the
same picture.**

- *Shipped*: `StatusBar` chip (`32/71 linked`) opening a panel that
  breaks it down by language **with the reason**, plus a cross-system
  section. `services/coverage-service.ts`, `/api/coverage`,
  `frontend/lib/coverage.ts`, `components/layout/CoverageChip.tsx`.
- *Deliberate?* No. The stats were built for a UI that never read them.

**[changed] It needed a new endpoint, and the framing was wrong first
time.** Two corrections worth carrying forward:

1. *Wiring the existing endpoints was not enough.* `/api/stats` gives
   totals only, and a bare total is not an answer — "41 of 58" invites
   "is that bad?" and cannot reply. The REASON for a gap is a property of
   the language, so the split had to come from a new query.
   `/api/coverage` exists for that.
2. *"Unresolved" was the wrong word, and the numbers proved it.* The
   first cut led with `resolved / total`, which reads **45%** on the
   fixture and looks like a badly broken scan. Nothing is broken: C#
   imports `System`, Go imports `net/http`, Python imports its standard
   library. Those were never going to resolve to a file in the scan —
   external **by definition**, not failures. Calling them unresolved was
   exactly the over-claim §3 forbids, committed by the person who wrote
   §3.

   It now reports how many imports link to a file *inside this project*
   and describes the rest as pointing outside it. Same number, truthful
   framing, and the ratio becomes genuinely interesting — roughly "how
   self-contained is this codebase" — rather than a score.

   The e2e test records this: it asserts that **every** language has some
   outward-pointing import, so if that ever stops being true somebody
   re-reads the framing.

   We deliberately do **not** claim to know which outward imports are a
   standard library and which are something we failed to read. The
   resolver returns null either way and nothing records the difference.
   Asserting it would repeat the same mistake one level down.

### 4.2 ☑ Near-miss callsites

A call to `/api/ledger/42` cannot pair with a route declared
`/api/ledger/:id` — 42 is a value, `:id` is a pattern. The matcher has no
fuzzy fallback, which is **correct for drawing an edge**: a wrong edge is
worse than a missing one, and `cross-system-service` says so in its own
comment.

But "we saw a call that looks like this route and could not confirm it"
is exactly what a person wants to know, and it can be shown as a
suggestion without becoming a line on the graph.

- *Shipped*: `findNearMisses` in `coverage-service.ts`, surfaced in the
  §4.1 panel under a **dashed** rule with "looks like the same
  endpoint", the differing segment shown, and both files named.

**The rule is strict, not fuzzy — that is the whole design.** A pairing
is suggested only when: same method, same segment count, every segment
equal except exactly one, and at that position the **route** holds a
parameter while the **call** holds a concrete value. Two differences, or
a difference where neither side is a parameter, is two different
endpoints. The asymmetry is deliberate: a call written `/api/x/:id`
against a route serving `/api/x/current` is not the same shape.

Eleven unit tests, seven of which assert cases it must **refuse** — that
is where the risk is. A suggestion the reader has to double-check is
worth less than no suggestion, and anything looser starts to undermine
the exact matcher it sits beside.

Capped at 25. A panel is not a report.

The fixture now contains a deliberate near miss — the Kotlin client calls
`/api/ledger/42` while the C# side serves `[HttpGet("{id}")]` — and the
e2e asserts both that it is suggested and that it **never becomes an
edge**.

### 4.3 ☑ Budget burn-down (Phase 23)

`item_time_entries` and `plan_budgets` are built, tested, and reachable
only through MCP. No burn-down in the plan header, no forecast, no
warning as a ceiling approaches.

Note the posture already set in `db-schema.ts`: **a ceiling is advisory.**
"We have no mechanism to halt an agent, and pretending otherwise would be
worse than honest advice." The UI must not imply enforcement it cannot
deliver.

- *Shipped*: `components/plan/v2/PlanBudgetChip.tsx`, beside the git
  context chip, plus `frontend/lib/budget-format.ts` for the logic.
- *Deliberate?* No — the phase shipped backend-first and the UI was never
  built.

**Three things that had to survive contact with the UI**, each a place
where the obvious implementation says something false:

1. **An unknown cost is not zero.** `spentCostUsd` is null when no agent
   on the plan ever reported a model. Rendering "$0.00" would report a
   plan as free when its cost is simply invisible to us. It reads "not
   reported", and the popover says why.
2. **An unknown cost cannot breach a cost ceiling.** With a cost budget
   and no priced spend there is nothing to compare, so the state is
   `none` — not `ok`, which would claim the plan is comfortably inside a
   budget nobody has measured it against.
3. **An early forecast is not a forecast.** The service returns null
   below 10% completion on purpose. The popover says it is too early
   rather than rendering a blank the reader has to interpret.

**No enforcement, said out loud.** `db-schema.ts` sets the posture where
the table is defined — *"we have no mechanism to halt an agent, and
pretending otherwise would be worse than honest advice."* So there is no
stop control, no enforce toggle, and the popover states in words that
passing a ceiling changes nothing by itself.

**A drift guard.** The chip computes state from a report it already has
rather than making a second call for a string, so `stateOf` duplicates
`budgetState`. A unit test asserts the two agree across nine cases and
that the 80% warn boundary is the same number on both sides — otherwise
the chip turns amber at a different point from where the service fires
its one-time warning.

### 4.4 ☐ External sync state (Phase 24)

`external_sync_state`, `external_refs` and `plan_external_refs` know which
linked tickets have drifted from the plan. The "3 tickets need updating"
signal exists as data and appears nowhere.

- *Shape*: a chip on the plan header, opening a list with per-ticket
  last-synced state.
- *Effort*: small.
- *Deliberate?* No.

### 4.5 ☑ `/api/auto-detect` — open what the agent is already working on

Scans `~/.claude/sessions` and returns each active session's project path
and branch. Read-only, already working, never called.

Opening CodeTrellis to "Claude Code is working in `~/foo` on `bar` —
open it?" is the kind of thing that makes a tool feel like it is paying
attention. This is the highest polish-per-hour item in the register.

- *Shipped*: `components/ActiveAgentProjects.tsx`, above Recent projects
  on `WelcomeScreen`. A live pulse, the project name, its branch, its
  path, and a click to open it.
- *Deliberate?* Unlikely — more probably it predates the current
  onboarding screens.

**[changed] No dismiss button.** The register sketched one and it is not
needed: this screen only exists while no project is open, so opening
*anything* dismisses it — which is the action the suggestion is asking
for anyway. A dismiss control would have added persisted state to remove
a row that the next click removes.

**It polls, every 5s.** An agent starting *while* this screen is open is
arguably the commonest case — a developer launches the agent and then
goes looking for the visualiser — and a one-shot fetch would show an
empty screen through exactly the moment the suggestion is most useful.

**A live project is filtered out of Recent projects.** The live row says
strictly more and offers the same action; listing it twice is clutter.
The empty-state pitch is also suppressed when a suggestion is present,
because an onboarding explainer above a live signal reads as if nothing
is happening.

The e2e is mostly about **liveness**: a suggestion to open a project
because "an agent is working there" is worse than no suggestion if the
agent exited an hour ago. Five tests — a live pid is reported with its
branch, a dead pid is not, a vanished directory is skipped, two sessions
in one directory are reported once, and one malformed file does not take
the endpoint down.

### 4.6 ☐ Doc drift sensor

`/api/sensors/doc-check` reports whether system docs have drifted from the
code they describe. That is a clarity feature outright, and it is
invisible.

- *Shape*: a per-doc marker in `SystemDocsPanel`, which already exists.
- *Effort*: small.

### 4.7 ☐ Snapshot comparison (Phase 25)

`/api/comparands` and `/api/compare` — pick two points in the project's
history and diff the architecture between them. Built in Phase 25, MCP
and REST only.

- *Shape*: a comparand picker feeding the existing `CodeDiffView`, which
  Phase 26 already built.
- *Effort*: medium. The viewer exists; the picker does not.

### 4.8 ☐ Plan / item / document version history

`plan_versions`, `plan_item_versions` and `plan_document_versions` — three
tables of history with no timeline to read them.

This is the largest latent **feature** in the register rather than a
polish item, and it should be sized as one rather than smuggled in here.

- *Effort*: large. Needs its own design.

### 4.9 ☐ Manifest conflicts

`/api/conflicts` and `/api/conflicts/resolve` — detection *and* a resolve
path, both unreferenced by the UI.

- *Effort*: medium.
- *Deliberate?* **Ask.** Conflict resolution may be intentionally an
  agent-driven flow.

### 4.10 ☐ Plan templates

`/api/plan-templates`, `/api/plans/from-template`, and
`/api/plans/:uid/publish-as-template`. Supports built-ins plus project-local
and user-global templates from `.codetrellis/templates/`. A complete
authoring feature, MCP-only.

- *Effort*: medium.
- *Deliberate?* **Ask.** Plausibly an agent-first feature by design.

### 4.11 ☐ Update download progress

`/api/updates/download`, `/api/updates/download/status` and
`/api/updates/download/cancel`. The UI can check for an update but cannot
show the download or cancel it.

- *Shape*: progress in the existing update affordance.
- *Effort*: small.

### 4.12 ⊘ `symbols.parent_symbol_id`

Left deliberately. Phase 27 made the flat qualified form the contract, so
this column is always NULL in practice. Reading the tree back is a real
product change — expandable file symbol lists, per-file counts that jump —
and belongs in its own phase, not here. Recorded so the next reader knows
it is a decision and not an oversight.

### 4.13 ☐ Phase 25 has no interface at all

Found by the corrected audit in §2, not the first one.
`/api/plans/:uid/review` and `/api/plans/:uid/pr-draft` join
`/api/comparands` and `/api/compare` (4.7): **the entire Phase 25 review
surface is MCP and REST only.** Plan↔PR review, the rendered review
markdown and the PR draft are all built, tested and unreachable from the
application.

- *Effort*: medium, and it should be sized as one piece with 4.7 rather
  than four separate wirings.

### 4.14 ☐ `next-task` and `file-status`

`/api/plans/:uid/next-task` answers "what should be worked on next" and
`/api/plans/:uid/file-status` gives a file's standing against a plan.
Both are plausibly agent-first by design — but "what's next" is also the
question a human opening a plan asks.

- *Deliberate?* **Ask.**

### 4.15 — add here

Re-run §2 after any phase that adds a service or an endpoint.

## 5. Done when

- Every item is ticked, ruled out with a reason, or has an owner's answer
  recorded against the "ask" ones.
- No surface added here is louder than `StatusBar`.
- The §2 audit is part of what gets run when a phase adds an endpoint, so
  this register does not silently refill.
