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

### 4.1 ☐ Coverage: what we could not resolve — **do this first**

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

- *Shape*: a `StatusBar` chip — "58 imports · 41 resolved" — opening a
  panel that breaks the gap down **by language with the reason**, so
  Swift reads as expected behaviour and not as a failure.
- *Effort*: small. Wiring two existing endpoints plus one panel.
- *Deliberate?* No. The stats were built for a UI that never read them.

### 4.2 ☐ Near-miss callsites

A call to `/api/ledger/42` cannot pair with a route declared
`/api/ledger/:id` — 42 is a value, `:id` is a pattern. The matcher has no
fuzzy fallback, which is **correct for drawing an edge**: a wrong edge is
worse than a missing one, and `cross-system-service` says so in its own
comment.

But "we saw a call that looks like this route and could not confirm it"
is exactly what a person wants to know, and it can be shown as a
suggestion without becoming a line on the graph.

- *Shape*: a section of the §4.1 panel. Never an edge, never a colour
  that reads as confirmed.
- *Effort*: medium — needs a scoring rule (segment count plus literal
  prefix), deliberately not a fuzzy one.
- *Ships with*: 4.1. Same surface.

### 4.3 ☐ Budget burn-down (Phase 23)

`item_time_entries` and `plan_budgets` are built, tested, and reachable
only through MCP. No burn-down in the plan header, no forecast, no
warning as a ceiling approaches.

Note the posture already set in `db-schema.ts`: **a ceiling is advisory.**
"We have no mechanism to halt an agent, and pretending otherwise would be
worse than honest advice." The UI must not imply enforcement it cannot
deliver.

- *Shape*: a chip in the plan header; spent/estimated, forecast on hover.
  Warning colour at the 80% mark the schema already tracks
  (`notified_at`), never an alarm.
- *Effort*: small–medium.
- *Deliberate?* No — the phase shipped backend-first and the UI was never
  built.

### 4.4 ☐ External sync state (Phase 24)

`external_sync_state`, `external_refs` and `plan_external_refs` know which
linked tickets have drifted from the plan. The "3 tickets need updating"
signal exists as data and appears nowhere.

- *Shape*: a chip on the plan header, opening a list with per-ticket
  last-synced state.
- *Effort*: small.
- *Deliberate?* No.

### 4.5 ☐ `/api/auto-detect` — open what the agent is already working on

Scans `~/.claude/sessions` and returns each active session's project path
and branch. Read-only, already working, never called.

Opening CodeTrellis to "Claude Code is working in `~/foo` on `bar` —
open it?" is the kind of thing that makes a tool feel like it is paying
attention. This is the highest polish-per-hour item in the register.

- *Shape*: a suggestion on `WelcomeScreen` / `GettingStarted`, dismissible,
  absent when there is nothing to suggest.
- *Effort*: small.
- *Deliberate?* Unlikely — more probably it predates the current
  onboarding screens.

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

### 4.13 — add here

Re-run §2 after any phase that adds a service or an endpoint.

## 5. Done when

- Every item is ticked, ruled out with a reason, or has an owner's answer
  recorded against the "ask" ones.
- No surface added here is louder than `StatusBar`.
- The §2 audit is part of what gets run when a phase adds an endpoint, so
  this register does not silently refill.
