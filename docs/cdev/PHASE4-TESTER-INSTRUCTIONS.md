# Phase 4 (Sensors) — Tester Agent Instructions

You are testing **CDev Phase 4: Sensors** in CodeTrellis. Phase 4 adds
three sensors that auto-detect problems and post channel events into the
plan timeline. No new MCP tools were added — sensors wire into existing
tools and internal services. Your job is to verify the sensor config
surface, the three sensor→channel bridges, and their edge cases.

## Environment

You are on the same machine as the codebase. The project root is:

```
/Users/saif/Workspaces/AILAR/codetrellis
```

### Running the E2E test suite (automated)

The existing automated tests for Phase 4 live at:

```
tests/e2e/cdev-sensors.test.ts
```

Run them with:

```bash
npx playwright test --config playwright.harness.config.ts cdev-sensors
```

This uses `playwright.harness.config.ts` (NOT the default
`playwright.config.ts`). Each test boots its own backend — no dev
server needed.

There are 4 automated tests:
1. Sensor config round-trip
2. Drift → channel event
3. Doc staleness → channel event
4. Stuck sensor fires on repetitive tool calls

If all 4 pass, the core wiring is solid. The manual scenarios below
cover what the automated tests can't.

---

## What Phase 4 changed (tools & surfaces to test)

### 1. Sensor config in `update_project_config` / `get_project_config`

**What changed:** `update_project_config` now accepts a `sensors`
parameter with three sub-objects. `get_project_config` now returns
`effective.sensors` with all defaults resolved.

**MCP tools involved:**
- `update_project_config({ project_root, sensors: { ... } })`
- `get_project_config({ project_root })`

**Config schema:**

```json
{
  "sensors": {
    "drift": {
      "enabled": true,          // default: true
      "channelEvents": true,    // default: true
      "debounceMs": 2000        // default: 2000
    },
    "docs": {
      "enabled": true,          // default: true
      "channelEvents": true     // default: true
    },
    "stuck": {
      "enabled": false,         // default: false
      "repetitionThreshold": 8, // default: 8
      "errorLoopThreshold": 5,  // default: 5
      "idleMinutes": 15         // default: 15
    }
  }
}
```

**What to verify:**

- [ ] Call `get_project_config` on a fresh project — `effective.sensors`
  should show all defaults (drift+docs enabled, stuck disabled).
- [ ] Call `update_project_config` with
  `sensors: { stuck: { enabled: true, repetitionThreshold: 3 } }` —
  confirm the response contains the override.
- [ ] Call `get_project_config` again — confirm drift/docs defaults are
  preserved (not wiped by the partial stuck update), and stuck shows
  the override merged with its other defaults (`errorLoopThreshold: 5`,
  `idleMinutes: 15`).
- [ ] Check on-disk at `<project>/.codetrellis/config.json` — the
  `sensors` section should be persisted.
- [ ] Set `sensors: { drift: { enabled: false } }` — confirm drift is
  disabled in the effective config while docs remains enabled.

### 2. Drift sensor → channel bridge

**What changed:** When `detect_deviations` finds deviations (or the
file watcher creates one via `checkFileDeviation`), the drift sensor
auto-posts a `need-decision` channel event into the plan's timeline.
Events are debounced per plan (default: 2000ms window).

**MCP tools involved:**
- `create_plan`, `add_item` (to set up a plan with file specs)
- `detect_deviations({ plan_uid })` (triggers deviation detection)
- `list_channel_events({ plan_uid, event_types: ['need-decision'] })`
  (to verify the sensor event appeared)
- `update_project_config` (to tune `sensors.drift.debounceMs`)

**What to verify:**

- [ ] Create a plan with an action item that has a `file_specs` entry
  pointing to a file that doesn't exist (e.g.,
  `{ path: 'src/ghost.ts', action: 'create' }`, `status: 'done'`).
- [ ] Run `detect_deviations({ plan_uid })` — should return
  `detected > 0` with a `missing_file` deviation.
- [ ] Wait ~2.5s (debounce default is 2000ms), then call
  `list_channel_events({ plan_uid, event_types: ['need-decision'] })`.
- [ ] Confirm at least one event has:
  - `authorType: 'sensor'`
  - `payload.source: 'drift-sensor'`
  - `payload.deviations` array with at least one entry
  - `payload.message` containing "Drift sensor detected"
- [ ] **Debounce test:** Set `sensors.drift.debounceMs` to 200 (low),
  run detect_deviations twice quickly, wait 500ms, confirm only **one**
  channel event was posted (the batch merged them).
- [ ] **Disable test:** Set `sensors.drift.enabled` to false, run
  detect_deviations, confirm NO new channel event appears.
- [ ] **channelEvents off:** Set `sensors.drift.channelEvents` to false
  (keep enabled true) — deviations should still be detected but no
  channel event posted.

### 3. Doc staleness sensor → channel bridge

**What changed:** When a file referenced by a system doc changes (via
file watcher or the `/api/sensors/doc-check` REST endpoint), the doc
sensor checks freshness and posts a `need-decision` channel event if
the doc has gone stale.

**MCP tools involved:**
- `create_plan` (channel events need a plan anchor)
- `write_system_doc({ project_path, title, body, references: { files: [...], plans: [...] } })`
- `verify_system_doc({ uid })` (stamps `capturedAgainstCommit` to HEAD)
- `list_channel_events({ plan_uid, event_types: ['need-decision'] })`
- `check_doc_freshness({ uid })` (to manually verify freshness status)

**REST endpoint:**
- `GET /api/sensors/doc-check?project=<abs_path>` — triggers a bulk
  freshness check. Returns `{ staleCount, eventsSurfaced }`.

**What to verify:**

- [ ] Create a plan. Commit the current state (`git add -A && git
  commit -m "baseline"`).
- [ ] Create a system doc with `references.files` pointing to a real
  file in the project AND `references.plans` containing the plan UID.
- [ ] Call `verify_system_doc` to stamp the doc against current HEAD.
- [ ] Modify the referenced file and commit the change.
- [ ] Hit `GET /api/sensors/doc-check?project=<path>` — should return
  `staleCount: 1, eventsSurfaced: 1` (counts events posted by this
  call *or* already surfaced by the file watcher).
- [ ] Call `list_channel_events` on the plan — confirm event has:
  - `authorType: 'sensor'`
  - `payload.source: 'doc-sensor'`
  - `payload.docSlug` (truthy)
  - `payload.changedFiles` containing the modified file's relative path
- [ ] **Dedup test:** Hit `/api/sensors/doc-check` again — should return
  `eventsSurfaced: 1` (the event was already surfaced; the count
  reflects "team has been notified", not "freshly posted this call").
- [ ] **No plan anchor:** Create a doc with `references.files` but
  WITHOUT `references.plans` — confirm no channel event is posted (docs
  need a plan to post into).
- [ ] **Disable test:** Set `sensors.docs.enabled` to false, repeat the
  stale-file scenario — confirm no channel event.

### 4. Stuck sensor → channel bridge

**What changed:** The stuck sensor watches the MCP tool-call broadcast
stream. When it detects an agent looping, it posts a `stuck` channel
event. Three heuristics: repetition, error loop, idle stall.

**MCP tools involved:**
- `update_project_config` (to enable stuck + set low thresholds)
- `create_plan` (event anchor)
- Any tool called repetitively (e.g., `get_plan`) to trigger repetition
- `list_channel_events({ plan_uid, event_types: ['stuck'] })`

**What to verify:**

- [ ] Enable stuck sensor: `update_project_config({ sensors: { stuck:
  { enabled: true, repetitionThreshold: 4 } } })`.
- [ ] Create a plan.
- [ ] Call `get_plan({ plan_uid })` 5 times in a row (threshold is 4).
- [ ] Wait ~500ms, then call `list_channel_events({ plan_uid,
  event_types: ['stuck'] })`.
- [ ] Confirm at least one event has:
  - `authorType: 'sensor'`
  - `payload.source: 'stuck-sensor'`
  - `payload.heuristic: 'repetition'`
- [ ] **Cooldown test:** Immediately repeat 5 more `get_plan` calls —
  confirm NO second stuck event (10-minute cooldown per heuristic per
  session).
- [ ] **Default off:** Reset config to `sensors.stuck.enabled: false`,
  repeat the loop — confirm no stuck event.

**Note:** The error-loop and idle-stall heuristics are harder to test
in isolation because they require tool errors and time-based idle
windows respectively. The automated E2E test covers the repetition
heuristic. For error-loop, you'd need to make a tool actually error
5+ times in 10 calls — calling a tool with invalid args works (e.g.,
`get_plan({ plan_uid: 'nonexistent' })`). For idle-stall, the window
is minutes — impractical in manual testing unless you set
`idleMinutes: 1` and wait.

---

## Key implementation details the tester should know

1. **Sensor events are non-obtrusive.** They are informational channel
   events — they never hard-interrupt agents or block tool calls.

2. **`authorType: 'sensor'`** distinguishes sensor events from human
   (`user`) and agent (`agent`) posts in the channel timeline.

3. **`payload.source`** values: `'drift-sensor'`, `'doc-sensor'`,
   `'stuck-sensor'`.

4. **Debounce (drift only):** Multiple deviations within the debounce
   window are batched into a single channel event. Default 2000ms.

5. **Dedup (docs only):** A `(docUid, planUid)` pair only posts a
   channel event once per server lifecycle — but the REST endpoint's
   `eventsSurfaced` count includes events already posted by the file
   watcher, so it always reflects "has the team been notified?"
   Restarting the backend resets the dedup set.

6. **Cooldown (stuck only):** After a heuristic fires, it's suppressed
   for 10 minutes per session. Different heuristics have independent
   cooldowns.

7. **Config is deep-merged:** Setting `sensors.stuck.enabled = true`
   doesn't wipe `sensors.drift` or other stuck fields — they're
   preserved from defaults.

8. **On-disk persistence:** Sensor config is saved to
   `<project>/.codetrellis/config.json` and survives backend restarts.

---

## Reference: existing automated test patterns

The file `tests/e2e/cdev-sensors.test.ts` contains 4 tests that
exercise the full sensor surface via the real MCP wire format. Each
test:

1. Calls `setupHarness(testId)` — boots an isolated backend + fixture
2. Calls `h.client.scanProject(h.fixture.projectPath)` — scans the
   sample-app fixture
3. Calls `h.spawnAgent(...)` — creates a connected MCP agent
4. Uses `agent.callTool(name, args)` — invokes MCP tools
5. Parses results with `JSON.parse(res.text)`
6. Asserts with Playwright's `expect`
7. Cleans up in `finally { await h.teardown() }`

If modifying or adding tests, follow this pattern. The harness config
is `playwright.harness.config.ts`, workers = 1 (sequential), retries
= 2.
