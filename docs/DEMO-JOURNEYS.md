# Demo journeys

The catalogue behind `npm run demo`. Each journey is a piece of work
someone would actually do, walked end to end in the real app, so it can be
verified **by eye** and re-run when a feature lands.

This exists because the worst bugs on the Phase 25–30 branch were invisible
to a green suite. `open_project` returned success having done nothing. The
graph rendered while `graph_snapshot` answered empty. A review after a
rescan reported that no work had happened. A deleted plan kept its ticket
forever. Every one surfaced by driving the app and looking at it.

A suite proves the code is consistent with itself. These prove the product
does what it says.

## How to run

```bash
npm run demo                      # everything, normal pace
npm run demo -- --pace=slow       # long enough to read each card
npm run demo -- --scene=review    # one scene
npm run demo -- --list            # what exists
npm run demo -- --project=/path   # against another codebase
```

Needs the app running (packaged or `npm run dev`). Scenes narrate
themselves inside the window with a presence card, so watch the app, not
the terminal. Everything a journey changes on disk, it changes back.

## Status

| | |
|---|---|
| **built** | in `scripts/demo.ts`, runs today |
| **next** | agreed, not written |
| **wanted** | worth having, not yet designed |

---

## A. The main loop — *built*

One cross-cutting change through Go, C# and Ruby. This is `npm run demo`.

| Scene | Watch for |
|---|---|
| `orient` | graph fills, clusters → files, cross-system edges pair |
| `plan` | ticket imported, PAY-318 survives, items anchored across three languages |
| `budget` | ceiling set, `check_budget` answers, cost priced or honestly unknown |
| `work` | claim, progress, a real file edit, Timeline and activity move |
| `terminal` | agent-driven shell, output comes back |
| `trace` | gutter marks the changed lines, overlay names the item and its intent |
| `channel` | `need-decision` posted, badge lights, thread resolves |
| `review` | **1 landed of 3** — the asymmetry is the whole point |
| `pr` | ticket key in the title, review in the body |
| `compare` | one file modified, not forty |
| `finish` | the agent waits for a human |

---

## B. Journeys to add

### B1. A human plans it by hand — *next*

Everything today is agent-driven, which is half the product. A person
opens the Plans panel, writes a plan from a template, adds pages (notes,
acceptance criteria), anchors actions to files with the mention picker,
edits it mid-flight when scope changes, and exports it to the repo.

**Watch for:** template placeholders actually substituted; a page and an
action look different; the mention picker writes a path that review can
later match; export lands under `.codetrellis/plans/<slug>/` and reads
back.

**Needs:** browser driving rather than MCP — the person is the actor. Add
it to `e2e/review-regressions/` and call it from the demo.

### B2. An agent gets blocked, and a human unblocks it — *next*

The loop the product exists for. An agent claims an item, hits something
it cannot decide, marks the item blocked with a reason, posts to the
channel and stops. The human answers in the app. The agent picks it up and
finishes.

**Watch for:** the item visibly blocked rather than silently stalled; the
channel event carries the item; answering it unblocks; the plan's
progress reflects the pause and the resume.

### B3. Two agents on one plan — *next*

Contention. Both ask for the next item; one claims it; the other must get
a different one, not the same one. One hands off mid-item and the other
resumes from the handoff prompt.

**Watch for:** no double-claim; the Timeline attributes each turn to the
right agent; `get_next_item` respects dependencies and approval gates.

### B4. Terminal, in and out — *next*

Show the drawer, run something real (a test run that fails, then passes),
read the output back, hide the drawer again. Today's scene creates a
terminal and leaves it.

**Watch for:** the drawer opens focused; output streams rather than
arriving in one lump; hiding it does not kill the session; killing it
does.

### B5. Review after the fact — *next*

Not the happy path: come back to a plan a day later, on a branch with
other people's commits in it, and ask what landed. Compare against a
commit rather than the working tree.

**Watch for:** unclaimed changes surfaced (the work nobody planned);
comparand picker offers commits, checkpoints and the baseline; the PR
draft still makes sense when the plan is half done.

### B6. The graph, properly — *wanted*

Today the graph is opened and glanced at. It deserves its own journey:
focus a file, expand to symbols, filter by system, switch Map/Tree, trace
a cross-system edge from a caller to the route it hits, and read the near
misses that did not pair.

**Watch for:** focus mode actually shows the file's symbols; a
cross-system edge is clickable to both ends; near misses explain why they
did not pair.

### B7. System docs and drift — *wanted*

Write a doc describing a service, change the service, watch the doc go
stale, verify it again.

### B8. History and conflicts — *wanted*

Two branches edit the same plan, merge, and resolve the conflict
field-by-field rather than by hand-editing YAML. Read the plan as it stood
at an earlier commit.

### B9. Upgrade — *wanted*

Open a database written by the previous release and watch the schema heal
on boot. This is the one that nearly shipped broken; it should be a
journey, not a memory.

### B10. Refused, and recovering — *wanted*

An agent asks for something it does not hold — a terminal, a screenshot,
a project that is not open. The refusal names the capability, the human
grants it in Settings, the agent proceeds.

**Watch for:** the refusal is legible to a person; the Settings panel it
names exists and the toggle takes effect without a reconnect.

### B11. The phone — *wanted*

Pair a device, review a plan from it, answer a blocked agent from it. Needs
hardware, so it stays manual for now, but the steps should be written down.

---

## C. Fixtures

One fixture today: `tests/fixtures/sample-app` — nine languages, a
cross-system map, SQL migrations. It is enough for A and most of B.

Journeys that need a different shape:

| Fixture | For | Why |
|---|---|---|
| a repo with real history | B5, B8 | commits to compare against, and a plan that changes across them |
| a monorepo package | — | a project that is a subdirectory of a larger repo, which is where `git status` scoping broke |
| a directory with no git at all | B5 | the comparand picker has to degrade honestly |
| a repo with no commits yet | B5 | `git init` and nothing committed is a real state the app tolerates |
| something large | B6 | layout cost and scan time only show at scale |

Keep fixtures small and committed. The one that matters most is a repo
with genuine history — several journeys currently have to fabricate it.

---

## D. Rules for adding a journey

- **A journey is a piece of work, not a tool call.** If it cannot be
  described as something a person wanted to get done, it belongs in a test.
- **Say what to watch for.** A scene with no `watch` line is a scene nobody
  can verify by eye.
- **Flag, do not fail.** These are verification aids. A scene that notices
  something wrong prints it; the suite is where things fail.
- **Leave nothing behind.** Restore every file, delete every plan. The
  second run must be as clean as the first — and running it twice is how
  the archived-plan bug was found.
- **Prefer the real surface.** Drive the UI where a person would, and MCP
  where an agent would. Which one you pick is part of what is being tested.
