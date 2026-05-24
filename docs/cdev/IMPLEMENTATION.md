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

Status: ✅ Done (commit `b1cb535`).

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

Status: ✅ Done (commit `ffa8208`). Note: the Co-Authored-By trailer composes the possessive (`<human>'s <agent>`) from `settings.identity.displayName ?? settings.identity.email`, not from `git config` directly — so they can diverge if the user has edited settings. Identity auto-seeds from git on first project scan (Bugfix B).

- Compose commit messages with a `[cdev]` tag + descriptive subject.
- Append `Co-Authored-By: <agent name> <agent@cdev.example>` trailer when the application commits manifest changes on behalf of an agent.
- Human author = git config user; agent attribution lives in trailer + commit message tag.
- Works with signed commits (signature is on the human author).
- Tests covering: human-only commit, agent-attributed commit, signed commits.

Reference: [06 — Agent Identity and Attribution](06-agent-identity-and-attribution.md).

### 1.3 Channel events foundation

Status: ✅ Done (commit `f8d4713`). What shipped:

- `channel_events` table (`uid` PK, `plan_uid` FK, `item_uid` nullable, `event_type`, `payload` JSON, `author`, `author_type`, `agent_model`, `responds_to` FK, `status`, `created_at`, `updated_at`).
- MCP tools:
  - `post_channel_event(plan_uid, event_type, message, item_uid?, attempted?, options?, responds_to?)` — threading via `responds_to` (no separate `respond_to_event` convenience tool; the parameter does the job).
  - `list_channel_events(plan_uid, event_types?, status?, item_uid?, since_ms?, limit?, offset?)`.
  - `get_channel_thread(root_event_uid)` — root + all descendant responses, chronological.
  - `resolve_channel_event(event_uid)` and `dismiss_channel_event(event_uid)` — status changes.
- Manifest export: per-event YAML at `.codetrellis/plans/<slug>/channels/<event-uid>.yaml`, auto-written on post/status-change when the plan is shared.
- File-watcher import (channels files routed via plan-file-service watcher) and bulk import on `importPlan`.
- Tests deferred to phase 1.5.

Note: posting a `steer` does **not** auto-resolve the parent `stuck` — resolution is a separate `resolve_channel_event` call. Channel attribution is fixed by Bugfix A (uses the McpServer-bound sessionId, not the SDK's `extra`).

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

Goal: channels become useful in a real team environment. Two pillars: every event type postable from the UI, and notifications that reach teammates outside their CodeTrellis window.

### 2.1 Composer supports all 6 event types

Status: ✅ Done (commit `b6b12ed`).

Today the composer offers only `stuck` / `steer` / `weigh-in`. Add `need-decision`, `need-context`, `handing-off`. Each surfaces the type-specific payload fields that matter:

- `need-decision` — options[] (the alternatives the asker has identified).
- `need-context` — references (free-text or graph-anchor links).
- `handing-off` — attempted[] (mirrors stuck) + a reason field.

Item anchoring (`item_uid`) is still nice-to-have for any type. Add an optional plan-item picker to the composer.

### 2.2 Per-project channel routing rules

Status: ✅ Done (commit `916597e`). Note: rules match the event's **current** state, so a rule like `{ eventType: 'stuck' }` will re-fire on every status change. To fire only on initial post, include `status: 'open'` in the `when` clause; to fire only on resolution, use `status: 'resolved'`. Documented in the `ChannelRouteWhen` type.

Extend `ProjectConfig` with a `channels.routing` section: a list of rules of the form `{ when: {eventType?, status?, planUid?, itemUid?, minAgeMs?}, notify: {target, ...} }`. Targets supported in v1:

- `in-app-toast` — already broadcast as `channel-event-posted`; this just elevates urgency / changes tone.
- `webhook` — POST a small JSON payload to a user-configured URL.

Rule evaluation runs server-side whenever a channel event is posted (or when its age crosses a threshold for stale-event nudges).

### 2.3 Webhook notification dispatcher

Status: ✅ Done (commit `2083acf`).

Service that:
- Listens to `channel-event-posted` and `channel-event-status-changed`.
- Looks up routing rules from `getProjectConfig`.
- Fires matching webhooks (POST JSON, simple retry on 5xx, log failures).
- Also handles a stale-event timer for `minAgeMs` rules ("page if stuck >15 min").

In-app toast elevation is part of the same dispatch path; webhook delivery is the v1 external bridge. Push/email/Slack come later via webhook + the user's own service of choice (Zapier / Linear / Pipedream / etc.), so we don't need to ship per-vendor integrations.

### 2.4 Phase 2 demo + tests

Status: ✅ Done. E2E test at `tests/e2e/cdev-routing.test.ts` boots an in-process HTTP listener, configures a webhook routing rule, posts events through the real MCP wire format, and asserts the listener receives the right deliveries. Also covers rule filtering (disabled rules + status filters), wholesale routing replacement on update, and confirms no fire when the rule no longer matches.

End-to-end test:
1. Project with a routing rule "webhook on stuck events" pointed at a test HTTP listener.
2. Agent posts a stuck event.
3. Webhook receives the JSON payload within the test window.
4. Compose a need-decision from the UI (or via REST) with options[]; verify rendering and that the rule fires.

### Deferred from Phase 2

**Cross-machine peer-to-peer** (events broadcast directly between teammates' CodeTrellis instances on the same network) moves to Phase 5 alongside the mobile companion. Both share transport (WebRTC) and discovery (mDNS) infrastructure; building them once together is cheaper than twice apart. Git remains the primary sync path for channel events in Phase 2.

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

## Visual checks (deferred to packaged macOS build)

Screenshot capture in the dev server hangs (browser is not under our control); visual verification is deferred to the packaged macOS build where the in-app screenshot tool drives a known browser instance. This section accumulates items to step through once the built app is in hand. Each entry names the phase it came from so we can scan the whole list at once.

### Phase 2.1 — Composer expansion (all 6 types + item anchor)

- Composer shows two rows ("Ask" / "Offer") with three buttons each.
- All six types post cleanly; agent receives the event with the correct `event_type`.
- `stuck` and `handing-off` show an "attempted" textarea; one-per-line splits into the array.
- `need-decision` shows an "options" textarea; one-per-line splits into the array.
- Item anchor dropdown appears when plan items exist; choosing one sends `item_uid` and the event renders with the anchor on read-back.
- After post, the message + extra fields clear but the selected type + anchor persist (common to post several events of the same shape).
- Empty-state copy mentions all six types (no longer says "MVP surfaces three").

### Phase 2 polish (post-tester)

- Reply affordance offers a type picker (steer / weigh-in / handing-off / need-context); placeholder text and submission honour the choice.
- In-app-toast fallback title composes as `<eventType> · <author>` when the rule has no description (reads naturally; matches the "stuck · maria@x.com" form).
- `get_project_config` description now states explicitly that the effective surface only includes settings with a per-user counterpart; `channels.routing` is project-only and lives under `projectConfig.channels.routing`.
- Long-lived SSE sessions stay attributed: heartbeat now fires every 30s from the SSE connection itself (not just on tool calls). Agents that go quiet for minutes don't lose their `agent-type`/`model` attribution on the next post.

### Phase 1.4 — Channel UI panel

- Header **Channel** button toggles the drawer cleanly (open / close / re-open).
- Toggle state persists when switching between plans (or resets — confirm desired behaviour).
- Composer:
  - Three type tabs (stuck / steer / weigh-in) — selection state is visually clear.
  - Placeholder text changes with the active type.
  - ⌘+Enter posts; the button disables while posting.
- Posted event renders immediately, attributed to the user's email (from settings.identity).
- Agent-posted events (via MCP) appear without manual refresh; attribution shows `<human>'s <agent-type>` with model in parens.
- Threading:
  - Reply on an open root posts a steer indented under the root.
  - Indentation + left border make root vs response visually distinct.
- Status controls (✓ resolve, X dismiss) appear only on open root events.
- Status label tint matches the design (open amber, resolved emerald, dismissed muted).
- Drawer width is comfortable — content not overly squeezed.
- Drift banner, Activity drawer, and Channel drawer don't fight for space (Allotment behaves).

### Phase 1.1–1.3 (already validated functionally)

- ConnectedAgents widget: agents persist past 60s while making MCP calls (heartbeat).
- Activity feed surfaces `plan-created` with `exported: true|false` from create_plan.
- New shared-by-default plans appear in `.codetrellis/plans/<slug>/` without a manual export step.

---

## Notes and follow-ups

Things noticed during implementation that don't block but should be remembered.

### Bugfixes applied after first tester pass (2026-05-24)

The Phase 1.1-1.3 tester report surfaced four real bugs that landed before 1.4:

- **Bugfix B** — auto-seed `settings.identity` from `git config` on first project scan. Was unimplemented despite the docs promising it. Cascading effect on commit author + Co-Authored-By trailer + channel event author. Fixed in settings-service (`maybeSeedIdentityFromGit`) called from `scanProject`.
- **Bugfix A** — channel event attribution was always `human` because the SDK's `extra.sessionInfo.sessionId` and `extra.requestInfo.headers['mcp-session-id']` are both empty in our SSE setup. Fixed by binding the session id on the McpServer instance at connect time and threading it through `ToolDeps.sessionId`. All tools that previously fished for sessionId in `extra` now read `deps.sessionId`. The same fix corrects `inferAgentFromSession` (was picking the oldest active session, now matches by sessionId).
- **Bugfix C** — sessions went stale in 60s because no tool call refreshed `last_seen`. Fixed by heartbeating from the generic `registerTool` wrapper on every call. `register_session` is now idempotent because `deps.sessionId` is stable per connection (no more `mcp-<timestamp>` fallback duplicates).
- **Bugfix D** — `defaultVisibility` config setting had no effect on `create_plan` / `create_plan_from_template`. Fixed by reading `getEffectiveDefaultVisibility(project_path)` after plan creation and auto-calling `exportPlan` when the value is `shared`. Result is reflected in the tool response payload (`exported: true|false`).

Tool descriptions updated to match reality: `post_channel_event`'s `responds_to` no longer claims a steer resolves a stuck (resolution is separate); `commit_manifest_changes` now notes the Co-Authored-By possessive comes from settings, not git config.

`import_external` still creates plans with an empty `project_path` and so never auto-exports — acceptable for now since the tool is for "rough plan from a conversation" rather than committed manifest content. Worth revisiting if that use case grows.
