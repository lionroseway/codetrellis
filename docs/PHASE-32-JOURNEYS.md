# Phase 32 — Journeys

> Simple stories to talk through. Each one is a situation a developer or
> analyst is in, what CodeTrellis does, and what they see.
> The design is in [PHASE-32-PARALLEL-AWARENESS.md](PHASE-32-PARALLEL-AWARENESS.md);
> what exists today, with file references, is in
> [PHASE-32-CURRENT-STATE.md](PHASE-32-CURRENT-STATE.md); and the
> surface (replay, stack, breakpoints) is in
> [PHASE-32-OBSERVABILITY.md](PHASE-32-OBSERVABILITY.md).

Each journey ends with **what exists** (✓), **what's new** (＋), and
**to discuss** (?).

The cast:

- **Sam**, a developer running several agents at once.
- **Priya**, an analyst using Claude Desktop on reports.

---

## A. Seeing the work

### A1. Morning: five agents, one glance

Sam starts five agents: three in worktrees, one in a separate clone, one
in the main checkout. Each works on its own ticket.

**Sam sees:** a strip in the top bar with five chips, each showing its
branch, its agent and a dot for "anything I should know". Clicking one
lights up that work on the graph.

- ✓ Worktrees are listed, and agents appear as they connect.
- ＋ Knowing which agent is in which folder. Watching all five, not just
  the opened one. The strip.
- ? Show idle worktrees, or hide them? Should the clone need a one-time
  "include this?" prompt, or should opening it once be enough?

### A2. Two agents, one folder

Sam starts a second agent in the main checkout without thinking.

**Sam sees:** one workstream marked **shared**. When both agents edit the
same file: "Two agents are editing `session.ts` in the same folder. Move
one to a worktree?"

- ✓ Claude Code's own log records which file each edit touched.
- ＋ Watching more than one Claude Code session. Splitting edits by agent.
- ? Is a nudge enough, or should CodeTrellis offer to create the worktree?

---

## B. Catching problems while they happen

### B1. Two agents change the same function

The `auth-refresh` agent and the `billing-v2` agent both start editing
`refreshToken`.

**What happens:** within seconds of the second save, both agents get a
short note on their next step: "Another workstream is also changing
`refreshToken`." Sam sees one line in the Awareness inbox.

- ✓ Parsing a file from any folder or branch without touching the main
  graph.
- ＋ Watching every folder. Comparing what each has changed. The inbox.
- ? Same **file** or same **function** — which one should interrupt?
  (The proposal: same function is serious, same file is a mild note.)

### B2. One agent changes something others depend on

The `billing-v2` agent changes `createInvoice(opts)` to
`createInvoice(opts, currency)`. The `checkout-fix` agent imports
`createInvoice`.

**What happens:** the checkout agent is told on its next step, "the
inputs to `createInvoice` changed on `billing-v2`; you use it in
`checkout/submit.ts`." It adapts, or asks Sam. Sam sees one line, marked
serious.

- ✓ Imports record which names each file uses.
- ＋ Recording each function's inputs and outputs, which isn't stored
  today. A "who uses this" lookup.
- ? Edits inside a function should say nothing. Is that the right line
  to draw?

### B3. An agent wanders off its ticket

The billing agent starts editing `config/shared.ts`, which isn't in its
ticket.

**Sam sees:** "`billing-v2` is editing outside its ticket:
`config/shared.ts`." They can mark it intended, message the agent,
or ignore it.

- ✓ Plan intent compared to actual files (`get_deviations`).
- ＋ Running that live for every workstream, not only on request.
- ? Tickets without listed files: should drift say nothing, or guess
  from the graph?

### B4. Main moves under you

Sam merges `auth-refresh`. Two other workstreams were also editing
`session.ts`.

**What happens:** both agents are told straight away that main changed
files they're working on and they'll need to update.

- ✓ Nothing specific.
- ＋ Noticing when the main branch moves, and comparing.
- ? Should it suggest the git command, or leave that to the agent?

### B5. The quiet success

Before touching `createInvoice`, the billing agent asks CodeTrellis:
"who's affected if I change this?" The answer: "`checkout-fix` uses it."
It posts a question to Sam **before** editing, and nothing ever breaks.

- ＋ The "check before you change" tool. The guide and skill that teach
  agents to use it.
- ? This is the behaviour we most want. How hard should the guides push
  it?

---

## C. When Sam isn't looking

### C1. Coming back from lunch

**Sam sees** a digest: "Since 12:30 — 4 workstreams active, 2 need you.
`billing-v2` changed `createInvoice`, which affects `checkout-fix`:
keep the old version or update callers? `auth-refresh` is behind main on
files it's editing. 3 minor notes."

- ＋ The digest.
- ? Where should it live: on opening the app, in the Awareness tab, or
  both?

### C2. On the phone

A serious warning fires while Sam is out.

**Sam gets** a push notification and taps it: both sides in plain words,
plus **Acknowledge**, **Intended** and **Reply to agent**. Their reply
reaches the agent as a message it reads on its next step.

- ✓ Push notifications, the phone link, approving from the phone, and
  agent messages.
- ＋ "Needs you", workstreams and warning-detail screens.
- ? Serious warnings only by push, with everything else in the app —
  right balance?

### C3. "Yes, that's on purpose"

Two tickets are *meant* to both change the auth module. Sam marks the
warning **intended**.

**What happens:** it stays quiet until either side changes shape, and the
decision is written into both PRs later.

- ＋ Intended state, suppression, and carrying it into the PR.
- ? Should intended expire after a day?

---

## D. Review

### D1. A cloud agent's PR arrives

Sam fetches, and a branch from a cloud agent appears.

**What happens:** it becomes a workstream like any other, with no
checkout needed. If it clashes with local work, that shows up before
Sam even opens the PR.

- ✓ Reading files at any branch (`git show`), parsed in memory.
- ＋ Treating branches as workstreams, and noticing when a branch moves.
- ? CodeTrellis never fetches by itself today. Is an opt-in "fetch every
  few minutes" setting OK?

### D2. End of day: what to merge, in what order

**Sam sees** a review queue: which workstreams are ready (checks pass, no
serious warnings), and a suggested order with reasons, e.g. "merge
`billing-v2` before `checkout-fix` — checkout uses what billing
changes."

- ✓ Per-change review (`review_plan`), the PR draft, criteria and
  sign-off.
- ＋ The queue, the order, and "other work in flight" in reviews and PR
  bodies.
- ? Should "no serious warnings" be required for "ready", or just shown?

### D3. The PR tells the story

The PR body for `billing-v2` gets a section: "Other work in flight:
changed `createInvoice`; `checkout-fix` updated its callers
(acknowledged 14:20). Auth overlap with `auth-refresh` marked intended
by Sam."

- ✓ The PR draft already states criteria, evidence and who signed.
- ＋ The new section.

---

## E. Work that isn't code

### E1. Priya replaces the sales spreadsheet

Priya drops in a corrected `sales-2026.xlsx`. Two tasks use it: "Q3
summary" and "Board pack". The board pack was already signed off.

**What happens:** both tasks' agents are told on their next step. The
board pack's sign-off is marked out of date. Priya sees one line: "The
sales spreadsheet changed. Two reports use the part that changed; one
was signed off."

- ✓ A changed file already marks approvals out of date, and the watcher
  already finds every task holding it, but tells each task separately.
- ＋ One signal naming every affected task. Recording which session read
  which version.
- ? Tell every task that uses the file, or only those that cite the
  exact cells that changed?

### E2. Two reports, two versions

"Board pack" read yesterday's spreadsheet; "Q3 summary" read today's.

**Priya sees:** "These two reports are working from different versions
of `sales-2026.xlsx`."

- ＋ Recording which version each task read. This isn't recorded today.
- ? Worth it, or rare in practice?

### E3. Reading outside the brief

The Q3 agent opens `hr-salaries.xlsx`, which isn't in its brief.

**Priya sees:** "Q3 summary read a file outside its brief."

- ✓ Reading goes through CodeTrellis (`read_material`).
- ? Should this warn or refuse? It's sensitive data, so refusing may be
  right.

---

## G. Replay and fast-forward

### G1. "What happened while I was in that meeting?"

Sam was away for two hours. They press **catch up** and watch the two
hours play at 4×: lanes filling with agent activity, a collision zone
opening and closing, one breakpoint answered from the phone.

- ✓ A transport bar (step, play, speed) exists, for one file's diff.
- ＋ Saving agent activity (it's lost today), lanes per workstream, and
  one clock driving graph, stack and inbox.
- ? Is 4× catch-up better than a written digest, or does it just add to
  it?

### G2. The auditor's question

Months later: "When this payment change was built, what else was going
on, and who approved what?" The reviewer sets the cursor to that week.
The stack shows what was in flight, the graph shows the code as it was,
and the timeline shows the breakpoints and decisions.

- ✓ Decisions with who, when, device and file hashes; sign-off packs.
- ＋ Saved agent activity, automatic snapshots, and an evidence export.
- ? How far back must this go? That decides retention.

### G3. Playing the plans forward

Before starting, Sam plays forward: the graph shows what all active
plans *will* change, and a dashed zone appears: "◇ planned overlap:
JIRA-142 and JIRA-150 both plan to change `invoice.ts`." They re-sequence
before anyone writes code.

- ✓ Planned-state projection, for one plan.
- ＋ All active plans at once, and future collision zones.
- ? Should this run automatically when a new plan is approved?

---

## H. How work stacks up

### H1. The lead's morning view

A lead opens the stack: ticket keys down the side, tasks nested, who is
on what, "⚠ overlaps JIRA-150" in words, and dependencies drawn, including
one task waiting on another plan.

- ✓ Tickets linked to plans and items (Phase 24).
- ＋ The multi-plan view, overlap bands, drawn and cross-plan
  dependencies. None of these exist today.
- ? Rows by ticket, by plan, or by workstream?

---

## I. Conferring

### I1. The spec is wrong

The billing agent finds the invoice format can't carry currency. It
**proposes a spec change** with the failing test as evidence.
CodeTrellis finds two other plans relying on that spec section. Their
agents reply with the impact: "checkout: no change needed", "exports:
one new column". Sam sees one proposal with both impacts, and accepts.
Linked tasks are marked "spec changed" and their agents re-plan.

- ✓ Channel vocabulary (`weigh-in`, `need-decision`, `steer`); versioned
  spec pages.
- ＋ Proposals, task → spec links, events on spec edits, messages
  addressed to an agent, and reach across plans. None exist today.
- ? Should agents ever be allowed to change a spec without a person?

---

## J. Grounding

### J1. "Done" on stale tests

An agent marks work done, citing a test report from before its last
edit. The task shows "⚠ tests older than the code", and the criterion
check refuses it.

- ✓ The `test` criterion already rejects a report older than the code.
- ＋ Per-test results, tests mapped to code, and the grounding overlay
  on the graph.
- ? Should CodeTrellis ever *run* tests, or always leave that to the
  agent?

### J2. Watching coverage land

In replay, the grounding overlay shows `billing/` going from "○ no
tests" to "✓ 12 passing" as the agent works.

- ＋ Everything. It depends on J1's mapping and on replay.

---

## K. Breakpoints

### K1. "Ask me before touching payments"

Sam right-clicks `payments/` on the graph and sets a **breakpoint**. Later
an agent claims a task that would change it, and the claim returns
"paused: waiting for a decision". Sam gets a push, replies "go ahead,
but don't change the refund path", and the agent continues with that
note.

- ✓ Blocking waits (≤300 s); `requiresApproval`; human-only claims.
- ＋ Breakpoints on code, specs and tasks; a wait that can last hours;
  the inbox, phone and timeline entries.
- ? Default answer if nobody responds: keep waiting, or stop the agent?

### K2. The honest breach

An agent that doesn't support hooks edits a file under `payments/`
directly. CodeTrellis can't stop that. It sees the edit, tells the agent
on its next step to stop and wait, and the inbox shows "**breach**",
not "paused".

- ＋ Detection and wording that never claims enforcement it didn't
  have.
- ? Is detect-and-report acceptable for regulated teams, or must they
  use hook-capable agents for breakpointed code?

---

## F. What must never happen

These are the tests for "quiet by default":

1. Editing the inside of a function raises **nothing**.
2. A warning marked intended stays quiet until something actually
   changes.
3. The same warning is never sent to the same agent twice.
4. A message about another workstream never reads like an instruction:
   agents are told *what changed*, never *what to do* by another agent.
5. Nothing leaves the machine except what already does: the phone link,
   and push notifications carrying IDs only.

---

## Suggested discussion order

1. **A1, B1, B2**: the core. If these aren't valuable, nothing else is.
2. **B5 and C1**: the "quiet" promise, and whether agents fixing things
   themselves is realistic.
3. **D2**: review is where the human's time goes.
4. **E1**: whether the business side is a second product or the same one.
5. **K1 and K2**: breakpoints, the clearest value in regulated work.
6. **G1, G2 and I1**: replay and conferring, the clearest things to
   *show*.
7. **F**: agree on what "too noisy" means before building.
