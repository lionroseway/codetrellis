# Overview and Principles

## The category

Continuous Development (CDev) is a category that names the layer above the dependency graph and below the runtime — the place where intent, decisions, and progress accumulate as durable artefacts that humans and agents can both work against.

Continuous Integration solved the problem of code that works on one machine but not on others. Continuous Deployment solved the problem of releases that are slow, manual, or risky. CDev addresses the equivalent problem for *development itself*: that the planning, decision-making, and agent-driven execution upstream of CI/CD is opaque, ephemeral, and unaccountable. CDev makes that layer observable, organised, and traceable in exactly the same way CI/CD made integration and deployment so.

CodeTrellis is the platform that implements this layer.

## The thesis

> Agentic coding is fundamentally limited by an LLM's ability to suppress context pressure.

As an LLM agent runs, its context fills with its own outputs, prior attempts, and partial state. The longer it runs, the more it must attend to its own history; the worse it gets at staying on task. Loops, drift, and compounding errors are all symptoms of this pressure. A larger context window amplifies the problem rather than relieving it.

The interventions that suppress context pressure are well understood:

- **Externalising state** — plans, decisions, and system documentation the agent does not have to reconstruct from memory.
- **Hand-offs** — a fresh agent inherits clean context, just enough to continue.
- **Decomposition** — scoped phases keep individual tasks short.
- **Circuit breakers** — stuck-detection so an agent stops grinding rather than re-inflating context with failed attempts.
- **Human interrupts** — humans reset the frame in ways no LLM can do for itself.

CodeTrellis operationalises these interventions.

## Positioning

CodeTrellis is **agent-agnostic**. It works with any client that speaks the Model Context Protocol (MCP) or that emits a tail-able log. The runtime hosting the agent is interchangeable; the organising plane is not.

CodeTrellis **does no AI work**. It does not host inference, it does not store agent working memory as a primitive, it does not provide a chatroom for agents to converse in. These belong to the runtime layer.

What CodeTrellis provides instead:

- **Observation.** Every agent action, attributed to a person and a model, captured as it happens.
- **Anchoring.** Activity is tied to a dependency graph of the codebase — files, classes, functions, and cross-system coupling.
- **Organisation.** Plans, phases, specs, and decisions structure work in advance and record it after.
- **Routing.** When an agent gets stuck, CodeTrellis surfaces the condition and routes attention — to a human, to another agent, or to both.
- **Records.** Every meaningful event is captured in the user's git repository as a durable artefact.

## The product loop

Three verbs name what CodeTrellis does:

| Verb | Purpose | How it suppresses context pressure |
|---|---|---|
| **Plan** | Decompose work into scoped phases with explicit intent | Up front — no single task has to hold too much |
| **Inspect** | Observe agent activity, detect drift and stuck conditions early | During — catches compounding error before context bloats past recovery |
| **Keep on track** | Steer in flight, or hand off to a fresh agent or another model | At the breakpoint — work survives even when one agent's context dies |

Every feature in CodeTrellis should be evaluated against this loop: does it reduce context pressure somewhere in plan, inspect, or keep on track? If yes, it belongs. If no, it does not.

## Three differentiators

CodeTrellis differs from adjacent products on three structural axes. Each is a deliberate *no* that becomes a *yes* for the user.

| Axis | What CodeTrellis does not do | What it does instead |
|---|---|---|
| AI work | Run inference, host agents, store agent memory | Observe, organise, route attention |
| State | Hold work in a walled garden | Live in the user's git repository |
| Commercial | Resell inference or mark up tokens | Operate on the user's existing subscriptions |

Each *no* compounds. Together they describe a product that integrates cleanly into existing infrastructure, existing procurement, and existing governance — without becoming another vendor relationship to manage.

## Levels of adoption

CodeTrellis is designed to be useful at every level of adoption. The product does not require commitment to any single layer or workflow. The lowest level is the entry point; higher levels become available when they serve the work.

Status markers: ♦ available today, ◐ foundation today / extensions target, ○ target extension.

| Level | What the user gets | Status |
|---|---|---|
| 1 — Visual observation | A live dependency graph of the codebase across four modes (Live / Baseline / Planned / Diff) and three depths (Clusters / Files / Symbols). No plans, no channels, no manifest commitments. | ♦ |
| 2 — Planning workspace | The full V2 plan workspace — Objects for context and Actions for graph-anchored work, with file/symbol/connection specs that feed drift detection. Plans are durable in `.codetrellis/plans/`, usable as prompt sources or thinking surfaces. | ♦ |
| 3 — System documentation | A repo-wide documentation layer (`.codetrellis/docs/`) agents and humans maintain together — architecture overviews, runbooks, conventions — distinct from plan-scoped specs. | ○ |
| 4 — Agent collaboration | Multi-agent coordination via terminals and atomic claim; AI walkthroughs and narration via the Presence Pane; drift detection on declared specs. Channels and stuck sensors extend this to team-wide peer-to-peer coordination. | ◐ |
| 5 — Team and multi-device | Plans and items travel via git, attribution carries across teammates, multi-device clones get the same state. Cross-repo (home-and-link), central oversight, and per-project config extend this to org-shape collaboration. | ◐ |
| 6 — Programmatic agent integration | Agents act on the planning surface via MCP — creating plans, drafting Objects, adding Actions, posting comments, claiming work, capturing checkpoints, querying the graph. | ♦ |
| 7 — AI in collaboration | AI present in conversation — Presence Pane walkthroughs today; meeting-aware audio capture and mobile companion as extensions. The level where AI is in the room, accountable through presence. | ◐ |

Each level is independently useful. A user can sit at any one of them without adopting the levels above or below. Most users move up and down across levels depending on the task: a quick fix needs no planning; a large feature benefits from full agent collaboration; an architecture conversation pulls Level 7 in.

The levels are not a maturity model with a "right" destination. They are a menu.
