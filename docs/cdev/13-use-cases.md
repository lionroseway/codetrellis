# Use Cases

This document grounds the architecture in concrete scenarios. Each scenario describes a situation the design is intended to handle, what the user experiences, which parts of the system are involved, and where it sits today vs. target.

The scenarios range from the lowest level of adoption (a graph viewer) to the highest (an agent drafting plans on the planning surface itself). They're intentionally varied; many users will recognise themselves in several at once, depending on the task.

Status legend:

- ♦ **Today** — works with the current implementation
- ◐ **Partial** — foundation exists today; full scenario lands with target extensions
- ○ **Target** — requires extensions described in the architecture docs

## ♦ A user just wants to see what is changing

A developer wants the dependency graph and the live view of file changes, but is happy with their existing planning workflow.

- **What happens:** They open the application, point it at the repository, and use the graph view. No plan is created; the manifest is empty. The application is a viewer, nothing more. Four modes (Live, Baseline, Planned, Diff) and three depths (Clusters, Files, Symbols) give them ways to look at the codebase.
- **Components involved:** Dependency graph, file watcher, graph canvas.
- **Level of adoption:** 1.

## ♦ A solo developer plans a large feature before starting

A single developer needs to ship a substantial feature and wants to think it through before writing any code. They use CodeTrellis as a thinking workspace and a prompt generator.

- **What happens:** They author a plan as a V2 tree — Objects for context and specs, Actions for the work items, with `fileSpecs` declaring what's going to change. The plan lives in `.codetrellis/plans/<slug>/` as YAML + markdown so they can pick it up on another machine. They can hand it to an agent or work through it themselves.
- **Components involved:** Manifest, plan-item-service, plan workspace V2, per-machine continuity.
- **Level of adoption:** 2.

## ♦ An agent drafts the plan itself

A user describes a task in natural language. The agent uses the planning tools to draft a plan, decompose it into Objects and Actions, link it to relevant parts of the dependency graph, and present it back for review.

- **What happens:** The agent calls `create_plan`, `add_item`, `bulk_add_items`, and graph-query tools through MCP. The draft appears in the planning workspace with the agent's attribution. The human reviews, edits, approves, and then either executes the plan themselves or hands it back to the agent.
- **Components involved:** MCP server (plan-item-tools, plan-tools, architecture-tools), manifest, attribution.
- **Level of adoption:** 6.

## ◐ One developer, several machines

A developer starts a plan on a desktop in the morning, continues on a laptop at lunch, and finishes on a tablet in the evening.

- **What works today:** The manifest in the repository is the canonical state. Cloning the repository on each new device restores the plan, items, comments, attachments, and history. The team-shared work travels naturally.
- **What's target:** Personal continuity — drafts not yet promoted, user preferences, scratch — travels via personal sync only once that's built.
- **Components involved:** Manifest, plan-file-service, sql.js pantry, settings-service.

## ♦ Several agents working in parallel on one plan

A task has been broken into pieces. Several agents run in parallel — typically each in its own git worktree — and the results are merged through a pull request.

- **What happens:** Each agent claims its Action atomically via `claim_item`, which detects file-overlap conflicts. Each agent is attributed to its responsible human. The ConnectedAgents widget shows all live sessions. Progress and status updates flow through plan_events.
- **What's target:** Channel events to make stuck conditions and handoffs visible across parallel work.
- **Components involved:** plan-item-service (claim with conflict detection), session-service, ConnectedAgents widget.
- **Level of adoption:** 4.

## ◐ Multiple teams, one project

Multiple teams contribute to a single project. One team owns part of a plan; another team owns another part; a third reviews.

- **What works today:** Per-Action ownership (assignee field), the activity timeline (plan_events), and git access controls on the manifest already give a basis for team scoping.
- **What's target:** Channel events for coordinating across teams, central-oversight deployment shape (`org/cdev-plans` planning repo), team-aware routing rules.
- **Components involved:** Attribution, deployment shapes, channel extensions.

## ♦ A non-engineer stakeholder reviews progress

A product manager, designer, or executive wants to understand what is happening on a project without installing developer tooling.

- **What happens:** The manifest is markdown and YAML in the repository. Anyone with read access can read plans through the host's web UI (GitHub / GitLab / etc.) — no application needed. Comments and review can go through the host's existing review tools.
- **Components involved:** Manifest format choices (readable YAML + markdown).

## ◐ A new engineer joins the team

A new engineer clones the repository and needs to come up to speed without asking everyone in person.

- **What works today:** They inherit every plan, plan item, decision-as-Object, and the history of plan_events. The plan workspace's tree gives them a structural view of recent work.
- **What's target:** Repo-wide system documentation in `.codetrellis/docs/` — architecture overviews, runbooks, conventions — which is the kind of thing a new engineer most needs.
- **Components involved:** Manifest, plan workspace, system documentation extension.

## ◐ An audit asks "what was decided in the last quarter, and why?"

An internal review or external audit asks for a record of decisions made in a specific period.

- **What works today:** Decisions as Objects (or as comments on Actions) live in the manifest with author and timestamp. The plan_events timeline records structural mutations.
- **What's target:** Channel events as first-class manifest entries (today plan_events is DB-only); commit-level attribution carrying agent + model in trailers (today attribution is at record level); signed commits with the same attribution.
- **Components involved:** Manifest, plan-events, attribution, target git-level attribution.

## ○ A plan spans three repositories

A piece of work touches a frontend repository, a backend service, and an infrastructure repository.

- **What happens:** The plan lives in one home repository (typically the most-touched). Pointer files in the other repositories reference the home. The application stitches the view together when the user has multiple repositories cloned locally.
- **Status:** Target. Requires the scope field on plans, stable cross-repo identifiers, and `.codetrellis/external/` pointer files.
- **Components involved:** Cross-repo extensions, deployment shapes (home-and-link).

## ◐ An external contractor needs context to do their work

A contractor working in a fork needs to see the plan and contribute to it without access to the team's private working materials.

- **What works today:** Plan edits travel through pull requests like code. Comments and attachments inline in items merge through normal git flows. Contractors with read access see whatever they have access to.
- **What's target:** Pantry-reference placeholders for material they can't resolve, explicit promote-to-PR controls on contractor-side attachments.

## ○ An agent gets stuck mid-task

An agent is failing to make progress on a phase. Its loop detector trips, or the platform's stuck sensor fires.

- **What happens:** A `stuck` event is written to the plan's channel. Subscribers (the user, optionally other agents) are notified. A responder posts a `steer`. The exchange is recorded.
- **Status:** Target. Stuck sensor and channel events both extend the foundation. Drift detection (the analogous sensor for plan/code divergence) is already built.
- **Components involved:** Stuck sensor (target), channel extension (target), MCP integration paths.

## ○ A stuck agent is handed off to another model

A different model is better suited to the problem the stuck agent encountered. The user hands off.

- **What happens:** A `handing-off` event is written. The previous agent stops. A new agent (different model, different runtime, or a teammate's agent) is spawned with the channel record as its initial context — not the previous agent's bloated history.
- **Status:** Target. The atomic claim mechanism today enables the underlying multi-agent coordination; the channel handoff event vocabulary is the extension.
- **Components involved:** Channel extension, claim-with-handoff, integration paths.

## ◐ A decision needs to be revisited months later

Someone asks "why did we choose this approach?" about a part of the system that was built six months ago.

- **What works today:** Decisions as Objects in the manifest, with author, timestamp, and rationale, live in git history. The plan's structure at that commit is accessible by checking out the historical commit.
- **What's target:** Repo-wide system documentation gives the second axis — "how did we understand the system at that time" — alongside the plan-scoped decision record.

## ○ A team operates under a freeze period

Non-critical merges are paused for a defined period; only critical work proceeds.

- **What happens:** The application surfaces the freeze condition; plans not flagged critical are marked accordingly. Channel events continue to flow but the review surface highlights what falls inside the freeze.
- **Status:** Target. Requires per-project config (`.codetrellis/config.json`) for the freeze metadata and routing rules.

## ♦ The plan changes while work is in progress

A plan needs to be amended in flight because new constraints have been discovered.

- **What happens:** The plan is edited; the edit is committed via `update_item`. The plan_events timeline records the change with attribution. Drift sensors recalibrate against the new plan automatically. Agents picking up the work next see the update.
- **What's target:** Channel `weigh-in` event for proposing changes that need team input before committing.
- **Components involved:** plan-item-service, plan-events, drift sensors.
- **Level of adoption:** 2–6, depending on whether agents are involved.

## ○ A documentation entry has fallen out of date

The system documentation contains assertions about a subsystem that no longer match the code.

- **What happens:** The documentation sensor flags the divergence and emits a `need-decision` event proposing either a documentation update or a code change. A human reviews and chooses.
- **Status:** Target. Requires both the repo-wide documentation layer and the documentation sensor.

## ◐ A team adopts CodeTrellis incrementally

A team starts using CodeTrellis on one project, then extends it to others, then introduces an organisation-wide planning repository.

- **What works today:** A team can use CodeTrellis on a single repo with the in-repo manifest, with plans and items committed to git. Single-user works fully; small teams already get the planning workspace and shared plans.
- **What's target:** Multi-repo (home-and-link) and central-oversight deployment shapes, channel-based coordination across teammates.
- **Components involved:** Manifest, plan workspace, deployment shapes (target extensions).

## ♦ A user works alongside an agent doing a walkthrough

The user wants to understand how a subsystem works. An agent walks them through it — focusing the graph on the relevant nodes, opening files, narrating each step.

- **What happens:** The agent uses UI navigation tools (`graph_focus`, `select_item`, `open_plan`) while narrating in the Presence Pane (`present` with `speak=true`). The user follows along, asks questions via the reply input, sees TTS read out responses. This was demonstrated and works.
- **Components involved:** Presence Pane, UI tools, graph tools.
- **Level of adoption:** 4 (collaboration in front of one user).

## ○ An agent participates in a team meeting

Two teammates are discussing an architecture decision. The agent listens to the conversation (system audio + mic) and, when prompted, weighs in with what it sees in the graph and proposes a path.

- **What happens:** When invoked, the agent receives the recent audio buffer and the user's prompt via MCP, responds in the Presence Pane (TTS + walkthrough). Nothing about the meeting is recorded unless the team explicitly asks: "agent, capture that as a decision on the auth plan."
- **Status:** Target. Builds on today's Presence Pane and UI nav. Adds audio capture and routing to the user's AI subscription via MCP.
- **Level of adoption:** 7.

## ○ A developer responds to a stuck event from their phone

A developer is away from their desk; an agent posts a `stuck` event on a plan they're watching. The push notification surfaces on their phone; they open the mobile companion, read the event, post a `steer`. The agent resumes.

- **What happens:** Mobile sees the channel event via the streamed view from the paired desktop; the steer reply routes back through the same WebRTC connection. Off-LAN access uses whatever VPN the developer already has.
- **Status:** Target. Builds on the channel extension and the mobile companion.
- **Components involved:** Channel (target), mobile companion (target), pairing.
