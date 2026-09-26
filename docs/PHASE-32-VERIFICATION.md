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
| REST routes | 226 | 212 | 71 | 71 | 0 | 0 |
| MCP tools | 186 | 148 | 82 | 66 | 0 | 0 |
| Mobile RPC methods | 72 | 47 | 72 | 47 | 0 | 0 |
| Frontend components | 98 | n/a | n/a | n/a | 0 | 0 |
| Mobile screens | 31 | n/a | n/a | n/a | 0 | 0 |
| Settings sections | 12 | n/a | n/a | n/a | 0 | 0 |

## By domain

| Domain | REST | MCP | RPC | Components | Mobile | Settings |
|---|---|---|---|---|---|---|
| 0.4a Project and scan | 19 | 12 | 10 | 0 | 0 | 0 |
| 0.4b Graph | 17 | 15 | 8 | 10 | 0 | 0 |
| 0.4c Plans and items | 108 | 52 | 20 | 54 | 0 | 0 |
| 0.4d Criteria and sign-off | 5 | 7 | 3 | 0 | 0 | 0 |
| 0.4e Brief and viewer | 3 | 4 | 1 | 3 | 0 | 0 |
| 0.4f Channels and presence | 6 | 9 | 7 | 1 | 0 | 0 |
| 0.4g Agents and MCP | 7 | 26 | 0 | 20 | 0 | 0 |
| 0.4h Drift, governance, review | 8 | 24 | 6 | 0 | 0 | 0 |
| 0.4i Terminals and audio | 10 | 12 | 8 | 3 | 0 | 0 |
| 0.4j Mobile surface | 25 | 14 | 0 | 2 | 31 | 0 |
| 0.4k Settings, updates, privacy | 11 | 0 | 3 | 4 | 0 | 12 |
| 0.4l System docs and intake | 7 | 11 | 6 | 1 | 0 | 0 |

## MCP tools: registry vs capability matrix

- Registered by the server: **186**
- Rows in `TOOL_CAPABILITIES`: **186**
- Rows for tools the server does not register: none
- Registered tools with no row (refused at call time): none

## REST routes (226)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `DELETE /api/recent-projects` |  | 1 | 4 |  |  |  |
| a | `GET /api/auto-detect` |  | ✗ none | 1 |  |  |  |
| a | `GET /api/build-info` |  | ✗ none | 1 |  |  |  |
| a | `GET /api/fs/browse` |  | ✗ none | 2 |  |  |  |
| a | `GET /api/git/branch` |  | ✗ none | 2 |  |  |  |
| a | `GET /api/git/branch-tip` |  | ✗ none | 2 |  |  |  |
| a | `GET /api/git/commits` |  | ✗ none | 1 |  |  |  |
| a | `GET /api/git/head` |  | ✗ none | 2 |  |  |  |
| a | `GET /api/git/info` |  | 1 | 3 |  |  |  |
| a | `GET /api/git/status` |  | ✗ none | 1 |  |  |  |
| a | `GET /api/git/worktrees` |  | ✗ none | 1 |  |  |  |
| a | `GET /api/health` |  | 1 | 3 |  |  |  |
| a | `GET /api/identity/git-defaults` |  | ✗ none | 1 |  |  |  |
| a | `GET /api/onboarding-state` |  | ✗ none | 2 |  |  |  |
| a | `GET /api/project-config` |  | ✗ none | 1 |  |  |  |
| a | `GET /api/recent-projects` |  | 1 | 4 |  |  |  |
| a | `GET /api/stats` |  | ✗ none | 1 |  |  |  |
| a | `POST /api/project/scan` |  | 2 | 65 |  |  |  |
| a | `POST /api/recent-projects/pin` |  | 1 | 1 |  |  |  |
| b | `GET /api/architecture-summary` |  | ✗ none | 1 |  |  |  |
| b | `GET /api/coverage` |  | ✗ none | 1 |  |  |  |
| b | `GET /api/cross-system` |  | ✗ none | 6 |  |  |  |
| b | `GET /api/dependencies` |  | ✗ none | 3 |  |  |  |
| b | `GET /api/dependencies/file` |  | ✗ none | ✗ none |  |  |  |
| b | `GET /api/diff` |  | ✗ none | 1 |  |  |  |
| b | `GET /api/file/at` |  | ✗ none | 2 |  |  |  |
| b | `GET /api/file/content` |  | ✗ none | 2 |  |  |  |
| b | `GET /api/file/overlay` |  | ✗ none | 1 |  |  |  |
| b | `GET /api/playback` |  | ✗ none | 2 |  |  |  |
| b | `GET /api/symbols/file` |  | ✗ none | 5 |  |  |  |
| b | `GET /api/symbols/search` |  | ✗ none | 2 |  |  |  |
| b | `GET /api/systems` |  | ✗ none | 2 |  |  |  |
| b | `GET /api/trellis/:id` |  | ✗ none | 3 |  |  |  |
| b | `GET /api/trellis/:id/diff` |  | ✗ none | 2 |  |  |  |
| b | `GET /api/trellis/snapshots` |  | ✗ none | 1 |  |  |  |
| b | `POST /api/trellis/capture` |  | ✗ none | 3 |  |  |  |
| c | `DELETE /api/attachments/:uid` |  | ✗ none | ✗ none |  |  |  |
| c | `DELETE /api/comments/:uid` |  | ✗ none | ✗ none |  |  |  |
| c | `DELETE /api/items/:uid` |  | ✗ none | 5 |  |  |  |
| c | `DELETE /api/plan-docs/:docUid` |  | ✗ none | 1 |  |  |  |
| c | `DELETE /api/plan-phases/:phaseUid` |  | ✗ none | 2 |  |  |  |
| c | `DELETE /api/plans/:uid` |  | 1 | 10 |  |  |  |
| c | `DELETE /api/refs/:uid` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/attachments/:uid/file` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/comments` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/contributions` |  | 1 | 3 |  |  |  |
| c | `GET /api/items/:itemUid/refs` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/items/:uid` |  | ✗ none | 5 |  |  |  |
| c | `GET /api/items/:uid/artefacts` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/items/:uid/attachments` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/items/:uid/comments` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/items/:uid/criteria` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/items/:uid/events` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/items/:uid/full` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/items/:uid/versions` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/pantry/resolve` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/plan-docs/:docUid` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-docs/:docUid/versions` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-history/:planSlug` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plan-history/:planSlug/at/:commitHash` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-history/:planSlug/diff` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plan-history/:planSlug/search` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plan-templates` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans` |  | ✗ none | 35 |  |  |  |
| c | `GET /api/plans/:planUid/channels` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:planUid/items` |  | ✗ none | 10 |  |  |  |
| c | `GET /api/plans/:planUid/timeline` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid` |  | 1 | 10 |  |  |  |
| c | `GET /api/plans/:uid/budget` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/budget/check` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/:uid/changes` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/changes/:changeId` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/:uid/check-runs` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/deviations` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans/:uid/docs` |  | ✗ none | 4 |  |  |  |
| c | `GET /api/plans/:uid/docs/by-type/:docType` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/docs/search` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/:uid/external-sync` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/file-status` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/plans/:uid/next-task` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans/:uid/phases` |  | ✗ none | 3 |  |  |  |
| c | `GET /api/plans/:uid/pr-draft` |  | ✗ none | 4 |  |  |  |
| c | `GET /api/plans/:uid/projection` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/:uid/refs` |  | ✗ none | 1 |  |  |  |
| c | `GET /api/plans/:uid/review` |  | ✗ none | 5 |  |  |  |
| c | `GET /api/plans/:uid/signoff-pack` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/:uid/signoff-pack.html` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/:uid/tasks` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/:uid/versions` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/plans/:uid/worklist` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/discover` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/reconcile` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/plans/stitched` |  | ✗ none | 2 |  |  |  |
| c | `GET /api/tasks/:taskUid/attachments` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/tasks/:taskUid/comments` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/tasks/:taskUid/full` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/tasks/:taskUid/subtasks` |  | ✗ none | ✗ none |  |  |  |
| c | `GET /api/team-activity` |  | 1 | 3 |  |  |  |
| c | `POST /api/comments` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/contributions/accept` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/contributions/promote` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/contributor-branch` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/items/:itemUid/refs` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/items/:uid/artefacts` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/items/:uid/attachments` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/items/:uid/blocked` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/items/:uid/claim` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/items/:uid/comments` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/items/:uid/criteria` |  | ✗ none | 3 |  |  |  |
| c | `POST /api/items/:uid/move` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/items/:uid/progress` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/items/:uid/restore-version/:version` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/plans` |  | ✗ none | 35 |  |  |  |
| c | `POST /api/plans/:planUid/channels` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:planUid/items` |  | ✗ none | 10 |  |  |  |
| c | `POST /api/plans/:uid/apply-template` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/plans/:uid/check-runs` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:uid/docs` |  | ✗ none | 4 |  |  |  |
| c | `POST /api/plans/:uid/export` |  | ✗ none | 7 |  |  |  |
| c | `POST /api/plans/:uid/phases` |  | ✗ none | 3 |  |  |  |
| c | `POST /api/plans/:uid/publish-as-template` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:uid/reconcile` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:uid/signoff-pack/verify` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/plans/:uid/tasks` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/plans/:uid/tasks/:taskUid/claim` |  | ✗ none | 1 |  |  |  |
| c | `POST /api/plans/:uid/tasks/:taskUid/code-reference` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/plans/:uid/unlink` |  | ✗ none | 3 |  |  |  |
| c | `POST /api/plans/bulk-delete` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/plans/from-template` |  | ✗ none | 2 |  |  |  |
| c | `POST /api/plans/import` |  | 1 | 2 |  |  |  |
| c | `POST /api/plans/import-external` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/plans/prune-orphans` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/tasks/:taskUid/attachments` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/tasks/:taskUid/blocked` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/tasks/:taskUid/comments` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/tasks/:taskUid/progress` |  | ✗ none | ✗ none |  |  |  |
| c | `POST /api/tasks/:taskUid/subtasks` |  | ✗ none | ✗ none |  |  |  |
| c | `PUT /api/items/:uid` |  | ✗ none | 5 |  |  |  |
| c | `PUT /api/plan-docs/:docUid` |  | ✗ none | 1 |  |  |  |
| c | `PUT /api/plan-phases/:phaseUid` |  | ✗ none | 2 |  |  |  |
| c | `PUT /api/plans/:uid` |  | 1 | 10 |  |  |  |
| c | `PUT /api/plans/:uid/budget` |  | ✗ none | 1 |  |  |  |
| c | `PUT /api/plans/:uid/tasks/:taskUid` |  | ✗ none | 1 |  |  |  |
| c | `PUT /api/refs/:uid` |  | ✗ none | 1 |  |  |  |
| d | `DELETE /api/criteria/:uid` |  | ✗ none | 1 |  |  |  |
| d | `GET /api/criteria/:uid/signoffs` |  | ✗ none | 2 |  |  |  |
| d | `POST /api/criteria/:uid/check` |  | ✗ none | ✗ none |  |  |  |
| d | `POST /api/criteria/:uid/decide` |  | ✗ none | 3 |  |  |  |
| d | `PUT /api/criteria/:uid` |  | ✗ none | 1 |  |  |  |
| e | `GET /api/artefacts/:uid` |  | ✗ none | ✗ none |  |  |  |
| e | `GET /api/artefacts/:uid/content` |  | ✗ none | ✗ none |  |  |  |
| e | `GET /api/artefacts/:uid/rendition` |  | ✗ none | ✗ none |  |  |  |
| f | `GET /api/channels/:eventUid/thread` |  | ✗ none | ✗ none |  |  |  |
| f | `GET /api/presence/cards` |  | ✗ none | 1 |  |  |  |
| f | `POST /api/channels/:eventUid/status` |  | ✗ none | ✗ none |  |  |  |
| f | `POST /api/presence/ack` |  | ✗ none | ✗ none |  |  |  |
| f | `POST /api/presence/reply` |  | ✗ none | ✗ none |  |  |  |
| f | `POST /api/screenshot-response` |  | ✗ none | ✗ none |  |  |  |
| g | `GET /api/agent/status` |  | ✗ none | 1 |  |  |  |
| g | `GET /api/mcp/config` |  | ✗ none | 1 |  |  |  |
| g | `GET /api/mcp/setup` |  | ✗ none | 2 |  |  |  |
| g | `GET /api/mcp/status` |  | ✗ none | 1 |  |  |  |
| g | `GET /api/sensors/doc-check` |  | ✗ none | ✗ none |  |  |  |
| g | `GET /api/sessions` |  | ✗ none | 3 |  |  |  |
| g | `POST /api/sessions/:sessionId/assign-plan` |  | ✗ none | 2 |  |  |  |
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
| k | `GET /api/settings` |  | ✗ none | 15 |  |  |  |
| k | `GET /api/settings/first-run-check` |  | ✗ none | 2 |  |  |  |
| k | `GET /api/updates/download/status` |  | ✗ none | 1 |  |  |  |
| k | `GET /api/updates/status` |  | ✗ none | 1 |  |  |  |
| k | `POST /api/updates/check` |  | ✗ none | ✗ none |  |  |  |
| k | `POST /api/updates/download` |  | ✗ none | 1 |  |  |  |
| k | `POST /api/updates/download/cancel` |  | ✗ none | 1 |  |  |  |
| k | `PUT /api/settings` |  | ✗ none | 15 |  |  |  |
| l | `DELETE /api/system-docs/:uid` |  | ✗ none | ✗ none |  |  |  |
| l | `GET /api/system-docs` |  | ✗ none | 2 |  |  |  |
| l | `GET /api/system-docs/:uid` |  | ✗ none | ✗ none |  |  |  |
| l | `GET /api/system-docs/:uid/freshness` |  | ✗ none | ✗ none |  |  |  |
| l | `POST /api/system-docs` |  | ✗ none | 2 |  |  |  |
| l | `POST /api/system-docs/:uid/verify` |  | ✗ none | ✗ none |  |  |  |
| l | `PUT /api/system-docs/:uid` |  | ✗ none | ✗ none |  |  |  |

## MCP tools (186)

| Domain | Item | Detail | Unit | Harness | Behaviour | UX | Notes |
|---|---|---|---|---|---|---|---|
| a | `close_project` | session · project | ✗ none | 1 |  |  |  |
| a | `get_project_config` | project-config · read | ✗ none | 2 |  |  |  |
| a | `get_repo_identity` | session · read | ✗ none | 1 |  |  |  |
| a | `list_recent_projects` | session · read | ✗ none | 2 |  |  |  |
| a | `open_project` | ui · project | 1 | 1 |  |  |  |
| a | `pin_project` | session · project | ✗ none | 1 |  |  |  |
| a | `refresh_repo_origin` | session · project | ✗ none | 1 |  |  |  |
| a | `remove_recent_project` | session · project | ✗ none | 1 |  |  |  |
| a | `rescan_project` | session · project | ✗ none | 1 |  |  |  |
| a | `set_repo_alias` | session · project | ✗ none | 1 |  |  |  |
| a | `unpin_project` | session · project | ✗ none | 1 |  |  |  |
| a | `update_project_config` | project-config · write | ✗ none | 4 |  |  |  |
| b | `check_architecture` | architecture · read | ✗ none | ✗ none |  |  |  |
| b | `check_conformity` | architecture · read | ✗ none | ✗ none |  |  |  |
| b | `get_dependencies` | architecture · read | ✗ none | ✗ none |  |  |  |
| b | `graph_export` | graph · read | ✗ none | ✗ none |  |  |  |
| b | `graph_focus` | graph · write | 1 | ✗ none |  |  |  |
| b | `graph_select` | graph · write | ✗ none | ✗ none |  |  |  |
| b | `graph_set_depth` | graph · write | ✗ none | ✗ none |  |  |  |
| b | `graph_set_layout` | graph · write | ✗ none | ✗ none |  |  |  |
| b | `graph_set_mode` | graph · write | ✗ none | ✗ none |  |  |  |
| b | `graph_set_scope` | graph · write | 1 | ✗ none |  |  |  |
| b | `graph_snapshot` | graph · read | 1 | ✗ none |  |  |  |
| b | `graph_toggle_projection` | graph · write | ✗ none | ✗ none |  |  |  |
| b | `list_cross_system_edges` | architecture · read | ✗ none | ✗ none |  |  |  |
| b | `search_symbols` | architecture · read | 1 | ✗ none |  |  |  |
| b | `ui_ready` | graph · read | ✗ none | ✗ none |  |  |  |
| c | `accept_contributions` | contribution · write | ✗ none | 1 |  |  |  |
| c | `add_external_ref` | plan-item · write | ✗ none | ✗ none |  |  |  |
| c | `add_item` | plan-item · write | 3 | 13 |  |  |  |
| c | `add_item_attachment` | plan-item · write | ✗ none | 2 |  |  |  |
| c | `add_item_comment` | plan-item · write | ✗ none | 2 |  |  |  |
| c | `add_plan_scope` | plan · write | ✗ none | 3 |  |  |  |
| c | `bulk_add_items` | plan-item · write | 1 | ✗ none |  |  |  |
| c | `bulk_delete_plans` | plan · write | ✗ none | ✗ none |  |  |  |
| c | `claim_item` | plan-item · write | 1 | 4 |  |  |  |
| c | `copy_plan_as_prompt` | plan · read | ✗ none | ✗ none |  |  |  |
| c | `create_plan` | plan · write | 1 | 14 |  |  |  |
| c | `create_plan_from_template` | plan · write | ✗ none | ✗ none |  |  |  |
| c | `delete_item` | plan-item · write | ✗ none | 1 |  |  |  |
| c | `delete_item_attachment` | plan-item · write | ✗ none | ✗ none |  |  |  |
| c | `delete_item_comment` | plan-item · write | ✗ none | ✗ none |  |  |  |
| c | `delete_plan` | plan · write | ✗ none | ✗ none |  |  |  |
| c | `discover_plan_files` | plan · files | ✗ none | ✗ none |  |  |  |
| c | `export_plan_to_files` | plan · files | ✗ none | 3 |  |  |  |
| c | `get_item` | plan-item · read | 1 | 4 |  |  |  |
| c | `get_next_item` | plan-item · read | ✗ none | 2 |  |  |  |
| c | `get_plan` | plan · read | 2 | 1 |  |  |  |
| c | `get_plan_summary` | plan-item · read | ✗ none | ✗ none |  |  |  |
| c | `get_plan_timeline` | plan-item · read | ✗ none | 1 |  |  |  |
| c | `import_external` | plan · write | 1 | ✗ none |  |  |  |
| c | `import_plan_from_files` | plan · files | 1 | 1 |  |  |  |
| c | `list_contributions` | contribution · read | 1 | 1 |  |  |  |
| c | `list_external_refs` | plan-item · read | ✗ none | ✗ none |  |  |  |
| c | `list_item_comments` | plan-item · read | ✗ none | 1 |  |  |  |
| c | `list_item_versions` | plan-item · read | ✗ none | ✗ none |  |  |  |
| c | `list_items` | plan-item · read | ✗ none | 3 |  |  |  |
| c | `list_plan_pointers` | plan · read | ✗ none | 1 |  |  |  |
| c | `list_plan_templates` | plan · read | ✗ none | ✗ none |  |  |  |
| c | `list_plans` | plan · read | 2 | 1 |  |  |  |
| c | `list_plans_by_repo` | plan · read | ✗ none | 1 |  |  |  |
| c | `move_item` | plan-item · write | ✗ none | 2 |  |  |  |
| c | `prepare_contributor_branch` | contribution · write | ✗ none | 1 |  |  |  |
| c | `promote_to_contribution` | contribution · write | ✗ none | 1 |  |  |  |
| c | `publish_plan_as_template` | plan · write | ✗ none | ✗ none |  |  |  |
| c | `read_item_full` | plan-item · read | ✗ none | 2 |  |  |  |
| c | `remove_external_ref` | plan-item · write | ✗ none | ✗ none |  |  |  |
| c | `remove_plan_scope` | plan · write | ✗ none | 1 |  |  |  |
| c | `resolve_pantry_references` | contribution · read | ✗ none | 1 |  |  |  |
| c | `resolve_reference` | plan-item · read | ✗ none | 1 |  |  |  |
| c | `restore_item_version` | plan-item · write | ✗ none | 1 |  |  |  |
| c | `search_items` | plan-item · read | 1 | ✗ none |  |  |  |
| c | `set_item_blocked` | plan-item · write | ✗ none | 1 |  |  |  |
| c | `set_plan_home_repo` | plan · write | ✗ none | ✗ none |  |  |  |
| c | `suggest_specs` | plan-item · read | ✗ none | ✗ none |  |  |  |
| c | `unlink_plan_from_files` | plan · write | ✗ none | ✗ none |  |  |  |
| c | `update_item` | plan-item · write | 1 | 9 |  |  |  |
| c | `update_item_progress` | plan-item · write | ✗ none | 2 |  |  |  |
| c | `update_plan` | plan · write | ✗ none | ✗ none |  |  |  |
| d | `add_criterion` | plan-item · write | ✗ none | 1 |  |  |  |
| d | `approve_gate` | plan-item · read | ✗ none | 1 |  |  |  |
| d | `check_criterion` | plan-item · read | ✗ none | 1 |  |  |  |
| d | `get_worklist` | plan-item · read | ✗ none | 1 |  |  |  |
| d | `list_criteria` | plan-item · read | 1 | 2 |  |  |  |
| d | `run_checks` | plan-item · read | ✗ none | 1 |  |  |  |
| d | `submit_criterion` | plan-item · write | 1 | 3 |  |  |  |
| e | `get_brief` | plan-item · read | 2 | ✗ none |  |  |  |
| e | `list_materials` | plan-item · read | 1 | ✗ none |  |  |  |
| e | `read_material` | plan-item · files | 2 | ✗ none |  |  |  |
| e | `record_artefact` | plan-item · write | 1 | 2 |  |  |  |
| f | `await_ack` | presence · write | ✗ none | ✗ none |  |  |  |
| f | `await_user_input` | presence · write | ✗ none | ✗ none |  |  |  |
| f | `dismiss_channel_event` | channel · write | ✗ none | ✗ none |  |  |  |
| f | `dismiss_presence` | presence · write | ✗ none | ✗ none |  |  |  |
| f | `get_channel_thread` | channel · read | ✗ none | 1 |  |  |  |
| f | `list_channel_events` | channel · read | ✗ none | 3 |  |  |  |
| f | `post_channel_event` | channel · write | 1 | 4 |  |  |  |
| f | `present` | presence · write | ✗ none | 1 |  |  |  |
| f | `resolve_channel_event` | channel · write | ✗ none | 2 |  |  |  |
| g | `check_budget` | budget · read | ✗ none | ✗ none |  |  |  |
| g | `clipboard_read` | ui · capture | 1 | ✗ none |  |  |  |
| g | `clipboard_write` | ui · write | ✗ none | ✗ none |  |  |  |
| g | `get_app_guide` | ui · read | ✗ none | ✗ none |  |  |  |
| g | `get_budget` | budget · read | ✗ none | ✗ none |  |  |  |
| g | `get_log_path` | ui · read | ✗ none | ✗ none |  |  |  |
| g | `get_logs` | ui · read | ✗ none | ✗ none |  |  |  |
| g | `get_settings` | ui · read | ✗ none | 1 |  |  |  |
| g | `navigate_item_back` | session · write | ✗ none | ✗ none |  |  |  |
| g | `navigate_item_forward` | session · write | ✗ none | ✗ none |  |  |  |
| g | `navigate_to` | session · write | ✗ none | ✗ none |  |  |  |
| g | `open_history_drawer` | session · write | ✗ none | ✗ none |  |  |  |
| g | `open_mcp_guide` | session · write | ✗ none | ✗ none |  |  |  |
| g | `open_plan` | session · write | ✗ none | ✗ none |  |  |  |
| g | `open_settings` | session · write | ✗ none | ✗ none |  |  |  |
| g | `refresh_ui` | session · write | ✗ none | ✗ none |  |  |  |
| g | `register_session` | session · read | 1 | 5 |  |  |  |
| g | `screenshot` | ui · capture | 1 | ✗ none |  |  |  |
| g | `select_item` | ui · write | ✗ none | ✗ none |  |  |  |
| g | `set_active_plan` | session · write | ✗ none | ✗ none |  |  |  |
| g | `set_baseline` | session · write | ✗ none | ✗ none |  |  |  |
| g | `set_budget` | budget · write | ✗ none | ✗ none |  |  |  |
| g | `setup_agent_permissions` | session · settings | 1 | ✗ none |  |  |  |
| g | `toggle_activity_drawer` | session · write | ✗ none | ✗ none |  |  |  |
| g | `toggle_panel` | session · write | ✗ none | ✗ none |  |  |  |
| g | `update_settings` | ui · settings | ✗ none | 1 |  |  |  |
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
| a | `diagnostics.flush` | read | ✗ none | ✗ none |  |  |  |
| a | `fs.browse` | files | 2 | ✗ none |  |  |  |
| a | `project.active` | read | ✗ none | ✗ none |  |  |  |
| a | `project.alias` | project | 1 | ✗ none |  |  |  |
| a | `project.close` | project | 1 | ✗ none |  |  |  |
| a | `project.list` | read | ✗ none | ✗ none |  |  |  |
| a | `project.open` | project | 2 | ✗ none |  |  |  |
| a | `project.pin` | project | 1 | ✗ none |  |  |  |
| a | `project.remove` | project | 1 | ✗ none |  |  |  |
| a | `project.rescan` | project | 1 | ✗ none |  |  |  |
| b | `changes.summary` | read | ✗ none | ✗ none |  |  |  |
| b | `graph.directory` | read | 1 | ✗ none |  |  |  |
| b | `graph.file` | read | ✗ none | ✗ none |  |  |  |
| b | `graph.fileSearch` | read | ✗ none | ✗ none |  |  |  |
| b | `graph.fileSource` | files | 1 | ✗ none |  |  |  |
| b | `graph.overview` | read | 1 | ✗ none |  |  |  |
| b | `graph.scene` | read | ✗ none | ✗ none |  |  |  |
| b | `graph.search` | read | ✗ none | ✗ none |  |  |  |
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

## Frontend components (98)

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
