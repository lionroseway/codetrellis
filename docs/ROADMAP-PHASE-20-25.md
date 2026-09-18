# Roadmap — Phases 20–29

> Drafted: 2026-09-17
> Status: **20–24 built, 25 partly built** — all on 2026-09-17. Each
> phase doc has been reconciled with what actually shipped, and design
> calls that changed during implementation are marked **[changed]** in
> place. A doc that still describes the plan rather than the result is
> worse than none.
> Supersedes nothing. Sits alongside [TRACKER.md](TRACKER.md), which
> remains the running record of what actually shipped.

Phase 19 (security hardening) is in flight and gates releases. These
six phases are the *product* queue behind it. They were chosen from one
question — "what makes CodeTrellis better?" — and then narrowed to the
work that either (a) makes the graph true for more of the codebases our
users actually have, or (b) closes the loop between a plan and the
change that lands.

Each phase has its own doc. This one holds the sequencing and the
reasoning for it.

---

## The six

| Phase | Doc | One line | State |
|---|---|---|---|
| **20** | [PHASE-20-GO-SUPPORT.md](PHASE-20-GO-SUPPORT.md) | Go parser, resolver and callsites — Go is the server half of the cross-system story | ✅ |
| **21** | [PHASE-21-SQL-REF-TRACKER.md](PHASE-21-SQL-REF-TRACKER.md) | Schema extraction + a SQL ref-tracker, so the graph reaches the database | ✅ |
| **22** | [PHASE-22-AGENT-ACTIVITY-CLARITY.md](PHASE-22-AGENT-ACTIVITY-CLARITY.md) | Turn the tool-call log into a readable account of what an agent is doing | ✅ |
| **23** | [PHASE-23-BUDGETS.md](PHASE-23-BUDGETS.md) | Time and cost per plan item — estimate, actual, forecast, and ceilings as governance | ✅ backend; UI surfaces remain |
| **24** | [PHASE-24-SDLC-INTAKE.md](PHASE-24-SDLC-INTAKE.md) | Jira / Linear / issue intake into nested plans, without CodeTrellis holding a credential | ✅ backend; UI chip remains |
| **25** | [PHASE-25-REVIEW-AND-PLAYBACK.md](PHASE-25-REVIEW-AND-PLAYBACK.md) | Plan↔PR review, snapshot selection, and architecture play-forward | ◑ comparison + review built; play-forward moved to 26 |
| **26** | [PHASE-26-CODE-FIRST-SURFACE.md](PHASE-26-CODE-FIRST-SURFACE.md) | Plan overlay on code, a real diff editor, fast-forward, and a mode where the graph never mounts | ✅ all four layers |
| **27** | [PHASE-27-LANGUAGE-EXPANSION.md](PHASE-27-LANGUAGE-EXPANSION.md) | Ruby (a live bug), C#, Kotlin and Swift | ✅ parsers + resolvers |
| **28** | [PHASE-28-CALLSITE-EXPANSION.md](PHASE-28-CALLSITE-EXPANSION.md) | Callsite extractors for those four, so they reach the cross-system map | ✅ |
| **29** | [PHASE-29-SURFACING-WHAT-WE-COLLECT.md](PHASE-29-SURFACING-WHAT-WE-COLLECT.md) | Surface what the backend already computes and no interface reads — a living register | ◑ |

## Why 26 and 27 exist

**26 came out of one observation**: the graph is the most expensive thing
the renderer does, and it is also the part some users will never want —
while every signal it draws is already per-file or per-line. A code-first
view is therefore not a lesser fallback but the same information, cheaper
to render, and more legible to people who think in files. Play-forward
moved there from 25 for the same reason: scrubbing time over a diff is
more useful than scrubbing it over a picture, because you can read what
changed.

**27 exists because Ruby is the Phase 20 bug, live.** `'ruby'` is in the
`SupportedLanguage` union and `.rb` is in the scanner's `LANG_MAP`, but
there is no parser — so a Rails repo renders as a constellation of empty
nodes. That is the third instance of "a list that had to be kept in sync
by hand fell out of sync", which is why 27 also adds a startup assertion
rather than just another parser.

**29 is the same audit pointed at the last hop.** Phases 20–28 kept
finding two things that had to agree with nothing checking that they did.
29 points that at the interface: the backend computes something, stores
it, serves it, and no part of the UI reads it. 26 of 172 endpoints have
no frontend caller — including the two that already carry the import- and
callsite-coverage numbers. A number that is correct and invisible is
worth what a number never computed is worth, and costs more, because it
looks done.

**28 exists because 27 was half a language.** A language in the symbol
graph but not on the cross-system map draws as a cluster of files
connected to nothing else in the repo — an isolated service, when really
it is an unread one. The product claim is "we map your microservices";
after 27 that was true for TS, Python and Go and false for the four
languages added the same week.

**What 27 turned out to cost: much less than planned.** Its design
document blocked Kotlin and Swift behind an Emscripten build toolchain,
on the strength of checking `tree-sitter-kotlin@0.3.8` and finding no
wasm. `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0` — the maintained
package, a different scope — ships one. All four languages landed in one
pass. The lesson generalises past grammars: **a blocker discovered by
checking one name is not a blocker yet.**

## What the work found

Five bugs surfaced that were worse than the features being added, and
all five shared a shape: **nothing failed, so nothing was noticed.**

1. **The file-watcher's parseable-extension list had gone stale twice** —
   first for `.py`/`.rs`/`.php`/`.java`, then for `.go`. Each time, edits
   to a whole language silently stopped re-parsing and the graph went
   quietly out of date. It now derives from `getParseableExtensions()`,
   the one place that answers "can `parseFile` handle this".
2. **`startWatching` returned before chokidar's initial walk finished**,
   and the scan endpoint did not await it — leaving a window right after
   every scan where edits were not seen at all. That is precisely when an
   agent is most likely to be writing, since a scan is what precedes
   handing it work.
3. **The harness leaked a live backend per test.** It spawns
   `npx → tsx → node` and signalled only the direct child. A full run
   left ~190 backends alive and the machine at a load average of 100+ on
   4 cores — which is almost certainly the real cause of the
   "timing-sensitive tests are flaky" note in TRACKER §7 and the two
   configured retries. They were not flaky; they were starved. The full
   suite went from 40+ minutes to under 9.

4. **Nested symbols were written and never read** (found in 27).
   `insertSymbol` recurses and fills `symbols.parent_symbol_id`, but
   `getFileSymbols`, both per-file symbol counts and the MCP plan-item
   lookup all filter on `parent_symbol_id IS NULL`. Only free-text search
   and the global row count see children — so a nested member was
   findable in search, absent from its own file, and uncounted. Java was
   the live casualty: its methods were nested *and* unqualified, so they
   were invisible per-file and collided with each other in search. The
   flat qualified form is now the contract (`flattenSymbols`), with a
   test.
5. **The syntax highlighter claimed six languages it did not have**
   (found in 27). `prism-react-renderer` bundles a cut-down Prism;
   `CodePreview`'s map named `java`, `php`, `ruby`, `bash`, `toml` and
   `scss`, none of which are in it. A missing grammar renders as one
   plain token with no error, so Java and PHP had been unhighlighted
   while the code said otherwise. Every tag is now resolved against the
   live registry, with a test.

The pattern is worth naming, because it keeps recurring: each was a piece
of state that had to be kept in sync by hand, or a lifecycle that
returned before it was ready. Neither kind announces itself.

Five instances is no longer a coincidence, and the counter-move is
consistent across all five: **derive the second list from the first, or
assert they agree in a test.** `getParseableExtensions()`,
`findUnparsedLanguages()`, `flattenSymbols()` and
`unhighlightablePrismTags()` are all the same move. Any new pairing of
"a list of languages" with "a list of things that handle them" should
arrive with one of those, not with a comment asking the next person to
remember.

---

## Why this order

**20 before everything.** Go is the single biggest gap in coverage
relative to who the product is pitched at. We say "map your
microservices"; a large share of microservices are Go, and today a Go
file appears in the graph as an isolated node with no edges at all
(`project-scanner.ts` already maps `.go`, so the files are ingested —
there is simply no parser behind them). That is worse than not
supporting Go, because the graph looks confidently wrong.

**21 next, because it finishes the sentence 20 starts.** Once a TS
frontend edge can land on a Go handler, the obvious next question is
"and what does that handler touch?" The SQL ref-tracker turns
`frontend → route → handler → orders table` into one traversable path.
That path is the product demo.

**22 is deliberately small and early.** Everything after it is easier
to evaluate when the activity feed reads as sentences rather than tool
names. It is also the cheapest user-visible improvement on the list.

**23 depends on 22's grouping work** — a turn-grouped event stream is
what you attribute time and tokens to. Doing budgets first would mean
building the grouping twice.

**24 depends on nothing technically**, but it depends on 22 and 23
*strategically*: the Jira story is "an agent pulls an epic into a
structured plan and you watch it execute against real architecture."
The watching has to be good before the intake is worth selling.

**25 last, because it consumes all of the above.** The review panel is
most valuable when the graph is complete (20, 21), when the activity is
legible (22), and when a plan carries its ticket lineage (24).

---

## What is deliberately not in here

- **A Jira/GitHub API client.** See Phase 24 — we expose the contract,
  the user's agent holds the credential. This is a principle, not a
  scheduling decision.
- **A seventh "SQL language" plugin.** See Phase 21 — SQL has no import
  graph and does not fit the parser contract.
- **Cost estimation for non-Claude agents.** See Phase 23 — we report
  wall-clock for every agent and tokens only where the agent tells us.
- **Anything that weakens the Phase 19 rules.** Every new surface here
  authenticates with the capability token, derives roots from stored
  state rather than request bodies, and reads files through the
  confined-fs helper. Called out per phase where it bites.

---

## Definition of done, per phase

A phase is done when:

1. It has harness coverage under `tests/e2e/` that fails if the feature
   regresses (`npm run test:harness`).
2. `npm run typecheck` and `npm run lint` are clean.
3. The relevant row in [TRACKER.md](TRACKER.md) §1 is updated with real
   numbers from a real repo, not the fixture.
4. Anything user-facing has an entry in Learn Trellis or the MCP skill
   resource, so an agent and a human can both discover it.
