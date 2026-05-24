# Agent Collaboration: Presence and Channels

This document describes the surface where humans and agents work together — the runtime layer that makes CodeTrellis structurally different from a planning tool. Two surfaces play complementary roles:

| Surface | Purpose | Status |
|---|---|---|
| **Presence Pane** | Moment-by-moment narration when an agent is acting in the UI, with TTS and a text reply box | Built today |
| **Channels** | Durable peer-to-peer event log per plan, for team coordination across time, machines, and teammates | Target extension |

They are not in tension. The Presence Pane gives the user real-time context while an agent is doing something in front of them. Channels give a team a durable surface for asking for help, weighing in on decisions, and handing off work — and they outlive any single session.

Both surfaces are optional. A team using CodeTrellis only as a planning workspace can ignore them. The surfaces become valuable when agents are doing work significant enough that supervision through direct observation alone becomes mentally taxing, or when multiple humans and agents need to coordinate.

## The Presence Pane (today)

When an agent is navigating the application — focusing on a node in the graph, opening a plan item, taking a screenshot, walking the user through a subsystem — the user needs context for *why*. The Presence Pane is the agent's narration channel for those moments.

It is a floating overlay anchored bottom-left by default, draggable to wherever the user prefers. As the agent acts, it posts narration cards with optional TTS, optional acknowledgment requirement, and tonal colouring (neutral, success, warning, question). Cards can anchor visually to specific graph nodes or plan items.

Four MCP tools drive it:

| Tool | Purpose |
|---|---|
| `present` | Post a narration card. Optional `speak=true` reads it aloud via the user's system TTS. Optional `require_ack=true` requires the user to click "Got it" or wait for speech-end |
| `await_ack` | Block until the user acknowledges a card (click or speech-end). Used to pace walkthroughs |
| `await_user_input` | Block until the user types a reply in the pane. Used when the agent needs a quick text answer mid-flow |
| `dismiss_presence` | Close the pane and clear all cards |

Cards are deliberately **ephemeral** — held in memory, capped at 50, not persisted. The Presence Pane is for the moment; the durable record of what happened lives in the plan and (when channels land) in the channel event log. Walkthroughs you'd want to keep, you capture as a comment or attachment on the plan item.

The same surface handles AI-led walkthroughs: an agent uses the [UI navigation tools](10-integration-model.md) to focus the graph, open relevant items, and highlight files, while narrating each move in the Presence Pane. The audience watches the screen-share or the synced view and follows along.

## Multi-agent coordination today

Today's foundation for multiple agents working a plan together rests on three pieces, all built:

- **Terminals with agent presets.** The integrated terminal can spawn sub-shells with one-click presets (`shell`, `claude`, `codex`, `aider`) that auto-launch the chosen agent. Up to 20 concurrent terminals, each with its own session.
- **Atomic claim.** `claim_item` is an atomic operation that prevents two agents from silently working the same Action. It also returns file-overlap conflict detection — if another in-progress claim touches the same files, the claim surfaces the conflict for resolution.
- **ConnectedAgents widget.** The TopBar shows live MCP sessions with agent type, model, and last-heartbeat. Clicking opens a popover with each session's active plan; users can switch to any plan from there.

These cover the "two agents claim different items in the same plan" case cleanly. What they don't cover yet is what happens when those agents need to *talk to each other* or *get help* — that's where channels come in.

## Channels (target extension)

A channel is the durable peer-to-peer event surface attached to a plan. Both humans and agents can post events on it, and both can respond.

The channel is not a chatroom. It is a structured event log with a tight vocabulary, written to the manifest like everything else, and routed to whoever might usefully respond — humans on different machines, other agents on different models, the team's reviewers.

Today's `plan_events` table is the seed of this surface — it already captures structural mutations (item created, status changed, claimed). The target extension is to add the team-coordination event types, export channel events as first-class manifest content, and route them across teammates.

### Event vocabulary

The channel carries six event types, all bidirectional — humans and agents can both post and respond:

| Event | What it means | Who emits | Who responds |
|---|---|---|---|
| `stuck` | I'm failing repeatedly and need help | Human or agent | A human, or another agent with fresh context |
| `need-decision` | I've hit a genuine choice I can't make alone | Human or agent | A human (decisions are human-accountable) |
| `need-context` | I'm missing knowledge I'd need to proceed well | Human or agent | A human, another agent, or a documentation source |
| `handing-off` | I judge another actor would do better; here's what I tried | Human or agent | Whoever takes over inherits the channel record as context |
| `steer` | Here's direction in response to a stuck or need-decision | Human or agent | The actor it's directed at, on next pause |
| `weigh-in` | Here's what I'm thinking — what do others see? | Human or agent | Anyone with a relevant perspective |

`weigh-in` is the architectural-decision event: a way to test thinking aloud and invite perspectives without blocking work or asking for an explicit decision. Channels are where teams arrive at architecturally sound decisions together; `weigh-in` is the move that makes that explicit.

Each event carries: type, author (with full attribution including model), timestamp, structured payload, and references to relevant entities (commits touched, tests run, tools attempted, files modified, items linked).

(Progress milestones — `checkpoint`-style events — live in the plan timeline, not the channel. The channel is for outbound requests for help, perspective, or coordination. Internal progress tracking lives elsewhere.)

### Channels as context compressor

The key property of the channel is that **its messages are deliberately lean**. When an agent gets stuck and another agent (or a human, or a different model) takes over, the new actor doesn't inherit the stuck actor's bloated history. They inherit the channel record — what was attempted, what failed, what is known — which is the minimum viable context for fresh progress.

The channel is therefore not a place where context accumulates. It is the mechanism by which context pressure is compressed and handed off cleanly.

## Stuck detection (target)

An agent reports stuck through one of two paths. The detail of how detection works lives in [09 — Sensors and Detection](09-sensors-and-detection.md); the summary is:

### Self-reported

The agent itself calls a tool when its own loop detector judges the work has stalled. This is the preferred path — the agent has the most information about its own state, and self-reporting is a sign of a well-behaved citizen.

### Externally detected

The platform watches the tool-call stream for patterns that indicate stuck-ness. When detected externally, the platform posts a `stuck` event to the channel on the agent's behalf and pauses the agent at its next natural break.

Both paths produce identical channel events. The downstream UX doesn't care which path triggered the event.

Humans report stuck the same way — by posting to the channel. There's no separate "human stuck" mechanism; the channel is symmetric.

## In-flight steering

When someone responds to a `stuck` or `need-decision` event, they post a `steer` to the channel. The steer is a plain-English directive — the responder's intent, expressed as they would explain it to a colleague.

If the recipient is an agent, the application delivers the steer through whichever integration path the agent uses (described in the [Integration Model](10-integration-model.md)). The agent reads the steer at its next natural pause point and incorporates it into its next move.

If the recipient is a human, the steer surfaces in their notifications and in the channel UI.

Activity flows again. The channel records both the original ask and the response, attributed to whoever provided each.

## Handoff between actors

When someone posts a `handing-off` event, the work transfers to whoever takes over. The new actor can be:

- The same model on a clean session
- A different model the user has access to (a larger model for a hard problem, a faster model for routine work)
- An entirely different runtime (one client for backend tasks, another for frontend)
- A human teammate (when an agent has reached the limits of what it can usefully do)
- An agent acting on behalf of a different teammate (when one teammate's expertise is more relevant)

The new actor receives the channel record as initial context — not the previous actor's history. This is the central mechanism by which context pressure is suppressed across actor boundaries, whether those boundaries are between two agents or between an agent and a human.

The handoff is explicit: the previous actor is told they're done; the new actor is told they're up. Because the manifest captures progress throughout the work (in the plan timeline), no progress is lost when an actor exits.

## Parallel work and the same plan

A single task is frequently broken up into pieces that several agents work on in parallel — typically each in its own git worktree, with the results merged through a pull request. All of these agents are updating the same plan from different points.

The atomic claim ensures the agents don't collide on the same item. The channel (when extensions land) records each one's progress, stuck events, steers, and weigh-ins independently. When a human looks at the plan, they see who is doing what — each contributor named and attributed — and the channel surfaces any requests for help across the parallel work.

## Why this is not a chatroom

Multi-agent platforms exist that let agents converse freely with each other. CodeTrellis deliberately does not provide that, for two reasons:

1. **Free conversation adds context pressure.** Every agent must now attend to a chatroom on top of its own work. The cure becomes a new symptom of the disease.
2. **Free conversation produces low-signal history.** Lengthy agent-to-agent chat is hard to audit, hard to review, and rarely contains the durable record of a decision.

The channel's tight vocabulary and event-driven design are not constraints; they are the source of its value. Events represent moments that matter. The discipline of a small protocol is what makes the channel useful as both an intervention surface and a durable record.

The Presence Pane is similarly disciplined — narration cards exist for the moment of action, not as a chat history. When something is worth keeping, it gets promoted to a comment or attachment on the plan item.

## Equal contributors, asymmetric accountability

In a channel, humans and agents are peers in their *contribution*. An agent that can read the dependency graph and weigh in on an architecture decision is contributing substantively; a human who provides a steer is contributing substantively; both responses are first-class.

But the *accountability* for what ships is always with a named human. Agents act as a specific person's tool; that person is responsible for the work that lands. Asymmetry is in accountability, not in contribution. This frame is what makes channels safe to use — agents can engage as substantively as humans without changing who is answerable for the result.

## Not autonomous; deliberately

CodeTrellis does not auto-inject prompts into running agents, does not auto-hand-off without human sign-off where the work matters, and does not automate anything that crosses a human checkpoint by default. Every meaningful steer is a deliberate action with an audit record.

This is a design choice, not an engineering limitation. In environments where traceable intent matters — most professional development contexts — explicit checkpoints are an asset, not a friction. Routing rules and lightweight automation can be layered on for teams that want them (for example, "ping me if a plan has been stuck for fifteen minutes"), but the default is human-in-the-loop because the default user benefits from human-in-the-loop.
