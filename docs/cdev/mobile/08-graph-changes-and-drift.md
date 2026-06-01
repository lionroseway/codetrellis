# Graph Changes and Drift on Mobile

The desktop has three detection systems that watch the codebase as
agents work:

1. **Deviation detector** — compares the plan's expected file changes
   against reality. "Item said create `parser.ts` but it doesn't
   exist." "File `config.ts` was modified but isn't in any plan item."
   Types: `missing_file`, `unexpected_file`, `unexpected_dependency`.
   Severity: info / warning / error. Resolution: pending / accepted /
   reverted / ignored.

2. **Drift sensor** — watches for files that changed since the last
   verification stamp but aren't tracked in any plan. Fires
   `need-decision` channel events: "Drift sensor detected 2 new
   deviations."

3. **Stuck sensor** — watches the MCP tool-call stream for repetition
   loops, error loops, and idle stalls. Fires `stuck` channel events.

These already surface as channel events on the desktop. But on
mobile, seeing "need-decision: Drift sensor detected 2 new
deviations" as a line item is not actionable. You need to see
**what changed, where, and whether it's a problem**.

## What the mobile should show

### Graph change feed

A dedicated section (either in the Activity tab or as a sub-view of
the Graph tab) that shows **what changed in the codebase** since
the last time you looked:

```
RECENT CHANGES                          12 min ago
────────────────────────────────────────────────
+ src/backend/services/parser.ts        new file
  → 4 symbols exported
  → depends on: tree-sitter-service, types

~ src/backend/services/webrtc-service.ts  modified
  → 2 symbols added: handleReconnect, validateSDP
  → 1 new dependency: crypto-service

- src/backend/services/old-parser.ts    deleted
  → was depended on by: resolver-service (⚠ broken?)

~ src/shared/types/peer.ts              modified
  → 1 type added: ReconnectionState
────────────────────────────────────────────────
```

Each entry shows:
- **File path** + change type (+/~/-)
- **Impact summary**: symbols added/removed, new dependencies,
  broken dependants
- **Tap to drill in**: goes to the Graph tab's file detail view

This is built from data the desktop already has — the file watcher
tracks changes, the AST parser indexes symbols, the dependency graph
tracks edges. We just need an RPC method to return recent changes.

### Deviation panel

When deviations exist for a plan, they appear in the plan detail
view (alongside Items, Channel, Changes tabs) as a **Drift tab**:

```
DRIFT                                  3 pending
────────────────────────────────────────────────
⚠ missing_file                         warning
  "Auth middleware" expected to create
  src/backend/middleware/auth.ts
  but it doesn't exist
  [Accept] [Ignore] [View in Graph]

⚠ unexpected_file                      warning
  src/backend/services/temp-hack.ts
  was modified but isn't in any plan item
  [Accept] [Ignore] [View in Graph]

⚠ unexpected_dependency                info
  webrtc-service.ts now depends on
  crypto-service.ts — not in the plan
  [Accept] [Ignore] [View in Graph]
────────────────────────────────────────────────
```

Each deviation has action buttons:
- **Accept** — "this is fine, the plan should include this"
- **Ignore** — "not relevant, dismiss"
- **View in Graph** — jump to the file/symbol in the graph browser

These actions map to the existing deviation resolution API
(`accepted`, `ignored`, `reverted`).

### Attention badges

The Home tab's attention badges include deviation counts:

```
┌─────────────────────────────┐
│  ⚠ 3 deviations pending    │ ← tap → Drift tab
│  🔴 1 stuck event           │ ← tap → Activity tab
│  🟡 2 need-decision         │ ← tap → Activity tab
└─────────────────────────────┘
```

Push notifications fire for high-severity deviations (warning/error)
so you know something went off-plan even when the app is
backgrounded.

### Dependency diff

When the graph changes, the mobile can show a **dependency diff** —
which edges were added or removed:

```
NEW DEPENDENCIES (since last check)
────────────────────────────────────────────────
webrtc-service.ts  →  crypto-service.ts     new
parser.ts          →  tree-sitter-svc.ts    new
resolver-service.ts →  old-parser.ts        broken ⚠
────────────────────────────────────────────────
```

This is the "graph divergence" view — you can see at a glance
whether the agent added sensible dependencies or created a mess.

## Data requirements

### New RPC methods

| Method | Returns |
|---|---|
| `graph.recent-changes` | Files changed since timestamp, with symbol/dep summaries |
| `graph.dependency-diff` | Edges added/removed since timestamp |
| `deviation.list` | Deviations for a plan (existing service method) |
| `deviation.resolve` | Accept/ignore/revert a deviation |

### Enriched snapshot

Add to `WorkspaceSnapshot` v2:

```typescript
deviationCounts: {
  pending: number;
  byPlan: Array<{ planUid: string; count: number }>;
};
graphChangesSince: number;  // timestamp of last mobile check
recentFileChanges: number;  // count of files changed since last check
```

This gives the Home tab enough to show badges without RPC.

## Where it fits in the phases

This slots into **Phase M2** (plan detail) for the deviation panel,
and **Phase M4** (graph browser) for the change feed and dependency
diff. The attention badges go into **M1** (enriched snapshot).

Specifically:
- M1: deviation count badges on Home tab
- M2: Drift tab in plan detail, deviation actions (accept/ignore)
- M4: graph change feed, dependency diff view
- M6: push notifications for high-severity deviations

## Why this matters

The graph and deviation features are **the thing that makes
CodeTrellis different from every other planning tool**. Every tool
shows you a task list. Only CodeTrellis shows you what the agent
actually did to the codebase and whether it matches what was planned.

On mobile, this becomes: "I'm away from the desk, the agent is
working, and I can see in real time whether it's building what I
asked for or going off-piste." That's the pitch. The phone becomes
a codebase health monitor you carry in your pocket.
