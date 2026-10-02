# Parallel awareness

How CodeTrellis notices that parallel lines of work (worktrees, branches,
clones, each with its agents) are about to collide, and tells the person
and the agents in few words. Built in Phase 32 Track A. The design is
[`docs/PHASE-32-PARALLEL-AWARENESS.md`](../PHASE-32-PARALLEL-AWARENESS.md);
this is the map of what exists, for people working on CodeTrellis itself.

## The pipeline

```
worktrees / branches / clones        agents (MCP sessions, Claude Code logs)
        │                                     │
        ▼                                     ▼
  workstreams  ◄──── bound by folder ──── sessions + declared intent
        │
        ▼  per workstream: changed files, symbols, signatures, scope
  footprints
        │
        ▼  pure
  computeSignals ──► reconcileSignals ──► awareness_signals (rows)
                                               │
                   ┌───────────────────────────┼──────────────────────────┐
                   ▼                           ▼                          ▼
          Awareness tab / strip          get_awareness,             inline notices
          (digest, answers)              check_footprint            (next tool result)
                                                                    + the PreToolUse hook
```

## Workstreams

A workstream is one line of work in the opened repository. They are
**derived, never created**.

- **Worktrees**: `git worktree list`, the main checkout included
  (`worktree-service.ts`, `workstream-service.ts`).
- **Branches** with no checkout here, ahead of main, changed within
  `sensors.awareness.branchWindowDays` (default 7), and not already merged
  by content, so a squash merge counts (`branch-workstreams.ts`, bug 53).
  Answers are cached per branch head; a listing works out at most eight
  uncached branches inline and the rest in the background, then
  broadcasts `workstreams-changed` (HD4b), so a clone with a hundred
  recent remote branches never stalls the server.
  Only local refs are read, never fetched.
- **Clones**: a folder an agent reports that no trusted root covers becomes
  a *folder request*. The person includes it or dismisses it
  (`folder-requests.ts`, `trusted-roots.ts`). Nothing is read from it
  before then.
- **Who is in each**: MCP sessions are bound by the folder the connector
  or an MCP root reports, matched only against roots already trusted
  (`workstream-binding.ts`, A1.1). Claude Code sessions are followed
  through their own logs (`agent/claude-code-watcher.ts`, A1.2). Two or
  more agents in one folder make it `shared`, which the UI names.

`list_workstreams` (MCP), `GET /api/workstreams` and the TopBar
`WorkstreamStrip` all read `listWorkstreams`.

## Footprints

What each workstream is changing, kept current without rebuilding the
graph.

- **Changed files**: git, from the merge base with main, plus uncommitted
  and untracked work. Each folder has one light chokidar watcher and a
  debounced recompute (`workstream-watch-service.ts`; the debounce is
  `CODETRELLIS_WORKSTREAM_DEBOUNCE_MS` in tests).
- **Symbols**: only the changed files are parsed, current vs merge base,
  giving added / removed / modified (`workstream-symbols.ts`, A1.5).
- **Signatures and exports**: TS/JS and Python (A2.1); Go, Rust, Java, C#,
  Kotlin, Swift, Ruby and PHP for functions and methods (A2.7), from each
  declaration's header (`headerSignature` in `parsers/base.ts`: every token
  but the name, body, modifiers and keyword, comments and layout dropped).
  `SymbolChange.exported` follows `export`, or for Python no leading
  underscore or `__all__`; for the others each language's own rule
  (`isExported` in `workstream-symbols.ts`: Go's capital, Rust's `pub`, not
  `private` elsewhere, C#'s members only when they say so). A modified symbol
  with no shape to compare (a Go struct, a Kotlin class) carries
  `signatureUnknown`, never a silent "unchanged".
- **Go imports a package**, so a Go file's importers are its package's, each
  as a namespace import: a Go contract signal is medium, "possibly used"
  (`importers.ts`).
- **Importers**: through barrels (`export … from`), with the names imported
  (`importers.ts`, A2.2).
- **Declared intent**: what an agent says it is about to change, per MCP
  session, in memory, gone with the session (`intent-service.ts`,
  `declare_intent`, A2.4).
- **Scope**: the files and folders of the plan items the workstream's
  agents claimed (`file_specs`, `scope_path`), plus intent (A2.5).

## Signals

`awareness-signals.ts` is pure: footprints in, signals out. Each has
a kind, a severity, a subject, the workstreams it names, and a summary
written by CodeTrellis.

| Kind | When | Severity |
|---|---|---|
| `collision` | Two workstreams change the same file (declared intent counts) | high on the same symbol, else medium |
| `contract` | An exported signature changed or an export was removed, and the other side's changed files import it | high; medium for a namespace import only |
| `drift` | Changes outside the workstream's scope | medium |
| `stale-base` | Main changed files this workstream changes, since it branched | low |
| `rule` | The workstream adds an import across one of the team's architecture rules (A7.2): `subject.rule` names it in words with why, `subject.edges` each import. Only imports it *adds* against its merge base count; one already there is listed by the rule (A7.1), never signalled | high |

**Staying quiet** (spec §4.4):
- The id is derived from kind, subject and workstreams, so a signal that
  keeps firing is one row, updated.
- A signal whose cause went away is resolved.
- Each signal has a **shape**: what it is about, for example each side's
  names in the file plus any new signature. An `acknowledged` or `intended`
  answer holds while the shape holds. When the shape changes, the signal
  reopens with `reopened: { from, at }` and the agents are told again
  (A3.2). `dismissed` stays dismissed.

**Tasks' materials** (A6.3, `material-signals.ts`, also pure) raise the
same kinds with `subject.material` set, plus `version-split`. Their
workstreams are tasks (`task:<uid>`), titled in `subject.labels`, which the
shape leaves out so renaming a task reopens nothing. Every rule needs two
tasks; one task and its own file is Phase 31's staleness. One signal per
material, the most serious that holds:

| Kind | When | Severity |
|---|---|---|
| `contract` | The material changed since a task cited it, and another task uses it | high when a citation was signed off, else medium |
| `version-split` | Tasks last read different versions of it | medium |
| `stale-base` | It changed after two or more tasks read it, and none has read it since | low |
| `collision` | Two tasks record the same output file | medium |
| `drift` | A task read another task's material that is not in its brief | low |

Which part of a material changed is not known: nothing is read back out of
a material, so a contract names the parts cited, not the part changed. The
inputs (`materialInputsOf`) are the tasks' footprints (A6.2) and each
material's hash as last re-taken; the artefact watcher re-takes it on a
change and refreshes the project's signals.

**Teammates' records** (C3.2, `task-records/split-signals.ts`) raise one
more kind, `state-split`: two people set one task two ways at once, from
records made without seeing each other's (C3.1). Its workstream is the task
(`task:<uid>`), its sides are the people (`subject.said`: who set it to
what), medium, or high when two different records claim to be the same
change by one person (`forged`). It is drafted in the same `refreshSignals`
pass from `task_record_heads` (read straight from the tables, so the signal
engine never loads the plan services), refreshed whenever a split starts or
ends, and resolves when anyone's next record of the task, made having seen
both, settles it (`POST /api/items/:uid/keep-state` keeps this machine's).

**Where they show** (A6.4): each task's Brief page has "Other work
affected", a line per material signal naming the task, from its side
(`briefLine` in `signal-words.ts`: "sales.csv changed since “Q3 report”
cited line 2. This task uses it too."), with the file named and its path on
hover. `get_brief` returns the same as `affected_by_other_work`, refreshing
the project's signals first, because a Claude Desktop agent reads its brief
before anything else. A signal the person dismissed leaves both. The
Awareness card shows each task's sentence and no graph buttons (a material
is not code); the phone's Needs you names the tasks by title with ↔ between
them, and its detail lists the file.

**On record** (A6.5): the sign-off pack lists every material signal that
named one of the plan's tasks, live or resolved, from the task's side, with
how it ended in the words a PR body's "Other work in flight" uses (fixed,
acknowledged by whom, marked intended, set aside) and any note an agent
left (`packSignals` in `signoff-pack.ts`; the page's "Other work that
touched these tasks"). It reads signals as stored: a pack records what was
known when it was made.

`awareness-service.ts` gathers the inputs, runs `computeSignals` and
`computeMaterialSignals` in one pass, and
reconciles into `awareness_signals`. The person's answer and the agents'
notes are stored separately (`awareness_signal_notes`). It broadcasts
`awareness-changed`. The server refreshes signals 500 ms after a watcher
event, for the active project.

## Telling people and agents

- **The digest** (`src/shared/lib/awareness-digest.ts`, A3.1) is pure. It
  lists only open high and medium signals, grouped by kind and workstreams,
  so two worktrees overlapping in four places is one line. Each line says
  what changed, who is affected, whether the agents were told, and what the
  person is asked. It is capped at five lines, then "and N more", and low
  signals are counted rather than listed. The Awareness tab shows it, and
  `get_awareness` returns the same words as `digest`.
- **The Awareness tab** (`components/layout/AwarenessTab.tsx`, in
  `PlanPanel`) shows the digest, then the cards: "Needs you" first, then
  the person's answers (acknowledged / intended / dismissed). It also shows
  which agents were told and what they said, and why a reopened signal is
  back. Its store is `awareness-store.ts`.
- **Agents, asked**: `get_awareness` (the digest plus the signals affecting
  the caller's workstream) and `check_footprint(paths, symbols?)` (who else
  changed these files, and what imports them), then `get_line_changes(path,
  workstream?, diff?)` (B3.1: which of their lines, from git, against each
  workstream's merge base with main, the functions they fall in and whether
  each run is committed; `services/line-changes.ts`, also
  `GET /api/workstreams/changes`). The tools are in
  `mcp/tools/awareness-tools.ts`.
- **The code view** (B3.2, `CodeWorkspace` + `lib/line-marks.ts`): a gutter
  marks the lines this copy changed against its merge base (＋ ～ −) and,
  separately, lines other workstreams change, placed through the base, with
  the same sentence on hover. The strip above names each other workstream
  with its line counts; "Compare with…" opens their copy (`/api/file/at`
  with `at=workstream:<branch>`) against this one in `CodeDiffView`.
- **Agents, not asked** (`awareness-notices.ts`, A2.6): an unseen high or
  medium signal for the caller's workstream is appended once to its next
  tool result as a "── CodeTrellis awareness ──" block. This happens at the
  one interception in `mcp/server.ts`, and
  `sensors.awareness.inlineNotices: false` turns it off.
  `acknowledge_signal(id, note?)` records the agent's note, which never
  sets the person's answer.
- **The person's own words** (`awareness-replies.ts`, A4.1): "Message the
  agents" on a signal (`POST /api/awareness/:id/reply`) keeps the message
  beside the signal. Each session placed in one of its workstreams reads it
  once, on its next tool call, as a "── CodeTrellis: a message about other
  work ──" block under the signal it is about, saying who sent it as the
  call arrived (plain HTTP says it was not verified as the person). Where an
  agent there holds a task, `replyToSignalAsPerson` in `server.ts` also
  posts it as a `steer` on that task's plan. The tab lists each message and
  which agents have read it.
- **The phone** (`mobile-awareness.ts`, A4.2): `openSignals` in the live
  snapshot, and `awareness.needsYou` / `.signal` / `.answer` / `.reply` over
  RPC, in the desktop's words (`src/shared/lib/signal-words.ts`). A reply from
  the phone takes the desktop's path; answers and replies need a confirmed
  pairing and are audited. A high signal opening pushes a phone that is away
  (`pushForSignal`, `newlySerious`, A4.4): ids only, one per kind per minute.
  `workstreams.list` / `.detail` give the strip and each line's turns (A4.3).
  The phone shows them in "Needs you" at the top of Activity, in the
  overlap's detail (where the push lands), and in the lines of work (A4.5b).
  The whole journey, a push to an asleep phone through to the agent reading
  the reply, is the M4 "done when" (`awareness-m4`, A4.6).
  See `docs/claude/mobile-companion.md`.
- **The guide**: `get_app_guide(flavor='parallel')` /
  `codetrellis://skill/parallel` (A3.3) is the contract an agent follows:
  awareness, then intent, then footprint, then fix or ask.
- **Claude Code extras**, offered from Settings and written only on a click
  (A3.4, `services/claude-code-parallel.ts`, IPC only):
  - the `codetrellis-parallel` skill, generated from the guide;
  - an optional `PreToolUse` hook: the connector's `--hook pre-tool-use`
    mode (`mcp/connector/hook.ts`). Before an edit, it runs `check_footprint`
    for the file and returns `additionalContext`. It never approves an edit
    and fails open and silent. Since B4.2 it asks `check_breakpoint` first
    and denies an edit only where a person set a breakpoint on the file,
    as "paused: waiting for a decision" (see `services/code-breakpoints.ts`).
- **Gemini CLI's hook**, offered the same way (A8.3,
  `services/gemini-cli-hook.ts`, IPC only, unticked): one `BeforeTool` entry
  in `~/.gemini/settings.json` (or under `$GEMINI_CLI_HOME`), matching
  `write_file` and `replace`, running the connector's
  `--hook gemini-before-tool` mode. It asks `check_breakpoint` only and
  answers `{"decision":"deny","reason":…}` where a breakpoint holds the
  edit, nothing otherwise. Its format was read from
  `@google/gemini-cli-core` 0.61.0's own source, since its docs site was
  not reachable; the fixture in `gemini-cli-hook.test.ts` is that format.
  A person's steer does not reach Gemini through the hook, because
  `BeforeTool` has no field the model reads when an edit goes ahead; it
  gets the steer from `check_breakpoint` over MCP.
- **Other clients' hooks** are added only once their format is checked
  against the client's own docs or source (A8.3's rule). Until then, a client
  whose hooks run a command uses `--check-edit` (A8.2).

## Review: what else is in flight (A5, M5)

A review answers "did it do what it said" for one plan. Since A5 it also
says what the change means for the other lines of work, and which of them
to merge first. The M5 "done when": reviewing a branch that changes a
function another open line of work imports says so in the review and in the
PR body, and the queue puts that branch first, giving that reason.

- **Branches are compared as committed** (A5.1, `services/commit-edges.ts`).
  Both sides of `commit:<a>` → `commit:<b>` get their import edges:
  - an unchanged file keeps the live graph's edges wherever its targets
    exist at that commit;
  - a changed file is parsed at the commit and resolved by its language's
    resolver.

  So a branch's new dependencies show up as "dependencies nobody planned".
  Imports are cached by blob. When more than 400 files differ from the
  working tree at a commit, that side's edges stay unknown and `edgesNote`
  says why. Branches with work in them are offered as comparands.
- **Other work in flight** (A5.2, `src/shared/lib/other-work.ts`). The
  review picks one line of work: the `after` side's branch, else the
  items' workstream, else the main checkout. It then lists every signal
  naming that line, in `signal-words`:
  - each side in plain words;
  - what became of the signal: open, acknowledged, intended ("a decision,
    not an accident", with who made it), dismissed, or one of the five
    most recent fixed ones;
  - the agents' notes;
  - for a contract, the merge line: "Merging this changes
    validateCreateUser; checkout-fix imports it and will need updating."

  It is in the review's JSON, its markdown and the PR body. The PR draft
  also warns while a high overlap is open.
- **Sign-off can wait for it** (A5.3). Turning on
  `sensors.awareness.holdSignOffOnHighSignals` (off by default; set in the
  project config or through `update_project_config`) makes the `code`
  criterion's check fail while a high overlap naming the line is open:
  "A high overlap with other work is still open (…): … Answer it on the
  Awareness tab, or fix it, and check again." It never merges or blocks
  git. It only holds that criterion's sign-off.
- **The review queue** (A5.4, `services/review-queue-service.ts`). One line
  for each (plan, branch) with plan items. Each line is reviewed against
  the main checkout's branch, and has:
  - a status (`ready`, `held` while a high overlap is open, `waiting` for
    sign-off, `in-progress`, `unavailable`) and a sentence saying why;
  - criteria met, files changed and affected, unplanned dependencies, and
    open overlaps.

  The order comes from `src/shared/lib/merge-order.ts`. Contract
  dependencies decide it: the line that changes something goes before the
  lines that import it. Among lines that are free to go, ready ones come
  first. A cycle is broken at the best-ranked line, and its reason says
  so. Every place has a reason, and the order is advice: nothing is
  enforced.
- **Where it shows.**
  - `GET /api/review-queue` and `get_review_queue` (read).
  - The **Review** tab beside Awareness in `PlanPanel` (A5.5). A line opens
    to its branch's review, with the other work in flight.
  - The phone's **Review queue** (A5.6, `review.queue`), from the Plans
    tab. A line opens `plan-review` compared commit to commit.

## The stack: every plan at once (B6, H1)

The review answers for one line of work; the stack answers for all of them.
The H1 "done when": two agents in two plans on two worktrees, one plan
called by its ticket key, a task waiting on the other plan's task, and the
two lines of work colliding. The window, any MCP client and the phone all
say the same: who is on what and where, "⚠ overlaps JIRA-150" in words with
the signal behind it, and the wait across plans.

- **One dependency rule** (B6.1, `services/plan-dependencies.ts`). A
  dependency is met when its task is done or skipped, in any plan. Unmet
  waits are said in words ("unfinished", "missing", "page"). `get_next_item`,
  `claim_item` (`waits_on`, a warning, and still claims) and the Next up
  strip all use it; a write naming nothing, the item itself or a page is
  refused.
- **The stack** (B6.2, `services/stack-service.ts`, `shared/types/stack.ts`).
  Every plan not completed or archived, called by its ticket key when it has
  one, with its tasks: assignee, session, branch (their own or a section's),
  files named, dependencies resolved across plans, and the wait in a
  sentence. `/api/stack`, `get_stack` (read) and the phone's
  `stack.summary` (read) return the same object.
- **Overlap bands** (B6.3, `services/stack-overlaps.ts`). Declared: both
  plans' unfinished tasks name the same files or functions. Actual: an open
  collision or contract signal between the worktrees their branches are
  checked out in. One overlap per pair, from each side, with `words` and a
  `detail` sentence; a high signal makes it high.
- **The Stack tab** (B6.4, `StackTab.tsx`). One row per plan, tasks nested,
  waits drawn (a wait in another plan is a link to it), overlaps as chips.
  **Follow** is one selection across the window (B6.4b): the graph lights the
  plan's files and the Timeline narrows to its work (`lib/stack-timeline.ts`),
  with a pinned "Showing … work" bar and one Show all.
- **One clock** (B6.5). While replaying, the tab shows the stack at the
  cursor. Nothing new is recorded: each item's last `plan_item_versions`
  row by the moment gives its fields, `plan_events` its status
  (`itemsAt` in `replay-state.ts`), and `stackThen` builds the rows with the
  live stack's own code. `/api/replay/state` and `get_state_at` carry it. A
  plan finished since counts as under way then if it had a task open then;
  an item deleted since cannot be shown.
- **The phone** (B6.6, `mobile/app/stack.tsx`). A card per plan from the
  Plans header: progress, needs you, overlaps in words, On it and Waiting.
- **Work that is not code** (HD3). A plan's roots include its tasks
  (`task:<uid>`), which is how a material signal names them (A6.1), so a
  material `contract` or `collision`, or a `version-split` or `stale-base`
  whose subject is a material, between two plans' tasks is an actual
  overlap. Declared: both plans' unfinished tasks' briefs list the same
  material (role `material` on the task or on a page of its plan), and the
  detail says "Both rely on sales-2026.xlsx." A code stale-base or drift
  never pairs plans. Each task carries `reads`, its latest read of each
  material from `material_reads` (by the moment, in the stack at a moment),
  in words: "read sales-2026.xlsx on 22 Sept (version 3f9c2e1)". The tab
  shows each overlap's detail on the row, not only on hover. Harness:
  `stack-materials.test.ts`; browser: `stack-materials.spec.ts`.

## Play-forward: where the plans will meet (B9, G3)

The stack's overlap bands (B6.3) are today's. Play-forward is what the plans
say they will do: every active plan's unfinished tasks projected at once, and
where two or more will meet if they go ahead. Nothing in it exists yet.

- **The data** (B9.1, `services/play-forward.ts`, `shared/types/play-forward.ts`).
  Files by verb, functions, and the materials the tasks' briefs list, each
  with its plan and task. A planned overlap is two or more plans on one file,
  function or material: "◇ planned overlap: JIRA-142 and JIRA-150 both plan
  to change invoice.ts". The same function, or a delete or move against a
  change, is serious; the same file or material is mild. Tasks that already
  wait on one another make it `sequenced`. Its `id` is the same for the same
  subject and plans, so a decision carries over. Computed on read, never
  stored. `/api/play-forward`, `get_play_forward` (read) and the phone's
  `playForward.summary` (read) return the same object.
- **The window** (B9.2, `PlayForwardBar.tsx`, `lib/play-forward.ts`). "Play
  the plans forward", beside Replay and in the Stack tab: the bar, dashed
  planned files on the graph, a dashed "◇ planned overlap" zone on the
  cluster that holds each one, and "◇ will overlap …" under each plan in the
  stack. Replay and play-forward are one clock: entering one leaves the other.
- **Deciding one** (B9.3a, `services/planned-overlap-actions.ts`). A person
  re-sequences the plans (the one chosen goes first, and the other plans'
  tasks in it wait on its tasks through ordinary dependencies, so every
  "what is next" door holds them back; a choice that would make tasks wait on
  each other is refused), tells the agents (each session holding a task in it
  is told once, on its next call, "── CodeTrellis: planned overlap ──"), or
  leaves it (drawn quieter). Each decision is kept by the overlap's id with
  who, from the transport, and when. `POST
  /api/play-forward/overlaps/:id/(resequence|tell|leave)`. No MCP tool
  decides.
- **On approval** (B9.3b). Approving a plan into a planned overlap that no one
  has answered (not sequenced, not left) says so in the approval's answer
  (`plannedOverlaps`, from REST and from the phone's `plan.update`). The
  Awareness inbox says it once ("Approving JIRA-150 puts it in a planned
  overlap"), with Play forward and Seen.
- **The phone** (B9.3b–B9.4, `mobile/app/stack.tsx`, `mobile/lib/play-forward.ts`).
  The Stack screen opens with "Played forward": the words, the unseen
  approvals, and each planned overlap with what was last decided and the
  window's three choices (`playForward.decide`, write, as the phone's
  person). Each plan's card says where it will meet another. A desktop
  without play-forward still shows the stack.

## Conferring: when the spec is wrong (B7, I1)

A plan's spec lives in pages (Object items). When an agent finds one is
wrong, the change is proposed, the plans relying on it say what it means
for them, and a person decides. The I1 "done when": the billing agent
proposes adding `currency` to the invoice format's Fields with the failing
test; two other plans rely on that section; their agents are told once and
reply "no change needed" and "one new column"; Sam sees one proposal with
both impacts and accepts it; the page has a new version, both tasks are
marked "spec changed" and their agents told. The window, any MCP client
and the phone agree throughout.

- **What relies on what** (B7.1, `services/spec-links-service.ts`). A task
  names the pages, or headings by their slug, it relies on (`relies_on` on
  `add_item` / `update_item`, `PUT /api/items/:uid/relies-on`); a page shows
  "Relied on by 2 tasks in 2 plans". Sections come from
  `shared/lib/spec-sections.ts`.
- **A proposal** (B7.2, `services/spec-proposals-service.ts`).
  `propose_spec_change` keeps the page's version then, the text, why, the
  evidence and every task relying on it, and changes nothing.
- **Told once, and a reply** (B7.3). Each session holding a relying task is
  told on its next call ("── CodeTrellis: spec change proposed ──"), never
  the proposer; `reply_to_spec_proposal` keeps `none` or `changes` with a
  sentence, from that plan, and posts a `weigh-in` in the proposer's plan.
- **A person decides** (B7.4). The proposal waits in the inbox as a
  `proposal` breakpoint hit (Accept, Amend, Reject), decided over REST or the
  phone only, never a tool. Accepting writes the page's new version as the
  person and flags every relying task "spec changed" until its agent is told
  ("── CodeTrellis: spec changed ──"); the proposer is told the outcome once
  and can `await_decision` on it. Deleting the page or plan withdraws it.
- **Guarded pages and documents** (B7.5). A `spec` breakpoint on a page
  others rely on holds a direct edit and says who relies on it and to
  propose instead; a proposal to it is not held and carries the person's
  note. A legacy plan document is guarded too: its file edited on disk is
  held as "changed on disk" (`services/plan-doc-guard.ts`), apply the file
  or keep the app's version.
- **The phone** (B7.6, `services/mobile-proposals.ts`). The proposal in
  Waiting on you with every reply, in the words the window uses
  (`shared/lib/proposal-words.ts`), accepted or rejected as the person.

## The Brief: work that is not code (A6, M6)

One analyst runs several Claude Desktop sessions on several tasks, and the
tasks share material: a sales workbook, a board deck. The M6 "done when":
finance replaces a workbook that two tasks cite; both tasks' agents are told
on their next call, once; each agent's brief says it from its task's side;
the person sees it once in the digest, on the desktop and the phone, as one
signal naming both tasks.

- **A task is a workstream** (A6.1, `services/task-workstreams.ts`).
  `get_brief(item_uid)` binds the calling session to that task (the latest
  wins); the task is `task:<uid>` wherever a signal names workstreams. The
  strip and the phone list tasks beside the branches; `noticeFor` and
  `get_awareness` match a session's task as well as its folder.
- **Its footprint is what it read** (A6.2, `services/material-footprints.ts`).
  `read_material` keeps each read in `material_reads` (session, part, the
  file's hash then), counted for the session's task; with the outputs
  recorded and the parts cited, that is the task's footprint.
  `get_brief.read_so_far` shows it.
- **Material signals** (A6.3): the table under Signals above, computed in the
  same refresh as the code signals; the artefact watcher refreshes on a
  change.
- **Where they show** (A6.4): the Brief page's "Other work affected",
  `get_brief.affected_by_other_work`, the Awareness card, the digest, the
  inline notice and the phone.
- **On record** (A6.5): the sign-off pack lists each signal that touched a
  task and how it ended.
- **The guide** tells every agent what "Other work affected" means and to
  re-read, re-check its citations and resubmit when a shared file changes
  (`skill-guide.ts`, "When other tasks share your files").

## Any agent: what every client gets (A8)

CodeTrellis is agent-agnostic. The rule: a feature ships with the path
every MCP client has (tool calls, folder watching, git); a client's own
hook or log may make it earlier or richer, never the only way. Each row is
run as a plain `codex` client with no hook and no watcher in
`tests/e2e/any-agent-parity.test.ts`.

| Feature | Any MCP client | What a client's own hook or log adds |
|---|---|---|
| Workstreams, who is where | `list_workstreams`; the session is placed by its MCP roots or the connector's working folder (A1.1) | Claude Code's session watcher places a session before its first MCP call |
| Signals | `get_awareness`, and unseen ones appended to its next tool result (A2.6) | — |
| Footprints and line changes | `check_footprint`, `get_line_changes` (B3.1), from git | — |
| Declared intent | `declare_intent` | — |
| Review and merge order | `review_plan` and `get_pr_draft` carry the other work in flight; `get_review_queue` gives the order with reasons (A5) | — |
| Task and spec breakpoints | enforced at the MCP interception: the call returns "paused" with a ref; `await_decision`. The person answers from the window's inbox or the phone (B4.4), with a push when the phone is away | — |
| Code and function breakpoints | `check_breakpoint(path, old_text)` before an edit (the guide tells every agent to); an edit made without checking is a breach on its next call. A client whose hooks run a command, or a wrapper script: the connector's `--check-edit <path>` exits 2 when held (A8.2) | Claude Code's `PreToolUse` hook and Gemini CLI's `BeforeTool` hook (A8.3) make the check themselves and hold the edit before it is made, sending the replaced text |
| Signal breakpoints | claims, finishes and spec edits pause while the signal is open | hooked edits pause too |
| Skills | the task's skills, where to find them, in `get_brief`, `claim_item` and `get_next_item` (C1.1); `get_skill(name)` loads one and is the proof of use, labelled "read through CodeTrellis" (A8.4) | Claude Code's session log also proves a skill it loaded itself (C1.3), labelled "session log" |
| Tasks and their materials (A6) | `get_brief` binds the session to its task; `read_material` is the footprint; `affected_by_other_work` in the brief and the notice on the next call; the person answers in the window or on the phone | — |
| Spec proposals (B7) | `propose_spec_change`, `reply_to_spec_proposal`, `get_spec_links`, `list_spec_proposals`; the notices ride on the agent's next call; `await_decision` on the proposal. The person decides in the window or on the phone | — |
| Setup | the MCP connector config (Settings → MCP Server: a JSON entry for Claude Desktop, Cursor and most clients) | Claude Code's skill and hook installer (A3.4); Gemini CLI's hook installer (A8.3) |

## Architecture rules: the team's boundaries (A7, M7)

A rule is a boundary between two sets of paths, written once by a person in
Settings → Architecture rules and committed in `.codetrellis/config.json`:
`from` may not import `mayNotImport`, `except` some doors, `because` the
team's reason. One file every laptop, agent and pipeline reads.

- **Today** (A7.1): each rule lists the imports that already break it ("1
  import breaks this today"); `check_conformity` refuses a proposed import
  with the rule and why; `list_rules` reads them.
- **In flight** (A7.2): an import a workstream *adds* (its changed files'
  imports now, minus at its merge base, resolved by the project's resolver)
  raises a high `rule` signal. The agent is told inline on its next call,
  the person reads one digest line and a card with the rule, the import
  and a way to change the rule; a `rule` breakpoint can hold the agent.
- **At the gate** (A7.3): `check_changes` with `base` lists each added
  import across a rule, and `codetrellis check` exits 3 on it. Rules are
  committed, so unlike breakpoints they hold in CI too.

Only the project whose graph is loaded is checked, because resolving needs
its aliases and systems; anything else says the rules were not checked.

## Rules to keep

- **An agent is never handed another agent's text** (principle 5).
  Notices, the digest and the hook describe changes from git and the
  parser. Intent summaries are shown to the person and to their author,
  never to other agents.
- **Roots never come from a request.** Folders an agent reports only choose
  among trusted roots, and a clone needs the person's consent.
- **Only the person answers a signal.** An agent's note sits beside the
  answer.
- **A person's message reaches only the agents in the signal's
  workstreams**, quoted as theirs, and is never shown to an agent as
  another agent's words.
- **Only a person decides a planned overlap.** An agent reads play-forward
  and is told; it never re-sequences, tells or leaves one.
- **Nothing is installed silently.** The skill and the hook follow Add to
  Claude Desktop: a diff first, then only what was ticked, from the app
  window only.

## Tests worth knowing

- Unit:
  - `awareness-signals.test.ts` (the rules);
  - `awareness-digest.test.ts`;
  - `awareness-notices.test.ts`, `awareness-replies.test.ts`, `mobile-awareness.test.ts`;
  - `src/shared/lib/signal-words.test.ts`, `other-work.test.ts`, `merge-order.test.ts`;
  - `commit-edges.test.ts`, `hold-on-high-signals.test.ts`;
  - `workstream-*.test.ts`;
  - `claude-code-parallel.test.ts`, `gemini-cli-hook.test.ts`;
  - `connector/hook.test.ts`.
- Harness, all on real worktrees:
  - `awareness` (M1: collisions and stale base), `awareness-answers`;
  - `awareness-contract`, `awareness-contract-languages` (Go and Kotlin),
    `awareness-drift`, `declare-intent`;
  - `awareness-notices`, the M2 "done when";
  - `awareness-cooldown`;
  - `awareness-replies`: a message read once by each agent in either
    workstream and never by a third, and the steer on the plan;
  - `phone-signal-push`: a contract opening with no window pushes an asleep
    phone once, in words naming nothing, and not an open one;
  - `phone-workstreams`: the list and a line's files and turns;
  - `phone-awareness`: the live count, the list and a side-by-side detail on
    a paired phone, a reply the agent reads as from the phone, and an answer
    that is the person's;
  - `parallel-hook`, `check-edit`, `gemini-hook`;
  - `awareness-m3`, the M3 "done when": five workstreams, seven overlaps,
    a five-line digest well under a minute to read, and intended staying
    quiet until a side changes shape;
  - `awareness-m4`, the M4 "done when": a contract pushes Sam's asleep phone
    once, with only the id. The phone opens the signal by that id and
    replies. The reply is the person's, from their phone, and it is posted
    as a steer on the task the other agent holds. That agent reads it once
    on its next call and finds the steer on its task.
  - `review-commit-edges`, `review-other-work`, `hold-on-high-signals`,
    `review-queue` (with a paired phone);
  - `task-workstreams`, `material-footprints`, `material-signals` (A6);
  - `awareness-m6`, the M6 "done when": a replaced workbook two tasks cite
    is one signal naming both, told once to each agent on its next call,
    said from each task's side in its brief, and one line in the digest on
    the desktop and the phone;
  - `play-forward`, `planned-overlap-actions`, `play-forward-approval`;
  - `play-forward-g3`, the G3 "done when": two approved plans that both plan
    to change one file. The window, an MCP client and the phone agree on
    play-forward and on the stack. Re-sequencing from the window makes the
    later plan's task wait, everywhere. Telling both agents from the phone
    reaches each once, and the decisions read the same on all three;
  - `awareness-m5`, the M5 "done when": billing-v2 changes a function
    checkout-fix imports. Its review (JSON and markdown) and its PR body say
    so, and the queue puts it first with that reason, for three different
    agents and the phone. Once the overlap is marked intended both lines
    are ready and the order stands.
  - `architecture-rules`, `rule-signals`;
  - `awareness-m7`, the M7 "done when": two agents in two worktrees, one
    adds an import across a rule. It alone is told, on its next call; the
    digest has the one line; and `codetrellis check` on the branch exits 3
    naming the import and the rule, then passes once it is taken out.
  - `cross-plan-dependencies`, `stack`, `stack-overlaps`, `stack-at`;
  - `awareness-h1`, the H1 "done when": two agents in two plans on two
    worktrees whose work collides, one plan by its ticket key and a wait
    across plans. The window, an MCP client and a paired phone return the
    same stack; `get_state_at` before the second plan existed has the first
    alone; and once the awaited task is done the wait is gone for all three.
  - `spec-links`, `spec-proposals`, `spec-impacts`, `spec-decide`,
    `spec-held-edits`, `plan-doc-guard`, `phone-proposals`;
  - `conferring-i1`, the I1 "done when": one proposal with the failing test,
    two relying plans told once and replying, the proposer never told of its
    own; one proposal with both impacts for Sam, the same from REST, an MCP
    client and a paired phone; accepted as the person, a new page version,
    both tasks marked "spec changed" and each agent told once.
- Phone screens: `tests/phone/awareness.spec.ts` (`npm run test:phone`)
  photographs Needs you, the overlap and its reply, and the lines of work;
  `tests/phone/review-queue.spec.ts`, the queue and the review a line opens;
  `tests/phone/stack.spec.ts`, the stack; `tests/phone/proposals.spec.ts`, a proposal waiting.
- Browser: `e2e/plan/spec-links.spec.ts`, `spec-decide.spec.ts`, `spec-held-edit.spec.ts`, `plan-doc-guard.spec.ts`, `e2e/plan/stack-tab.spec.ts`, `stack-follow.spec.ts`, `stack-replay.spec.ts`, `cross-plan-waits.spec.ts`, `e2e/agent/review-tab.spec.ts`, `e2e/agent/awareness-tab.spec.ts`, `e2e/agent/awareness-reply.spec.ts`, `e2e/agent/workstream-strip.spec.ts`,
  `e2e/settings/mcp-server.spec.ts`.
