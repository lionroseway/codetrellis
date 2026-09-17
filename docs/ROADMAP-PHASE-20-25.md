# Roadmap — Phases 20–25

> Drafted: 2026-09-17
> Status: design agreed, implementation sequenced below
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

| Phase | Doc | One line |
|---|---|---|
| **20** | [PHASE-20-GO-SUPPORT.md](PHASE-20-GO-SUPPORT.md) | Go parser, resolver and callsites — Go is the server half of the cross-system story |
| **21** | [PHASE-21-SQL-REF-TRACKER.md](PHASE-21-SQL-REF-TRACKER.md) | Schema extraction + a SQL ref-tracker, so the graph reaches the database |
| **22** | [PHASE-22-AGENT-ACTIVITY-CLARITY.md](PHASE-22-AGENT-ACTIVITY-CLARITY.md) | Turn the tool-call log into a readable account of what an agent is doing |
| **23** | [PHASE-23-BUDGETS.md](PHASE-23-BUDGETS.md) | Time and cost per plan item — estimate, actual, forecast, and ceilings as governance |
| **24** | [PHASE-24-SDLC-INTAKE.md](PHASE-24-SDLC-INTAKE.md) | Jira / Linear / issue intake into nested plans, without CodeTrellis holding a credential |
| **25** | [PHASE-25-REVIEW-AND-PLAYBACK.md](PHASE-25-REVIEW-AND-PLAYBACK.md) | Plan↔PR review, snapshot selection, and architecture play-forward |

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
