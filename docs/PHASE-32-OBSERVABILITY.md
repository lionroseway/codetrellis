# Phase 32 — The observability surface

> CodeTrellis is a surfacing and observability tool first. This doc is
> how parallel AI work *looks*: what you see, how it moves, and how you
> step in.

Status: **plan**. Companion to:
- [PHASE-32-PARALLEL-AWARENESS.md](PHASE-32-PARALLEL-AWARENESS.md): the
  engine (workstreams, footprints, signals).
- [PHASE-32-CURRENT-STATE.md](PHASE-32-CURRENT-STATE.md): what exists
  today, with file references. §18–§23 cover this doc's areas.
- [PHASE-32-JOURNEYS.md](PHASE-32-JOURNEYS.md): the stories, including
  G–K for this doc.
- [PHASE-32-WIREFRAMES.md](PHASE-32-WIREFRAMES.md): ASCII sketches of
  every screen and state below.

---

## 1. Who this is for, and why it has to be slick

The target is **accelerated development in regulated spaces**: teams
that want AI agents doing most of the work, but who have to show what
happened, why, and who approved it.

That means two audiences looking at the same screen:
- **The developer**, who needs to move fast and trust what's running.
- **The reviewer, lead or auditor**, who needs to see how the work
  stacks up, what changed, what was checked, and where a person stepped
  in.

If the surface is noisy or slow, the developer stops looking and the
auditor can't read it. "Slick" is a requirement, not polish.

## 2. Design rules

These are inherited, not new. They are the rules the rest of the app
already follows (Phase 29 §3, Phase 31 §10.4, Phase 26):

1. **Quiet by default, loud on demand.** A count in the status bar opens
   a panel. No banners, no modals, no red unless something is actually
   wrong.
2. **States are glyph + word, never colour alone.** A collision is
   "⚠ 2 workstreams", not just an orange ring. Colour is the third
   carrier.
3. **Say what it means, not what it counts.** "Billing changed what
   checkout uses", not "3 edges affected".
4. **Frames are discrete.** Replay steps between real recorded moments.
   It never animates a guess of what the code looked like in between.
5. **Always name the two points being compared.** Every diff, replay and
   review says "from X to Y".
6. **Unknown is shown as unknown**, never as zero.
7. **Dark first**, in the existing visual language (`glass-panel`, small
   type, lucide icons, `bg-success` / `bg-warning` / `bg-danger`).

And three new ones for this phase:

8. **One clock.** Every surface shares one time cursor. Move it and the
   graph, the stack, the timeline and the inbox all show that moment.
9. **One selection.** Select a file, a plan, a workstream or an agent,
   and every surface filters to it.
10. **Every surface is also a record.** Anything you can see, you can
    export as evidence. The audit view isn't a separate product; it's
    the same screen with the cursor in the past.

## 3. The screen

One layout, five regions, all driven by the same clock and selection:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Top bar:  workstream chips  ·  ⚠ 2 collisions  ·  ◐ 1 breakpoint      │
├────────────┬────────────────────────────────────────┬────────────────┤
│            │                                        │                │
│   STACK    │              GRAPH                     │    INBOX       │
│  plans,    │  code structure, with overlays:        │  breakpoints   │
│  tasks,    │  workstreams, collision zones,         │  decisions     │
│  tickets   │  plan intent, test grounding           │  signals       │
│            │                                        │  proposals     │
├────────────┴────────────────────────────────────────┴────────────────┤
│ TIMELINE:  one lane per workstream  ·  ◀◀ ◀ ▶ ▶▶  ────●────── now     │
└──────────────────────────────────────────────────────────────────────┘
```

Each region can be collapsed. With everything collapsed you have the
graph and a one-line status bar, which is the quiet state most of the
time.

## 4. The graph, with overlays

The graph stays the centre. Everything else is drawn onto it as an
**overlay**, and several can be on at once:

| Overlay | Shows | Glyph + word |
|---|---|---|
| Workstreams | Which workstream is touching which file, one tint each | chip with branch name |
| Collision zones (§7) | Areas where two or more workstreams overlap | ⚠ *n* workstreams |
| Plan intent | What plans say they'll change (exists today, for one plan) | ◇ planned |
| Test grounding (§9) | Which code is covered by passing or failing tests | ✓ tested · ✗ failing · ○ untested |
| Breakpoints (§10) | Where a person has said "stop and ask me" | ⏸ breakpoint |

Today plan intent is hard-wired as the only overlay
(`graph-builder.ts`). The first build step is making overlays a short
list, so each of these is added the same way.

The existing trellis modes stay: **current / planned / live / diff**.
Overlays sit on top of whichever mode is chosen; they are not a fifth
mode.

## 5. The stack: how plans, tasks and tickets pile up

In a regulated team, work arrives as tickets, becomes plans, and splits
into tasks. The question a lead asks is **"how does all of this stack
up?"**: what's in flight, what overlaps, and what's waiting on what.

**Today:**
- Plans are a flat list.
- Items are a tree for one plan at a time.
- Dependencies are never drawn; they only feed a "blocked" count.
- No view shows several plans together.

**The stack view:**

```
  JIRA-142  Billing v2          ████████░░  ◐ 1 waiting on you
     ├ Change invoice format    ✓
     ├ Currency support         ▶ billing-v2 (agent)       ⚠ overlaps JIRA-150
     └ Update exports           ○ waits on "Currency support"
  JIRA-150  Checkout fix        ████░░░░░░
     └ Submit flow              ▶ checkout-fix (agent)     ⚠ overlaps JIRA-142
  JIRA-151  Auth refresh        ██████████  ✓ ready for review
```

- **One row per plan**, labelled with its ticket key when it has one
  (Phase 24 intake already links tickets to plans and items).
- **Tasks nested underneath**, each showing who is on it, in which
  workstream.
- **Overlap bands** where two plans touch the same files or functions,
  declared or actual, with "⚠ overlaps JIRA-150" in words.
- **Dependencies drawn**, including across plans. Cross-plan
  dependencies aren't represented today: an item can list another plan's
  item as a dependency, but it never counts as done.
- **Select a row** and the graph highlights that plan's footprint, and
  the timeline filters to its work.

Move the clock back and the stack shows what was in flight at that
moment. That's how a reviewer answers "what else was going on when this
was built?".

## 6. The timeline: replay and fast-forward

### 6.1 Lanes

One lane per workstream, with time running left to right:

```
auth-refresh   ●──●───●●──────◆ commit ──────────✓ checks pass
billing-v2     ●───●──●──⚠────●──⏸ waiting on Sam ─────────
checkout-fix   ────●──●───⚠──●●──◆ commit ───
main           ──────────────────────◆ merge auth-refresh ──
                                     ▲ cursor
```

Marks on each lane:
- **●** agent actions: tool calls and edits, grouped into turns
- **◆** commits and merges
- **⚠** a signal raised, e.g. a collision
- **⏸** a breakpoint hit, with the wait drawn as a span until a person
  answered
- **✓ / ✗** check runs and criterion decisions
- **✎** spec changes and proposals

Hover a mark for one line; click it to open the detail, and the graph
jumps to that moment.

### 6.2 Replay

Drag the cursor or press play. The graph, stack and inbox show the state
at each **recorded** moment, stepping frame to frame, never animating in
between. The transport bar already exists (`PlaybackBar.tsx`: step,
play, speed 0.5–4×, stops at the end). Today it only drives one file's
diff in the code view. Here it drives everything.

### 6.3 Fast-forward, both ways

"Fast-forward" means two different things, and both are useful:

1. **Catch up to now at speed.** You were away for two hours; play them
   at 4× and watch what happened, collisions and decisions included.
   This is replay from where you left off.
2. **Play forward into the plan.** From now, show the graph as the plans
   say it *will* be: files planned but not yet created, dependencies
   planned but not yet added. This is the existing planned-state
   projection, extended from one plan to every active plan. That's where
   future collisions show up before anyone has written a line.

The chrome always says which one you're watching and between which two
points.

### 6.4 What replay needs that doesn't exist

- **A saved record of agent activity.** Today tool calls and Claude Code
  events are broadcast live and then **lost**: they are never written
  down, and the UI's copy disappears on reload. Replay needs a persisted
  `agent_events` log, which the awareness engine needs anyway.
- **More frames.** Graph snapshots exist only when someone presses
  Checkpoint or a plan is approved, and commits carry no dependency
  edges. Automatic snapshots at natural boundaries (a turn ends, an item
  changes status, a commit lands) give replay enough frames without
  recording every keystroke. Each snapshot records its commit and the
  session that caused it.
- **The scan baseline saved.** It is in memory only today, and lost on
  restart.

## 7. Collision zones

A **collision zone** is an area of the code where two or more
workstreams are working at once. It's the visual form of the
`collision` and `contract` signals.

- **Where:** a zone is drawn around the smallest group that contains the
  overlap: one function, one file, or one folder cluster. It's never
  drawn as scattered dots.
- **What it says:** "⚠ 2 workstreams: `billing-v2`, `checkout-fix`", and
  when one side changed something the other uses, "billing changed what
  checkout uses".
- **How serious:** the same file is mild, the same function is serious,
  and a changed input that another side imports is serious. The words
  change with it, not just the colour.
- **When it formed:** a zone has a lifetime on the timeline, from when
  it opened to when it resolved. A zone that has been open for three
  hours is worth more attention than one that opened a minute ago.
- **Future zones:** in play-forward (§6.3), zones that *will* form if
  the plans go ahead are drawn dashed, as "◇ planned overlap".

## 8. Conferring: when an agent finds the spec is wrong

This is the moment that separates coordinated agents from parallel
ones. An agent working on its task discovers the spec needs to change,
for example "the invoice format can't carry currency; the spec has to
say how". That change affects other agents' plans.

### 8.1 The flow

```
 1. billing agent      proposes a spec change, with why and the evidence
          │
 2. CodeTrellis        finds every plan and task that relies on that part
          │            of the spec
          ▼
 3. affected agents    are told on their next step; each replies with the
          │            impact on its own plan ("weigh-in")
          ▼
 4. a person           sees one proposal with every impact beside it,
          │            and decides: accept, amend, or reject   ← breakpoint
          ▼
 5. on accept          the spec gets a new version; linked tasks are
                       marked "spec changed", and their agents re-plan
```

What the person sees in the inbox:

> **✎ Spec change proposed** by `billing-v2`: *Invoice format:* add a
> `currency` field.
> Why: amounts are ambiguous for EU customers (evidence: test
> `invoice_eu.spec` fails).
> **Affects:** JIRA-150 Checkout fix, which says "no change needed"; JIRA-155
> Exports, which needs a new column, about 1 task.
> [Accept] [Amend] [Reject] [Ask billing agent]

### 8.2 What exists and what doesn't

**Exists:**
- Channels with the right vocabulary: `need-decision`, `weigh-in`,
  `steer`, `handing-off`.
- Versioned spec pages: plan items of kind `object` have version history.

**Doesn't exist:**
- **A way to propose a spec change.** Agents edit specs directly or not
  at all. The "Proposed" tab is a code-change feed, not a proposal
  queue.
- **Links from tasks to the spec sections they rely on.** Only the plan
  tree and loose text references.
- **Any event when a spec body is edited.** Only structural changes are
  logged.
- **Cross-plan reach.** Channel threads and dependencies both stop at
  the plan boundary.
- **Addressing.** A channel event can't be sent to a particular agent or
  task, and agents only see events by polling for them.

### 8.3 What to build

- `propose_spec_change(section, change, why, evidence)` creates a
  proposal. It doesn't edit the spec.
- **Task → spec-section links**, declared by the task, or captured when
  an agent reads a spec section through `get_brief`.
- **Addressed channel events** (to a workstream, task or plan), delivered
  through the awareness notice on the agent's next tool call. That is
  the same delivery path as signals, so no new mechanism.
- **Decision** is a breakpoint (§10). Accepting writes the new spec
  version, with the proposal, impacts and decision attached for the
  record.

## 9. Grounding: tests and evidence

"Grounded" means **a claim with evidence that can be checked, and that
is still true now**. For code, most of that evidence is tests.

**Today:**
- CodeTrellis doesn't run tests. A `test` criterion accepts a JUnit
  report as evidence, checks its totals, and rejects it if it's older
  than the code it covers.
- There's no link from a test to the code it tests.
- `coverage-service` measures how much of the code the *scanner*
  understood, not test coverage.

**The grounding overlay:**

- **Tests mapped to code** through the graph: a test file that imports
  `billing/invoice.ts` covers it. That's the same import data the
  awareness engine uses, with no coverage tooling needed for a first
  version.
- **Per-test results ingested** from JUnit, not just totals, so each
  test has a last result and a time.
- **On the graph:** "✓ 12 tests passing", "✗ 2 failing", "○ no tests",
  and "⚠ tests older than the code". The last one is what catches an
  agent claiming work is done on stale results.
- **On a task:** a grounding line, "3 criteria · 2 grounded · 1 waiting
  on a person", where grounded means evidence attached, checks passing,
  and nothing changed since.
- **In replay:** watch coverage turn green (or not) as work lands.

**Principle:** CodeTrellis still doesn't run tests. The agent runs them;
CodeTrellis checks the report is real, recent and about the right code.
That's the Phase 31 rule: we verify provenance, a person verifies
judgement.

## 10. Breakpoints: people in the loop

Like a debugger: a person marks places where work must **stop and
ask**. The agent pauses, the person steers, and the agent continues.

### 10.1 Kinds

| Breakpoint | Set by | Fires when |
|---|---|---|
| **On code** | A person, on a file, function or folder in the graph | A workstream is about to change it |
| **On a spec** | A person, on a spec or section | Anyone proposes or makes a change to it |
| **On a task** | A person, on a plan item | An agent claims it, or wants to mark it done |
| **On a signal** | A project rule | A serious signal fires, e.g. a contract change with live importers |
| **Asked** | The agent itself | It needs a decision it shouldn't make alone |

### 10.2 What happens when one fires

1. The agent's tool call returns "**paused: waiting for a decision**"
   with a reference, instead of doing the thing.
2. The person sees ⏸ in the inbox and on the timeline, and gets a push
   notification if away.
3. They answer: **continue**, **continue with a steer** (a note the agent
   reads), or **stop**.
4. The agent's resumable wait returns the answer, and it carries on.

Every hit, wait and answer is recorded and shows on the timeline as a
span, so a reviewer can see exactly where a person stepped in and what
they said.

### 10.3 What exists, and an honest limit

**Exists:**
- `await_user_input` and `await_ack` do block, for up to 300 s.
- `requiresApproval` holds the next task back.
- `claimPolicy: human-only` blocks claims.
- Criteria need a human decision to be met.

**The gaps:**
- Most gates are advisory. `requiresApproval` is only honoured by
  `get_next_item`, not by claiming or marking done.
- Freeze and budget can't stop anything.
- "Don't touch these paths" is prompt text only.
- There's no "ask me before changing the spec" at all.

**The limit:** CodeTrellis can enforce a breakpoint on anything that
goes through its own tools (claims, status changes, spec edits,
proposals). It **cannot** stop an agent editing a file with its own
editor tools. For those:
- **Claude Code**: the optional `PreToolUse` hook (awareness spec §6.3)
  asks CodeTrellis first, and honours ⏸.
- **Everyone else**: the breakpoint fires **after** the edit, as a
  serious signal on the next tool call, "you changed a file with a
  breakpoint; stop and wait", and the inbox shows it as a breach, not a
  pause.

The UI never claims a breakpoint was enforced when it was only
detected.

**What to build:**
- A `breakpoints` table.
- Enforcement at the tool interception point, in `mcp/server.ts`.
- `await_decision(ref)`: a wait that survives timeouts and restarts, so
  an agent can wait for hours, not 300 s.
- The Inbox entry, the phone entry, and the timeline span.

## 11. The regulated-space record

Everything above doubles as an audit trail. The goal: a reviewer can
take any piece of work and see **what was asked, what was done, what
was checked, where a person decided, and what else was happening**.

**Already strong:**
- Criteria decisions record who, when, from which device, against which
  file hashes.
- Self-approvals are called out separately.
- Sign-off packs can be re-verified against the files later.
- Commits carry the human as author and the agent as co-author.

**Needed for regulated use:**
- **Agent activity persisted**, which §6.4 already needs.
- **Spec edits and breakpoint decisions logged** like other events.
- **Tamper evidence.** Audit records are plain rows in a local database
  today, and the sign-off pack isn't signed. An append-only log where
  each entry includes the hash of the previous one, plus signed packs,
  makes after-the-fact edits detectable.
- **Retention you can set.** Logs are kept 14 days today, and the device
  audit log keeps its last 2,000 entries.
- **Stronger proof that a decision came from a person**, for example
  confirmed on a paired device, as phone approvals already are.
- **An evidence export:** a replay segment, the stack at that time, the
  signals, breakpoints and decisions, and the sign-off pack, as one
  package.

## 12. On the phone

The phone is for **glancing and deciding**, not exploring:

1. **Inbox first:** breakpoints waiting on you, then decisions and
   proposals, then serious signals. Each opens to plain words and
   buttons: continue, steer, stop, accept, reject.
2. **Stack, summarised:** plans with progress and "⚠ overlaps" in words.
3. **The last hour**, as a short list of what happened per workstream,
   not a scrubber.
4. **Push** for breakpoints and serious signals only.

Replay and the graph overlays stay on the desktop.

## 13. Build order

Two tracks. Track A is the awareness engine (M0–M7 in the awareness
spec). Track B is this surface. B depends on A only where noted.

| Step | Delivers | Needs |
|---|---|---|
| **B1** Agent event log | Every tool call and agent event saved, with session, workstream and time | A-M0 (workstream binding) |
| **B2** Timeline lanes | Lanes per workstream with ● ◆ ⚠ ✓ marks, live | B1 |
| **B3** Overlay list | The graph takes several overlays; workstreams and collision zones become overlays | A-M1 |
| **B4** Breakpoints | Code, spec, task and signal breakpoints; resumable wait; Inbox and phone | A-M0; hook from A-M3 for edits |
| **B5** Replay | Automatic snapshots; one clock driving graph, stack and inbox; catch-up at speed | B1, B2 |
| **B6** Stack view | Plans, tasks and tickets stacked, with overlap bands and drawn dependencies, including cross-plan | A-M1 |
| **B7** Conferring | Spec proposals, task → spec links, addressed events, decision as breakpoint | B4, A-M2 (notices) |
| **B8** Grounding | Per-test results, tests mapped to code, grounding overlay and task line | B3 |
| **B9** Play-forward | Every active plan's planned state projected, with future collision zones | B3, B6 |
| **B10** The record | Tamper-evident log, signed packs, retention settings, evidence export | B1, B4, B5 |

Suggested order: B1 → B2 → B4 → B3 → B5 → B6 → B7 → B8 → B9 → B10.
Breakpoints come early because they're the clearest value in a
regulated setting. Replay is next because it's the clearest thing to
*show*.
