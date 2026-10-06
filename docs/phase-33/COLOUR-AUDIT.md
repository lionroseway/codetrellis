# Phase 33 0.3: colour audit

Every colour the graph, the Explorer, the plan canvas, the Timeline and the
Awareness tab draw, what it means there, and where (file and line, at
`feat/phase-33` on 2026-10-06). Then the collisions, the legends that
exist, and the draft vocabulary G1 builds from. Design §1.3 summarises it;
G1 and G2 are the steps that act on it.

All paths below are relative to `src/frontend/`: `components/graph/nodes/FileNode.tsx:68` is `src/frontend/components/graph/nodes/FileNode.tsx`, line 68.

Theme tokens (`styles/globals.css:18-42`):
- `accent` #3b82f6 (blue-500)
- `success` #22c55e (green-500)
- `warning` #f59e0b (amber-500)
- `danger` #ef4444 (red-500)
- `info` #8b5cf6 (violet-500)
- `--color-node-*` vars are defined (lines 33-42), but no component in scope uses them.

I left out pure chrome: neutral greys, white/[0.0x] borders, hover backgrounds, `text-foreground*`, and accent used only as an interactive button or link colour.

---

## Before the tables: three things that are not what the code says

1. **Edge styles set in `lib/graph-builder.ts` never render.** `components/graph/edges/ImportEdge.tsx:78-125` ignores the edge's `style` prop. It draws only from `edgeVisuals(importState)`. So these are dead:
   - cluster edge blue 0.4 (`graph-builder.ts:591`)
   - hub edge blue 0.3 (`:705`)
   - symbol link white 0.1 (`:778`)
   - focus outbound blue 0.5 (`:815`)
   - focus inbound **amber** 0.5 (`:856`)
   - ghost edge green dashed `8 4` (`:461`)
   - **all cross-system protocol tints, dashed `4 3`** (`:1097-1101`, `protocolTint` `:1115-1123`)
   - all `labelStyle` fills

   The component does not handle `importState: 'cross_system'` (`:1106`), so it falls to the default case: solid blue-400 at 0.7 (`ImportEdge.tsx:68-74`). **Cross-system edges are drawn exactly like import edges today.**
2. **The minimap encodes no state.** Every node is `rgba(59,130,246,0.6)` (`components/layout/MainCanvas.tsx:1239`).
3. **The task page's status control has no colour.** `components/plan/v2/PlanItemCanvas.tsx:48-55` defines per-status tints, but the status `<select>` (`:344-353`) uses only the labels, so the tints are never shown.

---

## (a) Colour usage by surface

### 1. Dependency graph

**File nodes: change status** (`lib/graph-visuals.ts` `CHANGE_VISUALS`; `components/graph/nodes/FileNode.tsx`)

| Colour | Meaning | Where (file:line) | Glyph/words |
|---|---|---|---|
| emerald-500 fill + emerald-300/55 border, glow rgba(34,197,94) | file added (also git untracked, staged-added; `graph-builder.ts:1009-1013`) | graph-visuals.ts:113; FileNode.tsx:67; PackageNode.tsx:35 | chip `+` (FileNode.tsx:225-228) |
| emerald, dashed border, faded | planned add (ghost file) | graph-visuals.ts:114; FileNode.tsx:64 | `+` chip, `NEW` pill (FileNode.tsx:230-233), task description in emerald box (:217-221) |
| amber-500 fill + amber-300/55 border | file modified | graph-visuals.ts:115; FileNode.tsx:68; PackageNode.tsx:35 | `~` chip |
| orange-500 fill + orange-300 border | planned modify | graph-visuals.ts:116; FileNode.tsx:70; PackageNode.tsx:35 | `~` chip; dashed outline in performance mode (graph-visuals.ts:220) |
| red-500 fill + red-300 border, opacity 55% | removed | graph-visuals.ts:117; FileNode.tsx:69, :65 | `-` chip, name struck through (:165) |
| red, dashed outline | planned remove | graph-visuals.ts:118; FileNode.tsx:71 | `-` chip, strikethrough |
| blue-500 glow, pulsing (double outline in performance mode) | file of an in-progress task | graph-visuals.ts:119, :215-216; FileNode.tsx:100-107 | `>` chip |
| blue-400 glow, pulsing | active (agent working now) | graph-visuals.ts:120 | `*` chip |
| violet-500 glow | affected (blast radius) | graph-visuals.ts:121; graph-builder.ts:1022-1023 | `!` chip |
| fuchsia-500 fill + border | unexpected live change (drift) | graph-visuals.ts:122; FileNode.tsx:72; PackageNode.tsx:35 | `!` chip |
| status colour, 8px outline + 80% fill when zoomed out | any status below zoom 0.4 (performance mode) | graph-visuals.ts:254-264 | big `+ ~ - > * !` (FileNode.tsx:120-122) |
| language colour, 1px outline | no status: identity only | graph-visuals.ts:230 | none |

**File nodes: git-state chips** (`FileNode.tsx:240-257`)

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| emerald-500/14 | planned_add | FileNode.tsx:244 | "planned +" |
| **amber**-500/14 | planned_modify (the node itself is **orange**) | FileNode.tsx:245 | "planned ~" |
| red-500/14 | planned_remove | FileNode.tsx:246 | "planned −" |
| emerald-500/10 | untracked | FileNode.tsx:247 | "untracked" |
| sky-500/10 | staged | FileNode.tsx:248 | "staged" |
| orange-500/10 | unstaged (default branch) | FileNode.tsx:249 | "unstaged" |

**File nodes: view mode** (`FileNode.tsx:73-75`, chips :178-185; `PackageNode.tsx:35, :74-78`)

| Colour | Meaning | Glyph/words |
|---|---|---|
| blue-500 tint, slight grayscale | Baseline view | "baseline" |
| emerald-500 tint | Planned view | "planned" |
| fuchsia/purple-500 tint | Diff view | "diff" |
| green-500 tint | other mode | mode word |

**File nodes: badges and overlays**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| blue-500/14 badge | task number | FileNode.tsx:127 | number |
| emerald-500/16 badge | task done | FileNode.tsx:133 | Check icon |
| blue-500/14 badge | outbound import, focus view | FileNode.tsx:141 | ArrowUpRight |
| amber-500/14 badge | inbound import, focus view | FileNode.tsx:142 | ArrowDownLeft |
| accent ring + pulse (glass); 3px solid accent outline (performance) | file in active plan's footprint ("Plan intent" overlay) | FileNode.tsx:76, :109-113; graph-visuals.ts:224-225, :258 | none |
| white 3px outline, offset 3 | focused/selected node (performance mode) | graph-visuals.ts:227-228 | Focus button |
| glow in the node's own status colour, pulsing | focused node (glass mode) | FileNode.tsx:100-107 | none |
| 50% opacity | not related to selection | FileNode.tsx:66 | none |
| 65% opacity, desaturated | frozen | FileNode.tsx:63 | none |
| `warning` amber border/text on #2a1f08 | breakpoint on node | nodes/BreakpointBadge.tsx:13 | ⏸ + hover words |
| red-400 / #2a0b0b | tests failing | nodes/GroundingMark.tsx:9 | ✗ + words |
| amber-400 / #2a1f08 | tests older than code | GroundingMark.tsx:10 | ⚠ |
| emerald-400 / #06221a | tests passing | GroundingMark.tsx:11 | ✓ |
| white/15, zinc-400 | no tests | GroundingMark.tsx:12 | ○ |
| violet-400 dashed ring (violet-300 if serious, /30 if sequenced) | planned overlap (play-forward) | nodes/PlannedOverlapMark.tsx:14, :17, :26 | "◇ planned overlap" |
| rose-400 2px dashed ring + rose badge | collision zone: open overlap between workstreams | nodes/WorkOverlayMarks.tsx:15, :21 | ⚠ + summary on hover |
| sky-400/40, sky-300 text | other workstreams' line counts | WorkOverlayMarks.tsx:31 | "who ＋12 −3" |

**Language identity** (`graph-visuals.ts:45-110`; icon `FileNode.tsx:17-24`)

| Colour | Language | Where | Glyph/words |
|---|---|---|---|
| #94a3b8 slate | default | graph-visuals.ts:46 | "FILE" |
| #3b82f6 blue | TypeScript | :55 | TS |
| #eab308 yellow | JavaScript | :62 | JS |
| #22c55e green | Python | :69 | PY |
| #f97316 orange | Rust | :76 | RS |
| #06b6d4 cyan | Go | :83 | GO |
| #a855f7 purple (badge fuchsia) | CSS | :90-93 | CSS |
| #38bdf8 sky | JSON | :97 | JSON |
| #f472b6 pink | Markdown | :104 | MD |

**Symbol nodes** (`nodes/SymbolNode.tsx:14-22`)

| Colour | Symbol kind | Glyph/words |
|---|---|---|
| #4ade80 green | function | Braces icon + kind word |
| #60a5fa blue | class | Box |
| #93c5fd light blue | method | Braces |
| #c084fc purple | interface | Layers |
| #d8b4fe light purple | type | LetterText |
| #facc15 yellow | enum | List |
| #a1a1aa grey | variable | Hash |

**Cluster nodes**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| blue-500 base gradient, blue-100 handles | package/cluster (structural) | PackageNode.tsx:35, :46, :50, :53-54, :139 | Orbit icon, "N files" |
| ring-2 accent + blue glow | a file under the cluster is in the plan's footprint | PackageNode.tsx:35 | none |
| amber-500/10 | uncommitted local changes in cluster | PackageNode.tsx:117 | "N local" |
| emerald-500/10 | planned changes in cluster | PackageNode.tsx:122 | "N planned" |
| sky-500/10, sky-100 icon | directory cluster (structural) | DirectoryNode.tsx:23, :31-34 | Folder icon, "Directory cluster" |

**Edges** (`components/graph/edges/ImportEdge.tsx`)

| Colour | Meaning | Where | Dash | Glyph/words |
|---|---|---|---|---|
| rgba(96,165,250,0.7) blue-400 | regular import (and, by fallthrough, cross-system) | ImportEdge.tsx:68-74 | solid | label `{ symbols }` on hover |
| blue-400 0.9 + #bfdbfe flow dots | active (agent working) | :54-60, :132-145 | solid, animated | none |
| green 0.82 + #86efac flow dots | planned add | :17-23 | `8 8`, animated | emerald label |
| emerald-400 0.9 | added (planned and landed) | :31-37 | solid | emerald label (:156-157) |
| rose-500 0.95 | unexpected new edge (drift) | :38-46 | solid | rose label (:154-155) |
| red-400 0.82, opacity .78 | planned remove | :24-30, :123 | `5 8` | red label, struck through (:152-153) |
| red-400 0.9 | removed | :47-53 | `6 6` | red struck-through label |
| white 0.22 | symbol link (file → symbol) | :61-67 | `4 8` | none |
| (dead) violet / amber / cyan / slate | cross-system http / sql / subprocess / env | graph-builder.ts:1115-1123 | `4 3` (dead) | protocol label (dead) |
| opacity 0.18 | edge not touching selection | ImportEdge.tsx:123 | — | none |

**Canvas chrome that encodes state**

| Colour | Meaning | Where (MainCanvas.tsx) | Glyph/words |
|---|---|---|---|
| green-400 | Live mode button | :1277 | Radio icon "Live" |
| blue-400 | Baseline mode button | :1278 | Camera "Baseline" |
| **amber**-400 | Planned mode button | :1279 | Target "Planned" |
| violet-400 | Diff mode button | :1280 | GitCompare "Diff" |
| blue-500/14 / emerald-500/14 | baseline pinned / auto | :1337, :1344 | words |
| green-500/10 | auto-refresh on | :1478 | words |
| emerald / blue / amber / fuchsia chips | plan alignment: on track / planned / pending / unexpected | :2038-2041 | "N on track" etc. |
| emerald / amber / **neutral grey** chips | added / modified / removed vs baseline | :2048-2050 | words |
| sky / orange / emerald chips | staged / not staged / new to git | :2057-2059 | words |
| accent pill | replaying a past moment | :1192 | "As it was at hh:mm" |
| violet pill | playing forward | :1201 | "◇ Playing forward …" |
| sky banner | comparing two git points | GraphPair.tsx:79-90 | "Comparing A → B" |
| `warning` icon | set/clear breakpoint (context menu) | :1858-1860 | Pause/Play + words |
| rgba(59,130,246,0.6) | every minimap node | :1239 | none |
| rgba(59,130,246,0.06) | background dots | :1237 | none |
| blue pulse (graph-focus-pulse) | node focused by MCP `graph_focus` | globals.css:195-204; MainCanvas.tsx:1604 | none |

### 2. File tree / Explorer

**Explorer rows** (`components/layout/Sidebar.tsx`)

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| violet-300 | plan intends to touch file | Sidebar.tsx:29 | ◇, title "Planned" |
| **amber**-300 | plan task on file assigned or in progress | :30 | ◐ "In progress" |
| emerald-300 | change present and matches plan | :31 | ✓ "Aligned" |
| rose-300 | diverged (task done but change missing, or change unclaimed) | :32 | ▲ "Diverged" |
| fuchsia-300 | git-dirty, no plan task covers it | :33 | ◆ "Unplanned" |
| orange-300 / row orange-500/6 | unstaged change | :168, :530, :708 | "M" / "NM" |
| emerald-300 / row emerald-500/6 | untracked | :171, :527, :707 | "U" |
| **sky**-300 / row sky-500/6 | staged | :174, :529, :709 | **"A"** |
| red-300 / row red-500/6 | deleted | :177, :528, :706 | "D" |
| accent-muted bg + 2px accent left bar | selected row | :120 | none |
| blue-400 / yellow-400 / zinc-400 / purple-400 / green-400 / zinc-500 | language icon: TS / JS / **JSON (zinc)** / CSS / Python / other (md, go, rs all zinc) | :59-64 | file icons |
| accent | package node | :56 | Package icon |

**Changes panel** (`components/layout/SourceControlPanel.tsx`)

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| **amber**-300 | modified | SourceControlPanel.tsx:23 | "M", aria "modified" |
| emerald-300 | added | :24 | **"A"** |
| emerald-300 | untracked | :25 | "U" |
| red-300 | deleted | :26 | "D" |
| **sky**-300 | renamed | :27 | "R" |
| accent/80 | agents working in that group | :100 | agent names |

**Branches** (`components/layout/BranchesPanel.tsx`)

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| emerald-400 border | PR open | BranchesPanel.tsx:28 | "Open" |
| **violet**-400 | PR merged | :30 | "Merged" |
| red-400 | PR closed | :31 | "Closed" |
| amber-300 | commits ahead | :64 | ArrowUp + count |
| sky-300 | commits behind | :65 | ArrowDown + count |

### 3. Plan canvas / plan workspace

There are **no dependency arrows and no per-phase or per-section hues** in the plan workspace. Dependencies show only as amber text: "↑ waits on" (StackTab.tsx:332) and a Lock in "waiting" (NextUpStrip.tsx:102-115).

**Task status icons and badges**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| zinc-500 | pending / not started | plan/v2/PlanItemTree.tsx:19 | Circle icon |
| blue-400 | assigned | PlanItemTree.tsx:20 | User icon |
| accent (blue-500), spinning | in progress | PlanItemTree.tsx:21 | Loader2 |
| green-400 + glow | done | PlanItemTree.tsx:22 | CheckCircle2 |
| red-400 | blocked | PlanItemTree.tsx:23 | Ban |
| zinc-500 | skipped | PlanItemTree.tsx:24 | SkipForward |
| zinc / blue-400 / accent / green-400 / red-400 / zinc-500 (defined, **never rendered**) | task status on the item page | PlanItemCanvas.tsx:48-55 | label only in `<select>` |
| zinc / amber-400 / blue-400 / accent / green-400 / zinc-500 | plan status: draft / **review** / **approved** / in_progress / completed / archived | plan/StatusBadge.tsx:2-7 | status word |
| zinc / blue-400 / green-400 / red-400 / zinc-500 | task status pills | StatusBadge.tsx:8-12 | status word |
| green / accent / blue-400 / red-400 / zinc | task status in Proposed tab | plan/ProposedChanges.tsx:261-266 | word |
| green / zinc / red / accent / zinc | task outcome in completion summary | plan/v2/PlanCompletionSummary.tsx:229-235 | icons |
| green-500/70, accent/60, red-500/60, white/15 | progress bar and legend: done / in progress / blocked / pending | PlanItemCanvas.tsx:1044-1077 | dot + "N done" etc. |
| accent/60 | progress fill | PlanItemCanvas.tsx:364; PlanStatusChip.tsx:82 | % |
| accent with ping dot / blue-400 | running / assigned (live dashboard) | plan/v2/ExecutionDashboard.tsx:65-70, :76 | Zap + "running" / "assigned" |
| red-400 | blocked count | ExecutionDashboard.tsx:203 | "N blocked" |
| none (glyph only) | waiting on someone / in progress | PlanStatusChip.tsx:104-105 | ⏸ / ▶ |

**Plan-vs-code drift and targets**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| zinc | change planned | ProposedChanges.tsx:37 | Circle "Planned" |
| accent | change in progress | ProposedChanges.tsx:38 | Loader2 |
| green-400 | satisfied | ProposedChanges.tsx:39 | CheckCircle2 |
| **amber**-400 | missing | ProposedChanges.tsx:40 | AlertCircle "Missing" |
| **red**-400 | unexpected | ProposedChanges.tsx:41 | AlertCircle "Unexpected" |
| green / **amber** / red / **cyan** | operation add / modify / remove / move | ProposedChanges.tsx:252-255 | op icons |
| neutral | planned | plan/v2/PlanDiffPanel.tsx:302-307 | Eye "planned" |
| accent | in flight | PlanDiffPanel.tsx:308-313 | Loader2 "in flight" |
| emerald-300 | landed | PlanDiffPanel.tsx:314-319 | CheckCircle2 "landed" |
| **red**-300 | missing | PlanDiffPanel.tsx:320-325 | AlertTriangle "missing" |
| **amber**-300 | unexpected | PlanDiffPanel.tsx:326-331 | CircleSlash "unexpected" |
| emerald / **accent** / red / **amber** | operation add / modify / remove / move | PlanDiffPanel.tsx:282-287 | Plus / Pencil / Trash / Move |
| emerald / **accent** / red / **amber** | file-spec action create / modify / delete / move | plan/v2/ContextRail.tsx:424-429 | words |
| emerald / red | symbol target add / remove | ContextRail.tsx:631-632 | words |
| emerald (file/folder), cyan (symbol), amber (connection) | target pill kind | plan/v2/TargetsStrip.tsx:314-318 | icons |
| emerald / red / **accent** / **amber** | target verb add / remove / modify / move | TargetsStrip.tsx:320-323 | verb word |
| red / amber / blue | deviation severity error / warning / info | plan/v2/DriftIndicator.tsx:22-24 | AlertTriangle + type |
| amber panel and badge | unresolved drift | DriftIndicator.tsx:77-87, :170 | AlertTriangle + count |

**Readiness, criteria and grounding**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| amber-300 | required checks left before hand-off | plan/v2/PlanReadinessRing.tsx:241-242, :301 | CircleDashed "N to do before hand-off" |
| green-400 | ready to hand off | PlanReadinessRing.tsx:244, :299 | CheckCircle2 "Ready…" |
| subtle | criterion open | plan/v2/CriteriaBlock.tsx:23 | ○ "not yet" |
| amber-300 | criterion waiting for you | CriteriaBlock.tsx:24 | ◐ |
| green-400 | criterion met | CriteriaBlock.tsx:25 | ✓ |
| red-300 | criterion sent back | CriteriaBlock.tsx:26 | ↩ |
| amber-300 | criterion changed since approved | CriteriaBlock.tsx:27 | ⚠ |
| green / amber / red / amber / amber / red | grounding grades: grounded / waiting / sent back / changed / tests older / failing | plan/v2/GroundingLine.tsx:33-40 | grade glyph + words |

**Git, source and worktree**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| emerald | branch **merged** | lib/plan-git-state.ts:52 | chip words |
| violet | in review | plan-git-state.ts:53 | chip words |
| sky | pushed | plan-git-state.ts:54 | chip words |
| amber | building | plan-git-state.ts:55 | chip words |
| grey | closed | plan-git-state.ts:56 | chip words |
| teal | status source: plan | lib/plan-status.ts:55 | "from the plan" |
| sky | status source: git | plan-status.ts:56 | source word |
| violet | status source: review host | plan-status.ts:57-59 | source word |
| (via the above) | state source tag | plan/v2/ItemStateLine.tsx:30 | source word |
| amber-400/30 box | task state set two ways at once | ItemStateLine.tsx:47 | ⚠ + words |
| sky-500/10 | section kept to a worktree/branch | PlanItemTree.tsx:417, :220 | ⎇ branch |
| success / warning | worktree ready / not ready to merge | PlanItemTree.tsx:228; ItemRoutingPanel.tsx:923 | ✓ + words |
| violet-400/70 (tree), violet-500/10 (page) | item local-only, not shared | PlanItemTree.tsx:196, :446; PlanItemCanvas.tsx:408-418 | EyeOff / HardDrive "Local" |

**Item page header, comments and channel**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| amber-500/10 | approval gate on | PlanItemCanvas.tsx:387-397 | Lock "Gate on" |
| blue-300 | assignee | PlanItemCanvas.tsx:356 | 👤 name |
| red-500/[0.08] box | blocked reason | PlanItemCanvas.tsx:450 | "Blocked:" |
| red-400 | comment kind: blocker | PlanItemCanvas.tsx:59 | AlertTriangle "Blocker" |
| accent | comment kind: progress | :60 | Activity "Progress" |
| amber-400 | comment kind: question | :61 | HelpCircle "Question" |
| cyan-300 | comment author is an agent | PlanItemCanvas.tsx:1190 | name |
| cyan-300 | assignee (agent) | ExecutionDashboard.tsx:82 | name |
| amber band | open channel events on item | PlanItemCanvas.tsx:216-224 | "N open in Channel" |
| amber / violet / sky / cyan / emerald / fuchsia | channel event type: stuck / decision / context / handoff / steer / weigh-in | PlanItemCanvas.tsx:177-184; ChannelPanel.tsx:41-63 | icon + type word |
| amber / emerald | channel status open / resolved | ChannelPanel.tsx:68-69 | word |
| amber-500/90 badge | open channel count | PlanWorkspaceShellV2.tsx:249 | number |
| amber / accent | Next up: held (waits) / next ready | NextUpStrip.tsx:102-115, :133-135 | Lock / Zap + words |

### 4. Timeline (PlanPanel and its tabs)

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| subtle | event intent: read | layout/AgentTurns.tsx:47 | Eye |
| **accent** | event intent: write/edit | AgentTurns.tsx:48 | Pencil |
| `warning` | event intent: ask | AgentTurns.tsx:49 | HelpCircle |
| subtle | event intent: session | AgentTurns.tsx:50 | Plug |
| `danger` | event intent: error | AgentTurns.tsx:51 | AlertTriangle |
| `danger` | turn has an error | AgentTurns.tsx:115 | summary text |
| ring accent/40 | turn focused from a lane | AgentTurns.tsx:102 | none |
| `danger` | lane mark: breach | layout/TimelineLanes.tsx:41 | ⊘ "breach" |
| `warning` (dashed span) / muted (solid) | lane mark: paused at breakpoint, waiting / answered | TimelineLanes.tsx:42, :130 | ⏸ |
| danger / warning / subtle | lane mark: signal high / medium / low | TimelineLanes.tsx:43 | ⚠ "high signal" |
| `danger` | lane mark: checks failed, or turn failed | TimelineLanes.tsx:44 | ✗ / ● "turn (failed)" |
| `success` | lane mark: checks passed | TimelineLanes.tsx:45 | ✓ |
| foreground | lane mark: commit / merge | TimelineLanes.tsx:46 | ◆ / ⧫ |
| **accent** | lane mark: spec edit | TimelineLanes.tsx:47 | ✎ |
| muted | lane mark: turn | TimelineLanes.tsx:47 | ● |
| sky-300/80 | plan sections on a lane (workstream) | TimelineLanes.tsx:113 | section names |
| `success` dot | a Claude Code session is running | layout/PlanPanel.tsx:131-134 | "Claude Code running" |
| accent border | Timeline filtered to a stack plan | PlanPanel.tsx:162 | "Showing X's work" |
| green-400 / **amber**-400 | Changes tab: write / edit | PlanPanel.tsx:208-212 | WRITE / EDIT |
| accent | replay mode | layout/ReplayBar.tsx:66, :88-97 | History icon + words |
| violet | play-forward mode, planned overlaps | layout/PlayForwardBar.tsx:57-92, :138 | ◇ + words |
| green / accent / accent/60 / red / white/20 | Stack tab task status dots: done / in progress / assigned / blocked / pending | layout/StackTab.tsx:42-49 | dot only (status in hover title) |
| amber-300 | Stack: plan needs you | StackTab.tsx:195 | "N needs you" |
| red-300 / amber-300 | Stack: plan overlap, high / other | StackTab.tsx:231 | overlap words |
| violet dashed | Stack: planned overlap | StackTab.tsx:249-254 | words, "serious" |
| sky-300/80 | Stack: task's worktree | StackTab.tsx:304 | ⎇ branch |
| amber-300/90 | Stack: unmet dependency | StackTab.tsx:332 | "↑ waits on …" |
| green / red / amber | Review queue: ready / held / waiting for sign-off | layout/ReviewTab.tsx:21-23 | words |
| amber-400 for **every** letter | changed files in a review | ReviewTab.tsx:185 | A/M/D letter |

### 5. Awareness tab (overlaps, signals, workstreams, footprints)

**Signals**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| `warning` / subtle | something needs you / nothing does | layout/AwarenessTab.tsx:123 | Radar icon + headline |
| `warning` | new since last visit | AwarenessTab.tsx:127 | "N new since you last looked" |
| danger / warning dot | digest line severity | AwarenessTab.tsx:148 | aria severity + "Waiting on you: …" |
| danger/15, warning-muted, neutral | severity pill high / medium / low | AwarenessTab.tsx:209-213 | HIGH/MEDIUM/LOW word |
| danger/70, warning/60, neutral | severity left edge | AwarenessTab.tsx:215-219 | none (pill carries the word) |
| red-300/70, struck through | contract: signature before / removed export | AwarenessTab.tsx:247, :251 | code text |
| emerald-300/90 | contract: signature after | AwarenessTab.tsx:248 | code text |
| sky-300/90 | link to change an architecture rule | AwarenessTab.tsx:315 | "Change the rule in Settings" |
| sky-400/40 left bar | person's message to agents | AwarenessTab.tsx:332 | quoted text |
| accent/30 left bar | agent's own note | AwarenessTab.tsx:425 | quoted text |
| sky-400/30 chips | jump to file | AwarenessTab.tsx:449 | "Show on graph" / "Show lines" |
| sky-300/90 | plan sections on each side | AwarenessTab.tsx:531 | section names |
| `warning` | signal reopened | AwarenessTab.tsx:558 | "Back: it changed since …" |
| ring-2 accent | signal pointed at from elsewhere | lib/use-highlight.ts:18 | none |

**Breakpoints and notices**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| danger/70 edge + danger pill | breach | layout/Breakpoints.tsx:102, :109 | OctagonAlert "Breach" |
| warning/70 edge + warning pill | paused/held at breakpoint | Breakpoints.tsx:102, :110 | Pause "Paused"/"Held" |
| violet-400/70 edge + violet pill | agent proposes a spec change | Breakpoints.tsx:245-251 | PenLine "Spec change", ✎ |
| amber-300 / emerald-300 | proposal impact: changes / doesn't | Breakpoints.tsx:281 | impact words |
| amber-300 | page changed since proposal | Breakpoints.tsx:288 | words |
| `warning` | breakpoint set | Breakpoints.tsx:386 | Pause + target |
| violet panel | planned overlap notice | layout/PlannedOverlapNotices.tsx:48-62 | ◇ title, FastForward |
| sky panel | recurring run due | layout/RecurringDue.tsx:49-61 | Repeat + words |

**Workstream strip and agents**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| danger/70 border + red glow | workstream chip with a high signal | layout/WorkstreamStrip.tsx:184, :219 | severity in title |
| warning/50 border | workstream chip, medium signal, or shared folder | WorkstreamStrip.tsx:185, :219 | ⚠ AlertTriangle (shared) :203 |
| `success` dot / grey dot | agent working there / no agent | WorkstreamStrip.tsx:190, :222 | none (title "no agent working") |
| **amber**-300 | agent identity: Claude Code | layout/ConnectedAgents.tsx:35 (used WorkstreamStrip.tsx:199, :227) | Sparkles icon |
| **emerald**-300 | agent identity: Codex | ConnectedAgents.tsx:36 | Bot |
| cyan-300 | agent identity: Cursor | ConnectedAgents.tsx:37 | Bot |
| purple-300 | agent identity: Aider | ConnectedAgents.tsx:38 | Bot |
| success / warning / danger / **accent** | workstream changed-file letters A / M / D / R | WorkstreamStrip.tsx:417 | letter |
| `warning` | signature change callers feel | WorkstreamStrip.tsx:454 | words |
| danger / warning / neutral | overlap severity pill | WorkstreamStrip.tsx:472-476 | HIGH/MEDIUM/LOW |
| `success` / `warning` | connected agents in scope / out of scope | ConnectedAgents.tsx:116-117, :143-154 | Cpu, CheckCircle2 / AlertTriangle + words |

**App-wide**

| Colour | Meaning | Where | Glyph/words |
|---|---|---|---|
| indigo rgba(124,110,255) inset glow | an MCP agent just acted | layout/AgentPulse.tsx:47-49 | none |

---

## (b) Collisions

### Same hue, different meanings

**1. Amber means about twenty things.**
- **Modified:** graph-visuals.ts:115; FileNode.tsx:68; SourceControlPanel.tsx:23; MainCanvas.tsx:2049; WorkstreamStrip.tsx:417 (warning); ProposedChanges.tsx:253; lib/plan-overlay.ts:87.
- **Warning / attention:** BreakpointBadge.tsx:13; GroundingMark.tsx:10 (stale tests); AwarenessTab.tsx:211 (medium severity); Breakpoints.tsx:110 (paused).
- **In progress:** the Explorer's ◐ (Sidebar.tsx:30).
- **Planned:** the toolbar's Planned mode (MainCanvas.tsx:1279).
- **Pending:** MainCanvas.tsx:2040.
- **Inbound import:** FileNode.tsx:142.
- **Local changes:** PackageNode.tsx:117.
- **Plan in review:** StatusBadge.tsx:3.
- **Building:** plan-git-state.ts:55.
- **Missing:** ProposedChanges.tsx:40.
- **Unexpected:** PlanDiffPanel.tsx:326-331.
- **Move:** PlanDiffPanel.tsx:286; TargetsStrip.tsx:323; ContextRail.tsx:428.
- **Stuck / open channel event:** ChannelPanel.tsx:42, :68.
- **Question comment:** PlanItemCanvas.tsx:61.
- **Approval gate:** PlanItemCanvas.tsx:389.
- **Held task:** NextUpStrip.tsx:102.
- **Criterion waiting / stale:** CriteriaBlock.tsx:24, :27.
- **Commits ahead:** BranchesPanel.tsx:64.
- **EDIT event:** PlanPanel.tsx:211.
- **Ask intent:** AgentTurns.tsx:49.
- **Claude Code's identity:** ConnectedAgents.tsx:35.
- **Every review letter:** ReviewTab.tsx:185.
- **SQL edge:** graph-builder.ts:1118 (dead code).

**2. Blue (accent and blue-400) means about fifteen things.**
- **In progress:** PlanItemTree.tsx:21; StatusBadge.tsx:5; StackTab.tsx:45; graph-visuals.ts:119.
- **Assigned:** PlanItemTree.tsx:20; StatusBadge.tsx:9; ExecutionDashboard.tsx:70; StackTab.tsx:46.
- **Selection:** Sidebar.tsx:120; PlanItemTree.tsx:370; use-highlight.ts:18.
- **Plan-footprint highlight on the graph:** graph-visuals.ts:225; FileNode.tsx:76; PackageNode.tsx:35.
- **Regular import edge and active edge:** ImportEdge.tsx:55, :70.
- **TypeScript:** graph-visuals.ts:56; Sidebar.tsx:59.
- **Class symbol:** SymbolNode.tsx:16.
- **Baseline mode:** FileNode.tsx:73; MainCanvas.tsx:1278.
- **Every cluster:** PackageNode.tsx:35.
- **Every minimap node:** MainCanvas.tsx:1239.
- **Outbound import:** FileNode.tsx:141.
- **Modify operation:** PlanDiffPanel.tsx:284; ContextRail.tsx:426; TargetsStrip.tsx:322.
- **Write intent / spec-edit mark:** AgentTurns.tsx:48; TimelineLanes.tsx:47.
- **"planned" chip:** MainCanvas.tsx:2039.
- **Info severity:** DriftIndicator.tsx:24.
- **Renamed:** WorkstreamStrip.tsx:417.
- **Plan approved:** StatusBadge.tsx:4.

**3. Violet/purple means about fourteen things.**
- **Affected (blast radius):** graph-visuals.ts:121.
- **Planned overlap:** PlannedOverlapMark.tsx:14; StackTab.tsx:249; PlayForwardBar.tsx:57.
- **Planned file ◇:** Sidebar.tsx:29.
- **Planned line:** lib/line-verdict.ts:114.
- **In review:** plan-git-state.ts:53.
- **Review-host source:** plan-status.ts:57.
- **Local-only item:** PlanItemTree.tsx:196, :446; PlanItemCanvas.tsx:410.
- **Spec-change proposal:** Breakpoints.tsx:245.
- **Need-decision event:** ChannelPanel.tsx:46.
- **Merged PR:** BranchesPanel.tsx:30.
- **CSS file:** graph-visuals.ts:90.
- **Interface / type symbol:** SymbolNode.tsx:18-19.
- **Diff mode button:** MainCanvas.tsx:1280.
- **Aider's identity:** ConnectedAgents.tsx:38.
- **HTTP edge:** graph-builder.ts:1117 (dead code).

**4. Fuchsia means drift and also a view mode.**
- **Unexpected live change** (graph-visuals.ts:122; FileNode.tsx:72), the "unexpected" chip (MainCanvas.tsx:2041), the unplanned ◆ (Sidebar.tsx:33) and the drifted line (line-verdict.ts:107) all mean drift.
- The **Diff view mode** is drawn in the same fuchsia (FileNode.tsx:75, :181; PackageNode.tsx:35, :77), as are the weigh-in event (ChannelPanel.tsx:62) and the CSS badge (graph-visuals.ts:93). On a Diff-mode card, a fuchsia tint can mean either.

**5. Rose means three different things.**
- **Collision zone** on the graph (WorkOverlayMarks.tsx:15, :21).
- **Unexpected edge** (ImportEdge.tsx:42, :155).
- **Diverged file** (Sidebar.tsx:32) and **remove intent** (plan-overlay.ts:84).

**6. Green/emerald means about a dozen things.**
- **Added:** graph-visuals.ts:113.
- **Untracked:** Sidebar.tsx:171; FileNode.tsx:247.
- **Planned add / ghost NEW:** FileNode.tsx:64, :231.
- **"N planned" on clusters:** PackageNode.tsx:122.
- **Planned mode tint on cards:** FileNode.tsx:74.
- **Done:** PlanItemTree.tsx:22.
- **Satisfied / landed:** ProposedChanges.tsx:39; PlanDiffPanel.tsx:314.
- **Passing tests:** GroundingMark.tsx:11.
- **Merged:** plan-git-state.ts:52.
- **Open PR:** BranchesPanel.tsx:28.
- **Live mode:** MainCanvas.tsx:1277.
- **Agent working:** WorkstreamStrip.tsx:190.
- **Codex's identity:** ConnectedAgents.tsx:36.
- **Function symbol and Python:** SymbolNode.tsx:15; graph-visuals.ts:69.

**7. Red means removal and also stopped/broken.**
- **Deleted/removed:** Sidebar.tsx:177; FileNode.tsx:69; ImportEdge.tsx:47.
- **Blocked:** PlanItemTree.tsx:23.
- **Failing:** GroundingMark.tsx:9.
- **High severity:** AwarenessTab.tsx:210.
- **Breach:** Breakpoints.tsx:109.
- **Error:** AgentTurns.tsx:51.
- **Missing:** PlanDiffPanel.tsx:320.
- **Unexpected:** ProposedChanges.tsx:41.
- **Closed PR:** BranchesPanel.tsx:31.
- **Manifest conflict:** ManifestConflictBar.tsx:158.
- **Java:** CodebaseOrientation.tsx:45.

**8. Sky means git-index state and also workstream/branch identity.**
- **Git-index state:** staged (Sidebar.tsx:174, :529; FileNode.tsx:248; MainCanvas.tsx:2057), renamed (SourceControlPanel.tsx:27), behind (BranchesPanel.tsx:65), pushed (plan-git-state.ts:54), git source (plan-status.ts:56).
- **Workstream/branch identity:** ⎇ (PlanItemTree.tsx:417; StackTab.tsx:304), lane sections (TimelineLanes.tsx:113; AwarenessTab.tsx:531), other workstreams' line counts (WorkOverlayMarks.tsx:31).
- Also sky: directory clusters (DirectoryNode.tsx:23), JSON (graph-visuals.ts:97), the need-context event, recurring runs (RecurringDue.tsx:49), messages to agents (AwarenessTab.tsx:332), file chips (:449), the compare banner (GraphPair.tsx:79).

**9. Cyan has no single meaning.**
- Go (graph-visuals.ts:83), Cursor (ConnectedAgents.tsx:37), an agent as author/assignee (PlanItemCanvas.tsx:1190; ExecutionDashboard.tsx:82), symbol targets (TargetsStrip.tsx:317), move (ProposedChanges.tsx:255), handoff (ChannelPanel.tsx:54), criterion origin (CriteriaBlock.tsx:225), subprocess (dead code).

**10. Orange means unstaged and also planned modify.**
- Unstaged: Sidebar.tsx:168, :708; FileNode.tsx:249; MainCanvas.tsx:2058.
- Planned modify: FileNode.tsx:70.
- Rust: graph-visuals.ts:76.

### Same meaning, different hues

**11. "Planned / not yet" is drawn in five hues.**
- Emerald on the graph (planned_add, Planned mode, "N planned": FileNode.tsx:64, :74; PackageNode.tsx:122).
- Amber on the Planned toolbar button (MainCanvas.tsx:1279).
- Blue on the "planned" chip (MainCanvas.tsx:2039).
- Violet ◇ in the Explorer and code view (Sidebar.tsx:29; line-verdict.ts:114).
- Neutral in the Proposed tab and plan diff (ProposedChanges.tsx:37; PlanDiffPanel.tsx:302).

**12. "Unexpected / unplanned / drift" is drawn in four hues.**
- Fuchsia: node, chip, ◆ (graph-visuals.ts:122; MainCanvas.tsx:2041; Sidebar.tsx:33).
- Rose: edge, ▲ (ImportEdge.tsx:42; Sidebar.tsx:32).
- Red: ProposedChanges.tsx:41.
- Amber: PlanDiffPanel.tsx:326; drift panel and badge (DriftIndicator.tsx:77, :170).

**13. "Missing" (planned but absent) is drawn in three hues.**
- Amber (ProposedChanges.tsx:40), red (PlanDiffPanel.tsx:320), rose ▲ (Sidebar.tsx:32 via :42).
- The two plan panels also swap colours: Proposed shows missing amber / unexpected red, and the plan diff shows missing red / unexpected amber.

**14. "Modified" is drawn in three hues.**
- Amber: graph, Changes panel, DiffSummary, ProposedChanges, plan-overlay.
- Orange: Explorer "M", node unstaged chip, "not staged" chip.
- Blue/accent: the modify operation in PlanDiffPanel.tsx:284, ContextRail.tsx:426, TargetsStrip.tsx:322.
- Even on one card, planned-modify is an orange fill (FileNode.tsx:70) with an amber chip (FileNode.tsx:245).

**15. The same git letter gets different hues (and letters disagree).**
- **"A":** sky meaning *staged* in the Explorer (Sidebar.tsx:174, :709); emerald meaning *added* in the Changes panel (SourceControlPanel.tsx:24); green in the strip (WorkstreamStrip.tsx:417).
- **"M":** orange (Explorer) vs amber (Changes panel, strip).
- **"R":** sky (SourceControlPanel.tsx:27) vs accent (WorkstreamStrip.tsx:417).
- ReviewTab draws every letter amber (ReviewTab.tsx:185).

**16. "Removed" is grey in one place.** It is red everywhere except the DiffSummary "removed" chip (MainCanvas.tsx:2050), while the nodes it counts are red.

**17. "Task in progress" is amber in the Explorer.** It is blue/accent on the tree, stack, canvas and graph (PlanItemTree.tsx:21; StackTab.tsx:45; graph-visuals.ts:119) but amber ◐ in the Explorer (Sidebar.tsx:30).

**18. "Assigned" and "in progress" are near-identical.** They use blue-400 and blue-500 (PlanItemTree.tsx:20-21; StatusBadge.tsx:5, :9; StackTab.tsx:45-46 accent vs accent/60). The tree tells them apart only by icon; the Stack tab dots not at all.

**19. "Merged" is two hues.** Emerald (plan-git-state.ts:52) vs violet (BranchesPanel.tsx:30).

**20. "Overlap between workstreams" changes hue by surface.**
- Rose dashed ⚠ on the graph (WorkOverlayMarks.tsx:15).
- Red or amber by severity in Awareness (AwarenessTab.tsx:209-219), the strip (WorkstreamStrip.tsx:184-185) and Stack (StackTab.tsx:231).
- Planned overlaps are consistently violet dashed ◇.

**21. "An agent is working now" is three hues.**
- Green dot (WorkstreamStrip.tsx:190; ConnectedAgents.tsx:117; PlanPanel.tsx:134).
- Blue pulse and flow dots on the graph (graph-visuals.ts:119-120; ImportEdge.tsx:54-60).
- Indigo glow over the app (AgentPulse.tsx:47-49).

**22. Agent identity tints reuse state hues.** Claude Code is amber (= warning/modified), Codex is emerald (= added/done), Cursor cyan, Aider purple (= planned/violet) (ConnectedAgents.tsx:35-38). Workstreams have no identity hue of their own; sky is used for branch names.

**23. Selection and plan footprint are the same accent blue.**
- In glass mode both use accent (FileNode.tsx:76; Sidebar.tsx:120; PlanItemTree.tsx:370).
- In glass mode a focused node glows in its *status* colour, not a selection colour (FileNode.tsx:100-107).
- Only performance mode separates selection (white, graph-visuals.ts:228) from plan highlight (accent, :225).

**24. View mode and status tint the same card.** Baseline blue, Planned emerald, Diff fuchsia (FileNode.tsx:73-75) are the same hues as in-progress, added and unexpected status fills on the same background.

**25. Language colours differ between Explorer and graph.**
- JSON: zinc in the tree (Sidebar.tsx:61), sky on the graph (graph-visuals.ts:97).
- Markdown, Go, Rust: zinc in the tree; pink, cyan, orange on the graph.
- CSS: purple-400 vs #a855f7 icon with a fuchsia badge.
- CodebaseOrientation.tsx:37-46 is a third map, and it makes Java red.

**26. Edge colours: cross-system and direction are not shown.** Cross-system edges render as plain import edges (dead code, see the note at the top). The focus view's inbound-amber / outbound-blue edges are also overridden, so direction survives only as the node badges (FileNode.tsx:139-145).

### Glyph collisions

**27. Similar-looking or reused glyphs:**
- **⊘ breach** (TimelineLanes.tsx:32) vs the **Ban** icon for blocked (PlanItemTree.tsx:23) vs **CircleSlash** for unexpected (PlanDiffPanel.tsx:327).
- **◆** means unplanned (Sidebar.tsx:33; line-verdict.ts:106) and also a commit mark (TimelineLanes.tsx:31).
- **⏸** means paused at a breakpoint (BreakpointBadge.tsx:15; TimelineLanes.tsx:32) and also "waiting on someone" (PlanStatusChip.tsx:104).
- **⚠** is drawn rose (collision), amber (stale tests, criterion changed, at-once) or warning/danger (signals).

---

## (c) Existing legends

1. **Explorer plan-state legend.** `components/layout/Sidebar.tsx:386-395`, driven by `PLAN_META` at `:28-34`. Glyph, colour and word for Planned / In progress / Aligned / Diverged / Unplanned, shown only for the states present. Git letters M/U/A/D have **no** legend.
2. **Graph Overlays menu.** `components/graph/OverlaysMenu.tsx:39-56`, text from `lib/graph-overlays.ts:17-23`. Words only, no swatches. Line 22 explains the test glyphs "✓ passing · ✗ failing · ⚠ tests older than the code · ○ no tests".
3. **Graph DiffSummary (de facto legend).** `components/layout/MainCanvas.tsx:2010-2061`. Coloured chips with counts and words: on track / planned / pending / unexpected; added / modified / removed; staged / not staged / new to git. It does not cover affected, active, in-progress, mode tints or edges.
4. **Trellis mode selector.** `MainCanvas.tsx:1276-1281`: icon, word and colour per view mode.
5. **Plan progress legend.** `components/plan/v2/PlanItemCanvas.tsx:1055-1077`: done / in progress / blocked / pending dots with counts.
6. **Codebase language legend.** `components/plan/v2/CodebaseOrientation.tsx:166-175` (`LANG_COLORS` `:37-46`). A separate language map from the graph's and the Explorer's.
7. **Plan status view.** `components/plan/v2/PlanStatusChip.tsx:104-111`: ⏸ / ▶ sections and a sentence on sources. Source tag colours (teal / sky / violet) come from `lib/plan-status.ts:54-60` and are not explained in colour.
8. **Readiness checklist.** `components/plan/v2/PlanReadinessRing.tsx:265-290`: glyph and words per check, required vs suggested.
9. **Channel event types.** `components/plan/v2/ChannelPanel.tsx:41-63`: icon, label and helper sentence per type.
10. **Timeline lanes.** No visible legend; `GLYPH` / `NAME` (`components/layout/TimelineLanes.tsx:30-38`) appear only on hover. The doc comment at `lib/timeline-lanes.ts:6-13` describes the glyphs.
11. **Code-view line verdicts.** `lib/line-verdict.ts:97-119`: label per verdict, tooltip only (`verdictTooltip`). The comment notes its glyphs match the Sidebar on purpose.
12. **Guide text.** `components/guide/guide-content.ts:218-219`: "green for added, amber for modified" (gutter).
13. **Criteria and grounding words.** `components/plan/v2/CriteriaBlock.tsx:22-28`; `components/plan/v2/GroundingLine.tsx:42-60`: inline glyph, word and colour.
14. **Not found:** no legend for graph change-status colours, edge colours/dashes, language colours, symbol-kind colours, the minimap, agent identity tints, or git letters.

---

## (d) Draft unified vocabulary

**Principles:**
- One hue family per meaning family.
- Glyph and word are always present, so colour is never the only carrier.
- Dash means "not happened yet" (planned).
- Interactive accent and selection are separated from state.

**Proposed tokens** (add to `@theme` in `styles/globals.css`):
- `--state-active` #3b82f6 (blue-500)
- `--state-done` #22c55e (green-500)
- `--state-blocked` #ef4444 (red-500)
- `--state-attention` #f59e0b (amber-500)
- `--state-planned` #a78bfa (violet-400)
- `--state-drift` #e879f9 (fuchsia-400)
- `--state-idle` #71717a (zinc-500)
- `--git-added` #34d399 (emerald-400)
- `--git-modified` #fb923c (orange-400)
- `--git-deleted` #f87171 (red-400)
- `--git-index` #38bdf8 (sky-400)
- `--edge-import` #94a3b8 (slate-400)
- `--edge-system` #22d3ee (cyan-400)
- `--select` white/85
- `--identity-1…5`: indigo-300, pink-300, lime-300, teal-300, yellow-200, reserved for identity only

| State | Colour token | Glyph | Dash (edges/outlines) | Word |
|---|---|---|---|---|
| **Task: not started** | `--state-idle` | ○ | — | Not started |
| **Task: assigned** | `--state-idle`, brighter (foreground-muted), *not blue* | ◔ + person name | — | Assigned to {name} |
| **Task: in progress** | `--state-active` (blue) | ◐ (also replaces the Explorer's amber ◐) | double outline / pulse | In progress |
| **Task: blocked** | `--state-blocked` (red) | ■ (stop) | — | Blocked: {reason} |
| **Task: waiting on a dependency** | `--state-attention` (amber) | ↑ | — | Waits on {task} |
| **Task: done** | `--state-done` (green) | ✓ | — | Done |
| **Task: skipped** | `--state-idle`, strikethrough | » | — | Skipped |
| **Plan intent: planned (file/edge/line)** | `--state-planned` (violet) | ◇ | dashed `8 8` / dashed outline | Planned |
| **Plan intent: landed / aligned** | `--state-done` | ✓ | solid | Landed |
| **Plan intent: unexpected / unplanned** | `--state-drift` (fuchsia; replaces rose, red and amber uses) | ◆ (stop using ◆ for commits; use • or ⬤ for commits) | solid | Unplanned |
| **Plan intent: missing (planned, absent)** | `--state-drift` | ▲ | dashed | Missing |
| **Edge: import** | `--edge-import` (slate; frees blue for "active") | — | solid, width by symbol count | imports {symbols} |
| **Edge: cross-system** | `--edge-system` (cyan), protocol in words not hue | ⇢ | dashed `4 3` (must be wired in ImportEdge) | http / sql / subprocess / env |
| **Edge: symbol link** | white/0.25 | — | dotted `2 4` | defines |
| **Edge: active (agent editing now)** | `--state-active` + flow dots | — | solid, animated | — |
| **Edge: planned add / remove** | `--state-planned` / `--git-deleted` | — | `8 8` / `6 6`, label struck through | planned / removing |
| **Git: added** | `--git-added` (emerald) | A / ＋ | — | added |
| **Git: untracked** | `--git-added`, outlined letter | U | dashed outline on node | new to git |
| **Git: modified** | `--git-modified` (orange; amber is freed for attention) | M / ~ | — | modified |
| **Git: renamed** | `--git-modified` | R | — | renamed from {old} |
| **Git: deleted** | `--git-deleted` (red-400), strikethrough | D / − | — | deleted |
| **Git: staged** | `--git-index` (sky) as a modifier dot beside the change letter (never replaces it, so "A" always means added) | ● (index) | — | staged |
| **Breach** | `--state-blocked` | ⊘ (reserved; blocked uses ■) | — | Breach |
| **Drift (scope / rule)** | `--state-drift` | ◆ | — | Drift |
| **Warning / needs attention / medium severity** | `--state-attention` | ⚠ | — | Needs you |
| **Paused at breakpoint** | `--state-attention` | ⏸ (reserved for breakpoints only) | dashed span while waiting | Paused |
| **High severity / failing** | `--state-blocked` | ⚠ / ✗ | — | High / Failing |
| **Tests passing / stale / none** | `--state-done` / `--state-attention` / `--state-idle` | ✓ / ⚠ / ○ | — | passing / tests older / no tests |
| **Open collision (workstream overlap)** | severity hue (`--state-attention` or `--state-blocked`; no more rose) | ⚠ | 2px dashed ring | Overlap with {workstream} |
| **Planned overlap** | `--state-planned` | ◇ | 2px dashed ring | Planned overlap |
| **Affected (blast radius)** | slate-300 (neutral; leaves violet) | ≈ | dotted outline | Affected |
| **Agent / workstream identity** | `--identity-n` (hashed per workstream, used only as a 3px left stripe or avatar); agent-type icons go neutral | branch ⎇ / agent icon + name | — | {branch} · {agent} |
| **Agent working now** | `--state-active` (replaces the green dot and indigo pulse) | ● pulsing | — | {agent} working |
| **Selection / focus** | `--select` (white ring 2px, offset 2) on graph, tree and lists; accent stays for buttons and links only | — | solid ring | (aria-selected) |
| **Plan footprint highlight** | `--state-planned` outline (not accent) | ◇ | dashed outline | In plan |
| **View mode (Baseline / Planned / Diff)** | neutral chip plus the mode word; no card tint, so mode never paints over status | 📷 / ◇ / ⇄ | — | baseline / planned / diff |
| **Merged / in review / pushed / building** | `--state-done` / `--state-planned` / `--git-index` / `--state-attention` (BranchesPanel merged must change from violet to green) | ⧫ / ◎ / ↑ / ⟳ | — | merged / in review / pushed / building |

**Residual shared hues (accepted, with mitigations):**
- **Green:** done and git-added share it. Done is green-500 with ✓ on task surfaces; added is emerald-400 with A/＋ on file and edge surfaces. Both mean "good/new".
- **Red:** blocked/failing and git-deleted share it. Deleted always carries D/− and strikethrough.
- **Orange vs amber:** modified (orange-400) sits close to attention (amber-500). The glyph (M/~ vs ⚠/⏸) carries the difference.
- **Unify the language maps:** use one map for the Explorer (Sidebar.tsx:55-66), graph (graph-visuals.ts:53-110) and CodebaseOrientation.tsx:37-46. Use it only for icons, never borders or fills, so language never competes with state.

**Fixes needed regardless of palette:**
- Make ImportEdge honour `kind: 'cross_system'` and protocol.
- Give the minimap a `nodeColor` by status.
- Render the `STATUS_META` tints on the item page (PlanItemCanvas.tsx:48-55, :344-353).
- Swap the inverted missing/unexpected colours in ProposedChanges.tsx:40-41 vs PlanDiffPanel.tsx:320-331.
- Align the "A" letter between Sidebar.tsx:709 and SourceControlPanel.tsx:24.
- Colour the DiffSummary "removed" chip (MainCanvas.tsx:2050).
- Add a graph legend for status, edges and overlays, reusing the Sidebar legend pattern at Sidebar.tsx:386-395.
