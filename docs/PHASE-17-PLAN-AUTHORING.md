# Phase 17: Plan Authoring — Make It Easy to Pick Up and Run

**Status:** design
**Last updated:** 2026-05-17
**Depends on:** Phase 16 (UX overhaul complete)
**Goal:** A human opens CodeTrellis, understands their codebase in 30
seconds, builds a plan in 2 minutes, and hands it to an AI agent.

---

## The Problem

Phase 16 made the workspace clean and intuitive. But there's still a
gap between "I opened the app" and "I have a plan ready to execute."
The human needs to:

1. **Understand what's here** — What does this codebase look like?
   What are the major systems? Where are the boundaries?
2. **Decide what to change** — Which files, which modules, what's the
   scope?
3. **Describe the change precisely enough** — So an AI agent can act
   on it without ambiguity.
4. **Track that it happened** — Did the agent do what was asked? What
   drifted?

Phase 17 focuses on making steps 1–3 fast and frictionless.

---

## Design Principles

1. **Show, don't tell.** The graph IS the understanding. Don't make
   people read docs to understand the codebase — let them see it.
2. **Selection → Action.** Click files on the graph → they become plan
   targets. The plan writes itself from selections.
3. **Progressive precision.** "Fix the auth" is valid. "Modify
   src/auth/oauth.ts lines 40-60 to add refresh token rotation" is
   also valid. The tool supports both without forcing either.
4. **The plan is the prompt.** When you hand a plan to an agent, it
   should be exactly what the agent needs — no translation step.

---

## Proposed Features

### 17.A — Quick-Start Flows (onboarding → plan in 60 seconds)

**Problem:** New users open the app, see a graph, and don't know where
to start building a plan.

**Solution:** Guided quick-start paths:

| Flow | Trigger | What happens |
|------|---------|--------------|
| "What should I change?" | User right-clicks a cluster/package | Shows blast radius, suggests plan scope |
| "I know what I want" | User clicks "+ New plan" | Wizard: (1) name it, (2) select files from graph, (3) describe intent → done |
| "Import from issue" | User pastes a GitHub/Linear issue URL | Extracts title + description, pre-fills plan, auto-maps mentioned files to targets |
| "Agent suggested this" | Agent creates plan via MCP | Plan appears with "Review & approve" banner. One click to accept. |

The key insight: **most plans start from a selection of files or a
description of intent.** Optimize for those two entry points.

### 17.B — Selection-Driven Planning

**Problem:** The graph shows the codebase but you can't easily select
multiple nodes and turn them into plan targets.

**Solution:**

1. **Multi-select on graph** — Shift+click or lasso to select multiple
   nodes. Selection persists across pans/zooms.
2. **"Plan these" button** — Appears when 2+ nodes selected. Creates a
   task with all selected files as targets.
3. **Drag from graph to workspace** — Drag a node from the graph and
   drop it on the plan body or targets area.
4. **Cluster → plan scope** — Right-click a package/directory cluster →
   "Scope plan to this" → sets `scopePath` on the active task.

### 17.C — Smart Plan Templates (intent-driven)

**Problem:** Templates exist but they're structural (empty page
hierarchies). They don't help you describe WHAT to change.

**Solution:** Intent-driven templates that ask the right questions:

| Template | What it produces |
|----------|-----------------|
| **Refactor** | "What to rename/move, from where, to where. Blast radius (auto-computed). Migration plan for callers." |
| **New feature** | "What it does, where it lives (package/folder), what it touches (interfaces, tests). Acceptance criteria." |
| **Bug fix** | "What's wrong, where it happens (file/line), expected behavior. Repro steps. Root cause hypothesis." |
| **Dependency upgrade** | "Package name, current version, target version. Breaking changes (from changelog). Affected imports (auto-scanned)." |
| **API change** | "Endpoint(s), current contract, new contract. Callers to update (auto-found from cross-system extraction)." |

Each template:
- Pre-fills the body with prompting questions (not empty sections)
- Auto-attaches relevant context (e.g., refactor → auto-finds callers)
- Produces a plan that an agent can directly execute

### 17.D — Symbol-Aware File Expansion

**Problem:** "Modify src/auth/service.ts" is vague. The agent has to
read the whole file to figure out what to change.

**Solution:** When a file is added as a target, expand it:

1. **Auto-fetch AST symbols** — On target add, call
   `/api/symbols?file=<path>` to get classes, functions, exports.
2. **Inline symbol list** — Show expandable symbol tree inside the
   ContextRail for each file target. User checks the specific
   functions they want changed.
3. **Per-symbol instructions** — Each checked symbol gets an optional
   instruction field: "Add refresh token rotation to this method."
4. **Blast radius badge** — "Called by 7 files" on each symbol. Click
   to see the caller list. Toggle "include callers in plan" to
   auto-add them as targets.

This bridges the gap from "modify this file" to "modify this specific
function in this specific way."

### 17.E — Plan Validation & Readiness

**Problem:** User writes a plan but doesn't know if it's "good enough"
for an agent to execute.

**Solution:** Plan readiness score (not a nudge — a checklist):

| Check | What it means |
|-------|---------------|
| ✓ Has title | Plan has a non-empty title |
| ✓ Has description | Plan body has >1 sentence describing intent |
| ✓ Tasks have targets | Every action item references at least 1 file |
| ✓ Targets exist | All referenced files actually exist in the project |
| ✓ No circular deps | Task dependency graph has no cycles |
| ○ Symbols specified | Targets have specific functions/classes (bonus) |
| ○ Tests mentioned | Plan references or creates test files (bonus) |

Display as a subtle progress ring in the workspace header.
"Ready to hand off" when core checks pass. "Could be more specific"
when bonus checks fail.

### 17.F — One-Click Handoff to Agent

**Problem:** User finishes a plan, then has to copy context into their
agent's CLI or prompt.

**Solution:** "Hand off" button in workspace header:

1. **Copy as prompt** — Generates a markdown prompt from the plan
   (title + body + targets + task list) optimized for the active agent
   (Claude Code, Cursor, etc.). One click copies to clipboard.
2. **Push via MCP** — If an agent is connected via MCP, push the plan
   directly. Agent receives it as a structured message with file
   targets, scope, and instructions.
3. **Assign to connected agent** — In the workspace, click "Assign" →
   shows connected agents → pick one → plan status flips to
   "assigned" and the agent receives the plan.

### 17.G — Live Progress Tracking (during execution)

**Problem:** Agent is executing the plan. User doesn't know what's
happening until it's done.

**Solution:** Real-time progress overlay:

1. **Task status auto-update** — Agent reports progress via MCP
   (`report_progress`, `mark_task_done`). Status badges update live.
2. **Graph node animation** — Files being actively modified pulse
   amber. Files completed pulse green briefly then settle.
3. **Drift alerts** — If the agent modifies a file NOT in the plan,
   show a "drift" warning: "Agent touched src/unplanned.ts — not in
   your plan targets."
4. **Completion summary** — When all tasks are done, show a summary:
   "4/4 tasks complete. 12 files modified. 2 unexpected changes."

---

## Priority Order

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| P0 | 17.B Selection-driven planning (multi-select, "Plan these") | 2 days | Core workflow improvement |
| P0 | 17.D Symbol-aware file expansion | 2 days | Precision for agents |
| P1 | 17.A Quick-start flows (wizard, issue import) | 2 days | Onboarding |
| P1 | 17.F One-click handoff | 1 day | Completes the loop |
| P1 | 17.E Plan validation & readiness | 1 day | Confidence |
| P2 | 17.C Smart templates | 2 days | Power users |
| P2 | 17.G Live progress tracking | 2 days | Monitoring (partially exists) |

---

## Key Insight: The Plan is a Prompt

The ultimate measure of Phase 17 is: **can a user go from "I want to
change X" to handing an agent a structured, unambiguous plan in under
3 minutes?**

Today:
- Open app → see graph → understand structure: ~2 min ✓
- Decide what to change: depends on user
- Build the plan: ~5–10 min (too much manual work picking files,
  writing descriptions, specifying targets)
- Hand to agent: copy-paste or manual MCP

After Phase 17:
- Open app → see graph → understand structure: ~30 sec (clustering)
- Decide what to change: ~30 sec (select on graph)
- Build the plan: ~1–2 min (selection → plan, symbol expansion,
  template prompts)
- Hand to agent: 1 click

---

## Dependencies

- **17.D depends on:** existing AST symbol API (`/api/symbols`), which
  already returns per-file function/class/export data.
- **17.B depends on:** ReactFlow multi-select support (built-in via
  `selectionOnDrag` + `multiSelectionKeyCode`).
- **17.F depends on:** MCP server already broadcasting tool calls. Need
  a new `plan_handoff` tool that agents register to receive.
- **17.G depends on:** existing `report_progress` and `mark_task_done`
  MCP tools + WS broadcast.

---

## Non-Goals (Phase 18+)

- AI-generated plans (agent reads codebase and suggests what to
  change) — separate feature, not authoring UX
- Plan versioning / branching (multiple draft versions of same plan)
- Multi-user collaboration (two humans editing same plan live)
- CI/CD integration (auto-trigger pipeline when plan completes)
