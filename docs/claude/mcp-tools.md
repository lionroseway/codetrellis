# MCP Tool Surface

CodeTrellis exposes its capabilities to AI agents through a local MCP server (SSE on `:19432`). Any MCP-speaking client — Claude Code, Codex, Cursor, aider, Claude Desktop, custom — can connect; each call is attributed to its originating agent and broadcast on the `tool_call` / `tool_error` channel for the timeline.

Tools are organised into 18 files under `src/backend/mcp/tools/`. Each file groups a domain.

## Tool categories

| File | Domain | Purpose |
|---|---|---|
| `plan-tools.ts` | Plans | CRUD on plans; history, timelines, summaries, diffs at commits, templates, export/import, pointers, scope. |
| `plan-item-tools.ts` | Plan items | CRUD on items; comments, attachments, claim, blocked, progress, dependencies, versions, restore, move. |
| `channel-tools.ts` | Channel events | Post, list, resolve, thread, dismiss; per-plan/per-item discussion threads. |
| `system-docs-tools.ts` | System docs | Author and version markdown system docs; freshness checks. |
| `contribution-tools.ts` | Contributions | List proposed changes, accept contributions, promote to contribution, prepare contributor branch. |
| `governance-tools.ts` | Governance | Set/check freeze, baseline management, exempt plans from freeze. |
| `drift-tools.ts` | Drift | Detect deviations from baseline, get drift report, detect conflicts, resolve conflicts. |
| `architecture-tools.ts` | Architecture | Check architecture conformity, list cross-system edges, search symbols, get dependencies. |
| `graph-tools.ts` | Graph | Control the renderer: focus, set depth, set layout, set scope, set mode, toggle projection, snapshot, export. |
| `git-tools.ts` | Git | Activity, commit metadata, change status, changes summary. |
| `project-config-tools.ts` | Project & config | Open/close project, recent projects, project config, settings, repo identity, refresh origin, repo alias. |
| `session-tools.ts` | Sessions | Register agent sessions; attribution for tool calls. |
| `terminal-tools.ts` | Terminals | Create, write, read, resize, focus, kill, list local terminals; remote terminals proxied to mobile. |
| `audio-tools.ts` | Audio | Start/stop capture, push audio chunks, get audio status, get audio context, get remote audio. |
| `peer-tools.ts` | Peers | List paired devices, list peer connections, list discovered peers, unpair, refresh peers. |
| `presence-tools.ts` | Presence | Broadcast presence, dismiss presence, get peer status, list remote terminals. |
| `mobile-tools.ts` | Mobile steering | `mobile_navigate`, `mobile_screenshot`, `mobile_present` — drive the companion app from desktop. |
| `ui-tools.ts` | UI | Navigate items (back/forward, `navigate_to`), open panels/drawers/settings, take screenshots, refresh UI, history drawer. |

## Authoring conventions

- Each tool file exports a registration function called by the MCP server during startup.
- Tools are pure functions that operate on service-layer methods — keep MCP layer thin, push logic into `services/`.
- Every successful call broadcasts on `tool_call`; failures broadcast on `tool_error`. The frontend `PlanPanel` Timeline tab renders both.
- Tools that mutate persistent state (plans, items, system docs) go through the same services as UI mutations — never let MCP and UI take divergent code paths.
