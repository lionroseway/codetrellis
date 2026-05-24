# Agent Identity and Attribution

Every action in CodeTrellis — whether taken by a human directly or by an agent acting on a human's behalf — is attributed to a specific person and, where applicable, the specific tool they used. This document describes how identity is represented today, how attribution flows into git, and where the model extends as multi-user team workflows come into scope.

## The principle

Humans are first-class actors. Agents are their tools.

This is not a presentational detail. It shapes how plans are reviewed, how decisions are audited, how disputes are resolved, and how trust accumulates between teammates. An agent is never the responsible party; the person running the agent is.

In a [channel](08-agent-collaboration.md), agents can offer help, weigh in on decisions, and contribute substantively alongside humans — the contribution is peer. But the *accountability* always returns to a named human. Asymmetry is in accountability, not in contribution.

## The attribution format

Every record in the system — plan items, comments, attachments, plan events, channel events — carries two attribution fields:

- **`author`** — the responsible person's identity. Today this is an email address (seeded from `git config user.email` at first run) or a legacy role string (`human`, an agent-type) for records created before identity was set.
- **`authorType`** — `human` for direct action, or an agent type (`claude-code`, `cursor`, `codex`, `aider`, `mcp-client`) when an agent acted on a person's behalf.

When the UI renders attribution, it composes these into a human-readable string of the form:

```
[person]'s [agent] ([model])
```

For example: `Maria's Claude Code (Opus 4)`. When the action was taken directly by a person, the agent and model slots are omitted — just the person's name.

Behind the scenes, the structured fields drive filtering, search, and audit; the rendered string is for the reader's benefit.

## Session identity

When an agent connects over MCP, it can identify itself by calling `register_session` (`session-tools.ts`). The session registration captures:

| Field | Purpose |
|---|---|
| `agent_type` | `claude-code`, `cursor`, `codex`, `aider`, `mcp-client`, or similar |
| `model` | The specific model in use (e.g., `claude-opus-4`) |
| `capabilities` | Array of `{name, source}` declaring MCP tools, languages, and skills the agent has access to |
| `host_terminal_id` | If the agent is running inside a CodeTrellis-hosted terminal, this enables self-write protection |

Session registration is declarative — the agent tells CodeTrellis who it is, on the user's behalf. Sessions appear in the ConnectedAgents widget in the TopBar with their type, model, and last-heartbeat timestamp.

For Claude Code specifically, an `setup_agent_permissions` tool writes `.claude/settings.local.json` to auto-approve CodeTrellis MCP tools, so the user is not prompted on every action.

## How attribution rides on git (target)

The current implementation captures author identity at the record level. The target extension is to carry that attribution onto the git commits themselves, so that the manifest's history in `git log` is as legible as the in-app activity feed.

The intended convention: the **human** is the commit author, and the **agent** is recorded as a co-author trailer plus a commit-message tag identifying the runtime and model.

A representative target commit:

```
[cdev] phase-2 complete · agent: claude-code · model: opus-4

Co-Authored-By: Maria's Claude Code <agent@cdev.example>
```

The human is the author for blame, accountability, and notification purposes. The agent attribution is preserved for audit, learning, and debugging.

Signed commits work normally: the human signs, the signature verifies their identity, the agent attribution is data within the commit. This is sufficient for environments where cryptographic attribution is required.

## Why this matters

Strong, mandatory attribution produces a small number of properties that the rest of the architecture depends on:

| Property | Why it matters |
|---|---|
| Every action has a named human | Audit trails are sound; "the system did it" is never a legitimate answer |
| Agents are visibly tools | Reviewers know what kind of action they are looking at — direct human work, agent work with human direction, or routine agent execution |
| Mixed runtimes are legible | A plan worked by one person's tool A and another person's tool B is presented as one piece of work with two responsible humans, not as undifferentiated activity |
| Sign-off is unambiguous | A steer, an approval, or a decision is attributable to the specific person who provided it |
| AI accountability through presence | When agents are co-authors with named humans, every line of agent-written code is visibly someone's responsibility |

## Parallel work and attribution

A single task is frequently broken up into pieces that several agents work on in parallel — typically each in its own git worktree, with the results merged through a pull request. Each parallel piece is attributed to its responsible human; the merged result shows multiple humans as contributors.

The plan UI surfaces this clearly: when several agents are active on the same plan (visible via the ConnectedAgents widget and on the plan workspace), the user sees each contributor with their attribution. The plan does not collapse parallel work into "agents are doing things" — it presents who, with what tool, on what phase.

The atomic `claim_item` tool ensures that two agents do not silently work the same item. Claims include file-overlap conflict detection so that conflicting in-progress work surfaces before it merges.

## Identity sources

CodeTrellis uses the identity sources the user already has:

- **Git config** — `user.email` and `user.name` from the project's git configuration. Read at startup and used to seed the application's identity.
- **Application settings** — `identity.email` and `identity.displayName` in `settings.json` under `~/.codetrellis/`. The user can override the git-seeded value here.
- **Session registration** — the agent's declared `agent_type` and `model` for the duration of the MCP connection.

These sources are reconciled into a single canonical person identity. **No new identity provider is required.** If the user does not have an email set, the application falls back to a generic role string (`human`) until they set one.

## Multi-user attribution (target)

Today's identity model works for a single user on one or many machines. As team workflows land, additional concerns come into scope:

- **Cross-teammate attribution.** When teammate A pulls in commits from teammate B, the manifest already carries B's `author` field on every record. The UI surfaces who did what across the team. Git author + signed commits provide the cryptographic anchor.
- **Agent-to-human resolution.** When agent activity is attributed to teammate A, but teammate B wants to interact with the same agent session (e.g., respond to a channel event), the system needs to know which human is currently "behind" that agent. Session ownership becomes a multi-user concern.
- **Audit across the team.** Aggregated reports — "what did each teammate commit this week, with which agents and models" — become first-class views once attribution flows into git commits.

None of this requires changing the underlying identity model. The fields are already in place; what's added is the team-facing presentation, the commit-level attribution, and the cross-teammate resolution logic.
