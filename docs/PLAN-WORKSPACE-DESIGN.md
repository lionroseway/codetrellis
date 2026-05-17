# Plan Workspace — Journeys-First Design

**Status:** draft v0.6 (inline code context model — @-tag authoring)
**Last updated:** 2026-05-04

## The purpose

The plan workspace is **durable memory** for engineering work. It
serves three audiences with a single surface:

- **A human building a plan for themselves.** Notepad, second brain,
  data room. Useful with zero agents connected.
- **A human watching an agent build a plan.** Agent drafts the
  structure; the human reads, edits, redirects.
- **An agent picking up where another agent left off.** Claude Code
  hits its context limit; Codex reads the same plan and continues.
  The findings — not just the artifacts — survived.

The same surface serves all three because it captures both halves of
the work: the **artifacts** (the markdown files, the task lists, the
URLs) *and* **the thinking** (why, alternatives ruled out, what
surprised us). The thinking is what dies inside an agent's context
window today. The plan workspace is where it lives durably.

The fourth value sits on top: **graph anchoring.** When work items
tie to actual files / symbols / edges in the codebase, drift becomes
visible — *"agent said it'd touch these three files; here's what
actually changed."* Refactors and migrations become verifiable, not
faith-based.

## The two primitives

Inside a plan, every item is one of two things:

- **📋 Object — context.** Markdown body, attachments, sub-items.
  Templates seed common shapes (Executive Summary, References, UX
  Journey, Competitor Analysis, …) but the user is free to add
  anything. Objects do not anchor to the graph.
- **⚡ Action — work item.** A prompt for an agent (or a todo for a
  human), optionally anchored to files / symbols / edges with CRUD
  intent (create / modify / delete / move). Status, progress,
  comments, attachments. Actions can be one-line natural language or
  fully spec'd.

**Both nest. Both can mix.** An Action can have an Object hanging off
it (its references). An Object can have Actions hanging off it
("Action: interview 3 users" inside a "UX Research" Object). Depth is
the user's call — a plan can be a single Action with one prompt, or
five Objects deep with twenty Actions threaded through.

```
PLAN  "Add 2FA to login"
│
├─ 📋 Executive Summary           (Object)
├─ 🔍 Competitor Analysis         (Object)
│  ├─ Competitor A                 (Object — sub-page)
│  └─ Competitor B                 (Object)
│
├─ ⚡ Phase 1 — Foundation         (Action — groups child Actions)
│  ├─ ⚡ Wire types                  (Action — leaf)
│  ├─ ⚡ Add /verify-2fa endpoint    (Action)
│  │  └─ 📎 References              (Object — Action's own context)
│  │     ├─ Figma link
│  │     └─ RFC URL
│  └─ ⚡ Add tests                   (Action)
│
└─ ⚡ Phase 2 — Migration          (Action)
```

A plan with no Actions is a structured second-brain. A plan with
Actions becomes graph-anchored and drift-checkable. Same surface,
user picks the depth.

---

## The authoring model — body-first, @-tag driven

The body is the prompt. Everything starts with natural language.

A human writes into the body the same way they'd prompt an AI agent:
*"Look at the auth module, specifically `signToken`, and refactor it
to accept a `scope` parameter. Then update everything that calls it."*

That's a valid Action. No structured data required. But when the user
wants precision — or when an AI agent is expanding a human's loose
intent — the `@` trigger brings the codebase into the body inline.

### How @ works

Type `@` anywhere in the body → an inline browse/search picker
appears (same mechanics as the slash menu, but for code anchors
instead of block inserts). The picker shows:

- **File tree** — browse folders, click a file
- **Symbol list** — when a file is selected, its functions/classes/
  interfaces appear
- **Search** — type to filter across files and symbols
- **Recent picks** — what you've @-referenced before in this plan

Pick something → a chip is inserted inline in the body text:

```
Refactor @src/auth/token-service.ts, specifically
@signToken, to accept a scope parameter. Then update
all callers of @signToken to pass the new param.
```

Each `@` chip is simultaneously:
- **Human-readable** — renders as a clickable pill in the body
- **Machine-parseable** — auto-creates a `FileSpec` or `SymbolSpec`
  on the item, with the file path and symbol kind resolved
- **Graph-linked** — the target traces to the dependency graph for
  drift detection and querying

### Progressive disclosure of precision

The spectrum from loose to precise is the user's choice:

```
LOOSE                                  PRECISE
╭───────────────────────╮             ╭───────────────────────────────╮
│ "Add rate limiting    │             │ "Add rate limiting middleware. │
│  to all API           │             │  Create @src/middleware/       │
│  endpoints"           │             │  rate-limiter.ts with a       │
│                       │             │  @rateLimiter middleware fn.   │
│  No @ tags.           │             │  Wire it into @src/routes/    │
│  Agent decides.       │             │  api.ts#router."              │
│  Still valid.         │             │                               │
│                       │             │  3 targets auto-created.      │
│                       │             │  Graph-anchored.              │
╰───────────────────────╯             ╰───────────────────────────────╯
```

Both are valid prompts. Both feed the same agent pipeline. The
precise version gives tight scope and enables drift-checking; the
loose version gives the agent room.

### What happens structurally

When the user types `@src/auth/token-service.ts` in the body:
- A `FileSpec { path: 'src/auth/token-service.ts', action: 'modify' }`
  is auto-created on the item
- The chip renders inline with a file icon
- Clicking the chip opens the file in the code browser

When the user types `@signToken` (after selecting from a file):
- A `SymbolSpec { name: 'signToken', kind: 'function',
  filePath: 'src/auth/token-service.ts', action: 'modify' }` is
  auto-created
- The chip renders with a symbol icon and the file context

For **Actions**: each target gets a default verb (`modify`) which
the user can change via the targets strip or chip context menu.

For **Objects**: targets are reference-only — "this is the relevant
code" — no verb needed. They tell an AI agent what's in scope for
understanding.

### The targets strip

Below the body, a thin reactive strip shows all structured targets:

```
BODY EDITOR
┌────────────────────────────────────────────────────────────┐
│ Refactor @token-service.ts, specifically @signToken,       │
│ to accept a scope parameter. Then update all callers...    │
└────────────────────────────────────────────────────────────┘
TARGETS (auto-derived from @ chips + API-added)
┌────────────────────────────────────────────────────────────┐
│ [modify] token-service.ts  [modify] signToken  [+ Browse] │
└────────────────────────────────────────────────────────────┘
```

The strip is:
- **Auto-populated** from @ chips in the body
- **Also writable via API** — an AI agent can add targets by calling
  `update_item` with `fileSpecs` / `symbolSpecs`, and they appear
  in the strip even if they're not in the body text
- **Editable** — click a verb badge to change it; click × to remove;
  click [Browse] to open the full code browser
- **Collapsed when empty** — doesn't get in the way of simple prompts
- **Reactive** — targets appear in real-time as an AI agent adds
  them via API

### Non-code Actions

Not every Action is about code. These are valid:

- *"Research how Stripe handles idempotency keys"*
- *"Explore whether we need Redis for rate limiting"*
- *"Interview 3 users about the login flow"*
- *"Write the RFC for the new auth architecture"*

No @ tags. No file targets. Just a body prompt. The targets strip
stays hidden. The code browser never appears. Actions are work items
— they can be anything.

### The code browser (Browse mode)

When the user clicks [Browse] on the targets strip (or wants to
explore without typing), a panel expands below the body:

```
┌────────────────────┬─────────────────────────────┐
│ 🔍 Search...       │  token-service.ts            │
├────────────────────┤  ─────────────────────────── │
│ 📁 src/            │  signToken()       function  │
│   📁 auth/         │  verifyToken()     function  │
│     📄 token.ts  ● │  TokenPayload      interface │
│     📄 guard.ts    │  TOKEN_EXPIRY      variable  │
│   📁 routes/       │                              │
│     📄 api.ts      │  Imports:                    │
│   📁 middleware/    │    ← jsonwebtoken            │
│                    │    ← ../types/auth           │
└────────────────────┴─────────────────────────────┘
```

Left: file tree. Right: symbols + imports for the selected file.
Click a symbol → it becomes a target (or reference on Objects).
The browser collapses when done. Pinned targets stay in the strip.

The browser is the same component for Objects and Actions — the
difference is what happens when you pick something:
- **Object:** pins it as context ("agent should read this")
- **Action:** pins it with a CRUD verb ("agent should modify this")

### Edge declarations (call graph intent)

The user can declare intended changes to the call graph:

*"Everything that calls @signToken should switch to calling
@NewTokenApi.getToken instead."*

This creates edge intent:
- `removedConnections: [{ from: '*', to: 'signToken' }]`
  (query-based — "all callers")
- `newConnections: [{ from: '*', to: 'NewTokenApi.getToken' }]`

The `*` wildcard means "resolve at execution time" — the agent (or
drift detector) walks the graph to find all callers and verifies
each was updated.

For explicit edges:
- `@api.ts#handleLogin → @token-service.ts#signToken` = specific
  call that should exist (or be removed)

Edge chips render in the body as directional pills. The targets
strip shows them grouped under an "Edges" section.

**Cross-action references:** `@NewTokenApi.getToken` might not exist
yet — it's defined in another Action. The @ picker shows "planned
symbols" (from other Actions' `symbolSpecs` with `action: 'add'`)
alongside real symbols, tagged as *"planned in: Create NewTokenApi"*.
This lets Actions reference each other's outputs.

### AI agent authoring flow

The same surface works for AI-initiated planning:

1. Human creates an Action: *"Refactor auth to JWT"*
2. Human connects an AI agent to the plan
3. Agent reads the loose prompt via `read_item_full`
4. Agent calls `update_item` with detailed `fileSpecs` +
   `symbolSpecs` — the structured targets it intends to change
5. Human sees targets appear in real-time in the strip
6. Human opens the code browser to review what the agent declared
7. Human edits verbs, removes targets, adds more — the plan is
   shared state

The body stays as the human wrote it. The structured targets sit
alongside it. Both are visible. Both are editable. The AI expanded
the intent; the human verified it.

This also works for AI-to-AI handoff: the second agent reads the
structured targets (not just the body text) and knows exactly which
files and symbols are in scope.

---

## The six flows

Flows are written so each could lead with a human, with an agent, or
both. Where the flow matters differently for solo vs. collab, that's
called out.

### Flow 1 — Capture an idea fast

The lightest touch in the product. Three keystrokes from "idea in
head" to "plan exists."

```
            CodeTrellis             [+ New plan]      ⌘N        [agents…]
     ╭─────────────────────────────────────────────────────────────╮
     │  PLAN: New plan                                          ✕  │
     │                                                             │
     │  Add 2FA to login_                                          │
     │                                                             │
     │  Currently we only do email/pw. Customers want Google +     │
     │  GitHub. Need to spec the auth flow + migration plan...     │
     │                                                             │
     │  [ Capture ]                                                │
     │                                                             │
     │      Or seed it from a template:                            │
     │      [ ▢ New feature ] [ ▢ Bug fix ] [ ▢ Refactor ]         │
     │      [ ▢ Investigation ]                                    │
     ╰─────────────────────────────────────────────────────────────╯
```

**Solo human:** title + body, hit Capture, the workspace opens
fullscreen on a single Object containing what was typed. Done. They
can stop here — the plan is already a useful note.

**Human handing off to an agent:** same capture, then "Connect agent"
in the workspace header. The agent reads what was just typed, asks
clarifying questions (via comments) or drafts the rest of the plan
(adds Objects + Actions). Human watches the tree grow.

**Agent-initiated:** an agent calls `create_plan` itself, providing
the title + body. The human gets a notification toast, opens the
plan, sees what the agent drafted.

**Behind the scenes:** one DB row in `plans`, one Object child whose
body is the captured text. No phases, no Actions yet. The plan exists
in `<project>/.codetrellis/plans/<slug>/plan.yaml` if the project is
git-tracked; otherwise DB-only.

---

### Flow 2 — Build context (the data room)

This is the *Notion-like* build-out. The user (or an agent) is filling
in Objects, nesting them, attaching references. The plan tree grows
in the sidebar.

```
SIDEBAR                                  CANVAS
╭─────────────────╮                     ╭──────────────────────────────────╮
│ ▾ Add 2FA       │                     │ Add 2FA / 🔍 Competitor Analysis │
│   📋 Overview   │                     │ ──────────────────────────────── │
│   ▾ 🔍 Compet…  │  ← clicked          │                                  │
│      A: Auth0   │                     │ # Goal                           │
│      B: Clerk   │                     │ Survey what 3 leaders ship.      │
│      C: Stytch  │                     │                                  │
│   ▸ 🎨 UX Journey│                    │ # Findings (so far)              │
│   ▸ 📎 References│                    │ - Auth0 uses TOTP + SMS fallback │
│ ─────────────── │                     │ - Clerk: SMS only                │
│ + New           │                     │ - Stytch: WebAuthn-first         │
│   📋 Object     │                     │                                  │
│   ⚡ Action     │                     │ /  ← slash menu                  │
╰─────────────────╯                     ╰──────────────────────────────────╯
```

Three lanes, same tree:

**Solo human writing.** They type. Slash-menu inserts headings, todos,
sub-pages. Click a sub-page in the sidebar to drill in. Drag-drop to
re-nest. They never connect an agent. The tool is a structured
second-brain — competitor analysis, RFC drafts, UX journeys, research
notes. Reusable across projects.

**Watching an agent build it.** Agent calls `add_object` (rename of
`add_plan_doc`) with parent uids. The sidebar lights up as items
arrive — slight pulse animation. Human can edit any item the agent
just wrote; the next time the agent reads, it sees the human's
amendments.

**Co-authoring.** Both. Human drafts the Executive Summary; asks
agent to draft Competitor Analysis sub-objects. Agent populates them.
Human refines findings. The tree is shared state.

**Templates for Objects** (not for whole plans). Click "+ New →
Object" and pick: Executive Summary / References / UX Journey /
Competitor Analysis / Architecture / Patterns / Testing / Security /
… Each seeds a starter body the user fills in.

**Behind the scenes:** every Object is a row in `plan_objects` with
`parent_uid` (replaces today's `plan_documents` + `parentDocUid`).
Disk: `<plan>/<page-slug>.md`, sub-pages mirror the folder tree.
Order is preserved by `sort_order` not `order_hint`.

---

### Flow 3 — Add Actions when ready (the graph anchor)

Some plans never get Actions — they're just thinking. Some plans need
them — execution time. The authoring model (§body-first) means the
spectrum from loose to precise is fluid — type naturally, `@`-tag
when you want precision:

```
MINIMAL ACTION                      DETAILED ACTION (same surface)
╭───────────────────────╮          ╭───────────────────────────────╮
│ ⚡ Look at UX/UI,     │          │ ⚡ Add /verify-2fa endpoint   │
│   find login files,   │          │                               │
│   add 2FA flow using  │          │ Create @src/api/2fa.ts with   │
│   reusable component  │          │ a @verify2FA handler. Wire    │
│                       │          │ it into @src/api/auth.ts.     │
│ No @ tags.            │          │                               │
│ Agent decides.        │          │ Targets (auto):               │
│ Still valid.          │          │  [create] 2fa.ts              │
│                       │          │  [add] verify2FA              │
│ [ Hand to agent ]     │          │  [modify] auth.ts             │
│                       │          │                               │
│                       │          │ References: ↗ Architecture    │
│                       │          │   ↗ RFC URL ↗ Figma           │
│                       │          │ [ Hand to agent ]             │
╰───────────────────────╯          ╰───────────────────────────────╯
   "agent decides"                     "body IS the spec; targets
                                        auto-derived from @ chips"
```

Both are valid. Both feed the same prompt-builder. The detailed
version gives tight scope and enables drift-checking; the loose
version gives the agent room and we drift-check on what it inferred.

**Not just code.** Actions can be anything: *"Research how Stripe
handles idempotency"*, *"Write the RFC"*, *"Interview 3 users."* No
@ tags needed. The targets strip stays hidden. Code-anchored and
non-code Actions coexist in the same tree.

**AI can add structure.** A human writes a loose Action. An agent
reads it, calls `update_item` with `fileSpecs` + `symbolSpecs` +
edge declarations. The human sees targets appear in real-time in
the strip — structured intent the agent plans to execute. Human
reviews, edits, approves. This is the collaboration loop.

**Action = graph anchor.** When the Action lists files / symbols /
edges (whether via @ tags or API-added), those become live links —
clicking the file opens it in the inspector; the graph highlights
affected nodes when the Action's status flips to in_progress. This
is the *only* primitive that touches the graph.

**Actions can group Actions.** A parent Action with no graph anchor
of its own, just children, becomes the equivalent of today's "phase."
No separate concept needed.

**Status, progress, blockers, comments** sit on every Action (already
implemented — task-context fields ship from Phase 14 §A). Agents
update them via MCP; humans update them inline.

**Behind the scenes:** one row in `plan_items` (kind='action').
`parent_uid` points to either an Action or an Object — same as
Objects, the trees mix freely. Graph anchor data lives in
`file_specs`, `symbol_specs`, edge arrays — already there.

---

### Flow 4 — Hand off across agents (durable memory in action)

The killer demo. Two agents, one plan, no lost context.

```
T = 0:00  Claude Code reads plan, claims Action "Migrate users".
          Writes findings as a child Object: "Discovery — found 47
          users with sso_provider=null, will need backfill."
          Adds a sub-Action: "Backfill nulls before cutover."
          Marks own Action 50%, comments "halfway through, hitting
          context limit, switching to fresh session."

T = 0:01  Claude Code session ends. Context: gone.

T = 0:05  Codex connects. Calls list_plans → get_plan → reads the
          Discovery Object. Reads the comment thread. Sees the new
          sub-Action.
          Picks up "Backfill nulls before cutover." Knows why it
          exists (Discovery says so). Carries on.
```

This works because the plan tree is the durable record. The human
didn't have to brief Codex. The plan's Objects (findings, references)
+ Actions (work) + comments (chatter) + attachments (artifacts) carry
all the context the next agent needs.

**Solo benefit:** same loop works with one agent across days. You
come back tomorrow, your agent has been working overnight, the plan
shows you exactly what it figured out and where it's stuck.

**The activity rail** (already shipped — Phase 14 §B right column)
becomes the diff: "what's new since I was last here." On reopening,
a "13 events while you were away" banner highlights what's worth
reading.

**Behind the scenes:** every edit, claim, status change, comment,
attachment — already broadcasts on WS. Already round-trips to YAML.
What's missing: a "since-last-visit" pointer per user so the activity
rail can compute the diff.

---

### Flow 5 — Multiple agents working simultaneously

Different from Flow 4 (sequential handoff). Here, two or three agents
are claiming different Actions on the **same plan at the same time**,
and the human is watching all of them.

```
SIDEBAR                              CANVAS  ·  Add 2FA
╭───────────────────────────╮       ╭──────────────────────────────────────╮
│ ▾ Add 2FA                 │       │ Connected agents (3):                │
│   📋 Overview             │       │   🟢 claude-code   · Wire types       │
│   ▾ ⚡ Phase 1             │       │   🟣 codex         · Add /verify-2fa  │
│      ⚡ Wire types  🟢 50% │ ←     │   🔵 aider         · idle             │
│      ⚡ Add /verify 🟣 30% │ ←     │                                      │
│      ⚡ Add tests          │       │ Activity (live):                     │
│   ▾ ⚡ Phase 2             │       │   17:04  🟣 codex started Add /verify │
│      ⚡ Migrate    🔵 idle │ ←     │   17:04  🟢 c-code → 50% Wire types   │
╰───────────────────────────╯       │   17:05  🔵 aider claimed Migrate     │
                                    │   17:05  ⚠ conflict — codex + aider   │
                                    │           both touching auth.ts       │
                                    ╰──────────────────────────────────────╯
```

Each Action in the sidebar shows the dot of the agent that claimed
it (colour per agent) plus a progress percent. Each connected agent
shows in the header with the Action it's currently on. The activity
rail merges all three streams in real time.

**Claim atomicity** is already wired (Phase 11 multi-agent fix —
`claim_task` is atomic, exactly one agent wins). The UI surfaces the
loser's "task already claimed" response as a quiet toast.

**File-level conflicts** — when two simultaneous Actions touch the
same file (e.g. both list `src/api/auth.ts` in their `fileSpecs`),
`claim_task` already returns a `conflicts` warning. The UI surfaces
this prominently in the activity rail and on each Action's header
("⚠ overlaps with codex's Add /verify-2fa") so the human can split
work or sequence the Actions before damage lands.

**Solo benefit:** even with one agent, this matters — long-running
sessions where the human spawns a second agent for a parallel task
get the same visual presence layer. Useful for "I'm running Claude
Code on the refactor; I just spun up Codex on the docs."

**Behind the scenes:** `agent_sessions` table already tracks active
sessions. WS broadcasts `mcp-session-changed` on connect / disconnect
/ active-plan changes. What's missing in the UI: per-Action
presence dots, conflict-overlap warnings on the Action card, and
agent-tinted colours in the activity stream.

---

### Flow 6 — Verify against drift

The reason Actions anchor to the graph. Visual proof of conformance.

```
GRAPH OVERLAY (live state vs plan)
╭──────────────────────────────────────────────────────────────╮
│   src/api/2fa.ts          ✓ matched plan       (green ring)  │
│   src/api/auth.ts         ✓ matched plan                     │
│   src/api/email.ts        ⚠ unexpected change   (amber ring) │
│      └─ touched by Action "Add /verify-2fa"                  │
│         but not in fileSpecs                                 │
│   src/auth/Login.tsx      ✗ not yet touched     (dashed)     │
│      └─ planned-add by Action "Refactor login form"          │
╰──────────────────────────────────────────────────────────────╯
ACTIVITY (per-Action drift report)
   ✓ "Add /verify-2fa endpoint"  · 2/2 matched · 1 unexpected
       └─ [ Extend Action with src/api/email.ts ] [ Revert change ]
       └─ [ Mark accepted ]
```

When work happens (agent or human), the graph overlay reflects how
closely it matches the plan. Three colours: matched (planned + done),
unexpected (done but not planned), missing (planned but not done).

The drift report on each Action gives a one-keystroke fix:
- *Extend Action* — the unexpected file becomes part of the Action's
  fileSpecs. Plan now matches reality.
- *Revert* — the unexpected change is rolled back (git restore).
- *Accept* — drift is acknowledged, no longer reported. (Useful when
  the agent made a correct-but-unanticipated tweak.)

**Solo human-only:** still useful — *"I told future-me I'd touch only
auth files; I accidentally edited a test fixture; flag it."* Drift
detection is for forgetful-yourself as much as for off-script agents.

**Behind the scenes:** drift detection already partly works (Phase
12 §B `proposed_changes` + the `deviation_service`). What's missing
in v1: the one-click fixes from the report panel, and surfacing the
drift colours on the graph nodes themselves (graph TODO §5.9).

---

## Behind the scenes — what changes

| Layer | Today | After |
|---|---|---|
| **DB tables** | `plans`, `plan_phases`, `tasks`, `plan_documents`, `task_attachments`-via-attachments, `comments` | `plans`, `plan_items` (single table, `kind: 'object' \| 'action'`), `plan_item_versions` (per-item edit history — M1), `attachments`, `comments`. `plan_phases` retired. `parent_uid` lets the tree mix freely. Action items carry `fileSpecs[]` with per-file `edits[]` (lineRange / symbolRef / instruction — M2). |
| **MCP tools** | `add_plan_doc`, `add_plan_phase`, `update_task`, `add_subtask`, `read_task_full`, … | Renamed/unified: `add_item(kind, parent_uid, …)`, `read_item_full(uid)`, etc. Old tool names kept as aliases for back-compat. |
| **Disk layout** | `<plan>/{plan.yaml, phases/, tasks/, docs/}` | `<plan>/<page-slug>.md` mirroring the tree. Front-matter carries `kind` + metadata. Tasks-as-folders if they have children. One-shot upconvert script handles existing flat plans. |
| **Frontend** | Bottom-strip `PlanPanel` with 5 tabs + the Phase 14 §B three-region workspace | Bottom-strip `PlanList` (active plans snapshot) → click → fullscreen workspace. Workspace = sidebar tree (Objects + Actions, mixed) + main canvas (one item at a time, breadcrumb) + toggleable activity drawer. |
| **Graph integration** | Action `affectedFiles` → graph nodes get `state: planned_add/added/unexpected/etc.` Drift detection runs on demand. | Same edges, plus per-node drift ring on the graph (matched/unexpected/missing) so the user can scan visually. Drift report panel gets one-click fixes. |

---

## Mechanical decisions

Both resolved.

**M1. Edit history → per-item version log.** Every Object and every
Action gets its own version table row on each meaningful edit, with
author + authorType + timestamp + change summary. The whole-plan
snapshot stays separate (it's used for "approved baseline" trellis
snapshots — a distinct concept the drift detector consumes). This
gives us a clean per-item undo / blame surface ("who changed this
Object's body? when? why?") without confusing it with plan-level
freezes.

```
plan_item_versions
  uid             — version row id
  item_uid        → plan_items
  version         INT  — monotonically per item
  body_snapshot   — full body (markdown / yaml-ish)
  author          — human email or agent id
  author_type     — 'human' | 'agent'
  change_summary  — optional, why this edit
  created_at
```

**M2. Action graph anchor → multiple files, multiple per-file edits,
down to line-level instructions.** An Action can declare:

- Multiple files (current `fileSpecs[]` stays).
- Multiple **edits per file** — per-file granular instructions, each
  with optional `lineRange` or `symbolRef`, and a free-form
  `instruction` describing what to do at that point.
- Symbol-level intent (`symbolSpecs[]` stays — already supports
  `add / modify / remove / move` per named symbol).
- Edge-level intent (`new_connections[]`, `removed_connections[]`
  stay).

```
ACTION
  fileSpecs: [
    {
      path: "src/auth/Login.tsx",
      action: "modify",
      description: "Update form to accept 2FA code",
      edits: [
        {
          lineRange: { start: 45, end: 60 },
          instruction: "Replace password input with a 2FA code input"
        },
        {
          symbol: "validate",            // resolves via AST symbols
          instruction: "Add 2FA code validation; reject weak codes"
        }
      ]
    },
    {
      path: "src/api/2fa.ts",
      action: "create",
      description: "New endpoint module",
      edits: [
        { instruction: "Export verify2FA(): handler" }
      ]
    }
  ]
```

Drift attribution still works because each fileSpec has its own
identity within the Action — the drift report can say *"this Action
matched the lineRange edit at Login.tsx:45-60 but didn't touch the
symbol-level edit on `validate`"* and the human can decide whether
the Action is partially done or needs splitting.

The simpler form (just `path` + `action` + `description`, no `edits`)
is still valid — a one-liner Action with no per-file edits is the
"agent decides what to change" mode from Flow 3's minimal example.

---

## Architecture / data model

### Three layers of "what happened to this plan"

The model captures change at three altitudes. All three are needed
because users ask different questions of each.

| Altitude | Question it answers | Surface |
|---|---|---|
| **Item content** | "What did *this Object's body* say yesterday?" | `plan_item_versions` (per-item version log — M1) |
| **Plan structure** | "When did *this Action get moved under Phase 2*? Who renamed *Competitor A* to *Auth0*?" | `plan_events` (append-only mutation log — NEW) |
| **Plan checkpoints** | "Show me the plan as it looked when I marked it approved." | `plan_versions` (existing — whole-plan JSON snapshots at meaningful moments) |

The middle layer — `plan_events` — is the new piece. It's what makes
"show how the plan shifted" tractable. The activity rail can render
it as a stream; the workspace header can render it as a scrubbable
timeline.

### Tables

Sketch DDL (sql.js-flavoured, idempotent ALTER on existing DBs).

```sql
-- One row per plan item. Replaces plan_documents + plan_phases + tasks.
CREATE TABLE plan_items (
  uid              TEXT PRIMARY KEY,
  plan_uid         TEXT NOT NULL REFERENCES plans(uid),
  parent_uid       TEXT REFERENCES plan_items(uid),  -- nullable = top-level
  sort_order       INTEGER NOT NULL DEFAULT 0,
  kind             TEXT NOT NULL,    -- 'object' | 'action'

  -- Common
  title            TEXT NOT NULL,
  body             TEXT,             -- markdown
  template         TEXT,             -- 'executive_summary' | 'references' | …
                                     -- (null for free-form)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  author           TEXT NOT NULL,
  author_type      TEXT NOT NULL,

  -- Action-only (NULL on Objects)
  status           TEXT,             -- pending | assigned | in_progress |
                                     -- done | blocked | skipped
  assignee         TEXT,
  assignee_type    TEXT,
  assignee_model   TEXT,
  progress_percent INTEGER,
  blocked_reason   TEXT,
  scope_path       TEXT,
  file_specs       TEXT,             -- JSON FileSpec[] (with edits[])
  symbol_specs     TEXT,             -- JSON SymbolSpec[]
  new_connections  TEXT,             -- JSON Edge[]
  removed_conns    TEXT,             -- JSON Edge[]
  dependencies     TEXT              -- JSON string[] of item uids
);

CREATE INDEX idx_plan_items_plan      ON plan_items(plan_uid);
CREATE INDEX idx_plan_items_parent    ON plan_items(parent_uid);
CREATE INDEX idx_plan_items_kind      ON plan_items(kind);
CREATE INDEX idx_plan_items_status    ON plan_items(status);
CREATE INDEX idx_plan_items_sort      ON plan_items(plan_uid, parent_uid, sort_order);

-- Per-item edit history (M1).
CREATE TABLE plan_item_versions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  item_uid         TEXT NOT NULL REFERENCES plan_items(uid),
  version          INTEGER NOT NULL,
  body_snapshot    TEXT,             -- markdown body at this version
  meta_snapshot    TEXT,             -- JSON of all other fields so non-body
                                     -- changes (status, fileSpecs, …) are
                                     -- blameable too
  change_summary   TEXT,
  author           TEXT NOT NULL,
  author_type      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE(item_uid, version)
);

CREATE INDEX idx_plan_item_versions_item ON plan_item_versions(item_uid);

-- Plan-level mutation log — "how the plan shifted." Append-only.
-- One row per structural mutation: create / move / delete / parent change /
-- sort-order change / kind transmute / Action status flip / etc.
CREATE TABLE plan_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_uid     TEXT NOT NULL REFERENCES plans(uid),
  item_uid     TEXT,                 -- the item this event affects
                                     -- (nullable for plan-level events)
  event_type   TEXT NOT NULL,
  before_state TEXT,                 -- JSON, optional snapshot
  after_state  TEXT,                 -- JSON snapshot
  summary      TEXT,                 -- human-readable, e.g.
                                     -- "moved 'Add tests' under Phase 2"
  author       TEXT NOT NULL,
  author_type  TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_plan_events_plan ON plan_events(plan_uid, created_at);
CREATE INDEX idx_plan_events_item ON plan_events(item_uid, created_at);
CREATE INDEX idx_plan_events_type ON plan_events(event_type);

-- Existing tables stay: plans, plan_versions, attachments, comments,
-- agent_sessions, trellis_snapshots, deviations, recent_projects.
-- Tables retired by migration (kept readable for two versions, then
-- dropped): plan_documents, plan_phases, tasks (data flows into plan_items).
```

### TypeScript shapes (the tricky bits)

```ts
export type PlanItemKind = 'object' | 'action';

export interface PlanItem {
  uid: string;
  planUid: string;
  parentUid: string | null;
  sortOrder: number;
  kind: PlanItemKind;
  title: string;
  body: string;
  template?: string;            // 'executive_summary' | 'references' | …
  // Action-only (undefined on Objects)
  status?: TaskStatus;
  assignee?: string | null;
  assigneeType?: string | null;
  assigneeModel?: string | null;
  progressPercent?: number | null;
  blockedReason?: string | null;
  scopePath?: string | null;
  fileSpecs?: FileSpec[];
  symbolSpecs?: SymbolSpec[];
  newConnections?: Edge[];
  removedConnections?: Edge[];
  dependencies?: string[];
  // Common metadata
  author: string;
  authorType: string;
  createdAt: number;
  updatedAt: number;
}

export type FileSpecAction = 'create' | 'modify' | 'delete' | 'move';

export interface FileSpec {
  path: string;
  action: FileSpecAction;
  moveTo?: string;
  isDir?: boolean;
  description?: string;
  edits?: FileEdit[];           // M2 per-file granular edits
}

export interface FileEdit {
  /** Either lineRange OR symbol pins the edit; both null = "anywhere in file". */
  lineRange?: { start: number; end: number };
  symbol?: string;              // resolves via AST symbols (e.g. "validate")
  instruction: string;          // free-form natural language
  /** Optional structured CRUD verb when the edit has clear intent. */
  intent?: 'add' | 'modify' | 'remove' | 'replace';
}

export type PlanEventType =
  | 'item_created' | 'item_moved' | 'item_deleted'
  | 'item_renamed' | 'reparented'  | 'reordered'
  | 'status_changed' | 'kind_transmuted'
  | 'plan_status_changed' | 'item_restored';

export interface PlanEvent {
  id: number;
  planUid: string;
  itemUid: string | null;
  eventType: PlanEventType;
  beforeState?: unknown;
  afterState?: unknown;
  summary: string;
  author: string;
  authorType: string;
  createdAt: number;
}
```

### MCP tool surface

The new model collapses many of today's tools into a smaller set
that doesn't care which kind it's working on.

**New canonical tools** (Object + Action both go through these):

| Tool | Purpose |
|---|---|
| `add_item(plan_uid, kind, parent_uid?, title, body?, template?, …)` | Create an Object or Action. `kind: 'object' \| 'action'`. Action-only fields ignored on Objects. Emits `plan_events: item_created` + WS `plan-item-created`. |
| `get_item(uid)` | Fetch a single item without children. Lightweight. |
| `read_item_full(uid)` | One round-trip: item + immediate children + attachments + comments + recent versions + plan-level breadcrumbs. Replaces `read_task_full`. |
| `update_item(uid, …)` | Update any field — body, status, fileSpecs, scopePath, etc. Emits a `plan_item_versions` row + a `plan_events` row when the change is structural. |
| `move_item(uid, new_parent_uid?, new_sort_order?)` | Re-parent / reorder. Emits `plan_events` `item_moved` / `reparented` / `reordered`. |
| `delete_item(uid, cascade?)` | Soft-delete with cascade option. Emits `item_deleted` plus children-deleted events. Recoverable from `plan_events.before_state`. |
| `claim_item(uid, agent_type, model?)` | Action-only; same atomicity guarantees as today's `claim_task`. Returns full item context. Errors politely on Objects. |
| `list_items(plan_uid, parent_uid?, kind?)` | Cheap tree query — title + kind + status + sortOrder + childCount. No bodies. The sidebar's main read. |
| `get_plan_timeline(plan_uid, since_ms?, kinds?, limit?)` | Read `plan_events` filtered. Powers the activity rail and the timeline scrubber. |
| `restore_item_version(uid, version)` | Restore an item to a prior version from `plan_item_versions`. Emits `plan_events` `item_restored`. |

**Aliases** — same handler, kept until the old skill guides retire:

| Old | New |
|---|---|
| `add_plan_doc` | `add_item(kind='object', template=docType)` |
| `update_plan_doc` | `update_item` |
| `add_plan_phase` | `add_item(kind='action', template='phase')` (a phase is just an Action that groups child Actions) |
| `add_subtask` | `add_item(kind='action', parent_uid)` |
| `update_task` / `update_task_progress` / `set_task_blocked` / `add_task_attachment` / `add_task_comment` / `read_task_full` / `list_task_comments` | Forwarders to the unified tools |
| `claim_task` | `claim_item` |

Hand-rolled tools that **stay** (not item CRUD): `search_symbols`,
`get_dependencies`, `check_architecture`, `list_cross_system_edges`,
`check_conformity`, all `*_plan_template` tools, `get_drift_report`,
`detect_deviations`, `reconcile`, `capture_checkpoint`,
`register_session`, `set_active_plan`, `export_plan_to_files` /
`import_plan_from_files` / `discover_plan_files` /
`unlink_plan_from_files`.

### WS event taxonomy

The wire-level events the workspace listens for.

| Event | Payload | Triggers UI |
|---|---|---|
| `plan-created` | `{plan}` | Plans list bumps. |
| `plan-item-created` | `{planUid, item, parentUid?}` | Sidebar tree inserts; activity rail prepends. |
| `plan-item-updated` | `{planUid, itemUid, kind, changes: {field: value}}` | Re-render the affected row + canvas if open. |
| `plan-item-moved` | `{planUid, itemUid, fromParentUid, toParentUid, sortOrder}` | Sidebar re-parents; activity rail logs the move. |
| `plan-item-deleted` | `{planUid, itemUid, cascadedUids: string[]}` | Sidebar prunes; canvas closes if open. |
| `plan-item-claimed` | `{planUid, itemUid, agentId, agentType}` | Action card lights up with presence dot; activity rail logs. |
| `plan-item-version-saved` | `{planUid, itemUid, version, author}` | Version drawer refreshes if open. Otherwise quiet. |
| `plan-event` | `{event}` (full PlanEvent row) | Umbrella event; activity rail prepends. |
| `plan-comment-added`, `plan-progress`, `plan-blocked`, `plan-attachment-added`, `plan-attachment-removed` | (existing, kept) | Same as today. |

Existing events that **stay** (graph / scan / project / agent
session / settings / mcp-port / etc.) — unchanged.

### Disk layout

Round-trips to `<project>/.codetrellis/plans/<plan-slug>/`.

```
plans/<plan-slug>/
├── plan.yaml                          # plan-level metadata
├── 00-overview.md                     # Object — front-matter has uid + kind
├── 10-competitor-analysis/            # Object with children → folder
│   ├── _index.md                      #   parent body
│   ├── 01-auth0.md
│   └── 02-clerk.md
├── 20-phase-1-foundation/             # Action with children → folder
│   ├── _index.md                      #   parent Action body + metadata
│   ├── 01-wire-types.md               #   child Action
│   └── 02-add-tests.md
└── attachments/
    └── <item-uid>/<file>
```

Front-matter on each `.md` carries: `uid`, `kind`, `template`,
`title`, `status` (Actions), `fileSpecs` (Actions, YAML),
`createdAt`, `updatedAt`, `author`. Body is markdown after the
front-matter delimiter.

**Per-item version log does NOT mirror to disk** — it would explode
diffs and serve no git purpose. Stays DB-only. Same for `plan_events`
— DB-only by default; opt-in dump as `events.jsonl` for diagnostic
inspection.

### How "show how plans shift" actually works

Three surfaces consume `plan_events`:

1. **Activity rail** (already in the workspace) — chronological feed
   of all events for the active plan. Each event renders with a verb
   + a one-line summary + an actor. Click an event to jump to the
   affected item (or, for deletions, view the resurrect option).

2. **Per-item shift drawer** — small "history" affordance on every
   Object/Action. Shows the events scoped to that item: every move,
   rename, status change, body version. Click any version body to
   diff it against current.

3. **Plan timeline scrubber** (workspace header) — a horizontal strip
   that compresses `plan_events` to days/hours/minutes. Hover to see
   the events at that point. Click to time-travel the sidebar tree
   to that snapshot. Useful for *"what did this plan look like
   before the agent restructured it last night?"*

```
TIMELINE SCRUBBER
╭──────────────────────────────────────────────────────────────╮
│ Today            Yesterday        Apr 27         Apr 25      │
│  ████▌▒▒▒▒▒░░░░ ░░░ ░  ░░░░ ░░░ ░ ░░  ░░░░  ░░ ░░░░ ░  ░░░░ │
│       ↑                                                       │
│       now                                                     │
│                                                               │
│   ◀  ← scrub left/right with arrows or drag                  │
╰──────────────────────────────────────────────────────────────╯
```

When scrubbed back, the sidebar tree snaps to the historical
structure (no item edits applied, just structural — moves, parents,
sort orders). A banner says *"Viewing plan as of <timestamp> — read
only — return to live."* This is computed by replaying events
backwards from current state, not by storing snapshots.

`plan_versions` (whole-plan JSON snapshots) only get written at
explicit checkpoints — when the human marks a plan approved, when a
phase Action transitions to done, on demand via "Save checkpoint"
button. They're the anchors for the trellis baseline. The scrubber
reads from `plan_events`, not from `plan_versions`.

### Author attribution

Every write — item create / update / move / delete / version,
comment, attachment, claim, status flip — carries `author` +
`authorType`. The activity rail and the timeline both visually tint
events by author so a human's edit reads differently from
claude-code's edit reads differently from codex's edit. Required for
the cross-agent handoff narrative (Flow 4) and the parallel agents
view (Flow 5) to be legible.

---

## UI surfaces

Concrete enough that we can build against it. ASCII for shape; per
surface, the components / props / state contract.

### S1 — Bottom strip (always visible, light)

The persistent surface across both modes (graph + plan). Lists active
plans with status + progress, plus a prominent "+ New plan" CTA.
Click a row → fullscreen workspace takeover.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  Plans                                                       [+ New plan ⌘N]│
│  ──────────────────────────────────────────────────────────────────────────  │
│  ▢ Add 2FA to login         ████████░░░░░░  48%   ↻ 3 min ago               │
│  ▢ OMS integration          ███░░░░░░░░░░░  12%   🟢 codex working          │
│  ▢ Refactor auth            ████████████░░  85%   ⚠ 2 blockers              │
│  ▢ Spike: GraphQL           ░░░░░░░░░░░░░░   0%   draft                     │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Component: `PlanStrip` (replaces today's `PlanPanel` tabs). One
template list, one create button, no nested tabs. The Timeline /
Changes / Comments tabs that lived here move into the workspace as
right-rail drawers.

State: subscribes to `usePlanStore.plans`. Click handler →
`setActivePlan(uid)` → workspace overlay opens.

### S2 — Capture modal (⌘N — fast plan creation)

The lightest path from idea to plan. Three keystrokes.

```
╭──────────────────────────────────────────────────────────╮
│  ⌘N  ·  New plan                                       ✕ │
│  ──────────────────────────────────────────────────────  │
│   Title:                                                 │
│   ┌────────────────────────────────────────────────────┐ │
│   │ Add 2FA to login_                                  │ │
│   └────────────────────────────────────────────────────┘ │
│                                                          │
│   Body / context (optional):                             │
│   ┌────────────────────────────────────────────────────┐ │
│   │ Currently we only do email/pw. Customers want      │ │
│   │ Google + GitHub. Need to spec the auth flow + ...  │ │
│   │                                                    │ │
│   └────────────────────────────────────────────────────┘ │
│                                                          │
│   ⌥ Templates  ▾                                         │
│   ─────────                                              │
│   [ Capture ]                                  Esc cancel│
╰──────────────────────────────────────────────────────────╯
```

What gets created: one Plan + one top-level Object whose body is the
captured text. If templates ⌥ is expanded, the user can pick a
plan-level template (mass-refactor, new-feature, …) which seeds a
tree instead of one Object. Templates ≠ Objects: plan templates seed
many, Object templates (Executive Summary, References, etc.) seed
one Object's starter body.

### S3 — Workspace shell (fullscreen takeover)

The takeover from S1 → fullscreen. Three regions but all collapsible.

```
╭────────────────────────────────────────────────────────────────────────────╮
│ ←  Add 2FA to login                                       Linked  [ ⋯ ] ─ │
│ ─────────────────────────────────────────────────────────────────────────  │
│ Today   Yesterday   Apr 27   Apr 25                  ← timeline scrubber  │
│  ████▌▒▒▒▒░░░░ ░░ ░░░░ ░░ ░░ ░░░░░ ░ ░░ ░░░ ░░░ ░░░░░░░░░░░░░ ░░░ ░ ░░░░  │
│ ─────────────────────────────────────────────────────────────────────────  │
│                  │                                       │                │
│   ▾ Add 2FA      │  Add 2FA / Architecture               │  Activity      │
│     📋 Overview  │  ───────────────────────────────────  │  ────────────  │
│     ▾ 🔍 Compet  │                                       │  17:04 🟣 codex│
│        Auth0     │  # Components                         │   started Add  │
│        Clerk     │                                       │   /verify-2fa  │
│     ▾ ⚡ Phase 1 │  - AuthProvider service               │                │
│        🟢Wire ty │  - JWT cookie helper                  │  17:04 🟢 c-c  │
│        🟣Add /v  │  - /auth/* routes                     │   → 50% Wire   │
│     ⚡ Phase 2   │                                       │   types        │
│   + New          │  /                                    │                │
│                  │                                       │  17:00 you     │
│                  │                                       │   moved 'Add   │
│                  │                                       │   tests' under │
│                  │                                       │   Phase 2      │
│                  │                                       │                │
│   ⌘P plan        │                                       │                │
╰────────────────────────────────────────────────────────────────────────────╯
   ↑               ↑                                       ↑
   Sidebar         Main canvas                             Activity drawer
   (collapsible)   (always)                                (toggleable)
```

Components:
- `PlanWorkspaceShell` — wraps everything; manages mode + minimize
  state (existing).
- `PlanWorkspaceHeader` — back button, title, status, link/publish,
  minimize. Carries the timeline scrubber.
- `Sidebar` — tree of `PlanItem` rows (S4). Collapsible.
- `Canvas` — the main page editor. Renders the currently selected
  item (S5).
- `ActivityDrawer` — right rail (S8). Toggleable.

Layout uses `Allotment` (already in app). Sidebar default 280px,
Activity default 320px, both collapsible to icons-only. Keyboard:
`⌘⇧S` toggles sidebar, `⌘⇧A` toggles activity, `⌘[` history back,
`⌘]` history forward.

### S4 — Sidebar tree

The single tree of Objects + Actions (mixed). Each row carries kind
icon, title, status (Actions only), agent presence (Actions claimed).

```
▾ Add 2FA                                                   ← plan root
  📋 Overview                                               ← Object (top)
  ▾ 🔍 Competitor Analysis                                  ← Object w/ kids
     📋 Auth0
     📋 Clerk
     📋 Stytch
  🎨 UX Journey                                             ← Object (template)
  ▾ ⚡ Phase 1 — Foundation               ░░░░  4/8         ← Action (group)
     ⚡ Wire types                       🟢 50%             ← Action (claimed)
     ⚡ Add /verify-2fa                  🟣 30%             ← Action (claimed)
     ⚡ Add tests                        pending
  ⚡ Phase 2 — Migration                                    ← Action (group)
+ New ▾                                                    ← inline create
```

Row affordances:
- Icon: `📋` Object, `⚡` Action. Distinct so the eye can sort
  context from work fast.
- Hover: drag handle, kebab menu (rename, move, delete, duplicate,
  history, copy link).
- Drag-drop: re-parent or reorder. Emits `move_item` → `plan_events`.
- Right-click: same as kebab.
- Status dot for Actions: pending (◯), in_progress (🟢 spinner),
  done (✓), blocked (⚠), skipped (—).
- Agent presence dot for claimed Actions: per-agent colour from a
  rotating palette. Tooltip shows agent type + model.
- Slim progress bar for parent Actions (sums children).

`+ New ▾` at the bottom of every nesting level → small popover:
*Object* (with template sub-menu) / *Action*. ⌘⇧N from anywhere
opens the same popover at the current selection's level.

Component: `PlanItemTree`. Reads `usePlanStore.planItems` (a flat
Map keyed by uid; tree built client-side from `parentUid`). Click →
`selectItem(uid)`; expands automatically when selection lands on a
descendant.

### S5 — Canvas (the page editor)

One item at a time. Single-column content flow: breadcrumb, property
chips, body editor, targets strip, code browser (collapsible),
references, children, comments. Reads like a research page, not a
metadata-stuffed admin panel.

```
╭──────────────────────────────────────────────────────────────────────╮
│ Add 2FA  /  ⚡ Phase 1  /  ⚡ Add /verify-2fa endpoint          🟣 30% │
│ ────────────────────────────────────────────────────────────────────  │
│ [Action] [in_progress ▾] [🟣 codex] [src/api/] [2 files] [History]  │
│                                                                      │
│  Implement the /verify-2fa endpoint. Create @src/api/2fa.ts with     │
│  a @verify2FA handler that accepts {userId, code} and returns a      │
│  session token. Wire it into @src/api/auth.ts at the /verify route.  │
│                                                                      │
│  /  ← slash menu       @ ← code browser (inline)                    │
│                                                                      │
│  ┌── Targets ──────────────────────────────────────────────────────┐ │
│  │ [create] 2fa.ts  [add] verify2FA  [modify] auth.ts  [+ Browse] │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌── Code browser (expanded via Browse) ───────────────────────────┐ │
│  │ 🔍 Search...        │  auth.ts                                  │ │
│  │ 📁 src/             │  ─────────────────────                    │ │
│  │   📁 api/           │  handleLogin()     function               │ │
│  │     📄 auth.ts ●    │  handleRegister()  function               │ │
│  │     📄 2fa.ts  ✚    │  verifySession()   function               │ │
│  │   📁 middleware/    │                                           │ │
│  │                     │  Imports: ← ../types, ← jsonwebtoken     │ │
│  └─────────────────────┴───────────────────────────────────────────┘ │
│                                                                      │
│  ┌── References ───────────────────────────────────────────────────┐ │
│  │ ↗ Architecture object   ↗ RFC URL   📎 Figma mock              │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Children: ⚡ Write TOTP seed generator  ⚡ Add integration tests     │
│                                                                      │
│  Comments (2)                                                        │
╰──────────────────────────────────────────────────────────────────────╯
```

**The same canvas renders both Objects and Actions.** The difference
is what's visible:

- **Object:** body editor with @ references (pinned as context),
  references section, children, comments. No verb badges, no status
  chips. Clean reading/writing surface.
- **Action:** everything an Object has, plus: property chips (status,
  assignee, scope, progress), targets strip with CRUD verbs, code
  browser access, edge declarations.

**Two triggers in the body editor:**
- `/` (slash) — inserts blocks: headings, todos, code fences, child
  Objects/Actions. Same as today.
- `@` (at) — opens the inline code browser. Pick a file or symbol →
  chip inserted in the body, target auto-created. Same browse/search
  as the standalone code browser panel, but triggered from where
  you're writing.

**Targets strip** sits below the body. Auto-populated from @ chips.
Also writable via API (agent adds `fileSpecs` → they appear here).
Each target shows a verb badge (Actions) or a reference icon
(Objects). Click [Browse] to expand the full code browser panel.
Collapsed when empty — invisible for simple prompts.

**Code browser panel** expands below the targets strip when [Browse]
is clicked. Two columns: file tree (left), symbols + imports (right).
Click to add targets. Collapses when done. Same component serves
Objects (reference picks) and Actions (verb picks).

**Reactive real-time:** when an AI agent calls `update_item` to add
file targets or symbol targets, the targets strip updates live. The
human sees the agent's intent appear as it's being written. This is
the review surface where human and AI align.

Breadcrumb segments are clickable (jump to ancestor). `⌘[` / `⌘]`
move through history-stack.

Component: `PlanItemCanvas`. Reads currently-selected `PlanItem`
from store; debounced auto-save on body change → `update_item`,
which emits a new `plan_item_versions` row.

### S6 — Slash menu (block insertion)

Triggered by `/` at line start (or anywhere) inside the body. Inserts
a child block.

```
╭─ / page                  ───────────────────────────╮
│  ◉ Page                  Sub-Object inline          │
│  ⚡ Action               New work item below        │
│  ☐ Todo                  Single inline todo         │
│  ☑ Checklist             Markdown task list         │
│  ⫶ H1 / H2 / H3          Heading                    │
│  </> Code block          Fenced code with language  │
│  ⊞ Table                                            │
│  💡 Callout              Tinted note                │
│  ─ Divider                                          │
│  📎 Reference            Pin URL / file / image     │
│  @ Mention page          @-link to another item     │
╰─────────────────────────────────────────────────────╯
```

Two block types are special:
- `Page` — creates a child Object under the current item, sidebar
  expands, focus jumps to the new page's title input.
- `Action` — creates a child Action. If the current item is an
  Object, the Action becomes a peer (same parent); a confirmation
  toast lets the user "make it a child instead."

`@` mentions surface a fuzzy picker over all items in this plan.
Inserts an inline `@<title>` reference that renders as a clickable
chip in read-mode and expands into linkedDocs / linked-from analysis
on the cross-reference panel (already shipped behaviour, just
re-wired against the new tree).

### S7 — Plan timeline scrubber

Lives in the workspace header, beneath the title bar. Compresses
`plan_events` to a horizontal density strip.

```
Today           Yesterday      Apr 27       Apr 25
 ████▌▒▒▒▒░░░░ ░░░ ░ ░░░ ░░░ ░ ░░ ░░░░ ░░ ░░░░ ░ ░░░░
      ↑ now          ↑ hover                    ↑ click → time-travel
```

Hover: tooltip shows the events in that bucket (e.g. *"3 status
changes, 1 move, 1 comment from codex"*). Click: time-travel — the
sidebar tree snaps to the historical structure (computed by replaying
`plan_events` backwards from now). Read-only banner appears: *"Viewing
plan as of Apr 27 14:12 — return to live."*

`⌘.` opens the timeline as a full-page event list (alternative
view). Each event renders with author tint + a one-line summary +
the affected item.

Component: `PlanTimeline`. Reads `usePlanStore.planEvents` (loaded on
plan open via `get_plan_timeline`). Debounced replay computes the
historical tree shape from the live tree by walking events backwards.

### S8 — Activity drawer

The right rail. Real-time event stream — same data as S7's scrubber
but rendered chronologically newest-first.

```
ACTIVITY (live)
─────────────────────────────────────────────────
17:05  ⚠ codex (you) overlap
       'Add /verify-2fa' touches src/api/auth.ts;
       'Migrate users' (aider) also touches it.
─────────────────────────────────────────────────
17:04  🟣 codex started Add /verify-2fa endpoint
─────────────────────────────────────────────────
17:04  🟢 claude-code → 50% Wire types
       "Halfway through, hitting context limit
        soon, will hand off to codex."
─────────────────────────────────────────────────
17:00  ✏ you moved 'Add tests' under Phase 2
─────────────────────────────────────────────────
16:45  ✓ claude-code completed Migrate users
─────────────────────────────────────────────────
                                       ↓ 50 more
```

Toggleable (icon-only collapsed shows just the latest event with a
pulse). Filter chips at the top: *all / mine / agents / blockers /
progress / structure*. Click any event row → jumps to the affected
item; pulses the row in the sidebar to anchor the user's
attention.

### S9 — Per-item shift drawer

A small "history" affordance on every item card (in the Status
panel for Actions, in a footer button for Objects). Opens a side-by-
side: every event scoped to this item + every body version.

```
╭─ History · Add /verify-2fa ──────────────────────────╮
│  v3  17:04  🟣 codex          status → in_progress   │
│  v2  16:50  you               file_specs updated     │
│  v1  16:32  you               created                │
│  ──────────                                          │
│  Compare:  [ v2 ⇆ v3 ]   [ Restore v2 ]             │
╰──────────────────────────────────────────────────────╯
```

Restore-a-version writes a new `plan_item_versions` row pointing at
the old body + meta, plus a `plan_events` `item_restored` row.

### S10 — Drift overlay (graph integration)

When the user switches back to graph mode (or in a future pass: a
mini-graph embedded in the workspace), Action `fileSpecs` + edges
project onto the graph nodes:

- ✓ matched (planned + done) — green ring
- ⚠ unexpected (done but not planned) — amber ring + reason chip
- ✗ missing (planned but not done) — dashed grey ring

Click an unexpected/missing node → drift report panel opens with
one-keystroke fixes (extend Action / revert / accept). Implementation
extends today's deviation service. The graph workstream §5.9 already
calls this "drift visible enough that a human can intervene quickly"
— this is what closes that bullet.

---

## Migration

Existing plans live both in user DBs (`~/.codetrellis/codetrellis.db`)
and on user disks (`<project>/.codetrellis/plans/<slug>/`). We have
to upconvert both, idempotently, without losing data. Strategy:
**ship dual-read code first; one-time migrator second; deprecate old
tables third.**

### Phase 15 sub-plans (mirrors implementation order)

1. **15.A — Foundations.** New tables (`plan_items`,
   `plan_item_versions`, `plan_events`) added alongside the old ones.
   New types in `shared/types/plan.ts`. `plan-item-service.ts` +
   `plan-event-service.ts` written from scratch. **No tools or UI use
   them yet.** Just compiles, passes typecheck, harness still green.

2. **15.B — Migrator.** `services/plan-migrate-service.ts` walks the
   DB:
   - For each `plan` row, find its `plan_documents` (→ Objects),
     `plan_phases` (→ folder Actions), `tasks` (→ Actions or child
     Actions via phaseUid). Insert into `plan_items` preserving uids
     and stable sort orders. Bodies, attachments, comments stay
     pointing at the same uids.
   - For each migrated item, write a synthetic `plan_events`
     `item_created` row with the original `created_at`.
   - Idempotent: re-running on an already-migrated DB no-ops (every
     plan_items row carries a `migrated_from` field pointing at the
     legacy table + id; presence skips re-insert).
   - **Dry-run by default** in dev; opt-in via
     `CODETRELLIS_RUN_MIGRATION=1` env until we flip the default.

3. **15.C — Unified service + MCP.** Old service layer
   (`plan-service`, `plan-documents-service`, `plan-phases-service`)
   keeps reading from old tables for a release cycle. New
   `plan-item-service` reads from `plan_items`. MCP tool aliases
   (per the §Architecture table) forward both ways:
   - `add_plan_doc` → if migration done, `add_item(kind='object')`;
     else legacy path.
   - Same for `add_plan_phase`, `add_subtask`, `update_task`,
     `claim_task`, `read_task_full`, etc.
   - `export_plan_to_files` learns the new disk layout (see below)
     but can read either layout (dual-read importer).
   - WS broadcasts dual-fire during the cutover: every old event
     also emits its `plan-item-*` equivalent so frontend code can
     subscribe to either.

4. **15.D — Frontend rebuild.** Old workspace components
   (`SpecRail.tsx`, `TaskCenter.tsx`, `TaskCard.tsx`,
   `ActivityRail.tsx`, `MinimizedPlanChip.tsx`,
   `PlanWorkspace.tsx`, `PlanDetail.tsx`, `PlanPhases.tsx`,
   `SpecRoom.tsx`, `SpecDocViewer.tsx`, `SpecDocCreateModal.tsx`,
   `CommentThread.tsx`) **deleted**. Replaced by:
   - `PlanStrip` (S1)
   - `PlanCaptureModal` (S2)
   - `PlanWorkspaceShell`, `PlanWorkspaceHeader`, `PlanTimeline` (S3, S7)
   - `PlanItemTree` (S4)
   - `PlanItemCanvas` (S5) + `SlashMenu` (S6)
   - `PlanActivityDrawer` (S8)
   - `PlanItemHistoryDrawer` (S9)
   - `DriftOverlay` (S10)

   Stores: rename `plan-store.ts` → unified `plan-store.ts` with
   `planItems: Record<uid, PlanItem>`, `planTrees:
   Record<planUid, uid[]>` (root children, children-of resolved via
   `parentUid`), `planEvents: PlanEvent[]`, `selectedItemUid`,
   `historyStack`. Ditch `taskContexts` Map (subsumed).

   Bottom strip stays mounted in graph mode; in plan mode the
   workspace overlays (existing animation pattern from 14.B
   carried over).

5. **15.E — Disk layout migration.** `migrate-plans` CLI
   (`scripts/migrate-plans.ts`):
   - `npm run plans:migrate` (dry-run by default; `--write` to
     actually move files).
   - Walks `<project>/.codetrellis/plans/<slug>/`, reads the legacy
     flat layout, rewrites to the new tree-mirror layout (see §
     Disk layout above).
   - Old files renamed to `*.legacy` first, then deleted on
     `--cleanup` after the user verifies.
   - Backwards-compatible: the new importer reads either layout.
     User can defer running the script indefinitely; everything
     keeps working.

6. **15.F — Skill guide + tests.**
   - Rewrite `mcp/skill-guide.ts` around Object/Action vocabulary.
     Old vocab kept in a "Legacy tool names" appendix.
   - Harness gains `plan-items.test.ts` covering each new MCP tool
     + the new event log + the timeline replay.
   - Existing harness tests (`plan-export`, `plan-templates`,
     `task-context`, `agent-loop`, `multi-agent`, `loop`,
     `cross-system`, `smoke`) stay green by riding the alias paths.

### Roll-out

- **Pre-release:** ship 15.A through 15.D behind a localStorage flag
  (`codetrellis:planV2 = '1'`) so dogfooders can flip it on without
  breaking everyone. Old workspace stays default during this window.
- **Beta:** flip default to V2; keep V1 reachable via flag for
  bug-fix windows.
- **Stable:** rip out V1 components + retired tables. Two minor
  versions later.

### Data we MUST NOT lose

| Today | Where it goes |
|---|---|
| `plan_documents.body` | `plan_items.body` (kind='object') |
| `plan_documents.docType` | `plan_items.template` |
| `plan_documents.parentDocUid` | `plan_items.parent_uid` |
| `plan_documents.orderHint` | `plan_items.sort_order` (parsed numeric) |
| `plan_phases.*` | `plan_items` (kind='action', children = tasks bound to phaseUid) |
| `tasks.*` | `plan_items` (kind='action') |
| `tasks.parentTaskUid` | `plan_items.parent_uid` (within Action sub-tree) |
| `tasks.fileSpecs` | `plan_items.file_specs` (FileSpec → FileSpec; `edits` empty initially, can be filled in later) |
| `attachments` (already unified) | unchanged — `target_type='task'` rows update to `target_type='item'` via migrator |
| `comments` (already unified) | unchanged — same |
| `plan_versions` | unchanged — whole-plan snapshots keep working |
| `trellis_snapshots` | unchanged |
| `plan_item_versions` | new — populated on first edit after migration |
| `plan_events` | new — populated on first move/edit after migration; backfilled with synthetic `item_created` per row |

---

## Edit log

- v0.5 (2026-04-29) — drafted §UI surfaces (10 surfaces S1–S10:
  bottom strip, capture modal, workspace shell, sidebar tree, page
  canvas, slash menu, timeline scrubber, activity drawer, per-item
  history drawer, drift overlay) and §Migration (six-stage rollout
  15.A–15.F with explicit data-preservation table). The doc is now
  the implementation contract; build begins.
- v0.4 (2026-04-29) — drafted §Architecture. Three altitudes of
  change tracking (`plan_item_versions` for content, `plan_events`
  for structure, `plan_versions` for checkpoints). DDL for
  `plan_items` + `plan_item_versions` + `plan_events`. TypeScript
  shapes for `PlanItem` + `FileSpec` + `FileEdit` + `PlanEvent`.
  Unified MCP surface (`add_item` / `read_item_full` / `move_item` /
  `delete_item` / `claim_item` / `list_items` / `get_plan_timeline`)
  with back-compat aliases for the old task/doc/phase tools. WS event
  taxonomy. Disk layout — pages mirror to folders when they have
  children. Plan-shift surfaces: activity rail (event stream),
  per-item shift drawer, plan timeline scrubber (replays events
  backwards from current state). Author attribution called out as a
  cross-cutting requirement for the multi-agent flows.
- v0.3 (2026-04-29) — added Flow 5 (multiple agents working
  simultaneously — distinct from sequential handoff in Flow 4) with
  presence dots, conflict-overlap warnings, and shared activity
  stream. Renumbered Verify-against-drift to Flow 6. Resolved M1
  (per-item version log) and M2 (multiple files + per-file edits[]
  with optional lineRange / symbolRef / instruction — supports the
  full breadth from one-line natural-language Action up to
  line-precise spec'd Action). Updated schema table. User confirmed
  purpose, all six flows, and the M1/M2 calls.
- v0.2 (2026-04-29) — rewrote v0.1. Replaced 13 journeys + 7 Q's with
  user flows + 2 small mechanical Q's. Centred on durable memory +
  graph anchoring as the meta-purpose. Reflects the Object/Action
  primitive model (mixed tree, depth user's call). User confirmed
  flows lead with humans where appropriate; agents are an
  amplifier, not a prerequisite.
- v0.1 (2026-04-29) — initial draft, journeys + Notion comparison.
  Superseded.
