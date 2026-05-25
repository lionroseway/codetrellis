# Phase 6 (Team History & Governance) — Tester Agent Instructions

You are testing **CDev Phase 6: Team History & Governance** in
CodeTrellis. Phase 6 adds five features: git-projected team activity
feed, per-plan history rail with time-travel, decision archaeology
(search), conflict resolution, and freeze periods. Your job is to
verify each surface via MCP tools and REST endpoints.

## Environment

You are on the same machine as the codebase. The project root is:

```
/Users/saif/Workspaces/AILAR/codetrellis
```

### Running the E2E test suite (automated)

```bash
npx playwright test --config playwright.harness.config.ts cdev-phase6
```

There are 4 automated tests:
1. Team activity feed returns entries for committed manifest changes
2. Plan history rail lists commits and reconstructs plan state
3. Freeze period set/get/exempt round-trip via MCP
4. Detect conflicts returns clean on non-merge state

---

## What Phase 6 changed (tools & surfaces to test)

### 1. Team activity feed (6.1)

**MCP tools:**
- `get_team_activity({ project_path, since?, limit? })` — git-projected activity feed

**REST endpoints:**
- `GET /api/team-activity?project=<path>&since=<ISO>&limit=<N>`

**What to verify:**

- [ ] After committing manifest changes, `get_team_activity` returns
  entries with correct `entityType`, `action`, `author`, `commitHash`.
- [ ] Entity types are correctly classified: `plan` for plan.yaml,
  `item` for items/*.yaml, `channel-event` for channels/*.yaml,
  `system-doc` for docs/*.md, `config` for config.json.
- [ ] The `since` parameter correctly filters by date.
- [ ] Agent attribution is parsed from Co-Authored-By trailers.

### 2. Plan history rail (6.2)

**MCP tools:**
- `get_plan_history({ project_path, plan_slug, limit?, since? })` — list commits
- `get_plan_at_commit({ project_path, plan_slug, commit_hash })` — reconstruct state
- `diff_plan_between_commits({ project_path, plan_slug, base_commit, head_commit })`

**REST endpoints:**
- `GET /api/plan-history/:planSlug?project=<path>`
- `GET /api/plan-history/:planSlug/at/:commitHash?project=<path>`
- `GET /api/plan-history/:planSlug/diff?project=<path>&base=<hash>&head=<hash>`

**What to verify:**

- [ ] `get_plan_history` returns commits in reverse-chronological order.
- [ ] `get_plan_at_commit` reconstructs the plan with correct items.
- [ ] After adding items and re-exporting, `diff_plan_between_commits`
  correctly shows added/removed/modified items.
- [ ] The plan slug format is `<title-slug>-<uid-prefix>`.

### 3. Decision archaeology (6.3)

**MCP tools:**
- `search_plan_history({ project_path, plan_slug, query, since?, until?, limit? })`

**REST endpoints:**
- `GET /api/plan-history/:planSlug/search?project=<path>&q=<query>`

**What to verify:**

- [ ] Searching for text that exists in committed plan files returns
  the correct commit(s).
- [ ] Case-insensitive search works.
- [ ] The `since` and `until` filters work.

### 4. Conflict resolution (6.4)

**MCP tools:**
- `detect_conflicts({ project_path })` — detect merge conflicts
- `resolve_conflict({ project_path, file_path, mode, side?, resolutions? })`

**REST endpoints:**
- `GET /api/conflicts?project=<path>`
- `POST /api/conflicts/resolve` (body: `{ projectPath, filePath, mode, side?, resolutions? }`)

**What to verify:**

- [ ] On a clean repo (no merge state), `detect_conflicts` returns
  `{ hasConflicts: false, files: [], totalConflicts: 0 }`.
- [ ] The tool correctly identifies structured vs freetext fields.
- [ ] `resolve_conflict` with `mode: "by_side"` picks the correct side.

### 5. Freeze periods (6.5)

**MCP tools:**
- `get_freeze_status({ project_path })` — current freeze state
- `set_freeze({ project_path, active, reason?, until?, allowed_plan_uids? })`
- `check_freeze({ project_path, plan_uid })` — is this plan allowed?
- `exempt_plan_from_freeze({ project_path, plan_uid })`

**REST endpoints:**
- `GET /api/freeze?project=<path>`
- `PUT /api/freeze` (body: `{ projectPath, active, reason?, until?, allowedPlanUids? }`)

**What to verify:**

- [ ] Initially `get_freeze_status` returns `active: false`.
- [ ] After `set_freeze({ active: true, reason: "Release freeze" })`,
  status shows `active: true` with the reason.
- [ ] `check_freeze` returns `allowed: false` for non-exempt plans.
- [ ] After `exempt_plan_from_freeze`, `check_freeze` returns `allowed: true`.
- [ ] Setting `active: false` lifts the freeze.
- [ ] Auto-expiry: if `until` is in the past, `active` should be false.
- [ ] Freeze config is persisted in `.codetrellis/config.json`.

---

## Key implementation details

1. **Activity feed is git-only.** It reads `git log --name-status`
   for `.codetrellis/`. No database. If the project has no git repo
   or no commits touching `.codetrellis/`, the feed is empty.

2. **Plan slug format** is `<slugified-title>-<uid-first-8-chars>`.
   The `get_plan_history` and related tools use slug, not UID.

3. **Freeze lives in config.json.** The `freeze` section is stored
   in `.codetrellis/config.json`, managed by the project-config-service.
   It's committed and reviewable like any other config.

4. **Conflict resolution requires merge state.** The `detect_conflicts`
   tool only finds conflicts when `.git/MERGE_HEAD` exists (i.e.,
   during an unresolved merge). Outside of merge state, it always
   returns empty.

5. **Plan history uses `git show` and `git ls-tree`.** State at a
   commit is reconstructed by listing files in the plan directory at
   that commit and parsing each YAML file. This works on any commit,
   not just committed plans.

6. **Decision archaeology uses `git log -G`.** Content search across
   history finds commits where specific text was added or removed.
   Case-insensitive.
