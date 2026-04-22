# CodeTrellis — Core Vision

## What CodeTrellis Is

CodeTrellis is a **plan-driven architecture workbench** for AI-assisted software development. It provides a shared visual surface where humans and AI coding agents collaborate on codebase changes through structured plans, real-time execution tracking, and architectural oversight.

Think: **Flight Radar for code architecture** meets **Palantir for AI agent coordination**.

It is NOT just a monitoring tool. It is the **control plane** for AI coding — the place where intent is declared, reviewed, tracked, and verified.

---

## The Problem

AI coding tools (Claude Code, Cursor, Copilot, etc.) are powerful but operate in isolation:

- **No shared context** — each agent session starts fresh, doesn't know what other agents did
- **No visual intent** — agents describe plans in text, humans can't see the architectural impact
- **No structured tracking** — work happens in chat threads, progress is invisible
- **No coordination** — can't split work across agents or tools efficiently
- **No audit trail** — plans evolve but there's no history of how or why
- **No deviation detection** — when reality diverges from the plan, nobody notices

CodeTrellis solves all of these.

---

## The Core Loop

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   1. PLAN          Human or AI creates a structured plan    │
│      ↓             with tasks, file changes, new connections│
│                                                             │
│   2. VISUALIZE     Plan is projected onto the architecture  │
│      ↓             graph — see what WILL change before it   │
│                    happens                                  │
│                                                             │
│   3. REFINE        Human adjusts, AI reads updates,         │
│      ↓             comments are exchanged, plan evolves     │
│                                                             │
│   4. EXECUTE       Agent(s) work through tasks, progress    │
│      ↓             is tracked in real-time on the graph     │
│                                                             │
│   5. VERIFY        Deviations detected, reconciled,         │
│      ↓             architecture validated against plan      │
│                                                             │
│   6. SNAPSHOT      Plan version saved, history preserved,   │
│                    ready for next iteration                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### Plan

A structured set of intended changes to the codebase. Every plan has:

- **UID** — unique identifier (UUID)
- **Title** — human-readable name
- **Description** — what this plan achieves and why
- **Status** — `draft` → `review` → `approved` → `in_progress` → `completed` → `archived`
- **Author** — who created it (human username or agent ID)
- **Tasks** — ordered list of work items
- **Versions** — immutable snapshots of the plan at each revision
- **Comments** — threaded discussion from humans and agents
- **Created/Updated timestamps**

### Task

A unit of work within a plan:

- **UID** — unique identifier
- **Description** — what needs to be done
- **Status** — `pending` → `assigned` → `in_progress` → `done` → `blocked` → `skipped`
- **Assignee** — which agent/tool/model is handling this (e.g. "claude-code", "cursor", "manual")
- **Affected files** — files this task will create/modify/delete
- **Affected symbols** — functions/classes this task will add/change/remove
- **New connections** — import relationships this task will create
- **Removed connections** — import relationships this task will remove
- **Estimated impact** — blast radius (files affected transitively)
- **Comments** — task-level discussion
- **Dependencies** — other task UIDs that must complete first

### Plan Version

An immutable snapshot of a plan at a point in time:

- **Version number** — auto-incrementing
- **Timestamp** — when this version was created
- **Author** — who made this revision (human or agent)
- **Change summary** — what changed from the previous version
- **Full plan state** — complete copy of all tasks and their states

### Comment

A threaded comment on a plan or task:

- **UID**
- **Author** — human name or agent ID (e.g. "yourname", "claude-code:session-abc", "cursor")
- **Body** — markdown text
- **Timestamp**
- **Parent comment UID** — for threading (null for top-level)
- **Attached to** — plan UID or task UID
- **Type** — `comment` | `suggestion` | `approval` | `concern` | `status_update`

### Projection

The visual overlay of a plan onto the current architecture graph:

- **Current state** — the graph as it is now (solid nodes/edges)
- **Planned additions** — new files, functions, imports shown as ghost nodes with green glow
- **Planned modifications** — existing nodes highlighted orange
- **Planned removals** — existing nodes/edges shown with red strikethrough
- **In-progress** — tasks currently being worked on pulse with activity indicator
- **Completed** — tasks that are done shown with checkmark overlay

### Deviation

When the actual codebase state differs from the plan:

- **Type** — `unexpected_file`, `missing_file`, `unexpected_import`, `missing_import`, `unexpected_symbol`, `modified_differently`
- **Severity** — `info` | `warning` | `error`
- **Description** — human-readable explanation
- **Resolution** — `pending` | `accepted` (plan updated) | `reverted` (code changed back)

### Agent Session

A connection from an AI coding agent via MCP:

- **Session ID**
- **Agent type** — "claude-code", "cursor", "aider", "custom"
- **Model** — which LLM model is being used (e.g. "claude-opus-4", "gpt-4o")
- **Connected at**
- **Active plan** — which plan this session is working on
- **Active tasks** — which tasks are assigned to this session

---

## Persistence

All data is persistent across restarts:

| Data | Storage | Notes |
|------|---------|-------|
| Plans + versions | SQLite (file-based) | JSON blobs for flexibility |
| Tasks | SQLite | Relational, queryable |
| Comments | SQLite | Threaded, indexed by plan/task |
| AST/dependency data | SQLite | Rebuilt on scan, cached |
| Agent sessions | SQLite + in-memory | Active sessions in memory, history in DB |
| Snapshots | SQLite | Timestamped graph state captures |

Database location: `~/.codetrellis/data.db` (or configurable)

---

## MCP Tools (Agent Interface)

### Plan Management

```
create_plan(title, description, tasks[])
  → Returns plan UID
  → Creates version 1
  → Agent submits what it intends to do

get_plan(plan_uid)
  → Returns full plan with tasks, status, comments
  → Agent reads the current plan state

update_plan(plan_uid, changes)
  → Creates new version
  → Agent modifies tasks, descriptions, or structure
  → Change summary auto-generated

list_plans(status_filter?)
  → Returns all plans (optionally filtered by status)
  → Agent sees what work exists
```

### Task Management

```
claim_task(plan_uid, task_uid, agent_id)
  → Assigns task to this agent
  → Status → "assigned"
  → Prevents two agents working on the same task

update_task(plan_uid, task_uid, status, details?)
  → Updates task status and optional details
  → Broadcasts to all connected clients

get_next_task(plan_uid, agent_id?)
  → Returns the next unassigned task respecting dependencies
  → Smart assignment based on what's ready
```

### Architecture Queries

```
get_current_state(scope?)
  → Returns current architecture graph (optionally scoped to a path)
  → Agent understands the codebase before planning

get_projection(plan_uid)
  → Returns what the graph WILL look like after the plan
  → Agent can verify its plan makes sense

get_deviations(plan_uid)
  → Returns list of differences between plan and reality
  → Agent can reconcile
```

### Comments & Communication

```
add_comment(target_uid, body, type?)
  → Agent leaves a comment on a plan or task
  → Types: comment, suggestion, concern, status_update

get_comments(target_uid)
  → Returns all comments on a plan or task
  → Agent reads human feedback
```

### Reconciliation

```
reconcile(plan_uid, deviations[], action)
  → Agent acknowledges deviations
  → Actions: "accept" (update plan to match reality), 
             "revert" (flag for human review),
             "ignore" (known divergence)
```

### Session Management

```
register_session(agent_type, model, capabilities[])
  → Registers this agent connection
  → Returns session ID

set_active_plan(plan_uid)
  → Associates this session with a plan
  → UI shows which agents are working on what
```

---

## MCP Resources

```
codetrellis://plans                    — List of all plans
codetrellis://plans/{uid}              — Specific plan with full detail
codetrellis://plans/{uid}/projection   — Projected graph state
codetrellis://graph                    — Current architecture graph
codetrellis://graph/{path}             — Scoped subgraph
codetrellis://deviations/{plan_uid}    — Plan deviations
codetrellis://sessions                 — Active agent sessions
```

---

## UI Design

### Graph Visualization Modes

**Current State** (default)
- Shows the codebase as it is right now
- Solid nodes, solid edges
- Standard colors by language/type

**Plan Projection** (when a plan is selected)
- Current graph in muted colors (70% opacity)
- Planned additions as ghost nodes with dashed green borders and subtle glow
- Planned modifications with orange glow ring
- Planned removals with red strikethrough and reduced opacity
- Animated connection lines showing new imports that will be created
- Task numbers overlaid on affected nodes

**Execution View** (when plan is in_progress)
- Like a flight radar — real-time activity
- Nodes pulse when being actively worked on
- Completed tasks get a checkmark overlay
- Progress bar per task visible on the node
- Agent avatar/icon shown on nodes they're working on
- Timeline scrubber at the bottom to replay execution history

**Diff View** (comparing versions)
- Side-by-side or overlaid comparison of two plan versions
- Green = added in newer version, red = removed, orange = changed

### Plan Panel (replaces current Agent Panel)

Left side or bottom panel with:

**Plan List**
- All plans with status badges
- Click to select/view
- "New Plan" button
- Filter by status

**Plan Detail View**
- Title, description, status, author
- Task list with status indicators, assignee icons
- Progress bar (X of Y tasks complete)
- Version history dropdown
- Comment thread

**Task Detail**
- Affected files list (click to highlight in graph)
- Affected symbols
- New/removed connections
- Assignee with agent type icon
- Status controls
- Task-level comments

### Plan Builder (human creates plans)

- Click nodes in the graph to add them to a plan
- Right-click to "plan to modify/create/delete"
- Draw new connection lines between files
- Drag to rearrange task order
- Assign tasks to specific agents/tools
- Template library for common patterns

### Multi-Agent Dashboard

When multiple agents are connected:

- Agent cards showing: type, model, active task, progress
- Color-coded: each agent gets a unique accent color
- Activity feed showing all agent actions across all plans
- Conflict detection: "Agent A and Agent B are both modifying server.ts"

### Notifications / Alerts

Toast notifications for:
- New deviation detected
- Agent completed a task
- Agent left a comment
- Plan status changed
- Conflict detected (two agents on same file)
- Blast radius warning (task affects many files)

---

## Flight Radar Analogy

Like Flight Radar shows every plane in the sky with real-time position, status, and route:

| Flight Radar | CodeTrellis |
|-------------|-------------|
| Aircraft | AI coding agent |
| Route | Plan with tasks |
| Current position | Active task |
| Destination | Plan completion |
| Altitude | Depth level (package → file → symbol) |
| Speed | Agent activity rate |
| Flight status | Plan status (boarding/in-flight/landed) |
| Air traffic control | Human architect |
| Collision avoidance | Conflict detection |
| Flight history | Plan version history |
| Radar sweep | File watcher scanning |

The user is air traffic control. They see everything, can zoom to any level of detail, can redirect agents, can see conflicts before they happen, and have full history of what went where.

---

## Palantir Analogy

Like Palantir connects disparate data sources into a unified operational picture:

- **Data fusion** — CodeTrellis fuses AST data, git state, agent activity, and plans into one view
- **Ontology** — the architecture graph IS the ontology (files, symbols, dependencies)
- **Timeline** — plan versions and execution history provide the temporal dimension
- **Collaboration** — comments and plan editing are the collaboration layer
- **Alerting** — deviation detection and blast radius warnings are the alerting layer

---

## Multi-Agent Coordination

### How it works

1. Human creates a plan with 5 tasks in CodeTrellis
2. Agent A (Claude Code) connects via MCP, calls `list_plans`, sees the plan
3. Agent A calls `claim_task` on tasks 1 and 2
4. Agent B (Cursor) connects, calls `get_next_task`, gets task 3
5. Both work simultaneously — CodeTrellis shows both agents active on the graph
6. Agent A finishes task 1, calls `update_task(done)`, the node gets a checkmark
7. Agent A starts task 2 — but finds the code is different than expected
8. Agent A calls `add_comment` on task 2: "Found existing auth middleware, plan needs adjustment"
9. Human sees the comment in CodeTrellis, updates the plan
10. Agent A calls `get_plan` to read the updated plan, continues work
11. Agent B finishes task 3 — but it created an unexpected import
12. CodeTrellis detects the deviation, shows warning in UI
13. Agent B calls `reconcile` to acknowledge the deviation
14. Human reviews, approves, plan version 3 is saved
15. Agent C (different model, e.g. a fast model for tests) picks up tasks 4 and 5

### Agent handoff

- Agent A crashes or disconnects mid-task
- Task stays "in_progress" with last known state
- Agent D connects, sees the abandoned task
- Calls `claim_task` — CodeTrellis shows the handoff
- Agent D reads comments and previous work, continues

### Tool flexibility

Plans are agent-agnostic. A task can be:
- Started by Claude Code, continued by Cursor
- Assigned to a specific model ("use opus for this, haiku for tests")
- Done manually by the human (marked as "manual" assignee)
- Deferred to a future session

---

## Implementation Priority

### Phase 1: Plan Data Model + Persistence
- SQLite schema for plans, tasks, versions, comments
- CRUD API endpoints
- Basic MCP tools: create_plan, get_plan, update_plan, list_plans
- File-based persistent database

### Phase 2: Plan UI
- Plan panel in the frontend (list, detail, task view)
- Plan creation from UI (title, tasks, affected files)
- Comment thread UI
- Plan status management

### Phase 3: Graph Projection
- Overlay planned changes on the architecture graph
- Ghost nodes for additions, glow for modifications, strikethrough for removals
- Click task → highlight affected nodes
- Zoom to task scope

### Phase 4: Execution Tracking
- Real-time task status updates via MCP + WebSocket
- Agent activity indicators on graph nodes
- Progress tracking per plan and per task
- Deviation detection and alerting

### Phase 5: Multi-Agent
- Session registration and tracking
- Task claiming and assignment
- Conflict detection
- Agent dashboard
- Handoff support

### Phase 6: Plan Builder
- Visual plan creation in the graph (click to add, draw connections)
- Template library
- Plan import/export
- Version comparison view

---

## Technical Notes

### Database Schema (new tables)

```sql
CREATE TABLE plans (
  uid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  author TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'human',
  project_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE plan_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_uid TEXT NOT NULL REFERENCES plans(uid),
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,  -- JSON blob of full plan state
  change_summary TEXT,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(plan_uid, version)
);

CREATE TABLE tasks (
  uid TEXT PRIMARY KEY,
  plan_uid TEXT NOT NULL REFERENCES plans(uid),
  sort_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  assignee TEXT,
  assignee_type TEXT,  -- 'claude-code', 'cursor', 'manual', etc.
  assignee_model TEXT, -- 'claude-opus-4', 'gpt-4o', etc.
  affected_files TEXT, -- JSON array
  affected_symbols TEXT, -- JSON array
  new_connections TEXT, -- JSON array of {from, to}
  removed_connections TEXT, -- JSON array of {from, to}
  dependencies TEXT, -- JSON array of task UIDs
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE comments (
  uid TEXT PRIMARY KEY,
  target_type TEXT NOT NULL, -- 'plan' or 'task'
  target_uid TEXT NOT NULL,
  parent_uid TEXT, -- for threading
  author TEXT NOT NULL,
  author_type TEXT NOT NULL, -- 'human' or agent type
  body TEXT NOT NULL,
  comment_type TEXT NOT NULL DEFAULT 'comment',
  created_at INTEGER NOT NULL
);

CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL,
  model TEXT,
  active_plan_uid TEXT REFERENCES plans(uid),
  connected_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE deviations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_uid TEXT NOT NULL REFERENCES plans(uid),
  deviation_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  description TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'pending',
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER
);
```

### File-based persistence

Move from in-memory sql.js to file-based:
- Database at `~/.codetrellis/data.db`
- WAL mode for concurrent access
- Auto-create on first run
- Backup on plan version creation
