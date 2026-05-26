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

Status: ✅ Done (commit `0c11907`). What shipped:

- `ChannelDrawer` component toggled from the plan workspace header — full-height right-side drawer with Allotment for non-competing layout alongside the activity drawer and drift banner.
- Composer with type selection (stuck / steer / weigh-in initially, expanded to all 6 in Phase 2.1), text input, optional item anchor picker, ⌘+Enter posting.
- Threading: responses rendered inline under their root event with indentation + left border. `responds_to` FK links the tree.
- Live updates via `channel-event-posted` and `channel-event-status-changed` WS broadcasts — no manual refresh needed.
- Attribution per event: human identity from `settings.identity`, agent attribution as `<human>'s <agent-type> (<model>)`.
- Status controls (✓ resolve, ✕ dismiss) on open root events with tinted labels (amber open, emerald resolved, muted dismissed).

Reference: [08 — Agent Collaboration](08-agent-collaboration.md).

### 1.5 Phase 1 demo + tests

Status: ✅ Done (commit `8ec1dd0`). E2E test at `tests/e2e/cdev-channels.test.ts` covers the full Phase 1 flow through real MCP wire format: register session, create plan, post channel event, list events, thread a response, resolve, dismiss, verify manifest export. Also validates attribution (authorType, agentModel) and status lifecycle.

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

Status: ✅ Done (commit `6770762`). What shipped:

- `normaliseRepoUrl(url)` strips `.git` suffix, lowercases host, normalises ssh → https, so every clone variant resolves to the same identity.
- `repo_origins` table with `project_path` + `origin_url` columns. Populated on `scanProject` from `git remote get-url origin`.
- Per-device alias stored in the DB only (never in the manifest — avoids teammate conflicts). `set_repo_alias` / `get_repo_identity` MCP tools.
- `refresh_repo_origin` MCP tool for re-reading after a remote change.
- E2E coverage in `cdev-cross-repo.test.ts`.

### 3.2 Per-item sharing

Status: ✅ Done (commit `9786f20`). What shipped:

- `visibility` column on plan items (`shared` | `local`, default `shared`). `override_parent_visibility` boolean flag for the exception case (shared child under a local parent).
- Export pipeline filters out local items. Override children are re-anchored to their nearest exported ancestor (closest ancestor whose effective visibility is `shared`), falling back to top-level when no such ancestor exists.
- `update_item` accepts `visibility` and `overrideParentVisibility` params. `list_items` returns effective visibility per item.
- Parent-dominance rule: a local parent shields all children from export unless a child explicitly overrides.
- E2E coverage in `cdev-phase3-demo.test.ts` — tests local exclusion from export AND from teammate import, plus override re-anchoring.
- **Note:** the per-item UI toggle in the plan workspace is not yet surfaced — the backend + MCP surface is complete but the frontend affordance is deferred to Phase 5.

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

Status: ✅ Done.

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

Status: ✅ Done.

Today's `checkFileDeviation` (called by the file watcher on every parsed file change) already creates deviation rows and broadcasts `deviation-detected`. Phase 4.2 adds a listener that converts new deviations into channel events:

- New function `bridgeDeviationToChannel(deviation, projectRoot)` in a new `sensor-bridge-service.ts`.
- Called from `checkFileDeviation` and from `detectDeviations` (the MCP tool path) after each new deviation is created — only when `sensors.drift.channelEvents` is enabled for the project.
- **Debounce**: deviations arriving within `debounceMs` are batched. A trailing-edge timer fires a single `need-decision` channel event listing all batched deviations, attributed as `author: 'codetrellis'`, `authorType: 'sensor'`.
- The channel event payload includes: deviation count, per-deviation type/file/description, and a suggested action ("run `get_drift_report` to review").
- Channel routing rules then handle notification as usual (webhook, toast, or nothing — the user controls the volume).
- The bridge also fires for the full `detectDeviations` run (the MCP tool), so agents that explicitly check drift also get the channel event if they're working a plan with teammates.

### 4.3 Documentation staleness → channel bridge

Status: ✅ Done.

Today's freshness check (`check_doc_freshness` MCP tool / `getFreshness` service function) is on-demand. Phase 4.3 makes it reactive:

**File-watcher trigger**: when the main file watcher re-parses a file, cross-reference it against system docs whose `references.files[]` includes that relative path. If any doc's freshness transitions from `current` → `stale` (or `moved` → `stale`), post a `need-decision` channel event. This runs only when `sensors.docs.enabled` is true.

Implementation: add a `checkDocFreshnessForFile(relativePath, projectRoot)` function in `sensor-bridge-service.ts`. Called from the file watcher alongside `checkFileDeviation`. Queries `system_docs` for rows whose `references` JSON contains the changed path, then calls `getFreshness` for each and compares against a cached prior state.

**Git-hook trigger**: ship an optional `.codetrellis/hooks/post-merge` shell script that `curl`s `http://localhost:3001/api/sensors/doc-check?project=<path>`. The REST endpoint runs freshness checks on all docs for the project and posts channel events for any newly-stale docs. The hook is opt-in — the user copies it into `.git/hooks/` or sources it from their own hook manager.

Channel event format: `need-decision` with payload listing the stale doc(s), their slug(s), and which referenced files changed.

### 4.4 Stuck sensor

Status: ✅ Done.

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

Status: ✅ Done. Four green E2E tests at `tests/e2e/cdev-sensors.test.ts`, all 14 CDev harness tests pass with no regressions.

E2E tests:
1. **Drift → channel**: create a plan with fileSpecs, change a file outside the plan, confirm a `need-decision` channel event appears with the deviation details.
2. **Doc → channel**: create a system doc referencing a file, commit a change to that file, hit the doc-check endpoint, confirm a `need-decision` channel event appears.
3. **Stuck sensor**: configure `sensors.stuck.enabled = true` with low thresholds, replay a sequence of identical tool calls, confirm a `stuck` channel event fires.
4. **Sensor config round-trip**: set sensor config via `update_project_config`, read it back, confirm defaults merge correctly.
5. **Debounce**: trigger multiple deviations in rapid succession, confirm they batch into a single channel event.

### Build order

4.1 → 4.2 → 4.3 → 4.4 → 4.5. Config schema first (everything reads it); drift bridge next (simplest, wire existing detection to existing channels); doc bridge (similar pattern, different trigger); stuck sensor last (new service, most complex).

## Phase 5 — Personal continuity and app polish

Goal: make CodeTrellis feel like a product, not a backend with a frontend bolted on. Personal continuity across machines, the frontend surfaces that catch up to the backend work built in Phases 1–4, and the visual polish pass that makes the app shippable. This is the phase where the user story "I clone the repo on my laptop and everything is already there" becomes real — and where the backend-only features (per-item sharing, channel composer, system docs, cross-repo) become usable by humans who don't speak MCP.

Reference: [04 — Multi-Device Continuity and Team Collaboration](04-multi-device-and-teams.md), [14 — Configuration and Personal Continuity](14-configuration-and-personal-continuity.md).

### 5.1 New-machine onboarding flow

Status: ✅ Done.

When the application opens on a machine for the first time (no `~/.codetrellis/settings.json`), run a two-question onboarding:

1. **Identify yourself.** Auto-detect from `git config user.name` / `user.email` (already seeded by Bugfix B on first project scan). Show the detected identity and let the user confirm or edit. This becomes `settings.identity`.
2. **Bring personal context across?** If the user has a personal sync store configured (see 5.3), offer to restore preferences, project history, and optionally drafts. If not, skip — clean slate.

After the two questions, the user points at a repository. Project state is restored from the repository's `.codetrellis/` manifest. The experience is: clone → open → everything is already here.

Implementation: a `FirstRunWizard` component that gates the main app shell. Runs once; sets a `firstRunComplete` flag in settings. Subsequent launches skip it. The wizard is a modal overlay, not a separate route — the app is still loading behind it.

### 5.2 Per-item sharing UI

Status: ✅ Done.

The backend for per-item sharing shipped in Phase 3.2 (visibility column, override flag, export filtering, re-anchoring). What's missing is the frontend affordance:

- A visibility toggle on each item in the plan tree (shared / local). Uses the existing `update_item({ visibility })` API.
- Visual distinction: local items rendered with a muted/dashed style so the user can scan which items are team-visible at a glance.
- Inherited-vs-explicit indicator: items inheriting `local` from a parent show "inherited" label; items with an explicit override show "override" label.
- Bulk action: select multiple items → set visibility. Useful for "make this whole branch local" or "share everything under this phase."

This is a frontend-only change — no new backend or MCP work needed.

### 5.3 Personal sync (pantry continuity across machines)

Status: ✅ Done.

Three modes, matching [14 — Configuration and Personal Continuity](14-configuration-and-personal-continuity.md):

| Mode | Behaviour | Implementation |
|------|-----------|----------------|
| **No sync** (default) | Each machine has its own pantry. Drafts, preferences, project history are local. | Already the status quo. |
| **Selective sync** | User marks specific drafts or preferences as "follow me." Selected items sync through a personal store. | Export selected items to a user-controlled location (personal git repo, synced folder). Import on new machine during 5.1 onboarding. |
| **Full personal sync** | Entire pantry travels. | Export the full sql.js DB (minus machine-local exclusions) to the personal store. Import on new machine. |

**Personal store** is BYO: a personal git repository the user controls, or a synced folder (iCloud Drive, Dropbox, etc.). CodeTrellis writes to a configurable path (`settings.personalSyncPath`); the sync mechanism is the user's responsibility. This keeps us out of the cloud-sync business.

**Always machine-local** (never synced even in full mode): live tool-call streams, open terminal sessions, cached graph computations, anything detected as a secret (basic regex on pasted content).

**MCP tools**: `configure_personal_sync({ mode, path? })`, `sync_now()` (manual trigger), `get_sync_status()`.

### 5.4 Visual validation and frontend polish

Status: ⏳ Deferred (requires packaged build for screenshot verification).

Consolidates the accumulated visual checks from PENDING-VALIDATION.md and the "Visual checks" section below. This sub-phase is a focused sprint through every deferred UI item:

- Phase 1–2 channel UI checks (composer layout, threading indentation, attribution rendering, drawer spacing).
- Phase 3 UX checks (docs panel feel, cross-repo clipboard hint, WS-driven pointer refresh, repoRole empty state, alias truncation).
- Sensor events in the channel timeline: muted visual treatment for `authorType: 'sensor'` events, distinguishable from human/agent posts.
- General polish: loading states, error states, empty states across all new surfaces.

Requires a packaged macOS build for screenshot-based verification, or a workaround for the dev-server screenshot hang. The Electron wrapper needs to be tested against the macOS 26 SIGKILL bug.

### 5.5 Phase 5 demo + tests

Status: ✅ Done (3 E2E tests: first-run, visibility toggle, sync cycle).

Demo flow:
1. Fresh machine (or fresh `~/.codetrellis/`). Open the app → onboarding wizard runs.
2. Point at a project with existing `.codetrellis/` manifest → plans, docs, channel events all restored.
3. Toggle per-item visibility in the plan tree → export pipeline respects the change.
4. Configure personal sync → close app → reopen on a "new machine" (fresh data dir) → restore from personal store → preferences and project history travel.
5. Walk through visual checks from 5.4 on a packaged build.

E2E tests for 5.1 (onboarding flow), 5.2 (visibility toggle round-trips through the API), 5.3 (export/import cycle).

### Build order

5.1 → 5.2 → 5.3 → 5.4 → 5.5. Onboarding first (everyone hits it). Per-item sharing UI next (the most user-visible gap from Phase 3). Personal sync third (builds on the onboarding flow). Visual polish last (sweep everything at once on a real build).

---

## Phase 6 — Team history and governance

Goal: make the git-backed state model legible to teams. Today, plan history is DB-only (`plan_events` table) and activity is ephemeral (WebSocket broadcasts). Phase 6 projects the manifest's git history into first-class team surfaces: an activity feed, a history rail, and decision archaeology. It also adds the governance primitives teams need to work safely at scale.

Reference: [04 — Multi-Device Continuity and Team Collaboration](04-multi-device-and-teams.md), [02 — State Model](02-state-model.md).

### 6.1 Git-projected team activity feed

Status: ✅ Done.

A "what happened this week" surface drawn entirely from git history of the `.codetrellis/` directory. Not a replacement for the DB-driven `plan_events` (which tracks in-session structural mutations) — a complement that shows team-level activity that survived into commits.

- Service: `git-activity-service.ts`. Walks `git log --diff-filter=ACDMR -- .codetrellis/` to extract recent manifest changes. Parses the changed files (plan YAML, item YAML, channel event YAML, doc markdown) to produce typed activity entries.
- Each entry: `{ timestamp, author, action, entityType, entityTitle, planSlug, commitHash }`. Actions: created, updated, resolved, dismissed, verified, deleted.
- MCP tool: `get_team_activity({ project_path, since?, limit? })`.
- Frontend: `TeamActivityPanel` — a feed view accessible from the sidebar. Shows recent manifest changes attributed to teammates. Live-refresh on `git pull` or file-watcher events in `.codetrellis/`.
- Respects the existing attribution model: human author from git commit, agent from Co-Authored-By trailer.

### 6.2 Per-plan history rail

Status: ✅ Done.

View the plan as it stood at any historical commit, rendered as plan UI rather than raw diff. This is the "time machine" for plans.

- Service: `plan-history-service.ts`. Given a plan UID and a commit hash, checks out the plan's manifest files at that commit (`git show <hash>:<path>`) and parses them into the same typed structures the plan workspace uses.
- Frontend: `PlanHistoryRail` — a slider or dropdown that shows commits touching this plan. Selecting one renders the plan tree at that point in time (read-only). A diff toggle highlights what changed between the selected commit and the current state.
- MCP tool: `get_plan_at_commit({ plan_uid, commit_hash })`.

### 6.3 Decision archaeology

Status: ✅ Done.

"Why did we choose this approach?" answered by finding the commit where a decision was recorded and showing the plan's full state at that moment.

- Builds on 6.2. Adds a search/filter layer: search Objects by title or body text across plan history. Results link to the commit where the Object was created or last substantively edited.
- MCP tool: `search_plan_history({ plan_uid, query, since?, until? })`.
- Frontend: a search box in the plan history rail that filters to commits where matching content changed.

### 6.4 Conflict resolution UI

Status: ✅ Done.

When two branches edit the same plan and produce a git merge conflict, the application resolves them at the field level rather than dumping the user into raw conflict markers.

Reference: [04 — Multi-Device Continuity and Team Collaboration § Conflict resolution](04-multi-device-and-teams.md).

- Service: `plan-conflict-service.ts`. Detects conflict markers in `.codetrellis/plans/` files after a failed merge. Parses both sides of the conflict into typed structures (plan YAML, item YAML). For structured fields (status, assignee, visibility), presents a chooser. For free-text fields (spec bodies, descriptions), falls through to git's three-way merge (markdown merges naturally most of the time).
- Frontend: `ConflictResolver` modal. Shows conflicting fields side-by-side with "pick left / pick right / edit" affordance. On resolve, writes the merged file and stages it for commit.
- Graceful fallback: if the conflict is too complex for field-level resolution (e.g., a plan was restructured on both branches), surface the raw conflict and let the user resolve manually. Don't be clever at the expense of correctness.

### 6.5 Freeze periods

Status: ✅ Done.

A governance primitive: mark a project as frozen for non-critical work during a defined period (release week, incident response, etc.).

Reference: [13 — Use Cases § A team operates under a freeze period](13-use-cases.md).

- Config: `freeze` section in `.codetrellis/config.json` with `{ active: boolean, reason?: string, since?: ISO, until?: ISO, allowedPlanUids?: string[] }`.
- MCP tools: `set_freeze({ project_root, active, reason?, until?, allowedPlanUids? })`, `get_freeze_status({ project_root })`.
- Routing integration: freeze-aware channel routing rules (e.g., "toast a warning when an agent starts working on a non-exempt plan during a freeze"). Composes with the existing Phase 2 routing rules.
- Frontend: a banner on the plan workspace when the project is frozen, with the reason and expiry. Non-exempt plans show an amber "frozen" badge.

### 6.6 Phase 6 demo + tests

Status: ✅ Done.

Demo flow:
1. A project with several commits touching plans. The team activity feed shows recent changes attributed to teammates.
2. Select a plan → open the history rail → scrub back to a past commit → see the plan tree at that point.
3. Search for a decision keyword → find the commit where it was introduced → view the plan at that moment.
4. Simulate a branch conflict on a plan → open the conflict resolver → pick fields → clean merge.
5. Enable freeze → agent attempts to work on a non-exempt plan → warning surfaces.

E2E tests for each sub-phase via the harness.

### Build order

6.1 → 6.2 → 6.3 → 6.4 → 6.5 → 6.6. Activity feed first (lowest risk, highest visibility). History rail next (builds the time-travel primitive 6.3 depends on). Decision archaeology third (thin layer on top of 6.2). Conflict resolution fourth (independent but benefits from having 6.1–6.3 exercising the git-read paths). Freeze periods last (governance add-on, smallest scope).

---

## Phase 7 — External contributors

Goal: make CodeTrellis work for teams that include people outside the core organisation — contractors, agencies, open-source collaborators. The mechanism is the same as internal collaboration (plans travel via git, edits travel via PRs), with two additions: asymmetric visibility for private team materials, and explicit promote-to-PR controls for contributor-produced artefacts.

Reference: [05 — Cross-Repo Work and External Contributors](05-cross-repo-and-external-contributors.md).

### 7.1 Asymmetric pantry (external placeholder state)

Status: ✅ Done.

External contributors working in forks or scoped branches don't have access to the team's private pantry content (local screenshots, internal transcripts, private notes). Today, references to those items silently break. Phase 7.1 adds a graceful placeholder state.

- When a manifest references a pantry item (screenshot, transcript, attachment) that the current user can't resolve, show a styled placeholder: `"[Team-only content] — request access from <author>"`. The author is read from the item's attribution.
- Service: `pantry-resolution-service.ts`. Checks whether a referenced pantry path exists locally. Returns `resolved` (path exists, content available) or `external` (path missing, show placeholder).
- Frontend: placeholder cards in the item detail view, doc body, and comment threads wherever pantry references appear.

### 7.2 Promote-to-PR controls

Status: ✅ Done.

When an external contributor wants to share working material (an architecture diagram, a walkthrough recording, a spec draft) back to the team, they mark it for inclusion in their pull request.

- A "promote" action on local items and attachments: moves the content from the contributor's pantry into the manifest staging area (`.codetrellis/contributions/<branch>/`), ready to be committed and pushed as part of a PR.
- On the receiving end: the team reviews the contributed content alongside code changes in the PR. Accepting the PR moves the content into the manifest proper.
- MCP tool: `promote_to_contribution({ item_uid?, attachment_uid?, description? })`.

### 7.3 Fork-from-prepared-state

Status: ✅ Done.

In situations where the team doesn't want to share the full plan history with a contractor, the contractor forks from a prepared branch rather than main.

- MCP tool: `prepare_contributor_branch({ plan_uid, branch_name, include_items? })`. Creates a branch containing only the plan content the team wants to share (selected items, no private comments, no team-only attachments). The contractor clones from this branch.
- This is a git operation with selective content — the application writes a filtered manifest snapshot to a new branch, commits it, and the team pushes it to the remote.

### 7.4 Phase 7 demo + tests

Status: ✅ Done.

Demo flow:
1. Team creates a plan with a mix of shared and local items.
2. Contributor forks from a prepared branch → sees shared items, sees placeholders for private items.
3. Contributor produces an architecture diagram, promotes it to contribution → content appears in their PR.
4. Team reviews and merges → contributed content appears in the manifest.

### Build order

7.1 → 7.2 → 7.3 → 7.4. Placeholders first (lowest risk, improves the experience for everyone who encounters a broken reference). Promote-to-PR second (the contributor-side workflow). Fork-from-prepared third (the team-side preparation step — used less frequently, more complex).

---

## Phase 8 — AI in collaboration (audio context)

Goal: AI agents become participants in human conversation about the work. When a user is in a meeting, they press a hotkey — the recent audio context is packaged and made available to their agent via MCP. CodeTrellis never transcribes; multi-modal models handle audio directly.

Reference: [15 — AI in Collaboration](15-ai-in-collaboration.md).

### 8.1 Audio capture pipeline

Status: ✅ Complete.

Capture audio from the system microphone via the browser MediaRecorder API. The frontend streams chunks to the backend, which maintains a rolling buffer. System audio loopback (Zoom/Meet/Teams capture) is deferred to the Electron build (requires ScreenCaptureKit or a virtual audio device).

- Rolling buffer in memory: most recent N seconds of audio (default 120s). The buffer never persists to disk.
- Prompt-on-invocation: user presses a hotkey or button — no wake word, no always-on transcription.
- Frontend: MediaRecorder (WebM/Opus) → chunked POST to backend every 2 seconds.
- Backend: `audio-buffer-service.ts` — ring buffer of timestamped audio chunks.
- REST: `POST /api/audio/chunk` (chunk upload), `GET /api/audio/status`, `POST /api/audio/start`, `POST /api/audio/stop`.
- MCP: `start_audio_capture`, `stop_audio_capture`, `push_audio_chunk` (for harness/agent use).

### 8.2 Audio routing via MCP

Status: ✅ Complete.

Route the audio buffer to the user's AI runtime via MCP tools.

- MCP tool: `get_audio_context({ seconds? })` — returns the most recent N seconds of audio as base64-encoded WebM/Opus.
- MCP tool: `get_audio_status()` — check capture state and buffer fullness.
- Frontend: `AudioCaptureBar` component — toggle capture, show buffer status, hotkey hint (Ctrl/Cmd+Shift+M).

### 8.3 Phase 8 tests

Status: ✅ Complete. 3 tests passing.

Test the audio pipeline end-to-end with synthetic audio chunks (no real mic needed):
1. Audio buffer — add chunks, get recent audio, verify rolling eviction.
2. MCP tool — get_audio_context returns base64 data when buffer has content.
3. Capture state — start/stop round-trip with buffer clear on restart.

### Build order

8.1 → 8.2 → 8.3.

---

## Phase 9 — Discovery and pairing

Goal: two devices (desktop + phone, desktop + laptop, any combination) can find each other on the LAN, pair via QR code, and establish a WebRTC data channel — **without opening any network ports**. All existing ports (:3001, :5173, :19432) stay bound to localhost. The WebRTC connection punches through NAT; the QR code carries the signalling payload so no rendezvous server is needed.

Reference: [16 — Mobile Companion](16-mobile-companion.md).

### Design principles

**Zero ports exposed.** CodeTrellis never binds to 0.0.0.0. Developer machines run web servers, databases, and test services on well-known ports — we don't compete for them and we don't expose attack surface. WebRTC's NAT traversal gives us peer-to-peer connectivity without opening a listening socket.

**QR code IS the signalling.** Traditional WebRTC needs a signalling server to exchange offers and answers between peers. We skip that: the QR code encodes the WebRTC offer + ICE candidates. The pairing device scans it and sends the answer back via a one-shot local channel (Bluetooth LE advertisement, or a brief HTTP POST to an ephemeral endpoint that lives only for the pairing seconds). After the WebRTC connection is up, the ephemeral channel is torn down.

**Desktop renders, mobile displays.** The desktop serves the UI — same React codebase, mobile-optimized layout. But instead of serving it over HTTP (which would need an open port), the rendered state streams over the WebRTC data channel. The mobile app has a local WebView that receives state updates and renders them.

### 9.1 mDNS discovery

Status: ⬜ Not started.

Every running CodeTrellis instance advertises itself on the local network so other devices know it exists. mDNS does NOT establish a connection — it just says "I'm here."

- `src/backend/services/mdns-service.ts` — advertise as `_codetrellis._tcp` on startup; browse for other instances.
- Service record: `{ name: <device-alias>, version, fingerprint }`. No port in the record — we're not accepting connections.
- Discovery is informational: the mobile app shows "Desktop 'Saif's iMac' is nearby" so the user knows to look for the QR code on that machine.
- Fallback: if mDNS is blocked, the user manually initiates pairing from the desktop (the QR appears regardless).
- Uses `bonjour-service` npm package (pure JS, cross-platform).

### 9.2 QR-based signalling (zero-port handshake)

Status: ⬜ Not started.

The pairing handshake happens entirely through the QR code and a confirmation code — no listening port required.

**Flow**:

1. User clicks "Pair device" on the desktop → desktop generates a WebRTC offer (SDP + ICE candidates gathered via STUN).
2. Desktop encodes the offer into a QR code: `{ offer, iceCandidates, fingerprint, nonce }`. QR is displayed on screen.
3. Mobile app scans the QR → extracts the offer → creates a WebRTC answer.
4. Mobile displays a 6-digit confirmation code derived from the answer's fingerprint.
5. User enters the code on the desktop → desktop now has the answer payload (the code maps to the answer via a key derivation, or the mobile sends the full answer via a brief BLE advertisement / NFC tap / manual paste).
6. Both sides complete the WebRTC handshake → data channel opens.
7. Shared secret derived from the DTLS handshake. Stored for auto-reconnect.

**The answer delivery problem**: The mobile has the desktop's offer (from QR), but the desktop needs the mobile's answer. Options (implement the simplest that works):

| Method | How | Pros | Cons |
|---|---|---|---|
| **BLE advertisement** | Mobile broadcasts the answer as a BLE service; desktop listens briefly | Zero network, works offline | Requires BLE on both; not available in all browsers |
| **Answer-in-code** | The 6-digit code IS a compressed form of the answer (ECDH, shared secret from offer nonce) | Truly zero infrastructure | Limited bandwidth in 6 digits — may need a longer code or multi-step |
| **Ephemeral UDP** | Mobile sends answer to desktop's IP (from QR) via a single UDP packet; desktop listens on an ephemeral port for <5 seconds during pairing only | Works everywhere | Technically opens a port, but only for seconds and only during explicit pairing action |
| **Manual paste** | Desktop shows a text field; user copies the answer from mobile and pastes it | Universal fallback | Poor UX, last resort |

**Recommended approach**: ephemeral UDP for the answer delivery. The desktop opens a random high port, listens for exactly one UDP packet (the answer), then closes it. Port is open for <5 seconds, only during explicit user-initiated pairing, and only accepts packets matching the nonce. This is not "exposing a port" in any meaningful sense — it's more like accepting a phone call.

**Implementation**:

- `src/backend/services/pairing-service.ts` — generates offer, encodes QR, listens for answer, completes handshake, stores paired device.
- `src/backend/services/webrtc-service.ts` — WebRTC peer connection lifecycle (offer/answer, ICE, data channels).
- Paired devices stored in `~/.codetrellis/paired-devices.json` — fingerprint, alias, shared secret (encrypted at rest), paired-at, last-seen.
- QR and pairing window expire after 60 seconds.
- REST (localhost only): `POST /api/pairing/initiate`, `GET /api/pairing/qr`, `POST /api/pairing/confirm`, `DELETE /api/pairing/:fingerprint`.
- MCP: `list_paired_devices`, `unpair_device`.

### 9.3 WebRTC connection manager

Status: ⬜ Not started.

Manages active WebRTC connections to paired devices. Handles reconnection, heartbeat, and multiplexed data channels.

- `src/backend/services/peer-connection-service.ts` — one `RTCPeerConnection` per active peer.
- Auto-reconnect: when a paired device is discovered via mDNS, both sides attempt to re-establish the WebRTC connection using stored credentials. The device that was most recently the "initiator" generates a fresh offer; the other answers. Exponential backoff on failure.
- Data channels:
  - `control` — JSON-RPC messages (commands, state updates, pairing lifecycle).
  - `ui` — UI state stream (rendered component tree / state snapshots for the mobile WebView).
  - `terminal` — terminal I/O (binary, multiplexed by terminal ID).
  - `audio` — audio buffer forwarding (WebM/Opus chunks).
- Heartbeat: ping every 10 seconds on `control`. If 3 pings missed → connection presumed dead → reconnect.
- Connection states exposed via localhost-only `GET /api/peers`.

**WebRTC library choice**:

- Evaluate `werift` (pure TypeScript, no native deps, no build issues) vs `node-datachannel` (C++ bindings, faster, but adds native dep complexity alongside node-pty).
- `werift` preferred to avoid the cross-compile issues we already have with node-pty.

### 9.4 Desktop UI: device management

Status: ⬜ Not started.

- `src/frontend/components/pairing/PairingModal.tsx` — shows QR code + code entry field during pairing.
- `src/frontend/components/pairing/DeviceList.tsx` — paired devices: alias, type, last seen, connected now, unpair.
- Top-bar icon: count of connected peers (click → device list).
- Settings → Devices: full management.

### 9.5 Phase 9 tests

Status: ⬜ Not started.

1. **mDNS** — instance advertises, second process discovers it.
2. **Pairing** — simulate full QR → answer → code → confirmation flow with two in-process WebRTC peers.
3. **Data channel** — paired peers send messages on `control` channel, receive them.
4. **Reconnection** — disconnect, re-discover via mDNS, auto-reconnect using stored credentials.
5. **Security** — expired pairing nonce rejected. Unpaired peer's answer rejected. Replay rejected.

### Build order

9.1 (mDNS) + 9.3 (WebRTC lib eval) in parallel → 9.2 (pairing) → 9.3 continued (connection manager) → 9.4 (UI) → 9.5 (tests).

### Dependencies and risks

| Risk | Mitigation |
|---|---|
| `werift` maturity / edge cases | It's used in production by several projects; fallback to `node-datachannel` if critical bugs |
| QR code size limit (offer + ICE can be large) | Use ICE-lite or Trickle ICE to reduce candidate list; compress payload; or use chunked QR |
| Answer delivery (ephemeral UDP) on restrictive OS firewalls | macOS/Windows may prompt for firewall permission on first use. BLE fallback. Manual paste as last resort. |
| mDNS on Windows | `bonjour-service` pure JS works; may need Bonjour Print Services installed for full compat |
| Auto-reconnect reliability | STUN server needed for ICE when devices are on different subnets (common in VPN). Ship a default public STUN (Google's) with option to configure custom. |

---

## Phase 10 — Multi-device (desktop-to-desktop)

Goal: a developer with multiple machines (desktop + laptop) can window into any paired CodeTrellis instance. Both are full CodeTrellis installs — you can read, respond, steer agents, control terminals, and act from either. The remote machine's CodeTrellis connects as a WebRTC peer and receives real-time state.

This is **one developer, multiple devices**. The use case: your agent is running on your desktop, you're on your laptop, you want to see what it's doing and steer it.

No ports opened. Everything flows over the Phase 9 WebRTC connection.

### 10.1 State sync over WebRTC

Status: ⬜ Not started.

The `ui` data channel streams workspace state from one CodeTrellis to another.

**What syncs (instant, over WebRTC)**:

- Plan list, item statuses, phase progress — the full plan state as the local instance sees it.
- Channel events — delivered immediately (before git commit).
- Agent sessions — connected agents, current tool call, status.
- Presence — which plan is open, which item is selected.
- Audio capture status — peer knows if audio is active on the remote.

**What does NOT sync**:

- Plan content authoring (item bodies, spec docs) — syncs through git. WebRTC notifies that something changed so the other instance can `git pull`.
- The dependency graph data — each instance scans its own local repo.
- Settings, project config — git-backed.

**Protocol**:

- On connection: full state snapshot on the `ui` channel.
- Ongoing: JSON patches (RFC 6902) debounced at 100ms.
- Deduplication by UID — if an event arrives via WebRTC and later via git, it's the same event.

### 10.2 Remote terminal access

Status: ⬜ Not started.

View and control terminals running on the paired desktop, streamed over the `terminal` data channel.

- Remote terminals appear in the local terminal panel with a "remote" badge and device alias.
- Full bidirectional: watch output AND type commands from either machine.
- `terminal` channel: `[1-byte terminal-index][payload]` — raw PTY output (UTF-8 + ANSI).
- Terminal list exchanged via `control` channel on connection.

### 10.3 Remote audio forwarding

Status: ⬜ Not started.

When audio capture is active on one device, the peer can access it via `get_audio_context`.

- `audio` data channel streams WebM/Opus chunks from the capturing device.
- Peer's `audio-buffer-service` receives forwarded chunks and stores them locally.
- An agent on the laptop calling `get_audio_context` gets audio from the desktop's mic — transparent.
- Privacy: "Share audio with paired devices" toggle in Settings → Devices (default: off).

### 10.4 Remote agent interaction

Status: ⬜ Not started.

Steer or unblock an agent running on the paired desktop.

- Channel events posted on the laptop flow instantly to the desktop via `control` channel.
- `await_user_input` prompts from the desktop route to both local UI and connected peers.
- First response wins — answer from either machine.
- Agent presence streams in real time.

### 10.5 Phase 10 tests

Status: ⬜ Not started.

1. **State sync** — peer A posts a channel event, peer B receives it via WebRTC.
2. **Terminal** — peer A creates a terminal, peer B sees it, sends input, gets output.
3. **Audio** — peer A captures audio, peer B's agent gets it via `get_audio_context`.
4. **Bidirectional** — both peers post events simultaneously, both receive.
5. **Reconnection** — disconnect, reconnect, state re-syncs.

### Build order

10.1 (state sync) → 10.2 (terminals) + 10.3 (audio) in parallel → 10.4 (agent interaction) → 10.5 (tests).

---

## Phase 11 — Mobile companion app (Expo)

Goal: a standalone mobile app (Expo) that pairs with a desktop CodeTrellis via QR code and gives you a mobile view of your workspace. Respond to agent events from your pocket. The desktop renders a mobile-optimized UI; the state streams over WebRTC; the app displays it in a local WebView.

**No ports opened. No HTTP to the desktop.** Everything flows over the Phase 9 WebRTC data channel.

The connection layer is abstracted: today it connects to a local desktop over WebRTC; in the future it could connect to a cloud-hosted CodeTrellis over HTTPS/WebSocket.

### 11.1 Expo project setup

Status: ⬜ Not started.

- `mobile/` — new top-level directory. Expo managed workflow (SDK 52+).
- `mobile/app/` — Expo Router: pairing screen → device list → main workspace.
- `mobile/lib/connection.ts` — abstract `ConnectionTarget`:
  - `{ type: 'webrtc', fingerprint, sharedSecret }` — paired desktop (Phase 9).
  - `{ type: 'hosted', url, apiKey }` — future cloud (stubbed).
- `mobile/lib/webrtc.ts` — `react-native-webrtc` wrapper for data channel management.
- `mobile/lib/storage.ts` — Expo SecureStore for pairing credentials.
- `mobile/lib/push.ts` — Expo Notifications for push.
- Dark theme matching desktop.

### 11.2 QR pairing (mobile side)

Status: ⬜ Not started.

- `expo-camera` → QR scanner.
- Parses QR payload (WebRTC offer + ICE candidates + nonce).
- Creates WebRTC answer → displays 6-digit code.
- Sends answer back to desktop (ephemeral UDP / BLE / manual paste).
- On success: WebRTC data channel opens. Stores pairing in SecureStore.
- Home screen lists paired desktops — tap to connect (re-establishes WebRTC).

### 11.3 Mobile WebView with WebRTC state bridge

Status: ⬜ Not started.

The core of the app. A local WebView renders the mobile UI. State arrives over WebRTC and is injected into the WebView.

**Architecture**:

- The mobile app ships a **bundled copy** of the `/m/` web UI (built from `src/frontend/mobile/`, included in the Expo app binary via `expo-asset`).
- WebView loads this local bundle — no HTTP request to the desktop.
- State flows: Desktop → WebRTC `ui` channel → React Native → `postMessage` into WebView → Zustand stores update → UI re-renders.
- User interactions flow back: WebView `postMessage` → React Native → WebRTC `control` channel → Desktop processes the action.
- This is the same pattern as React Native WebView bridges in banking apps, Figma mobile, etc.

**Surfaces** (same as desktop `/m/` layout):

| Surface | What | Interaction |
|---|---|---|
| Dashboard | Agent status, plan summary, recent events | Read |
| Channel feed | All channel events, reply composer | Read + respond |
| Plan browser | Plan list → items → detail | Read + status updates |
| Graph viewer | ReactFlow, independent pan/zoom | Read + navigate |
| Terminal | xterm.js, full I/O | Read + write |
| Audio controls | Start/stop capture on desktop | Toggle |

### 11.4 Push notifications (Expo Push relay)

Status: ⬜ Not started.

Native push when the app is backgrounded — the WebRTC connection drops when the phone sleeps.

**Desktop side**:

- `src/backend/services/push-notification-service.ts` — when a channel event fires (stuck, need-decision, await_user_input) and a paired mobile has a push token, send via Expo Push API.
- Mobile registers its push token with the desktop over the `control` channel after pairing.
- Push payload: `{ type, title, body, data: { eventId, planSlug } }`.
- Rate limit: max 1 push per event type per minute.

**Mobile side**:

- Tap notification → app opens → WebRTC reconnects → WebView navigates to the event.
- Badge count: unresponded events.
- Quick-reply action buttons on the notification (iOS/Android).

**Privacy**: push payloads are minimal (event type + IDs). Full content loads over WebRTC when the app wakes. Expo Push sees only the token and a short message.

### 11.5 App store distribution

Status: ⬜ Not started.

- Apple App Store ($99/yr developer account). Native camera + push = sufficient native value for review.
- Google Play ($25 one-time).
- `eas build` for cloud builds.
- TestFlight / internal testing track first.

### 11.6 Phase 11 tests

Status: ⬜ Not started.

1. **Pairing** — simulate QR scan → answer → code → WebRTC connected.
2. **State bridge** — desktop pushes state over WebRTC, mobile WebView renders it.
3. **Interaction** — mobile posts a channel reply, desktop receives it.
4. **Push** — event fires on desktop, push sent to mocked Expo Push API.
5. **Deep link** — notification tap → app opens → navigates to event.
6. **Reconnect** — app backgrounded → foregrounded → WebRTC re-establishes → state re-syncs.

### Build order

11.1 (setup) → 11.2 (pairing) → 11.3 (WebView bridge) → 11.4 (push) → 11.5 (app store) → 11.6 (tests).

11.3 is the MVP. Once state flows through WebRTC into the WebView, the app is usable.

### Dependencies and risks

| Risk | Mitigation |
|---|---|
| `react-native-webrtc` quirks on iOS | Mature library (10k+ stars). Test early on physical device. |
| Expo managed vs bare workflow | Start managed; eject only if `react-native-webrtc` requires it (it usually does — plan for bare) |
| Bundled WebView UI size | The `/m/` build is ~3MB gzipped (same as desktop). Acceptable for app binary. |
| Expo Push free tier reliability | Fine for v1. Direct FCM/APNs later if needed. |
| Apple review for WebView + WebRTC | Camera + push + WebRTC = clearly native. Not a website wrapper. |
| State bridge latency (WebRTC → postMessage → WebView) | Sub-100ms on modern phones. JSON patches keep payload small. |
| Bundled UI versioning | App bundles a specific version of the `/m/` UI. If desktop is newer, the `control` channel negotiates compat or prompts app update. |

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
