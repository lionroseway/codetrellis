# Phase 16: Plan Workspace UX Overhaul

**Status:** planning
**Last updated:** 2026-05-17
**Depends on:** Phase 15 (V2 data model + components)
**Supersedes:** V1 workspace entirely

---

## Goal

Make the V2 plan workspace the **only** plan experience, and make it
feel intuitive for both humans and AI agents to build plans, see
proposed changes on the graph, and track progress.

A plan is a **Notion-like workspace** — a tree of pages that can hold
specs, PRDs, research, architecture notes, and code change actions.
Simple plans are a single page with a sentence. Deep plans have nested
sub-pages across phases with full refactoring specs. The same surface
serves both.

The graph is the map. Plans describe what should change. The graph
shows where.

---

## Current State (what exists)

### V2 has (the right bones)
- **PlanItem model** — Objects (context pages) and Actions (work
  items) that nest hierarchically
- **Body editor** — markdown with / slash menu and @ mention picker
  for files/symbols
- **ContextRail** — fileSpecs, symbolSpecs, edges, attachments with
  AnchorPicker for browsing the project tree
- **TargetsStrip** — pill strip showing all targets from body chips +
  API-added specs
- **Graph projection** — 4 modes (Live/Baseline/Planned/Diff) with
  color-coded planned nodes/edges
- **Drift detection** — compares planned fileSpecs against actual
  changes
- **MCP tools** — 15+ tools for agents to create/update plans and
  items
- **Activity drawer** — plan event timeline
- **History drawer** — version history per item

### V1 still gates the experience (to remove)
- **PlanCreateModal** — V1 modal (Title + Description + Tasks) blocks
  quick-create
- **PlanPanel bottom panel** — uses V1 PlanList and PlanDetail
- **V1 workspace folder** — PlanWorkspace, TaskCenter, TaskCard,
  SpecRail, ActivityRail still exist
- **planV2Enabled flag** — conditional rendering in App.tsx
- **PlanDetail, PlanPhases, SpecRoom, SpecDocViewer,
  VerificationPanel** — V1 components still imported

### UX problems (from May 4 audit — docs/UX-FLOW-AUDIT.md)
1. Plan creation uses V1 modal (wrong model)
2. Clicking a plan silently fails (fetchPlan has no error handling)
3. No error feedback on any async failure
4. New pages show 8 empty sections stacked vertically
5. Three overlapping code-reference UIs (body, TargetsStrip,
   ContextRail)
6. +Add menu has 10 options (overwhelming)
7. Quality nudge fires on blank items (feels scoldy)
8. Object/Action is internal jargon
9. Body requires click-to-enter (not Notion-like)
10. No way to start planning from the graph
11. No split view (graph + workspace together)

---

## UX Journey (what the experience should be)

### Step 1: Discovery — "I have plans"

The bottom panel Plans tab is the dashboard. It shows all plans for
the current project as cards:
- Title, status badge, page/action counts, progress bar
- One click → opens the V2 workspace (full-screen takeover)
- "+ New plan" → instant creation, no modal, workspace opens with
  cursor in the title

When an AI agent creates a plan via MCP, it appears in the list
immediately (WS push). A subtle notification lets the user know.

### Step 2: The Workspace — "I'm building"

The workspace is Notion-like:
- **Left sidebar** — page tree showing the plan's structure. Objects
  and Actions are visually distinct (icon + optional status badge).
  Hover to add a sub-page. Drag to reorder/nest.
- **Main canvas** — the selected page. Clean: just title + body when
  new. Additional sections (targets, context, comments) appear as
  content is added (progressive disclosure).
- **Activity drawer** — collapsible right panel showing plan events.

A new page is blank. You just start typing. Press `/` for sub-pages,
headings, todos, code blocks. Press `@` to reference files, symbols,
or other plan items. That's it.

### Step 3: Describing Changes — "Here's what should happen"

Some pages are narrative (PRD, spec, research). Some pages are Actions
that describe code changes. When writing an Action:

- **Loose spec**: Just write natural language. "Refactor the auth
  module to support OAuth." No structured data needed. Valid prompt.
- **Precise spec**: Use `@` to reference specific files and symbols.
  Each @ creates a structured target. Expand to add verb (create/
  modify/delete/move), new signature, description.
- **Refactoring spec**: "All callers of `@OldService.fetch` should
  switch to `@NewService.query`." The system finds call sites and
  shows blast radius.

Progressive precision — the user picks how deep to go.

### Step 4: Seeing the Impact — "Show me on the map"

The graph shows what this plan will change:
- **Planned mode** — nodes/edges colored by planned action (green =
  add, amber = modify, red = remove)
- **Diff mode** — planned vs actual, shows what's landed and what's
  missing
- **Plan layers** — toggle different plans on/off to see overlap
- **Split view** — workspace on right, graph on left, live-linked

From the graph side: right-click any node → "Plan a change" → opens
or adds to the active plan.

### Step 5: Tracking — "What's done, what's left"

- Actions have status (pending → in progress → done → blocked)
- Sidebar tree shows status with color/icon
- Plan home page shows summary: X of Y actions done, drift alerts
- Drift detection: "Agent said it would modify these 3 files — 2
  landed, 1 is missing"

---

## Implementation Phases

### 16.A — Drop V1 + Fix Plumbing

Remove V1, make the basic journey work end-to-end.

| Task | Files | Status |
|------|-------|--------|
| Delete V1 workspace folder | `plan/workspace/` (PlanWorkspace, TaskCenter, TaskCard, SpecRail, ActivityRail, cross-references) | pending |
| Delete V1-only components | PlanDetail, PlanPhases, SpecRoom, SpecDocViewer, VerificationPanel | pending |
| Remove `planV2Enabled` flag | `ui-store.ts`, `App.tsx`, `PlanList.tsx` | pending |
| Rewire PlanPanel (bottom panel) | `layout/PlanPanel.tsx` — replace V1 PlanList/PlanDetail with V2 equivalents | pending |
| Kill PlanCreateModal gate | All "+New" buttons → quick-create (no modal) | pending |
| Fix fetchPlan error handling | `plan-store.ts` — check `res.ok`, show error toast, don't set garbage state | pending |
| Fix setActivePlan error path | `plan-store.ts` — if fetchPlan fails, don't set activePlanUid | pending |
| Keep StatusBadge, PublishTemplateModal | Shared components, no removal needed | n/a |
| Keep ProposedChanges | Still used in bottom panel (no V2 replacement yet) | n/a |

### 16.B — Clean Page Experience

Progressive disclosure. New pages are clean. Complexity appears as
content arrives.

| Task | Files | Status |
|------|-------|--------|
| Progressive disclosure: hide empty TargetsStrip | `TargetsStrip.tsx` — don't render when zero targets | pending |
| Progressive disclosure: hide empty ContextRail | `ContextRail.tsx` — collapse to single "+ Add context" button when empty | pending |
| Progressive disclosure: hide empty CommentsBlock | `PlanItemCanvas.tsx` — show "Add comment" link instead of full composer | pending |
| Delay quality nudge | `PlanQualityNudge.tsx` — only fire when body has >50 chars AND zero targets | pending |
| Body starts in edit mode when empty | `PlanItemCanvas.tsx` BodyEditor — if body is empty, default to editing=true | pending |
| Plan body starts in edit mode when empty | `PlanItemCanvas.tsx` PlanBodyArea — same | pending |
| Rename Object/Action labels | User-facing text: "Page" and "Task" (or auto-classify) | pending |

### 16.C — Plan Dashboard + Sidebar

The plan list and sidebar should feel polished and navigable.

| Task | Files | Status |
|------|-------|--------|
| Redesign bottom panel plan list | New V2 plan list component with cards (title, status, progress, counts) | pending |
| Plan home page summary | Show change counts, action progress, minimap of affected graph nodes | pending |
| Sidebar: Notion-like hover-to-add | `PlanItemTree.tsx` — hover a node → "+" button appears for child creation | pending |
| Sidebar: status indicators | Show action status (color dot or icon) next to items in tree | pending |
| Sidebar: drag to reorder/nest | `PlanItemTree.tsx` — drag-and-drop reordering | pending |

### 16.D — Code Authoring Polish

Make specifying code changes fast and intuitive.

| Task | Files | Status |
|------|-------|--------|
| Simplify +Add menu | Reduce from 10 to ~5 clear options. Kill target/reference distinction. | pending |
| Merge TargetsStrip into ContextRail | One "Targets" section, not two overlapping UIs | pending |
| Symbol-aware file expansion | When a file target is added, fetch its AST symbols and display inline | pending |
| Better edge authoring | Use picker for from/to (search graph nodes) instead of freeform text | pending |
| Blast radius display | "Called by N files" on symbol targets, using call-site data | pending |
| Refactoring patterns | Pattern-based specs: "all callers of X → change to Y" | pending |

### 16.E — Graph Integration

Connect the workspace to the graph so they're one experience.

| Task | Files | Status |
|------|-------|--------|
| Graph node → plan action | Right-click node → "Plan a change" / "Add to plan" | pending |
| Plan layers | Toggle multiple plans on/off on the graph | pending |
| Split view | Workspace + graph side by side, live-linked | pending |
| Live graph highlighting | As changes are added to the plan, graph nodes pulse/glow | pending |

---

## Design Principles

1. **Start simple, reveal complexity.** A new plan is a blank page.
   You just type. Structure appears as you add it.

2. **The body is the prompt.** Natural language first. Structured data
   (fileSpecs, symbolSpecs) is optional precision on top.

3. **Progressive disclosure.** Empty sections don't render. Quality
   nudges don't fire on blank items. The UI grows with the content.

4. **One place per concept.** Code targets have one UI (not three
   overlapping ones). Adding context has one flow (not 10 menu items).

5. **The graph is the map.** Plans describe intent. The graph shows
   impact. They should be connected, not separate worlds.

6. **Notion-like feel.** Pages nest. Bodies are rich. Navigation is a
   tree. Creating is instant. Editing is inline.

---

## Files to Delete (V1 cleanup)

```
src/frontend/components/plan/workspace/
  PlanWorkspace.tsx
  TaskCenter.tsx
  TaskCard.tsx
  ActivityRail.tsx
  SpecRail.tsx
  MinimizedPlanChip.tsx     (keep if used by V2 — check)
  cross-references.ts

src/frontend/components/plan/
  PlanDetail.tsx
  PlanPhases.tsx
  SpecRoom.tsx
  SpecDocViewer.tsx
  VerificationPanel.tsx
  spec-doc-types.tsx        (keep if used by V2 or API)
```

## Files to Modify

```
src/frontend/App.tsx                    — remove planV2Enabled conditional
src/frontend/stores/ui-store.ts         — remove planV2Enabled state
src/frontend/stores/plan-store.ts       — fix fetchPlan error handling
src/frontend/components/layout/PlanPanel.tsx — rewire to V2 components
src/frontend/components/plan/PlanList.tsx    — remove planV2Enabled branch
src/frontend/components/plan/v2/PlanItemCanvas.tsx — progressive disclosure
src/frontend/components/plan/v2/TargetsStrip.tsx   — hide when empty
src/frontend/components/plan/v2/ContextRail.tsx    — simplify Add menu
src/frontend/components/plan/v2/PlanQualityNudge.tsx — delay firing
src/frontend/components/plan/v2/PlanItemTree.tsx   — sidebar polish
```
