# Phase 32 — Verification matrix

> **Generated** by `npm run inventory` (`tools/inventory/`). Do not edit the
> tables by hand: the behaviour, UX and notes columns come from
> `tools/inventory/verification.json`, and `npm run inventory:check` fails when
> this file is stale. Stage 0 of [PHASE-32-EXECUTION.md](PHASE-32-EXECUTION.md).

"Unit" and "Harness" count the test files that mention the row (a route path,
a quoted tool or method name). A mention is not proof of a meaningful test —
0.3 turns these into enforced guards and 0.4 checks behaviour — but "✗ none"
is proof of a gap.

## Summary

| Surface | Rows | No unit mention | No harness mention | Neither | Behaviour verified | UX checked |
|---|---|---|---|---|---|---|
| REST routes | 215 | 201 | 21 | 21 | 90 | 0 |
| MCP tools | 185 | 147 | 19 | 13 | 91 | 0 |
| Mobile RPC methods | 72 | 47 | 72 | 47 | 0 | 0 |
| Frontend components | 99 | n/a | n/a | n/a | 0 | 0 |
| Mobile screens | 31 | n/a | n/a | n/a | 0 | 0 |
| Settings sections | 12 | n/a | n/a | n/a | 0 | 0 |

## By domain

| Domain | REST | MCP | RPC | Components | Mobile | Settings |
|---|---|---|---|---|---|---|
| 0.4a Project and scan | 19 | 12 | 10 | 0 | 0 | 0 |
| 0.4b Graph | 17 | 15 | 8 | 10 | 0 | 0 |
| 0.4c Plans and items | 88 | 51 | 20 | 55 | 0 | 0 |
| 0.4d Criteria and sign-off | 9 | 7 | 3 | 0 | 0 | 0 |
| 0.4e Brief and viewer | 5 | 4 | 1 | 3 | 0 | 0 |
| 0.4f Channels and presence | 6 | 9 | 7 | 1 | 0 | 0 |
| 0.4g Agents and MCP | 10 | 26 | 0 | 20 | 0 | 0 |
| 0.4h Drift, governance, review | 8 | 24 | 6 | 0 | 0 | 0 |
| 0.4i Terminals and audio | 10 | 12 | 8 | 3 | 0 | 0 |
| 0.4j Mobile surface | 25 | 14 | 0 | 2 | 31 | 0 |
| 0.4k Settings, updates, privacy | 11 | 0 | 3 | 4 | 0 | 12 |
| 0.4l System docs and intake | 7 | 11 | 6 | 1 | 0 | 0 |

## MCP tools: registry vs capability matrix

- Registered by the server: **185**
- Rows in `TOOL_CAPABILITIES`: **185**
- Rows for tools the server does not register: none
- Registered tools with no row (refused at call time): none

## REST routes (215)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `DELETE /api/recent-projects` |  | 1 | 6 | ✓ 0.4a: removes a listed entry, including one whose directory is gone (project-open) |  |  |
| a | `GET /api/auto-detect` |  | ✗ none | 1 | ✓ 0.4a: live sessions only, with branch (auto-detect) |  |  |
| a | `GET /api/build-info` |  | ✗ none | 1 | ✓ 0.4a: version/commit stamp, token-gated (smoke, transport-auth) |  |  |
| a | `GET /api/fs/browse` |  | ✗ none | 2 | ✓ 0.4a: lists a home dir; / /etc /var refused (misc-endpoints, filesystem-boundary) |  |  |
| a | `GET /api/git/branch` |  | ✗ none | 2 | ✓ 0.4a: main checkout and linked worktree (git-integration, worktree-project; bug 16) |  |  |
| a | `GET /api/git/branch-tip` |  | ✗ none | 2 | ✓ 0.4a: tip equals HEAD; option-like refs refused (git-integration) |  |  |
| a | `GET /api/git/commits` |  | ✗ none | 1 | ✓ 0.4a: recent commits with hashes and subjects (git-integration) |  |  |
| a | `GET /api/git/head` |  | ✗ none | 2 | ✓ 0.4a: matches status hash (git-integration) |  |  |
| a | `GET /api/git/info` |  | 1 | 3 | ✓ 0.4a: branches incl. packed, other checkouts, hasCommits — from a worktree too (worktree-project; bug 16) |  |  |
| a | `GET /api/git/status` |  | ✗ none | 1 | ✓ 0.4a: hash and file arrays (git-integration) |  |  |
| a | `GET /api/git/worktrees` |  | ✗ none | 2 | ✓ 0.4a: both checkouts and the other one's plans, from a worktree; unopened refused (worktree-project, misc-endpoints) |  |  |
| a | `GET /api/health` |  | 1 | 3 | ✓ 0.4a: status, parser, memory (misc-endpoints, smoke) |  |  |
| a | `GET /api/identity/git-defaults` |  | ✗ none | 2 | ✓ 0.4a: the project's own git identity (project-open) |  |  |
| a | `GET /api/onboarding-state` |  | ✗ none | 3 | ✓ 0.4a: moves with plans and connected agents (project-open) |  |  |
| a | `GET /api/project-config` |  | ✗ none | 1 | ✓ 0.4a: repoRole per project (cdev-central-oversight) |  |  |
| a | `GET /api/recent-projects` |  | 1 | 6 | ✓ 0.4a: branch recorded, pinned first (project-open, worktree-project) |  |  |
| a | `GET /api/stats` |  | ✗ none | 3 | ✓ 0.4a: counts track rescans (project-open, smoke) |  |  |
| a | `POST /api/project/scan` |  | 2 | 76 | ✓ 0.4a: seeds identity once; rescan adds and drops files (project-open, and 60+ others) |  |  |
| a | `POST /api/recent-projects/pin` |  | 1 | 2 | ✓ 0.4a: reorders, and unpin restores recency order (project-open) |  |  |
| b | `GET /api/architecture-summary` |  | ✗ none | 2 | ✓ 0.4b: counts match stats; dirs, languages, most-imported (graph-rest) |  |  |
| b | `GET /api/coverage` |  | ✗ none | 1 | ✓ 0.4b: unread code by reason, unserved routes (coverage) |  |  |
| b | `GET /api/cross-system` |  | ✗ none | 6 | ✓ 0.4b: the fixture's six pairings, before and after changes (cross-system) |  |  |
| b | `GET /api/dependencies` |  | ✗ none | 3 | ✓ 0.4b: edges after scan (smoke, cross-system) |  |  |
| b | `GET /api/dependencies/file` |  | ✗ none | 2 | ✓ 0.4b: matches get_dependencies; relative or absolute (graph-tools; bug 17) |  |  |
| b | `GET /api/diff` |  | ✗ none | 2 | ✓ 0.4b: empty after scan; added/modified files, new edge, blast radius, git untracked — live, no rescan (graph-rest; bug 20) |  |  |
| b | `GET /api/file/at` |  | ✗ none | 2 | ✓ 0.4b: content at a commit or snapshot (file-at, review-comparand-edges) |  |  |
| b | `GET /api/file/content` |  | ✗ none | 2 | ✓ 0.4b: returns the file's exact content; outside opened projects 403 (misc-endpoints, filesystem-boundary) |  |  |
| b | `GET /api/file/overlay` |  | ✗ none | 2 | ✓ 0.4b: plan edits mapped onto lines (plan-overlay) |  |  |
| b | `GET /api/playback` |  | ✗ none | 2 | ✓ 0.4b: discrete frames between comparands (playback) |  |  |
| b | `GET /api/symbols/file` |  | ✗ none | 5 | ✓ 0.4b: flat qualified symbols per language (go/ruby/jvm-apple support, smoke) |  |  |
| b | `GET /api/symbols/search` |  | ✗ none | 2 | ✓ 0.4b: finds symbols by name, incl. through a workspace alias (smoke, input-validation) |  |  |
| b | `GET /api/systems` |  | ✗ none | 3 | ✓ 0.4b: the fixture's services by path (graph-rest) |  |  |
| b | `GET /api/trellis/:id` |  | ✗ none | 3 | ✓ 0.4b: includes the branch (baselines) |  |  |
| b | `GET /api/trellis/:id/diff` |  | ✗ none | 2 | ✓ 0.4b: empty at capture; then the new file and its edge, live; 404 unknown (baselines) |  |  |
| b | `GET /api/trellis/snapshots` |  | ✗ none | 1 | ✓ 0.4b: lists the capture (baselines) |  |  |
| b | `POST /api/trellis/capture` |  | ✗ none | 3 | ✓ 0.4b: (baselines) |  |  |
| c | `DELETE /api/attachments/:uid` |  | ✗ none | 1 | ✓ 0.4c-2: removes; unknown 404 (item-surface) |  |  |
| c | `DELETE /api/comments/:uid` |  | ✗ none | 1 | ✓ 0.4c-2: removes a reply from the thread (item-surface) |  |  |
| c | `DELETE /api/items/:uid` |  | ✗ none | 7 |  |  |  |
| c | `DELETE /api/plan-docs/:docUid` |  | ✗ none | 1 |  |  |  |
| c | `DELETE /api/plan-phases/:phaseUid` |  | ✗ none | 2 |  |  |  |
| c | `DELETE /api/plans/:uid` |  | 1 | 12 |  |  |  |
| c | `DELETE /api/refs/:uid` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/attachments/:uid/file` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/comments` |  | ✗ none | 1 | ✓ 0.4c-2: threaded with replies (item-surface) |  |  |
| c | `GET /api/contributions` |  | 1 | 3 |  |  |  |
| c | `GET /api/items/:itemUid/refs` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/items/:uid` |  | ✗ none | 7 |  |  |  |
| c | `GET /api/items/:uid/attachments` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/items/:uid/comments` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/items/:uid/criteria` |  | ✗ none | 5 |  |  |  |
| c | `GET /api/items/:uid/events` |  | ✗ none | 2 | ✓ 0.4c-2: rename recorded before/after (item-surface) |  |  |
| c | `GET /api/items/:uid/full` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/items/:uid/versions` |  | ✗ none | 1 | ✓ 0.4c-2: each edit a version (item-surface) |  |  |
| c | `GET /api/pantry/resolve` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/plan-docs/:docUid` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-docs/:docUid/versions` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-history/:planSlug` |  | ✗ none | 1 | ✓ 0.4c-1: the commit that touched the plan (plan-rest) |  |  |
| c | `GET /api/plan-history/:planSlug/at/:commitHash` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-history/:planSlug/diff` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-history/:planSlug/search` |  | ✗ none | 1 | ✓ 0.4c-1: finds by text; missing q 400 (plan-rest) |  |  |
| c | `GET /api/plan-templates` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans` |  | ✗ none | 43 |  |  |  |
| c | `GET /api/plans/:planUid/channels` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans/:planUid/items` |  | ✗ none | 18 |  |  |  |
| c | `GET /api/plans/:planUid/timeline` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid` |  | 1 | 12 |  |  |  |
| c | `GET /api/plans/:uid/budget` |  | ✗ none | 2 | ✓ 0.4g: report incl. flaggedChanges; unknown plan 404 (agent-ui-tools, budget-ceiling-validation) |  |  |
| c | `GET /api/plans/:uid/changes` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans/:uid/changes/:changeId` |  | ✗ none | 1 | ✓ 0.4c-1: one projected change; unknown 404 (plan-rest) |  |  |
| c | `GET /api/plans/:uid/check-runs` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/deviations` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans/:uid/docs` |  | ✗ none | 5 |  |  |  |
| c | `GET /api/plans/:uid/docs/by-type/:docType` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/docs/search` |  | ✗ none | 1 | ✓ 0.4c-1: finds by body with excerpt; no match is empty (plan-rest) |  |  |
| c | `GET /api/plans/:uid/external-sync` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/file-status` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/plans/:uid/next-task` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans/:uid/phases` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/plans/:uid/pr-draft` |  | ✗ none | 4 |  |  |  |
| c | `GET /api/plans/:uid/projection` |  | ✗ none | 1 | ✓ 0.4c-1: ghost and modified files from an Action (plan-rest) |  |  |
| c | `GET /api/plans/:uid/refs` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/review` |  | ✗ none | 5 |  |  |  |
| c | `GET /api/plans/:uid/versions` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/plans/discover` |  | ✗ none | 1 | ✓ 0.4c-1: exported plan directories (plan-rest) |  |  |
| c | `GET /api/plans/reconcile` |  | ✗ none | 1 | ✓ 0.4c-1: the orphan once its plan is archived (plan-rest) |  |  |
| c | `GET /api/plans/stitched` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/team-activity` |  | 1 | 3 |  |  |  |
| c | `POST /api/comments` |  | ✗ none | 1 | ✓ 0.4c-2: top-level and reply; missing body 400 (item-surface) |  |  |
| c | `POST /api/contributions/accept` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/contributions/promote` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/contributor-branch` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/items/:itemUid/refs` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/items/:uid/attachments` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/items/:uid/blocked` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/items/:uid/claim` |  | ✗ none | 1 | ✓ 0.4c-2: claims and records the assignee; full lifecycle (full-loop) |  |  |
| c | `POST /api/items/:uid/code-reference` |  | ✗ none | 1 | ✓ 0.4c-1: appends line ranges; shows in the overlay; refusals (code-reference, e2e add-to-plan; bug 21) |  |  |
| c | `POST /api/items/:uid/comments` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/items/:uid/criteria` |  | ✗ none | 5 |  |  |  |
| c | `POST /api/items/:uid/move` |  | ✗ none | 1 | ✓ 0.4c-2: re-parents and reorders; cycles, self, foreign and missing parents 400 (item-surface; bug 23) |  |  |
| c | `POST /api/items/:uid/progress` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/items/:uid/restore-version/:version` |  | ✗ none | 1 | ✓ 0.4c-2: old state back as a new version; unknown 404 (item-surface) |  |  |
| c | `POST /api/plans` |  | ✗ none | 43 |  |  |  |
| c | `POST /api/plans/:planUid/channels` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/plans/:planUid/items` |  | ✗ none | 18 |  |  |  |
| c | `POST /api/plans/:uid/apply-template` |  | ✗ none | 1 | ✓ 0.4c-1: seeds items; missing templateId 400 (plan-rest) |  |  |
| c | `POST /api/plans/:uid/check-runs` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:uid/docs` |  | ✗ none | 5 |  |  |  |
| c | `POST /api/plans/:uid/export` |  | ✗ none | 8 |  |  |  |
| c | `POST /api/plans/:uid/phases` |  | ✗ none | 3 |  |  |  |
| c | `POST /api/plans/:uid/publish-as-template` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:uid/reconcile` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:uid/unlink` |  | ✗ none | 3 |  |  |  |
| c | `POST /api/plans/bulk-delete` |  | ✗ none | 1 | ✓ 0.4c-1: exactly the named plans; empty list 400 (plan-rest) |  |  |
| c | `POST /api/plans/from-template` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/plans/import` |  | 1 | 2 |  |  |  |
| c | `POST /api/plans/import-external` |  | ✗ none | 1 | ✓ 0.4c-1: issue checklist becomes Actions; unknown source 400 (plan-rest) |  |  |
| c | `POST /api/plans/prune-orphans` |  | ✗ none | 1 | ✓ 0.4c-1: removes only the opened project's current orphans; everything else skipped (plan-rest) |  |  |
| c | `PUT /api/items/:uid` |  | ✗ none | 7 | ✓ 0.4c-2: parentUid validated like move (item-surface; bug 23) |  |  |
| c | `PUT /api/plan-docs/:docUid` |  | ✗ none | 1 |  |  |  |
| c | `PUT /api/plan-phases/:phaseUid` |  | ✗ none | 2 |  |  |  |
| c | `PUT /api/plans/:uid` |  | 1 | 12 |  |  |  |
| c | `PUT /api/plans/:uid/budget` |  | ✗ none | 2 | ✓ 0.4g: recorded with who and how (local-api / desktop), never flagged; invalid ceilings 400; unknown plan 404 (agent-ui-tools, budget-ceiling-validation) |  |  |
| c | `PUT /api/refs/:uid` |  | ✗ none | 1 |  |  |  |
| d | `DELETE /api/criteria/:uid` |  | ✗ none | 1 | ✓ 0.4d: removes the line; its decisions stay in the record (criteria-signoff) |  |  |
| d | `GET /api/criteria/:uid/signoffs` |  | ✗ none | 2 | ✓ 0.4d: append-only record, each tagged by how it arrived — local-api/unverified over HTTP (criteria-signoff, criteria-loops) |  |  |
| d | `GET /api/plans/:uid/signoff-pack` |  | ✗ none | 1 | ✓ 0.4d: every criterion, unverified approval tagged, file with hash at approval; unknown plan 404 (signoff-surface) |  |  |
| d | `GET /api/plans/:uid/signoff-pack.html` |  | ✗ none | 1 | ✓ 0.4d: attachment download, CSP sandbox, nosniff; unverified approvals listed apart (signoff-surface) |  |  |
| d | `GET /api/plans/:uid/worklist` |  | ✗ none | 1 | ✓ 0.4d: sent back first with note, then open; met/waiting counted; stale after source moves (signoff-surface) |  |  |
| d | `POST /api/criteria/:uid/check` |  | ✗ none | 1 | ✓ 0.4d: holds while cited cell exists, fails with the reason once it is gone; 404 (signoff-surface) |  |  |
| d | `POST /api/criteria/:uid/decide` |  | ✗ none | 4 | ✓ 0.4d: approve / send back (note required); HTTP records unverified, app window records human (criteria-signoff, ipc-dispatcher unit) |  |  |
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
| g | `GET /api/agent/status` |  | ✗ none | 1 | ✓ 0.4g: the session watcher's state, nothing more (misc-endpoints) |  |  |
| g | `GET /api/mcp/config` |  | ✗ none | 1 | ✓ 0.4g: a copied config carries the token and connects (misc-endpoints) |  |  |
| g | `GET /api/mcp/setup` |  | ✗ none | 2 | ✓ 0.4g: the agent prompt names the token file and never carries the token (misc-endpoints, mcp-connector) |  |  |
| g | `GET /api/mcp/status` |  | ✗ none | 1 | ✓ 0.4g: running on the agents' port with connected agents counted (sessions) |  |  |
| g | `GET /api/plans/:uid/budget/changes` |  | ✗ none | 1 | ✓ 0.4g: every change newest first, with channel and flag; no-op changes not recorded; unknown plan 404 (agent-ui-tools) |  |  |
| g | `GET /api/plans/:uid/budget/check` |  | ✗ none | 1 | ✓ 0.4g: agrees with check_budget; unknown plan 404 (agent-ui-tools); bug 27 |  |  |
| g | `GET /api/sensors/doc-check` |  | ✗ none | 1 | ✓ 0.4g: needs an opened project (400 / 403); nothing stale without docs (agent-ui-tools) — stale docs in 0.4l |  |  |
| g | `GET /api/sessions` |  | ✗ none | 4 | ✓ 0.4g: a connected agent appears with its type and plan (sessions, agent-ui-tools) |  |  |
| g | `POST /api/plans/:uid/budget/changes/:id/acknowledge` |  | ✗ none | 1 | ✓ 0.4g: unflags an agent's change and records who saw it; unknown change or wrong plan 404 (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `POST /api/sessions/:sessionId/assign-plan` |  | ✗ none | 3 | ✓ 0.4g: unknown plan or session 404, missing plan 400, nothing changed (agent-ui-tools); bug 27 |  |  |
| h | `GET /api/baseline` |  | ✗ none | 2 |  |  |  |
| h | `GET /api/comparands` |  | ✗ none | 4 |  |  |  |
| h | `GET /api/compare` |  | ✗ none | 5 |  |  |  |
| h | `GET /api/conflicts` |  | ✗ none | 4 |  |  |  |
| h | `GET /api/freeze` |  | ✗ none | 2 |  |  |  |
| h | `POST /api/baseline/capture` |  | ✗ none | 1 |  |  |  |
| h | `POST /api/conflicts/resolve` |  | ✗ none | 2 |  |  |  |
| h | `PUT /api/freeze` |  | ✗ none | 2 |  |  |  |
| i | `DELETE /api/terminals/:id` |  | ✗ none | 1 |  |  |  |
| i | `GET /api/audio/recent` |  | ✗ none | ✗ none |  |  |  |
| i | `GET /api/audio/status` |  | ✗ none | ✗ none |  |  |  |
| i | `GET /api/terminals` |  | 1 | 1 |  |  |  |
| i | `GET /api/terminals/:id/history` |  | ✗ none | 1 |  |  |  |
| i | `POST /api/audio/chunk` |  | ✗ none | ✗ none |  |  |  |
| i | `POST /api/audio/start` |  | ✗ none | ✗ none |  |  |  |
| i | `POST /api/audio/stop` |  | ✗ none | ✗ none |  |  |  |
| i | `POST /api/terminals` |  | 1 | 1 |  |  |  |
| i | `POST /api/terminals/:id/inject` |  | ✗ none | 1 |  |  |  |
| j | `DELETE /api/peers/devices/:fingerprint` |  | ✗ none | 1 |  |  |  |
| j | `DELETE /api/peers/push-tokens/:fingerprint` |  | ✗ none | 1 |  |  |  |
| j | `GET /api/pairing/status` |  | ✗ none | 2 |  |  |  |
| j | `GET /api/peers/audit` |  | ✗ none | 1 |  |  |  |
| j | `GET /api/peers/connections` |  | ✗ none | ✗ none |  |  |  |
| j | `GET /api/peers/devices` |  | ✗ none | 1 |  |  |  |
| j | `GET /api/peers/discovered` |  | ✗ none | ✗ none |  |  |  |
| j | `GET /api/peers/push-tokens` |  | ✗ none | 1 |  |  |  |
| j | `GET /api/peers/remote-audio` |  | ✗ none | ✗ none |  |  |  |
| j | `GET /api/peers/remote-input-requests` |  | ✗ none | ✗ none |  |  |  |
| j | `GET /api/peers/remote-state` |  | ✗ none | ✗ none |  |  |  |
| j | `GET /api/peers/remote-state/:fingerprint` |  | ✗ none | ✗ none |  |  |  |
| j | `GET /api/peers/remote-terminals` |  | ✗ none | ✗ none |  |  |  |
| j | `GET /api/peers/status` |  | ✗ none | 3 |  |  |  |
| j | `GET /api/sync/peek` |  | ✗ none | 2 |  |  |  |
| j | `GET /api/sync/status` |  | ✗ none | 1 |  |  |  |
| j | `PATCH /api/peers/devices/:fingerprint` |  | ✗ none | 1 |  |  |  |
| j | `POST /api/pairing/cancel` |  | ✗ none | 2 |  |  |  |
| j | `POST /api/pairing/confirm` |  | ✗ none | 2 |  |  |  |
| j | `POST /api/pairing/initiate` |  | ✗ none | 4 |  |  |  |
| j | `POST /api/peers/push-tokens` |  | ✗ none | 1 |  |  |  |
| j | `POST /api/peers/remote-input-requests/:requestId/respond` |  | ✗ none | ✗ none |  |  |  |
| j | `POST /api/peers/remote-terminals/:fingerprint/:terminalId/write` |  | ✗ none | ✗ none |  |  |  |
| j | `POST /api/sync/export` |  | ✗ none | 1 |  |  |  |
| j | `POST /api/sync/import` |  | ✗ none | 1 |  |  |  |
| k | `GET /api/logs/path` |  | ✗ none | 1 |  |  |  |
| k | `GET /api/logs/tail` |  | ✗ none | 1 |  |  |  |
| k | `GET /api/power/status` |  | ✗ none | ✗ none |  |  |  |
| k | `GET /api/settings` |  | ✗ none | 17 |  |  |  |
| k | `GET /api/settings/first-run-check` |  | ✗ none | 2 |  |  |  |
| k | `GET /api/updates/download/status` |  | ✗ none | 1 |  |  |  |
| k | `GET /api/updates/status` |  | ✗ none | 1 |  |  |  |
| k | `POST /api/updates/check` |  | ✗ none | ✗ none |  |  |  |
| k | `POST /api/updates/download` |  | ✗ none | 1 |  |  |  |
| k | `POST /api/updates/download/cancel` |  | ✗ none | 1 |  |  |  |
| k | `PUT /api/settings` |  | ✗ none | 17 |  |  |  |
| l | `DELETE /api/system-docs/:uid` |  | ✗ none | ✗ none |  |  |  |
| l | `GET /api/system-docs` |  | ✗ none | 2 |  |  |  |
| l | `GET /api/system-docs/:uid` |  | ✗ none | ✗ none |  |  |  |
| l | `GET /api/system-docs/:uid/freshness` |  | ✗ none | ✗ none |  |  |  |
| l | `POST /api/system-docs` |  | ✗ none | 2 |  |  |  |
| l | `POST /api/system-docs/:uid/verify` |  | ✗ none | ✗ none |  |  |  |
| l | `PUT /api/system-docs/:uid` |  | ✗ none | ✗ none |  |  |  |

## MCP tools (185)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `close_project` | session · project | ✗ none | 1 | ✓ 0.4a: broadcasts ui-close-project (project-lifecycle) |  |  |
| a | `get_project_config` | project-config · read | ✗ none | 2 | ✓ 0.4a: project override and effective merge with defaults (cdev-channels, cdev-sensors) |  |  |
| a | `get_repo_identity` | session · read | ✗ none | 1 | ✓ 0.4a: alias, branch, origin; unopened refused (project-lifecycle) |  |  |
| a | `list_recent_projects` | session · read | ✗ none | 2 | ✓ 0.4a: path, branch, pin marker (project-lifecycle) |  |  |
| a | `open_project` | ui · project | 1 | 1 | ✓ 0.4a: scans, records, broadcasts ui-open-project (project-lifecycle) |  |  |
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
| b | `graph_focus` | graph · write | 1 | 1 | ✓ 0.4b: broadcast incl. highlight flag (graph-tools) |  |  |
| b | `graph_select` | graph · write | ✗ none | 1 | ✓ 0.4b: selects file nodes by relative path on a real canvas (graph-tools, e2e mcp-view-tools) |  |  |
| b | `graph_set_depth` | graph · write | ✗ none | 1 | ✓ 0.4b: canvas depth follows (graph-tools, e2e mcp-view-tools) |  |  |
| b | `graph_set_layout` | graph · write | ✗ none | 1 | ✓ 0.4b: canvas layout follows (graph-tools, e2e mcp-view-tools) |  |  |
| b | `graph_set_mode` | graph · write | ✗ none | 1 | ✓ 0.4b: canvas mode follows, incl. baseline (graph-tools, e2e mcp-view-tools; bug 19) |  |  |
| b | `graph_set_scope` | graph · write | 1 | 1 | ✓ 0.4b: broadcast, set and clear (graph-tools) |  |  |
| b | `graph_snapshot` | graph · read | 1 | 1 | ✓ 0.4b: compact by default; metadata on request; real canvas (graph-tools, e2e mcp-view-tools; bug 18) |  |  |
| b | `graph_toggle_projection` | graph · write | ✗ none | 1 | ✓ 0.4b: broadcast (graph-tools) |  |  |
| b | `list_cross_system_edges` | architecture · read | ✗ none | 1 | ✓ 0.4b: stats and edges (graph-tools) |  |  |
| b | `search_symbols` | architecture · read | 1 | 1 | ✓ 0.4b: known function with its file (graph-tools) |  |  |
| b | `ui_ready` | graph · read | ✗ none | 1 | ✓ 0.4b: renderer answer passed through; no window = ready:false within 5 s; real window (graph-tools, e2e mcp-view-tools) |  |  |
| c | `accept_contributions` | contribution · write | ✗ none | 1 |  |  |  |
| c | `add_external_ref` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: GitHub issue URL recognised (item-surface) |  |  |
| c | `add_item` | plan-item · write | 3 | 14 |  |  |  |
| c | `add_item_attachment` | plan-item · write | ✗ none | 3 |  |  |  |
| c | `add_item_comment` | plan-item · write | ✗ none | 3 |  |  |  |
| c | `add_plan_scope` | plan · write | ✗ none | 3 |  |  |  |
| c | `bulk_add_items` | plan-item · write | 1 | ✗ none |  |  |  |
| c | `claim_item` | plan-item · write | 1 | 4 |  |  |  |
| c | `copy_plan_as_prompt` | plan · read | ✗ none | 1 | ✓ 0.4c-1: whole plan or one item; unknown plan is an error (plan-tools) |  |  |
| c | `create_plan` | plan · write | 1 | 16 |  |  |  |
| c | `create_plan_from_template` | plan · write | ✗ none | 1 | ✓ 0.4c-1: items copied, statuses reset; unknown template errors (plan-tools) |  |  |
| c | `delete_item` | plan-item · write | ✗ none | 1 |  |  |  |
| c | `delete_item_attachment` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `delete_item_comment` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `discover_plan_files` | plan · files | ✗ none | 1 | ✓ 0.4c-1: the exported directory (plan-tools) |  |  |
| c | `export_plan_to_files` | plan · files | ✗ none | 3 |  |  |  |
| c | `get_item` | plan-item · read | 1 | 4 |  |  |  |
| c | `get_next_item` | plan-item · read | ✗ none | 2 |  |  |  |
| c | `get_plan` | plan · read | 2 | 2 |  |  |  |
| c | `get_plan_summary` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: counts by kind, byStatus, completion (item-surface) |  |  |
| c | `get_plan_timeline` | plan-item · read | ✗ none | 1 |  |  |  |
| c | `import_external` | plan · write | 1 | ✗ none |  |  |  |
| c | `import_plan_from_files` | plan · files | 1 | 1 |  |  |  |
| c | `list_contributions` | contribution · read | 1 | 1 |  |  |  |
| c | `list_external_refs` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `list_item_comments` | plan-item · read | ✗ none | 1 |  |  |  |
| c | `list_item_versions` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: newest first, incl. the restore (item-surface) |  |  |
| c | `list_items` | plan-item · read | ✗ none | 3 |  |  |  |
| c | `list_plan_pointers` | plan · read | ✗ none | 1 |  |  |  |
| c | `list_plan_templates` | plan · read | ✗ none | 1 | ✓ 0.4c-1: built-ins; project templates with project_root (plan-tools) |  |  |
| c | `list_plans` | plan · read | 2 | 2 |  |  |  |
| c | `list_plans_by_repo` | plan · read | ✗ none | 1 |  |  |  |
| c | `move_item` | plan-item · write | ✗ none | 3 | ✓ 0.4c-2: refuses cycles and foreign/missing parents (item-surface; bug 23) |  |  |
| c | `prepare_contributor_branch` | contribution · write | ✗ none | 1 |  |  |  |
| c | `promote_to_contribution` | contribution · write | ✗ none | 1 |  |  |  |
| c | `publish_plan_as_template` | plan · write | ✗ none | 1 | ✓ 0.4c-1: writes template.yaml; appears in the list (plan-tools) |  |  |
| c | `read_item_full` | plan-item · read | ✗ none | 2 |  |  |  |
| c | `remove_external_ref` | plan-item · write | ✗ none | 1 | ✓ 0.4c-2: (item-surface) |  |  |
| c | `remove_plan_scope` | plan · write | ✗ none | 1 |  |  |  |
| c | `request_plan_deletion` | plan · write | ✗ none | 1 | ✓ 0.4c-3: asks the window, deletes nothing; refuses unknown, archived and unopened-project plans; typed confirmation in the app (plan-tools, e2e plan-deletion-request) |  |  |
| c | `resolve_pantry_references` | contribution · read | ✗ none | 1 |  |  |  |
| c | `resolve_reference` | plan-item · read | ✗ none | 1 |  |  |  |
| c | `restore_item_version` | plan-item · write | ✗ none | 1 |  |  |  |
| c | `search_items` | plan-item · read | 1 | ✗ none |  |  |  |
| c | `set_item_blocked` | plan-item · write | ✗ none | 1 |  |  |  |
| c | `set_plan_home_repo` | plan · write | ✗ none | 1 | ✓ 0.4c-1: normalised; empty clears (plan-tools) |  |  |
| c | `suggest_specs` | plan-item · read | ✗ none | 1 | ✓ 0.4c-2: file specs under a scope (item-surface) |  |  |
| c | `unlink_plan_from_files` | plan · write | ✗ none | 1 | ✓ 0.4c-1: removes the directory, even after a rename; plan survives (plan-tools; bug 22) |  |  |
| c | `update_item` | plan-item · write | 1 | 9 |  |  |  |
| c | `update_item_progress` | plan-item · write | ✗ none | 2 |  |  |  |
| c | `update_plan` | plan · write | ✗ none | 1 | ✓ 0.4c-1: title/status/description, version recorded; write-through continues after a rename (plan-tools; bug 22) |  |  |
| d | `add_criterion` | plan-item · write | ✗ none | 1 | ✓ 0.4d: kept at propose, tagged with the agent's name in the app (criteria-signoff, criteria.spec) |  |  |
| d | `approve_gate` | plan-item · read | ✗ none | 1 | ✓ 0.4d: retired — refuses and points at submit_criterion (criteria-signoff) |  |  |
| d | `check_criterion` | plan-item · read | ✗ none | 1 | ✓ 0.4d: refuses a cell outside the file, passes once fixed (criteria-loops) |  |  |
| d | `get_worklist` | plan-item · read | ✗ none | 1 | ✓ 0.4d: hands back the send-back note and where it points (criteria-loops) |  |  |
| d | `list_criteria` | plan-item · read | 1 | 2 | ✓ 0.4d: migrated line verbatim plus the gate, with decided_by (criteria-signoff) |  |  |
| d | `run_checks` | plan-item · read | ✗ none | 1 | ✓ 0.4d: names the stale criterion and the changed file; approves nothing (criteria-loops) |  |  |
| d | `submit_criterion` | plan-item · write | 1 | 4 | ✓ 0.4d: submitting is not approving; agent policy self-approves in the agent's name (criteria-signoff) |  |  |
| e | `get_brief` | plan-item · read | 2 | 1 | ✓ 0.4e: item, guide from pages, own files + pages' materials only, still_needs; unknown refused (brief-surface) |  |  |
| e | `list_materials` | plan-item · read | 1 | 1 | ✓ 0.4e: every file item by item in tree order, outputs included; unknown refused (brief-surface) |  |  |
| e | `read_material` | plan-item · files | 2 | 1 | ✓ 0.4e: CSV by {range} (bug 24), text by {lines}, image as itself; read logged on the item (brief-surface, read unit) |  |  |
| e | `record_artefact` | plan-item · write | 1 | 4 | ✓ 0.4e: agent records an output (brief-surface, criteria-loops) |  |  |
| f | `await_ack` | presence · write | ✗ none | 1 | ✓ 0.4f: released by ack; instant when already acked; unknown card an error at once; dismissed → via dismissed (presence-channels; bug 25) |  |  |
| f | `await_user_input` | presence · write | ✗ none | 1 | ✓ 0.4f: gets the reply; a newer question supersedes an older wait at once (presence-channels; bug 25) |  |  |
| f | `dismiss_channel_event` | channel · write | ✗ none | 1 | ✓ 0.4f: dismissed, broadcast, gone from the open list; unknown an error (presence-channels) |  |  |
| f | `dismiss_presence` | presence · write | ✗ none | 1 | ✓ 0.4f: clears every card and releases waiters (presence-channels; bug 25) |  |  |
| f | `get_channel_thread` | channel · read | ✗ none | 2 | ✓ 0.4f: same order as REST (presence-channels, cdev-channels) |  |  |
| f | `list_channel_events` | channel · read | ✗ none | 4 | ✓ 0.4f: status filter excludes dismissed; pulled events appear (presence-channels; bug 26) |  |  |
| f | `post_channel_event` | channel · write | 1 | 6 | ✓ 0.4f: threads with responds_to, exported to the plan folder (presence-channels, cdev-channels) |  |  |
| f | `present` | presence · write | ✗ none | 2 | ✓ 0.4f: card posted, broadcast, attributed to the agent (presence-channels) |  |  |
| f | `resolve_channel_event` | channel · write | ✗ none | 2 | ✓ 0.4f: resolved in DB and YAML (cdev-channels) |  |  |
| g | `check_budget` | budget · read | ✗ none | 1 | ✓ 0.4g: none → ok → exempt states, reason in words; unknown plan refused (agent-ui-tools); bug 27 |  |  |
| g | `clipboard_read` | ui · capture | 1 | 1 | ✓ 0.4g: refused without capture; the window's answer returned (agent-ui-tools) |  |  |
| g | `clipboard_write` | ui · write | ✗ none | 1 | ✓ 0.4g: sends the text to the window (agent-ui-tools) |  |  |
| g | `get_app_guide` | ui · read | ✗ none | 1 | ✓ 0.4g: every flavour distinct; summary names this project's plans; unknown flavour refused (agent-ui-tools) |  |  |
| g | `get_budget` | budget · read | ✗ none | 1 | ✓ 0.4g: ceiling, spent, forecast, notes; unknown plan refused (agent-ui-tools) |  |  |
| g | `get_log_path` | ui · read | ✗ none | 1 | ✓ 0.4g: today's file in the data dir; naming it creates nothing (agent-ui-tools), logger-path unit; bug 28 |  |  |
| g | `get_logs` | ui · read | ✗ none | 1 | ✓ 0.4g: says when there is no log file; tail and filter of the desktop log (agent-ui-tools); bug 28 |  |  |
| g | `get_settings` | ui · read | ✗ none | 1 | ✓ 0.4g: reads back what update_settings wrote; no secrets in settings (cdev-phase5) |  |  |
| g | `navigate_item_back` | session · write | ✗ none | 1 | ✓ 0.4g: selection steps back (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `navigate_item_forward` | session · write | ✗ none | 1 | ✓ 0.4g: and forward (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `navigate_to` | session · write | ✗ none | 1 | ✓ 0.4g: every target's payload; unknown plan/item/file refused (agent-ui-tools); bug 27 |  |  |
| g | `open_history_drawer` | session · write | ✗ none | 1 | ✓ 0.4g: drawer opens on the item; unknown item refused (agent-ui-tools, mcp-ui-tools.spec); bug 27 |  |  |
| g | `open_mcp_guide` | session · write | ✗ none | 1 | ✓ 0.4g: guide dialog opens (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `open_plan` | session · write | ✗ none | 1 | ✓ 0.4g: plan opens; unknown plan refused with no toast (agent-ui-tools, mcp-ui-tools.spec); bug 27 |  |  |
| g | `open_settings` | session · write | ✗ none | 1 | ✓ 0.4g: settings dialog opens (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `refresh_ui` | session · write | ✗ none | 1 | ✓ 0.4g: sends ui-refresh (agent-ui-tools) |  |  |
| g | `register_session` | session · read | 1 | 5 | ✓ 0.4g: the agent appears in /api/sessions under its type (sessions; every harness agent registers) |  |  |
| g | `screenshot` | ui · capture | 1 | 1 | ✓ 0.4g: refused without capture; image from the window's answer; empty answer an error (agent-ui-tools) |  |  |
| g | `select_item` | ui · write | ✗ none | 1 | ✓ 0.4g: item selected; unknown item or wrong plan refused (agent-ui-tools, mcp-ui-tools.spec); bug 27 |  |  |
| g | `set_active_plan` | session · write | ✗ none | 1 | ✓ 0.4g: shown and recorded as the agent's plan; unknown refused, unchanged (agent-ui-tools); bug 27 |  |  |
| g | `set_baseline` | session · write | ✗ none | 1 | ✓ 0.4g: sets and clears (agent-ui-tools) |  |  |
| g | `set_budget` | budget · write | ✗ none | 1 | ✓ 0.4g: set, exempt, clear one dimension; recorded in the agent's name and flagged until seen; nothing stored for an unknown plan (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `setup_agent_permissions` | session · settings | 1 | 1 | ✓ 0.4g: refused without settings; merges the wildcard; inside an opened project only, never through a link (agent-ui-tools) |  |  |
| g | `toggle_activity_drawer` | session · write | ✗ none | 1 | ✓ 0.4g: drawer toggles both ways (agent-ui-tools, mcp-ui-tools.spec) |  |  |
| g | `toggle_panel` | session · write | ✗ none | 1 | ✓ 0.4g: sends the panel (agent-ui-tools) |  |  |
| g | `update_settings` | ui · settings | ✗ none | 1 | ✓ 0.4g: persists first-run and data fields (cdev-phase5) |  |  |
| h | `capture_checkpoint` | drift · write | ✗ none | ✗ none |  |  |  |
| h | `check_freeze` | governance · read | ✗ none | 1 |  |  |  |
| h | `commit_manifest_changes` | git · write | ✗ none | 4 |  |  |  |
| h | `compare_snapshots` | review · read | ✗ none | 1 |  |  |  |
| h | `detect_conflicts` | git · read | ✗ none | 1 |  |  |  |
| h | `detect_deviations` | drift · read | ✗ none | 2 |  |  |  |
| h | `diff_plan_between_commits` | git · read | ✗ none | 1 |  |  |  |
| h | `exempt_plan_from_freeze` | governance · write | ✗ none | 1 |  |  |  |
| h | `get_change_status` | drift · read | ✗ none | ✗ none |  |  |  |
| h | `get_changes_summary` | drift · read | ✗ none | ✗ none |  |  |  |
| h | `get_deviations` | drift · read | ✗ none | ✗ none |  |  |  |
| h | `get_drift_report` | drift · read | ✗ none | 1 |  |  |  |
| h | `get_freeze_status` | governance · read | ✗ none | 1 |  |  |  |
| h | `get_plan_at_commit` | git · read | ✗ none | 1 |  |  |  |
| h | `get_plan_history` | git · read | ✗ none | 1 |  |  |  |
| h | `get_pr_draft` | review · read | 1 | ✗ none |  |  |  |
| h | `get_team_activity` | git · read | ✗ none | 1 |  |  |  |
| h | `list_comparands` | review · read | ✗ none | ✗ none |  |  |  |
| h | `list_proposed_changes` | drift · read | ✗ none | ✗ none |  |  |  |
| h | `reconcile` | drift · write | ✗ none | ✗ none |  |  |  |
| h | `resolve_conflict` | git · write | ✗ none | ✗ none |  |  |  |
| h | `review_plan` | review · read | 2 | 1 |  |  |  |
| h | `search_plan_history` | git · read | ✗ none | ✗ none |  |  |  |
| h | `set_freeze` | governance · write | ✗ none | 1 |  |  |  |
| i | `get_audio_context` | audio · capture | ✗ none | 1 |  |  |  |
| i | `get_audio_status` | audio · capture | ✗ none | 1 |  |  |  |
| i | `push_audio_chunk` | audio · capture | ✗ none | 1 |  |  |  |
| i | `start_audio_capture` | audio · capture | 1 | 1 |  |  |  |
| i | `stop_audio_capture` | audio · capture | ✗ none | 1 |  |  |  |
| i | `terminal_create` | terminal · terminal | 1 | 1 |  |  |  |
| i | `terminal_focus` | terminal · terminal | ✗ none | 1 |  |  |  |
| i | `terminal_kill` | terminal · terminal | 1 | 1 |  |  |  |
| i | `terminal_list` | terminal · terminal | 1 | 1 |  |  |  |
| i | `terminal_read` | terminal · terminal | ✗ none | 1 |  |  |  |
| i | `terminal_resize` | terminal · terminal | ✗ none | 1 |  |  |  |
| i | `terminal_write` | terminal · terminal | 1 | 1 |  |  |  |
| j | `get_peer_status` | peer · read | ✗ none | 3 |  |  |  |
| j | `get_remote_audio` | peer · capture | ✗ none | 1 |  |  |  |
| j | `get_remote_state` | peer · read | ✗ none | 1 |  |  |  |
| j | `list_discovered_peers` | peer · read | ✗ none | 1 |  |  |  |
| j | `list_paired_devices` | peer · read | ✗ none | 1 |  |  |  |
| j | `list_peer_connections` | peer · read | ✗ none | 1 |  |  |  |
| j | `list_remote_input_requests` | peer · read | ✗ none | 1 |  |  |  |
| j | `list_remote_terminals` | peer · terminal | ✗ none | 1 |  |  |  |
| j | `mobile_navigate` | mobile · write | ✗ none | ✗ none |  |  |  |
| j | `mobile_present` | mobile · write | ✗ none | ✗ none |  |  |  |
| j | `mobile_screenshot` | mobile · capture | ✗ none | ✗ none |  |  |  |
| j | `respond_remote_input` | peer · write | ✗ none | 1 |  |  |  |
| j | `unpair_device` | peer · settings | ✗ none | 1 |  |  |  |
| j | `write_remote_terminal` | peer · terminal | 1 | ✗ none |  |  |  |
| l | `check_doc_freshness` | system-docs · read | ✗ none | 1 |  |  |  |
| l | `create_plan_from_external` | intake · write | 3 | 3 |  |  |  |
| l | `delete_system_doc` | system-docs · write | ✗ none | 1 |  |  |  |
| l | `get_external_sync_state` | intake · read | ✗ none | 2 |  |  |  |
| l | `list_plan_external_refs` | intake · read | ✗ none | 1 |  |  |  |
| l | `list_system_docs` | system-docs · read | ✗ none | 2 |  |  |  |
| l | `mark_external_synced` | intake · write | ✗ none | 2 |  |  |  |
| l | `read_system_doc` | system-docs · read | ✗ none | ✗ none |  |  |  |
| l | `set_plan_external_ref` | intake · write | 1 | ✗ none |  |  |  |
| l | `verify_system_doc` | system-docs · write | ✗ none | 2 |  |  |  |
| l | `write_system_doc` | system-docs · write | ✗ none | 2 |  |  |  |

## Mobile RPC methods (72)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `diagnostics.flush` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `fs.browse` | files | 2 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.active` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.alias` | project | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.close` | project | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.list` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.open` | project | 2 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.pin` | project | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.remove` | project | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| a | `project.rescan` | project | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `changes.summary` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `graph.directory` | read | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `graph.file` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `graph.fileSearch` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `graph.fileSource` | files | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `graph.overview` | read | 1 | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `graph.scene` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| b | `graph.search` | read | ✗ none | ✗ none |  |  | Deferred to 0.4j: no harness peer path to the RPC surface yet |
| c | `comment.add` | write | ✗ none | ✗ none |  |  |  |
| c | `item.ref.add` | write | ✗ none | ✗ none |  |  |  |
| c | `item.ref.remove` | write | ✗ none | ✗ none |  |  |  |
| c | `plan.copyAsPrompt` | read | ✗ none | ✗ none |  |  |  |
| c | `plan.create` | write | 1 | ✗ none |  |  |  |
| c | `plan.delete` | write | ✗ none | ✗ none |  |  |  |
| c | `plan.document` | read | ✗ none | ✗ none |  |  |  |
| c | `plan.file.discover` | write | ✗ none | ✗ none |  |  |  |
| c | `plan.file.export` | write | 1 | ✗ none |  |  |  |
| c | `plan.file.import` | write | 1 | ✗ none |  |  |  |
| c | `plan.get` | read | ✗ none | ✗ none |  |  |  |
| c | `plan.item.create` | write | ✗ none | ✗ none |  |  |  |
| c | `plan.item.get` | read | ✗ none | ✗ none |  |  |  |
| c | `plan.item.update` | write | ✗ none | ✗ none |  |  |  |
| c | `plan.items` | read | ✗ none | ✗ none |  |  |  |
| c | `plan.list` | read | 1 | ✗ none |  |  |  |
| c | `plan.nextItem` | read | ✗ none | ✗ none |  |  |  |
| c | `plan.template.create` | write | 1 | ✗ none |  |  |  |
| c | `plan.template.list` | read | ✗ none | ✗ none |  |  |  |
| c | `plan.update` | write | ✗ none | ✗ none |  |  |  |
| d | `criteria.awaiting` | read | 1 | ✗ none |  |  |  |
| d | `criteria.list` | read | ✗ none | ✗ none |  |  |  |
| d | `criterion.decide` | write | 1 | ✗ none |  |  |  |
| e | `artefact.preview` | files | 1 | ✗ none |  |  |  |
| f | `channel.events` | read | ✗ none | ✗ none |  |  |  |
| f | `channel.eventsSinceSeq` | read | ✗ none | ✗ none |  |  |  |
| f | `channel.get` | read | ✗ none | ✗ none |  |  |  |
| f | `channel.post` | write | ✗ none | ✗ none |  |  |  |
| f | `channel.resolve` | write | ✗ none | ✗ none |  |  |  |
| f | `channel.thread` | read | ✗ none | ✗ none |  |  |  |
| f | `input.respond` | write | ✗ none | ✗ none |  |  |  |
| h | `deviation.list` | read | ✗ none | ✗ none |  |  |  |
| h | `deviation.resolve` | write | ✗ none | ✗ none |  |  |  |
| h | `review.comparands` | read | ✗ none | ✗ none |  |  |  |
| h | `review.compare` | read | ✗ none | ✗ none |  |  |  |
| h | `review.get` | read | ✗ none | ✗ none |  |  |  |
| h | `review.prDraft` | read | ✗ none | ✗ none |  |  |  |
| i | `terminal.create` | terminal | 2 | ✗ none |  |  |  |
| i | `terminal.history` | terminal | ✗ none | ✗ none |  |  |  |
| i | `terminal.kill` | terminal | ✗ none | ✗ none |  |  |  |
| i | `terminal.list` | terminal | 2 | ✗ none |  |  |  |
| i | `terminal.read` | terminal | 1 | ✗ none |  |  |  |
| i | `terminal.resize` | terminal | ✗ none | ✗ none |  |  |  |
| i | `terminal.stream` | terminal | ✗ none | ✗ none |  |  |  |
| i | `terminal.write` | terminal | 2 | ✗ none |  |  |  |
| k | `power.status` | read | ✗ none | ✗ none |  |  |  |
| k | `settings.get` | read | 1 | ✗ none |  |  |  |
| k | `settings.update` | settings | 1 | ✗ none |  |  |  |
| l | `sysdoc.create` | write | 1 | ✗ none |  |  |  |
| l | `sysdoc.delete` | write | ✗ none | ✗ none |  |  |  |
| l | `sysdoc.list` | read | ✗ none | ✗ none |  |  |  |
| l | `sysdoc.read` | read | ✗ none | ✗ none |  |  |  |
| l | `sysdoc.update` | write | ✗ none | ✗ none |  |  |  |
| l | `sysdoc.verify` | write | ✗ none | ✗ none |  |  |  |

## Frontend components (99)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| b | `graph/edges/ImportEdge.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/DirectoryNode.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/FileNode.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/PackageNode.tsx` |  | n/a | n/a |  |  |  |
| b | `graph/nodes/SymbolNode.tsx` |  | n/a | n/a |  |  |  |
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
| c | `plan/PlanDeletionRequest.tsx` |  | n/a | n/a |  |  |  |
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
| c | `plan/v2/FreezeBar.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/HandoffButton.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ItemRoutingPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/ManifestConflictBar.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/MentionPicker.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/NextUpStrip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PantryPlaceholder.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanActivityDrawer.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanBudgetChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanCheckRunPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanCompletionSummary.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanDiffPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanGitContextChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanHistoryRail.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanImportModal.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanItemCanvas.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanItemHistoryDrawer.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanItemTree.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanQualityNudge.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanReadinessRing.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanReviewPanel.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanShareMenu.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanSwitcher.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanSyncChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanTemplateChooser.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanTicketSyncChip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanVersionHistory.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/PlanWorkspaceShellV2.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/SlashMenu.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/TargetsStrip.tsx` |  | n/a | n/a |  |  |  |
| c | `plan/v2/TeamActivityPanel.tsx` |  | n/a | n/a |  |  |  |
| e | `artefact/ArtefactViewer.tsx` |  | n/a | n/a |  |  |  |
| e | `brief/BriefWorkspace.tsx` |  | n/a | n/a |  |  |  |
| e | `brief/SignoffPackControls.tsx` |  | n/a | n/a |  |  |  |
| f | `presence/PresencePane.tsx` |  | n/a | n/a |  |  |  |
| g | `ActiveAgentProjects.tsx` |  | n/a | n/a |  |  |  |
| g | `ErrorBoundary.tsx` |  | n/a | n/a |  |  |  |
| g | `FirstRunWizard.tsx` |  | n/a | n/a |  |  |  |
| g | `FolderPickerModal.tsx` |  | n/a | n/a |  |  |  |
| g | `GettingStarted.tsx` |  | n/a | n/a |  |  |  |
| g | `guide/GuideModal.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/AgentPanel.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/AgentPulse.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/AgentTurns.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/CodeWorkspace.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/ConnectedAgents.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/CoverageChip.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/InspectorPanel.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/MainCanvas.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/PlanPanel.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/Sidebar.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/StatusBar.tsx` |  | n/a | n/a |  |  |  |
| g | `layout/TopBar.tsx` |  | n/a | n/a |  |  |  |
| g | `Toast.tsx` |  | n/a | n/a |  |  |  |
| g | `WelcomeScreen.tsx` |  | n/a | n/a |  |  |  |
| i | `audio/AudioCaptureBar.tsx` |  | n/a | n/a |  |  |  |
| i | `terminal/TerminalInstance.tsx` |  | n/a | n/a |  |  |  |
| i | `terminal/TerminalPanel.tsx` |  | n/a | n/a |  |  |  |
| j | `pairing/DeviceIndicator.tsx` |  | n/a | n/a |  |  |  |
| j | `pairing/RemotePeersPanel.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/AddToClaudeDesktop.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/SettingsModal.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/VerifiedUpdateDownload.tsx` |  | n/a | n/a |  |  |  |
| k | `settings/WebcamQrScanner.tsx` |  | n/a | n/a |  |  |  |
| l | `system-docs/SystemDocsPanel.tsx` |  | n/a | n/a |  |  |  |

## Mobile screens (31)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| j | `_layout.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/_layout.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/activity.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/graph.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/index.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/plans.tsx` |  | n/a | n/a |  |  |  |
| j | `(tabs)/terminals.tsx` |  | n/a | n/a |  |  |  |
| j | `approval.tsx` |  | n/a | n/a |  |  |  |
| j | `approvals.tsx` |  | n/a | n/a |  |  |  |
| j | `body-editor.tsx` |  | n/a | n/a |  |  |  |
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
| j | `system-doc-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `system-docs.tsx` |  | n/a | n/a |  |  |  |
| j | `terminal-detail.tsx` |  | n/a | n/a |  |  |  |
| j | `workspace.tsx` |  | n/a | n/a |  |  |  |

## Settings sections (12)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| k | `about` |  | n/a | n/a |  |  |  |
| k | `appearance` |  | n/a | n/a |  |  |  |
| k | `data` |  | n/a | n/a |  |  |  |
| k | `devices` |  | n/a | n/a |  |  |  |
| k | `identity` |  | n/a | n/a |  |  |  |
| k | `logs` |  | n/a | n/a |  |  |  |
| k | `mcp` |  | n/a | n/a |  |  |  |
| k | `plans` |  | n/a | n/a |  |  |  |
| k | `power` |  | n/a | n/a |  |  |  |
| k | `sync` |  | n/a | n/a |  |  |  |
| k | `telemetry` |  | n/a | n/a |  |  |  |
| k | `updates` |  | n/a | n/a |  |  |  |
