# Three Trellis State System — Technical Design

## Overview

The Three Trellis State system is the core differentiator of CodeTrellis. It enables a developer to see three simultaneous views of their codebase architecture while working with an AI coding agent:

1. **Current Trellis** — the frozen "before" state (captured at plan approval)
2. **Planned Trellis** — the target "after" state (computed from plan tasks)
3. **Live Trellis** — the real-time "right now" state (updated as files change)

This document describes the technical design for implementing this system.

---

## Data Model

### Trellis Snapshot

A snapshot captures the complete architecture state at a point in time:

```typescript
interface TrellisSnapshot {
  id: number;
  name: string;                    // e.g. "HEAD at plan approval", "checkpoint 3"
  snapshotType: 'current' | 'planned' | 'checkpoint';
  planUid: string | null;          // linked plan
  gitBranch: string | null;
  files: Array<{
    path: string;                  // relative path
    contentHash: string;
    language: string;
    symbolCount: number;
    symbols: Array<{               // top-level symbols at capture time
      name: string;
      kind: string;
      startLine: number;
    }>;
  }>;
  edges: Array<{
    source: string;                // relative path
    target: string;                // relative path
    specifiers: string[];          // imported symbols
  }>;
  createdAt: number;
}
```

### Database Schema

```sql
CREATE TABLE trellis_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,      -- 'current', 'planned', 'checkpoint'
  plan_uid TEXT REFERENCES plans(uid),
  git_branch TEXT,
  files_json TEXT NOT NULL,        -- JSON array of file records
  edges_json TEXT NOT NULL,        -- JSON array of edge records
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_trellis_plan ON trellis_snapshots(plan_uid);
CREATE INDEX idx_trellis_type ON trellis_snapshots(snapshot_type);
```

### Trellis Mode

```typescript
type TrellisMode = 'current' | 'planned' | 'live' | 'diff';
```

### Drift Report

```typescript
interface DriftReport {
  planUid: string;
  snapshotId: number;              // baseline snapshot being compared against
  timestamp: number;
  
  onTrack: string[];               // files matching plan expectations
  drifted: Array<{
    file: string;
    expected: string;              // what plan says should happen
    actual: string;                // what actually happened
    severity: 'info' | 'warning' | 'error';
  }>;
  unexpected: string[];            // files changed outside of plan
  missing: string[];               // planned changes not yet made
  
  progress: number;                // 0-100, based on completed tasks
  edgesAdded: number;
  edgesRemoved: number;
  filesAdded: number;
  filesModified: number;
}
```

---

## Architecture

### State Flow

```
Plan approved
    ↓
Auto-capture Current Trellis (snapshot of git HEAD state)
    ↓
Store in trellis_snapshots table
    ↓
Agent starts working (via MCP)
    ↓
File watcher detects changes → AST re-parse → Live Trellis updates
    ↓
Every 10s: compute drift (Live vs Planned)
    ↓
If drift detected → broadcast deviation → toast notification
    ↓
User switches between Current / Planned / Live / Diff views
```

### Graph Rendering per Mode

```
Current Mode:
  buildFromSnapshot(snapshot.edges)    → frozen graph, muted colors
  
Planned Mode:
  buildFromSnapshot(snapshot.edges)    → base graph
  + applyProjection(projectionData)   → ghost nodes, new edges
  
Live Mode:
  buildDependencyGraph(liveEdges)     → real-time graph (current behavior)
  
Diff Mode:
  buildDependencyGraph(liveEdges)     → base graph
  + applyChangeMap(diffData)          → color-coded changes vs snapshot
```

### API Endpoints

```
POST /api/trellis/capture
  Body: { projectPath, planUid?, name? }
  Returns: { id, name, snapshotType, createdAt }
  
  Captures current AST/dependency state as an immutable snapshot.
  Called automatically when plan status → 'approved'.

GET /api/trellis/snapshots?plan=<uid>
  Returns: Array<{ id, name, snapshotType, planUid, gitBranch, createdAt }>
  
  Lists all snapshots, optionally filtered by plan.

GET /api/trellis/:id
  Returns: { ...snapshot, files, edges }
  
  Full snapshot with file and edge data for rendering.

GET /api/trellis/:id/diff
  Returns: DriftReport
  
  Compares snapshot against current live state.
  Includes progress percentage and file-level diff.

GET /api/trellis/:id/graph
  Returns: { nodes: Node[], edges: Edge[] }
  
  Pre-computed ReactFlow graph data from snapshot.
  Same format as buildDependencyGraph output.
```

### MCP Tools

```
get_drift_report(plan_uid)
  Returns: DriftReport
  
  Agent calls this to check if it's still following the plan.
  Uses the plan's baseline snapshot vs current live state.
  Includes actionable information: what to fix, what's missing.

capture_checkpoint(plan_uid, name)
  Returns: { snapshotId }
  
  Agent or human creates a named checkpoint during execution.
  Useful for long-running plans with multiple phases.
```

---

## Frontend Implementation

### View Mode Selector

Located in the graph toolbar (top-right of MainCanvas), alongside Map/Tree toggle:

```
┌─────────────────────────────────────────────────────┐
│  [ Current | Planned | Live | Diff ]   Map | Tree   │
└─────────────────────────────────────────────────────┘
```

- **Current**: Blue tint, "BASELINE" label, frozen
- **Planned**: Green tint, ghost nodes visible, "TARGET" label
- **Live**: Default colors, real-time updates, "LIVE" indicator with pulse
- **Diff**: Color-coded overlay, legend showing added/modified/removed counts

### Graph Builder Extensions

New function `buildFromSnapshot()`:
- Takes snapshot edge data instead of live API data
- Uses the same layout engine (force or tree)
- Returns same `{ nodes, edges }` format
- Nodes get a `frozen: true` data flag → different visual style

### Snapshot-based Rendering

When mode is `current` or `planned`:
1. Fetch snapshot from `/api/trellis/:id`
2. Convert snapshot edges to `DependencyEdge[]` format
3. Call `buildFromSnapshot(snapshotEdges, viewDepth, layoutMode)`
4. Render with muted/frozen styling

When mode is `diff`:
1. Fetch snapshot edges + live edges
2. Compute client-side diff (added/removed/modified files and edges)
3. Build graph from live edges
4. Apply diff markers to nodes via `changeStatus`

### Auto-Capture Flow

When plan status changes to `approved`:
1. Plan service updates status
2. Plan service calls `trellis-service.captureCurrentTrellis(projectPath, planUid)`
3. Snapshot stored in DB
4. Frontend receives `plan-updated` WebSocket → auto-switches to `planned` view
5. Plan detail shows "Baseline captured at [time]"

---

## Performance Considerations

### Snapshot Size
- A 70-file project produces ~100 edges
- JSON size: ~20-50 KB per snapshot
- Database impact: minimal (kilobytes per snapshot)

### Graph Rendering
- Single ReactFlow instance for all modes (no duplication)
- Mode switch = re-compute graph from different data source
- Layout recalculation takes 100-300ms for 100 nodes
- React.memo on node components prevents unnecessary re-renders

### Diff Computation
- Client-side diff for immediate feedback
- Server-side diff for accurate comparison (includes symbol-level)
- Polling interval: 10s for diff mode (existing pattern)

---

## Interaction Design

### Workflow

1. User creates plan → sees Planned view overlay
2. User approves plan → Current Trellis auto-captured
3. User sees "Baseline saved" toast
4. Agent starts working → user watches in Live view
5. User toggles to Diff → sees green (new), orange (modified), red (removed)
6. Drift detected → toast: "Agent modified unexpected file"
7. User clicks drift alert → sees details, can adjust plan
8. Agent reads updated plan via MCP → continues
9. All tasks done → user compares Current vs Live → reviews total changes

### Keyboard Shortcuts
- `Cmd+Shift+1` → Current view
- `Cmd+Shift+2` → Planned view
- `Cmd+Shift+3` → Live view
- `Cmd+Shift+4` → Diff view

---

## Migration from Existing System

The existing diff engine (`diff-engine.ts`) stores a single in-memory baseline. The new system:

1. **Keeps the existing diff engine** for backward compatibility
2. **Adds trellis-service.ts** as the persistent snapshot layer
3. **Extends MainCanvas** with mode selector (no breaking changes)
4. **Extends graph-builder** with `buildFromSnapshot` (additive)

The current behavior (live graph + projection overlay) becomes the "Live" and "Planned" modes respectively. No existing functionality is removed.
