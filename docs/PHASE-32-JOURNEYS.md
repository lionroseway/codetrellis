# Phase 32 — Journeys

> Simple stories to talk through. Each one is a situation a developer or
> analyst is in, what CodeTrellis does, and what they see.
> The design is in [PHASE-32-PARALLEL-AWARENESS.md](PHASE-32-PARALLEL-AWARENESS.md);
> what existed before the phase, with file references, is in
> [PHASE-32-CURRENT-STATE.md](PHASE-32-CURRENT-STATE.md); and the
> surface (replay, stack, breakpoints) is in
> [PHASE-32-OBSERVABILITY.md](PHASE-32-OBSERVABILITY.md).
>
> **Updated at the phase end, 2 October 2026.** The journeys were written
> before anything was built. Each one now says what shipped. ✓ means
> shipped and proven by a test; the pointer after it names the steps that
> built it and the test that walks it.

Each journey ends with **what shipped** (✓), the old open questions as
**Decided** (with the date the [log](PHASE-32-LOG.md) settled it) or
**Still open**, and anything planned that is **Not built**.

The cast:

- **Sam**, a developer running several agents at once.
- **Priya**, an analyst using Claude Desktop on reports.
- **Dana**, Sam’s teammate, who shares plans with Sam.

---

## A. Seeing the work

### A1. Morning: five agents, one glance

Sam starts five agents: three in worktrees, one in a separate clone, one
in the main checkout. Each works on its own ticket.

**Sam sees:** a strip in the top bar with five chips, each showing its
branch and its agents, with a red or amber border when it overlaps other
work. Clicking one opens its details: the folder, each agent and its
overlaps. On the graph, each file another line of work changes shows its
line counts.

- ✓ Every worktree, recent branch and clone is a line of work, watched
  whether or not it is the opened folder. Each agent is placed in the line
  it works in, whatever its MCP client (A1.1–A1.4, A1.7;
  `tests/e2e/workstreams.test.ts`).
- ✓ The strip, its details and the graph's Workstreams overlay (A1.3,
  B3.3a; `e2e/agent/workstream-strip.spec.ts`,
  `e2e/graph/graph-overlays.spec.ts`).
- Decided (28 Sept): an idle worktree is hidden; one with changes and no
  agent is listed. A clone asks once: a quiet "Agent in acme-2" chip offers
  **Include** or **Not now**, and nothing is read from the folder until
  Sam includes it (A1.7c; `tests/e2e/clone-consent.test.ts`).

### A2. Two agents, one folder

Sam starts a second agent in the main checkout without thinking.

**Sam sees:** one chip marked **shared**. Its details say: "Their edits
in this folder can't be told apart. Give one of them a worktree of its
own."

- ✓ Every Claude Code session is followed, not only the first. Two or
  more agents in one folder make it shared (A1.2, A1.3;
  `tests/e2e/claude-watcher-sessions.test.ts`,
  `tests/e2e/workstreams.test.ts`).
- ✓ The agents' guide tells each agent to work in a worktree of its own
  (A3.3; `tests/e2e/agent-ui-tools.test.ts`).
- Not built: splitting one folder's edits by agent, and the per-file
  warning. Edits in one folder mix on disk, so the strip says that rather
  than guess.
- Still open: is the nudge enough, or should the shared chip offer to make
  the worktree? A plan's section can already get a new worktree from the
  plan tree (C5.2).

---

## B. Catching problems while they happen

### B1. Two agents change the same function

The `auth-refresh` agent and the `billing-v2` agent both start editing
`refreshToken`.

**What happens:** within seconds of the second save, each agent finds a
short note at the end of its next tool result: "Another workstream is also
changing `refreshToken`." Sam sees one card in the Awareness tab, marked
high, and both chips turn red.

- ✓ Each line of work's changed files and functions, from git and the
  parser, kept current by a watcher per folder (A1.4, A1.5).
- ✓ Collision signals, the Awareness tab, and the note on each agent's
  next step, once (A1.6, A1.8, A2.6; `tests/e2e/awareness.test.ts`,
  `tests/e2e/awareness-notices.test.ts`).
- Decided (28 Sept): the same function is high; the same file with
  different functions is medium. Both reach the agents. Only a high one can
  push the phone or hold an agent at a breakpoint.

### B2. One agent changes something others depend on

The `billing-v2` agent changes `createInvoice(opts)` to
`createInvoice(opts, currency)`. The `checkout-fix` agent imports
`createInvoice`.

**What happens:** the checkout agent is told on its next step that
`billing-v2` changed `createInvoice`'s signature and its work imports it.
It adapts, or asks Sam. Sam sees one high card: "keep the old signature,
or update the callers?"

- ✓ Signatures and exports in 13 languages: TS/JS and Python first, then
  Go, Rust, Java, C#, Kotlin, Swift, Ruby and PHP. A Go warning says
  "possibly", because Go imports whole packages (A2.1, A2.7;
  `tests/e2e/awareness-contract-languages.test.ts`).
- ✓ A contract signal when an exported signature changes or an export is
  removed and the other side's changed files import it, through re-exports
  too (A2.2, A2.3, A2.6; `tests/e2e/awareness-contract.test.ts`,
  `tests/e2e/awareness-notices.test.ts`).
- Decided (28 Sept): an edit inside a function says nothing. It raises no
  contract, and it does not reopen an answered overlap.
- Not built: a file that starts importing the function only in the other
  line of work is not seen yet. Importers come from the opened project's
  import graph; it is a logged follow-up.

### B3. An agent wanders off its ticket

The billing agent starts editing `config/shared.ts`, which isn't in its
ticket.

**Sam sees:** an "Outside its scope" card naming `billing-v2` and
`config/shared.ts`. They can mark it **Intended**, **Message the agents**,
or dismiss it.

- ✓ Drift is checked live for every line of work, against the files its
  claimed tasks name and what its agents declared they will change (A2.4,
  A2.5; `tests/e2e/awareness-drift.test.ts`).
- ✓ Answering it, or messaging the agents, from the window or the phone
  (A1.8, A4.1; `tests/e2e/awareness-replies.test.ts`).
- Decided (28 Sept): a task with no files listed has no scope, so drift
  says nothing. An agent brings extra files into scope by declaring them.

### B4. Main moves under you

Sam merges `auth-refresh`. Two other workstreams were also editing
`session.ts`.

**What happens:** each of them gets a low "Behind main" note naming the
files. Sam sees it under Low priority. The agents read it when they ask
for awareness, which the guide tells them to do first. It is not added to
their next step, because only high and medium notes are.

- ✓ Main moving is noticed from git, and each line of work changing the
  same files gets the note (A1.6; `tests/e2e/awareness.test.ts`).
- Still open: should it suggest the git command, or leave that to the
  agent? Nothing settled it, and no command is shown.

### B5. The quiet success

Before touching `createInvoice`, the billing agent asks CodeTrellis:
"who's affected if I change this?" The answer: "`checkout-fix` uses it."
It posts a question to Sam **before** editing, and nothing ever breaks.

- ✓ The "check before you change" tools: `check_footprint` names who else
  changed a file and what imports it; `declare_intent` flags an overlap
  before any file changes (A1.6, A2.4; `tests/e2e/awareness.test.ts`,
  `tests/e2e/declare-intent.test.ts`).
- ✓ The parallel guide for every agent, a Claude Code skill, and an
  optional hook that checks before each edit (A3.3, A3.4, A8.1;
  `tests/e2e/parallel-hook.test.ts`, `tests/e2e/any-agent-parity.test.ts`).
- Decided (28 Sept): the guide makes it a step: awareness, then intent,
  then footprint, then fix or ask. Settings offers the skill ticked and the
  hook unticked, because the hook runs before every edit.

---

## C. When Sam isn't looking

### C1. Coming back from lunch

**Sam sees** the Awareness tab: "4 workstreams active · 2 need you · 3
low-priority notes", and "2 new since you last looked (12:30)". Then one
line per group: "`billing-v2` changed createInvoice's signature;
`checkout-fix` imports it", ending with the choice waiting on Sam. Beside
it, "Watch what happened since 12:30 at 4×".

- ✓ The digest: open high and medium overlaps grouped by kind and pair, at
  most five lines, low ones counted, each saying whether the agents were
  told (A3.1; `tests/e2e/awareness-m3.test.ts`).
- ✓ The same words for agents in `get_awareness`, and on the phone's Needs
  you (A3.1, A4.5b).
- Decided (28–29 Sept): it lives in the Awareness tab, with "new since you
  last looked" kept per browser. After five minutes away it also offers
  catch-up at 4× (B5.4).

### C2. On the phone

A serious warning fires while Sam is out.

**Sam gets** a push that says only "Needs you" and the kind of overlap.
Tapping it loads the rest from the desktop: both sides in plain words,
plus **Acknowledge**, **Intended** and **Reply to agent**. The reply
reaches the agent once, on its next step, and is posted as a steer on the
task it holds.

- ✓ A push for a high overlap, carrying the signal's id and no names
  (A4.4; `tests/e2e/phone-signal-push.test.ts`).
- ✓ Needs you, the overlap's detail, the lines of work, and answers and
  replies that are Sam's, from the phone (A4.1–A4.3, A4.5b;
  `tests/e2e/awareness-m4.test.ts`, `tests/phone/awareness.spec.ts`).
- Decided (29 Sept): only high overlaps push, one per kind per minute, and
  never to a phone that is open. Medium ones wait in Needs you.

### C3. "Yes, that's on purpose"

Two tickets are *meant* to both change the auth module. Sam marks the
warning **intended**.

**What happens:** it stays quiet while both sides only edit the bodies of
what they touch. If either side changes shape (a new function, a new
signature), the card comes back under Needs you saying why, and the agents
are told again. Each branch's review and PR body records it as "a
decision, not an accident", with who made it.

- ✓ Intended, and quiet until the shape changes (A3.2;
  `tests/e2e/awareness-cooldown.test.ts`, `tests/e2e/awareness-m3.test.ts`).
- ✓ Carried into reviews and PR bodies (A5.2;
  `tests/e2e/review-other-work.test.ts`).
- Decided (28 Sept): intended does not expire on a timer. It holds while
  the overlap keeps its shape.

---

## D. Review

### D1. A cloud agent's PR arrives

Sam fetches, and a branch from a cloud agent appears.

**What happens:** it becomes a workstream like any other, with no
checkout needed. If it clashes with local work, that shows up before
Sam even opens the PR. Under Branches, **Fetch now** brings teammates'
pushes and their pull requests.

- ✓ Branches as lines of work, read from git at their ref and followed
  when they move. A squash-merged branch is not live work (A1.7a;
  `tests/e2e/branch-workstreams.test.ts`).
- ✓ Branches and pull requests through Sam's own git and gh (E5;
  `tests/e2e/branches.test.ts`).
- Decided (2 Oct): CodeTrellis fetches only when asked. "Keep remotes
  current" in Settings → Git fetches the open project every 5, 15, 30 or
  60 minutes. It is off by default, and only Sam can turn it on.

### D2. End of day: what to merge, in what order

**Sam sees** the Review tab: one line per branch with plan work, each
ready, held, waiting for sign-off or in progress, with why. The suggested
order gives a reason for each place, e.g. "Before `checkout-fix`: it
imports createInvoice, which this changes, and will need updating after."

- ✓ The review queue and its order, in the Review tab, on the phone and
  for any agent (`get_review_queue`) (A5.4–A5.6;
  `tests/e2e/review-queue.test.ts`, `tests/e2e/awareness-m5.test.ts`).
- ✓ Branch reviews with their dependencies and the other work in flight
  (A5.1, A5.2).
- Decided (29 Sept): an open high overlap makes a line "held", never
  "ready". The order is advice, never enforced. A project can also make
  sign-off wait for it; that is off by default (A5.3;
  `tests/e2e/hold-on-high-signals.test.ts`).

### D3. The PR tells the story

The PR body for `billing-v2` gets a section: "Other work in flight:
changed `createInvoice`; `checkout-fix` updated its callers
(acknowledged 14:20). Auth overlap with `auth-refresh` marked intended
by Sam."

- ✓ "Other work in flight" in the review and the PR draft: each overlap
  and what became of it, the agents' notes, and who decided. The draft
  warns while a high overlap is open (A5.2;
  `tests/e2e/awareness-m5.test.ts`, `tests/e2e/review-other-work.test.ts`).

---

## E. Work that isn't code

### E1. Priya replaces the sales spreadsheet

Priya drops in a corrected `sales-2026.xlsx`. Two tasks use it: "Q3
summary" and "Board pack". The board pack was already signed off.

**What happens:** both tasks' agents are told on their next step, once.
Each brief says it from its task's side, under "Other work affected". The
board pack's sign-off is marked out of date. Priya sees one line naming
both tasks, marked high because one was signed off.

- ✓ A task is a line of work, and what it read, with the file's version
  then, is its footprint (A6.1, A6.2).
- ✓ One signal per file naming every task, in the Brief, the digest, the
  agent's next step and the phone (A6.3, A6.4;
  `tests/e2e/awareness-m6.test.ts`).
- Decided (30 Sept): every task that uses the file is told. CodeTrellis
  does not read back which part changed, so it names the parts each task
  cites, not the part that moved.

### E2. Two reports, two versions

"Board pack" read yesterday's spreadsheet; "Q3 summary" read today's.

**Priya sees** a "Different versions" card: Q3 summary read the current
`sales-2026.xlsx`; Board pack worked from an earlier version.

- ✓ Each read records the version, and two tasks on different versions
  raise one medium signal (A6.2, A6.3;
  `tests/e2e/material-signals.test.ts`).
- ✓ Between teammates too, through a shared plans folder (C3.5;
  `tests/e2e/shared-folder-journey.test.ts`).
- Decided (30 Sept, 1 Oct): worth it, and built. Teammates' reads are
  shared by default once a folder is shared, with a switch to turn that
  off.

### E3. Reading outside the brief

The Q3 agent reads `hr-salaries.xlsx`, which is recorded on another task
and isn't in its brief.

**Priya sees** a low "Outside its brief" note: "Q3 summary read
hr-salaries.xlsx, which its brief does not include."

- ✓ Reading goes through CodeTrellis (`read_material`), which reads only
  files recorded on a plan, and keeps each read (A6.2).
- ✓ A low signal when a task reads another task's file that is not in its
  brief (A6.3; unit `src/backend/services/material-signals.test.ts`; no
  harness test walks it).
- Decided (30 Sept): warn, never refuse, as a low note. A read changes
  nothing; Priya may only want to know the tasks now share the file.

---

## G. Replay and fast-forward

### G1. "What happened while I was in that meeting?"

Sam was away for two hours. The Awareness tab offers "Watch what happened
since 10:00 at 4×". Sam presses it and watches: lanes filling with agent
activity, an overlap opening and closing, one breakpoint answered from the
phone. The graph, the task statuses, the stack and the inbox all follow
the same clock.

- ✓ Agent activity is kept, and a frame of the graph is taken when a turn
  ends, a status changes or a commit lands (B1.1, B5.1).
- ✓ Lanes per line of work, and one clock for the graph, Timeline, inbox
  and stack (B2, B5.2, B5.3, B6.5; `tests/e2e/replay-state.test.ts`).
- ✓ Catch-up at 4×, and `get_state_at` so any agent can ask about the
  same moment (B5.4; `e2e/agent/replay.spec.ts`).
- Decided (29 Sept): catch-up adds to the digest rather than replacing it.
  The digest offers it after five minutes away.

### G2. The auditor's question

Months later: "When this payment change was built, what else was going
on, and who approved what?" The reviewer replays that week. The stack
shows what was in flight, the graph shows the code as it was, and the
timeline shows the breakpoints and decisions, each with who. Settings →
Data says the record is intact, and the week's evidence exports as one
signed page.

- ✓ The record: every kept event linked in a hash chain, checked in words
  (B10.1; `tests/e2e/record.test.ts`).
- ✓ Replaying a chosen week, signed sign-off packs, and an evidence export
  that verifies later and names any entry changed since (B10.3–B10.5;
  `tests/e2e/record-g2.test.ts`).
- Decided (2 Oct): one retention window in Settings → Data: 14, 30, 90 or
  365 days, or everything. The default is 14 days. Only a person in the app
  can change it, and the change is kept in the record.

### G3. Playing the plans forward

Before starting, Sam plays forward: the graph shows what all active
plans *will* change, and a dashed zone appears: "◇ planned overlap:
JIRA-142 and JIRA-150 both plan to change `invoice.ts`." They re-sequence,
or tell both agents, before anyone writes code.

- ✓ Every active plan projected at once, with planned overlaps on files,
  functions and the materials tasks rely on (B9.1).
- ✓ Playing forward in the window and on the phone; re-sequence, tell both
  agents, or leave it (B9.2–B9.4; `tests/e2e/play-forward-g3.test.ts`).
- Decided (1 Oct): play-forward is worked out whenever it is read, so it is
  never out of date and nothing runs in the background. Approving a plan
  into an unanswered planned overlap says so, once.

---

## H. How work stacks up

### H1. The lead's morning view

A lead opens the stack: ticket keys down the side, tasks nested, who is
on what, "⚠ overlaps JIRA-150" in words, and dependencies drawn, including
one task waiting on another plan.

- ✓ Tickets linked to plans and items (Phase 24).
- ✓ The Stack tab: one row per plan, called by its ticket key when it has
  one, tasks with their branch, overlaps in words, waits drawn across
  plans. **Follow** lights the plan on the graph and narrows the Timeline.
  The same stack at a past moment, on the phone and for any agent
  (B6.1–B6.7; `tests/e2e/awareness-h1.test.ts`).
- ✓ Work that isn't code: two plans' tasks on one spreadsheet overlap
  here too (HD3; `tests/e2e/stack-materials.test.ts`).

---

## I. Conferring

### I1. The spec is wrong

The billing agent finds the invoice format can't carry currency. It
**proposes a spec change** with the failing test as evidence.
CodeTrellis finds two other plans relying on that spec section. Their
agents reply with the impact: "checkout: no change needed", "exports:
one new column". Sam sees one proposal with both impacts, and accepts.
Linked tasks are marked "spec changed" and their agents re-plan.

- ✓ Tasks say which spec pages, or sections, they rely on (B7.1).
- ✓ Proposals with evidence; relying agents told once and their replies
  kept; Accept, Amend or Reject in the window or on the phone; tasks
  marked "spec changed" and their agents told (B7.2–B7.4, B7.6;
  `tests/e2e/conferring-i1.test.ts`).
- ✓ A breakpoint on a page others rely on holds an agent's direct edit and
  tells it to propose instead (B7.5; `tests/e2e/spec-held-edits.test.ts`).
- Decided (30 Sept): only a person decides a proposal; no agent tool can.
  An agent can still edit a page directly unless the person guards it with
  a breakpoint.
- Not built: a picker on the item page to set what a task relies on.
  Agents and the local API set it, and the page shows it. It is a
  follow-up.

---

## J. Grounding

### J1. "Done" on stale tests

An agent marks work done, citing a test report from before its last
edit. The task shows "⚠ tests older than the code", and the "done" is
refused with why.

- ✓ Per-test results from JUnit reports, tests mapped to code through
  imports, and the grounding overlay on the graph (B8.1–B8.3a).
- ✓ A grounding line on each task, and an agent's "done" refused while its
  report is older than the code. A person's "done" is never refused
  (B8.3b, B8.4a; `tests/e2e/stale-done.test.ts`).
- Decided (1 Oct): CodeTrellis never runs tests. It checks what the
  agent's run reported.

### J2. Watching coverage land

In replay, the grounding overlay shows `billing/` going from "○ no
tests" to "✓ 12 passing" as the agent works.

- ✓ The overlay at a past moment, rebuilt from the kept reports and replay
  frames. A teammate's run shows live only (B8.4b;
  `tests/e2e/grounding-replay.test.ts`, `e2e/graph/grounding-replay.spec.ts`).

---

## K. Breakpoints

### K1. "Ask me before touching payments"

Sam right-clicks `payments/` on the graph and sets a **breakpoint**. Later
an agent claims a task that would change it, and the claim returns
"paused: waiting for a decision". Sam gets a push, replies "go ahead,
but don't change the refund path", and the agent continues with that
note.

- ✓ Breakpoints on tasks, specs, folders, files, one function, and kinds
  of serious overlap, set from the graph, a task or Awareness (B4.1–B4.3b;
  `tests/e2e/breakpoints.test.ts`, `tests/e2e/code-breakpoints.test.ts`,
  `e2e/graph/graph-breakpoints.spec.ts`).
- ✓ A wait that lasts hours and survives a restart (`await_decision`), with
  every hit and answer on the Timeline (B4.1).
- ✓ The waiting list in the window and on the phone, and a push that names
  only the agent (B4.3a, B4.4; `tests/e2e/phone-breakpoints.test.ts`).
- ✓ Any MCP client is held the same way (A8.1, A8.2;
  `tests/e2e/any-agent-parity.test.ts`, `tests/e2e/check-edit.test.ts`).
- Decided (28 Sept): if nobody answers, it keeps waiting. It never turns
  into a yes.

### K2. The honest breach

An agent that doesn't support hooks edits a file under `payments/`
directly. CodeTrellis can't stop that. It sees the edit, tells the agent
on its next step to stop and wait, and the inbox shows "**breach**",
not "paused".

- ✓ A change to a file under a breakpoint, made after it was set and not
  let through, is a breach, down to one function. It is never called a
  pause (B4.2, B4.2c; `tests/e2e/code-breakpoints.test.ts`,
  `tests/e2e/function-breakpoints.test.ts`).
- ✓ Claude Code's and Gemini CLI's hooks hold the edit before it is made
  (B4.2, A8.3; `tests/e2e/gemini-hook.test.ts`).
- Not built: deleting a file under a breakpoint is not detected, since a
  deleted file leaves no time to compare.
- Still open: is detect-and-report enough for regulated teams, or must
  breakpointed code be worked only by agents with hooks?

---

## L. Added during the phase

### L1. Team status through git, with any host or none

Dana and Sam work one plan in one repository, on different branches.
Neither wants a status file to keep up to date.

**Dana sees** each task's state and where it came from: "pushed" or
"merged" from git, "in progress, 60%" from the plan with who recorded it,
and a pull request only when a review host is turned on. A teammate's plan
says who added it, and in which commit.

- ✓ A task on a branch takes its state from git, squash and rebase merges
  included (C2.1; `tests/e2e/item-git-state.test.ts`).
- ✓ One status view in the window, on the phone and for agents. Changing
  state writes no file, so `git status` stays clean (C2.4a, C2.4b;
  `tests/e2e/plan-status.test.ts`, `tests/e2e/plan-state-writes.test.ts`).
- ✓ GitHub, GitLab and Bitbucket, each off until turned on per project;
  ticket refs in the plan files; approvals signed with the approver's git
  SSH key (C2.2–C2.6a; `tests/e2e/signed-approvals.test.ts`).
- Not built: Phase 32's own plan in CodeTrellis (C2.6b), which the owner
  moved to the phase end. Azure DevOps and Gitea come later.

### L2. A shared plans folder, on git or OneDrive

Dana and Sam keep "Q4 board pack" in their team's OneDrive folder, at a
different path on each laptop.

**Sam sees** the plan arrive with the folder. Dana's "done" reaches Sam as
Dana's record, signed once Sam has checked the key's fingerprint. When they
set one task two ways at once, both machines name both until one decides.

- ✓ Task state as records: one small file per change, and each writer only
  adds its own (C3.1, C3.2; `tests/e2e/task-records.test.ts`).
- ✓ Records signed with the person's git SSH key, or a key the app makes
  for the device. A teammate's key is trusted once, by fingerprint (C3.3).
- ✓ Linking a planning repository or a synced folder. A file still only in
  the cloud is never opened (C3.4a–C3.6;
  `tests/e2e/shared-folder-journey.test.ts`).
- Not built: Google Drive and Dropbox are not found yet; OneDrive and
  SharePoint came first. People without the app see nothing extra in the
  folder.

### L3. The CLI in a session and a pipeline

A cloud session works on Sam's repository with no desktop app. Then a CI
job checks the branch it pushed.

**Sam sees**, after a pull, what the session did: the task in progress at
60% in the session's record, a new follow-up task, and `validators.ts` "✓
3 tests passing" from the session's run. The CI job's `codetrellis check`
passed.

- ✓ `codetrellis start` runs CodeTrellis headless, with the same token and
  loopback rules. The verbs an agent needs: next, claim, update, done,
  report-tests, check, commit (D1.1–D1.3; `tests/e2e/cli-verbs.test.ts`).
- ✓ A SessionStart hook recipe and a CI recipe. `check` exits 3 on failing
  or out-of-date tests, a done task failing its criterion, a stale system
  doc, or an import across a rule (D1.4; `tests/e2e/cli-gate.test.ts`).
- ✓ Task state and test runs travel through git as signed records (D1.5a,
  D1.5b; `tests/e2e/done-when-d.test.ts`).
- Not built: watching a session live through a tunnel, pairing over a
  remote network, and checking declared product flows in CI. All wait
  until after Phase 32.

### L4. Recurring playbooks on two machines

Sam's team runs "Weekly security review" every Monday from a playbook,
carrying open tasks over. Its plans live in the team's planning
repository.

**Sam sees** this week's run due. Sam starts it from the phone, and Claude
Code opens on Sam's laptop to work it, as chosen for that computer.
Dana's laptop shows Sam's run in progress. Starting it there opens Sam's:
one run, one agent.

- ✓ A recurrence rule in the committed config, one run per period by an id
  both machines work out alike, and open tasks carried over (C4.1;
  `tests/e2e/recurring.test.ts`).
- ✓ Due runs in the window, Settings → Recurring playbooks, and starting
  from the phone (C4.2a–C4.3a).
- ✓ An agent on each run, per rule and per computer, off by default (C4.3b;
  `tests/e2e/recurring-two-machines.test.ts`).

### L5. Architecture rules

Sam's team keeps the API's routes off its settings module. Two agents
work at once, and one adds an import across that line.

**Sam sees** one digest line and a high card naming the rule, the import
and why. Only that agent is told, on its next call. In CI, `codetrellis
check` on its branch fails, naming the import and the rule, and passes
once the import is gone.

- ✓ Rules written in Settings → Architecture rules and committed. Each
  lists the imports that already break it (A7.1;
  `tests/e2e/architecture-rules.test.ts`).
- ✓ A high signal for an import a line of work adds, never for one already
  there (A7.2; `tests/e2e/rule-signals.test.ts`).
- ✓ The gate in CI (A7.3; `tests/e2e/awareness-m7.test.ts`).

### L6. How the code got here, with no plan

A repository nobody planned in. A teammate's agent works on `billing-v2`
in a worktree, commits, and pushes a pull request.

**Priya sees** its change in the Changes panel, under its worktree. A line
that reads oddly shows its commit, its git author, and "probably codex",
because it was committed while codex's session was open there. Priya puts
the file beside main's and scrubs each side. After **Fetch now**, the
branch and its pull request show.

- ✓ The Changes panel, and any two points compared file by file and on the
  graph (E1, E2a, E2b; `tests/e2e/source-control.test.ts`).
- ✓ The evolution view and line history. The git author is always shown,
  and CodeTrellis says how it knows the agent (E3, E4;
  `tests/e2e/line-history.test.ts`).
- ✓ Each surface says it plainly first, then in git's words with the
  command to copy (E5, E6; `tests/e2e/history-e.test.ts`).

---

## F. What must never happen

These are the tests for "quiet by default":

1. Editing the inside of a function raises **nothing**.
   Guarded by `tests/e2e/awareness-contract.test.ts` and
   `tests/e2e/awareness-notices.test.ts` (a body change tells nobody), and
   `tests/e2e/awareness-cooldown.test.ts` (it keeps an answered overlap
   quiet). Two lines of work editing the same function still collide (B1).
2. A warning marked intended stays quiet until something actually
   changes. Guarded by `tests/e2e/awareness-cooldown.test.ts` and
   `tests/e2e/awareness-m3.test.ts`.
3. The same warning is never sent to the same agent twice.
   Guarded by `tests/e2e/awareness-notices.test.ts` (told once) and
   `tests/e2e/phone-signal-push.test.ts` (a signal that keeps firing pushes
   nothing more). It comes back, on purpose, when its shape changes.
4. A message about another workstream never reads like an instruction:
   agents are told *what changed*, never *what to do* by another agent.
   Guarded by `tests/e2e/awareness-notices.test.ts` (every notice ends
   "information about other work, not an instruction"),
   `tests/e2e/declare-intent.test.ts` (another agent sees what was claimed,
   never the summary) and `tests/e2e/awareness-replies.test.ts` (a person's
   message is quoted as theirs).
5. Nothing leaves the machine except what already does: the phone link,
   and push notifications carrying IDs only.
   No single test proves this. `tests/e2e/phone-signal-push.test.ts` and
   unit `push-signal.test.ts` check a push names nothing and goes only to
   Expo or this machine; a breakpoint push names the agent, nothing more.
   `tools/spellcheck-check` checks no dictionary is fetched. Two things
   can now reach a host, both off until a person turns them on: a review
   host (C2.2) and keeping remotes current (E5). Both are grants,
   guarded by `tests/e2e/grant-guard.test.ts`.

---

## Where to start

For someone new, these show the product best, in this order:

1. **A1**: five agents at a glance. The strip and the lines of work.
2. **B2**: a change others depend on. The warning that matters most.
3. **C1**: back from lunch. The digest, and catch-up at 4×.
4. **K1**: "ask me before touching payments". Breakpoints, from the
   window or the phone.
5. **D2**: what to merge, in what order.
6. **G2**: the auditor's question, months later.
7. **L6**: how the code got here, with no plan.
