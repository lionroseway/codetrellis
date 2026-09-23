# MCP Tool Surface

CodeTrellis exposes its capabilities to AI agents through a local MCP server (SSE on `:19432`). Any MCP-speaking client — Claude Code, Codex, Cursor, aider, Claude Desktop, custom — can connect; each call is attributed to its originating agent and broadcast on the `tool_call` / `tool_error` channel for the timeline.

## How agents connect: the stdio connector

The server needs this launch's capability token, and the token is minted
fresh on **every** launch. So a config that carries the token — a URL plus
an `x-codetrellis-token` header — stops working the next time CodeTrellis
starts, and the agent is refused with 401 until someone re-copies it.

Agents therefore connect through the **connector** (`src/backend/mcp/connector/`):
a stdio MCP server the agent launches, which reads `<dataDir>/capability-token`
and `<dataDir>/mcp-endpoint.json` (the port actually bound) on every connect
and proxies to the SSE server.

- The config names a command, not a URL and a secret. Nothing in it is
  sensitive, and it survives restarts and a port that walked forward.
- Packaged, it runs on the app's own binary with `ELECTRON_RUN_AS_NODE=1`
  from `<resources>/connector/mcp-connector.cjs` — no Node install, no
  window. `resolveConnectorCommand` (`connector/command.ts`) works out the
  command for packaged, Electron-from-source and web-dev runs.
- When the app restarts, the connector re-sends the client's original
  `initialize` and tells the client its tool list changed. When the app is
  not running, it still completes the handshake and answers every call with
  one sentence saying to open the app.
- It is a client, not an authority: capability checks, project scope and
  the Timeline are all still the server's. The client's `clientInfo`
  passes through untouched, and the server names the session from it
  (`client-identity.ts`), because through the connector the SSE user-agent
  is always the connector's.
- Built by `npm run build:connector` (its own Vite config, one
  self-contained file). Every `package:*` script and `predev` run it.

`getMcpSetup` (`/api/mcp/setup`) returns the connector's command, JSON and
`claude mcp add` line; Settings, the guide and the status bar all copy the
connector's config first. The direct, token-carrying config is still
offered for clients that can only take a URL, labelled for what it is.

Tools are organised into 18 files under `src/backend/mcp/tools/`. Each file groups a domain.

## Tool categories

| File | Domain | Purpose |
|---|---|---|
| `plan-tools.ts` | Plans | CRUD on plans; history, timelines, summaries, diffs at commits, templates, export/import, pointers, scope. |
| `plan-item-tools.ts` | Plan items | CRUD on items; comments, attachments, claim, blocked, progress, dependencies, versions, restore, move; acceptance criteria (`list_criteria`, `add_criterion`, `submit_criterion` — an agent offers evidence, a person decides; `approve_gate` is retired and refuses). |
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
