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

## Phase 3 — Cross-repo, system documentation, per-item sharing

Goal: make CodeTrellis useful for work that spans multiple repos, give teams a real in-app home for documentation that outlives any single plan, and let users keep big plans lean by sharing item-by-item.

Decisions locked with the user before build:

1. Repos identified by **git origin URL** (everyone's clone shares it). Per-device **alias** stored in the local DB only — never in the repo (would conflict between teammates).
2. Pointer files carry enough context for a stranger browsing the repo to understand what the plan is about: title, status, one-line summary, this repo's contribution, home repo, cached-against timestamp.
3. Editing a plan from a sibling repo writes back to the home repo's data.
4. System docs are an **in-app rich experience** (navigation tree, search, embedded graph refs, slick layout). Stored on disk as YAML + markdown in `.codetrellis/docs/` so they still travel via git and read on GitHub.
5. Doc staleness has **three levels**: current / behind HEAD / files-actually-changed. v1 surfaces the indicator; agent-proposed rewrites land in Phase 4.
6. Per-item sharing: a child item inherits its parent's visibility by default. A child can **override** ("I'm shared even though my parent is local") for the legitimate exceptions; on export the overridden child is re-anchored to its **nearest exported ancestor** (the closest ancestor whose effective visibility is `shared`), falling back to top-level when no such ancestor exists. This keeps related content close on disk instead of randomly hoisting overrides to root.
7. Items default to shared inside a shared plan. Users opt individual items into local.

### 3.1 Repo identifiers + per-device aliases

Status: ⬜ Not started.

Capture the project's git origin URL at scan time. Store it normalised (strip `.git`, lowercase host, prefer `https://`). Persist a per-device alias the user can edit — local only, never in the manifest. New MCP tools: `set_repo_alias`, `get_repo_identity`.

### 3.2 Per-item sharing

Status: ⬜ Not started.

Add a `visibility` column to plan items (`shared` | `local`, default `shared`). Add an `overrideParentVisibility` flag for the exception case. Export pipeline filters out local items. UI toggle on each item. Document the parent-dominance rule + the override exception. Goal: keep commits lean as plans scale up.

### 3.3 Plan scope + pointer files

Status: ✅ Done. What shipped:

- Plans gain `homeRepo` (auto-set at `create_plan` from the project's normalised origin URL) and `scope: string[]` (other repo URLs the plan touches). Both round-trip through `plan.yaml`.
- `home_repo` + `scope` migrations on the `plans` table with `idx_plans_home_repo` for fast cross-repo lookups.
- `setPlanHomeRepo`, `addPlanScope`, `removePlanScope`, `listPlansByRepoUrl` on the plan service — all normalise their inputs via `normaliseRepoUrl` so ssh / https / `.git`-suffixed variants collapse to the same identity.
- New service `external-pointer-service.ts` for pointer-file CRUD: `writePointer`, `removePointer`, `readPointer`, `discoverPointers`, `isPointerFile`, `startPointerWatcher` / `stopPointerWatcher`. Pointers live at `<projectRoot>/.codetrellis/external/<plan-uid>.yaml` and cache `{ planUid, homeRepo, title, status, summary, contribution, cachedAt }`. Self-write stamping is shared with the rest of the file-emitting services.
- File-watcher integration: a per-project chokidar watcher on `.codetrellis/external/` (depth 0) broadcasts `external-pointers-changed` on add / change / unlink. Wired into both `scanProject` and the boot-time `rearmProjectWatchers` pass.
- MCP tools: `set_plan_home_repo`, `add_plan_scope`, `remove_plan_scope`, `list_plan_pointers`, `list_plans_by_repo`. `add_plan_scope` optionally writes the pointer file into a local clone of the scoped repo when `pointer_project_root` is supplied.
- E2E coverage in `tests/e2e/cdev-cross-repo.test.ts` — full round-trip through real MCP wire format: configure origin, create plan, add scope (writes pointer YAML), list pointers from scoped side, query by both home and scoped URL, export plan and confirm `plan.yaml` carries `homeRepo` + sorted `scope`, remove scope (deletes pointer).

### 3.4 System documentation (in-app area)

Status: ✅ Done. What shipped:

- `system_docs` table (uid PK, project_path + slug unique, references as JSON, capturedAgainstCommit, lastVerifiedAt). On-disk source of truth at `<project>/.codetrellis/docs/<slug>.md` with YAML frontmatter — round-trips through git.
- `system-docs-service.ts` with full CRUD: `listSystemDocs`, `searchSystemDocs`, `getSystemDoc`, `getSystemDocBySlug`, `createSystemDoc`, `updateSystemDoc`, `deleteSystemDoc`, `verifySystemDoc`, `getFreshness`, `indexProjectDocs`, plus the file watcher.
- Freshness model: `current` (captured commit == HEAD or unverified), `moved` (HEAD past stamp but no referenced file diffs), `stale` (HEAD past stamp AND a referenced file diffs). Drives the badge colours.
- File watcher (chokidar, depth 0) at `.codetrellis/docs/` — external edits import; missing UIDs are auto-stamped and the file rewritten so it round-trips stably from then on. Wired into both `scanProject` and the boot-time rearm pass alongside the other Phase 3 watchers.
- MCP tools: `list_system_docs`, `read_system_doc`, `write_system_doc` (create or update by uid), `delete_system_doc`, `verify_system_doc`, `check_doc_freshness`.
- REST surface at `/api/system-docs` for the frontend (list / read / create / update / delete / verify / freshness).
- Frontend store `system-docs-store.ts` mirrors the index and caches full bodies on selection; WS handlers refresh on `system-doc-changed`, `-created`, `-updated`, `-verified`, `-removed`.
- New workspace mode `'docs'` (in `WorkspaceMode`) renders `SystemDocsPanel` as a full takeover. Two-pane layout: left rail with search + per-doc freshness dots, right pane with `Markdown` renderer and edit / verify / refresh / delete affordances.
- TopBar `DocsToggle` chip (BookOpen icon) toggles the surface; only visible when a project is open.
- E2E coverage at `tests/e2e/cdev-system-docs.test.ts` — write doc via MCP, verify (stamps HEAD), drift a referenced file with a commit, confirm `check_doc_freshness` returns 'stale' with the changed file listed; hand-craft an external `.md` without a uid → watcher imports + rewrites with a uid; delete via MCP removes the file.

### 3.5 Cross-repo stitched view UI

Status: ✅ Done. What shipped:

- New REST endpoint `/api/plans/stitched?project=<path>` returns the project's local plans alongside its external pointers, with each pointer pre-resolved against the user's `recent_projects` DB (matches by normalised origin URL).
- `CrossRepoSection` component sits beneath the local plan list; only renders when at least one pointer exists. Resolved pointers expose an "Open" button that switches to (or creates) a tab for the home repo. Unresolved pointers expose a "Not cloned" affordance that copies a `git clone <url>` command to the clipboard.
- Live updates: the component listens for `external-pointers-changed` and `plan-scope-changed` DOM events; the WS hook broadcasts these whenever the file watcher or an MCP scope mutation fires, so a teammate-driven `git pull` populates the section without a refresh.
- E2E coverage at `tests/e2e/cdev-stitched-view.test.ts` boots two repos (home + scoped), creates a plan in home, scopes it to the scoped repo, hits the stitched endpoint from the scoped side and confirms the pointer is resolved → then drops the home repo from recent_projects and confirms the pointer flips to unresolved. The pointer file on disk stays put through both states.

### 3.6 Central-oversight deployment shape

Status: ✅ Done. What shipped:

- Confirmed: the central-oversight shape works on the existing Phase 3.3 (scope + pointer files) + 3.5 (stitched view) machinery with no special-case backend code. The hub is a normal CodeTrellis project; the spokes are normal CodeTrellis projects with pointer files.
- New `ProjectRepoRole` ('planning' | 'code' | 'mixed') hint in `ProjectConfig`. Parsed + round-trips through `.codetrellis/config.json`. Patchable via `updateProjectConfig` (with `delete` semantics when set to undefined). MCP tool `update_project_config` accepts the new field.
- REST endpoint `GET /api/project-config?project=<path>` exposes the parsed config to the frontend.
- Frontend uses the hint to soften the empty-state copy in `PlanList`: code repos that declare `repoRole: "code"` see a "plans live in another repo" message instead of the default "create your first plan" CTA. The hint is purely advisory — nothing is gated on it.
- Worked example with real commands added to [03-deployment-shapes.md §Shape 3](03-deployment-shapes.md) covering setup (planning repo + code repos), commit/push flow, permission model, and why no special-case transport is needed.
- E2E coverage at `tests/e2e/cdev-central-oversight.test.ts` boots a planning repo + a code repo, sets `repoRole` on both via MCP, creates a plan in the planning repo, scopes it into the code repo's `.codetrellis/external/`, and confirms the stitched view from the code-repo side resolves the pointer back to the planning repo. Also verifies both `repoRole` values round-trip through both the on-disk config file and the new REST endpoint.

### 3.7 Phase 3 demo + tests

Status: ✅ Done. The Phase 3 suite is now eight green E2E tests, all running via the real MCP wire format and a real backend process per test:

| Test file | Covers |
|---|---|
| `cdev-cross-repo.test.ts` (3.3) | Scope add/remove + pointer file round-trip through git |
| `cdev-system-docs.test.ts` (3.4) | Docs create/verify/freshness/external-import/delete |
| `cdev-stitched-view.test.ts` (3.5) | Stitched API: pointer resolves when home repo cloned; flips unresolved on removal |
| `cdev-central-oversight.test.ts` (3.6) | Planning + code repos, repoRole round-trip, stitched view from code side |
| `cdev-phase3-demo.test.ts` (3.7) | Per-item sharing: local items excluded from export AND teammate import; override re-anchors shared child to its nearest exported ancestor (top-level when none exists) |
| `cdev-channels.test.ts` (1.x) | Phase 1 channels flow (still green) |
| `cdev-routing.test.ts` (2.x) | Phase 2 routing dispatcher (still green) |
| (smoke + unrelated suites) | Confirmed no regressions in adjacent code paths |

What this proves end-to-end: a plan authored in repo A (homeRepo captured), scoped to repo B (pointer landing in B's `.codetrellis/external/`), with a mix of shared and local items + a `local` parent shielding inheriting children + an override child re-anchored to its nearest exported ancestor, exporting cleanly, with the stitched view in B resolving back to A when A is locally available, and with the system-docs surface sitting alongside as a freshness-aware knowledge layer. The central-oversight shape composes from the same primitives plus the `repoRole` hint.

The remaining 3.7 spec item — "edits from B land in A's data" — isn't a behaviour of the shipped architecture: pointers are read-only stubs and the canonical plan stays in its home repo. Edits to a cross-repo plan are made by opening the home project; the stitched view's "Open" affordance makes that one click. The test for this behaviour is implicit in the cross-repo test (the pointer doesn't carry editable state).

UX / visual checks the harness can't reach are tracked in [PENDING-VALIDATION.md](PENDING-VALIDATION.md). Tick them off as a human validates each.

### Build order

3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7. Per-item sharing (3.2) comes before cross-repo (3.3) on purpose — cross-repo plans tend to be larger, so we want the bloat-control mechanism in place first.

## Phase 4 — Sensors

Goal: close the gap between "the tools exist" and "the tools fire at the right moment." Today's drift detection, doc-freshness checking, and channel events are all on-demand — the user or agent has to remember to call them. Phase 4 makes them automatic, and adds the stuck sensor that has no on-demand equivalent.

Guiding principle (user directive): **non-obtrusive.** Agents need room to work; too many checks and balances eat into credits and derail agent execution. Every sensor defaults to the lightest possible touch — channel events that inform rather than interrupt, conservative thresholds that tolerate normal trial-and-error, and soft pause-hints rather than hard stops.

Decisions locked before build:

1. **Soft pause-hint** for stuck agents — the sensor posts a `stuck` channel event; it does NOT hard-pause or interrupt the agent's current tool call. The event routes through the existing channel dispatcher (webhooks, toasts) so a human or a helping agent can decide whether to intervene.
2. **Both file-watcher AND git-hook** triggers for the doc sensor — file-watcher catches local edits immediately; an optional post-merge/post-commit hook catches teammate-driven `git pull` changes. The hook is a thin shell script that hits a local CodeTrellis endpoint.
3. **Skip sensor framework abstraction** — each sensor is bespoke code calling directly into the channel-event and deviation services. A shared `Sensor` interface would be premature; these three sensors have genuinely different inputs (file events, tool-call streams, git diffs) and outputs (deviation rows, channel events). Unify later if a pattern emerges.
4. **Conservative sensitivity defaults** — every threshold is set high enough that false positives are rare. If in doubt, the sensor stays quiet. A false negative (agent grinds for an extra few minutes) is far less costly than a false positive (agent derailed mid-progress, credits burned on re-orientation).
5. **Lean on existing channel timeline** — no separate "Sensors" tab or panel. Sensor-emitted events appear in the same channel timeline as human-posted events. A `source: 'sensor'` field on the channel event payload distinguishes them in the UI (optional muted style) without fragmenting the team's attention surface.
6. **Default on/off** — drift sensor and doc sensor default **on** (low noise, high signal); stuck sensor defaults **off** (needs per-project calibration before it's useful).

### 4.1 Sensor configuration schema

Status: ⬜ Not started.

Extend `ProjectConfig` with a `sensors` section:

```typescript
interface SensorConfig {
  drift?: {
    enabled?: boolean;          // default: true
    channelEvents?: boolean;    // auto-post need-decision on new deviations (default: true)
    debounceMs?: number;        // batch deviations within this window (default: 2000)
  };
  docs?: {
    enabled?: boolean;          // default: true
    channelEvents?: boolean;    // auto-post need-decision when a doc goes stale (default: true)
  };
  stuck?: {
    enabled?: boolean;          // default: false
    repetitionThreshold?: number;    // same tool N times in a row (default: 8)
    errorLoopThreshold?: number;     // same tool error N times (default: 5)
    idleMinutes?: number;            // no file change in M minutes while tools active (default: 15)
  };
}
```

Parse + validate in `project-config-service.ts`. Helper: `getEffectiveSensorConfig(projectRoot)` returns the merged result (project config → defaults). MCP tool `update_project_config` accepts the new `sensors` field.

### 4.2 Drift → channel bridge

Status: ⬜ Not started.

Today's `checkFileDeviation` (called by the file watcher on every parsed file change) already creates deviation rows and broadcasts `deviation-detected`. Phase 4.2 adds a listener that converts new deviations into channel events:

- New function `bridgeDeviationToChannel(deviation, projectRoot)` in a new `sensor-bridge-service.ts`.
- Called from `checkFileDeviation` and from `detectDeviations` (the MCP tool path) after each new deviation is created — only when `sensors.drift.channelEvents` is enabled for the project.
- **Debounce**: deviations arriving within `debounceMs` are batched. A trailing-edge timer fires a single `need-decision` channel event listing all batched deviations, attributed as `author: 'codetrellis'`, `authorType: 'sensor'`.
- The channel event payload includes: deviation count, per-deviation type/file/description, and a suggested action ("run `get_drift_report` to review").
- Channel routing rules then handle notification as usual (webhook, toast, or nothing — the user controls the volume).
- The bridge also fires for the full `detectDeviations` run (the MCP tool), so agents that explicitly check drift also get the channel event if they're working a plan with teammates.

### 4.3 Documentation staleness → channel bridge

Status: ⬜ Not started.

Today's freshness check (`check_doc_freshness` MCP tool / `getFreshness` service function) is on-demand. Phase 4.3 makes it reactive:

**File-watcher trigger**: when the main file watcher re-parses a file, cross-reference it against system docs whose `references.files[]` includes that relative path. If any doc's freshness transitions from `current` → `stale` (or `moved` → `stale`), post a `need-decision` channel event. This runs only when `sensors.docs.enabled` is true.

Implementation: add a `checkDocFreshnessForFile(relativePath, projectRoot)` function in `sensor-bridge-service.ts`. Called from the file watcher alongside `checkFileDeviation`. Queries `system_docs` for rows whose `references` JSON contains the changed path, then calls `getFreshness` for each and compares against a cached prior state.

**Git-hook trigger**: ship an optional `.codetrellis/hooks/post-merge` shell script that `curl`s `http://localhost:3001/api/sensors/doc-check?project=<path>`. The REST endpoint runs freshness checks on all docs for the project and posts channel events for any newly-stale docs. The hook is opt-in — the user copies it into `.git/hooks/` or sources it from their own hook manager.

Channel event format: `need-decision` with payload listing the stale doc(s), their slug(s), and which referenced files changed.

### 4.4 Stuck sensor

Status: ⬜ Not started.

New service: `stuck-sensor-service.ts`. Watches the MCP tool-call broadcast stream for patterns indicating an agent is no longer making progress.

**Architecture**: the `broadcastToolEvent` hook in `mcp/server.ts` already fires on every tool call (complete or error) with tool name, args summary, duration, sessionId, and agent info. The stuck sensor subscribes to this stream (via a callback registered at boot) and maintains a per-session sliding window of recent calls.

**Heuristics** (all disabled by default; enabled when `sensors.stuck.enabled = true`):

| Heuristic | Default threshold | What it checks |
|---|---|---|
| Repetition | 8 calls | Same tool name called N+ times consecutively with <30% argument variation (Jaccard similarity on arg tokens) |
| Error loop | 5 errors | Same tool name errors N+ times in the last 10 calls |
| Idle stall | 15 minutes | Tool calls arriving but no `file-changed` / `file-added` broadcast in M minutes |

When a heuristic fires:
1. Post a `stuck` channel event on the plan the agent is working (inferred from recent tool args, e.g., `plan_uid` in the last N calls). Payload includes the heuristic name and a human-readable description.
2. **Soft pause-hint**: the event is purely informational. The agent is not interrupted. A human sees it in the channel timeline and via routing (toast, webhook). The agent can also see it if it reads the channel.
3. **Cooldown**: after firing, suppress the same heuristic for the same session for 10 minutes (avoids re-firing while the agent is working through the stuck state or while a human is formulating a steer).

Agents that self-report stuck (via the existing `post_channel_event` tool with `eventType: 'stuck'`) are the preferred path. The sensor is the safety net for agents that haven't built their own loop detection. Both produce identical channel events; the sensor-emitted one has `authorType: 'sensor'`.

### 4.5 Phase 4 demo + tests

Status: ⬜ Not started.

E2E tests:
1. **Drift → channel**: create a plan with fileSpecs, change a file outside the plan, confirm a `need-decision` channel event appears with the deviation details.
2. **Doc → channel**: create a system doc referencing a file, commit a change to that file, hit the doc-check endpoint, confirm a `need-decision` channel event appears.
3. **Stuck sensor**: configure `sensors.stuck.enabled = true` with low thresholds, replay a sequence of identical tool calls, confirm a `stuck` channel event fires.
4. **Sensor config round-trip**: set sensor config via `update_project_config`, read it back, confirm defaults merge correctly.
5. **Debounce**: trigger multiple deviations in rapid succession, confirm they batch into a single channel event.

### Build order

4.1 → 4.2 → 4.3 → 4.4 → 4.5. Config schema first (everything reads it); drift bridge next (simplest, wire existing detection to existing channels); doc bridge (similar pattern, different trigger); stuck sensor last (new service, most complex).

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
