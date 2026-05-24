# CDev: Continuous Development

This series describes the architecture and design principles behind CodeTrellis as a CDev (Continuous Development) platform.

## What CDev is

CDev is the missing third layer of the CI/CD stack. Where Continuous Integration made *integration* continuous and Continuous Deployment made *deployment* continuous, CDev makes the work *upstream* of those continuous too — planning, agent execution, decisions, system understanding.

CodeTrellis is a CDev platform. Its thesis: agentic coding is fundamentally limited by an LLM's ability to suppress context pressure. CodeTrellis suppresses that pressure, on behalf of any agent runtime.

## How to read this series

The series describes the target architecture for a team-capable CodeTrellis. The single-user foundation is built and works today; the team workflows, channels, system documentation, audio-aware AI presence, and mobile companion are the extensions we are growing toward.

Where it matters, individual sections mark what's available today (♦), partially built (◐), or target (○). The boundary stays constant throughout: CodeTrellis is the observability and organisation plane for AI-collaborative development, leaning on the AI subscriptions, git providers, and infrastructure the user already has. We don't host inference. We don't run network relays. We don't trigger security reviews.

The series is in three parts. **The foundation must be in place before the collaboration layer can stand on it.** Reference material rounds out the series.

### Part 1 — Foundation

State, storage, attribution, and team collaboration. The substrate that makes everything else durable, shareable, and auditable.

- [01 — Overview and Principles](01-overview.md)
- [02 — State Model: Manifest and Pantry](02-state-model.md)
- [03 — Deployment Shapes](03-deployment-shapes.md)
- [04 — Multi-Device Continuity and Team Collaboration](04-multi-device-and-teams.md)
- [05 — Cross-Repo Work and External Contributors](05-cross-repo-and-external-contributors.md)
- [06 — Agent Identity and Attribution](06-agent-identity-and-attribution.md)
- [07 — System Documentation](07-system-documentation.md)

### Part 2 — Agent Collaboration

The differentiated value layer. Presence Pane today, channels and stuck detection as target extensions, integration paths that compose with the user's existing tools.

- [08 — Agent Collaboration: Presence and Channels](08-agent-collaboration.md)
- [09 — Sensors and Detection](09-sensors-and-detection.md)
- [10 — Integration Model](10-integration-model.md)
- [15 — AI in Collaboration](15-ai-in-collaboration.md)

### Part 3 — Reference

Cross-cutting principles, architecture overview, concrete scenarios, definitions, and the mobile companion specification.

- [11 — Principles](11-principles.md)
- [12 — Architecture Layers](12-architecture-layers.md)
- [13 — Use Cases](13-use-cases.md)
- [14 — Configuration and Personal Continuity](14-configuration-and-personal-continuity.md)
- [16 — Mobile Companion](16-mobile-companion.md)
- [Glossary](glossary.md)

## Core principles

These principles cut across the entire series. If a feature does not reinforce one of them, it does not belong in CodeTrellis. They are expanded with examples in [11 — Principles](11-principles.md).

1. **CodeTrellis is an organising plane, not an AI runtime.** It does not host inference, store agent memory, or provide agent-to-agent chat as a primary medium.
2. **State lives in the user's git, not in CodeTrellis's walls.** Every durable record is a file in the user's repository, mergeable through normal git flows.
3. **Customers bring their own AI subscriptions.** CodeTrellis does not resell inference, mark up tokens, or sit between the user and their model provider.
4. **The product reduces context pressure at every layer.** Plans externalise intent, channels externalise stuck-ness, decisions externalise rationale, system documentation externalises codebase knowledge.
5. **Humans are first-class actors; agents are their tools — accountability is asymmetric, contribution is peer.** Every action carries a human's identity and decisions return to a named human; in channels, both humans and agents contribute substantively.
6. **Adopt only what serves you.** Every layer of CodeTrellis is independently useful — graph viewing, planning, system documentation, agent collaboration, team collaboration, programmatic agent integration, AI in collaboration. Users start at the level that fits their current task and move up or down as the work demands. See [Levels of Adoption](01-overview.md#levels-of-adoption).
