# Phase 5 (Personal Continuity) — Tester Agent Instructions

You are testing **CDev Phase 5: Personal Continuity & App Polish** in
CodeTrellis. Phase 5 adds three user-facing features: a first-run
onboarding wizard, per-item visibility controls in the plan tree, and
personal sync (settings + project list export/import across machines).

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

There are 3 automated tests:
1. First-run check and completion round-trip
2. Per-item visibility toggle round-trips through API
3. Personal sync export and import cycle

If all 3 pass, the core wiring is solid. The manual scenarios below
cover what the automated tests can't.

---

## What Phase 5 changed (surfaces to test)

### 1. First-run onboarding wizard (5.1)

**What changed:** When `settings.firstRunComplete` is false (fresh
install), the app shows a blocking `FirstRunWizard` overlay before
the main shell renders. Two steps: identity confirmation, then a
"ready" screen with MCP config snippet.

**Files involved:**
- `src/frontend/components/FirstRunWizard.tsx`
- `src/frontend/App.tsx` (gate logic)
- `src/shared/types/settings.ts` (`firstRunComplete` field)
- `src/backend/services/settings-service.ts` (merge + persistence)
- `src/backend/server.ts` (`/api/settings/first-run-check` endpoint)

**What to verify:**

- [ ] Delete `~/.codetrellis/settings.json` (or start with a fresh
  data dir). Open the app — the wizard should appear.
- [ ] Step 1: name and email should be pre-populated from `git config`.
  Edit them and click Next — changes should save.
- [ ] Step 2: MCP config snippet should show the correct port. "Copy"
  button should work.
- [ ] Click "Get started" — the wizard should close and the main app
  should render. The wizard should NOT appear on subsequent launches.
- [ ] Verify `~/.codetrellis/settings.json` has `firstRunComplete: true`
  and the identity fields you entered.
- [ ] **Backend unreachable:** If the backend is down when the frontend
  boots, the wizard should fail gracefully (skip to the main app
  rather than hanging).

### 2. Per-item visibility in plan tree (5.2)

**What changed:** The `PlanItemTree` sidebar now shows visibility
indicators. Local items display a small `EyeOff` icon that's always
visible. The context menu (⋯) on each row has a "Make shared" / "Make
local" toggle. The tree header shows a bulk count + toggle when any
items are local.

**Files involved:**
- `src/frontend/components/plan/v2/PlanItemTree.tsx`

**What to verify:**

- [ ] Create a plan with several items. All should show as shared by
  default (no EyeOff icon visible).
- [ ] Right-click (⋯ menu) on an item → "Make local" — the item should
  show a small violet EyeOff icon.
- [ ] The tree header should show a count badge (e.g., "1") next to the
  EyeOff icon. Click it — all local items should become shared again.
- [ ] Click the EyeOff icon on a local item — it should toggle back to
  shared.
- [ ] Set multiple items to local — confirm the header count updates.
  Click the header badge — all flip to shared in one action.
- [ ] Open the item in the canvas (PlanItemCanvas) — confirm the
  existing pill toggle ("Local" / "Shared") still works and stays in
  sync with the tree indicator.

### 3. Personal sync (5.3)

**What changed:** New `DataSettings` fields: `personalSyncPath` and
`personalSyncMode`. A `personal-sync-service.ts` handles export/import
of settings + recent-project list to a user-controlled directory. The
Settings panel has a new "Sync" section. REST endpoints:

- `GET /api/sync/status`
- `GET /api/sync/peek`
- `POST /api/sync/export`
- `POST /api/sync/import`

**What to verify:**

- [ ] Open Settings → Sync. The section should explain what sync does.
- [ ] Enter a path to a folder (e.g., `/tmp/ct-sync-test`). Set mode to
  "Settings + projects". Click away to save.
- [ ] The status widget should show "Sync directory exists" (green dot)
  or "not found" (amber dot).
- [ ] Click "Export now" — should succeed. Check the folder: a
  `codetrellis-sync/` subdirectory should contain `settings.json`,
  `recent-projects.json`, and `.sync-meta.json`.
- [ ] Open `codetrellis-sync/settings.json` — verify
  `personalSyncPath` and `dataDirOverride` are empty strings (stripped
  as machine-local).
- [ ] Change your identity in Settings → Identity (e.g., to "New Name").
- [ ] Click "Import from [hostname]" in the Sync section — identity
  should revert to the exported values.
- [ ] **No sync configured:** Set mode to "Off" and try Export — should
  fail gracefully with a message.
- [ ] **Invalid path:** Set sync path to a non-writable location — Export
  should fail with an error message, not crash.

---

## Key implementation details

1. **`firstRunComplete` is in `settings.json`**, not localStorage. It
   survives across machines if settings are synced. Older settings
   files missing this field default to `false` (backward-compat).

2. **Visibility indicators are non-intrusive.** Shared items (the
   default) show nothing. Only local items display the EyeOff icon,
   keeping the tree clean for the common case.

3. **Bulk visibility toggle** in the tree header fires parallel
   `updateItem` calls — on large plans it may take a moment.

4. **Personal sync is BYO transport.** CodeTrellis writes files; the
   user's folder-sync mechanism (git, iCloud, Dropbox) handles
   propagation. We never initiate network operations.

5. **Machine-local fields are stripped on export:**
   `personalSyncPath` and `dataDirOverride` are always empty in the
   exported settings — each machine has its own paths.

6. **Sync dedup by machine ID.** The `.sync-meta.json` includes a
   hash of `hostname:homedir`. The "Import" button only appears when
   the export came from a different machine.

---

## Reference: automated test patterns

The file `tests/e2e/cdev-phase5.test.ts` contains 3 tests. Each:

1. Calls `setupHarness(testId)` — boots an isolated backend + fixture
2. Uses `h.client.raw()` for REST calls or `agent.callTool()` for MCP
3. Asserts with Playwright's `expect`
4. Cleans up in `finally { await h.teardown() }`

The harness config is `playwright.harness.config.ts`, workers = 1
(sequential), retries = 2.
