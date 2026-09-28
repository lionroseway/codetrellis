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
- Two packaged formats do not run from where they live. The **AppImage**
  remounts at a new `/tmp/.mount_*` every launch, so its command is the
  `.AppImage` file itself (`$APPIMAGE`), loading the script via `-e` from
  whichever mount is running. The **Windows portable** `.exe` cannot be the
  command (its NSIS launcher hands the app no stdin/stdout), so it names the
  unpacked binary in `%TEMP%\<build id>` — the same for every launch of one
  build, gone while the app is closed — and carries a `caveat` the copy
  surfaces show. `.github/workflows/connector-packaged.yml` runs both
  commands against the built artifacts (`scripts/smoke-connector-packaged.ts`).
- When the app restarts, the connector re-sends the client's original
  `initialize` and tells the client its tool list changed. When the app is
  not running, it still completes the handshake and answers every call with
  one sentence saying to open the app.
- It is a client, not an authority: capability checks, project scope and
  the Timeline are all still the server's. The client's `clientInfo`
  passes through untouched, and the server names the session from it
  (`client-identity.ts`), because through the connector the SSE user-agent
  is always the connector's.
- It says where the agent works (Phase 32 A1.1): on connect it sends its
  own working directory (`x-codetrellis-cwd`, percent-encoded) and, inside
  a CodeTrellis terminal, `CODETRELLIS_HOST_TERMINAL` (`x-codetrellis-host-terminal`)
  — `mcp/binding-headers.ts`. The server binds the session to the trusted
  root or worktree that folder falls in (`services/workstream-binding.ts`),
  asks a client with MCP roots for them when no folder came, and records the
  terminal only if it exists. The folder chooses a root; it is never read
  from. Sessions carry `workstreamRoot` and `hostTerminalId` in `/api/sessions`.
- It has a second mode, `--hook pre-tool-use` (Phase 32 A3.4,
  `connector/hook.ts`): a Claude Code `PreToolUse` hook that calls
  `check_footprint` for the file about to be edited and answers with
  `additionalContext`, never a decision. It fails open and silent, always
  exits 0, and asks as its own short session named `claude-code-hook`.
  Settings installs it, with the `codetrellis-parallel` skill, only on a
  click (`services/claude-code-parallel.ts`); see `docs/claude/awareness.md`.
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
| `plan-item-tools.ts` | Plan items | CRUD on items; comments, attachments, claim, blocked, progress, dependencies, versions, restore, move; acceptance criteria (`list_criteria`, `add_criterion`, `submit_criterion` — an agent offers evidence, a person decides; `approve_gate` is retired and refuses); the Phase 31 loops (`check_criterion` runs a criterion's mechanical checks, and `submit_criterion` refuses evidence that fails one; `get_worklist` is what the agent owes, sent-back notes first; `run_checks` records a check run and says what moved — it never approves). `get_brief`, `claim_item` and `get_next_item` carry the task's skills and a one-line `skills_note` (Phase 32 C1); items reach tools through an agent view of the item service that drops a skill's `link` location, which is for people only. `assign_workstream` gives a section the branch it is worked on (Phase 32 C5.1): inherited below it, it keeps `get_next_item` and `claim_item` to agents in that worktree, of any client, and `get_brief` says where a task is worked. |
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
| `awareness-tools.ts` | Awareness (Phase 32) | `list_workstreams`: every worktree of the repo, and recent branches with no checkout here (A1.7a), with the agents in it and the files it has changed since it branched (A1.4), with the symbols each touches (A1.5), `yours` for the caller's own, `shared` for two or more agents in one folder. `get_awareness` (A1.6): a `digest` paragraph (A3.1: a line per pair of workstreams, what changed, who is affected, agents told, what the person is asked; built by `src/shared/lib/awareness-digest.ts`, the same words as the Awareness tab), then the open signals affecting the caller's workstream — `collision` (same file medium, same symbol high), `contract` (A2.3: an exported signature changed or an export removed, and the other side's changed files import it; high, medium for a namespace import only), `drift` (A2.5: changed files outside the workstream's claimed items' `fileSpecs`/`scope_path` and declared intent; medium) and `stale-base` (low). `check_footprint(paths)`: who else changed these files, which symbols, and what imports them. `declare_intent(summary, paths?, symbols?, clear?)` (A2.4, capability `write`): what the caller is about to change, held per session until it re-declares, clears or disconnects; it joins the workstream's footprint, so a collision shows before any edit (marked "declared"). Other agents see the claimed paths and symbols, never the summary. `acknowledge_signal(id, note?)` (A2.6, `write`): the agent's note on a signal, per session, shown to the person beside their answer and never setting it. The whole pipeline is described in `docs/claude/awareness.md`. **Inline notices** (A2.6): an unseen high or medium signal for the caller's workstream is appended once to its next tool result as a "── CodeTrellis awareness ──" block, from the one interception in `mcp/server.ts`; off with `sensors.awareness.inlineNotices: false`. |
| `terminal-tools.ts` | Terminals | Create, write, read, resize, focus, kill, list local terminals; remote terminals proxied to mobile. |
| `audio-tools.ts` | Audio | Start/stop capture, push audio chunks, get audio status, get audio context, get remote audio. |
| `peer-tools.ts` | Peers | List paired devices, list peer connections, list discovered peers, unpair, refresh peers. |
| `presence-tools.ts` | Presence | Broadcast presence, dismiss presence, get peer status, list remote terminals. |
| `mobile-tools.ts` | Mobile steering | `mobile_navigate`, `mobile_screenshot`, `mobile_present` — drive the companion app from desktop. |
| `ui-tools.ts` | UI | Navigate items (back/forward, `navigate_to`), open panels/drawers/settings, take screenshots, refresh UI, history drawer. |

## Authoring conventions

- Each tool file exports a registration function called by the MCP server during startup.
- Tools are pure functions that operate on service-layer methods — keep MCP layer thin, push logic into `services/`.
- Every successful call broadcasts on `tool_call`; failures broadcast on `tool_error`. The frontend `PlanPanel` Timeline tab renders both. That includes a call the SDK refuses before any handler runs (an unknown tool, or arguments its schema rejects): `mcp/server.ts` wraps the SDK's `tools/call` handler through the public `setRequestHandler`, and an error result that never reached the interception is broadcast too (Phase 32 B1.2). Every broadcast is also kept in the agent event log (`services/agent-event-log.ts`, B1.1), along with spec and item body edits (`spec_edited`, B1.2).
- Tools that mutate persistent state (plans, items, system docs) go through the same services as UI mutations — never let MCP and UI take divergent code paths.
