# Integration Model

CodeTrellis's value depends on integrating cleanly with the agent runtimes its users already have. This document describes how that integration works today, what it requires from the agent side, and the principles that keep it durable and vendor-friendly.

## Three integration paths

CodeTrellis integrates with agent runtimes through three layered paths. Together they produce a seamless experience; individually, each is unambiguously legitimate.

### Path 1: Model Context Protocol (MCP)

CodeTrellis exposes an MCP server (default port `19432`, autodetects next port on collision) that any MCP-speaking client can connect to over SSE. Through this server, agents call CodeTrellis's tools to inspect plans, claim work, update items, capture context, drive the UI, control terminals, and more.

MCP is a standard protocol designed for exactly this kind of integration. The agent calls CodeTrellis; CodeTrellis never reaches into the agent. This direction of communication is the protocol's intent. Any runtime that speaks MCP — and the major ones do — has first-class support without per-vendor work.

### Path 2: Integrated terminal

CodeTrellis hosts an integrated terminal pane where users can run their agents directly. When an agent runs inside this terminal, CodeTrellis sees the full output stream and can deliver input through standard stdin mechanisms.

This is the same posture as any terminal multiplexer. The user is running their own software in a terminal CodeTrellis provides. No part of this approach requires reverse-engineering or hooking into another vendor's runtime.

The integrated terminal is a richer experience than MCP-only — the user sees the agent's raw output inline — but it is not required for the rest of CodeTrellis to work.

### Path 3: Skill resources

CodeTrellis publishes its skill guides as MCP resources that agents can fetch on connect. The skill teaches the agent how to talk to the CodeTrellis MCP server: which tools exist, how to claim work, when to narrate via the Presence Pane, how to update progress, how to verify against drift.

Skills are the runtime vendor's plugin point. The resources are loaded by the agent's runtime through documented MCP capabilities; CodeTrellis is not modifying the runtime, just providing content the runtime knows how to consume.

For runtimes that don't natively load MCP resources, the same content is available via the `get_app_guide` MCP tool, so the MCP-only path remains complete.

## The MCP server today

The MCP server exposes **105 tools across 9 domain-specific modules**. Each module owns a focused set of concerns:

| Module | Tools | What it enables |
|---|---:|---|
| **`presence-tools`** | 4 | Agent narration to the user with TTS, blocking acknowledgments, blocking user-input prompts, dismiss |
| **`ui-tools`** | 10 | Screenshot, item selection, project opening, clipboard read/write, settings, log access, skill-guide fetch |
| **`terminal-tools`** | 7 | Create / write / read / list / kill / resize / focus terminals; presets for agent sub-shells |
| **`graph-tools`** | 9 | Focus, mode (live / baseline / planned / diff), scope, layout (map / tree), depth (clusters / files / symbols), select, projection toggle, export, structured snapshot |
| **`plan-item-tools`** | 27 | Object / Action CRUD, bulk add, claim, status updates, progress, blocks, comments, attachments, versions, timeline, suggestions, external refs |
| **`plan-tools`** | 15 | Plan CRUD, file export / import / discovery / unlink, templates (browse / create-from / publish), bulk delete, external import, summary, copy-as-prompt |
| **`session-tools`** | 20 | Session registration, permission setup, navigation (plan / graph / split / timeline / panels / item history), project management (rescan, recents, pin, baseline) |
| **`drift-tools`** | 8 | Detect deviations, reconcile, list proposed changes, drift report, capture checkpoint |
| **`architecture-tools`** | 5 | Symbol search, dependencies, full graph query, cross-system edges, conformity check |
| **Total** | **105** | |

Per-connection architecture: each SSE client gets its own `McpServer` instance; the underlying services are shared. Sessions are auto-registered on connect (agent type inferred from the User-Agent header) and explicitly identified by the agent via `register_session`. On disconnect, the session is cleaned up and the disconnect is broadcast to UI.

Tool registration follows a consistent shape (description + Zod input schema + handler). Most tools broadcast an event on success so the UI and other agents see the change live. Long-running round-trips (screenshot, clipboard read, graph export) use a nonce-and-promise pattern with a 10s timeout.

## Skill flavors

The 6 skill flavors are MCP resources tailored to different agent roles:

| Resource URI | Audience | Purpose |
|---|---|---|
| `codetrellis://skill` | All agents | Project-tailored summary with live plan counts, active sessions, philosophy, and full tool reference |
| `codetrellis://skill/quickstart` | First-time agents | Minimum viable flow: register, set up permissions, list plans, claim work, update progress, verify, mark done |
| `codetrellis://skill/power-user` | Agents on substantial work | Dense plans with `fileSpecs` / `symbolSpecs` for drift detection, multi-agent orchestration, phased plans, spec docs |
| `codetrellis://skill/ui-nav` | Sub-agents piloting the UI | Screenshot, graph control, plan navigation, presence pane — what a UI-driving sub-agent needs |
| `codetrellis://skill/diagnostics` | Debugging agents | Logs, settings, baseline, drift, architecture conformity, rescan |
| `codetrellis://skill/multi-agent` | Coordinating agents | Session registration with `host_terminal_id`, atomic claims, terminal-based delegation, handoff patterns |

Guides are generated on demand; the summary includes live project state (current plan counts, active session list) so the agent reads what's true now, not what was true at build time.

## The integrated terminal

CodeTrellis can spawn up to 20 concurrent terminals, each tabbed in the terminal panel. Four presets simplify launching an agent sub-shell:

| Preset | Behaviour |
|---|---|
| `shell` | Raw bash/zsh |
| `claude` | Spawns Claude Code after a 500ms delay |
| `codex` | Spawns Codex |
| `aider` | Spawns Aider |

Each terminal session has a unique ID for the lifetime of the tab. Sub-shells launched with an agent preset inherit `CODETRELLIS_HOST_TERMINAL=<session_id>` in their environment.

**Self-write guard v2** uses that environment variable to prevent feedback loops: when an agent calls `terminal_write` against a `session_id` that matches its own `host_terminal_id` (declared at `register_session`), the write is intercepted with guidance rather than executed. This stops the "agent writes to its own stdin, sees it as new input, writes again" loop without blocking legitimate cross-terminal communication.

## Agent control of the planning surface

Agents do more than report status. Through the MCP server, they act directly on the planning surface — creating plans, drafting Objects, adding Actions, claiming work, updating progress, posting comments, recording decisions, capturing checkpoints, proposing documentation changes, searching the graph. This makes the human and the agent peers in the workspace, not separate actors with parallel state to reconcile.

This is the highest level of adoption — Level 6 in the [overview](01-overview.md#levels-of-adoption). It builds on the broader tool surface above and is fully optional. Users who prefer to author plans themselves and only run agents against them never need to enable this surface.

## Permission setup for Claude Code

Claude Code prompts the user on each new tool invocation by default. The `setup_agent_permissions` tool (in `session-tools`) writes `.claude/settings.local.json` to auto-approve all CodeTrellis MCP tools for the project, so the user is not interrupted on every action. This is one-time setup per project.

Other runtimes have their own permission mechanisms; for those without a similar concept, agents simply work and the user controls invocation via the runtime's own interface.

## Bring your own AI

CodeTrellis does not resell inference. Customers use their existing AI subscriptions — whatever model relationships they already have. CodeTrellis does not mark up tokens, does not sit between the customer and their model provider, and does not introduce a new vendor relationship.

This has three consequences worth naming explicitly:

- **Cost control stays with the customer.** They see and manage their own usage, on their existing billing relationship.
- **Compliance stays with existing vendors.** Customers who have approved their AI providers do not need to re-approve CodeTrellis as an AI vendor; CodeTrellis is not one.
- **Model choice stays with the user.** A user can mix models from different providers across the same plan — a larger model for a hard problem, a faster model for routine work, a specialist model for a specific domain — and CodeTrellis's handoff mechanism makes this cheap.

## Agent-agnostic by design

CodeTrellis's data model — the attribution format, the V2 plan items tree, the channel event vocabulary, the MCP tool shape — is independent of any specific agent runtime. The same plan can be worked by multiple agents from multiple vendors in parallel. The same channel record can be produced by an agent on one model and consumed by an agent on another for handoff.

This is why the runtime layer is interchangeable but the organising plane is not. Runtimes will continue to evolve; the plane above them, which records what they did and routes attention between them, is the durable layer.

## Vendor-friendly by design

CodeTrellis's integration is built to coexist with agent runtimes rather than compete with them. The three paths all use mechanisms that runtime vendors actively support. Skill resources are loaded through documented MCP capabilities; MCP is a vendor-supported protocol; terminals are a vendor-supported execution environment.

CodeTrellis does not hook agent processes, modify agent binaries, scrape vendor-internal APIs, or otherwise integrate through grey-area means. The integration is durable precisely because it does not depend on undocumented behaviour.

When a runtime improves — a new MCP capability, a better skill mechanism, a richer extension point — CodeTrellis can adopt it. When a runtime changes its internals, CodeTrellis is unaffected, because it never depended on those internals in the first place.

## Designed to work around existing workflows

A common question is whether CodeTrellis "auto-injects" prompts into running agents to drive them. It does not. Steers are delivered through the integration paths above — for agents inside the integrated terminal, the user writes directly to the agent's stdin; for agents speaking MCP, the agent calls a CodeTrellis tool at its natural pause points. The agent always knows what is happening.

This is positioned as a feature, not a limitation. The design respects the boundaries of every runtime it integrates with, gives the user a transparent and auditable interaction model, and produces a record where every steer is a deliberate human action. Workflows that prefer more automation can layer routing rules on top; the default is explicit and traceable because the default user benefits from explicit and traceable.

## Target extensions

Several integration capabilities extend the foundation as team and meeting workflows land:

| Extension | What it adds | Why |
|---|---|---|
| **Audio capture pipeline** | Mic + system audio routed to the user's AI agent via MCP, used to give meeting context to the agent on prompt. See [15 — AI in Collaboration](15-ai-in-collaboration.md). | Lets agents participate in meetings without CodeTrellis hosting transcription or ML. |
| **Channel event surface in MCP** | A small set of tools for agents to post and read channel events (stuck, need-decision, weigh-in, …). | Today `plan_events` is DB-only; channels make these team-coordinatable. |
| **Mobile companion transport** | P2P pairing + streamed views + port tunneling to a paired mobile device. See [16 — Mobile Companion](16-mobile-companion.md). | Lets the user respond to stuck events and review work from mobile, with no operational layer for CodeTrellis to run. |
| **Cross-runtime handoff helpers** | Tools that let one runtime's agent hand off cleanly to another runtime's agent via the channel record. | Already possible via the channel + claim mechanism; the helpers make it ergonomic. |

Each extension follows the same direction-of-communication rule: the agent calls CodeTrellis. The application is acted upon by the agent through documented tools; nothing reaches into the agent's runtime.
