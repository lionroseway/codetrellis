# CodeTrellis — Gap Analysis

Last updated: 2026-04-22 (revision 2)
Overall completion: ~55% against core vision (docs/CORE-VISION.md)

---

## Status Summary

| Domain | Complete | Quality | Key Gap |
|--------|----------|---------|---------|
| Data Model & Types | 95% | High | Complete |
| Database Persistence | 100% | Good | sql.js with file export, survives restarts |
| MCP Server (19 tools) | 95% | High | All spec tools implemented |
| Claude Code Watcher | 100% | High | Fully functional |
| AST Parsing (7 langs) | 100% | Good | TS, JS, Python, Rust, PHP, Java |
| Graph Visualization | 40% | Low | **Major gap — see "Visual Experience" below** |
| Plan CRUD + Comments | 85% | Good | Missing: version viewer, task-level comments |
| Real-time Activity | 40% | Medium | Toast system + node overlays built, not fully wired |
| Deviation Detection | 70% | Medium | Service built, MCP tools added, needs more detection types |
| Conflict Detection | 70% | Medium | File-level conflict on claim_task, broadcasts warnings |
| Multi-Agent Dashboard | 0% | - | Not started |
| Notifications (Toast) | 80% | Good | Built and wired to key events |
| Visual Plan Builder | 0% | - | Not started |

---

## What Was Fixed Since Last Analysis

| Item | Status | What was done |
|------|--------|--------------|
| Real-time activity visualization | DONE | FileNode has checkmark overlay, task number badge, enhanced pulse animation, ghost node styling |
| Toast notification system | DONE | ToastContainer with slide-in animation, wired to plan/task/deviation/conflict/session events |
| Projection visual polish | DONE | Ghost nodes with dashed green borders + glow, planned_modify with orange ring, planned_remove with strikethrough, distinct badges |
| Deviation detection service | DONE | deviation-service.ts detects missing files, missing imports, unexpected changes. MCP tools: get_deviations, reconcile, detect_deviations. REST endpoints. Integrated with file watcher. |
| Conflict detection | DONE | claimTask checks file overlap with other in-progress tasks, returns warnings, broadcasts conflict-detected event |

---

## THE CRITICAL GAP: Visual Experience

**This is the #1 blocker.** The graph looks like a developer tool wireframe, not a "Palantir/flight radar" experience.

### What we have now
- Flat rectangular nodes connected by thin straight lines
- All nodes are the same size regardless of importance
- No content preview inside nodes (just filename)
- Layout groups by folder structure, not by relationship/dependency
- No depth of field (everything equally prominent)
- No visual hierarchy (the most-imported file looks the same as a leaf file)
- Plan projection adds badges but doesn't fundamentally change the visual

### What it should look like (reference: ChatGPT concept image)
- **Central focus node** — clicking a file makes it large and centered, everything else orbits showing relationships
- **Rich connection lines** — curved, glowing, showing direction and what's imported (function names on edges)
- **File content visible** — selected/central node shows exports, functions, classes inside it
- **Grouped by relationship** — files that import each other cluster together, not by folder
- **Depth of field** — background nodes dimmed/blurred, focused area sharp and bright
- **Space/galaxy aesthetic** — nodes float in dark space with subtle particle/star background
- **Agent activity overlay** — pulsing, glowing indicators when agents are working
- **Plan visualization** — new connections drawn as glowing dashed lines with direction arrows

### What needs to change

**Graph nodes need to be richer:**
- Variable node size based on importance (number of imports/exports)
- Selected node expands to show internal symbols (functions, classes)
- File icon + language badge + connection count visible at all zoom levels
- Hover shows tooltip with full path + symbol list

**Graph edges need to be informative:**
- Curved lines (bezier) not straight
- Animated flow dots showing import direction
- Edge labels showing what's imported (on hover or always for selected node)
- Different styles: solid for existing imports, dashed for planned, red for removed

**Layout needs to be relationship-based:**
- Force-directed clustering by import relationships (already partially there)
- Files that heavily import each other should be close together
- Option to group by: dependency clusters, packages, file type
- Semantic zoom: zoomed out = package clusters, zoom in = files appear, zoom more = symbols

**Visual atmosphere:**
- Subtle particle/dot background that gives depth
- Glow effects on active/selected nodes
- Radial gradient lighting — center brighter, edges darker
- Smooth transitions when expanding/collapsing nodes

---

## Remaining Gaps by Priority

### Priority 1: Graph Visual Overhaul (THE main gap)
- Rich node rendering with variable size, content preview, connection count
- Curved glowing edges with direction indicators
- Relationship-based clustering
- Depth of field / focus mode
- Semantic zoom
**Effort:** High (5-8 days)
**Impact:** Transforms the product from "developer tool" to "visual platform"

### Priority 2: Plan Projection on Graph
- Show planned new connections as glowing dashed curves between nodes
- Plan task nodes on the graph with step numbers
- Click a task in the plan panel → graph zooms to affected area
- Before/after toggle showing current state vs projected state
**Effort:** Medium (2-3 days)
**Impact:** Core value proposition — "see what will change"

### Priority 3: Task Detail Expansion
- Click a task to see full affected files, symbols, connections
- Task-level comments
- Assignee details with model info
- Dependencies shown as a mini-graph
**Effort:** Low (1-2 days)

### Priority 4: Plan Version History
- Version timeline/dropdown
- Click to see snapshot
- Diff between versions
**Effort:** Medium (1-2 days)

### Priority 5: Agent Dashboard
- Multi-agent cards showing who's working on what
- Color-coded per agent
- Activity feed per agent
- Conflict warnings
**Effort:** Medium (2 days)

### Priority 6: Visual Plan Builder
- Click nodes in graph to add to plan
- Draw connections between files
- Right-click context menu for plan actions
- Templates
**Effort:** High (5+ days)

### Priority 7: Semantic Zoom
- Zoomed out = package clusters with aggregate stats
- Zoom in = individual files appear
- Zoom more = functions/classes inside files
- Like Google Maps level of detail
**Effort:** High (3-5 days)

---

## Technical Debt

| Item | Priority | Notes |
|------|----------|-------|
| TypeScript strict mode errors | Low | Many `any` types in backend, works but not type-safe |
| AST parsing runs synchronously | Medium | Blocks Express thread on large repos |
| sql.js in-memory limitation | Low | Works for current scale, might need upgrade for very large projects |
| No test coverage for plan UI | Medium | E2e tests cover API but not plan interaction flows |
| Screenshot tests unreliable | Low | Project-opening via folder picker is flaky in Playwright |
| Stale test plans in database | Low | E2e tests create plans that persist across runs |

---

## Summary

The backend and data layer are solid (~90% complete). The MCP integration is comprehensive (19 tools). The critical gap is the **visual experience** — the graph needs to feel like a living, breathing architecture map, not a static diagram. This is what separates CodeTrellis from being "another dependency viewer" and makes it the "flight radar for code" described in the vision.
