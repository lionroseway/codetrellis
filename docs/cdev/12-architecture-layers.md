# Architecture Layers

CodeTrellis sits in a specific position in the agent-and-codebase stack. This document describes that position visually, walks through the components today, and shows how the layered model extends as team workflows land.

## The layered view

```
┌────────────────────────────────────────────────────────────────┐
│  CEILING — collaboration                                       │
│                                                                │
│  Today:   Presence Pane · UI walkthroughs · atomic claim ·     │
│           multi-agent terminals · drift banner                 │
│  Target:  Channels (peer-to-peer events) · stuck detection ·   │
│           handoffs across teammates · meeting-aware AI         │
├────────────────────────────────────────────────────────────────┤
│  SENSOR — observation and detection                            │
│                                                                │
│  Today:   File watcher · dependency graph deltas · drift       │
│           sensors (8 tools) · plan-events timeline             │
│  Target:  Stuck sensors · documentation sensors · audio        │
│           capture for meeting context                          │
├────────────────────────────────────────────────────────────────┤
│  FLOOR — durable state                                         │
│                                                                │
│  Today:   .codetrellis/plans/ (V2 items, YAML+markdown) ·      │
│           sql.js pantry · attribution · file watcher sync      │
│  Target:  .codetrellis/docs/ (repo-wide system docs) ·         │
│           channel events as manifest entries ·                 │
│           .codetrellis/config.json (per-project) ·             │
│           .codetrellis/external/ (cross-repo pointers)         │
└────────────────────────────────────────────────────────────────┘
```

The floor is the durable substrate — what lives in the user's git and what stays in the local pantry. The sensor layer observes what is happening and produces events. The ceiling is the collaboration surface — where humans and agents act together.

## CodeTrellis's place in the broader stack

```
┌────────────────────────────────────────────────────────────────┐
│  HUMAN INTENT                                                  │
│                                                                │
│  A developer wants to ship X. A team agrees on Y.              │
├────────────────────────────────────────────────────────────────┤
│  AGENT RUNTIMES (vendor's responsibility)                      │
│                                                                │
│  Inference, agent memory, agent-to-agent conversation,         │
│  the conversational loop with the developer                    │
├────────────────────────────────────────────────────────────────┤
│  CODETRELLIS (this product)                                    │
│                                                                │
│  Plan · inspect · keep on track                                │
│  Observe, organise, route attention, durable record            │
├────────────────────────────────────────────────────────────────┤
│  CODE AND DEPENDENCY GRAPH                                     │
│                                                                │
│  The actual files, packages, classes, functions, and the       │
│  edges between them                                            │
├────────────────────────────────────────────────────────────────┤
│  CI / CD                                                       │
│                                                                │
│  Continuous Integration, Continuous Deployment — the           │
│  layers below, which CodeTrellis complements                   │
└────────────────────────────────────────────────────────────────┘
```

CodeTrellis is the layer between the agent runtime and the dependency graph. It doesn't replace either; it makes the work in between continuous, observed, and recorded.

## Event lifecycle (today)

A representative event — drift is detected on a plan — flows through the layers in a specific order today:

```
1. File watcher (chokidar) sees a file change on disk
        │
        ▼
2. Dependency graph re-parses; symbols / imports / cross-system
   edges are updated
        │
        ▼
3. Drift detection runs (on demand via detect_deviations, or on
   user-triggered refresh of the drift report)
        │
        ▼
4. Deviation rows are written to the pantry (deviations table)
        │
        ▼
5. UI broadcasts the new deviation count; drift banner appears
   on the affected plan
        │
        ▼
6. Human reviews the deviation, calls reconcile (accept / revert
   / ignore)
        │
        ▼
7. For an accepted unexpected_file, a "Reconciled changes" Action
   is updated to include the file's spec; the plan now matches
   reality and the file is no longer flagged
```

## Event lifecycle (target)

Once channels and stuck sensors land, the same kind of event gains a peer-routable shape:

```
1. Agent acts (tool-call stream)
        │
        ▼
2. Sensor observes (drift / stuck / documentation)
        │
        ▼
3. Sensor emits channel event into the plan's channel
        │
        ▼
4. Channel event is written to the manifest, committed to git
        │
        ▼
5. Event is routed to subscribed humans (push, in-app) and any
   helping agents
        │
        ▼
6. A responder (human or another agent) posts a steer, weigh-in,
   decision, or handoff
        │
        ▼
7. The response is delivered to the agent via the integration
   path it uses
        │
        ▼
8. Agent resumes; the channel records the exchange
```

The boundaries stay crisp: the manifest is the only durable state, the integration paths are the only ways into and out of agent runtimes.

## Component map

The components that make up CodeTrellis today, with their target extensions noted where relevant.

### Floor — durable state

| Component | Responsibility |
|---|---|
| `plan-file-service` | Reads and writes the YAML + markdown manifest at `.codetrellis/plans/<slug>/`; handles V1 and V2 layouts |
| `persistence` | Owns the sql.js DB at `~/.codetrellis/data.db`; auto-save every 30s when dirty; explicit `saveNow()` on critical mutations |
| `plan-item-service` | CRUD for V2 items; cascade-mode resolution for skills / claim policies / constraints / execution configs; claim with conflict detection |
| `plan-service`, `plan-phases-service` | V1 legacy plan and phase services (dual-read during migration) |
| File watcher (chokidar) | Monitors `.codetrellis/plans/` for external changes; debounced re-import via UID upsert; self-write dedup |
| `settings-service` | Reads / writes `~/.codetrellis/settings.json`; seeds identity from git config |

Target: docs-service for `.codetrellis/docs/`, per-project config reader, cross-repo pointer resolution, channel-event-service (exporting the current `plan_events` to the manifest with the team-coordination vocabulary added).

### Sensor — observation and detection

| Component | Responsibility |
|---|---|
| `deviation-service` + `drift-tools` (8 MCP tools) | Compares Action `fileSpecs` / `symbolSpecs` / `newConnections` against live codebase; produces `missing_file` / `unexpected_file` / `missing_import` deviations |
| `plan-changes-service` | Computes the granular per-file/symbol/connection feed surfaced via `list_proposed_changes` |
| Dependency graph (tree-sitter + cross-system extractors) | Maintains the live view of files, packages, symbols, and HTTP/SQL/subprocess couplings |
| `plan-events` table | Records structural mutations (item created, claimed, status changed); seed of the future channel event log |

Target: stuck sensor (loop / convergence / time-since-commit / semantic-repetition heuristics), documentation sensor (verified-state assertions against `.codetrellis/docs/` content), audio capture pipeline for meeting context.

### Ceiling — collaboration

| Component | Responsibility |
|---|---|
| MCP server (`server.ts` + 9 tool modules) | Exposes 105 tools per connection over SSE; per-McpServer instance per session |
| `presence-service` + `presence-tools` (4 MCP tools) | Hosts ephemeral narration cards, TTS via Web Speech, blocking `await_ack` and `await_user_input` with nonce-and-promise replies |
| `session-service` + `session-tools` (20 MCP tools) | Registers MCP connections; tracks `agent_type`, `model`, `capabilities`, `host_terminal_id`, active plan; powers ConnectedAgents widget |
| `terminal-service` + `terminal-tools` (7 MCP tools) | Multiplexed PTYs with presets (`shell`, `claude`, `codex`, `aider`); self-write guard via `host_terminal_id` |
| Skill resources (6 flavors in `resources.ts` + `skill-guide.ts`) | `summary`, `quickstart`, `power-user`, `ui-nav`, `diagnostics`, `multi-agent` — dynamically generated, project-tailored |

Target: channel renderer (UI for channel events, replies, routing), audio pipeline (mic + system audio capture, route to user's AI via MCP), mobile transport (WebRTC + pairing + streamed view + port tunnel).

### Frontend surfaces

| Component | Responsibility |
|---|---|
| App shell (`App.tsx` + Allotment) | Three-column resizable layout with overlay plan workspace, bottom terminal drawer, floating Presence Pane |
| TopBar + ConnectedAgents | Project tabs, view-depth controls, graph mode toggle, live agent count with per-session detail |
| MainCanvas (ReactFlow) | Four-mode graph: Live, Baseline, Planned, Diff. Three depths: clusters, files, symbols. Two layouts: map (force) and tree (dagre). |
| Plan Workspace V2 | Tree + canvas + activity drawer; plan items presented as a unified Object/Action tree |
| Inspector | Cluster / file / symbol view with code preview, symbols, imports |
| TerminalPanel | Tabbed terminals with preset launchers; collapsible drawer |
| AgentPulse | Inward glow when agents drive UI changes |
| LearnTrellis | 8-step guided onboarding (skippable) |
| Drift indicator (banner + badge) | Surfaces pending deviations on the plan header; accept / ignore actions |

Each component does one thing. The system's behaviour emerges from how they connect.

## What this architecture optimises for

The layered design produces a small set of structural properties:

- **Crisp boundaries.** The manifest is the only durable shared state; the MCP server is the only programmatic entry into the application from agents; the integrated terminal is the only PTY-level integration. Few, clear surfaces.
- **Replaceable parts.** Any component below the ceiling can be replaced without affecting the user-facing experience. New sensor classes, new manifest entity types, and new integration paths all extend the system without restructuring it.
- **Inspectable behaviour.** Mutating tools broadcast events; the activity feed and history rail are projections of the manifest's git history. The system is auditable by reading git.
- **Vendor independence.** No layer depends on a specific runtime vendor's internals. Vendors are clients of the MCP surface, not partners with privileged access.
