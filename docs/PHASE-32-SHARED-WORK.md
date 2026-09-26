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
- The git status file shows which skills each task used.
- A separate planning repo is just where those status files live.

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
  sees YAML, not status.
- **Ticket links aren't in the files.** `external_refs` and
  `plan_external_refs` aren't serialised, so ticket → plan lineage stops
  at the machine that did the intake.
- **History isn't in the files.** `plan_events` is local. Git history of
  the files is the substitute.
- **Approvals are deliberately absent** (`criteria-service.ts:630-634`),
  because a committed file must not be able to claim a person approved
  something.

### Design

**1. `STATUS.md` per plan, and one index.** Generated on the same
write-through, plain markdown readable on GitHub:

```markdown
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

`.codetrellis/STATUS.md` lists every plan in the repo with one line each.

**2. Ticket links exported.** `plan.yaml` and item files gain `refs`
(ticket keys and URLs), so lineage survives git.

**3. Approvals as signed statements** (for teams that need them). An
approval is exported as a small signed record: criterion, evidence
hashes, who, when, signature. A plain edit to a file can't forge it, and
the app verifies it on import and shows "✓ verified" or
"⚠ can't verify". Signing uses the approver's git signing key when one
is set up. Without one, approvals stay local, as today.

**4. Seeing teammates' plans.** After a pull, plans authored elsewhere
appear with their author, and the stack view (B6) shows them like any
other. Fetching stays manual or opt-in; the app never fetches on its
own.

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
- STATUS files (C-2) are written in the planning repo, so the planning
  repo becomes the org's status board.

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
  - STATUS.md rendering from fixtures
  - signed-approval verify: valid, tampered, unknown key
  - recurrence period and uid derivation
  - missed-run detection
- **Harness tests**
  - A brief shows recommended skills.
  - A watcher fixture with a `Skill` call marks "used".
  - Write-through produces STATUS.md.
  - A linked planning repo round-trip.
  - A recurring playbook creates exactly one W40 run, even when triggered
    twice.
- **Guards**
  - capability rows for every new MCP tool and RPC method
  - `reachable.test.ts` for the new components
  - confinement tests for the skills index and planning-repo paths
