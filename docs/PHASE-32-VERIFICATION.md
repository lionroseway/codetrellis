# Phase 32 — Verification matrix

> **Generated** by `npm run inventory` (`tools/inventory/`). Do not edit the
> tables by hand: the behaviour, UX and notes columns come from
> `tools/inventory/verification.json`, and `npm run inventory:check` fails when
> this file is stale. Stage 0 of [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md).

"Unit" and "Harness" count the test files that **send** the row — call the tool,
send the RPC method, or make the request with that method — directly or through
a harness helper. Naming it is not enough: a fixture that phrases tool calls once
made three untested tools look tested (bug 49), and a `GET` covered the `PUT` on
the same path. Unit tests drive services directly, so the unit column is mostly
empty by design. A call is not proof of a meaningful test — the behaviour column
records that — but "✗ none" is proof of a gap.

## Summary

| Surface | Rows | No unit call | No harness call | Neither | Behaviour verified | UX checked |
|---|---|---|---|---|---|---|
| REST routes | 241 | 239 | 0 | 0 | 217 | 0 |
| MCP tools | 196 | 196 | 0 | 0 | 185 | 0 |
| Mobile RPC methods | 84 | 76 | 0 | 0 | 78 | 0 |
| Frontend components | 111 | n/a | n/a | n/a | 0 | 23 |
| Mobile screens | 35 | n/a | n/a | n/a | 0 | 0 |
| Settings sections | 12 | n/a | n/a | n/a | 10 | 12 |

## By domain

| Domain | REST | MCP | RPC | Components | Mobile | Settings |
|---|---|---|---|---|---|---|
| 0.4a Project and scan | 19 | 12 | 10 | 0 | 0 | 0 |
| 0.4b Graph | 19 | 15 | 8 | 13 | 0 | 0 |
| 0.4c Plans and items | 95 | 53 | 20 | 56 | 0 | 0 |
| 0.4d Criteria and sign-off | 9 | 7 | 3 | 0 | 0 | 0 |
| 0.4e Brief and viewer | 5 | 4 | 1 | 3 | 0 | 0 |
| 0.4f Channels and presence | 6 | 12 | 7 | 1 | 0 | 0 |
| 0.4g Agents and MCP | 25 | 32 | 10 | 26 | 0 | 0 |
| 0.4h Drift, governance, review | 10 | 24 | 8 | 0 | 0 | 0 |
| 0.4i Terminals and audio | 10 | 12 | 8 | 3 | 0 | 0 |
| 0.4j Mobile surface | 25 | 14 | 0 | 2 | 35 | 0 |
| 0.4k Settings, updates, privacy | 11 | 0 | 3 | 6 | 0 | 12 |
| 0.4l System docs and intake | 7 | 11 | 6 | 1 | 0 | 0 |

## MCP tools: registry vs capability matrix

- Registered by the server: **196**
- Rows in `TOOL_CAPABILITIES`: **196**
- Rows for tools the server does not register: none
- Registered tools with no row (refused at call time): none

## REST routes (241)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `DELETE /api/recent-projects` |  | ✗ none | 4 | ✓ 0.4a: removes a listed entry, including one whose directory is gone (project-open) |  |  |
| a | `GET /api/auto-detect` |  | ✗ none | 1 | ✓ 0.4a: live sessions only, with branch (auto-detect) |  |  |
| a | `GET /api/build-info` |  | ✗ none | 1 | ✓ 0.4a: version/commit stamp, token-gated (smoke, transport-auth) |  |  |
| a | `GET /api/fs/browse` |  | ✗ none | 2 | ✓ 0.4a: lists a home dir; / /etc /var refused (misc-endpoints, filesystem-boundary) |  |  |
| a | `GET /api/git/branch` |  | ✗ none | 2 | ✓ 0.4a: main checkout and linked worktree (git-integration, worktree-project; bug 16) |  |  |
| a | `GET /api/git/branch-tip` |  | ✗ none | 2 | ✓ 0.4a: tip equals HEAD; option-like refs refused (git-integration) |  |  |
| a | `GET /api/git/commits` |  | ✗ none | 1 | ✓ 0.4a: recent commits with hashes and subjects (git-integration) |  |  |
| a | `GET /api/git/head` |  | ✗ none | 2 | ✓ 0.4a: matches status hash (git-integration) |  |  |
| a | `GET /api/git/info` |  | ✗ none | 3 | ✓ 0.4a: branches incl. packed, other checkouts, hasCommits — from a worktree too (worktree-project; bug 16) |  |  |
| a | `GET /api/git/status` |  | ✗ none | 1 | ✓ 0.4a: hash and file arrays (git-integration) |  |  |
| a | `GET /api/git/worktrees` |  | ✗ none | 2 | ✓ 0.4a: both checkouts and the other one's plans, from a worktree; unopened refused (worktree-project, misc-endpoints) |  |  |
| a | `GET /api/health` |  | ✗ none | 3 | ✓ 0.4a: status, parser, memory (misc-endpoints, smoke) |  |  |
| a | `GET /api/identity/git-defaults` |  | ✗ none | 2 | ✓ 0.4a: the project's own git identity (project-open) |  |  |
| a | `GET /api/onboarding-state` |  | ✗ none | 2 | ✓ 0.4a: moves with plans and connected agents (project-open) |  |  |
| a | `GET /api/project-config` |  | ✗ none | 1 | ✓ 0.4a: repoRole per project (cdev-central-oversight) |  |  |
| a | `GET /api/recent-projects` |  | ✗ none | 5 | ✓ 0.4a: branch recorded, pinned first (project-open, worktree-project) |  |  |
| a | `GET /api/stats` |  | ✗ none | 2 | ✓ 0.4a: counts track rescans (project-open, smoke) |  |  |
| a | `POST /api/project/scan` |  | ✗ none | 139 | ✓ 0.4a: seeds identity once; rescan adds and drops files (project-open, and 60+ others) |  |  |
| a | `POST /api/recent-projects/pin` |  | ✗ none | 2 | ✓ 0.4a: reorders, and unpin restores recency order (project-open) |  |  |
| b | `GET /api/architecture-summary` |  | ✗ none | 3 | ✓ 0.4b: counts match stats; dirs, languages, most-imported (graph-rest) |  |  |
| b | `GET /api/coverage` |  | ✗ none | 1 | ✓ 0.4b: unread code by reason, unserved routes (coverage) |  |  |
| b | `GET /api/cross-system` |  | ✗ none | 6 | ✓ 0.4b: the fixture's six pairings, before and after changes (cross-system) |  |  |
| b | `GET /api/dependencies` |  | ✗ none | 4 | ✓ 0.4b: edges after scan (smoke, cross-system) |  |  |
| b | `GET /api/dependencies/file` |  | ✗ none | 4 | ✓ 0.4b: matches get_dependencies; relative or absolute (graph-tools; bug 17) |  |  |
| b | `GET /api/diff` |  | ✗ none | 5 | ✓ 0.4b: empty after scan; added/modified files, new edge, blast radius, git untracked — live, no rescan (graph-rest; bug 20) |  |  |
| b | `GET /api/file/at` |  | ✗ none | 3 | ✓ 0.4b: content at a commit or snapshot (file-at, review-comparand-edges) |  |  |
| b | `GET /api/file/content` |  | ✗ none | 2 | ✓ 0.4b: returns the file's exact content; outside opened projects 403 (misc-endpoints, filesystem-boundary) |  |  |
| b | `GET /api/file/overlay` |  | ✗ none | 2 | ✓ 0.4b: plan edits mapped onto lines (plan-overlay) |  |  |
| b | `GET /api/playback` |  | ✗ none | 2 | ✓ 0.4b: discrete frames between comparands (playback) |  |  |
| b | `GET /api/replay/frames` |  | ✗ none | 1 |  |  |  |
| b | `GET /api/replay/state` |  | ✗ none | 1 |  |  |  |
| b | `GET /api/symbols/file` |  | ✗ none | 6 | ✓ 0.4b: flat qualified symbols per language (go/ruby/jvm-apple support, smoke) |  |  |
| b | `GET /api/symbols/search` |  | ✗ none | 3 | ✓ 0.4b: finds symbols by name, incl. through a workspace alias (smoke, input-validation) |  |  |
| b | `GET /api/systems` |  | ✗ none | 3 | ✓ 0.4b: the fixture's services by path (graph-rest) |  |  |
| b | `GET /api/trellis/:id` |  | ✗ none | 1 | ✓ 0.4b: includes the branch (baselines) |  |  |
| b | `GET /api/trellis/:id/diff` |  | ✗ none | 2 | ✓ 0.4b: empty at capture; then the new file and its edge, live; 404 unknown (baselines) |  |  |
| b | `GET /api/trellis/snapshots` |  | ✗ none | 1 | ✓ 0.4b: lists the capture (baselines) |  |  |
| b | `POST /api/trellis/capture` |  | ✗ none | 3 | ✓ 0.4b: (baselines) |  |  |
| c | `DELETE /api/attachments/:uid` |  | ✗ none | 1 | ✓ 0.4c-2: removes; unknown 404 (item-surface) |  |  |
| c | `DELETE /api/comments/:uid` |  | ✗ none | 1 | ✓ 0.4c-2: removes a reply from the thread (item-surface) |  |  |
| c | `DELETE /api/items/:uid` |  | ✗ none | 1 | ✓ 0.4c: exercised by agent-loop, criteria-signoff, drift-review-tools, full-loop, +5 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `DELETE /api/plan-docs/:docUid` |  | ✗ none | 1 | ✓ 0.4c: exercised by plan-docs (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `DELETE /api/plan-phases/:phaseUid` |  | ✗ none | 1 | ✓ 0.4c: exercised by full-loop, plan-phases (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `DELETE /api/plans/:uid` |  | ✗ none | 4 | ✓ 0.4c: exercised by cdev-central-oversight, cdev-stitched-view, filesystem-sinks, full-loop, +11 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `DELETE /api/refs/:uid` |  | ✗ none | 1 | ✓ 0.4c: exercised by references (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/attachments/:uid/file` |  | ✗ none | 1 | ✓ 0.4c: exercised by filesystem-sinks (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/comments` |  | ✗ none | 1 | ✓ 0.4c-2: threaded with replies (item-surface) |  |  |
| c | `GET /api/contributions` |  | ✗ none | 3 | ✓ 0.4c: exercised by cdev-phase7, review-confinement, surfaced-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/items/:itemUid/refs` |  | ✗ none | 2 | ✓ 0.4c: exercised by phone-plans, references (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/items/:uid` |  | ✗ none | 13 | ✓ 0.4c: exercised by agent-loop, criteria-signoff, drift-review-tools, full-loop, +5 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/items/:uid/attachments` |  | ✗ none | 1 | ✓ 0.4c: exercised by filesystem-sinks, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/items/:uid/comments` |  | ✗ none | 2 | ✓ 0.4c: exercised by phone-plans, short-references, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/items/:uid/criteria` |  | ✗ none | 2 | ✓ 0.4c: exercised by artefacts-stale, brief-surface, criteria-loops, criteria-signoff, +3 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/items/:uid/events` |  | ✗ none | 2 | ✓ 0.4c-2: rename recorded before/after (item-surface) |  |  |
| c | `GET /api/items/:uid/full` |  | ✗ none | 2 | ✓ 0.4c: exercised by item-surface, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/items/:uid/skills` |  | ✗ none | 4 |  |  |  |
| c | `GET /api/items/:uid/versions` |  | ✗ none | 3 | ✓ 0.4c-2: each edit a version (item-surface) |  |  |
| c | `GET /api/items/:uid/workstream` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/pantry/resolve` |  | ✗ none | 3 | ✓ 0.4c: exercised by cdev-phase7, filesystem-sinks, surfaced-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plan-docs/:docUid` |  | ✗ none | 1 | ✓ 0.4c: exercised by plan-docs (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plan-docs/:docUid/versions` |  | ✗ none | 2 | ✓ 0.4c: exercised by plan-docs (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plan-history/:planSlug` |  | ✗ none | 1 | ✓ 0.4c-1: the commit that touched the plan (plan-rest) |  |  |
| c | `GET /api/plan-history/:planSlug/at/:commitHash` |  | ✗ none | 1 | ✓ 0.4c: exercised by input-validation (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plan-history/:planSlug/diff` |  | ✗ none | 1 | ✓ 0.4c: exercised by input-validation (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plan-history/:planSlug/search` |  | ✗ none | 1 | ✓ 0.4c-1: finds by text; missing q 400 (plan-rest) |  |  |
| c | `GET /api/plan-templates` |  | ✗ none | 2 | ✓ 0.4c: exercised by filesystem-sinks, review-confinement (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans` |  | ✗ none | 8 | ✓ 0.4c: exercised by agent-loop, agent-ui-tools, artefacts-stale, brief-surface, +45 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:planUid/channels` |  | ✗ none | 4 | ✓ 0.4c: exercised by artefacts-stale, phone-channels-projects, presence-channels (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:planUid/items` |  | ✗ none | 10 | ✓ 0.4c: exercised by agent-ui-tools, artefacts-stale, brief-surface, code-reference, +20 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:planUid/timeline` |  | ✗ none | 1 | ✓ 0.4c: exercised by full-loop (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid` |  | ✗ none | 14 | ✓ 0.4c: exercised by cdev-central-oversight, cdev-stitched-view, filesystem-sinks, full-loop, +11 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/budget` |  | ✗ none | 1 | ✓ 0.4g: report incl. flaggedChanges; unknown plan 404 (agent-ui-tools, budget-ceiling-validation) |  |  |
| c | `GET /api/plans/:uid/changes` |  | ✗ none | 2 | ✓ 0.4c: exercised by full-loop, plan-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/changes/:changeId` |  | ✗ none | 1 | ✓ 0.4c-1: one projected change; unknown 404 (plan-rest) |  |  |
| c | `GET /api/plans/:uid/check-runs` |  | ✗ none | 1 | ✓ 0.4c: exercised by criteria-loops (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/deviations` |  | ✗ none | 4 | ✓ 0.4c: exercised by deviations, drift-review-tools, full-loop, phone-plans (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/docs` |  | ✗ none | 4 | ✓ 0.4c: exercised by full-loop, phone-plans, plan-docs, plan-export, +2 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/docs/by-type/:docType` |  | ✗ none | 1 | ✓ 0.4c: exercised by plan-docs (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/docs/search` |  | ✗ none | 1 | ✓ 0.4c-1: finds by body with excerpt; no match is empty (plan-rest) |  |  |
| c | `GET /api/plans/:uid/external-sync` |  | ✗ none | 1 | ✓ 0.4c: exercised by external-sync-endpoint (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/file-status` |  | ✗ none | 5 | ✓ 0.4c: exercised by next-up-and-sync, plan-default-visibility, plan-export, surfaced-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/next-task` |  | ✗ none | 3 | ✓ 0.4c: exercised by full-loop, next-up-and-sync, phone-plans (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/phases` |  | ✗ none | 3 | ✓ 0.4c: exercised by full-loop, plan-phases, plan-templates (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/pr-draft` |  | ✗ none | 5 | ✓ 0.4c: exercised by phone-graph-review, plan-review-surface, plan-review, review-comparand-edges, +1 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/projection` |  | ✗ none | 1 | ✓ 0.4c-1: ghost and modified files from an Action (plan-rest) |  |  |
| c | `GET /api/plans/:uid/refs` |  | ✗ none | 1 | ✓ 0.4c: exercised by references (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/review` |  | ✗ none | 6 | ✓ 0.4c: exercised by phone-graph-review, plan-review-surface, plan-review, review-after-rescan, +2 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/:uid/skill-arrivals` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/versions` |  | ✗ none | 3 | ✓ 0.4c: exercised by full-loop, plan-tools, plan-versions (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/plans/discover` |  | ✗ none | 1 | ✓ 0.4c-1: exported plan directories (plan-rest) |  |  |
| c | `GET /api/plans/reconcile` |  | ✗ none | 1 | ✓ 0.4c-1: the orphan once its plan is archived (plan-rest) |  |  |
| c | `GET /api/plans/stitched` |  | ✗ none | 2 | ✓ 0.4c: exercised by cdev-central-oversight, cdev-stitched-view (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `GET /api/skills` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/team-activity` |  | ✗ none | 3 | ✓ 0.4c: exercised by cdev-phase6, review-confinement, surfaced-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/comments` |  | ✗ none | 2 | ✓ 0.4c-2: top-level and reply; missing body 400 (item-surface) |  |  |
| c | `POST /api/contributions/accept` |  | ✗ none | 2 | ✓ 0.4c: exercised by filesystem-sinks, surfaced-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/contributions/promote` |  | ✗ none | 1 | ✓ 0.4c: exercised by surfaced-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/contributor-branch` |  | ✗ none | 2 | ✓ 0.4c: exercised by contributor-branch-index, surfaced-rest (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/items/:itemUid/refs` |  | ✗ none | 1 | ✓ 0.4c: exercised by phone-plans, references (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/items/:uid/attachments` |  | ✗ none | 3 | ✓ 0.4c: exercised by filesystem-sinks, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/items/:uid/blocked` |  | ✗ none | 1 | ✓ 0.4c: exercised by task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/items/:uid/claim` |  | ✗ none | 2 | ✓ 0.4c-2: claims and records the assignee; full lifecycle (full-loop) |  |  |
| c | `POST /api/items/:uid/code-reference` |  | ✗ none | 1 | ✓ 0.4c-1: appends line ranges; shows in the overlay; refusals (code-reference, e2e add-to-plan; bug 21) |  |  |
| c | `POST /api/items/:uid/comments` |  | ✗ none | 3 | ✓ 0.4c: exercised by phone-plans, short-references, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/items/:uid/criteria` |  | ✗ none | 7 | ✓ 0.4c: exercised by artefacts-stale, brief-surface, criteria-loops, criteria-signoff, +3 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/items/:uid/move` |  | ✗ none | 1 | ✓ 0.4c-2: re-parents and reorders; cycles, self, foreign and missing parents 400 (item-surface; bug 23) |  |  |
| c | `POST /api/items/:uid/progress` |  | ✗ none | 1 | ✓ 0.4c: exercised by task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/items/:uid/restore-version/:version` |  | ✗ none | 1 | ✓ 0.4c-2: old state back as a new version; unknown 404 (item-surface) |  |  |
| c | `POST /api/items/:uid/skill-arrivals/accept` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/items/:uid/worktree` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans` |  | 1 | 66 | ✓ 0.4c: exercised by agent-loop, agent-ui-tools, artefacts-stale, brief-surface, +45 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:planUid/channels` |  | ✗ none | 2 | ✓ 0.4c: exercised by artefacts-stale, phone-channels-projects, presence-channels (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:planUid/items` |  | ✗ none | 35 | ✓ 0.4c: exercised by agent-ui-tools, artefacts-stale, brief-surface, code-reference, +20 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:uid/apply-template` |  | ✗ none | 1 | ✓ 0.4c-1: seeds items; missing templateId 400 (plan-rest) |  |  |
| c | `POST /api/plans/:uid/check-runs` |  | ✗ none | 2 | ✓ 0.4c: exercised by criteria-loops (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:uid/docs` |  | ✗ none | 6 | ✓ 0.4c: exercised by full-loop, phone-plans, plan-docs, plan-export, +2 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:uid/export` |  | ✗ none | 9 | ✓ 0.4c: exercised by cdev-cross-repo, contributor-branch-index, criteria-signoff, next-up-and-sync, +4 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:uid/phases` |  | ✗ none | 2 | ✓ 0.4c: exercised by full-loop, plan-phases, plan-templates (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:uid/publish-as-template` |  | ✗ none | 1 | ✓ 0.4c: exercised by plan-templates (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:uid/reconcile` |  | ✗ none | 2 | ✓ 0.4c: exercised by drift-review-tools, full-loop (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/:uid/unlink` |  | ✗ none | 3 | ✓ 0.4c: exercised by next-up-and-sync, plan-export, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/bulk-delete` |  | ✗ none | 1 | ✓ 0.4c-1: exactly the named plans; empty list 400 (plan-rest) |  |  |
| c | `POST /api/plans/from-template` |  | ✗ none | 3 | ✓ 0.4c: exercised by filesystem-sinks, plan-templates (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/import` |  | ✗ none | 3 | ✓ 0.4c: exercised by plan-export, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `POST /api/plans/import-external` |  | ✗ none | 1 | ✓ 0.4c-1: issue checklist becomes Actions; unknown source 400 (plan-rest) |  |  |
| c | `POST /api/plans/prune-orphans` |  | ✗ none | 1 | ✓ 0.4c-1: removes only the opened project's current orphans; everything else skipped (plan-rest) |  |  |
| c | `PUT /api/items/:uid` |  | ✗ none | 14 | ✓ 0.4c-2: parentUid validated like move (item-surface; bug 23) |  |  |
| c | `PUT /api/items/:uid/workstream` |  | ✗ none | 1 |  |  |  |
| c | `PUT /api/plan-docs/:docUid` |  | ✗ none | 3 | ✓ 0.4c: exercised by plan-docs (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `PUT /api/plan-phases/:phaseUid` |  | ✗ none | 2 | ✓ 0.4c: exercised by full-loop, plan-phases (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `PUT /api/plans/:uid` |  | ✗ none | 4 | ✓ 0.4c: exercised by cdev-central-oversight, cdev-stitched-view, filesystem-sinks, full-loop, +11 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `PUT /api/plans/:uid/budget` |  | ✗ none | 1 | ✓ 0.4g: recorded with who and how (local-api / desktop), never flagged; invalid ceilings 400; unknown plan 404 (agent-ui-tools, budget-ceiling-validation) |  |  |
| c | `PUT /api/refs/:uid` |  | ✗ none | 1 | ✓ 0.4c: exercised by references (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| d | `DELETE /api/criteria/:uid` |  | ✗ none | 1 | ✓ 0.4d: removes the line; its decisions stay in the record (criteria-signoff) |  |  |
| d | `GET /api/criteria/:uid/signoffs` |  | ✗ none | 2 | ✓ 0.4d: append-only record, each tagged by how it arrived — local-api/unverified over HTTP (criteria-signoff, criteria-loops) |  |  |
| d | `GET /api/plans/:uid/signoff-pack` |  | ✗ none | 3 | ✓ 0.4d: every criterion, unverified approval tagged, file with hash at approval; unknown plan 404 (signoff-surface) |  |  |
| d | `GET /api/plans/:uid/signoff-pack.html` |  | ✗ none | 3 | ✓ 0.4d: attachment download, CSP sandbox, nosniff; unverified approvals listed apart (signoff-surface) |  |  |
| d | `GET /api/plans/:uid/worklist` |  | ✗ none | 1 | ✓ 0.4d: sent back first with note, then open; met/waiting counted; stale after source moves (signoff-surface) |  |  |
| d | `POST /api/criteria/:uid/check` |  | ✗ none | 1 | ✓ 0.4d: holds while cited cell exists, fails with the reason once it is gone; 404 (signoff-surface) |  |  |
| d | `POST /api/criteria/:uid/decide` |  | ✗ none | 5 | ✓ 0.4d: approve / send back (note required); HTTP records unverified, app window records human (criteria-signoff, ipc-dispatcher unit) |  |  |
| d | `POST /api/plans/:uid/signoff-pack/verify` |  | ✗ none | 1 | ✓ 0.4d: matches, then changed after edit; empty, non-pack and other plan's pack refused (signoff-surface) |  |  |
| d | `PUT /api/criteria/:uid` |  | ✗ none | 1 | ✓ 0.4d: rewording resets to open (criteria-signoff) |  |  |
| e | `GET /api/artefacts/:uid` |  | ✗ none | 1 | ✓ 0.4e: relative path, role, hash, recorder; never the absolute path; 404 (brief-surface) |  |  |
| e | `GET /api/artefacts/:uid/content` |  | ✗ none | 1 | ✓ 0.4e: bytes with nosniff/no-store/sandbox CSP; 206 range; 416; image type; 404 (brief-surface, artefact-viewer) |  |  |
| e | `GET /api/artefacts/:uid/rendition` |  | ✗ none | 1 | ✓ 0.4e: 415 for a type it does not convert; 503 with a sentence and fallback without an engine; 404 (brief-surface) |  |  |
| e | `GET /api/items/:uid/artefacts` |  | ✗ none | 1 | ✓ 0.4e: the item's files, re-hashed after an edit; 404 (brief-surface) |  |  |
| e | `POST /api/items/:uid/artefacts` |  | ✗ none | 1 | ✓ 0.4e: hashed, stored relative, re-record in place; bad role, type, missing, outside, link, unknown item refused (brief-surface) |  |  |
| f | `GET /api/channels/:eventUid/thread` |  | ✗ none | 1 | ✓ 0.4f: root then replies in order, human and agent posts; unknown root → [] (presence-channels, cdev-channels) |  |  |
| f | `GET /api/presence/cards` |  | ✗ none | 2 | ✓ 0.4f: posted card listed with its agent; empty after dismiss (presence-channels) |  |  |
| f | `POST /api/channels/:eventUid/status` |  | ✗ none | 1 | ✓ 0.4f: resolve, reopen; broadcast; missing/unknown status 400; unknown event 404 (presence-channels) |  |  |
| f | `POST /api/presence/ack` |  | ✗ none | 1 | ✓ 0.4f: releases the waiting await_ack; broadcast; 400 without fields; 404 unknown card (presence-channels) |  |  |
| f | `POST /api/presence/reply` |  | ✗ none | 1 | ✓ 0.4f: reaches the waiting agent once and is not re-queued; 400 without text (presence-channels; bug 25) |  |  |
| f | `POST /api/screenshot-response` |  | ✗ none | 2 | ✓ 0.4f: the renderer's answer resolves the waiting request tool by nonce (graph-tools) |  |  |
| g | `DELETE /api/breakpoints/:id` |  | ✗ none | 2 |  |  |  |
| g | `GET /api/agent-events` |  | ✗ none | 6 |  |  |  |
| g | `GET /api/agent/status` |  | ✗ none | 3 | ✓ 0.4g: the session watcher's state, nothing more (misc-endpoints) |  |  |
| g | `GET /api/awareness` |  | ✗ none | 14 |  |  |  |
| g | `GET /api/breakpoint-hits` |  | ✗ none | 3 |  |  |  |
| g | `GET /api/breakpoints` |  | ✗ none | 1 |  |  |  |
| g | `GET /api/mcp/config` |  | ✗ none | 1 | ✓ 0.4g: a copied config carries the token and connects (misc-endpoints) |  |  |
| g | `GET /api/mcp/setup` |  | ✗ none | 3 | ✓ 0.4g: the agent prompt names the token file and never carries the token (misc-endpoints, mcp-connector) |  |  |
| g | `GET /api/mcp/status` |  | ✗ none | 1 | ✓ 0.4g: running on the agents' port with connected agents counted (sessions) |  |  |
| g | `GET /api/plans/:uid/budget/changes` |  | ✗ none | 1 | ✓ 0.4g: every change newest first, with channel and flag; no-op changes not recorded; unknown plan 404 (agent-ui-tools) |  |  |
| g | `GET /api/plans/:uid/budget/check` |  | ✗ none | 1 | ✓ 0.4g: agrees with check_budget; unknown plan 404 (agent-ui-tools); bug 27 |  |  |
| g | `GET /api/sensors/doc-check` |  | ✗ none | 1 | ✓ 0.4g: needs an opened project (400 / 403); nothing stale without docs (agent-ui-tools) — stale docs in 0.4l |  |  |
| g | `GET /api/sessions` |  | ✗ none | 8 | ✓ 0.4g: a connected agent appears with its type and plan (sessions, agent-ui-tools) |  |  |
| g | `GET /api/workstreams` |  | ✗ none | 11 |  |  |  |
| g | `GET /api/workstreams/changes` |  | ✗ none | 1 |  |  |  |
| g | `GET /api/workstreams/commits` |  | ✗ none | 1 |  |  |  |
| g | `GET /api/workstreams/folder-requests` |  | ✗ none | 1 |  |  |  |
| g | `POST /api/awareness/:id/reply` |  | ✗ none | 1 |  |  |  |
| g | `POST /api/awareness/:id/state` |  | ✗ none | 4 |  |  |  |
| g | `POST /api/breakpoint-hits/:ref/answer` |  | ✗ none | 7 |  |  |  |
| g | `POST /api/breakpoints` |  | ✗ none | 9 |  |  |  |
| g | `POST /api/plans/:uid/budget/changes/:id/acknowledge` |  | ✗ none | 1 | ✓ 0.4g: unflags an agent's change and records who saw it; unknown change or wrong plan 404 (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `POST /api/sessions/:sessionId/assign-plan` |  | ✗ none | 3 | ✓ 0.4g: unknown plan or session 404, missing plan 400, nothing changed (agent-ui-tools); bug 27 |  |  |
| g | `POST /api/workstreams/folder-requests/:id/dismiss` |  | ✗ none | 1 |  |  |  |
| g | `POST /api/workstreams/folder-requests/:id/include` |  | ✗ none | 1 |  |  |  |
| h | `GET /api/baseline` |  | ✗ none | 4 | ✓ 0.4h: source, dirty, capturedAt and a label that says what it is; kept across rescans (baseline); bug 29 |  |  |
| h | `GET /api/comparands` |  | ✗ none | 5 | ✓ 0.4h: live, baseline, checkpoints by name, commits; outside a project refused (drift-review-tools), plan-review, review-confinement |  |  |
| h | `GET /api/compare` |  | ✗ none | 6 | ✓ 0.4h: exact diffs, same-point note, commit edges not compared, 404 unknown (plan-review, compare-hash-space, compare-phantom-removals) |  |  |
| h | `GET /api/conflicts` |  | ✗ none | 4 | ✓ 0.4h: a real merge conflict with per-field ours/theirs (manifest-conflicts, worktree-project) |  |  |
| h | `GET /api/freeze` |  | ✗ none | 4 | ✓ 0.4h: reason and until while active; inactive after lifting (review-governance-tools), cdev-phase6 |  |  |
| h | `GET /api/freeze/changes` |  | ✗ none | 1 | ✓ 0.4k: every change newest first, with who and how it arrived; outside a project 403 (freeze-flags) |  |  |
| h | `POST /api/baseline/capture` |  | ✗ none | 3 | ✓ 0.4h: pins HEAD's contents or a named commit; refs checked before git; 400 for a non-commit (baseline); bug 29 |  |  |
| h | `POST /api/conflicts/resolve` |  | ✗ none | 2 | ✓ 0.4h: fields and by_side; staged; escaping path refused, outside file untouched (manifest-conflicts, filesystem-sinks) |  |  |
| h | `POST /api/freeze/changes/:id/acknowledge` |  | ✗ none | 1 | ✓ 0.4k: unflags an agent's change and records who saw it; unknown 404, outside a project 403 (freeze-flags, e2e mcp-ui-tools) |  |  |
| h | `PUT /api/freeze` |  | ✗ none | 2 | ✓ 0.4h: freeze, exempt a plan, lift; every field validated; outside a project 403 (review-governance-tools); bug 33; recorded with who and how, never flagged (freeze-flags, 0.4k) |  |  |
| i | `DELETE /api/terminals/:id` |  | ✗ none | 5 | ✓ 0.4i: killed, broadcast, gone for inject and write; scrollback kept; unknown 404 (terminal-surface), terminals |  |  |
| i | `GET /api/audio/recent` |  | ✗ none | 1 | ✓ 0.4i: chunks concatenated in order with duration and times; seconds narrows; 404 when empty (audio-rest) |  |  |
| i | `GET /api/audio/status` |  | ✗ none | 1 | ✓ 0.4i: capturing, chunk count, buffered seconds, window (audio-rest) |  |  |
| i | `GET /api/terminals` |  | ✗ none | 2 | ✓ 0.4i: lists live terminals; killed ones gone or not alive (terminals, terminal-surface) |  |  |
| i | `GET /api/terminals/:id/history` |  | ✗ none | 3 | ✓ 0.4i: scrollback of what ran, paged backwards; unknown id empty and creates nothing (terminal-surface), input-validation |  |  |
| i | `POST /api/audio/chunk` |  | ✗ none | 1 | ✓ 0.4i: buffered in order; 409 when not capturing; bad length or data 400 (audio-rest); bug 35 |  |  |
| i | `POST /api/audio/start` |  | ✗ none | 1 | ✓ 0.4i: capturing, clears the buffer, default size when none named; bad sizes 400 (audio-rest); bug 35 |  |  |
| i | `POST /api/audio/stop` |  | ✗ none | 1 | ✓ 0.4i: stops, keeps the buffer, refuses more chunks (audio-rest) |  |  |
| i | `POST /api/terminals` |  | ✗ none | 5 | ✓ 0.4i: shell and claude presets with cwd, pid, alive (terminals) |  |  |
| i | `POST /api/terminals/:id/inject` |  | ✗ none | 3 | ✓ 0.4i: the text runs in the shell (output in history); 400 empty, 404 unknown or dead (terminal-surface) |  |  |
| j | `DELETE /api/peers/devices/:fingerprint` |  | ✗ none | 1 | ✓ 0.4j: forgotten and disconnected; unknown 404 (phone-sync-and-tools) |  |  |
| j | `DELETE /api/peers/push-tokens/:fingerprint` |  | ✗ none | 2 | ✓ 0.4j: token gone from the list; unknown 404 (phone-sync-and-tools) |  |  |
| j | `GET /api/pairing/status` |  | ✗ none | 2 | ✓ 0.4j: codeReady once the phone answers, never the code itself (gate4-reconnect-identity, harness peer) |  |  |
| j | `GET /api/peers/audit` |  | ✗ none | 5 | ✓ 0.4j: refusals, terminal access (RPC and relay, output never recorded), grants; survives restart (peer-device-access, phone-sync-and-tools, phone-terminals-sysdocs) |  |  |
| j | `GET /api/peers/connections` |  | ✗ none | 1 | ✓ 0.4j: the phone, named as paired, all four channels (phone-sync-and-tools) |  |  |
| j | `GET /api/peers/devices` |  | ✗ none | 2 | ✓ 0.4j: paired devices without the reconnect secret; forgotten one gone (peer-device-access, phone-sync-and-tools) |  |  |
| j | `GET /api/peers/discovered` |  | ✗ none | 1 | ✓ 0.4j: a list (mDNS off in the harness) (phone-sync-and-tools) |  |  |
| j | `GET /api/peers/push-tokens` |  | ✗ none | 2 | ✓ 0.4j: the phone's registered token (cdev-phase11, phone-sync-and-tools) |  |  |
| j | `GET /api/peers/remote-audio` |  | ✗ none | 1 | ✓ 0.4j: counts peers (phone-sync-and-tools) |  |  |
| j | `GET /api/peers/remote-input-requests` |  | ✗ none | 1 | ✓ 0.4j: a peer's pending question with its context (phone-channels-projects) |  |  |
| j | `GET /api/peers/remote-state` |  | ✗ none | 1 | ✓ 0.4j: holds the peer's own snapshot (phone-sync-and-tools) |  |  |
| j | `GET /api/peers/remote-state/:fingerprint` |  | ✗ none | 1 | ✓ 0.4j: that peer's snapshot; unknown 404 (phone-sync-and-tools) |  |  |
| j | `GET /api/peers/remote-terminals` |  | ✗ none | 1 | ✓ 0.4j: a peer's shared terminals, all or by fingerprint (phone-sync-and-tools) |  |  |
| j | `GET /api/peers/status` |  | ✗ none | 3 | ✓ 0.4j: running, mobile API port actually bound, counts (gate4-reconnect-identity, pairing-enables-lan, cdev-phase11) |  |  |
| j | `GET /api/sync/peek` |  | ✗ none | 2 | ✓ 0.4j: what an import would bring, before it does (cdev-phase5, surfaced-rest) |  |  |
| j | `GET /api/sync/status` |  | ✗ none | 1 | ✓ 0.4j: personal sync state (cdev-phase5) |  |  |
| j | `PATCH /api/peers/devices/:fingerprint` |  | ✗ none | 11 | ✓ 0.4j: grant and revoke recorded; unknown capability dropped; unknown device 404 (peer-device-access, harness peer) |  |  |
| j | `POST /api/pairing/cancel` |  | ✗ none | 2 | ✓ 0.4j: window closed (pairing-transport, peer-reconnect-auth) |  |  |
| j | `POST /api/pairing/confirm` |  | ✗ none | 3 | ✓ 0.4j: the code the phone derived is the code expected; no secret in the reply; turns the LAN listener on (gate4-reconnect-identity, pairing-enables-lan, harness peer) |  |  |
| j | `POST /api/pairing/initiate` |  | ✗ none | 4 | ✓ 0.4j: v5 QR payload, scannable size; code only in the body (gate4-reconnect-identity, pairing-transport, harness peer) |  |  |
| j | `POST /api/peers/push-tokens` |  | ✗ none | 2 | ✓ 0.4j: register and list (cdev-phase11) |  |  |
| j | `POST /api/peers/remote-input-requests/:requestId/respond` |  | ✗ none | 1 | ✓ 0.4j: answer reaches the peer; answered twice 404, no response 400 (phone-channels-projects) |  |  |
| j | `POST /api/peers/remote-terminals/:fingerprint/:terminalId/write` |  | ✗ none | 1 | ✓ 0.4j: input reaches the peer; unknown terminal 404, no data 400 (phone-sync-and-tools) |  |  |
| j | `POST /api/sync/export` |  | ✗ none | 1 | ✓ 0.4j: export then import round trip (cdev-phase5) |  |  |
| j | `POST /api/sync/import` |  | ✗ none | 1 | ✓ 0.4j: export then import round trip (cdev-phase5) |  |  |
| k | `GET /api/logs/path` |  | ✗ none | 2 | ✓ 0.4k: today's file under the data dir's logs (settings-surface) |  |  |
| k | `GET /api/logs/tail` |  | ✗ none | 2 | ✓ 0.4k: answers without a file logger; maxBytes must be a whole number (settings-surface) |  |  |
| k | `GET /api/power/status` |  | ✗ none | 2 | ✓ 0.4j: same as the phone's power.status (phone-channels-projects) |  |  |
| k | `GET /api/settings` |  | ✗ none | 11 | ✓ 0.4k: every section; what was saved comes back after a restart (settings-surface) |  |  |
| k | `GET /api/settings/first-run-check` |  | ✗ none | 3 | ✓ 0.4k: incomplete, then complete once saved, with the identity (settings-surface) |  |  |
| k | `GET /api/updates/download/status` |  | ✗ none | 1 | ✓ 0.4k: idle and complete before anything is downloaded (update-download) |  |  |
| k | `GET /api/updates/status` |  | ✗ none | 2 | ✓ 0.4k: idle when the check is off; available / up-to-date / error after a check, platform and version named (updates) |  |  |
| k | `POST /api/updates/check` |  | ✗ none | 1 | ✓ 0.4k: a person's check goes out even with the automatic one off; no asset for this platform is not offered; website down falls back to GitHub; both down an error with the last good answer kept (updates) |  |  |
| k | `POST /api/updates/download` |  | ✗ none | 2 | ✓ 0.4k: refused with nothing fetched unless https on the releases repo; a refusal no longer blocks later downloads (updates; bug 44), update-download |  |  |
| k | `POST /api/updates/download/cancel` |  | ✗ none | 1 | ✓ 0.4k: answers cleanly with nothing running (update-download) |  |  |
| k | `PUT /api/settings` |  | 1 | 24 | ✓ 0.4k: partial saves keep siblings (nested too), hosts normalised, windows told; every field checked, a bad value 400 with the reason and nothing stored (settings-surface); phone-safe subset from the phone (phone-channels-projects) |  |  |
| l | `DELETE /api/system-docs/:uid` |  | ✗ none | 2 | ✓ 0.4j: removed, desktop told; unknown 404 not ok:false (phone-terminals-sysdocs) |  |  |
| l | `GET /api/system-docs` |  | ✗ none | 4 | ✓ 0.4l: same as list_system_docs; outside a project refused (sysdocs-intake, phone-terminals-sysdocs) |  |  |
| l | `GET /api/system-docs/:uid` |  | ✗ none | 2 | ✓ 0.4j: the doc; unknown 404 (phone-terminals-sysdocs) — rest of system docs in 0.4l |  |  |
| l | `GET /api/system-docs/:uid/freshness` |  | ✗ none | 2 | ✓ 0.4j: the report; unknown 404 (phone-terminals-sysdocs) |  |  |
| l | `POST /api/system-docs` |  | ✗ none | 4 | ✓ 0.4l: file and row; unverified over plain HTTP whatever the body claims (sysdocs-intake); bug 47 |  |  |
| l | `POST /api/system-docs/:uid/verify` |  | ✗ none | 1 | ✓ 0.4l: re-stamped at HEAD after a commit, freshness clears, desktop told; unknown 404 (sysdocs-intake) |  |  |
| l | `PUT /api/system-docs/:uid` |  | ✗ none | 2 | ✓ 0.4l: named fields only, author from how it arrived — the body cannot name one (sysdocs-intake); bug 47 |  |  |

## MCP tools (196)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `close_project` | session · project | ✗ none | 1 | ✓ 0.4a: broadcasts ui-close-project (project-lifecycle) |  |  |
| a | `get_project_config` | project-config · read | ✗ none | 2 | ✓ 0.4a: project override and effective merge with defaults (cdev-channels, cdev-sensors) |  |  |
| a | `get_repo_identity` | session · read | ✗ none | 1 | ✓ 0.4a: alias, branch, origin; unopened refused (project-lifecycle) |  |  |
| a | `list_recent_projects` | session · read | ✗ none | 3 | ✓ 0.4a: path, branch, pin marker (project-lifecycle) |  |  |
| a | `open_project` | ui · project | ✗ none | 1 | ✓ 0.4a: scans, records, broadcasts ui-open-project (project-lifecycle) |  |  |
| a | `pin_project` | session · project | ✗ none | 1 | ✓ 0.4a: flag flips; unknown path refused (project-lifecycle; fixed: claimed success) |  |  |
| a | `refresh_repo_origin` | session · project | ✗ none | 1 | ✓ 0.4a: follows set-url, broadcasts (project-lifecycle) |  |  |
| a | `remove_recent_project` | session · project | ✗ none | 1 | ✓ 0.4a: entry gone; unknown path refused (project-lifecycle) |  |  |
| a | `rescan_project` | session · project | ✗ none | 1 | ✓ 0.4a: no path = the open project; none open = refused; unopened refused (project-lifecycle; fixed: scanned process.cwd()) |  |  |
| a | `set_repo_alias` | session · project | ✗ none | 1 | ✓ 0.4a: rename, reset, broadcast; unknown path refused (project-lifecycle) |  |  |
| a | `unpin_project` | session · project | ✗ none | 1 | ✓ 0.4a: flag flips (project-lifecycle) |  |  |
| a | `update_project_config` | project-config · write | ✗ none | 4 | ✓ 0.4a: writes .codetrellis/config.json; effective config follows (cdev-channels, cdev-sensors, cdev-routing) |  |  |
| b | `check_architecture` | architecture · read | ✗ none | 1 | ✓ 0.4b: every edge; query narrows (graph-tools) |  |  |
| b | `check_conformity` | architecture · read | ✗ none | 1 | ✓ 0.4b: flags the reverse of an import, relative or absolute (graph-tools; bug 17) |  |  |
| b | `get_dependencies` | architecture · read | ✗ none | 1 | ✓ 0.4b: relative or absolute path (graph-tools; bug 17) |  |  |
| b | `graph_export` | graph · read | ✗ none | 1 | ✓ 0.4b: renderer PNG round trip (graph-tools) |  |  |
| b | `graph_focus` | graph · write | ✗ none | 1 | ✓ 0.4b: broadcast incl. highlight flag (graph-tools) |  |  |
| b | `graph_select` | graph · write | ✗ none | 1 | ✓ 0.4b: selects file nodes by relative path on a real canvas (graph-tools, e2e mcp-view-tools) |  |  |
| b | `graph_set_depth` | graph · write | ✗ none | 1 | ✓ 0.4b: canvas depth follows (graph-tools, e2e mcp-view-tools) |  |  |
| b | `graph_set_layout` | graph · write | ✗ none | 1 | ✓ 0.4b: canvas layout follows (graph-tools, e2e mcp-view-tools) |  |  |
| b | `graph_set_mode` | graph · write | ✗ none | 1 | ✓ 0.4b: canvas mode follows, incl. baseline (graph-tools, e2e mcp-view-tools; bug 19) |  |  |
| b | `graph_set_scope` | graph · write | ✗ none | 1 | ✓ 0.4b: broadcast, set and clear (graph-tools) |  |  |
| b | `graph_snapshot` | graph · read | ✗ none | 1 | ✓ 0.4b: compact by default; metadata on request; real canvas (graph-tools, e2e mcp-view-tools; bug 18) |  |  |
| b | `graph_toggle_projection` | graph · write | ✗ none | 1 | ✓ 0.4b: broadcast (graph-tools) |  |  |
| b | `list_cross_system_edges` | architecture · read | ✗ none | 1 | ✓ 0.4b: stats and edges (graph-tools) |  |  |
| b | `search_symbols` | architecture · read | ✗ none | 2 | ✓ 0.4b: known function with its file (graph-tools) |  |  |
| b | `ui_ready` | graph · read | ✗ none | 1 | ✓ 0.4b: renderer answer passed through; no window = ready:false within 5 s; real window (graph-tools, e2e mcp-view-tools) |  |  |
| c | `accept_contributions` | contribution · write | ✗ none | 1 | ✓ 0.4c: exercised by cdev-phase7 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `add_external_ref` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: GitHub issue URL recognised (item-surface) |  |  |
| c | `add_item` | plan-item · write | ✗ none | 16 | ✓ 0.4c: exercised by agent-loop, cdev-phase3-demo, cdev-phase5, cdev-phase6, +12 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `add_item_attachment` | plan-item · write | ✗ none | 3 | ✓ 0.4c: exercised by item-surface, plan-items, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `add_item_comment` | plan-item · write | ✗ none | 3 | ✓ 0.4c: exercised by item-surface, plan-items, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `add_plan_scope` | plan · write | ✗ none | 3 | ✓ 0.4c: exercised by cdev-central-oversight, cdev-cross-repo, cdev-stitched-view (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `assign_workstream` | plan-item · write | ✗ none | 1 |  |  |  |
| c | `bulk_add_items` | plan-item · write | ✗ none | 1 | ✓ 0.7: a tree in one call, parents by temporary id, authored by the calling agent; unknown plan refused (item-batch-search-import) |  |  |
| c | `claim_item` | plan-item · write | ✗ none | 19 | ✓ 0.4c: exercised by agent-loop, multi-agent, plan-items, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `copy_plan_as_prompt` | plan · read | ✗ none | 1 | ✓ 0.4c-1: whole plan or one item; unknown plan is an error (plan-tools) |  |  |
| c | `create_plan` | plan · write | ✗ none | 20 | ✓ 0.4c: exercised by cdev-central-oversight, cdev-channels, cdev-cross-repo, cdev-phase11, +15 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `create_plan_from_template` | plan · write | ✗ none | 1 | ✓ 0.4c-1: items copied, statuses reset; unknown template errors (plan-tools) |  |  |
| c | `delete_item` | plan-item · write | ✗ none | 1 | ✓ 0.4c: exercised by plan-items (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `delete_item_attachment` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `delete_item_comment` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `discover_plan_files` | plan · files | ✗ none | 1 | ✓ 0.4c-1: the exported directory (plan-tools) |  |  |
| c | `export_plan_to_files` | plan · files | ✗ none | 3 | ✓ 0.4c: exercised by cdev-phase3-demo, cdev-phase6, cdev-phase7 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `get_item` | plan-item · read | ✗ none | 6 | ✓ 0.4c: exercised by cdev-phase5, intake, plan-items, short-references (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `get_next_item` | plan-item · read | ✗ none | 5 | ✓ 0.4c: exercised by agent-loop, criteria-signoff (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `get_plan` | plan · read | ✗ none | 2 | ✓ 0.4c: exercised by cdev-sensors, plan-tools (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `get_plan_summary` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: counts by kind, byStatus, completion (item-surface) |  |  |
| c | `get_plan_timeline` | plan-item · read | ✗ none | 1 | ✓ 0.4c: exercised by plan-items (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `get_skill` | plan-item · read | ✗ none | 1 |  |  |  |
| c | `import_external` | plan · write | ✗ none | 1 | ✓ 0.7: plan and items authored by the caller, in the open project, shared by default; no project refused (item-batch-search-import) |  |  |
| c | `import_plan_from_files` | plan · files | ✗ none | 1 | ✓ 0.4c: exercised by cdev-phase3-demo (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `list_contributions` | contribution · read | ✗ none | 1 | ✓ 0.4c: exercised by cdev-phase7 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `list_external_refs` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `list_item_comments` | plan-item · read | ✗ none | 1 | ✓ 0.4c: exercised by plan-items (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `list_item_versions` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: newest first, incl. the restore (item-surface) |  |  |
| c | `list_items` | plan-item · read | ✗ none | 3 | ✓ 0.4c: exercised by cdev-phase5, intake, plan-items (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `list_plan_pointers` | plan · read | ✗ none | 1 | ✓ 0.4c: exercised by cdev-cross-repo (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `list_plan_templates` | plan · read | ✗ none | 1 | ✓ 0.4c-1: built-ins; project templates with project_root (plan-tools) |  |  |
| c | `list_plans` | plan · read | ✗ none | 13 | ✓ 0.4c: exercised by plan-tools, transport-auth (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `list_plans_by_repo` | plan · read | ✗ none | 1 | ✓ 0.4c: exercised by cdev-cross-repo (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `move_item` | plan-item · write | ✗ none | 3 | ✓ 0.4c-2: refuses cycles and foreign/missing parents (item-surface; bug 23) |  |  |
| c | `prepare_contributor_branch` | contribution · write | ✗ none | 1 | ✓ 0.4c: exercised by cdev-phase7 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `promote_to_contribution` | contribution · write | ✗ none | 1 | ✓ 0.4c: exercised by cdev-phase7 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `publish_plan_as_template` | plan · write | ✗ none | 1 | ✓ 0.4c-1: writes template.yaml; appears in the list (plan-tools) |  |  |
| c | `read_item_full` | plan-item · read | ✗ none | 2 | ✓ 0.4c: exercised by plan-items, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `remove_external_ref` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `remove_plan_scope` | plan · write | ✗ none | 1 | ✓ 0.4c: exercised by cdev-cross-repo (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `request_plan_deletion` | plan · write | ✗ none | 1 | ✓ 0.4c-3: asks the window, deletes nothing; refuses unknown, archived and unopened-project plans; typed confirmation in the app (plan-tools, e2e plan-deletion-request) |  |  |
| c | `resolve_pantry_references` | contribution · read | ✗ none | 1 | ✓ 0.4c: exercised by cdev-phase7 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `resolve_reference` | plan-item · read | ✗ none | 1 | ✓ 0.4c: exercised by short-references (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `restore_item_version` | plan-item · write | ✗ none | 1 | ✓ 0.4c: exercised by plan-items (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `search_items` | plan-item · read | ✗ none | 1 | ✓ 0.7: titles and bodies with an excerpt, case-insensitive; "%" and "_" literal; unknown plan refused (item-batch-search-import) |  |  |
| c | `set_item_blocked` | plan-item · write | ✗ none | 1 | ✓ 0.4c: exercised by plan-items (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `set_plan_home_repo` | plan · write | ✗ none | 1 | ✓ 0.4c-1: normalised; empty clears (plan-tools) |  |  |
| c | `suggest_specs` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: file specs under a scope (item-surface) |  |  |
| c | `unlink_plan_from_files` | plan · write | ✗ none | 1 | ✓ 0.4c-1: removes the directory, even after a rename; plan survives (plan-tools; bug 22) |  |  |
| c | `update_item` | plan-item · write | ✗ none | 14 | ✓ 0.4c: exercised by agent-loop, cdev-phase3-demo, cdev-phase5, criteria-signoff, +6 (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `update_item_progress` | plan-item · write | ✗ none | 2 | ✓ 0.4c: exercised by plan-items, task-context (0.4c wrote no per-row note; filled from test references in 0.7) |  |  |
| c | `update_plan` | plan · write | ✗ none | 2 | ✓ 0.4c-1: title/status/description, version recorded; write-through continues after a rename (plan-tools; bug 22) |  |  |
| d | `add_criterion` | plan-item · write | ✗ none | 1 | ✓ 0.4d: kept at propose, tagged with the agent's name in the app (criteria-signoff, criteria.spec) |  |  |
| d | `approve_gate` | plan-item · read | ✗ none | 1 | ✓ 0.4d: retired — refuses and points at submit_criterion (criteria-signoff) |  |  |
| d | `check_criterion` | plan-item · read | ✗ none | 1 | ✓ 0.4d: refuses a cell outside the file, passes once fixed (criteria-loops) |  |  |
| d | `get_worklist` | plan-item · read | ✗ none | 1 | ✓ 0.4d: hands back the send-back note and where it points (criteria-loops) |  |  |
| d | `list_criteria` | plan-item · read | ✗ none | 3 | ✓ 0.4d: migrated line verbatim plus the gate, with decided_by (criteria-signoff) |  |  |
| d | `run_checks` | plan-item · read | ✗ none | 1 | ✓ 0.4d: names the stale criterion and the changed file; approves nothing (criteria-loops) |  |  |
| d | `submit_criterion` | plan-item · write | ✗ none | 5 | ✓ 0.4d: submitting is not approving; agent policy self-approves in the agent's name (criteria-signoff) |  |  |
| e | `get_brief` | plan-item · read | ✗ none | 4 | ✓ 0.4e: item, guide from pages, own files + pages' materials only, still_needs; unknown refused (brief-surface) |  |  |
| e | `list_materials` | plan-item · read | ✗ none | 1 | ✓ 0.4e: every file item by item in tree order, outputs included; unknown refused (brief-surface) |  |  |
| e | `read_material` | plan-item · files | ✗ none | 1 | ✓ 0.4e: CSV by {range} (bug 24), text by {lines}, image as itself; read logged on the item (brief-surface, read unit) |  |  |
| e | `record_artefact` | plan-item · write | ✗ none | 4 | ✓ 0.4e: agent records an output (brief-surface, criteria-loops) |  |  |
| f | `await_ack` | presence · write | ✗ none | 1 | ✓ 0.4f: released by ack; instant when already acked; unknown card an error at once; dismissed → via dismissed (presence-channels; bug 25) |  |  |
| f | `await_decision` | presence · read | ✗ none | 5 |  |  |  |
| f | `await_user_input` | presence · write | ✗ none | 1 | ✓ 0.4f: gets the reply; a newer question supersedes an older wait at once (presence-channels; bug 25) |  |  |
| f | `check_breakpoint` | presence · read | ✗ none | 2 |  |  |  |
| f | `dismiss_channel_event` | channel · write | ✗ none | 1 | ✓ 0.4f: dismissed, broadcast, gone from the open list; unknown an error (presence-channels) |  |  |
| f | `dismiss_presence` | presence · write | ✗ none | 1 | ✓ 0.4f: clears every card and releases waiters (presence-channels; bug 25) |  |  |
| f | `get_channel_thread` | channel · read | ✗ none | 2 | ✓ 0.4f: same order as REST (presence-channels, cdev-channels) |  |  |
| f | `get_line_changes` | presence · read | ✗ none | 2 |  |  |  |
| f | `list_channel_events` | channel · read | ✗ none | 4 | ✓ 0.4f: status filter excludes dismissed; pulled events appear (presence-channels; bug 26) |  |  |
| f | `post_channel_event` | channel · write | ✗ none | 7 | ✓ 0.4f: threads with responds_to, exported to the plan folder (presence-channels, cdev-channels) |  |  |
| f | `present` | presence · write | ✗ none | 2 | ✓ 0.4f: card posted, broadcast, attributed to the agent (presence-channels) |  |  |
| f | `resolve_channel_event` | channel · write | ✗ none | 2 | ✓ 0.4f: resolved in DB and YAML (cdev-channels) |  |  |
| g | `acknowledge_signal` | awareness · write | ✗ none | 2 |  |  |  |
| g | `check_budget` | budget · read | ✗ none | 1 | ✓ 0.4g: none → ok → exempt states, reason in words; unknown plan refused (agent-ui-tools); bug 27 |  |  |
| g | `check_footprint` | awareness · read | ✗ none | 2 |  |  |  |
| g | `clipboard_read` | ui · capture | ✗ none | 1 | ✓ 0.4g: refused without capture; the window's answer returned (agent-ui-tools) |  |  |
| g | `clipboard_write` | ui · write | ✗ none | 1 | ✓ 0.4g: sends the text to the window (agent-ui-tools) |  |  |
| g | `declare_intent` | awareness · write | ✗ none | 2 |  |  |  |
| g | `get_app_guide` | ui · read | ✗ none | 3 | ✓ 0.4g: every flavour distinct; summary names this project's plans; unknown flavour refused (agent-ui-tools) |  |  |
| g | `get_awareness` | awareness · read | ✗ none | 7 |  |  |  |
| g | `get_budget` | budget · read | ✗ none | 1 | ✓ 0.4g: ceiling, spent, forecast, notes; unknown plan refused (agent-ui-tools) |  |  |
| g | `get_log_path` | ui · read | ✗ none | 1 | ✓ 0.4g: today's file in the data dir; naming it creates nothing (agent-ui-tools), logger-path unit; bug 28 |  |  |
| g | `get_logs` | ui · read | ✗ none | 1 | ✓ 0.4g: says when there is no log file; tail and filter of the desktop log (agent-ui-tools); bug 28 |  |  |
| g | `get_settings` | ui · read | ✗ none | 1 | ✓ 0.4g: reads back what update_settings wrote; no secrets in settings (cdev-phase5) |  |  |
| g | `get_state_at` | awareness · read | ✗ none | 1 |  |  |  |
| g | `list_workstreams` | awareness · read | ✗ none | 3 |  |  |  |
| g | `navigate_item_back` | session · write | ✗ none | 1 | ✓ 0.4g: selection steps back (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `navigate_item_forward` | session · write | ✗ none | 1 | ✓ 0.4g: and forward (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `navigate_to` | session · write | ✗ none | 1 | ✓ 0.4g: every target's payload; unknown plan/item/file refused (agent-ui-tools); bug 27 |  |  |
| g | `open_history_drawer` | session · write | ✗ none | 1 | ✓ 0.4g: drawer opens on the item; unknown item refused (agent-ui-tools, mcp-ui-tools.spec); bug 27 |  |  |
| g | `open_mcp_guide` | session · write | ✗ none | 1 | ✓ 0.4g: guide dialog opens (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `open_plan` | session · write | ✗ none | 1 | ✓ 0.4g: plan opens; unknown plan refused with no toast (agent-ui-tools, mcp-ui-tools.spec); bug 27 |  |  |
| g | `open_settings` | session · write | ✗ none | 1 | ✓ 0.4g: settings dialog opens (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `refresh_ui` | session · write | ✗ none | 1 | ✓ 0.4g: sends ui-refresh (agent-ui-tools) |  |  |
| g | `register_session` | session · read | ✗ none | 39 | ✓ 0.4g: the agent appears in /api/sessions under its type (sessions; every harness agent registers) |  |  |
| g | `screenshot` | ui · capture | ✗ none | 1 | ✓ 0.4g: refused without capture; image from the window's answer; empty answer an error (agent-ui-tools) |  |  |
| g | `select_item` | ui · write | ✗ none | 1 | ✓ 0.4g: item selected; unknown item or wrong plan refused (agent-ui-tools, mcp-ui-tools.spec); bug 27 |  |  |
| g | `set_active_plan` | session · write | ✗ none | 1 | ✓ 0.4g: shown and recorded as the agent's plan; unknown refused, unchanged (agent-ui-tools); bug 27 |  |  |
| g | `set_baseline` | session · write | ✗ none | 2 | ✓ 0.4h: pins the commit on the backend, the window reads it back; null clears; bad refs refused (baseline); bug 29 |  |  |
| g | `set_budget` | budget · write | ✗ none | 2 | ✓ 0.4g: set, exempt, clear one dimension; recorded in the agent's name and flagged until seen; nothing stored for an unknown plan (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `setup_agent_permissions` | session · settings | ✗ none | 1 | ✓ 0.4g: refused without settings; merges the wildcard; inside an opened project only, never through a link (agent-ui-tools) |  |  |
| g | `toggle_activity_drawer` | session · write | ✗ none | 1 | ✓ 0.4g: drawer toggles both ways (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `toggle_panel` | session · write | ✗ none | 1 | ✓ 0.4g: sends the panel (agent-ui-tools) |  |  |
| g | `update_settings` | ui · settings | ✗ none | 2 | ✓ 0.4g: persists first-run and data fields (cdev-phase5) |  |  |
| h | `capture_checkpoint` | drift · write | ✗ none | 3 | ✓ 0.4h: becomes checkpoint:<id>, compares against live; unknown plan refused (drift-review-tools) |  |  |
| h | `check_freeze` | governance · read | ✗ none | 2 | ✓ 0.4h: blocked during a freeze, allowed when exempt or lifted (review-governance-tools), cdev-phase6 |  |  |
| h | `commit_manifest_changes` | git · write | ✗ none | 4 | ✓ 0.4h: HEAD is the returned sha, [cdev] subject, attribution lines, clean status (worktree-project, cdev-channels) |  |  |
| h | `compare_snapshots` | review · read | ✗ none | 2 | ✓ 0.4h: checkpoint → live names exactly the changed files; unknown comparand refused (review-governance-tools) |  |  |
| h | `detect_conflicts` | git · read | ✗ none | 2 | ✓ 0.4h: names the conflicted manifest during a real merge; empty when clean (drift-review-tools), cdev-phase6 |  |  |
| h | `detect_deviations` | drift · read | ✗ none | 4 | ✓ 0.4h: missing_file for a done action's absent file; unknown plan refused (drift-review-tools), full-loop, cdev-sensors |  |  |
| h | `diff_plan_between_commits` | git · read | ✗ none | 1 | ✓ 0.4h: items added between two commits, by title (cdev-phase6) |  |  |
| h | `exempt_plan_from_freeze` | governance · write | ✗ none | 2 | ✓ 0.4h: check_freeze allows the exempt plan afterwards (cdev-phase6); recorded in the agent's name and flagged; unknown plan refused (freeze-flags, 0.4k) |  |  |
| h | `get_change_status` | drift · read | ✗ none | 1 | ✓ 0.4h: one change by id; unknown id an error (drift-review-tools); bug 30 |  |  |
| h | `get_changes_summary` | drift · read | ✗ none | 1 | ✓ 0.4h: totals by kind (drift-review-tools) |  |  |
| h | `get_deviations` | drift · read | ✗ none | 1 | ✓ 0.4h: the plan's own, same as REST; unknown plan refused (drift-review-tools) |  |  |
| h | `get_drift_report` | drift · read | ✗ none | 2 | ✓ 0.4h: planned file satisfied, the other unexpected, against the checkpoint (review-governance-tools) |  |  |
| h | `get_freeze_status` | governance · read | ✗ none | 2 | ✓ 0.4h: inactive, active with reason and remaining time, inactive again (cdev-phase6) |  |  |
| h | `get_plan_at_commit` | git · read | ✗ none | 1 | ✓ 0.4h: title and items as of each commit (cdev-phase6) |  |  |
| h | `get_plan_history` | git · read | ✗ none | 2 | ✓ 0.4h: the plan's commits, newest first, with subject and author (review-governance-tools) |  |  |
| h | `get_pr_draft` | review · read | ✗ none | 1 | ✓ 0.4h: title, review, acceptance criteria table and warnings; git untouched (review-governance-tools), plan-review |  |  |
| h | `get_team_activity` | git · read | ✗ none | 2 | ✓ 0.4h: both manifest commits, newest first (review-governance-tools) |  |  |
| h | `list_comparands` | review · read | ✗ none | 1 | ✓ 0.4h: live first, baseline, the named checkpoint, commits (drift-review-tools) |  |  |
| h | `list_proposed_changes` | drift · read | ✗ none | 1 | ✓ 0.4h: one row per file spec with operation and kind (drift-review-tools) |  |  |
| h | `reconcile` | drift · write | ✗ none | 1 | ✓ 0.4h: only this plan's deviations, checked first, in the caller's name; accepted amends the plan as them (drift-review-tools); bug 30 |  |  |
| h | `resolve_conflict` | git · write | ✗ none | 1 | ✓ 0.4h: by_side takes theirs and stages; missing side and escaping path refused (drift-review-tools) |  |  |
| h | `review_plan` | review · read | ✗ none | 1 | ✓ 0.4h: landed item, the unclaimed file named, baseline kept after rescan, markdown names its basis (review-governance-tools) |  |  |
| h | `search_plan_history` | git · read | ✗ none | 1 | ✓ 0.4h: every matching commit with its files, newest first (drift-review-tools); bug 32 |  |  |
| h | `set_freeze` | governance · write | ✗ none | 2 | ✓ 0.4h: activates and lifts, confirmed through status and check (cdev-phase6); recorded in the agent's name and flagged until seen, a lift included (freeze-flags, 0.4k) |  |  |
| i | `get_audio_context` | audio · capture | ✗ none | 1 | ✓ 0.4i: recent audio with duration; seconds narrows (cdev-phase8) |  |  |
| i | `get_audio_status` | audio · capture | ✗ none | 1 | ✓ 0.4i: not capturing, then buffered seconds and chunks (cdev-phase8) |  |  |
| i | `push_audio_chunk` | audio · capture | ✗ none | 1 | ✓ 0.4i: chunks buffered; length bounded by the schema (cdev-phase8; bug 35) |  |  |
| i | `start_audio_capture` | audio · capture | ✗ none | 1 | ✓ 0.4i: capture starts with the window asked for, bounded 1–600 s (cdev-phase8; bug 35) |  |  |
| i | `stop_audio_capture` | audio · capture | ✗ none | 1 | ✓ 0.4i: capture stops (cdev-phase8) |  |  |
| i | `terminal_create` | terminal · terminal | ✗ none | 1 | ✓ 0.4i: answers with session_id that the other tools take (terminal-session-id) |  |  |
| i | `terminal_focus` | terminal · terminal | ✗ none | 1 | ✓ 0.4i: tells the window to show that terminal; unknown refused (terminal-surface) |  |  |
| i | `terminal_kill` | terminal · terminal | ✗ none | 1 | ✓ 0.4i: kills by session_id (terminal-session-id) |  |  |
| i | `terminal_list` | terminal · terminal | ✗ none | 3 | ✓ 0.4i: same shape as create (terminal-session-id) |  |  |
| i | `terminal_read` | terminal · terminal | ✗ none | 1 | ✓ 0.4i: reads what the shell printed (terminal-session-id) |  |  |
| i | `terminal_resize` | terminal · terminal | ✗ none | 1 | ✓ 0.4i: the shell sees the new width (tput cols); unknown refused (terminal-surface) |  |  |
| i | `terminal_write` | terminal · terminal | ✗ none | 2 | ✓ 0.4i: runs in another terminal; refused on the agent's own host terminal and on a killed one (terminal-surface), terminal-session-id |  |  |
| j | `get_peer_status` | peer · read | ✗ none | 4 | ✓ 0.4j: paired and connected counts with a phone connected (phone-peer-tools) |  |  |
| j | `get_remote_audio` | peer · capture | ✗ none | 2 | ✓ 0.4j: counts peers (phone-peer-tools) |  |  |
| j | `get_remote_state` | peer · read | ✗ none | 2 | ✓ 0.4j: the peer's snapshot, one or all; none yet refused (phone-peer-tools) |  |  |
| j | `list_discovered_peers` | peer · read | ✗ none | 2 | ✓ 0.4j: a list (mDNS off in the harness) (phone-peer-tools) |  |  |
| j | `list_paired_devices` | peer · read | ✗ none | 2 | ✓ 0.4j: the phone, no secret (phone-peer-tools) |  |  |
| j | `list_peer_connections` | peer · read | ✗ none | 2 | ✓ 0.4j: the phone, named as paired, connected (phone-peer-tools) |  |  |
| j | `list_remote_input_requests` | peer · read | ✗ none | 2 | ✓ 0.4j: the peer's question with its prompt (phone-peer-tools) |  |  |
| j | `list_remote_terminals` | peer · terminal | ✗ none | 2 | ✓ 0.4j: the peer's shared terminal, all or by peer (phone-peer-tools) |  |  |
| j | `mobile_navigate` | mobile · write | ✗ none | 1 | ✓ 0.4j: view, plan and item routes reach the phone; unknown plan or item refused (phone-sync-and-tools) |  |  |
| j | `mobile_present` | mobile · write | ✗ none | 1 | ✓ 0.4j: card reaches the phone through the snapshot (phone-sync-and-tools) |  |  |
| j | `mobile_screenshot` | mobile · capture | ✗ none | 1 | ✓ 0.4j: chunks reassembled in any order; the phone's error passed on (phone-sync-and-tools) |  |  |
| j | `respond_remote_input` | peer · write | ✗ none | 2 | ✓ 0.4j: answer reaches the peer once; again refused (phone-peer-tools) |  |  |
| j | `unpair_device` | peer · settings | ✗ none | 2 | ✓ 0.4j: forgotten and disconnected; unknown refused (isError) (phone-peer-tools, cdev-phase9) |  |  |
| j | `write_remote_terminal` | peer · terminal | ✗ none | 1 | ✓ 0.4j: input reaches the peer's terminal; unknown refused (phone-peer-tools) |  |  |
| l | `check_doc_freshness` | system-docs · read | ✗ none | 2 | ✓ 0.4l: fresh after verify; names the referenced file after a commit changes it; same as REST (sysdocs-intake) |  |  |
| l | `create_plan_from_external` | intake · write | ✗ none | 4 | ✓ 0.4l: nested items with ticket keys (derived from URLs), fourth level levelled into the third, criteria as a checklist; duplicate epic refused naming the plan; no project refused (sysdocs-intake) |  |  |
| l | `delete_system_doc` | system-docs · write | ✗ none | 2 | ✓ 0.4l: row and file gone; unknown refused (sysdocs-intake) |  |  |
| l | `get_external_sync_state` | intake · read | ✗ none | 2 | ✓ 0.4l: all ticketed items before the first sync, reading does not advance it, then only what moved with a suggested transition; unknown plan refused (sysdocs-intake) |  |  |
| l | `list_plan_external_refs` | intake · read | ✗ none | 2 | ✓ 0.4l: the plan's own ticket; unknown plan refused (sysdocs-intake) |  |  |
| l | `list_system_docs` | system-docs · read | ✗ none | 3 | ✓ 0.4l: the project's docs; search over title and body (sysdocs-intake) |  |  |
| l | `mark_external_synced` | intake · write | ✗ none | 3 | ✓ 0.4l: advances the watermark; unknown plan refused (sysdocs-intake) |  |  |
| l | `read_system_doc` | system-docs · read | ✗ none | 1 | ✓ 0.4l: by uid or by slug; unknown refused (sysdocs-intake) |  |  |
| l | `set_plan_external_ref` | intake · write | ✗ none | 1 | ✓ 0.4l: idempotent on the key; unknown plan refused (sysdocs-intake) |  |  |
| l | `verify_system_doc` | system-docs · write | ✗ none | 3 | ✓ 0.4l: stamps HEAD (sysdocs-intake) |  |  |
| l | `write_system_doc` | system-docs · write | ✗ none | 3 | ✓ 0.4l: creates in the agent's name (was recorded as a person's); update renames the file with the title; unknown uid refused (sysdocs-intake); bug 47 |  |  |

## Mobile RPC methods (84)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `diagnostics.flush` | read | ✗ none | 1 | ✓ 0.4j: entries in the desktop log tagged with the phone; non-text skipped (phone-channels-projects) |  |  |
| a | `fs.browse` | files | ✗ none | 1 | ✓ 0.4j: folders, project-looking first; needs files (phone-graph-review) |  |  |
| a | `project.active` | read | ✗ none | 1 | ✓ 0.4j: the open project (phone-channels-projects) |  |  |
| a | `project.alias` | project | ✗ none | 1 | ✓ 0.4j: display name; not recent refused (phone-channels-projects) |  |  |
| a | `project.close` | project | ✗ none | 1 | ✓ 0.4j: desktop closes the tab; not recent refused (phone-channels-projects) |  |  |
| a | `project.list` | read | ✗ none | 1 | ✓ 0.4j: same as the desktop's recent list (phone-channels-projects) |  |  |
| a | `project.open` | project | ✗ none | 1 | ✓ 0.4j: scans, opens on the desktop too; a missing folder refused (phone-channels-projects) |  |  |
| a | `project.pin` | project | ✗ none | 1 | ✓ 0.4j: pin and unpin; not recent refused (phone-channels-projects) |  |  |
| a | `project.remove` | project | ✗ none | 1 | ✓ 0.4j: gone from the list; not recent refused (phone-channels-projects) |  |  |
| a | `project.rescan` | project | ✗ none | 1 | ✓ 0.4j: picks up a new file; unopened refused (phone-channels-projects) |  |  |
| b | `changes.summary` | read | ✗ none | 1 | ✓ 0.4j: git and the architecture diff agree; unopened refused (phone-graph-review) |  |  |
| b | `graph.directory` | read | ✗ none | 1 | ✓ 0.4j: one level of files and subdirectories (phone-graph-review) |  |  |
| b | `graph.file` | read | ✗ none | 1 | ✓ 0.4j: symbols and imports as the desktop has them (phone-graph-review) |  |  |
| b | `graph.fileSearch` | read | ✗ none | 1 | ✓ 0.4j: by project-relative path, query is text not a pattern (phone-graph-review); bug 40 |  |  |
| b | `graph.fileSource` | files | ✗ none | 1 | ✓ 0.4j: content and git gutter; outside, sibling-prefix and link refused; needs files (phone-graph-review) |  |  |
| b | `graph.overview` | read | ✗ none | 1 | ✓ 0.4j: the desktop's summary, most-imported as absolute paths (phone-graph-review) |  |  |
| b | `graph.scene` | read | ✗ none | 1 | ✓ 0.4j: clusters and edges; live marks changed, planned marks the plan's file (phone-graph-review) |  |  |
| b | `graph.search` | read | ✗ none | 1 | ✓ 0.4j: same as the desktop's symbol search (phone-graph-review) |  |  |
| c | `comment.add` | write | ✗ none | 1 | ✓ 0.4j: item comment reaches the item thread, plan comment the plan; unknown target refused (phone-plans); bug 37 |  |  |
| c | `item.ref.add` | write | ✗ none | 1 | ✓ 0.4j: link on the item, desktop told; unknown item refused (phone-plans); bug 37 |  |  |
| c | `item.ref.remove` | write | ✗ none | 1 | ✓ 0.4j: removed, desktop told; unknown refused (phone-plans); bug 37 |  |  |
| c | `plan.copyAsPrompt` | read | ✗ none | 1 | ✓ 0.4j: the handoff prompt, work not yet started; unknown refused (phone-plans) |  |  |
| c | `plan.create` | write | ✗ none | 2 | ✓ 0.4j: in the open project, as the person, desktop told (phone-plans); bug 37 |  |  |
| c | `plan.delete` | write | ✗ none | 1 | ✓ 0.4j: archived, files out of the project and they stay out, desktop told; unknown refused (phone-plans); bugs 37, 39 |  |  |
| c | `plan.document` | read | ✗ none | 1 | ✓ 0.4j: the doc body; unknown refused (phone-plans) |  |  |
| c | `plan.file.discover` | write | ✗ none | 1 | ✓ 0.4j: finds the exported folder (phone-plans) |  |  |
| c | `plan.file.export` | write | ✗ none | 1 | ✓ 0.4j: into the plan's own project; unknown plan refused (phone-plans) |  |  |
| c | `plan.file.import` | write | ✗ none | 1 | ✓ 0.4j: reads it back; outside an opened project refused (phone-plans) |  |  |
| c | `plan.get` | read | ✗ none | 1 | ✓ 0.4j: plan, items, documents, deviations, links, comments; unknown refused (phone-plans) |  |  |
| c | `plan.item.create` | write | ✗ none | 1 | ✓ 0.4j: as the person, desktop told; unknown plan refused (phone-plans); bug 37 |  |  |
| c | `plan.item.get` | read | ✗ none | 1 | ✓ 0.4j: item with comments, links, attachments; unknown refused (phone-plans) |  |  |
| c | `plan.item.update` | write | ✗ none | 1 | ✓ 0.4j: edits save (author recorded), desktop told, status checked (phone-plans); bugs 36, 37, 38 |  |  |
| c | `plan.items` | read | ✗ none | 1 | ✓ 0.4j: items with status; unknown plan refused (phone-plans) |  |  |
| c | `plan.list` | read | ✗ none | 1 | ✓ 0.4j: counts per plan; filter by an opened project only (phone-plans) |  |  |
| c | `plan.nextItem` | read | ✗ none | 1 | ✓ 0.4j: same as the desktop's next-task; none while nothing is pending (phone-plans) |  |  |
| c | `plan.template.create` | write | ✗ none | 1 | ✓ 0.4j: plan with items; desktop told with the plan; unknown template refused (phone-plans); bug 37 |  |  |
| c | `plan.template.list` | read | ✗ none | 1 | ✓ 0.4j: same templates as the desktop (phone-plans) |  |  |
| c | `plan.update` | write | ✗ none | 1 | ✓ 0.4j: the desktop's edit path — desktop told, status checked, unknown refused (phone-plans); bugs 37, 38 |  |  |
| d | `criteria.awaiting` | read | 1 | 1 | ✓ 0.4j: empty until the agent submits, then the criterion; empty after deciding (phone-sync-and-tools), mobile-approvals unit |  |  |
| d | `criteria.list` | read | ✗ none | 1 | ✓ 0.4j: the item's criteria (phone-sync-and-tools), mobile-approvals unit |  |  |
| d | `criterion.decide` | write | 1 | 1 | ✓ 0.4j: approved from the phone (phone-sync-and-tools), mobile-approvals unit |  |  |
| e | `artefact.preview` | files | 1 | 1 | ✓ 0.4j: unknown file and bad transfer id refused (phone-sync-and-tools), mobile-approvals unit |  |  |
| f | `channel.events` | read | ✗ none | 1 | ✓ 0.4j: same as REST; limit (phone-channels-projects) |  |  |
| f | `channel.eventsSinceSeq` | read | ✗ none | 1 | ✓ 0.4j: all since 0, empty when caught up, then only the new one (phone-channels-projects) |  |  |
| f | `channel.get` | read | ✗ none | 1 | ✓ 0.4j: one event; unknown refused (phone-channels-projects) |  |  |
| f | `channel.post` | write | ✗ none | 1 | ✓ 0.4j: the desktop's path — author is the person whatever the request says, routing, export, desktop told; bad type/empty/unknown plan refused (phone-channels-projects); bug 37 |  |  |
| f | `channel.resolve` | write | ✗ none | 1 | ✓ 0.4j: status changes, desktop told; bad status and unknown refused (phone-channels-projects) |  |  |
| f | `channel.thread` | read | ✗ none | 1 | ✓ 0.4j: root then reply (phone-channels-projects) |  |  |
| f | `input.respond` | write | ✗ none | 1 | ✓ 0.4j: answer reaches the asking peer once; not pending refused (phone-channels-projects) |  |  |
| g | `awareness.answer` | write | 1 | 1 |  |  |  |
| g | `awareness.needsYou` | read | ✗ none | 1 |  |  |  |
| g | `awareness.reply` | write | ✗ none | 1 |  |  |  |
| g | `awareness.signal` | read | ✗ none | 1 |  |  |  |
| g | `breakpoint.answer` | write | 1 | 1 | ✓ B4.4: continue, steer (needs a note) or stop in the person's name; confirmed pairing only, audited, desktop told; the first answer stands (phone-breakpoints) |  |  |
| g | `breakpoint.waiting` | read | 1 | 1 | ✓ B4.4: held calls oldest first in the desktop's words, pauses and breaches, with the three answers worded for each (phone-breakpoints) |  |  |
| g | `budget.acknowledge` | write | 1 | 1 | ✓ 0.4j: unflagged, desktop told (phone-sync-and-tools), mobile-budget unit |  |  |
| g | `budget.get` | read | 1 | 1 | ✓ 0.4j: agent's change flagged (phone-sync-and-tools), mobile-budget unit |  |  |
| g | `workstreams.detail` | read | ✗ none | 1 |  |  |  |
| g | `workstreams.list` | read | ✗ none | 1 |  |  |  |
| h | `deviation.list` | read | ✗ none | 1 | ✓ 0.4j: same as REST; unknown plan refused (phone-plans) |  |  |
| h | `deviation.resolve` | write | ✗ none | 1 | ✓ 0.4j: resolved as the person; bad action and unknown id refused (phone-plans) |  |  |
| h | `freeze.acknowledge` | write | ✗ none | 1 | ✓ 0.4k: unflags in the person's name, audited, desktop told; bad id refused (freeze-flags) |  |  |
| h | `freeze.get` | read | ✗ none | 1 | ✓ 0.4k: the plan's project freeze and the agent's changes in the desktop's words; unknown plan refused (freeze-flags) |  |  |
| h | `review.comparands` | read | ✗ none | 1 | ✓ 0.4j: same as the desktop's; unknown plan refused (phone-graph-review) |  |  |
| h | `review.compare` | read | ✗ none | 1 | ✓ 0.4j: same as the desktop's; unknown checkpoint refused (phone-graph-review) |  |  |
| h | `review.get` | read | ✗ none | 1 | ✓ 0.4j: same review as the desktop; unknown plan refused (phone-graph-review) |  |  |
| h | `review.prDraft` | read | ✗ none | 1 | ✓ 0.4j: same draft as the desktop (phone-graph-review) |  |  |
| i | `terminal.create` | terminal | ✗ none | 1 | ✓ 0.4j: shell in the project, shown on the desktop (phone-terminals-sysdocs) |  |  |
| i | `terminal.history` | terminal | ✗ none | 1 | ✓ 0.4j: scrollback, paged (phone-terminals-sysdocs) |  |  |
| i | `terminal.kill` | terminal | ✗ none | 1 | ✓ 0.4j: ended for phone and desktop; history kept (phone-terminals-sysdocs) |  |  |
| i | `terminal.list` | terminal | ✗ none | 1 | ✓ 0.4j: needs the terminal grant (refusal audited); lists the new shell (phone-terminals-sysdocs) |  |  |
| i | `terminal.read` | terminal | ✗ none | 1 | ✓ 0.4j: what the shell printed; not there refused (phone-terminals-sysdocs) |  |  |
| i | `terminal.resize` | terminal | ✗ none | 1 | ✓ 0.4j: shell sees the width; bad sizes and not there refused (phone-terminals-sysdocs) |  |  |
| i | `terminal.stream` | terminal | ✗ none | 1 | ✓ 0.4j: whole buffer, then only what is new (phone-terminals-sysdocs) |  |  |
| i | `terminal.write` | terminal | ✗ none | 1 | ✓ 0.4j: runs in the shell; not there refused (phone-terminals-sysdocs) |  |  |
| k | `power.status` | read | ✗ none | 1 | ✓ 0.4j: the desktop's answer, and the snapshot's (phone-channels-projects) |  |  |
| k | `settings.get` | read | ✗ none | 1 | ✓ 0.4j: same as the desktop's (phone-channels-projects) |  |  |
| k | `settings.update` | settings | ✗ none | 1 | ✓ 0.4j: needs the settings grant; phone-safe part only — ports, paths, webhook hosts untouched (phone-channels-projects) |  |  |
| l | `sysdoc.create` | write | ✗ none | 1 | ✓ 0.4j: file in the project, desktop told (phone-terminals-sysdocs) |  |  |
| l | `sysdoc.delete` | write | ✗ none | 1 | ✓ 0.4j: removed, desktop told; unknown refused (phone-terminals-sysdocs) |  |  |
| l | `sysdoc.list` | read | ✗ none | 1 | ✓ 0.4j: same as REST; search; unopened refused (phone-terminals-sysdocs) |  |  |
| l | `sysdoc.read` | read | ✗ none | 1 | ✓ 0.4j: doc and freshness as REST; unknown refused (phone-terminals-sysdocs) |  |  |
| l | `sysdoc.update` | write | ✗ none | 1 | ✓ 0.4j: saved, desktop told; unknown refused (phone-terminals-sysdocs) |  |  |
| l | `sysdoc.verify` | write | ✗ none | 1 | ✓ 0.4j: verified, desktop told; unknown refused (phone-terminals-sysdocs) |  |  |

## Frontend components (111)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| b | `graph/edges/ImportEdge.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/BreakpointBadge.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/DirectoryNode.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/FileNode.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/PackageNode.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/SymbolNode.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/WorkOverlayMarks.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/OverlaysMenu.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/SelectionActionBar.tsx` |  | n/a | n/a |  |  |  |
| b | `inspector/AddToTaskPopover.tsx` |  | n/a | n/a |  |  |  |
| b | `inspector/CodeDiffView.tsx` |  | n/a | n/a |  |  |  |
| b | `inspector/CodePreview.tsx` |  | n/a | n/a |  |  |  |
| b | `inspector/PlaybackBar.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/CommentThread.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/ContributorBranchModal.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/CrossRepoSection.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/MinimizedPlanChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/OtherWorktreesSection.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/PlanDeletionRequest.tsx` |  | n/a | n/a |  | ✓ 0.5a — says what deleting does; typed confirmation |  |
| c | `plan/PlanListView.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/PlanTemplatePicker.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/ProposedChanges.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/PublishTemplateModal.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/StatusBadge.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/AnchorPicker.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/BodyRenderer.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ChannelPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/CodebaseOrientation.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/CodeBlockPicker.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ContextRail.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ContributionPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/CopyRef.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/CriteriaBlock.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/DriftIndicator.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ExecutionDashboard.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ExternalRefsPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/FileSymbolExpander.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/FreezeBar.tsx` |  | n/a | n/a |  | ✓ 0.5a — flagged change named, with Seen |  |
| c | `plan/v2/HandoffButton.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ItemRoutingPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ManifestConflictBar.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/MentionPicker.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/NextUpStrip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PantryPlaceholder.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanActivityDrawer.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanBudgetChip.tsx` |  | n/a | n/a |  | ✓ 0.5 — units stay on the ceiling boxes (0.5b) |  |
| c | `plan/v2/PlanCheckRunPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanCompletionSummary.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanDiffPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanGitContextChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanHistoryRail.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanImportModal.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanItemCanvas.tsx` |  | n/a | n/a |  | ✓ 0.5 — says status once; icons not emoji (0.5c). Minor: gaps (m4) |  |
| c | `plan/v2/PlanItemHistoryDrawer.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanItemTree.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanQualityNudge.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanReadinessRing.tsx` |  | n/a | n/a |  | ✓ 0.5a — major fixed: red "44%" → "1 to do before hand-off" (M2) |  |
| c | `plan/v2/PlanReviewPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanShareMenu.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanSwitcher.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanSyncChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanTemplateChooser.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanTicketSyncChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanVersionHistory.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanWorkspaceShellV2.tsx` |  | n/a | n/a |  | ✓ 0.5 — no "V2" badge (0.5c) |  |
| c | `plan/v2/SkillsEditor.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/SlashMenu.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/TargetsStrip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/TeamActivityPanel.tsx` |  | n/a | n/a |  |  |  |
| e | `artefact/ArtefactViewer.tsx` |  | n/a | n/a |  |  |  |
| e | `brief/BriefWorkspace.tsx` |  | n/a | n/a |  | ✓ 0.5 — agent-agnostic wording (0.5b) |  |
| e | `brief/SignoffPackControls.tsx` |  | n/a | n/a |  |  |  |
| f | `presence/PresencePane.tsx` |  | n/a | n/a |  | ✓ 0.5 — one count that names what it counts (0.5c). Minors: toast over reply (m17), above modal backdrop (m22) |  |
| g | `ActiveAgentProjects.tsx` |  | n/a | n/a |  |  |  |
| g | `ErrorBoundary.tsx` |  | n/a | n/a |  |  |  |
| g | `FirstRunWizard.tsx` |  | n/a | n/a |  |  |  |
| g | `FolderPickerModal.tsx` |  | n/a | n/a |  | ✓ 0.5 — opens beside the open project (0.5c) |  |
| g | `GettingStarted.tsx` |  | n/a | n/a |  |  |  |
| g | `guide/GuideModal.tsx` |  | n/a | n/a |  | ✓ 0.5a |  |
| g | `layout/AgentPanel.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/AgentPulse.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/AgentTurns.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/AwarenessTab.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/Breakpoints.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/CodeWorkspace.tsx` |  | n/a | n/a |  | ✓ 0.5a — empty state says what to do |  |
| g | `layout/ConnectedAgents.tsx` |  | n/a | n/a |  | ✓ 0.5a |  |
| g | `layout/CoverageChip.tsx` |  | n/a | n/a |  | ✓ 0.5 — "imports linked" (0.5c) |  |
| g | `layout/InspectorPanel.tsx` |  | n/a | n/a |  | ✓ 0.5a — minor: sparse file view (m21) |  |
| g | `layout/MainCanvas.tsx` |  | n/a | n/a |  | ✓ 0.5a — major fixed: change summary covered the toolbar; now one quiet line (M1). Minor: 4-row toolbar at 1024 (m23) |  |
| g | `layout/PlanPanel.tsx` |  | n/a | n/a |  | ✓ 0.5a — major fixed: "Agent active" vs "No agents" (M3) |  |
| g | `layout/ReplayBar.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/Sidebar.tsx` |  | n/a | n/a |  | ✓ 0.5a |  |
| g | `layout/StatusBar.tsx` |  | n/a | n/a |  | ✓ 0.5a — minor: "1852/3680 linked" (m16) |  |
| g | `layout/TimelineLanes.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/TopBar.tsx` |  | n/a | n/a |  | ✓ 0.5 — depth tabs dim where no graph shows; branch chip one line (0.5c) |  |
| g | `layout/WorkstreamStrip.tsx` |  | n/a | n/a |  |  |  |
| g | `Toast.tsx` |  | n/a | n/a |  |  |  |
| g | `UnverifiedTag.tsx` |  | n/a | n/a |  |  |  |
| g | `WelcomeScreen.tsx` |  | n/a | n/a |  |  |  |
| i | `audio/AudioCaptureBar.tsx` |  | n/a | n/a |  | ✓ 0.5a |  |
| i | `terminal/TerminalInstance.tsx` |  | n/a | n/a |  |  |  |
| i | `terminal/TerminalPanel.tsx` |  | n/a | n/a |  | ✓ 0.5a |  |
| j | `pairing/DeviceIndicator.tsx` |  | n/a | n/a |  |  |  |
| j | `pairing/RemotePeersPanel.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/AddToClaudeCode.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/AddToClaudeDesktop.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/AddToGeminiCli.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/SettingsModal.tsx` |  | n/a | n/a |  | ✓ 0.5 — one height for every section (0.5b) |  |
| k | `settings/VerifiedUpdateDownload.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/WebcamQrScanner.tsx` |  | n/a | n/a |  |  |  |
| l | `system-docs/SystemDocsPanel.tsx` |  | n/a | n/a |  | ✓ 0.5a — empty state is content |  |

## Mobile screens (35)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| j | `_layout.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/_layout.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/activity.tsx` |  | n/a | 2 |  |  |  |
| j | `(tabs)/graph.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/index.tsx` |  | n/a | 2 |  |  |  |
| j | `(tabs)/plans.tsx` |  | n/a | 1 |  |  |  |
| j | `(tabs)/terminals.tsx` |  | n/a | n/a |  |  |  |
| j | `approval.tsx` |  | n/a | n/a |  |  |  |
| j | `approvals.tsx` |  | n/a | 1 |  |  |  |
| j | `body-editor.tsx` |  | n/a | n/a |  |  |  |
| j | `breakpoints.tsx` |  | n/a | 1 |  |  |  |
| j | `changes.tsx` |  | n/a | n/a |  |  |  |
| j | `connection-switcher.tsx` |  | n/a | n/a |  |  |  |
| j | `doc-viewer.tsx` |  | n/a | n/a |  |  |  |
| j | `event-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `graph-file-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `index.tsx` |  | n/a | n/a |  |  |  |
| j | `input-request.tsx` |  | n/a | n/a |  |  |  |
| j | `item-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `notification-settings.tsx` |  | n/a | n/a |  |  |  |
| j | `pair.tsx` |  | n/a | n/a |  |  |  |
| j | `plan-channel.tsx` |  | n/a | n/a |  |  |  |
| j | `plan-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `plan-review.tsx` |  | n/a | n/a |  |  |  |
| j | `plan-templates.tsx` |  | n/a | n/a |  |  |  |
| j | `project-browser.tsx` |  | n/a | n/a |  |  |  |
| j | `projects.tsx` |  | n/a | n/a |  |  |  |
| j | `settings.tsx` |  | n/a | n/a |  |  |  |
| j | `signal-detail.tsx` |  | n/a | 1 |  |  |  |
| j | `system-doc-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `system-docs.tsx` |  | n/a | n/a |  |  |  |
| j | `terminal-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `workspace.tsx` |  | n/a | n/a |  |  |  |
| j | `workstream-detail.tsx` |  | n/a | 1 |  |  |  |
| j | `workstreams.tsx` |  | n/a | 1 |  |  |  |

## Settings sections (12)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| k | `about` |  | n/a | n/a | ✓ 0.4k: name, version, copy build info, jump to Updates (e2e about) | ✓ 0.5a — macOS note only on macOS, no longer amber |  |
| k | `appearance` |  | n/a | n/a |  | ✓ 0.5 — dark native controls (0.5b) |  |
| k | `data` |  | n/a | n/a | ✓ 0.4k: override box and the restart note (e2e data) — saving not checked | ✓ 0.5 — note is advice, not a warning (0.5b); saving the override still unverified |  |
| k | `devices` |  | n/a | n/a | ✓ 0.4k: share-audio saves (e2e sections-save); per-device grants incl. capture (phone-grants, peer-device-access) | ✓ 0.5a — major fixed: "no ports exposed" contradicted the port it opens; placeholder no longer a real name |  |
| k | `identity` |  | n/a | n/a | ✓ 0.4k: display name saves on leaving the box (e2e sections-save); pull from git config (e2e identity) | ✓ 0.5a |  |
| k | `logs` |  | n/a | n/a | ✓ 0.4k: output area, refresh, reveal (e2e logs); tail and path (settings-surface) | ✓ 0.5 — says when this run writes no log file (0.5b) |  |
| k | `mcp` |  | n/a | n/a | ✓ 0.4k: a refused port says why and nothing changes (e2e sections-save); port, autodetect, config snippet (e2e mcp-server); agent grants (agent-ui-tools) | ✓ 0.5 — a refused value is named as a person reads it (0.5b) |  |
| k | `plans` |  | n/a | n/a | ✓ 0.4k: default visibility saves (e2e sections-save, e2e plans) | ✓ 0.5a — stale "coming" note and raw markdown link fixed |  |
| k | `power` |  | n/a | n/a | ✓ 0.4k: a keep-awake trigger saves, siblings kept (e2e sections-save, settings-surface) | ✓ 0.5 — plain words, status says what is happening (0.5b) |  |
| k | `sync` |  | n/a | n/a |  | ✓ 0.5a |  |
| k | `telemetry` |  | n/a | n/a | ✓ 0.4k: says what leaves the machine: update checks only; dictionaries ship with the app (e2e updates; spellcheck-check in CI) | ✓ 0.5 — no hard-coded database path (0.5b) |  |
| k | `updates` |  | n/a | n/a | ✓ 0.4k: automatic checks off is saved (e2e updates); off means no request, a person's check still works (updates) | ✓ 0.5 — error says why with retry; footer describes the verified download (0.5b) |  |
