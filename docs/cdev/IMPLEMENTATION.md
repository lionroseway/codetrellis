# CDev Implementation Tracker

The architecture series in this folder describes the target. This document tracks the build-out from current foundation to that target — decisions made, phases of work, and current status.

Status markers used in this doc:
- ⬜ Not started
- 🟡 In progress
- ✅ Done
- ⏸ Paused / deferred

## Foundational decisions

Decisions that are hard to walk back. Record them here as they're made.

### D1 — Channel events live in their own table, not extending `plan_events`

**Decided:** 2026-05-24. **Status:** Locked in.

Channel events get a parallel `channel_events` table rather than extending `plan_events`. Rationale:

- **Different lifecycles.** `plan_events` is DB-only audit (structural mutations). Channel events are manifest-exported, durable team-coordination history.
- **Different consumer UX.** `plan_events` drives a timeline scrubber. Channel events drive a notification surface and a per-plan event panel.
- **Different access patterns.** `plan_events` is read in bulk for activity feeds. Channel events are read for "what needs my attention" — typed, filtered, often by recency.
- **Different schemas.** Channel events have a constrained vocabulary (6 event types), payload shape per type, and routing metadata. `plan_events` is wider and more generic.

Mixing them now means refactoring later. Separating them now is cheap.

The `checkpoint` concept (progress milestones) stays in `plan_events` — it's an internal progress signal, not an outbound request for help.

### D2 — Channel event vocabulary (6 types)

**Decided:** 2026-05-24. **Status:** Locked in (subject to refinement during implementation).

Six event types, all bidirectional (human or agent can post / respond):

| Event | Purpose |
|---|---|
| `stuck` | Failing repeatedly, need help |
| `need-decision` | Hit a genuine choice, can't make alone |
| `need-context` | Missing knowledge to proceed |
| `handing-off` | Another actor should take over; here's what was tried |
| `steer` | Direction in response to `stuck` or `need-decision` |
| `weigh-in` | "Here's my thinking, what do others see?" |

---

## Phase 1 — Foundation extensions

Goal: land the smallest set of changes that unlocks the team-collaboration story end-to-end. Result of this phase: per-project configurability, multi-user attribution that survives into git, and a working channel surface with three event types proving the peer-to-peer model.

### 1.1 Per-project config (`.codetrellis/config.json`)

Status: ⬜ Not started.

- New file at `<projectRoot>/.codetrellis/config.json`, committed to the manifest.
- Initial schema is small and grows as features land:
  - `plans.defaultVisibility` — override of the per-user default
  - `sharing.*` — per-artefact-type defaults (when per-item UX lands)
  - `channels.*` — routing rules (when channels land)
- Reader service with override resolution: per-item > per-project > per-user.
- File watcher integration so external edits (git pull) hot-reload.
- MCP tools: `get_project_config`, `update_project_config`.
- Tests covering precedence, missing file (falls through to per-user), malformed file (logs and ignores).

Reference: [14 — Configuration and Personal Continuity](14-configuration-and-personal-continuity.md).

### 1.2 Multi-user attribution at git commit level

Status: ⬜ Not started.

- Compose commit messages with a `[cdev]` tag + descriptive subject.
- Append `Co-Authored-By: <agent name> <agent@cdev.example>` trailer when the application commits manifest changes on behalf of an agent.
- Human author = git config user; agent attribution lives in trailer + commit message tag.
- Works with signed commits (signature is on the human author).
- Tests covering: human-only commit, agent-attributed commit, signed commits.

Reference: [06 — Agent Identity and Attribution](06-agent-identity-and-attribution.md).

### 1.3 Channel events foundation

Status: ⬜ Not started.

- New `channel_events` table:
  - `uid` (PK), `plan_uid` (FK), `item_uid` (FK, nullable), `event_type`, `payload` (JSON), `author`, `authorType`, `respondsTo` (FK, nullable), `createdAt`
- MCP tools:
  - `post_channel_event(plan_uid, item_uid?, event_type, payload, responds_to?)`
  - `list_channel_events(plan_uid, since?, types?, status?)`
  - `respond_to_event(event_uid, event_type, payload)` — convenience for steer/weigh-in responding to an existing event
- Manifest export pipeline: write events to `.codetrellis/plans/<slug>/channels/<event-uid>.yaml`.
- File-watcher import for events arriving via git pull.
- Tests covering: post + list, response threading, manifest round-trip, idempotent re-import.

Reference: [08 — Agent Collaboration: Presence and Channels](08-agent-collaboration.md), [02 — State Model](02-state-model.md).

### 1.4 Channel UI panel (MVP)

Status: ⬜ Not started.

- Panel on the plan workspace surfacing channel events for the current plan.
- Initial event types supported: `stuck`, `steer`, `weigh-in` — enough to prove the peer-to-peer model.
- Composer: select event type, write text, optionally anchor to a plan item.
- Threading: responses shown inline under the event they respond to.
- Live updates via the existing WebSocket broadcast.
- Attribution surfaced per event (human or agent + model).

Reference: [08 — Agent Collaboration](08-agent-collaboration.md).

### 1.5 Phase 1 demo

Status: ⬜ Not started.

When 1.1–1.4 land, the demo flow:
1. Two users with the same project (or one user with two terminals).
2. User A's agent posts a `stuck` event.
3. User B sees it (via pull or live update), posts a `steer`.
4. Channel event log committed to git via the manifest pipeline.
5. Attribution carries into the commit message.

This is the moment Phase 1 ships.

---

## Phase 2 — Channels in full

Goal: complete the channel surface for team collaboration.

- All 6 event types (`need-decision`, `need-context`, `handing-off` added).
- Routing rules driven by per-project config (e.g., "page Maria if a plan is stuck >15 min").
- External bridges (email / push / Slack via webhook) for off-app notifications.
- Cross-machine peer-to-peer: events post locally, sync via git, but also via direct broadcast when teammates are co-present on a network.

## Phase 3 — Cross-repo and system documentation

Goal: support multi-repo team work and repo-wide system documentation.

- Plan `scope` field + stable cross-repo identifiers.
- `.codetrellis/external/<plan-id>.json` pointer files.
- Stitched cross-repo view when multiple repos cloned locally.
- Central-oversight deployment shape (dedicated planning repo).
- `.codetrellis/docs/` layer for repo-wide system documentation.
- Per-item sharing UX (override `defaultVisibility` per artefact).

## Phase 4 — Sensors

Goal: complete the intervention surface.

- Stuck sensor with configurable heuristics per project.
- Documentation sensor with verified-state assertions.
- Sensitivity config in `.codetrellis/config.json`.

## Phase 5 — AI in collaboration (Level 7)

Goal: meeting-aware AI presence + mobile companion.

- Audio capture pipeline (mic + system audio loopback).
- Routing audio to user's AI runtime via MCP.
- Push-to-talk invocation.
- Mobile companion as streamed view of desktop (P2P, QR + bidirectional pairing, AirPlay-like discovery, port tunnel, off-LAN via user's VPN).

---

## Notes and follow-ups

Things noticed during implementation that don't block but should be remembered.

(empty)
