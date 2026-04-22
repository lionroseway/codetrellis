# CodeTrellis — Core Vision

## What CodeTrellis Is

CodeTrellis is a **harness for AI coding agents**. It sits between the human architect and the AI agent, providing structured plans, visual architecture tracking, and real-time conformity monitoring.

Think: **Mission control for AI-assisted development.**

It is NOT a monitoring tool. It is NOT just a plan manager. It is the **control surface** that ensures AI coding agents do what you want, the way you want, and you can see exactly what's happening.

---

## The Problem

AI coding tools (Claude Code, Cursor, Copilot, etc.) are powerful but:

- **They hallucinate** — they lose track of what they were supposed to do, especially in complex refactors
- **They have no architectural awareness** — they modify code without understanding the dependency graph
- **They can't be monitored** — you see a chat log, not a visual representation of what's changing
- **They can't be paused and redirected** — once started, there's no structured way to say "stop, you've drifted"
- **Plans are vague** — "refactor the auth system" is not a spec. There's no structured breakdown of what changes where.
- **No continuity** — start with one agent, can't hand off to another. Context is lost between sessions.

CodeTrellis solves all of these by being the **source of truth** that both human and agent reference.

---

## The Three Trellis States

This is the core concept. At any point during an AI-assisted coding session, three states of the codebase exist:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  CURRENT TRELLIS │     │ PLANNED TRELLIS  │     │   LIVE TRELLIS   │
│   (git HEAD)     │     │   (the spec)     │     │  (right now)     │
│                  │     │                  │     │                  │
│ What the code    │     │ What it SHOULD   │     │ What it IS as    │
│ looked like      │ ──► │ look like when   │ ◄── │ the agent works  │
│ before work      │     │ the plan is done │     │ on it            │
│ started          │     │                  │     │                  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
      frozen               human + agent            changes in
      snapshot              iterate on this          real-time
```

### Current Trellis
- Snapshot of the codebase at git HEAD (or any chosen commit/branch)
- Shows: files, functions, classes, imports, dependencies
- This is the "before" state — frozen, doesn't change during execution

### Planned Trellis
- The target state — what the codebase SHOULD look like after all tasks are done
- Created collaboratively: human drafts, agent refines via MCP, human adjusts
- Contains: new files, modified functions, new imports, removed connections
- This IS the spec. The agent follows this verbatim.
- Can be vague ("refactor auth") or precise ("move validateToken from auth.ts to jwt.ts, change signature to accept RSA key")
- Versioned — every revision is saved, can see how the plan evolved

### Live Trellis
- The actual state of the codebase RIGHT NOW as the agent works
- Updates in real-time as files are created, modified, deleted
- Compared against the Planned Trellis to detect drift
- Compared against the Current Trellis to see what's actually changed

### The Value

At any moment, a developer can see:
- **What was** (current) vs **what should be** (planned) vs **what is** (live)
- **Drift** — where the live state diverges from the plan
- **Progress** — how much of the planned state has been achieved
- **Impact** — which parts of the current state are being affected

---

## The Core Loop

```
1. PLAN
   Human describes what needs to happen (can be high-level or detailed).
   Agent reads the codebase via MCP, suggests a structured plan.
   Human and agent go back and forth refining the plan.
   The Planned Trellis is established.

2. REVIEW
   Human sees the Planned Trellis overlaid on the Current Trellis.
   "These files will be created, these connections will change,
    these functions will be modified."
   Human approves, adjusts, or rejects.

3. EXECUTE
   Agent follows the plan task by task.
   The Live Trellis updates in real-time.
   CodeTrellis monitors conformity: is the agent following the plan?

4. MONITOR
   If drift is detected (agent does something unexpected),
   CodeTrellis alerts the human.
   Human can pause, adjust the plan, or redirect the agent.
   The agent reads the updated plan via MCP and continues.

5. VERIFY
   When all tasks are done, compare Live Trellis vs Planned Trellis.
   Are all expected changes present? Any unexpected changes?
   Human reviews and approves.
```

---

## What a Plan Contains

Plans can range from vague to precise:

### Vague plan (human describes intent):
```
Title: "Refactor authentication"
Description: "Move from session-based auth to JWT. Keep backward
compatibility for existing endpoints."
Tasks:
  1. Create JWT utility module
  2. Update auth middleware
  3. Migrate existing endpoints
```

### Precise plan (agent-generated or human-detailed):
```
Title: "Refactor authentication to JWT"
Description: "Replace session-based auth with JWT tokens..."

Task 1: Create JWT utility
  Files: src/utils/jwt.ts (NEW)
  Symbols: signToken(payload, secret) → string
           verifyToken(token, secret) → JwtPayload
           JwtPayload interface { sub, iat, exp }
  Connections: none (leaf module)

Task 2: Update auth middleware
  Files: src/middleware/auth.ts (MODIFY)
  Changes:
    - Remove: sessionStore.get(req.cookies.sid)
    - Add: verifyToken(req.headers.authorization)
    - Import: { verifyToken } from '../utils/jwt'
  New connections: auth.ts → jwt.ts

Task 3: Update user routes
  Files: src/routes/users.ts (MODIFY)
  Changes:
    - Remove: req.session.userId
    - Add: req.user.sub (from JWT payload)
  Dependencies: Task 2 must be done first
```

The agent follows this as a spec. If it deviates, CodeTrellis detects it.

---

## MCP as the Interface

The MCP server is how agents interact with CodeTrellis:

### Planning phase (back-and-forth):
```
Agent: check_architecture("src/middleware") → sees current auth setup
Agent: create_plan({title, tasks}) → submits initial plan
Human: adjusts plan in UI → plan version 2
Agent: get_plan(uid) → reads updated plan
Agent: add_comment("Consider using RS256") → discussion
Human: approves plan → status = approved
```

### Execution phase (agent follows spec):
```
Agent: get_next_task(plan_uid) → gets Task 1
Agent: claim_task(task_uid) → claims it
Agent: update_task(task_uid, "in_progress") → CodeTrellis shows activity
  ... agent writes code ...
Agent: update_task(task_uid, "done") → checkmark on graph
Agent: get_next_task(plan_uid) → gets Task 2
  ... continues ...
```

### Monitoring (CodeTrellis watches):
```
File watcher detects change → re-parse AST → compare to plan
If agent modifies unexpected file → deviation alert
If agent creates wrong import → drift warning
If agent skips a planned change → missing change alert
```

---

## Future: The Full Harness

CodeTrellis evolves into a complete development harness:

### Phase 1 (NOW): Plan + Monitor
- Three trellis states (current, planned, live)
- MCP-based agent interaction
- Deviation detection and drift alerts

### Phase 2: Embedded Terminal
- Run CLI agents (Claude Code, aider) directly inside CodeTrellis
- See terminal output alongside the graph
- Agents auto-connected via MCP

### Phase 3: Browser Integration
- Embedded browser for visual testing
- Capture screenshots and feed back to agents
- Visual regression detection

### Phase 4: Multi-Agent Orchestration
- Split plans across multiple agents
- Different models for different tasks (fast model for tests, smart model for refactors)
- Conflict detection and automatic resolution
- Agent handoff (pause one, continue with another)

### Phase 5: Team Collaboration
- Multiple humans can view the same CodeTrellis session
- Comments and approvals from team members
- Plan templates shared across projects
- Org-level architectural rules

---

## Why "Trellis"

A trellis is a framework that supports growth. In gardening, it guides vines to grow in the right direction. In CodeTrellis:

- The **plan** is the trellis — the framework that guides the AI agent
- The **code** is the vine — it grows along the trellis
- The **human** is the gardener — they design the trellis and prune deviations
- **Without a trellis**, the vine grows wild (agent hallucinates, loses track)
- **With a trellis**, growth is structured, directed, and visible
