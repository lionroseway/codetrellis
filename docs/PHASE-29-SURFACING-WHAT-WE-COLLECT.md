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

**Endpoints the frontend never calls.** 26 of 172 by this grep — **and
that number is too low.** See the note on unrendered components below
before trusting it; §4.15 found ten more that this pass reported as
surfaced.

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

**Mind what a grep can prove.** Both loops answer "does this path appear
in a file under `src/frontend/`". That is not the same question as "can
a user reach this". A component that nothing imports still contains its
`fetch` calls, so its endpoints match — and §4.15 found **eight files
with no exported symbol referenced anywhere**, between them making ten
endpoints look surfaced that nobody could reach. One of them,
`AgentPanel`, had a whole phase of work done inside it after it was
already unreachable.

No grep over endpoint paths can see this. `npm run test:unit` can:
`src/frontend/components/reachable.test.ts` fails when a component is
not referenced by anything. **Run it alongside the two loops above** —
an endpoint is surfaced only if the file calling it is on screen.

**Mind the other client.** Both loops grep `src/frontend/` only, so
"unsurfaced" here means *unsurfaced on desktop*. `mobile/` is a full
second client and it is ahead of desktop in places — §4.10 was filed as
"MCP-only" when mobile had shipped a templates screen two phases
earlier. Before calling something unsurfaced, grep `mobile/` too; the
answer changes what the item is (a missing feature vs. desktop lagging
its own mobile companion) and often tells you what the surface should
look like, because one already exists.

**Some of this is deliberate.** Agents are a first-class consumer of this
product; an MCP-only surface can be a design choice rather than an
omission. Every item below says which it is believed to be, and an item
whose answer was "ask" said so instead of assuming.

**Answered, 2026-09-18.** All three "ask" items — plan templates (4.10),
`next-task` / `file-status` (4.14) and manifest conflicts (4.9) — are
**gaps, not design decisions**, and are to be surfaced. Version history
(4.8) is wanted too. `subprocess` / `env_lookup` stay as they are for
now, neither built nor deleted.

**The goal is an empty register.** What remains at the end should be only
the items that genuinely need a developer machine — the Swift grammar
rebuild and anything requiring a packaged build — so that cleanup is a
short, known list rather than an open question.

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

### 4.4 ☑ External sync state (Phase 24)

`external_sync_state`, `external_refs` and `plan_external_refs` know which
linked tickets have drifted from the plan. The "3 tickets need updating"
signal exists as data and appears nowhere.

- *Shipped*: `components/plan/v2/PlanTicketSyncChip.tsx`, beside the
  budget chip, plus a new `GET /api/plans/:uid/external-sync`.
- *Deliberate?* No.

**[changed] There was no REST endpoint to wire.** The register assumed
this was a wiring job; `getSyncState` existed but was reachable only
through the `get_external_sync_state` MCP tool, so the endpoint had to be
added first.

**No "sync now" button, and there never will be.** CodeTrellis holds no
tracker credential — that is the settled Phase 24 posture, and the agent
holding the Jira or Linear MCP does the writing. A sync control would be
an affordance for something this process cannot do. The popover says so
and points the reader at their agent.

The suggested transition is advisory for the same reason the service
gives where it computes it: every tracker has its own workflow, and
guessing transition names here would be inventing one we cannot see. It
renders as "probably wants", never as an instruction.

**Never synced is not a backlog.** A null watermark means everything with
a ticket key counts as changed, which is the correct first run. The chip
reads "not synced yet" rather than reporting a drift count that would
look like accumulated debt.

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

### 4.6 ⊘ Doc drift sensor — **already surfaced; this item was wrong**

Ruled out on inspection, and worth recording as a **mistake in the
register rather than a gap in the product**.

Doc drift *is* visible: `SystemDocsPanel` renders a `FreshnessDot` per
doc, the detail view shows `changedReferencedFiles`, and
`/api/system-docs/:uid/freshness` is called for it.

`/api/sensors/doc-check` is a different thing — the **sensor bridge**,
which posts channel events for stale docs. It returns
`{ staleCount, eventsSurfaced }`, not a report to display. It is a
background action, and nothing in the UI should be calling it.

The error was reading "endpoint with no frontend caller" as "capability
with no surface". §2 warns that the audit narrows candidates and does not
decide; this is what happens when that warning is not followed.

### 4.7 ☑ Snapshot comparison (Phase 25) — shipped with 4.13

`/api/comparands` and `/api/compare` — pick two points in the project's
history and diff the architecture between them. Built in Phase 25, MCP
and REST only.

- *Shipped as one piece with 4.13* — `components/plan/v2/PlanReviewPanel.tsx`.

### 4.8 ☑ Plan / item / document version history — **sized wrong; see §5**

`plan_versions`, `plan_item_versions` and `plan_document_versions` — three
tables of history with no timeline to read them.

Filed as the largest latent **feature** in the register. It was not,
and the estimate was wrong because it counted three tables without
checking what each one was for. One was already surfaced, one is
history of a model the product replaced, and only the third needed
building. §5 has the sizing and the design decisions.

- *Effort*: **small**, not large. **Done** — `PlanVersionHistory.tsx`,
  reached from a **Revisions** chip in the plan header.

### 4.9 ☑ Manifest conflicts

`/api/conflicts` and `/api/conflicts/resolve` — detection *and* a resolve
path, both unreferenced by the UI.

Shipped as `components/plan/v2/ManifestConflictBar.tsx`, mounted under
`FreezeBar` in the plan workspace and shaped after it for the same
reason: project-level state, absent almost always, blocking when
present. It renders **nothing at all** unless `hasConflicts` — no
placeholder, no "0 conflicts" chip. Red rather than amber, because
unlike a freeze this is not a policy the user chose.

It surfaces both resolution paths, because they answer different
questions: per-field for a manifest where the two sides disagree about
`status` and `owner` independently, whole-side for everything else. The
service can only parse fields for YAML and JSON with both sides
parsing, so `fields: null` is rendered as a sentence explaining that,
rather than an empty list that would read as "no differences".

`useWebSocket`'s `plan-file-conflict` toast said *"Resolve in your
editor"* — the only honest advice at the time. It now points at the bar.

Two things found while wiring it, both about a control being asserted
rather than held:

- The comment above `resolveFileConflict` claimed field-level and
  whole-side resolution "both call in here for their path".
  `resolveFileConflictBySide` does not — it goes straight to
  `git checkout`. It now confines its own path, and the comment says
  what is actually true.
- **Measured, not assumed**: `git checkout -- ../outside/x` fails with
  "is outside repository", so the by-side path was never exploitable.
  What was wrong was the *shape* of the answer — a refusal came back as
  a 200 carrying `resolved: false`, and the field-level path's
  `ConfinementError` escaped the route as a 500. Both now refuse with
  403. That only started mattering when this endpoint got a UI that has
  to tell "refused" from "failed".

`tests/e2e/manifest-conflicts.test.ts` drives a **real** merge conflict
rather than a file with markers pasted in — `detectManifestConflicts`
returns early unless `.git/MERGE_HEAD` exists and git reports the file
as unmerged, so a fabricated conflict would skip the code that actually
runs. Verified to fail with the confinement removed.

- *Effort*: medium. **Done.**

### 4.10 ☑ Plan templates

`/api/plan-templates`, `/api/plans/from-template`, and
`/api/plans/:uid/publish-as-template`. Supports built-ins plus project-local
and user-global templates from `.codetrellis/templates/`. A complete
authoring feature, MCP-only.

Filed as "MCP-only". That was half right and the half it got wrong is
the interesting half: **mobile shipped this in Phase 22**
(`mobile/app/plan-templates.tsx` — list, placeholders, create, plus
plan-file import). The gap was desktop-only, and both ends of it were
already scaffolded and left dangling:

- `PlanListView` had a `<Layers>` button whose entire behaviour was a
  toast reading *"Template picker coming soon — use MCP
  create_plan_from_template for now."*
- `PublishTemplateModal.tsx` was **written in Phase 13 and never
  imported by anything** — a complete, working component with no mount
  point. Its own success toast says *"Available in 'From template' next
  time"*, referring to a picker that did not exist.

So this was one loop with both ends cut, not two separate gaps.

**What was genuinely unreachable is not the built-ins.** It is
`source: 'project'` and `source: 'user'` — templates loaded off disk
from `<project>/.codetrellis/templates/` and `~/.codetrellis/templates/`.
A team could publish one over MCP and then have no way to see it. That
is why the picker groups by source and says where each group lives: a
project template is a team convention that travels in git, and it reads
differently from a built-in.

Shipped:

- `components/plan/PlanTemplatePicker.tsx` — modal off the existing
  `<Layers>` button. Groups project → yours → built-in, each with a
  one-line note on where it comes from. Selecting expands title +
  placeholder fields inline; creating opens the new plan.
- `PublishTemplateModal` mounted as a **Save as template** chip in the
  plan header, next to the budget and sync chips. Gated on
  `!isEmpty` — publishing a plan with no shape produces a template with
  nothing in it, so the chip stays quiet until there is something worth
  reusing.
- `tests/e2e/plan-templates.test.ts` — the publish → list → create round
  trip, which is precisely what the UI does and what nothing covered.
  Built-ins were the only thing tested and also the only thing that was
  ever reachable. Verified to fail on a planted defect (project dir
  dropped from `collectTemplates`).

**This item was wrong until §5 fixed it.** Giving built-in templates a
desktop surface exposed that `applyV1Template` created zero
`plan_items`, so a plan made from any built-in opened on its "this plan
is empty" state with all of its content in tables nothing renders.
Measured at 0 items / 11 docs / 6 phases for `mass-refactor`. See §5 —
it is recorded there because it is not a *surfacing* gap, it is the
template applier and the renderer disagreeing about what a plan is made
of.

**Open product decision — not taken here.** There are now two template
systems and they overlap:

| | Built-in ids |
|---|---|
| `PlanTemplateChooser` (Phase 17.E, client-side, fills the open empty plan) | `refactor`, `new-feature`, `bug-fix`, `dependency-upgrade`, `api-change`, `performance` |
| `plan-templates.ts` (backend, creates a plan) | `from-ticket`, `mass-refactor`, `new-feature`, `bug-fix`, `library-migration`, `perf-pass` |

Only `new-feature` and `bug-fix` share an id, and they are different
content. The UI still cannot offer `from-ticket` (Phase 24's Jira intake
shape) and agents still cannot see `api-change`. Merging them means
choosing which set of six a user who already relies on the chooser
loses — that is a product call, not a wiring one, so it is recorded
here rather than made. They do different things (*fill* a plan vs
*create* one), so coexisting is defensible in the meantime.

- *Effort*: medium. **Done.**

### 4.11 ☑ Update download — **not a small item after all**

Filed as "progress in the existing update affordance". It is not that.

`update-download-service.ts` is **Phase 19, finding 23**. It fetches the
bytes itself, pins the host on *every* redirect hop, and verifies the
file against `SHA256SUMS` plus a detached Ed25519 signature whose public
key ships in the app — deliberately taking GitHub out of the trust chain,
because a digest served by the same place as the file proves the bytes
arrived intact, not that they are ours. A release without a valid signed
manifest is refused outright rather than falling back to the API's digest.

**Nothing ever called it.** Settings offered a bare browser link, so
every update this application has ever shipped was applied **unverified**
while the app carried a complete verified path it never mentioned. That
is a security control that shipped without a way to invoke it — not a
missing progress bar.

- *Shipped*: `components/settings/VerifiedUpdateDownload.tsx` replacing
  the link, plus an `updates:reveal` IPC so the flow can end where the
  service intends (it does not install; on macOS a DMG is revealed and
  the user drags it).
- *Security note*: the reveal IPC takes **no path**. The main process
  reads it from the download service's state, which only ever holds one
  after verification — a renderer-supplied path would have made it an
  arbitrary "open anything in Finder" primitive.
- *Copy discipline*: verification proves **these are the bytes the
  release published**, not that they are trustworthy. The UI says
  "verified against the signed manifest", never "safe".
- *The browser link stays*, labelled unverified. A release without a
  signed manifest is refused by design and that refusal must not become
  a dead end.

### 4.12 ⊘ `symbols.parent_symbol_id`

Left deliberately. Phase 27 made the flat qualified form the contract, so
this column is always NULL in practice. Reading the tree back is a real
product change — expandable file symbol lists, per-file counts that jump —
and belongs in its own phase, not here. Recorded so the next reader knows
it is a decision and not an oversight.

### 4.13 ☑ Phase 25 has no interface at all

Found by the corrected audit in §2, not the first one.
`/api/plans/:uid/review` and `/api/plans/:uid/pr-draft` join
`/api/comparands` and `/api/compare` (4.7): **the entire Phase 25 review
surface is MCP and REST only.** Plan↔PR review, the rendered review
markdown and the PR draft are all built, tested and unreachable from the
application.

- *Shipped*: `components/plan/v2/PlanReviewPanel.tsx`, below
  `PlanDiffPanel` in the plan workspace, reading all four endpoints.

**Two panels, two questions — both worth having.** `PlanDiffPanel`
(Phase 15) reads the plan's own declared intent and asks *"is the code
doing what the plan said?"*. This one compares two **points in time**
and asks *"between these two, what changed, and which of it did any item
claim?"*. The second finds work nobody planned, which is why
`unclaimedChanges` is the headline rather than a footnote.

**The default `before` is `commit:HEAD`, not `baseline`.** `scanProject`
re-pins the baseline on every run, so baseline→live is empty immediately
after a scan — which reads as "nothing changed" at exactly the moment a
user opens the panel. Recorded in PHASE-25 and PHASE-26 already; this is
the third place it has mattered.

**Copy, not "open a PR".** `buildPrDraft` never touches the repository —
the agent does the git and opens the PR with its own credentials. An
"open PR" button would be an affordance for something this process
cannot do, the same over-claim as a sync button on the ticket chip. The
e2e asserts the repository HEAD is unchanged after building a draft.

**A no-targets item is not an untouched item.** An item that declared no
file targets cannot be checked against a diff, so it reads "no targets
declared" rather than being reported as work that did not happen.

### 4.14 ☑ `next-task` and `file-status` — **one was stale, not unsurfaced**

Filed as two endpoints missing a UI. They turned out to be different
problems, and the register's own description of the second was wrong.

**`/api/plans/:uid/next-task` was answering against the wrong table.**
It called `getNextTask`, which read the V1 `tasks` table. The workspace
has written the V2 `plan_items` table since Phase 15, and they are
separate tables with separate writers — so the endpoint returned
`{ none: true }` for **every plan authored in the current UI**. Nothing
caught it because nothing called it: no MCP tool exposes it and neither
client hit the route. Surfacing it unchanged would have shipped a
widget permanently reading "nothing to do" — a surface that looks
broken, which §3 exists to prevent.

`getNextTask` now reads `plan_items` when the plan has any and falls
back to `tasks` when it does not, so a V1 plan keeps its old answer
exactly. Objects are not candidates (they carry no status); `phaseUid`
maps to `parentUid`, because phases became ordinary parent items.

Surfaced as `NextUpStrip.tsx`, under the progress summary. What it adds
over the tree is the one thing a status column cannot show: which
pending Action is *unblocked*. Five pending actions where four wait on
each other look identical in a tree. It distinguishes "nothing pending"
(renders nothing — the completion summary already speaks) from
"nothing **ready**" (amber, with the count waiting). Selection stays on
the server rather than being recomputed in the client, because two
implementations of "what is next" drifting apart is the exact bug class
this phase keeps finding.

**`/api/plans/:uid/file-status` does not give "a file's standing
against a plan".** It reports whether the *plan* is on disk —
`{ linked, planDir }`. It is one third of what `plan-file-service`
calls *the Shared → Local toggle*: a plan either has a directory under
`<project>/.codetrellis/plans/<slug>/`, which goes into git and reaches
the team, or it lives only in the local database. All three endpoints
of that toggle — `file-status`, `export`, `unlink` — had no caller
between them, while `useWebSocket` sat holding handlers for
`plan-exported` and `plan-unlinked`, waiting for events nothing could
cause.

Surfaced as `PlanSyncChip.tsx` in the plan header: **Shared** or
**Local**, click to toggle. Those are the service's own words and they
name the consequence rather than the mechanism — "Exported" would
describe the button, "Shared" describes what changes for the user. The
chip renders nothing when the status is unknown, rather than showing
"Local" on a guess about where someone's work lives.

`tests/e2e/next-up-and-sync.test.ts` covers V2 selection, the
dependency rule, the V1 fallback, and the export/unlink round trip
including that the plan survives unlinking. The V2 tests were verified
to fail against the old V1-only implementation.

- *Deliberate?* **Answered: no.** **Done.**

### 4.15 ☑ Re-run of §2 — **the audit counted files, not surfaces**

Run at the end of the phase on 174 endpoints, both passes, union taken,
each hit confirmed by hand. The first pass produced a list of
candidates. Confirming them produced something bigger, and it
invalidates a number this register has quoted since §1.

**A component that nothing renders still makes its endpoints look
surfaced.** Both §2 passes grep `src/frontend/` for a path. A file
containing `fetch('/api/audio/status')` satisfies that grep whether or
not anything imports the file. Eight files had no exported symbol
referenced anywhere:

| File | Verdict |
|---|---|
| `components/layout/AgentPanel.tsx` | Superseded — see below |
| `components/plan/v2/TeamActivityPanel.tsx` | Never wired → **wired** |
| `components/plan/v2/ContributionPanel.tsx` | Never wired → **wired** |
| `components/plan/v2/PantryPlaceholder.tsx` | Never wired → **wired** |
| `components/audio/AudioCaptureBar.tsx` | Never wired → **wired** |
| `components/pairing/RemotePeersPanel.tsx` | Deferred — pairing is mid-change |
| `components/settings/WebcamQrScanner.tsx` | Deferred — same |
| `lib/spec-doc-types.tsx` | Dead with its model (plan documents, §5) |

Ten endpoints the audit had counted as surfaced were reachable only
through them: `/api/team-activity`, `/api/contributions`, the four
`/api/audio/*` and the four `/api/peers/remote-*`. **So "26 of 172" in
§2 was an undercount**, and not by a rounding error.

#### The worst case: a dead file that keeps getting worked on

`PlanPanel` replaced `AgentPanel` in the same slot — both read
`agentPanelVisible`, both draw the same close button, and `PlanPanel`
has two tabs more. Then **Phase 22 rewrote the agent Timeline to group
tool calls into turns, and wrote that rewrite into `AgentPanel`.**

So the flat raw-payload list Phase 22 existed to replace is what every
user kept seeing, `agent-turns.test.ts` tested logic no interface ran,
and `tool-phrasing.ts` phrased events nobody read. An improvement was
made, tested, and shipped to nobody.

Fixed by extracting the turn view into `components/layout/AgentTurns.tsx`
and rendering it from `PlanPanel`. The flat renderer
(`EVENT_ICON_MAP` / `EVENT_ICON_COLOR` / `formatPayload`) is deleted —
`tool-phrasing.ts` already says those things in words. `AgentPanel`
now imports the shared component instead of keeping a copy, so a third
divergence cannot start there.

#### What was wired, and where

- **Team activity** → a third tab in the existing activity drawer, not
  a fifth toggle in the shell header. "Activity" and "Team Activity" as
  two adjacent buttons is two things a user has to tell apart; as tabs
  the distinction is visible at the point of choosing. They answer
  different questions — Activity is this plan's `plan_events` from the
  database, Team is the git history of `.codetrellis/` across the whole
  project.
- **Contributions** → the panel mounts in the plan workspace (it
  renders nothing unless the branch has staged contributions) and now
  carries **Accept**. A list of staged work with no way to take it is a
  receipt, not a workflow. The wording says what accept does: it writes
  YAML into `.codetrellis/plans/<slug>/items/` and the plan-file
  watcher picks it up — it does not touch the database, so the toast
  does not claim the items are in the plan. The plan slug comes from
  `file-status`'s `planDir` rather than being re-derived in the client,
  because a second implementation of the slug rule is the drift this
  phase keeps finding.
- **Pantry placeholder** → rendered when an attachment's media fails to
  load, with the reason fetched from `/api/pantry/resolve` (also
  unsurfaced). Until now an unresolvable reference rendered as a broken
  image glyph, which is the worst available answer: an external
  contributor cannot tell "you are not allowed to see this" — a normal
  state of a shared plan — from "the app is broken".
- **Audio capture** → hidden by default, opened by a mic button in the
  status bar or Cmd/Ctrl+Shift+M. The bar had advertised that shortcut
  in its own UI since Phase 8 and **nothing was bound to it**; it was
  unreachable, so nobody could find out. The bar stays visible while
  capture runs whatever the toggle says, because a live microphone the
  user cannot see is not acceptable.

#### The structural fix

`src/frontend/components/reachable.test.ts` fails if any `.tsx` file has
no exported name referenced elsewhere. Existing exceptions are listed
with a reason each, and the allowlist is checked in both directions —
a row for a file that is now wired is itself a failure, because a stale
allowlist is how the next orphan hides.

Writing it turned up two ways it could have passed for the wrong
reason, both caught and fixed:

- The test names its known orphans **by path**, and a path contains the
  component's name — so allowlisting a component made it look
  referenced *by being allowlisted*. Test files are excluded from the
  referrer set.
- `AgentTurns.tsx` explains in prose why `AgentPanel` is superseded, and
  that mention alone made `AgentPanel` look wired. Comments are
  stripped before matching. §2 had already recorded this exact hazard
  for the endpoint audit; it recurred in the tool written to fix it.

Verified by planting an unreferenced component: the guard names it and
goes green when it is removed.

#### Ruled out, with reasons

| Endpoint | Why no surface |
|---|---|
| `/api/health` | Liveness probe. The mobile client uses it to find the desktop; a human has nothing to do with the answer. |
| `/api/git/head` | Returns what `/api/git/status` already includes. Kept for agents that want only the hash. |
| `/api/peers/push-tokens` | Registered by the mobile client for push. No desktop actor. |
| `/api/channels/:eventUid/thread` | `ChannelPanel` already holds every event and groups threads client-side. Server-side threading is for agents that hold no list. |
| `/api/plans/:uid/docs/by-type/:docType` | Plan documents are the model `PlanItem` replaced (§5). Dead with it, like `lib/spec-doc-types.tsx`. |
| `/api/items/:uid/claim`, `/api/plans/:uid/tasks/:taskUid/claim` | Claiming is how an *agent* takes work and announces it. A human editing in the UI is not claiming. |
| `/api/contributor-branch` | Real gap, but a different job from the panel: a team member preparing a filtered branch **for** a contractor, before any contribution exists. Needs its own flow — carried to 4.16. |
| `/api/trellis/capture` | Real gap — snapshots are readable and not creatable. Carried to 4.16. |
| `/api/sync/peek`, `/api/sensors/doc-check`, `/api/presence/cards`, `/api/logs/path`, `/api/audio/recent` | Unclassified. Carried to 4.16. |
| `/api/cross-system` | Not a finding — `MainCanvas` calls it. Prefix artefact of pass 1. |

### 4.16 ☐ Carried from 4.15

Not worked, and named so the next run starts from a list:
`/api/trellis/capture` (snapshots readable, not creatable),
`/api/contributor-branch`, `/api/sync/peek`, `/api/sensors/doc-check`,
`/api/presence/cards`, `/api/logs/path`, `/api/audio/recent`, plus
wiring `RemotePeersPanel` and `WebcamQrScanner` once Phase 19 Gate 1.2
settles the pairing protocol, and the decision on `AgentPanel`'s Plan
tab — the only reader of `agent-store`'s `currentPlan`, which is the
Claude Code session-JSONL plan heuristic, so that heuristic's output is
invisible too.

### 4.17 — add here

Re-run §2 after any phase that adds a service or an endpoint. Run
`npm run test:unit` too: the endpoint grep cannot see an unrendered
component, and `reachable.test.ts` can.

## 5. Version history — what it actually was

4.8 was filed as the one real feature in this register and sized
"large". That estimate counted three tables named `*_versions` and
assumed three jobs. Checking what each was for turned it into a small
one:

| Table | State | What happened |
|---|---|---|
| `plan_item_versions` | **Already surfaced** | `PlanItemHistoryDrawer` (Phase 15 §15.D) lists versions and events and restores through `POST /api/items/:uid/restore-version/:version`. Reachable from the History button on any item. The register never checked. |
| `plan_versions` | **Built here** | `PlanVersionHistory.tsx`, from a **Revisions** chip in the plan header. |
| `plan_document_versions` | **Dead model** | See below. |

The lesson is the same one §2 keeps relearning: **an endpoint with no
caller is a candidate, not a finding.** Three tables looked like three
gaps; one was already done and one had nothing left to be history *of*.

### `plan_document_versions` — history of something the product replaced

`PlanItem` "replaces `PlanDocument` + `PlanPhase` + `Task` for Phase
15+", and that migration is complete in practice:

- No component reads `planDocs`. The store has full CRUD for plan
  documents — `fetchPlanDocs`, `createPlanDoc`, `updatePlanDoc`,
  `deletePlanDoc` — and **nothing calls any of it.**
- No MCP tool creates a plan document.
- The one remaining live producer was `applyV1Template`, and it now
  projects its rows into `plan_items` immediately (see below).

So a version viewer for plan documents would be the second floor of a
building with no first floor. Recorded rather than built. If plan
documents ever come back as a first-class thing, their history is
waiting; until then, items carry it.

### The thing this turned up: V1 templates rendered as empty plans

Not a version-history problem, but found chasing one, and it made
§4.10 wrong until it was fixed.

Every built-in template is V1 — `phases` + `docs`, no `items`.
`applyV1Template` created tasks, phases and documents and **zero**
`plan_items`. The V2 workspace renders `plan_items` and nothing else.
Measured: `mass-refactor` produced **0 items, 11 docs, 6 phases** — so
the plan opened on its "this plan is empty" state with all seventeen
pieces of content invisible.

That was latent for as long as templates were MCP-only. §4.10 gave
built-in templates a desktop surface, which turned it into the first
thing a user would hit.

The fix calls Phase 15's `migratePlan(planUid, { dryRun: false })`
rather than mapping phases and docs to items a second time inside the
template service. Two implementations of "what a V1 plan looks like as
items" is the drift this phase exists to find; the migrator is
idempotent, preserves uids so attachments and comments still resolve,
and already has a smoke script.

One consequence worth stating: `exportPlan` switches to the V2
`items/` layout as soon as a plan has items, so template-created plans
now export in that layout. Two existing tests read `docs/` off an
export to check placeholder substitution and broke. They were rewritten
to ask the API for phases and docs directly — which is what they meant
to assert — rather than routing through an export layout that can
legitimately change.

### One column, two shapes

Writing the reader immediately turned up a producer disagreement, which
is what a reader is for.

`updatePlan` has always written the bare plan object as a snapshot.
`createPlan` wrote `{ plan, tasks }` for v1. One column, two shapes,
and nothing checking they agreed — because until now nothing read the
column at all.

It only becomes visible once something diffs consecutive snapshots:
v2 against v1 compared a plan to a wrapper, so `before.title` was
`undefined` and **a plan's first edit reported every tracked field as
changed from nothing**.

Fixed on both sides, and both halves are needed:

- `createPlan` now writes the bare plan, so the two writers agree from
  here on.
- `parseSnapshot` unwraps `{ plan }` when it sees it, because rows in
  databases people already have still carry the wrapper. Fixing only
  the writer would leave every existing plan's first edit rendering
  wrongly.

The e2e test asserts v1's snapshot has no `plan` key, which is what
holds the two writers together.

### Why plan history is read-only

Items have a restore endpoint. Plans do not. This shows what changed
and when, and stops there. Adding rollback would mean either a Restore
button that silently does nothing, or writing plan mutation logic in a
drawer instead of in the service that owns it. Both are worse than the
honest answer, and a restore endpoint for plans is its own change.

What the drawer adds over a bare list is the diff. A `changeSummary`
reading `"title, status updated"` names the fields that moved but not
what they moved to — and the snapshots have had the answer in them the
whole time.

## 6. Done when

- Every item is ticked or ruled out with a reason.
- **What remains needs a developer machine and nothing else.** The point
  of working the list down here is that the eventual cleanup session is a
  short known list — the Swift grammar rebuild, anything needing a
  packaged build — rather than an open question.
- No surface added here is louder than `StatusBar`.
- The §2 audit is part of what gets run when a phase adds an endpoint, so
  this register does not silently refill.

### Status, 2026-09-18

**4.1 – 4.15 are closed** — thirteen built, two ruled out with a reason
(4.6 was already surfaced, 4.12 is deliberate). **4.16 is open** and
listed rather than left to a future grep.

Three things qualify that:

1. **The register refilled twice, which is the system working.** The
   bullet above asks only that it not refill *silently*. Each re-run is
   recorded with the blind spot that hid its batch: first that a
   surfaced `GET` marks its whole path family as seen, then that an
   unrendered component's `fetch` calls satisfy the grep anyway.
2. **§2's headline number was wrong and is corrected in place.** "26 of
   172" counted files, not surfaces. Leaving it would have left the
   next person auditing against a figure this phase had already
   disproved.
3. **The second blind spot now has a test, not a warning.**
   `reachable.test.ts` fails on an unrendered component. A note in §2
   would have been the same kind of thing that failed here — a
   convention nobody re-checks.

The handover list below has not grown. What is open is 4.16, which
needs judgement rather than a developer machine.

### Known to need the dev machine

Carried here so the handover list is explicit rather than reconstructed:

| | Why it cannot be done here |
|---|---|
| Swift grammar rebuild | Needs Emscripten or Docker to replace the one third-party `.wasm` — see `resources/tree-sitter/README.md`. |
| AppImage sandbox check | Needs a Linux host to confirm what the distributed AppImage does at runtime. |
| Packaged-build verification | CI builds the web bundle and the harness runs under Node; only a packaged build proves the Electron + better-sqlite3 pairing. |
| `npm run lint` | No `eslint.config.*` is tracked, so the command fails repo-wide. Not on this register — it is a house-style decision, flagged and deliberately not taken. |
