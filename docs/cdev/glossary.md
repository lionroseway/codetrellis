# Glossary

Terms are marked ♦ (current implementation), ◐ (partial / extension), or ○ (target) where status matters.

**Action.** ♦ A V2 plan item with `kind: 'action'` — a graph-anchored work item carrying status, assignee, `fileSpecs`, `symbolSpecs`, connections, dependencies, skills, claim policy, execution config, and constraints. Contrast with Object.

**Agent type.** ♦ A string identifying an agent runtime — `claude-code`, `cursor`, `codex`, `aider`, `mcp-client`. Recorded in attribution and session registration.

**Attribution.** ♦ The structured identity recorded on every action in the manifest, comprising `author` (email or role string) and `authorType` (human or agent type). Rendered in the UI as `[person]'s [agent] ([model])`. Decisions and approvals are accountable to the named human; in channels, both humans and agents contribute substantively.

**Cascade mode.** ♦ How an inheritable property (skills, claim policy, execution config, constraints) flows from a parent plan item to a child. Values: `inherit`, `replace`, `none`.

**CDev (Continuous Development).** The category CodeTrellis defines: the layer above the dependency graph and below the agent runtime, making upstream development work continuous, observed, and recorded. The third leg of the CI/CD stack.

**Ceiling.** The collaboration surface — Presence Pane and (target) channels, stuck detection, handoffs. The layer of CodeTrellis where humans and agents act together.

**Channel.** ○ The peer-to-peer event log attached to each plan. Carries six event types: `stuck`, `need-decision`, `need-context`, `handing-off`, `steer`, `weigh-in`. Both humans and agents can post and respond. Target extension; today the seed is the DB-only `plan_events` table.

**Channel event.** ○ A single entry in a plan's channel. Has a type, an author (human or agent, with attribution), a timestamp, a structured payload, and references to relevant entities.

**Claim.** ♦ An atomic operation by which an agent (or human) takes ownership of an Action. Returns the full context bundle plus any file-overlap conflicts with other in-progress claims. The mechanism that prevents two agents from silently colliding on the same work.

**Context pressure.** The cognitive load that accumulates in an LLM agent's context as it runs — its own prior outputs, failed attempts, and partial state. Increases with time-on-task; degrades agent performance. The fundamental limit CodeTrellis is built to suppress.

**Dependency graph.** ♦ The live view of files, packages, classes, functions, and the cross-system coupling between them. Maintained by the application from the working tree via tree-sitter parsing and cross-system extractors.

**Deployment shape.** The organisation of the manifest across one or more repositories. Three shapes: **in-repo** (built today — single `.codetrellis/` in each project repo), **home-and-link** (○ — one repo is the plan home, others carry pointers), **central oversight** (○ — a dedicated planning repo).

**Deviation.** ♦ A drift detection result. Types: `missing_file`, `unexpected_file`, `missing_import`. Each has a severity (info / warning / error) and a resolution (pending / accepted / reverted / ignored). Live in the `deviations` table in the pantry today; not exported to the manifest.

**Drift.** ♦ Divergence between what a plan's Actions declare (`fileSpecs`, `symbolSpecs`, connections) and what the codebase actually contains. Detected on-demand via the 8 drift tools.

**fileSpec.** ♦ A declared file change on an Action — `{path, action: 'create'|'modify'|'delete'|'move', moveTo?, edits?}`. The unit drift detection compares against the live filesystem.

**Floor.** The durable state substrate — the manifest in git, attribution, the local pantry. Where everything important lives.

**Handing-off.** ○ A channel event in which an actor (human or agent) judges that another actor would do better. The recipient — another agent, a different model, a teammate's agent, or a human — inherits the channel record as context.

**Home repository.** In the home-and-link deployment shape, the repository where a cross-repo plan is canonically stored. Other repositories carry pointers.

**Levels of adoption.** The seven layers at which CodeTrellis can be used — visual observation (1), planning workspace (2), system documentation (3), agent collaboration (4), team and multi-device (5), programmatic agent integration (6), AI in collaboration (7). Each is independently useful; users adopt only what serves the current task.

**Manifest.** ♦ The collection of structured records under `<projectRoot>/.codetrellis/`: plans (`plans/<slug>/plan.yaml`), V2 plan items (`plans/<slug>/items/...`), V1 legacy `phases/`, `tasks/`, `docs/`, and binary attachments. The durable, shareable layer. Target extensions add channel events, repo-wide `docs/`, per-project `config.json`, and `external/` pointers.

**MCP (Model Context Protocol).** ♦ The standard protocol agents use to call CodeTrellis's tools. The protocol's design — agent calls platform, platform never calls agent — is what makes the integration vendor-friendly. CodeTrellis exposes 105 tools across 9 modules over an MCP server on port `19432`.

**Need-context.** ○ A channel event in which an actor (human or agent) has discovered something they don't know and would like additional context to proceed.

**Need-decision.** ○ A channel event in which an actor has hit a genuine choice they can't make alone. Decisions are human-accountable (per Principle 5).

**Object.** ♦ A V2 plan item with `kind: 'object'` — durable context (markdown body, references, attachments, comments). Used for specs, architecture notes, runbook fragments. Contrast with Action.

**Organising plane.** The position in the stack CDev defines and CodeTrellis occupies: the layer that observes, organises, and records what happens at the runtime and code layers, without performing AI work itself.

**Pantry.** ♦ The local sql.js database at `~/.codetrellis/data.db`, holding the bulky and ephemeral: full plan timelines, agent sessions, deviations, external refs, raw tool-call streams, scratch, personal continuity content. Stays local unless explicitly promoted.

**Personal continuity.** ◐ The optional set of artefacts (drafts, preferences, project history, search history) a user can carry across their own machines. Today: per-machine only. Target: optional personal sync.

**Personal store.** ○ The user-controlled location through which personal continuity is synced — a personal git repository, an existing sync service, or a built-in option provided by the application. Never shared with the team.

**Phase.** V1 plan concept: an ordered group of tasks under a plan. V2 absorbs phases into the unified Object/Action tree as Objects with `template: 'phase'`.

**Plan.** ♦ A manifest entity describing a piece of work. In V2, contains a tree of Objects and Actions. Identified by a UID; addressed on disk by a slug.

**Plan event.** ♦ An entry in the `plan_events` table recording a structural mutation (item created, status changed, claimed, etc.). The seed of the future channel event log. DB-only today.

**Plan item.** ♦ The generic V2 unit — either an Object or an Action. Items form a tree where Objects and Actions can parent either kind.

**Plan timeline.** ♦ A chronological view of plan events for a plan. Drives the activity drawer in the plan workspace.

**Pointer.** ○ A small file in `.codetrellis/external/` that refers to a plan hosted in another repository. Part of the home-and-link deployment shape.

**Presence Pane.** ♦ The floating overlay UI where agents narrate their actions to the user via markdown cards with optional TTS. Four MCP tools (`present`, `await_ack`, `await_user_input`, `dismiss_presence`). Ephemeral — cards are in-memory, max 50, not persisted.

**Product loop.** The three verbs that name what CodeTrellis does: plan, inspect, keep on track. Each suppresses context pressure at a different moment.

**Programmatic agent integration.** ♦ Level 6 of adoption — agents act on the planning surface through MCP tools (create plans, add items, post comments, claim work, query the graph). Available today via the plan-tools, plan-item-tools, and architecture-tools modules.

**Scope.** A field on a plan ○ listing the repositories the plan touches. Used in the home-and-link deployment shape to stitch a cross-repo view together. Target extension.

**Self-write guard.** ♦ A protection on the integrated terminal that blocks an agent from writing to its own host terminal session (the one running the agent). Detected via `CODETRELLIS_HOST_TERMINAL` env var declared at session registration. Prevents stdin-feedback loops.

**Sensor.** A component that observes the system and emits events when configured conditions are met. Three classes: **drift sensor** (♦ built, 8 tools), **stuck sensor** (○ target), **documentation sensor** (○ target).

**Session.** ♦ A registered agent connection. Captured in the `agent_sessions` table with `agent_type`, `model`, `capabilities`, `host_terminal_id`, `active_plan_uid`. Shown live in the ConnectedAgents widget.

**Skill flavor.** ♦ One of the six MCP resource variants the agent fetches on connect: `summary`, `quickstart`, `power-user`, `ui-nav`, `diagnostics`, `multi-agent`. Generated dynamically; the summary includes live project state.

**Spec.** A plan-scoped specification document. In V1, lives at `plans/<slug>/docs/`. In V2, modelled as an Object with markdown body and a `template` hint (`architecture`, `requirements`, etc.). Distinct from **system documentation** (○), which is repo-wide.

**Stable identifier.** ♦ The persistent UID attached to every manifest entity (plans, items, comments, attachments), independent of title, path, or location. Survives renames, moves, and migrations.

**Steer.** ○ A channel event in which an actor (human or agent) responds to a stuck or need-decision event with direction. Plain-English directive read by the recipient at its next pause.

**Stuck.** ○ A channel event indicating an actor has stopped making meaningful progress and would like help. Posted by an agent (self-reported or via the platform's stuck sensor) or by a human.

**symbolSpec.** ♦ A declared symbol change on an Action — `{name, kind, action: 'add'|'modify'|'remove'|'move', filePath?, signature?, moveTo?}`. The unit drift detection compares against parsed symbols in the codebase.

**System documentation.** ○ Repo-wide markdown documents in `.codetrellis/docs/` describing the system as it stands, distinct from plan-scoped specs. Maintained by humans and agents together. Target extension.

**Weigh-in.** ○ A channel event in which an actor (human or agent) shares thinking to invite perspectives — "here's my approach, what do others see?" The event type designed for architecturally-sound-decision-making conversations.

**Worktree.** A git mechanism that lets multiple branches be checked out simultaneously in separate directories. CodeTrellis recognises agents working in parallel worktrees as parallel work on the same plan, attributed independently.
