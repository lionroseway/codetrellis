# Plan Export — Source-Controllable Plans

Status: Design (not yet implemented)
Last updated: 2026-04-27
Owner: open

## 1. Goal

Plans, phases, tasks, spec docs, and templates live in two places at
once:

1. **The DB** (`~/.codetrellis/data.db` — sql.js) for fast queries,
   live agent updates, and cross-plan UI.
2. **A directory of files inside the project repo**
   (`<project>/.codetrellis/plans/...`) so plans can be committed,
   reviewed in a PR, and shared across devices and agents through
   normal git.

Both stay consistent. The file is the canonical source of truth; the
DB is a fast-rebuild index over those files.

## 2. Why this matters

| Driver | Today | After this lands |
|---|---|---|
| Multi-device work | A plan authored on a laptop is invisible on a desktop unless the user manually copies `~/.codetrellis/data.db`. | `git pull` brings the plan with the code. |
| Multi-agent collaboration | Each agent sees only its host machine's DB. Two Claude Codes on two laptops can't share a plan. | Both agents read from the same `.codetrellis/plans/` checked into the repo. |
| Plan-history-as-code | DB version table holds history but it's local and disappears on `data.db` loss. | Each plan edit becomes a real git commit; full audit trail in the project's git log. |
| Plan templates as repos | Templates ship as TS data inside CodeTrellis. Adding a custom company template requires a fork. | A template is a directory anyone can `git clone` into another project's `.codetrellis/templates/`. |
| Reviewable plan changes | No surface for "my colleague wants to edit task 3" — all editing is in-app. | Plan edits become PR diffs that can be reviewed, commented on, and merged like any code change. |
| Drift across teams | Each device has its own DB; no shared notion of "the plan." | The repo is the authority. Devices just render. |

## 3. Format choice: directory of YAML + markdown

Per-plan layout at `<project>/.codetrellis/plans/<slug>/`:

```
.codetrellis/
  plans/
    auth-rework/
      plan.yaml                    Plan metadata + description
      phases/
        01-foundation.yaml
        02-data-layer.yaml
        ...
      tasks/
        001-add-jwt-types.yaml
        002-jwt-issuer.yaml
        003-token-rotation.yaml
        ...
      docs/
        00-executive-overview.md
        00.5-architecture.md
        01-phase-1.md
        ...
      versions/                    Optional — exported plan_versions
        v3.yaml
        v4.yaml
  templates/                       Local published templates (or copied)
    mass-refactor/
      template.yaml
      docs/...
      phases/...
  cache/                           gitignored — DB, snapshots, working state
```

### Why this shape

- **One file per task / phase / doc** so PR diffs are scoped — you can
  review the addition of one task without scrolling through a 200-line
  plan blob.
- **Spec docs stay markdown** rather than being embedded as YAML
  multi-line strings — readable directly on github.com, no re-render
  needed.
- **Numbered file names** for phases + docs mirror the swf
  `01-PHASE-1-…md` muscle memory and read in a sensible order in any
  file explorer.
- **A `cache/` sibling** gives the auto-sync layer a place to keep
  derived state without polluting the committable tree.

### Why YAML (not JSON)

- Human-readable; agents and humans both edit comfortably
- Supports comments (e.g. "blocked because backend team owns this")
- Multi-line strings without escaping
- Round-trips with markdown front-matter cleanly

JSON would be acceptable if YAML's parser surface area becomes a
maintenance burden; defer that decision until we see real usage.

## 4. Where: in-repo at `.codetrellis/`

Default location: **inside the project repo** at
`<project>/.codetrellis/plans/`.

- The committable tree (`plans/`, `templates/`) is checked in.
- The runtime tree (`cache/`) is gitignored. The CodeTrellis installer
  / first-run helper drops a `.codetrellis/.gitignore` with:
  ```
  cache/
  ```

A user who doesn't want a particular plan in source control simply
adds the slug to a `.codetrellisignore` file in the project root —
mirrors the `.gitignore` convention.

## 5. Sync model: file is the source of truth

Two strategies considered:

| Approach | Pros | Cons |
|---|---|---|
| **Manual export/import** | Simple, explicit, no surprises. | Easy to forget. Risk of "I made changes in-app then `git pull`'d and lost them." |
| **Auto-sync (file canonical, DB cached)** | Mental model matches IDEs (file = truth). Multi-device "just works" with `git pull`. | Slightly more plumbing; need to handle file/DB conflicts. |

**Choose auto-sync.** Reasoning:

1. The whole point of the feature is that multi-device works without
   thinking. Manual export/import preserves the original problem.
2. Conflict surfaces are well-understood: external file edits win,
   we surface a banner if the in-app view is stale.

### Implementation outline

1. **On project open**: scan `<project>/.codetrellis/plans/`. Build a
   plan-uid → file-path index. For any plan UID not in the DB, import.
   For any plan UID with a newer file `mtime` than DB `updated_at`,
   re-import.
2. **On every plan / phase / task / doc mutation**: write the affected
   file(s) immediately. The DB row `updated_at` gets the same
   timestamp as the file mtime — gives us a cheap "did I just write
   this?" comparison.
3. **File watcher** (chokidar) on `.codetrellis/plans/`: on external
   changes (mtime > DB updated_at AND no in-flight write within last
   1s), re-read and reconcile.
4. **In-app banner** when a plan currently being viewed is reloaded
   from disk: "Plan auto-reloaded from `.codetrellis/plans/auth-rework/`
   — refresh."

## 6. Conflict resolution

External writes win. Specifically:

- **Last-writer-wins at file granularity.** The unit of conflict is
  one file (one task, one phase, one doc). If Alice edits task A
  in-app and Bob's `git pull` lands a new task A from the file,
  Alice's in-flight DB write is overwritten when the watcher
  reconciles. Alice gets a banner: "task `001-add-jwt-types.yaml` was
  updated externally and reloaded."
- **Real merge conflicts** (e.g. `<<<<<<<` markers in a YAML file
  after `git merge`) are surfaced as a banner pointing to the file.
  We don't try to in-app-resolve YAML conflict markers — the user
  resolves in their editor and re-saves; the watcher picks up the
  clean version.
- **No per-field merge for v1.** Adding "Alice changed status, Bob
  changed description, both win" is interesting but not v1. If a
  case proves common, we add it later.

## 7. Versioning

Existing tables (`plan_versions`, `plan_document_versions`) stay as-is
for fast in-session "undo last 30 minutes" / "diff vs an hour ago."

Git provides the durable, shareable history. No need to mirror DB
versions back to disk. (Optional `versions/` directory remains in the
spec for users who want explicit pinned versions outside git.)

## 8. Identity

UIDs are stable across export → import → re-export. The schema:

- Every `plan.yaml` / `phase`/`task`/`doc` file carries its UID in a
  top-level `uid:` field (or markdown front-matter for docs).
- Importer keys off UID, never the file path or title — renaming a
  task file doesn't fork its history.
- Slugs (used for the directory + file names) are derived from the
  title at create-time and don't auto-rename when the title changes.
  The UID is canonical.
- UID collisions on import (extremely rare with UUID v4 — two devices
  offline-creating the same plan) are reported as a warning and the
  newer record wins (later `updated_at`).

## 9. Scope: what's exportable

**Authored artefacts** (round-trip via files):

- Plan
- Phases
- Tasks (incl. all 8 fields: `affectedFiles`, `affectedSymbols`,
  `newConnections`, `removedConnections`, `dependencies`, `fileSpec`,
  `symbolSpecs`, `phaseUid`)
- Spec docs (with `orderHint` + `parentDocUid`)
- Plan templates

**Runtime / device-local state** (DB only, NOT exported):

- Comments (private to a session)
- Deviations (re-derived on scan)
- Trellis snapshots (per-device baseline)
- Agent sessions (live state)
- Cross-system edges (re-derived from callsites)
- Recent projects, AST data, file cache

If a comment ever needs to be shared across devices, we'll add a
"shared comments" surface that's separately exported. v1 keeps that
surface device-local.

## 10. File format examples

### `plan.yaml`

```yaml
# Generated by CodeTrellis. Edit as you like, but keep `uid` stable.
uid: 8b2c7e3a-4f1e-4d2b-9a1c-5f3e2d1b9a0c
title: Auth rework
description: |
  Move the customer-facing app from session cookies to JWT, with
  refresh-token rotation and per-tenant signing keys. Multi-phase
  refactor — see `phases/` for the breakdown.
status: in_progress
author: you@example.com
authorType: human
projectPath: .
createdAt: "2026-04-27T10:14:00Z"
updatedAt: "2026-04-28T16:42:00Z"
```

### `phases/01-foundation.yaml`

```yaml
uid: a1b2c3d4-1111-2222-3333-444455556666
phaseNumber: 1
title: Foundation
status: in_progress
gitCheckpoint: v1.4-foundation-complete
scope: |
  ## Backend
  - JWT types + signing helpers
  - Token-rotation hooks

  ## Frontend
  - Shared `JwtPayload` type imported from `@shared/auth-types`
prerequisites: |
  None — first phase.
acceptanceCriteria: |
  - [ ] `@shared/auth-types` compiles across all packages
  - [ ] CI gates pass
  - [ ] No functional behaviour change yet (types only)
```

### `tasks/001-add-jwt-types.yaml`

```yaml
uid: 7c8d9e0f-aaaa-bbbb-cccc-ddddeeeeffff
sortOrder: 0
phaseUid: a1b2c3d4-1111-2222-3333-444455556666
description: Add JwtPayload + AuthError types
status: done
assignee: claude-code
assigneeType: claude-code
assigneeModel: claude-opus-4
affectedFiles:
  - packages/shared/src/auth-types.ts
affectedSymbols:
  - JwtPayload
  - AuthError
newConnections: []
removedConnections: []
dependencies: []
fileSpec: |
  Defines the cross-package JWT payload shape so backend signers and
  frontend decoders agree without runtime coupling.
symbolSpecs:
  - name: JwtPayload
    kind: interface
    action: add
    signature: |
      interface JwtPayload {
        sub: string;
        exp: number;
        iat: number;
        tenantId: string;
      }
  - name: AuthError
    kind: type
    action: add
    signature: |
      type AuthError =
        | 'expired'
        | 'invalid_signature'
        | 'tenant_mismatch'
```

### `docs/00-executive-overview.md`

```markdown
---
uid: 12345678-1234-5678-1234-567812345678
docType: executive_summary
orderHint: "00"
parentDocUid: null
version: 3
---

# Executive overview

This plan moves the customer-facing app from session-based auth to
JWT...
```

YAML front-matter for metadata, body is just markdown — same
convention used by Hugo, Jekyll, etc. Renders correctly on GitHub
without any CodeTrellis-specific tooling.

### `templates/mass-refactor/template.yaml`

```yaml
id: mass-refactor
label: Mass refactor (swf-style)
shortDescription: 6-phase modernisation with executive overview, ...
defaultTitle: "Mass refactor: {name}"
phases:
  - phaseNumber: 1
    title: Foundation
    scopeFile: phases/01-foundation.md
    ...
docs:
  - key: overview
    orderHint: "00"
    docType: executive_summary
    titlePath: docs/00-executive-overview.md
    bodyPath: docs/00-executive-overview.md
  ...
```

A template is a directory you can drop into another project's
`.codetrellis/templates/` and the in-app picker will offer it.

## 11. Phased delivery

### Phase 1 — Manual export, manual import (one push)

- New service `plan-file-service.ts` with:
  - `exportPlan(planUid, projectRoot): string[]` — returns the file
    paths it wrote.
  - `importPlan(filePath): Plan` — reads a `plan.yaml` + sibling
    files and upserts the DB.
  - `serializePlanToYaml(plan)` / `parsePlanYaml(content)` helpers.
- New REST `POST /api/plans/:uid/export?path=<projectRoot>` and
  `POST /api/plans/import?path=<filePath>`.
- New MCP `export_plan_to_files` and `import_plan_from_files` so
  agents can drive the round-trip.
- New "Export to .codetrellis/" button on each plan in the UI; new
  "Import plan from file..." menu item.
- Documents the format (this doc + a quickstart in `codetrellis://skill`).

This delivers the multi-device story without the auto-sync
complexity.

### Phase 2 — Auto-sync (one push)

- File watcher on `<project>/.codetrellis/plans/` runs in the same
  chokidar instance the file-watcher already uses.
- Write-through: every `createPlan` / `updatePlan` /
  `createPhase` / etc. emits the affected files immediately after
  the DB write.
- Banner UI for "plan auto-reloaded from disk."
- Conflict-marker detection in the YAML parser → user banner.
- New plans default to "linked-to-file"; existing DB-only plans get a
  "Link to file" button in the plan header.

### Phase 3 — Templates as publishable repos (one push)

- "Publish as template" extracts a plan dir + scrubs project-specific
  paths into placeholders.
- A user can `git clone` a template repo into
  `.codetrellis/templates/` and the in-app picker will offer it
  alongside the built-ins.
- Optional: a template registry on codetrellis.dev for one-click
  installs (out of scope for this design).

## 12. Out of scope (for now)

- **Real-time collab** (multi-cursor editing). Use git for sync; live
  collab is its own product.
- **Cloud sync without git.** We lean on git as the transport.
  Companies that don't use git would need a different transport
  layer; defer.
- **Encryption at rest beyond what the repo already provides.** If
  the repo is private, plans inherit that privacy. If it's public,
  don't put secrets in plans.
- **Per-field merging** of concurrent edits. Last-writer-wins at
  file granularity is enough for v1.

## 13. UX for multi-device plan management

The mechanics in §3–§9 are necessary but not sufficient. Here's the
UX layer that makes multi-device feel native to a developer who
already lives in git.

### Discovery

- **First-time-in-a-project banner** — when CodeTrellis opens a
  project for the first time and detects an existing
  `.codetrellis/plans/` directory, show a one-line banner:
  *"This project has 3 shared plans. Open the Plans tab to see them."*
  Auto-dismiss on first plan-open.
- **First plan-create wizard** — when a user creates the very first
  plan in a project, ask exactly one question: *"Commit this plan
  with your project so your team / other devices can see it?"* with
  defaults `[Yes — commit it] (recommended)` and `[No — keep local]`.
  Remember the choice per-project. No more dialogs after that.
- **Plan list status badges** — each plan in the sidebar list shows a
  tiny git-status pill:
  - `synced` (file matches DB matches git HEAD)
  - `local` (DB-only — not committed yet)
  - `ahead` (DB newer than file → click to push the change to the file)
  - `pulled` (file changed externally since last view → small dot until acknowledged)
  - `conflict` (YAML markers detected → file path link)

### Authoring decisions

- **Per-plan visibility toggle** — a tiny `[ Local ⇄ Shared ]` switch
  on the plan header. Toggling "Local → Shared" materialises the
  files (with a confirmation showing what will be written).
  Toggling "Shared → Local" deletes the files (with confirmation;
  the DB rows survive).
- **Default at project level** — settings → "New plans default to:
  Shared / Local." Most teams set this once.

### Awareness during work

- **Live external-update banner** — non-modal top banner: *"`auth-rework`
  was updated externally and reloaded — `git pull` brought in 1 task
  change."* Click to see what changed. Auto-dismisses after 5s.
- **Conflict surface** — modal when YAML conflict markers are
  detected: *"`tasks/003-token-rotation.yaml` has unresolved git
  conflicts. Resolve in your editor and CodeTrellis will pick up the
  change."* Includes a "Reveal in Finder" button.
- **Multi-agent visibility extension** — the existing
  `ConnectedAgents` widget already shows "claude-code · machine A"
  vs "claude-code · machine B" via session id. Extend the popover
  with the device hostname when present so two Claude Codes from
  different machines are visually distinct.

### Identity (cross-device attribution)

Today: plan/task/comment `author` is `'human'` or `'agent'` — a role,
not a person. Across devices that breaks: "who marked this task
done?" can't be answered.

Add a **user identity setting** at first-run or in settings:

- **Display name** (e.g. *Your Name*) — shown in the plan author
  field, in attributions on the timeline, in conflict banners.
- **Email** (e.g. `you@example.com`) — used as the stable id for
  attributions. We don't validate or send anywhere; it's the same
  contract as `git config user.email`.
- **Default to `git config --get user.name` + `user.email`** read
  from the active project — feels native to anyone with git
  configured.

The `Plan.author` / `Task.assignee` fields then become
`"you@example.com"` instead of `"human"`. Backwards compatible —
existing rows stay valid; new rows pick up the identity.

### Settings surface

Today we have no in-app settings. A small **Settings** panel
(gear icon top-right of the TopBar, or `Cmd+,`) covering:

| Section | Settings |
|---|---|
| **Identity** | Display name, email (defaults from `git config`) |
| **MCP server** | Port (default 19432), "Copy config to clipboard" / "Regenerate `~/.cursor/mcp.json`" / "Regenerate `~/.codex/config.json`" buttons, autodetect-port checkbox (try 19432→19433→… on conflict) |
| **Plans** | Default visibility for new plans (Shared / Local), default project path for `.codetrellis/` (usually `<projectRoot>/`), "rebuild plan index" maintenance button |
| **Data** | Data directory (default `~/.codetrellis/`), "Export DB to file" / "Import DB from file" / "Reset" maintenance buttons |
| **Telemetry** | (None today — explicit "off by default" note for trust) |

Persisted in `~/.codetrellis/settings.json` so updates don't lose
them.

### Why these specific UX choices

- **Convention over configuration**: defaulting `.codetrellis/plans/`
  to in-repo means developers don't have to think about where state
  lives. They git-add it like any other artefact.
- **Git semantics, not custom sync**: every developer already has a
  mental model of "pull, edit, commit, push." We piggyback on it
  rather than inventing a parallel workflow.
- **Editor parity**: YAML + markdown both render in any IDE. A
  developer can edit `tasks/001-add-jwt-types.yaml` in VS Code
  without launching CodeTrellis at all. CodeTrellis becomes the
  *visualisation + agent-orchestration* layer, not a required
  authoring environment.
- **Identity from `git config`**: zero-config for the 95% case of
  someone with git configured.
- **MCP port configurable, with autodetect**: the developer running
  CodeTrellis alongside another tool that's grabbed 19432 (rare but
  possible) shouldn't have to debug a connection failure — we just
  pick the next port and tell them.
- **No telemetry**: trust matters more than analytics for a tool
  developers run on their own code.

## 15. Open questions

- **Slug uniqueness across renames** — if a plan title changes from
  "Auth rework" to "JWT migration", do we rename the directory? My
  vote: no, keep the original slug; show the current title in the UI.
  Renaming creates churn in PRs.
- **Migration for existing DB-only plans** — when we ship Phase 1,
  what happens to plans that already exist in `data.db`? My vote:
  they stay DB-only until the user clicks "Export." No migration step.
- **`<plan>` ↔ `<system>` cross-references** — once Phase 11 §3 lands
  the systems table, plans may reference systems. Do we serialise
  them as a system uid (volatile) or a path glob (stable)? Defer.
- **Binary attachments** — should we support image attachments inside
  spec docs? If so, where do they live? Probably `<plan>/attachments/`,
  referenced from the doc body via relative path. Defer until a real
  user case appears.

## 16. Acceptance criteria for the design as a whole

When this is fully shipped, a user should be able to:

1. Create a plan in CodeTrellis on laptop A.
2. `git add .codetrellis/plans/<slug>/` and `git commit + push`.
3. On desktop B, `git pull` and open the project in CodeTrellis.
4. The plan appears immediately, identical to laptop A.
5. Edit a task on desktop B; on save, the file changes; commit + push.
6. On laptop A, `git pull`; the in-app view auto-reloads with the
   change and a small banner notes the external update.
7. On a Mac running Codex and a different Mac running Claude Code,
   both agents `register_session`, `set_active_plan(<the-shared-uid>)`,
   and read the same plan from disk via the file-source-of-truth
   sync.
8. A team can publish their organisation's "Mass refactor" template
   as a git repo; another team `git clone`s it into
   `.codetrellis/templates/` and the in-app picker offers it.

That's the bar.
