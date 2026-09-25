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
npm run demo -- --port=19433      # a second instance moved the MCP port
npm run demo -- --shots=/tmp/ct   # save a screenshot per scene
npm run demo -- --scene=brief --decide           # decide for the person (dev build only)
npm run demo -- --scene=brief --connector=out/connector/mcp-connector.cjs
```

If another CodeTrellis is already running, the second one moves off
:19432 and :3001 and says so in its log — pass `--port` and `--api-port`
to match, or you will authenticate against one process and talk to
another.

Needs the app running (packaged or `npm run dev`). Scenes narrate
themselves inside the window with a presence card, so watch the app, not
the terminal. Everything a journey changes on disk, it changes back.

## Status

| | |
|---|---|
| **built** | runs today — a demo scene, or a browser spec the demo points at |
| **covered by the suite** | real, but needs something a script cannot arrange (a fresh boot) |
| **manual** | needs hardware; the steps are written down instead |

Everything in section B is now one of those three. What is left is named
in the journey that owns it, not in a backlog here.

---

## A. The main loop — *built*

One cross-cutting change through Go, C# and Ruby, then the journeys that
are about the repository rather than the code. This is `npm run demo` —
24 scenes.

| Scene | Watch for |
|---|---|
| `orient` | graph fills, clusters → files, cross-system edges pair |
| `plan` | ticket imported, PAY-318 survives, items anchored across three languages |
| `budget` | ceiling set, `check_budget` answers, cost priced or honestly unknown |
| `work` | claim, progress, a real file edit, Timeline and activity move |
| `terminal` | agent-driven shell, output comes back |
| `trace` | gutter marks the changed lines, overlay names the item and its intent |
| `verdict` | ✓ aligned, ◆ drifted, ◇ outstanding — one answer per line, not two faint colours |
| `roundtrip` | the plan header grows a back button naming the file; it returns you to the line |
| `colleague` | a review against a branch the picker never offered |
| `channel` | `need-decision` posted, badge lights, thread resolves |
| `review` | **1 landed of 3** — the asymmetry is the whole point |
| `pr` | ticket key in the title, review in the body |
| `compare` | one file modified, not forty |
| `graph` | depth changes, a file focuses to its symbols, scope narrows to one service |
| `blocked` | the item goes visibly blocked with a reason, then resumes |
| `agents` | the second agent gets a different item, and a double-claim is refused |
| `docs` | a doc appears in Docs, freshness answers |
| `drift` | drift as information, not a blocker — and it agrees with `review` |
| `refusal` | the refusal names the capability and where to grant it |
| `history` | comparands include commits; reviewing against one surfaces work the tree does not |
| `scoping` | a package inside a monorepo shows none of its parent's churn |
| `degrade` | no git and no commits both answer honestly |
| `conflict` | a plan manifest conflict named per field, resolved without markers |
| `brief` | a task with no code, looped twice: sent back from a cell, fixed from the worklist, approved, stale on refresh, approved again |
| `finish` | the agent waits for a human |

Two scenes need more than the backend: `terminal` needs the `terminal`
capability granted in Settings → MCP Server, and `graph` needs the window
open. Run headless and both flag themselves, saying which.

---

## B. The journeys, and where each one lives

### B1. A human plans it by hand — *built*

`e2e/plan/plan-by-hand.spec.ts`. A browser journey, because the person is
the actor: create a plan, give it a page and a task, anchor the task to a
real file with the picker, change the scope mid-flight, share it to the
repo, and read back what landed on disk.

It is a browser spec rather than a demo scene for one reason: every step
has to be a click. Three defects came out of writing it, and none was
visible from inside a single-component spec — the plan's own page became
unreachable once you opened an item, the Targets strip's "+" was gated on
a prop no caller passed, and the strip rendered nothing at all in the
state every new item is in.

**Watch for:** the stored path is repo-relative, because an absolute one
looks identical on screen and makes every later review say "missing".

### B2. An agent gets blocked, and a human unblocks it — *built*

Scene `blocked`. The item goes visibly blocked with a reason and then
resumes, rather than stalling silently.

### B3. Two agents on one plan — *built*

Scene `agents`. Two connected MCP clients; the second is offered a
different item, and a second claim on the first agent's item is refused.

### B4. Terminal, in and out — *built*

Scene `terminal`. Show the drawer, run something, read the output back,
hide the drawer — and assert the session survives being hidden. Needs the
`terminal` capability, which is not granted by default; the scene says so
when it is missing rather than failing obscurely.

### B5. Review after the fact — *built*

Scene `history`, on a fixture with three commits and uncommitted work on
top. The point is that the answer depends on what you compare against:
against the working tree the plan shows nothing landed, and against the
middle commit one item has landed and `src/notify.rb` surfaces as work
nobody planned.

**Watch for:** comparands are `commit:<short-sha>`, and the scene uses
what the picker offered rather than inventing an identifier — a journey
that guesses tests its own guess.

### B6. The graph, properly — *built*

Scene `graph`. Depth changes, a file focuses into its symbols, the scope
narrows to one service. Needs the window open: `graph_snapshot` answers
through the renderer, and says so when there is none.

### B7. System docs and drift — *built*

Scenes `docs` and `drift`. A doc is written and its freshness read; drift
is reported as information. The two now agree with `review`, which they
did not: the feed called every planned modify satisfied the moment the
plan was written.

### B8. History and conflicts — *built*

Scene `conflict`, on a fixture left mid-merge with a conflicted plan
manifest. The conflict is named field by field — title, status, owner —
and resolving it leaves valid YAML rather than markers.

Time-travelling a plan to an earlier commit (`get_plan_at_commit`,
`diff_plan_between_commits`) is not yet in a scene. That is the remaining
half of B8.

### B9. Upgrade — *covered by the suite*

`src/backend/services/ast-schema-drift.test.ts` builds a database with
the pre-Phase-27 shape and asserts the app heals it. It stays a test
rather than a journey because it needs a fresh boot, which a script
driving a running app cannot arrange. This is the one that nearly
shipped broken, so it is worth knowing where it lives.

### B10. Refused, and recovering — *built*

Scene `refusal`. An agent names a project that is not open; the refusal
says so and names Settings → MCP Server. The scene asserts the refusal is
legible to a person, not merely that it happened.

### B11. The phone — *manual, steps written down*

Needs two devices, so it cannot be scripted here. Walk it by hand before
a release that touches pairing — Gate 1.2 of Phase 19 changes the pairing
and reconnect protocol, so the next mobile release forces re-pairing for
every existing user and this journey is how that gets checked.

1. Desktop: Settings → Devices, turn on discovery **and** API exposure.
   They are separate switches on purpose; confirm both are off by default
   on a fresh profile.
2. Desktop: show the pairing QR. Phone: scan it. Both should report the
   peer by name, not by fingerprint.
3. Phone: open the plan the desktop has open. Confirm the item tree, the
   statuses and the progress match what is on the desktop screen.
4. Desktop: have an agent block an item. The phone should show it
   blocked, with the reason.
5. Phone: answer in the channel. The desktop's badge should light and the
   thread should carry the answer.
6. Phone: open the terminal for a running session. Type something; output
   should stream rather than arrive in one lump.
7. Kill the desktop's network for ten seconds and restore it. Both ends
   should reconnect without re-pairing.
8. Desktop: unpair. The phone should lose access immediately, not at the
   next poll.

**Watch for:** identity comes from the DTLS transport. If any step works
after a fingerprint is edited in a request body, that is the finding.

### B12. Work that is not code, looped twice — *built*

Scene `brief`. A folder with no git in it — a workbook and a PDF guide —
and a plan from the **Analysis report** playbook. The agent connects
through the stdio connector as `claude-ai`, the way Claude Desktop does,
not through the demo's own shortcut. Then the loop from Phase 31's
done-when, end to end, twice:

1. It reads the brief, claims **Analyse**, reads `Regional!A1:C4`, writes a
   Word document, and submits the citation criterion — citing `B3`, the Q2
   figure, by mistake.
2. The person sends it back **from that cell**, with a note.
3. The agent calls `get_worklist`: the note and the cell arrive there, and
   it reads the place it was pointed at — nobody pastes anything to it. It
   corrects the output, resubmits on `C3`, and the person approves.
4. The workbook is refreshed. The approval was of the file as it was, so it
   goes stale, and the next `run_checks` says so: *1 went stale — …xlsx
   changed*.
5. The loop runs again: stale is on the worklist like a send-back is; the
   agent re-reads the cell, updates its output, resubmits, and the person
   approves the new figure.

MCP cannot decide, by design, so the scene waits for a person
(`--person-wait`, 180s by default). `--decide` stands in for them through
the desktop's own HTTP route, which only a dev build serves; on a packaged
build, decide in the window — send it back from `B3` when asked. If you
approve instead, the scene carries on without the send-back leg and says
so. `--connector` runs the bundle a packaged app ships instead of the
connector's source.

**Watch for:** the Brief's row for *Every figure… cites the sheet and
cell* reading waiting, sent back, approved, stale, approved — each shot
checks the row on screen says so before it is taken. The playbook's
citation criterion must not arrive agent-approved; a file cannot grant
that.

## C. Fixtures

`tests/fixtures/sample-app` — nine languages, a cross-system map, SQL
migrations — is the committed one, and it carries the main loop.

The journeys that are *about* the repository need repositories, and those
are built at run time by `scripts/demo-fixtures.ts`:

| Fixture | For | Shape |
|---|---|---|
| `repoWithHistory()` | `history` | three commits, one of them someone else's, plus uncommitted work on top |
| `monorepoPackage()` | `scoping` | `packages/checkout` inside a repo whose other packages have churn |
| `noGitDirectory()` | `degrade` | a plain directory, no git at all |
| `repoWithNoCommits()` | `degrade` | `git init` and nothing committed — day one of a project |
| `repoWithPlanConflict()` | `conflict` | two branches left mid-merge on a conflicted plan manifest |
| `briefFolder()` | `brief` | no git: a real `.xlsx` (Regional!C3 is the cited figure) and a PDF guide; the `.docx` output is written by the agent |

They are built rather than committed because a fixture repo cannot live
inside this one — a nested `.git` is either ignored or becomes a
submodule, and neither is what a journey wants. Building them costs a few
hundred milliseconds and puts the history in code, where it can be read,
instead of in a tarball. `cleanupFixtures()` removes the lot, and the
demo calls it however it exits.

Still missing: something large. Layout cost and scan time only show at
scale, and the `graph` scene currently proves correctness rather than
performance.

## D. Rules for adding a journey

- **A journey is a piece of work, not a tool call.** If it cannot be
  described as something a person wanted to get done, it belongs in a test.
- **Say what to watch for.** A scene with no `watch` line is a scene nobody
  can verify by eye.
- **Flag, do not fail.** These are verification aids. A scene that notices
  something wrong prints it; the suite is where things fail.
- **A flag may only claim what it checked.** One read "empty graph while
  the canvas is drawing one" and had never looked at the canvas. The
  canvas was blank; the tool it accused was correct. A wrong flag costs
  more attention than a missing one and sends you to the wrong file.
- **Never hard-code a number in a flag.** "review says 2 landed; only one
  file was edited" was true when written and false a week later, because
  a new scene edited a second file. The review was right and the flag
  accused it. Derive the expectation from what the run actually did —
  `edited` knows — so the assertion cannot go stale behind you.
- **A screenshot must name its subject.** `shot()` takes what it is
  supposed to be a picture of — a file and its verdict marks, a criterion
  and its state, a file in the viewer — and waits for `ui_ready` to report
  it on screen, VISIBLE rather than merely in the DOM. One captured
  `app.rb` under a caption naming `money.go`, and nothing disagreed. A
  shot that never sees its subject is flagged and not saved.
- **Check the window is usable before claiming anything.** `ui_ready`
  reports whether the shell is mounted and whether a dialog covers it.
  A full run once passed twenty-four scenes against an app that had
  never mounted, and every screenshot was of the first-run form.
- **Leave nothing behind.** Restore every file, delete every plan, close
  what you opened. The second run must be as clean as the first — and
  running it twice is how the archived-plan bug was found, and how the
  `brief` scene was found leaving the file viewer open over the window,
  which the next run's preflight rightly refused to start under.
- **Prefer the real surface.** Drive the UI where a person would, and MCP
  where an agent would. Which one you pick is part of what is being tested.
- **Use what the product offers, not what you assume.** The `history`
  journey passed a bare commit SHA and was refused; the picker's own
  answer is `commit:<short-sha>`. A journey that invents an identifier is
  testing its own guess.
- **Two surfaces disagreeing is the finding.** The proposed-changes feed
  said 3 of 3 satisfied while review said 1 landed of 3, on the same plan
  in the same second. Neither number looks wrong alone. Print both.
