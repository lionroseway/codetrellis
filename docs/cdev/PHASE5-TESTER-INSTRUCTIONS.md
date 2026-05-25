# Phase 5 (Personal Continuity) — Tester Agent Instructions

You are testing **CDev Phase 5: Personal Continuity & App Polish** in
CodeTrellis. Phase 5 adds three user-facing features: a first-run
onboarding wizard, per-item visibility controls in the plan tree, and
personal sync (settings + project list export/import across machines).
Your job is to verify each surface via MCP tools and REST endpoints.

## Environment

You are on the same machine as the codebase. The project root is:

```
/Users/saif/Workspaces/AILAR/codetrellis
```

### Running the E2E test suite (automated)

The automated tests for Phase 5 live at:

```
tests/e2e/cdev-phase5.test.ts
```

Run them with:

```bash
npx playwright test --config playwright.harness.config.ts cdev-phase5
```

This uses `playwright.harness.config.ts` (NOT the default
`playwright.config.ts`). Each test boots its own backend — no dev
server needed.

There are 3 automated tests:
1. First-run check and completion round-trip
2. Per-item visibility toggle round-trips through API
3. Personal sync export and import cycle

If all 3 pass, the core wiring is solid. The manual scenarios below
cover what the automated tests can't.

---

## What Phase 5 changed (tools & surfaces to test)

### 1. First-run onboarding wizard (5.1)

**What changed:** A `firstRunComplete` boolean was added to
`AppSettings`. When false (fresh install), the frontend shows a
blocking `FirstRunWizard` before the main shell. The backend exposes
a lightweight check endpoint and the existing settings API persists
the flag.

**MCP tools involved:**
- `get_settings` (to read current settings including `firstRunComplete`)
- `update_settings` (to set identity + `firstRunComplete`)

**REST endpoints:**
- `GET /api/settings/first-run-check` — returns `{ firstRunComplete, identity, gitDefaults }`
- `GET /api/settings` — full settings
- `PUT /api/settings` — patch settings

**What to verify:**

- [ ] Call `get_settings` — confirm `firstRunComplete` exists in the
  response and defaults to `false` on a fresh install (or `true` if
  the app has been used before).
- [ ] Call `update_settings({ identity: { displayName: "Test User", email: "test@ct.dev" } })`
  — confirm identity updates without touching other fields.
- [ ] Call `update_settings({ firstRunComplete: true })` — confirm the
  flag persists.
- [ ] Call `get_settings` again — confirm `firstRunComplete: true` and
  identity fields are both present (deep-merge preserved both patches).
- [ ] Check on-disk at `~/.codetrellis/settings.json` — the
  `firstRunComplete` field should be `true`.
- [ ] **Backward compat:** If you have an older `settings.json` that
  lacks `firstRunComplete`, `get_settings` should return `false`
  (the default), not error.

### 2. Per-item visibility in plan tree (5.2)

**What changed:** The plan item tree sidebar (`PlanItemTree.tsx`) now
shows visibility indicators and toggle controls. Local items get a
violet EyeOff icon. The context menu has a shared/local toggle. The
header shows a bulk-share badge when local items exist.

**MCP tools involved:**
- `create_plan` (to set up a test plan)
- `add_item` (to create items)
- `update_item({ uid, visibility: 'local' | 'shared' })` (to toggle)
- `get_item` (to read back)
- `list_items` (to see all items with their visibility)

**What to verify:**

- [ ] Create a plan. Add 3 items (mix of `object` and `action` kinds).
- [ ] All items should have `visibility: 'shared'` by default.
- [ ] Call `update_item({ uid: <item1>, visibility: 'local' })` — confirm
  the response shows `visibility: 'local'`.
- [ ] Call `get_item({ uid: <item1> })` — confirm `visibility: 'local'`
  persists.
- [ ] Call `list_items({ plan_uid })` — confirm exactly one item has
  `visibility: 'local'`, others are `'shared'`.
- [ ] Toggle it back: `update_item({ uid: <item1>, visibility: 'shared' })`
  — confirm it reverts.
- [ ] **Bulk test:** Set all 3 to local, then set all 3 back to shared
  via separate `update_item` calls. Confirm `list_items` reflects each
  intermediate state correctly.

### 3. Personal sync (5.3)

**What changed:** New `DataSettings` fields: `personalSyncPath`
(string) and `personalSyncMode` (`'none' | 'selective' | 'full'`).
A `personal-sync-service.ts` handles export/import of settings +
recent-project list to a user-controlled directory. New REST endpoints
surface the sync operations.

**MCP tools involved:**
- `update_settings` (to configure sync path + mode)
- `get_settings` (to verify config persisted)

**REST endpoints:**
- `GET /api/sync/status` — returns `{ configured, mode, syncPath, syncDirExists, lastExportAt, lastImportAvailable, remoteMachine }`
- `GET /api/sync/peek` — returns `{ available, hasSettings, hasRecentProjects, recentProjectCount, remoteMachine, lastExportAt }`
- `POST /api/sync/export` — returns `{ exported, syncDir, error? }`
- `POST /api/sync/import` — returns `{ imported, settingsImported, recentProjects, error? }`

**What to verify:**

- [ ] Call `update_settings({ data: { dataDirOverride: '', personalSyncPath: '/tmp/ct-sync-test', personalSyncMode: 'selective' } })`
  — confirm settings saved.
- [ ] Call `GET /api/sync/status` — should return `configured: true`,
  `mode: 'selective'`.
- [ ] Set up identity: `update_settings({ identity: { displayName: 'Sync Tester', email: 'sync@test.dev' }, firstRunComplete: true })`
- [ ] Call `POST /api/sync/export` — should return `exported: true`.
- [ ] Check the filesystem: `/tmp/ct-sync-test/codetrellis-sync/`
  should contain `settings.json`, `recent-projects.json`, and
  `.sync-meta.json`.
- [ ] Read `/tmp/ct-sync-test/codetrellis-sync/settings.json` — verify:
  - `identity.displayName` is `'Sync Tester'`
  - `data.personalSyncPath` is `''` (stripped as machine-local)
  - `data.dataDirOverride` is `''` (stripped as machine-local)
  - `firstRunComplete` is `true`
- [ ] Call `GET /api/sync/peek` — should return `available: true`,
  `hasSettings: true`.
- [ ] **Simulate new machine:** Call `update_settings({ identity: { displayName: '', email: '' } })`
  to clear identity. Verify it's cleared with `get_settings`.
- [ ] Call `POST /api/sync/import` — should return `imported: true`,
  `settingsImported: true`.
- [ ] Call `get_settings` — identity should be restored:
  `displayName: 'Sync Tester'`, `email: 'sync@test.dev'`.
- [ ] **Mode off:** Set `personalSyncMode: 'none'`, try export — should
  return `exported: false` with an error about mode.
- [ ] **Dedup:** The `GET /api/sync/status` `lastImportAvailable` field
  should be `false` when the export came from the same machine (same
  hostname+homedir hash). It would be `true` if you edited
  `.sync-meta.json` to change the `machineId`.
- [ ] **Cleanup:** Delete `/tmp/ct-sync-test` after testing.

---

## Key implementation details the tester should know

1. **`firstRunComplete` is in `settings.json`**, not localStorage. It
   survives across machines if settings are synced. Older settings
   files missing this field default to `false` (backward-compat via
   `mergeWithDefaults` in `settings-service.ts`).

2. **Visibility is a per-item field.** The backend column + export
   filtering shipped in Phase 3.2. Phase 5.2 only added the frontend
   tree indicators. The MCP `update_item` and `get_item` tools already
   support the `visibility` field.

3. **Personal sync strips machine-local fields.** On export,
   `personalSyncPath` and `dataDirOverride` are replaced with empty
   strings. On import, only `identity`, `plans`, and `firstRunComplete`
   are merged — `mcp` and `data` settings stay local.

4. **Sync dedup by machine ID.** The `.sync-meta.json` includes a
   SHA-256 hash of `hostname:homedir` (first 12 chars). The
   `lastImportAvailable` flag in `/api/sync/status` is only true when
   the export came from a different machine.

5. **Config is deep-merged.** Setting `data.personalSyncPath` doesn't
   wipe `data.dataDirOverride` or other fields. The `updateSettings`
   function spreads `{ ...current.data, ...(patch.data ?? {}) }`.

6. **On-disk persistence.** All settings live at
   `<settingsDir>/settings.json` with atomic write (tmp + rename).
   Changes survive backend restarts.

---

## Reference: existing automated test patterns

The file `tests/e2e/cdev-phase5.test.ts` contains 3 tests that
exercise the Phase 5 surface via REST + MCP. Each test:

1. Calls `setupHarness(testId)` — boots an isolated backend + fixture
2. Uses `h.client.raw()` for REST calls or `agent.callTool()` for MCP
3. Parses results with `JSON.parse(res.text)` (MCP) or `res.json()` (REST)
4. Asserts with Playwright's `expect`
5. Cleans up in `finally { await h.teardown() }`

If modifying or adding tests, follow this pattern. The harness config
is `playwright.harness.config.ts`, workers = 1 (sequential), retries
= 2.
