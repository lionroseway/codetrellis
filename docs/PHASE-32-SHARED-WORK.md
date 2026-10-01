# Phase 32 — Shared ways of working (track C)

> Repeatable, visible, well-guided work: skills on tasks, team status
> through git, a separate repo for CodeTrellis files, and recurring
> plans.

Status: **plan**. Build track C of Phase 32, alongside A (awareness,
[PHASE-32-PARALLEL-AWARENESS.md](PHASE-32-PARALLEL-AWARENESS.md)) and B
(observability, [PHASE-32-OBSERVABILITY.md](PHASE-32-OBSERVABILITY.md)).
Steps are in [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md).

These four belong together because each one is about **work that other
people, or later runs, have to repeat or read**. They also reinforce each
other:
- A recurring playbook carries its skills.
- A task's status says which skills it used, read from its records.
- A shared plans folder, carried by git or by a cloud-synced folder, is
  where those records live, for developers and business teams alike.

---

## C-1. Skills on plans and tasks

### What exists

Items already carry `skills: Skill[]` with `{ name, source, required }`
(`shared/types/plan.ts:300-304`), and they cascade down the tree
(`plan-item-service.ts:930-951`). They're edited in `ItemRoutingPanel.tsx`
and exported to plan files.

But the field is **only a claim gate**:
- `match-skills` refuses a claim when the agent hasn't declared a
  required skill (`plan-item-service.ts:1052-1070`).
- Agents declare skills themselves in `register_session`, and almost
  none do.
- `get_brief` never mentions skills.
- There's no record of **where** a skill lives, and no record of
  whether it was **used**.

### Design

**1. Required or recommended.** `Skill` gains:

```ts
interface Skill {
  name: string;
  source: 'mcp' | 'skill' | 'lang' | 'plugin';
  required: boolean;          // unchanged: gates claims
  use?: 'recommended';        // new: "use this for this task"
  why?: string;               // one line, shown to agent and person
  where?: SkillLocation;      // new: where to find it
}

type SkillLocation =
  | { kind: 'repo'; path: string }       // .claude/skills/<name>/SKILL.md in this repo
  | { kind: 'plugin'; name: string }     // an installed plugin
  | { kind: 'mcp'; server: string }      // an MCP server's tools
  | { kind: 'playbook'; uid: string }    // a CodeTrellis playbook
  | { kind: 'link'; url: string };       // shown to people only (see safety)
```

Old files without the new fields read exactly as before.

**2. The picker knows what's available.** A skills index scans the
opened project's `.claude/skills/*/SKILL.md` and reads each skill's name
and description from its front-matter. The routing panel gets a
searchable list:

```
┌─ Skills for "Currency support" ──────────────────── inherited from plan ▾ ─┐
│ ✓ pr-review         recommended · .claude/skills/pr-review                 │
│     why: this task ends in a PR                                            │
│ + add skill…   ┌──────────────────────────────────────────┐                │
│                │ release-notes   Write release notes for… │                │
│                │ migrations      How we write DB migra…   │                │
│                └──────────────────────────────────────────┘                │
└────────────────────────────────────────────────────────────────────────────┘
```

**3. Agents are told when it matters.** `get_brief`, the `claim_item`
result and `get_next_item` gain a skills block:

> **Skills for this task:** use **pr-review**
> (`.claude/skills/pr-review/SKILL.md`), because this task ends in a PR.

A Claude Code agent launched from a CodeTrellis terminal preset for a
task gets the same line in its opening prompt.

**4. Proof of use.** Claude Code records each skill it loads as a
`Skill` tool call in its session log. The Claude Code watcher already
reads tool calls, and after A-M0 it reads every one. It records
`skill_used` against the session's task. The task then shows
"✓ used pr-review" or "○ recommended, not used", and so do the timeline
and the sign-off pack. For other clients, use is unknown and shown as
unknown, never as "not used".

**5. When it's missing.** If a recommended `repo` skill doesn't exist in
the agent's workstream (for example, a worktree on an old branch), or a
`plugin` isn't installed, the brief says so and says how to get it.

### Safety

A skill is instructions an agent follows with full trust, and plan files
arrive through git from anyone who can push. So:

- **Agents are only pointed at `repo`, `plugin`, `mcp` and `playbook`
  skills.** A `repo` path must resolve inside the opened project through
  `confined-fs`, and must not be a link.
- **A `link` is shown to people, never to agents.** It's never in a
  brief, never in a prompt.
- **A new skill arriving in a pulled plan file is flagged once** in the
  inbox ("JIRA-142 now recommends skill X, added by Priya in abc123")
  before any agent is told to use it.

## C-2. Team status through git

### What exists

Once a plan is linked to a folder, write-through exports it
automatically (`plan-file-service.ts:840-866`) to
`.codetrellis/plans/<slug>/`. Each item's YAML carries:
- status, assignee (with type and model), progress
- blocked reason
- dependencies, file and symbol specs
- constraints, `requiresApproval`
- attachments and comments

(`serializeItem`, `plan-file-service.ts:1088-1175`). Channel events are
exported beside them. Deployment shapes and field-level merge are
designed (`docs/cdev/03`, `04`) and partly built (`plan-conflict-service`).

**Gaps:**
- **It's machine-readable, not people-readable.** A teammate on GitHub
  sees YAML, not status. That is the right source (the owner's point,
  2026-09-30: status a program can read); what was missing is a view,
  and the view belongs in the app, not in another file.
- **Ticket links aren't in the files.** `external_refs` and
  `plan_external_refs` aren't serialised, so ticket → plan lineage stops
  at the machine that did the intake.
- **History isn't in the files.** `plan_events` is local. Git history of
  the files is the substitute.
- **Approvals are deliberately absent** (`criteria-service.ts:630-634`),
  because a committed file must not be able to claim a person approved
  something.

### Design

**1. Status is read, not written** (the owner's point, 2026-09-30,
replacing a generated `STATUS.md` per plan). Phase 32's own tracker moved
from Markdown to YAML holding only intent, with state read from git
(#246); plans work the same way:

- **Intent is written**, in the plan's YAML files: what the plan and its
  tasks are, their refs, and the approvals (below).
- **State is derived**, each with its source: git for a task on a branch
  (building, pushed, merged, §5), a host when one is turned on (in review,
  checks), and the plan itself for everything else ("in progress, from
  the plan": its status, evidence and sign-off, each with who recorded
  it). A task with no branch, such as an analyst's report, is never shown
  as less certain than a code task beside it.
- **No summary file.** A generated file that is committed drifts (the
  hand-kept Now block did), and one rewritten on every change is noise in
  git and a clash waiting to happen in a synced folder (C-3). The view
  below is what the plan's status says in the window, on the phone and to
  an agent's `get_plan`; it is not a file:

```text
# Billing v2 · JIRA-142
████████░░ 8 of 10 tasks · updated 26 Sep 14:02

## Waiting on someone
- ⏸ Currency support — waiting on Sam: spec change to Invoice format
- ⛔ Update exports — blocked: waits on "Currency support"

## In progress
- ▶ Currency support — billing-v2 (Claude Code) · skill: pr-review

## Recent
- 13:40 Priya commented on "Invoice format": "EU needs ISO codes"
- 11:02 ✎ billing-v2 proposed a change to Invoice format

## Lineage
JIRA-142 → this plan → PR #118 (open) → 14 commits
```

Whether people without the app get an export (generated on demand, never
committed or rewritten on a change) is an open question for C3, which
decides what a shared folder holds for them.

**2. Ticket links exported.** `plan.yaml` and item files gain `refs`
(ticket keys and URLs), so lineage survives git.

**3. Approvals as signed statements** (for teams that need them). An
approval is exported as a small signed record: criterion, evidence
hashes, who, when, signature. A plain edit to a file can't forge it, and
the app verifies it on import and shows "✓ verified" or
"⚠ can't verify". Signing uses the approver's git signing key when one
is set up. Without one, approvals stay local, as today. (Built in C2.5b
with git's SSH signing: `ssh-keygen -Y sign`, verified against git's
`gpg.ssh.allowedSignersFile`. There is no device signing key to reuse:
pairing proves a shared secret, so C-3's signed records will need one of
their own or the same git key.)

**4. Seeing teammates' plans.** After a pull, plans authored elsewhere
appear with their author, and the stack view (B6) shows them like any
other. Fetching stays manual or opt-in; the app never fetches on its
own.

**5. Where status comes from: git first, a host only if asked** (the
owner's point, 2026-09-30). Teams use GitHub, GitLab, Bitbucket, Azure
DevOps, Gitea, a self-hosted server, or no host at all. Everything the app
reads today (workstreams, Timeline lanes, squash-merge detection) is local
git, and C2 keeps it that way for everything git can prove:

| State | How it is known | Needs a host? |
|---|---|---|
| Building | the item's workstream branch exists | no |
| Pushed | the branch is on the remote | no |
| Merged | the work reached the base: ancestry for a merge or fast-forward; for a squash or rebase, the branch's changes are in the base (bug 53's check), or the merge commit names the item's key | no |
| In review | an open PR / MR | **yes** |
| Checks, approvals, review comments | the host's CI and review | **yes** |
| Closed without merging | the host; git only sees a branch that stopped | **yes** |

What only a host knows comes through a small **review-host interface**
(open reviews for a branch, their checks and approvals, merged or closed),
with one adapter per host, chosen from the remote URL: GitHub first, then
GitLab and Bitbucket; Azure DevOps and Gitea later, on the same interface.

- **Off until the person turns it on, per project.** CLAUDE.md: the only
  request the app makes on its own is the update check, and remote
  surfaces are off by default. An adapter is a remote surface. Settings
  name the host and what will be asked; nothing is sent before that.
- **Credentials in the OS keychain**, per host, never in the repo, a plan
  file or the database. A public repo can be read without one.
- **Honest words without one.** With no adapter the app says what git
  proves: "pushed, not merged", never "in review", and a closed branch
  reads "stopped" rather than a guess. Each state carries its source
  (git, which host, or the plan), in the window, on the phone and to
  agents.
- **Agents read it the same way**: the plan's MCP tools report each item's
  state with its source, so an agent on a Bitbucket project is not told
  less than one on GitHub, only honestly less when no adapter is on.

**6. The first plan to use it is Phase 32's own.** Phase 32's status is
generated today by `npm run status` (`tools/status/`), which reads the
same facts for this one GitHub repository: the squash commit titled
`Phase 32 <id>: … (#N)`, open PRs, step branches. C2 ends with that plan
in CodeTrellis, each step an item whose workstream is its branch, and its
status what the app itself reads; the script then reads from the app, or
goes.

## C-3. A separate repo for CodeTrellis files

### What exists

The "central oversight" shape (`docs/cdev/03-deployment-shapes.md`):
- a planning repo with `repoRole: "planning"`
- code repos carrying pointer files in `.codetrellis/external/`
  (`external-pointer-service.ts`), written by `add_plan_scope`.

Access to the planning repo is access to the plans, so an auditor can
see every plan without access to the code.

**Gap:** Phase 32 needs the **code** repo's graph (footprints, collision
zones, grounding), and the app loads one project graph at a time
(CURRENT-STATE §1). Today you'd open either the code or the plans.

### Design

**Linked planning repo.** A code project's `.codetrellis/config.json`
can name its planning repo:

```json
{ "repoRole": "code", "plansRepo": { "origin": "git@…/acme-plans.git" } }
```

- The code project is opened: the graph, workstreams and signals all
  come from it.
- Plans are read from, and written through to, the planning repo's local
  clone. It's found by origin among opened or recent projects, and the
  user confirms it once, the same consent pattern as clones in A §5.1.
- If the clone isn't on this machine, the pointers show plan stubs, as
  today, with "clone the planning repo to see full plans".
- The planning repo becomes the org's status board: every plan's records
  are there, and the app reads status from them (C-2 §1), writing no
  summary file.

**Carried by git or by a synced folder** (the owner's point, 2026-09-30).
A business team shares a OneDrive, SharePoint, Google Drive or Dropbox
folder the way developers share a repository: everyone has a copy, and it
carries changes between them with no server of ours. So the plans folder
can live in either, with one layout. A sync is not git, and the layout is
chosen for that:

| | git | cloud-synced folder |
|---|---|---|
| Two people edit one file | a merge conflict to resolve | last writer wins, or a "conflicted copy" appears |
| History | complete | partial, per file |
| Arrival | a whole commit at once | file by file, in any order, some still placeholders |
| Who wrote it | the commit author (claimed) | nothing |

So sync clashes cannot happen by construction, rather than being handled
after:

1. **One writer per file, only ever added.** Each person's app writes
   only its own records, `.codetrellis/records/<plan>/<task>/<writer>-<counter>.yaml`,
   and the state everyone sees is read from all of them. Two people
   acting at once make two files, so neither a sync nor git has anything
   to fight over; the same layout ends merge conflicts in a git planning
   repo. A writer compacts only its own records.
2. **Partial arrival is normal.** A record not yet synced leaves a
   teammate behind, never wrong; reading a record twice changes nothing;
   a "conflicted copy" a sync client makes is read as one more record,
   never dropped.
3. **A real disagreement is a signal, never a silent pick.** "Sam marked
   this done and Alex marked it blocked within the same minute" goes to
   the inbox naming both, as awareness treats every clash.
4. **Order does not trust clocks.** Laptop clocks drift, so each record
   carries its writer's counter and the last counter it had seen from
   each other writer, as well as a time.

Three things need care:

- **Trust.** Anyone who can write to the folder can write a file claiming
  to be anyone. Every record's author comes from how it arrived (the
  authorship rule), so each device signs its records with the key it
  already holds for pairing, the same mechanism as signed approvals
  (C-2 §3); an unsigned or unverifiable record reads "unverified", as a
  plain HTTP call does. Records are untrusted input: parsed safely, size
  limited, read through the confined-file helper, and never a source of a
  path or project root.
- **Files on demand.** OneDrive and its peers leave placeholders that
  download when opened. The app never reads a whole folder to hash it:
  only files already on the device, or cited by a task, are hashed, and a
  placeholder is shown as "not on this device".
- **Paths differ per machine** (`C:\Users\Sam\OneDrive - Acme\…`), so a
  material is known by its place in the shared folder and its content
  hash, never by its full path.

It stays within the security rules: off by default and turned on per
folder; the sync client moves the files, so the update check stays the
only request the app makes on its own.

**Teammates' material reads.** With the team's say-so, each app also
writes which version of each material its tasks read (A6.2) as records.
A6's signals then work across people: "Alex's task used last week's
`sales-2026.xlsx`; Sam replaced it on Tuesday." This is the most useful
part and the most revealing (who opened which file), so it is a separate
switch from sharing plans.

**Open questions for the owner, when C3 is next:** which providers are
detected and tested first (OneDrive and SharePoint are the likely start;
Google Drive and Dropbox look the same on disk); what people without the
app see in the folder (nothing, or an export on demand); and whether
teammates' material reads are shared by default once a folder is on.

## C-4. Recurring plans

### What exists

Nothing recurs. Phase 31 designed a playbook cadence for **re-running
checks** (`PHASE-31…md:871-874`), and the `scheduled` check-run trigger
exists with no caller (`criteria.ts:105`). Playbooks (templates with
criteria) exist (Phase 31 §14).

### Design

**1. Recurrence lives on a playbook.** "Run *Weekly security review*
every Monday 09:00", stored in the manifest so the team sees it.

**2. Each run is a fresh plan**, with:
- `recurrence: { rule, period: "2026-W40", previous: <uid> }`
- the playbook's items, criteria and skills
- optionally, open items carried over from the previous run, marked
  "carried from W39".

**3. One ID per period.** The run's uid is derived from the rule uid and
the period. If two machines create W40, git sees the same directory, not
two plans.

**4. Missed runs are shown, not back-filled.** The app only acts while
running. On launch: "Weekly security review is due since Monday. Start
it?" If a period passes with no run, the series shows "W39: missed".

**5. Each run stands alone for audit.** It has its own evidence and
sign-off. The series view is one row per period with ✓ done, ◐ in
progress, or ✗ missed.

**6. Starting an agent is opt-in.** Creating the run is automatic.
Launching an agent on it needs the `terminal` capability, and is a
per-playbook setting that's off by default.

```
Weekly security review            every Mon 09:00 · skill: security-review
 W37 ✓ signed Sam      W38 ✓ signed Sam      W39 ✗ missed      W40 ◐ in progress
```

## Tests

Each part lands with:

- **Unit tests**
  - skill resolution: cascade and new fields round-tripping through plan
    files
  - skill location confinement
  - state derivation: a task with no branch says "from the plan"
  - records: reading all writers' records, a duplicate, a conflicted
    copy, a record not yet arrived, two writers disagreeing
  - signed-approval verify: valid, tampered, unknown key
  - recurrence period and uid derivation
  - missed-run detection
- **Harness tests**
  - A brief shows recommended skills.
  - A watcher fixture with a `Skill` call marks "used".
  - A state change writes no summary file.
  - Two apps on one synced folder (two data dirs, one folder) each write
    only their own records and read the same state; a disagreement is a
    signal; an unsigned record reads "unverified".
  - A linked planning repo round-trip.
  - A recurring playbook creates exactly one W40 run, even when triggered
    twice.
- **Guards**
  - capability rows for every new MCP tool and RPC method
  - `reachable.test.ts` for the new components
  - confinement tests for the skills index and planning-repo paths
