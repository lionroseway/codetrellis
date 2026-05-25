# Phase 7 (External Contributors) — Tester Agent Instructions

You are testing **CDev Phase 7: External Contributors** in
CodeTrellis. Phase 7 adds three features: pantry resolution
(graceful placeholders for missing attachments), promote-to-PR
staging for contributor work, and filtered branch preparation
for selective sharing with contractors.

## Environment

Project root: `/Users/saif/Workspaces/AILAR/codetrellis`

### Running the E2E test suite (automated)

```bash
npx playwright test --config playwright.harness.config.ts cdev-phase7
```

There are 4 automated tests:
1. Pantry resolution resolves existing files and flags missing ones
2. Promote and list contributions round-trip via MCP
3. Accept contributions moves items into plan manifest
4. Prepare contributor branch creates filtered branch with shared items only

---

## What Phase 7 changed (tools & surfaces to test)

### 1. Pantry resolution (7.1)

**MCP tools:**
- `resolve_pantry_references({ project_path, references?, plan_slug? })` — check resolution status of attachment references

**REST endpoints:**
- `GET /api/pantry/resolve?project=<path>&refs=<ref1>&refs=<ref2>` — resolve specific references
- `GET /api/pantry/resolve?project=<path>&plan_slug=<slug>` — scan all references in a plan

**What to verify:**

- [ ] Existing project-relative files return `status: "resolved"`.
- [ ] Missing project-relative files return `status: "external"` with reason.
- [ ] `userdata://` references return `external` (unless the user data dir has the file).
- [ ] `https://` URLs always return `resolved` (no existence check needed).
- [ ] Path traversal attempts (e.g., `../../etc/passwd`) return `external` with appropriate reason.
- [ ] `scanPlanReferences` correctly extracts attachment values from YAML files in the plan directory.

### 2. Promote-to-PR controls (7.2)

**MCP tools:**
- `promote_to_contribution({ project_path, item_uid, title, kind, status?, body?, description?, attachments? })` — stage an item
- `list_contributions({ project_path })` — list staged items on current branch
- `accept_contributions({ project_path, branch, plan_slug })` — accept into plan manifest

**REST endpoints:**
- `GET /api/contributions?project=<path>` — list contributions on current branch
- `GET /api/contributions?project=<path>&branch=<name>` — list for specific branch
- `POST /api/contributions/promote` (body: `{ projectPath, itemUid, title, kind, ... }`)
- `POST /api/contributions/accept` (body: `{ projectPath, branch, planSlug }`)

**What to verify:**

- [ ] `promote_to_contribution` creates files in `.codetrellis/contributions/<branch>/items/`.
- [ ] Multiple promotes accumulate in the same branch staging area.
- [ ] `list_contributions` returns all staged items with correct metadata.
- [ ] An `index.json` is maintained in the contributions directory.
- [ ] `accept_contributions` moves items into `plans/<slug>/items/` with proper sort numbering.
- [ ] After acceptance, the contributions directory for that branch is deleted.
- [ ] Promoting the same UID twice upserts (doesn't duplicate).
- [ ] Promoting with attachments array serializes them inline in the YAML.

### 3. Fork-from-prepared-state (7.3)

**MCP tools:**
- `prepare_contributor_branch({ project_path, plan_slug, branch_name, include_items? })` — create filtered branch

**REST endpoints:**
- `POST /api/contributor-branch` (body: `{ projectPath, planSlug, branchName, includeItems? }`)

**What to verify:**

- [ ] Creates a new git branch with the specified name.
- [ ] The branch contains only shared items (local items are excluded).
- [ ] `userdata://` attachment references are stripped from items on the branch.
- [ ] Private comments (visibility: local) are stripped.
- [ ] The `visibility` and `overrideParentVisibility` fields are stripped from exported items.
- [ ] After preparation, the original branch is restored (not left on the contributor branch).
- [ ] When `include_items` is specified, only those item UIDs appear (regardless of visibility).
- [ ] The commit on the new branch has a descriptive message.
- [ ] If the branch name already exists, the operation fails with an error (not silent overwrite).

---

## Key implementation details

1. **Pantry resolution is filesystem-only.** It checks `fs.existsSync()` for project-relative and userdata:// paths. URLs are always resolved without a network call.

2. **Contributions staging area** lives at `.codetrellis/contributions/<branch>/`. Structure:
   ```
   .codetrellis/contributions/<branch>/
     index.json          # quick-list of all contributions
     items/
       <slug>.yaml       # promoted item content
     attachments/
       <uid>.<ext>       # promoted attachment bytes
       <uid>.meta.yaml   # attachment metadata
   ```

3. **Branch detection** uses `git rev-parse --abbrev-ref HEAD`. On detached HEAD, falls back to "detached".

4. **Accept removes the staging directory** entirely after moving content. This is intentional — contributions are a one-shot staging mechanism, not persistent state.

5. **Prepare contributor branch uses `execFileSync`** (not execSync) — no shell injection vector via branch names or plan slugs.

6. **The contributor branch commit** includes only the `.codetrellis/` directory changes. Code changes would be on top, committed by the contributor later.

7. **Visibility filtering** during branch preparation reads item YAML directly from disk (not from the DB). Items without an explicit `visibility` field default to `shared`.
