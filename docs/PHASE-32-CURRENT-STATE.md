# Phase 32 — Current state

> What the code does today for each piece Phase 32 needs, checked
> against `main` at `1433770` (2026-09-25). File references are
> `path:line` at that commit.
> The design is in [PHASE-32-PARALLEL-AWARENESS.md](PHASE-32-PARALLEL-AWARENESS.md);
> the journeys are in [PHASE-32-JOURNEYS.md](PHASE-32-JOURNEYS.md).

Each section ends with **what it means for Phase 32**.

---

## Summary

| Area | State | Impact on the plan |
|---|---|---|
| Graph storage | **One project at a time.** Switching projects clears and rescans | Workstreams *must* be in-memory deltas over the opened project, not extra projects |
| Parsing another folder or branch | ✓ `parseVirtualFile` parses a string without touching the DB | The footprint engine has what it needs |
| Function signatures | ✗ Not extracted. Symbols have name, kind, lines, modifiers only | Needed for `contract`; parser work in each language |
| Who uses a function | ◐ No call graph, but imports record the names they import | A usable first version is one query; accuracy needs parser fixes |
| Architecture rules | ✗ None. `check_conformity` only catches a direct two-file cycle | `rule` signals need rules designed from scratch; moved later |
| Session → folder | ✗ Nothing records an agent's working directory | New column plus three ways to learn it |
| Claude Code sessions | ◐ One session, exact-folder match only | Must become many sessions across folders |
| File watching | ◐ One watcher, for the opened project | Needs one lightweight watcher per workstream folder |
| Claim overlap | ◐ Same plan, declared files, exact paths, advisory | Superseded by footprints; has an attribution bug (§6) |
| Sensors | ✓ Config, debounce and channel posting all in place | New signals follow the same pattern |
| Result notices | ✓ One interception point can append to any tool result | Inline notices are cheap |
| Capabilities | ✓ Deny-by-default matrix with a coverage test | Every new tool needs a row: `read` or `write` |

---

## 1. Graph storage: one project at a time

- `scanProject` refuses a second concurrent scan because "the AST tables
  hold one project at a time" (`src/backend/server.ts:982-988`).
  Switching projects clears AST data and rescans (`server.ts:1081-1087`).
- The active project is `lastScannedProject` (`server.ts:960-965`).
- Frontend tabs (`src/frontend/stores/project-store.ts:26-40`) are UI
  state; switching tabs doesn't rescan.

**For Phase 32:** this settles a design question. Sibling worktrees,
clones and branches **cannot** be loaded as projects alongside the
opened one. The plan's approach, with the opened project as the base
graph and each workstream as a small in-memory delta, is required, not
just cheaper.

## 2. Parsing: what a symbol knows

**What's stored.**
- `ParsedSymbol` is `{ name, kind, startLine, endLine, children, modifiers }`
  (`src/shared/types/ast.ts:31-38`).
- The `symbols` table mirrors it (`src/backend/services/db-schema.ts:31-41`).
- A file-level md5 is kept (`ast-parser.ts:307`); there's no per-symbol hash.

**What's missing.**
- No parameters and no return type.
- "Exported" exists only as `'export'` in `modifiers`, and only for
  TS/JS.
- Python has no notion of exported at all.
- `parsed.exports` is computed but never stored (`database.ts:353-408`).

**Where a signature would come from.**
- Each plugin's `nodeToSymbol` still has the tree-sitter node.
- TypeScript: `childForFieldName('parameters')` / `('return_type')` in
  the function cases (`parsers/typescript.ts:25-28`), class members
  (`:82`), and arrow-function values (`:53`, currently dropped).
- Python: the same fields (`parsers/python.ts:31-42`).

**Parsing outside the project.**
- `parseVirtualFile(filePath, content)` (`ast-parser.ts:394-396`) parses
  a string and writes nothing. It is already used to parse
  `git show <commit>:<path>` (`server.ts:5128-5134`).
- It needs `initParser()` to have run, and returns null over 2 MiB.
- Imports come back unresolved; `getResolverForLanguage(lang).resolve`
  resolves them against a supplied file set (`resolvers/index.ts:40`).

**For Phase 32:**
- The footprint engine can parse any worktree file or branch file
  today.
- `contract` needs an optional `signature` field on `ParsedSymbol`,
  filled by each language plugin. Start with TS/JS and Python, and
  define "exported" for Python (no leading `_`, or listed in `__all__`).
- Without a signature, a language falls back to a line-span hash, which
  sees every edit as a change. That would break the "body edits are
  silent" rule, so **languages without signature support produce no
  `contract` signals** rather than noisy ones.

## 3. Who uses what

**No symbol-level call graph.** There's no `call_expression` handling
anywhere. The only non-import couplings are HTTP/SQL/subprocess/env
callsites (`ast.ts:70-85`).

**Imports record the imported names.**
- The `imports` table has `specifiers` (JSON), `is_default` and
  `is_namespace` (`db-schema.ts:43-51`).
- `resolved_path` is filled by `resolveImports` (`database.ts:599-705`).

**Gaps that affect accuracy.**
- **Python stores the alias, not the original name.**
  `from x import a as b` records `b` (`parsers/python.ts:138`), whereas
  TypeScript records the original (`parsers/typescript.ts:130`).
- **Re-exports aren't captured.**
  `export { X } from './y'`, `require()` and dynamic `import()` are
  missed (`parsers/typescript.ts:115`), so a barrel file breaks the
  chain.
- **Namespace imports** (`import * as ns`) can't say which members are
  used.
- There's no index on `imports.resolved_path` (`db-schema.ts:56`).

**Diff engine.**
- `diff-engine.ts` is file-granular: modified means whole-file hash
  changed (`:81`).
- `blastRadius` is one hop of importers of a changed file (`:110-119`),
  with no symbols.
- `captureSnapshot` is pure and accepts any subset (`:24-39`).

**For Phase 32:** "who uses `createInvoice`" is a first-version query:
importers of the defining file whose specifiers include the name, with
namespace imports counted as "possibly".

Making it trustworthy needs three parser fixes, each small and each
useful beyond this phase:
1. Python records the original name.
2. Capture `export … from`.
3. Index `resolved_path`.

"Uses" means "imports", not "calls". That is enough for a warning.

## 4. Architecture rules

- **`check_architecture`** returns dependency edges filtered by
  substring. It checks nothing (`mcp/tools/architecture-tools.ts:38-56`).
- **`check_conformity`** only flags a direct reverse edge, i.e. a
  two-file cycle (`architecture-tools.ts:90-98`). Its description
  promises layer rules it doesn't have (`:77`).
- **There is no rules config anywhere.** `project-config-service.ts` has
  channel routing rules only (`:191-209`).
- The agent guide documents signatures these tools don't take
  (`mcp/skill-guide.ts:1213-1214`).

**For Phase 32:** the `rule` signal can't build on existing checks. It
needs a small rules format first. The obvious minimal one is
path-boundary rules in `.codetrellis/config.json`: "files under `web/`
may not import from `db/`". So `rule` moves from M2 to its own
milestone after M4. The guide mismatch is a documentation bug to fix
independently.

## 5. Sessions and where agents work

**What a session row holds.**
- `agent_sessions` has `session_id, agent_type, model, active_plan_uid,
  connected_at, last_seen, status` (`db-schema.ts:165-173`), plus
  `capabilities` and `host_terminal_id` (`database.ts:247,250`).
- **There's no directory, branch or repo column.**

**How a session is named.**
- On connect, from the user agent (`server.ts:651-654`).
- Then relabelled from `clientInfo` in `oninitialized`
  (`server.ts:660-669`, `mcp/client-identity.ts:18-58`).

**What the server knows about where an agent works.**
- **Nothing learns the working directory.** The only guess is the stuck
  sensor regex-matching `project_path` in call arguments
  (`stuck-sensor-service.ts:57,310-316`).
- **The server never calls `roots/list`**, though the connector already
  passes it through (`connector/core.test.ts:233-236`).
- **The connector sends only the token header**
  (`connector/sse-upstream.ts:18,38`). It inherits the agent's working
  directory and environment but forwards neither (`connector/main.ts:28-44`).
- **Session ids are per SSE connection**, so a connector reconnect after
  an app restart makes a new session (`server.ts:644`).

**Terminal ↔ session link.**
- The PTY exports `CODETRELLIS_HOST_TERMINAL` (`terminal-service.ts:222`).
- The link is recorded only if the agent calls
  `register_session(host_terminal_id=…)` (`session-tools.ts:29-41`).
- Auto-registration stores NULL (`server.ts:654`).

**For Phase 32:** binding needs:
- a `workstream_root` column
- the connector forwarding its working directory **and**
  `CODETRELLIS_HOST_TERMINAL` as headers, read at connect
  (`server.ts:651`)
- `roots/list` in `oninitialized` as a fallback
- a binding keyed on something that survives reconnects: working
  directory plus client name, not session id alone.

## 6. Claims and overlap

- `claim_item` compares only the claimed item's declared
  `fileSpecs[].path` / `moveTo` (`plan-item-service.ts:1076-1080`).
- It checks against in-progress or assigned Actions **in the same plan**
  (`:1083-1087`), by exact path, excluding the same assignee.
- It is advisory: the claim succeeds regardless (`:1098-1108`).

**Attribution bug.** The tool sets the assignee to the session's
**agent type** (`plan-item-tools.ts:399-405`, `mcp/helpers.ts:25-33`).
Two Claude Code sessions are both "claude-code", so the
"exclude the same assignee" filter hides their overlap from each other.
Parallel agents of the same kind, which is exactly this phase's case,
never see each other's claims.

**For Phase 32:**
- Footprints (declared **and** actual, across plans) supersede this
  check for awareness.
- The assignee bug should be fixed on its own. It is small and makes
  `claim_item` wrong for parallel work today.

## 7. Watching

**File watcher.**
- One module-level chokidar watcher (`file-watcher.ts:13`).
- `startWatching` closes the previous one (`:72-75`).
- Dot-directories are ignored (`:92`).

**Claude Code watcher.**
- Singleton state (`agent/claude-code-watcher.ts:24-28`).
- Matches `session.cwd !== projectRoot` exactly (`:43`); first match wins.
- It sees `Read` / `Write` / `Edit` with `file_path` (`:117-137`), but
  **only the first `tool_use` per message** (`:111-157`), and events
  carry no session id or folder.

**For Phase 32:**
- A separate workstream watcher per folder, event-only with no re-index,
  leaves the main watcher alone.
- The Claude watcher becomes a map of sessions keyed by folder.
- It must read every `tool_use` block. Today it undercounts edits for
  any message with more than one tool call.
- Its `Edit` / `Write` paths are what attribute edits in a shared
  checkout.

## 8. Trust and scope

**Trusted roots.**
- The active root plus every recent project (`trusted-roots.ts:89-106`),
  realpath-compared for exact equality (`:119-158`).
- Only 12 unpinned recents are kept (`recent-projects-service.ts:28`),
  and evicted ones lose trust (`trusted-roots.ts:168-187`).

**`mcp.projectScope`.** `'opened'` by default (`server.ts:345-351`),
checking `project_path` and `plan_dir` arguments
(`mcp-capabilities.ts:422-458`).

**Repo identity.** `recent_projects.origin_url`, normalised
(`database.ts:259-260`, `recent-projects-service.ts:34`), is the natural
key that groups clones and worktrees.

**For Phase 32:**
- Worktrees should be trusted **because git ties them to the opened
  repo** (`worktree-service.ts` `belongsToRepo`). They should not be
  trusted by being pushed into recents, where five worktrees would use
  up five of the twelve slots.
- Clones stay consent-based (spec §5.1) and, once included, are pinned
  so eviction doesn't silently drop them.

## 9. Sensors and delivery

**Config.** Under `sensors` in `.codetrellis/config.json`
(`project-config-service.ts:37-43`), with defaults at
`shared/types/project-config.ts:171-175`:
- `drift` on
- `docs` on
- `stuck` off

**What the sensor bridge posts.**
- Drift → `need-decision`, debounced per plan
  (`sensor-bridge-service.ts:161-232`).
- Doc staleness → `need-decision`, deduplicated.
- Stuck → `stuck`, 10-minute cooldown per session
  (`stuck-sensor-service.ts:54,282-288`).

Every post is a DB insert, a manifest export, a WebSocket broadcast and
routing (`sensor-bridge-service.ts:56-97`).

**For Phase 32:** `sensors.awareness` slots in beside these. Only
`decision`-kind signals should become channel events. Posting every
collision into the plan's channel would export them into the manifest,
which is the wrong place for transient signals. Awareness signals get
their own table and broadcast; the bridge is used for the ones that ask
a person something.

## 10. The interception point

- Every tool, registered through `registerTool` or the older
  `server.tool()`, passes through `instrument` (`mcp/server.ts:412-499`).
  It has the session id, tool name, resolved arguments, agent identity
  and the handler's result.
- The result is returned as-is (`:465`), so a text block can be appended
  before it.
- Refusals are thrown before the handler runs (`:426-450`).

**For Phase 32:** inline notices (spec §6.2) are a few lines at
`server.ts:465`: look up unseen signals for the session's workstream,
append one block, and mark them seen.

## 11. Capabilities

- The vocabulary is `read`, `write`, `project`, `files`, `capture`,
  `settings`, `terminal` (`peer-capabilities.ts:52-59`).
- The default grant is read, write, project and files (`:189-194`).
- `TOOL_CAPABILITIES` is deny-by-default (`mcp-capabilities.ts:366-374`).
  The coverage test enumerates what the server actually registers
  (`mcp-authorisation.test.ts:35-75`).
- For comparison: `get_deviations`, `review_plan` and `get_brief` are
  `read`; `claim_item` and `post_channel_event` are `write`.

**For Phase 32:**
- `get_awareness`, `check_footprint`, `list_workstreams` and
  `get_review_queue` are `read`.
- `declare_intent` and `acknowledge_signal` are `write`.

## 12. Review

**Tools.** All four are `read` (`mcp-capabilities.ts:235-238`):
- `review_plan(plan_uid, project_path, before?, after?)`
- `get_pr_draft(…)`
- `compare_snapshots`
- `list_comparands`

(`mcp/tools/review-tools.ts:37-125`)

**What you can compare.** `live`, `baseline`, `checkpoint:<id>` and
`commit:<ref>` (`snapshot-compare-service.ts:27-35`).
- `commit:<ref>` accepts any safe ref, so a branch works.
- But it yields **files only, with `edgesKnown: false`**
  (`snapshot-compare-service.ts:174-211,255`). Dependency findings are
  suppressed unless both sides are live, baseline or a checkpoint
  (`plan-review-service.ts:240-250`).
- `list_comparands` offers recent commits of the current HEAD only, not
  branches (`snapshot-compare-service.ts:297`).
- Tool descriptions say `before` defaults to baseline. The code uses the
  newest commit first (`plan-review-service.ts:163-171`).

**What the PR draft contains, in order** (`pr-draft-service.ts:128-184`):
1. What this does
2. Tickets
3. Acceptance criteria (task, criterion, state, evidence, signed)
4. The plan review: partially landed, criteria not met, unclaimed
   changes, unplanned dependencies, dependencies still present, notes,
   cost

**For Phase 32:**
- Reviewing a branch today loses the most valuable finding, unplanned
  dependencies, because a `commit:` side has no edges. The footprint
  engine already parses a branch's changed files with `parseVirtualFile`,
  so it can supply import deltas for `commit:` sides. That fixes branch
  review as a by-product.
- The review queue keys reviews by (plan, branch), which nothing does
  today.
- "Other work in flight" becomes a fifth PR-draft section.

## 13. Criteria and check runs

**Kinds.** `manual | artefact | citation | code | test`
(`shared/types/criteria.ts:7`). There's no registry: `runChecks` is one
`switch` (`criterion-checks.ts:354-428`).

**Adding a kind touches:**
- the union
- `CRITERION_KINDS` (`criteria-service.ts:31`)
- `defaultPolicy` (`:55-59`)
- a `case`
- `CheckContext` gathering (`criterion-loop-service.ts:141-166`)
- `stillNeeds` (`brief-service.ts:123-129`)
- the UI label (`CriteriaBlock.tsx:26`)

**Check runs.** `run_checks` → `runCheckRun`
(`criterion-loop-service.ts:399-442`) re-hashes artefacts, runs every
criterion, and records a row in `check_runs`.
- Triggers are `manual | material_changed | scheduled`
  (`criteria.ts:105`); `scheduled` has no caller.
- Runs never approve.

**For Phase 32:** "no open high awareness signals" is best added as a
**check within the `code` kind**, not a new kind. Every code criterion
then shows it, without touching the seven places a new kind needs. It
reports `fail` only when the project turns it on.

## 14. The Brief and materials

**How an agent gets its brief.** `get_brief(item_uid)` takes an explicit
item (`plan-item-tools.ts:518`); there's no "current task" per session.

**Read log.** `read_material` writes a `plan_events` row
`material_read` with attachment, locator and author
(`plan-item-tools.ts:574-582`).
- The author is the **agent type only**; there's no session id
  (`mcp/helpers.ts:25-33`, `db-schema.ts:480-491`).
- The row doesn't store the file's hash at read time.

**How artefacts are stored.** `attachments` rows per item, with path,
role, sha256, size and mtime (`db-schema.ts:259-281`,
`artefact-service.ts:186-211`).
- Citations live on `criterion_evidence.locator` with
  `sha256_at_submit` (`db-schema.ts:358-369`).

**Sharing a material across tasks.** There's no first-class notion.
- The same file on three items is three rows with three hashes
  (`artefact-service.ts:187-190`).
- Plan "pages" share their materials implicitly with every item
  (`brief-service.ts:142-143`).

**The artefact watcher.**
- One watcher per project, over recorded artefact paths only
  (`artefact-watcher.ts:39,94-116`).
- On change it already finds **every item holding that path**
  (`itemsWithArtefactAt`, `artefact-service.ts:256-264`).
- It then handles each one separately: a check run per item and a
  `need-decision` per stale criterion (`artefact-watcher.ts:52-89`).

**For Phase 32:**
- A **task binding** comes free: a session that calls
  `get_brief(item_uid)` is working on that item.
- `material_read` needs the session id and the file's hash at read time.
  That's what `version-split` compares.
- The cross-task `contract` signal is a regrouping of what
  `onArtefactChanged` already computes: one signal naming every affected
  task, instead of one notice per item.

## 15. Frontend

**PlanPanel tabs.** `plans`, `timeline`, `changes`, `proposed`,
`comments` (`PlanPanel.tsx:11,56-66`). Adding a tab means three edits in
that file.

**Timeline.**
- `groupIntoTurns` groups by `payload.sessionId` and splits on a 30 s
  gap (`lib/agent-turns.ts:25,77-120`).
- There's **no filter**: sessions interleave in one list
  (`AgentTurns.tsx:198-214`).

**ConnectedAgents.** A count of active sessions, plus a popover with
agent, model, last seen and active plan per session
(`ConnectedAgents.tsx:101-239`). It has no folder or branch.

**OtherWorktreesSection.** Plans on sibling worktrees, grouped by
branch, with "Open worktree" (`OtherWorktreesSection.tsx:17-70`).

**Graph overlays.** There's one hard-wired projection (plan intent) and
no overlay registry.
- Backend: `projection-service.ts:10-62`.
- Store: `graph-store.ts:44-61`.
- Merged into the graph: `graph-builder.ts:378-460`.

**For Phase 32:**
- The Awareness and Review tabs follow the PlanPanel pattern.
- A Timeline filter is a new prop on `AgentTurnList`.
- The workstream overlay needs a second projection-shaped slice,
  threaded through `buildDependencyGraph`. It is worth doing as a small
  overlay list rather than another hard-wired special case, since plan
  intent and workstreams are two overlays already.

## 16. Mobile

**Routes.**
- Tabs: Home, Plans, Activity, Terminals, Graph.
- Stack screens include approvals, approval, changes, plan-review and
  event-detail (`mobile/app/_layout.tsx:69-223`).

**State.**
- The desktop builds a snapshot (`state-sync-service.ts:304-470`): plans,
  channel events (50), agents, presence, terminals, input requests,
  deviation counts, power.
- It sends JSON patches every 100 ms (`:483-507`).
- Approvals are **pulled over RPC**, not in the snapshot.

**Adding an RPC.** A `case` in `routeMethod`
(`mobile-rpc-service.ts:393`), plus a row in `METHOD_CAPABILITIES`
(`peer-capabilities.ts:80-180`). A test scans the router to keep them in
step (`peer-capabilities.test.ts:29-55`).

**Approvals, end to end.** This is the template for "Needs you":
1. A `need-decision` with `criterionUid` is posted, and a push titled
   "Approval needed" deep-links to `/approval`.
2. Home pulls `criteria.awaiting`.
3. `criterion.decide` requires a confirmed device and records a human
   decision on the `phone` channel (`mobile-approvals.ts:196-222`).

**Push.** On `stuck`, `need-decision`, `need-context` and `handing-off`,
skipped while the phone is connected, at most one per type per device
per minute (`push-notification-service.ts:66-77,146-172`).
`pushForInputRequest` exists but **has no caller** (`:189`), so input
requests never push.

**Attention count.** `useAttentionCount` sums input requests, open
stuck/decision events and deviations (`mobile/lib/store.ts:308-324`);
approvals are counted separately.

**For Phase 32:**
- "Needs you" merges approvals, input requests and awareness signals
  into the one count and list the Home badge already implies.
- Signal list and detail follow the approvals pattern, pulled over RPC
  (list, then detail, then decide), so signals don't bloat the snapshot.
  Only a count goes in the snapshot.

## 17. Guides and setup

**Guide flavours.** `summary`, `quickstart`, `power-user`, `ui-nav`,
`diagnostics`, `multi-agent` (`mcp/skill-guide.ts:17`).
- Each is an if-branch plus a hand-written `registerResource`
  (`mcp/resources.ts:19-113`), and is also returned by `get_app_guide`.
- The header comment lists only four.

**Setting agents up.**
- Settings offers the `claude mcp add` line and Add to Claude Desktop
  (a preview-diff-then-write flow, `AddToClaudeDesktop.tsx:1-9`).
- `setup_agent_permissions` merges permissions into
  `.claude/settings.local.json` (`session-tools.ts:450-515`).
- **Nothing installs a Claude Code skill or hook.**

**For Phase 32:** the `parallel` flavour is three edits. Offering the
user skill and the optional `PreToolUse` hook is new work, and should
copy Add to Claude Desktop's flow: show exactly what will be written,
where, and write only on a click.

---

## Bugs found along the way

These are real today, independent of Phase 32. Each is small; several
make parallel work worse now.

| # | Bug | Where | Why it matters |
|---|---|---|---|
| 1 | `claim_item` sets the assignee to the agent **type**, so two Claude Code sessions share one assignee and don't see each other's overlap | `plan-item-tools.ts:399-405`, `plan-item-service.ts:1084-1087` | Parallel agents of the same kind are invisible to each other |
| 2 | `register_session` uses `INSERT OR REPLACE` without `active_plan_uid` / `host_terminal_id`, so an explicit call wipes both | `session-service.ts:8` | Sessions lose their plan and terminal link |
| 3 | The Claude Code watcher reads only the first `tool_use` in each message | `agent/claude-code-watcher.ts:111-157` | Edits are undercounted |
| 4 | `pushForInputRequest` has no caller. **Reclassified in 0.6a:** the real gap is wider. A local agent's `await_user_input` never reaches the phone at all (not in the snapshot, not as a push); the phone only sees requests relayed from other desktops. Moved to B4/A4 (answering agents from the phone) | `push-notification-service.ts:189` | "Agent is waiting for you" never reaches the phone |
| 5 | Agent guide lists `check_conformity` / `check_architecture` arguments the tools don't take; `check_conformity` promises layer rules it doesn't have | `mcp/skill-guide.ts:1213-1214`, `architecture-tools.ts:77` | Agents call tools wrongly and trust a check that doesn't exist |
| 6 | `review_plan` / `get_pr_draft` say `before` defaults to baseline; it defaults to the newest commit | `review-tools.ts:84,124`, `plan-review-service.ts:163-171` | Misleads agents about what was compared |
| 7 | `skill-guide.ts` header lists four resources; there are six | `mcp/skill-guide.ts:4-7` | Documentation drift |

Bugs 1–3 are M0 prerequisites in the plan. Bugs 4–7 can land on their
own at any time.

---

# Observability areas

These sections back [PHASE-32-OBSERVABILITY.md](PHASE-32-OBSERVABILITY.md).

## 18. Replay and history

**`playback-service.ts`** (Phase 26 layer C).
- It builds discrete frames from commits and stored checkpoints, plus a
  final `live` frame (`:82-122`).
- Each frame has file counts and up to 200 changed paths (`:138-155`).
- Edge counts are `null` whenever a commit is involved, because commits
  carry files only (`:145-149`).
- It refuses to interpolate (`:20-24`).
- Served at `GET /api/playback` (`server.ts:3103-3117`).

**`PlaybackBar.tsx`.** Step, play/pause, a slider and 0.5–4× speed; it
stops at the end (`:42-74,132-150`).
- It is mounted only in `CodeWorkspace.tsx`, where the frame becomes the
  "before" side of **one file's diff** (`:128-149,197-213`).
- No graph replay and no multi-agent timeline exist.

**Phase 25 play-forward** (interpolated animation, `PHASE-25…md:147-168`)
is recorded as not built (`:176-179`), and contradicts the later "never
interpolate" rule.

**`trellis_snapshots`** (`db-schema.ts:193-205`).
- Stores per-file hash, language and symbol count, plus edges with
  specifiers (`trellis-service.ts:57-80`).
- It has **no commit SHA and no session**.
- Snapshots are written only on plan approval (`server.ts:1929-1937`),
  the Checkpoint button (`server.ts:3612-3620`, `MainCanvas.tsx:217-240`),
  and `capture_checkpoint` (`drift-tools.ts:229-243`).
- The scan baseline is **in memory only** (`diff-engine.ts`) and lost on
  restart. Since 0.4h a rescan keeps it and it is labelled with its source.

**What is saved over time, and what isn't.**
- **Saved:**
  - `plan_events` (structural changes only)
  - `channel_events`
  - plan and item versions
  - criterion evidence and sign-offs
  - `check_runs`
  - per-turn `item_time_entries`
  - deviations
  - comments
- **Not saved:**
  - MCP tool calls, which are broadcast only (`mcp/server.ts:195-201`)
  - Claude Code watcher events, also broadcast only
    (`claude-code-watcher.ts:229,263`)
  - the frontend agent store, which is in memory and lost on reload
    (`agent-store.ts:26-30`)

**For Phase 32:** replay needs a persisted `agent_events` table, and
automatic snapshots at turn ends, status changes and commits, each
recording SHA and session. `PlaybackBar` is reused as-is.

## 19. Plans, tasks and tickets

**How plans render.**
- `PlanListView` is a flat list (`:524-575`).
- `PlanItemTree` is one plan's tree (`:241,341`).
- `PlanItemCanvas` is one item at a time.

**Dependencies are never drawn.** They feed only the blocked count
(`NextUpStrip.tsx:37`) and a cycle check (`PlanReadinessRing.tsx:71-79`).
There's no kanban, gantt or dependency graph.

**Phases.** `plan_phases` is legacy; the store fetches it
(`plan-store.ts:307`) but nothing renders it.

**On the graph**, only the active plan's projection shows
(`projection-service.ts:10`, `MainCanvas.tsx:603-613`).

**Cross-plan dependencies.** Item `dependencies` is an unchecked uid
list (`plan-item-service.ts:514-515`). `getNextItem` looks only within
the plan (`:1137-1159`), so a dependency on another plan's item never
counts as done. `claimItem` ignores dependencies (`:1011-1109`).

**Tickets (Phase 24).** There's no tracker client; the agent holds the
credentials (`PHASE-24…md:10-31`).
- URLs are recognised for GitHub, Jira, Linear, Figma, Notion and Slack
  (`external-refs-service.ts:20-27`).
- An epic becomes a plan and a story becomes an item
  (`external-intake-service.ts:391-432`).
- Write-back is a watermark (`:290-374`).

**For Phase 32:** the stack view needs a multi-plan aggregate, over every
active plan's projection and file specs, within the one scanned project.
It also needs cross-plan dependency resolution. Ticket keys label the
rows.

## 20. Specs and conferring

**How specs are stored.** Spec pages are plan items of kind `object`
(`shared/types/plan.ts:532,579-583`), versioned in `plan_item_versions`
(`plan-item-service.ts:609-614`).
- A body edit writes **no** `plan_events` row (`:616-619`).
- The legacy `plan_documents` has its own versions and no MCP tools.
- System docs are git-versioned files with commit-stamp freshness
  (`system-docs-service.ts:340-392`).

**Proposals.** There is no proposal flow. The "Proposed" tab is the code
change feed from file specs (`ProposedChanges.tsx`, `plan.ts:365-395`).
`propose_doc_update` is designed (`docs/cdev/07-system-documentation.md:56-65`)
and absent from `src/`.

**Links from tasks to specs.** None structured. There are the tree,
short text references (`shared/lib/references.ts:1-16`), and a system
doc's `references`.
- The doc sensor notifies only `references.plans[0]`
  (`sensor-bridge-service.ts:249-310`), and only on code drift.

**Channels.**
- Six event types (`shared/types/channel.ts:17-25`), threaded by
  `respondsTo`.
- Routing matches type, status, plan, item and age, then sends a toast
  or webhook (`project-config.ts:50-96`).
- There's **no recipient field**, and agents only receive by polling
  `list_channel_events` (`channel-tools.ts:114-150`).
- Threads can't cross plans (`channel-event-service.ts:181-183`).

**Designed but unbuilt** (`docs/cdev/08-agent-collaboration.md`):
- steer delivered at the next pause (`:92-100`)
- handoff with the channel record as context (`:102-114`)
- stuck detection pausing the agent (`:84-88`)

**For Phase 32:** conferring needs:
- a proposal queue
- task → spec-section links
- an event on spec body edits
- addressed events with cross-plan fan-out
- delivery through the awareness notice

## 21. Tests and grounding

**The `test` criterion** accepts a report as evidence
(`criterion-checks.ts:392-416`).
- It fails if the report predates the last change to the item's
  targets.
- For JUnit XML it reads totals, and fails on any failure, any error or
  zero tests (`:305-317`).
- Other formats are `unverified`.
- `submitChecked` refuses on any fail (`criterion-loop-service.ts:203-215`).

**Nothing runs tests.** There's no lcov, istanbul or cobertura support.

**`coverage-service`** measures scanner understanding (import
resolution, unmatched routes), not test coverage (`coverage-service.ts:3-41`).

**Tests aren't mapped to anything.** Nothing links tests to code,
symbols, items or criteria. The readiness ring looks for the word "test"
(`PlanReadinessRing.tsx:115-131`).

**Grounding in Phase 31** means provenance: evidence is a file plus a
checkable locator, with sha256 at submission and approval
(`PHASE-31…md:58-85`, `criteria-service.ts:520-531,596-604`).

**For Phase 32:**
- Per-test JUnit ingestion.
- Mapping tests to code through test files' imports, using the same
  import data as §3.
- A staleness check against the code each test covers.

## 22. Human breakpoints

| Mechanism | Blocks? | Where |
|---|---|---|
| `present` + `await_ack` | Yes, ≤120 s, then `acked:false` | `presence-tools.ts:51-88` |
| `await_user_input` | Yes, ≤300 s, then `timed_out:true` | `presence-tools.ts:107-158` |
| `need-decision` | No; the agent continues | `channel-tools.ts:47-110` |
| `submit_criterion` | No; the agent polls `get_worklist` | `criterion-loop-service.ts:203-232` |
| Freeze | No; only `check_freeze` reads it | `freeze-service.ts:117-121` |
| Budget | No; "advisory" | `budget-tools.ts:129-132` |
| `requiresApproval` | Only via `get_next_item`; not at claim or done | `plan-item-service.ts:1169-1194` |
| `claimPolicy: human-only` | Yes, at claim | `plan-item-service.ts:1029-1031` |
| `excludePaths` / `lockInterfaces` | No; prompt text only | `prompt-builders.ts:96-100` |

**`human-decision.ts`.** A decision object can only come from
`issueHumanDecision`, checked against a WeakSet (`:34-48`), and is issued
by desktop REST and the confirmed phone. `approve_gate` always refuses
(`plan-item-tools.ts:487-506`).

**For Phase 32:** real breakpoints need:
- enforcement at the tool interception point (claim, status, spec edit,
  proposal)
- a resumable wait that outlives 300 s
- a hook for editor-tool edits, with detect-and-report for clients
  without hooks

## 23. Audit records

**What's recorded.**
- **`plan_events`**: append-only in practice, structural only, not
  exported to git.
- **Criterion evidence and sign-offs**: actor, channel, device and
  hashes; never deleted, deliberately not exported
  (`criteria-service.ts:630-634`).
- **Sign-off pack**: re-verifiable by re-hashing files, but **not
  signed** (`signoff-pack.ts:22-23`).
- **Peer audit**: a JSON file capped at 2,000 entries
  (`peer-audit-service.ts:39-68`).
- **Git commits**: the human as author, the agent as co-author trailer;
  signing optional (`git-commit-service.ts:10-126`).
- **Logs**: kept 14 days (`logger.ts:38,171-182`).

**Tamper evidence.** Only the file hashes inside criteria and packs.
There's no chain or signature on audit rows, which live in the local
database (`persistence.ts:52`).

**For Phase 32:**
- persisted agent activity
- spec-edit and breakpoint events
- a hash-chained append-only log
- signed packs
- configurable retention
- an evidence export

## More bugs found along the way

| # | Bug | Where | Why it matters |
|---|---|---|---|
| 8 | `broadcastChannelEvent` and `broadcastInputRequest` have no callers. **Reclassified in 0.6a:** this is the desktop-to-desktop relay, an unfinished multi-machine feature and out of scope for Phase 32, rather than a defect (with #4, the remote-interaction relay is unwired) | `remote-interaction-service.ts:127-171` | Channel events and input requests don't reach paired devices through the intended path |
| 9 | The scan baseline lives in memory and is lost on restart. **Fixed in 0.6**: stored per project (`project_baselines`, `services/baseline-store.ts`) and restored when the project is scanned again; clearing it clears the stored copy | `diff-engine.ts:44-58` | "Diff since baseline" silently changes meaning after a restart |
| 10 | Spec body edits write no `plan_events` row | `plan-item-service.ts:616-619` | The history of a spec's content is only in versions, invisible to timelines and audit |
| 11 | Cross-plan dependencies never resolve | `plan-item-service.ts:1137-1159` | An item that depends on another plan's item is never offered as next |
| 12 | CI's lint step is commented out, with a note that ESLint isn't installed. It is (`eslint ^9.39.5`), and lint passes with 0 errors. **Fixed in 0.3** | `.github/workflows/ci.yml:23-29,182-185` | `npm run lint` must exit 0 errors (CLAUDE.md), but nothing enforces it; an error could land unnoticed |
| 13 | Auto-progress (a file edit moves the matching work to in_progress) only ever looked at V1 tasks; the workspace renders V2 Actions, so it had silently stopped for every user. **Fixed in 0.3b** | `plan-progress-service.ts` `recordFileChange` | The "Action lights up when the agent starts editing" behaviour didn't happen |
| 14 | `task-context.test.ts` claimed `plan-items.test.ts` covered its V2 equivalents; four of seven scenarios had no coverage anywhere. **Fixed in 0.3b** (rewritten onto V2) | `tests/e2e/task-context.test.ts` header | A skipped test's comment was the only record of coverage, and it was wrong |
| 15 | 21 entries across five agent guides named arguments the tools don't take (`claim_item(item_uid)` for `uid`, the plan-history tools' `plan_slug` documented as `plan_uid`, `update_settings(path, value)` for a sectioned object, and more). **Fixed in 0.6a**, with a guard test that checks every documented call against the registered schema | `mcp/skill-guide.ts` | An agent following the guide got a validation error and had to guess |
| 16 | From a linked worktree (where `.git` is a file) the branch read as null, `/api/git/info` said "no commits" with no branches or siblings, `.codetrellis` merge conflicts went undetected and `commit_manifest_changes` failed with ENOTDIR; branch listing also missed packed refs. **Fixed in 0.4a**: `services/git-checkout.ts` reads git's layout properly (the `.git` file, `commondir`, packed refs) and every site uses it; the commit message goes in on stdin | `server.ts` git routes, `trellis-service.ts`, `plan-conflict-service.ts`, `git-commit-service.ts` | Worktrees are where parallel agents work; each one looked like a broken repo |
| 17 | The graph query tools answered wrongly for the path form an agent is likely to send: `get_dependencies` with a project-relative path returned two empty lists ("no dependencies"), and `check_conformity` with absolute paths matched nothing and reported every proposal conformant. **Fixed in 0.4b**: both accept either form | `database.ts` `getFileDependencies`, `mcp/tools/architecture-tools.ts` | A wrong answer that looks like a right one; the only earlier test asserted `toBeTruthy()` |
| 18 | `graph_snapshot` sent the full node metadata by default, while its description promised a compact default. **Fixed in 0.4b** | `mcp/tools/graph-tools.ts` | Agents asking for "light" got the heaviest response |
| 19 | `graph_set_mode('baseline')` sent a mode the renderer doesn't have (it calls that view `current`), so no mode lit up and the canvas never changed. **Fixed in 0.4b**: the tool maps it and the renderer ignores modes it can't draw | `mcp/tools/graph-tools.ts`, `hooks/useWebSocket.ts` | An agent "showing the user the baseline" showed nothing |
| 20 | Between scans the file watcher degraded the live graph with every edit: a re-parsed file's imports were stored unresolved, so a new file never got edges and an EDITED file lost all its outgoing edges; a deleted file stayed in the graph. All until the next full rescan. **Fixed in 0.4b**: the watcher resolves pending imports with the scan's alias map and systems (about 3 ms per save on this repo) and drops deleted files | `services/file-watcher.ts`, `database.ts` | Live mode is where an agent's edits are watched; it showed a graph missing exactly the files being worked on |
| 21 | The inspector's "Add to plan" (select lines in the code view) ran on V1 tasks: on a V2 plan it listed no tasks, and what it created was a V1 task the workspace never shows, so the reference was lost. Its "New plan" path created V1 tasks too. **Fixed in 0.4c-1**: ported to V2 Actions; `POST /api/items/:uid/code-reference` merges the line range into the Action's fileSpecs on the backend, and it shows in the code overlay | `components/inspector/AddToTaskPopover.tsx`, `server.ts` | The one live UI path still writing V1; after it, nothing live calls the V1 task routes; they were retired in 0.4c-2 |
| 22 | A plan's directory is named from its title plus a uid prefix, and everything looked it up by the CURRENT title. After a rename: write-through silently stopped for good (the repo copy froze at the old title), channel events went into a new directory with no plan.yaml, and unlink / delete left the real directory behind to be re-imported on the next pull. **Fixed in 0.4c-1**: the linked directory is found by uid prefix and confirmed by the uid in plan.yaml; export and channel events write to it | `services/plan-file-service.ts`, `channel-event-file-service.ts` | Renaming a shared plan quietly disconnected it from the repo |
| 23 | Nothing validated an item's parent. A move, an update or a create could make an item its own parent, put it under one of its own sub-items, under an item in another plan, or under a uid that doesn't exist; each time the item and everything under it vanished from the tree (built down from the plan root). REST, MCP `move_item` and the phone all reached it. **Fixed in 0.4c-2**: `assertValidParent` in the item service, used by create, update and move; REST answers 400, MCP an error | `services/plan-item-service.ts` | A mis-aimed drag or agent move silently lost work from view |
| 24 | A CSV cell citation could not be read. `check_criterion` accepts `{"range": "B2"}` on a CSV and the viewer opens a CSV at that cell, but `read_material` refused `{range}` on a CSV ("read by {lines}, {text}"), so an agent could cite a cell it had no way to read, against a description saying "the same locator is what you cite". The check also split lines on commas, so a quoted comma counted as an extra column and a cell the viewer does not have passed. **Fixed in 0.4e**: `read_material` reads a CSV by `{range}`; the viewer, the check and the reader share one parser (`shared/lib/csv.ts`) | `material-reader/read.ts`, `criterion-checks.ts`, `ArtefactViewer.tsx` | The agent's evidence and the person's view of it could name different cells |
| 25 | Waiting on the Presence Pane could strand an agent. A second agent's `await_user_input` overwrote a single global and the first agent sat out its whole timeout, told nothing; `dismiss_presence` cleared the cards and left every `await_ack` waiting until its timeout; `await_ack` on a card that does not exist waited the full timeout instead of saying so; and an unknown channel event's status change answered 400, not 404. **Fixed in 0.4f**: the waiting agent is tracked in the presence service and a replaced wait returns `superseded: true` at once; dismissing releases waiters with `via: "dismissed"`; an unknown card is an error; a reply that answered someone is not also queued | `mcp/tools/presence-tools.ts`, `presence-service.ts`, `server.ts` | An agent pacing a walkthrough or asking a question hung for up to five minutes |
| 26 | The plan watcher missed a file written into a folder it had not yet attached to. A teammate's first channel events on a shared plan arrive by pull as a new `channels/` folder with files already in it; a probe lost one in about six when the files follow the folder immediately, and the harness test lost one in 2 of 3 unfixed runs. The event did not appear until something else touched that plan. Probably also the `cdev-channels` flake seen once in 0.4a, which writes into a `channels/` folder the app created moments before, though that was never reproduced. **Fixed in 0.4f**: when a folder appears in the plans tree, the watcher looks in it 500 ms later and hands over any file it was not told about | `services/plan-file-service.ts` | Pulled channel events (the team's questions and steers) silently went missing |
| 27 | UI and budget tools took any uid on trust. `open_plan`, `set_active_plan`, `navigate_to` and `open_history_drawer` never checked the plan, item or file existed, and `select_item` skipped the check when given a plan: a wrong uid was reported to the agent as shown while the window said "Could not load plan", and `set_active_plan` recorded it as the agent's plan in Connected Agents. The budget tools answered for, and `set_budget` stored a ceiling on, a plan that did not exist; assigning a plan to a session from the app accepted an unknown plan or session. **Fixed in 0.4g**: each refuses, and nothing is sent to the window | `mcp/tools/session-tools.ts`, `ui-tools.ts`, `budget-tools.ts`, `server.ts` | An agent that mistyped a uid believed it had shown the person something it had not |
| 28 | Naming the log file created it. Without the file logger (web and dev builds), `getCurrentLogPath` rotated anyway: it created an empty log file and opened a write stream nothing wrote to. So `get_logs` answered "(no log entries found)" as if nothing had happened. **Fixed in 0.4g**: without the file logger the path is only named, and `get_logs` says file logging runs in the desktop app | `services/logger.ts`, `mcp/tools/ui-tools.ts` | An agent diagnosing a web build was told the log was empty |
| 29 | The baseline said something it was not. Every scan re-pinned it to the working tree (a rescan emptied the diff) while labelling it with the HEAD hash, uncommitted work included; "Pin current HEAD" pinned the working tree; `set_baseline` changed only the window's label, so the diff compared against one snapshot while naming another commit. **Fixed in 0.4h**: a baseline carries its source and whether the tree was dirty, and is labelled so; a rescan keeps it; pinning pins the commit's own contents; `set_baseline` pins on the backend and the window reads it back | `services/diff-engine.ts`, `server.ts`, `mcp/tools/session-tools.ts`, `MainCanvas.tsx`, `useWebSocket.ts` | The diff a person or agent reviewed was not against what the label claimed |
| 30 | Reconciling deviations ignored which plan they were on. `reconcile` (MCP and REST) and the phone's `deviation.resolve` resolved by bare id, so a call on one plan resolved another's; ids that did not exist were reported as resolved; REST stored any action string; and an accepted deviation's plan change was credited to "codetrellis". `get_deviations`, `detect_deviations` (which fell back to the backend's working directory) and `capture_checkpoint` took an unknown plan; `get_change_status` answered "not found" as a success. **Fixed in 0.4h**: `reconcileDeviations` checks every id against the plan and every action before changing anything, and records who resolved it (and authors the plan change as them) | `services/deviation-service.ts`, `mcp/tools/drift-tools.ts`, `server.ts`, `mobile-rpc-service.ts` | An agent tidying one plan could silently resolve another's drift |
| 31 | Item changes never reached the repo. Plan, phase and doc changes scheduled the write-through to `.codetrellis/plans/`; item and criterion changes did not, so an item added, edited, moved or deleted was written only when something else about the plan changed. An earlier test passed on the timing of a rename's debounce. **Fixed in 0.4h**: every item mutation and criterion edit schedules it | `services/plan-item-service.ts`, `criteria-service.ts` | A teammate pulling a shared plan saw its items as they were at the last plan-level edit |
| 32 | `search_plan_history` lost results. The record separator ended each git log record, so `--name-only`'s file list fell into the next record: `matchedFiles` was always empty, and every matching commit after the first was dropped. **Fixed in 0.4h**: the separator starts each record | `services/git-activity-service.ts` | "Why did we choose this?" found only the latest commit, with no files |
| 33 | `PUT /api/freeze` stored whatever it was sent: `active: "no"` is truthy and froze the project, an `until` that is not a date never expired, and `allowedPlanUids` could be any value. **Fixed in 0.4h**: every field is validated, 400 otherwise | `server.ts` | A typo froze a team's work with no end |
| 34 | The phone never listed a plan's deviations. Its plan screen read `type`, `summary` and a null `resolution`; the desktop sends `deviationType`, `description` and `'pending'`. `'pending'` is truthy, so every deviation was filtered out, and had one been shown, `dev.type.replace` would have crashed the screen. A failed resolve was swallowed. **Fixed** (with the phone's budget card): the phone reads the desktop's fields and says why a resolve failed | `mobile/app/plan-detail.tsx` | Drift that needed a decision was invisible on the phone |
| 35 | The audio capture routes checked nothing. A `maxBufferSeconds` that was not a number made the window NaN, so the buffer was never trimmed and grew without bound; a `durationMs` sent as text was added with `+`, so lengths concatenated and `bufferedSeconds` went to nonsense; a start naming no size kept the previous one's. **Fixed in 0.4i**: window 1–600 s (default when not named), chunk length 1 ms–60 s, data must be base64 text; the MCP schemas carry the same bounds, and the phone's estimated chunk length is clamped into them | `services/audio-buffer-service.ts`, `server.ts`, `mcp/tools/audio-tools.ts`, `remote-audio-service.ts` | Microphone audio held in memory without a limit |
| 36 | No item edit from the phone ever saved. `plan.item.update` passed no author, and the item's version row requires one, so every content change — the phone's body editor, a status change, a rename — failed on the NOT NULL constraint. **Fixed in 0.4j**: recorded as the person | `mobile-rpc-service.ts` | The phone's item editor looked like it worked and changed nothing |
| 37 | What a person did on the phone did not reach the desktop. Creating or editing a plan or an item, deleting a plan, adding or removing a link, commenting on an item, posting to or resolving in a channel, and every system-doc write changed the database without the broadcast the desktop's own route sends, so the window showed the old state until something else refreshed it. A phone-made template plan broadcast `{ uid }` where the window reads `{ plan }`. The phone's delete archived the row and left the plan's folder in the repository; its channel post took its author name from the request and skipped the routing rules and the export to a shared plan. **Fixed in 0.4j**: plan edits, plan deletion and channel posts go through one function shared with REST (`updatePlanAsPerson`, `deletePlanAsPerson`, `postChannelEventAsPerson`, `setChannelEventStatusAsPerson`); the rest send the desktop's event | `mobile-rpc-service.ts`, `server.ts` | The companion app's first promise — what you do on the phone shows on the desktop — did not hold for most writes |
| 38 | Plan and item statuses were unchecked. REST and the phone stored any string (MCP had its own enums), so "finished-ish" became a status every reader treated as nothing it knew. **Fixed in 0.4j**: `shared/lib/plan-vocab.ts` holds the values; REST answers 400, the phone refuses | `server.ts`, `mobile-rpc-service.ts` | One bad write hid a plan or item from every status filter |
| 39 | A deleted plan's folder came back. Deleting archives the plan, archiving schedules its write-through, and the write-through fired 200 ms after the folder was removed — writing it back with `status: archived`. Seen as the browser suite's by-hand spec leaving its exports in the fixture. **Fixed in 0.4j**: unlinking cancels the pending write-through and the timer re-checks the link | `services/plan-file-service.ts` | Deleted plans reappeared in the repository for everyone who pulled |
| 40 | The phone's file search took a pattern and the machine's path. The query went into SQL `LIKE` unescaped, so `%` or `_` matched every file, and it was matched against the absolute path, so any segment of the user's home directory matched everything. **Fixed in 0.4j** | `mobile-rpc-service.ts` `graph.fileSearch` | The mention picker's Files tab returned noise |
| 41 | A security finding in the peer transport, recorded in `docs/private/` per Phase 19. **Fixed in 0.4j**, with a harness test | `services/remote-terminal-service.ts` | See the private register |
| 42 | Phone state drifted with two phones, and never stopped sending. State sync kept one patch base for all peers and reset it on every snapshot, so a change made as another phone took a snapshot never reached the first — it showed stale state until it reconnected. And the snapshot's `ts` counted as a change, so every connected phone got ten empty patches a second. **Fixed in 0.4j**: the base is per peer, and `ts` alone is not a change | `services/state-sync-service.ts` | Stale phone screens, and a steady drain on the phone's battery and data |
| 43 | Every agent was recorded as "agent". `authorFromExtra` looked for the calling session in fields the SSE transport does not fill, so budget changes, items, comments and criteria authored over MCP all named the generic "agent" instead of the agent's type; the 0.4g test only checked the actor was not a person. **Fixed in 0.4k**: it falls back to the session this MCP instance serves, and the test names the agent | `mcp/helpers.ts` | "Which agent did this?" had no answer anywhere an agent wrote |
| 44 | After one refused update download, every later one returned the same error until restart. A download refused before its first `await` (not https, not the releases repo) ran its whole body synchronously, so its `finally` cleared the in-flight marker before the marker was assigned; the finished promise then stayed "in flight" for good. **Fixed in 0.4k** | `services/update-download-service.ts` | A fixed release could never be downloaded in-app without restarting |
| 45 | Settings writes checked almost nothing. Loading normalised every field; saving checked only the port range and webhook hosts, so `{ mcp: { port: "abc" } }` or an unknown capability name was stored and used as sent, then silently became the default at the next restart. The modal showed nothing when a save was refused. **Fixed in 0.4k**: every field checked on the way in (400 with the reason, nothing stored), the modal says "Not saved: …"; `/api/logs/tail` refuses a non-number `maxBytes` | `services/settings-service.ts`, `server.ts`, `SettingsModal.tsx` | The setting a person saw was not the one they would get after a restart |
| 46 | **Open, for Track A (A1.7).** Opening a second checkout of the same repo (a worktree or another clone) takes the first one's system docs. Doc files carry their `uid`, rows are keyed by it, and importing a file whose `uid` exists rewrites that row's project — so after the worktree is scanned, the main checkout lists none of its docs. Plans are keyed the same way. Identity across checkouts is what A1.7 (branch and clone workstreams) designs; a local patch here would pick one answer for docs and another for plans | `services/system-docs-service.ts` `importDocFile` | Parallel agents in worktrees are the case Phase 32 is built for |
| 47 | System-doc authorship was not honest. `write_system_doc` passed no author, so an agent's doc was recorded as a person's; REST created docs as a person over plain HTTP; and `PUT /api/system-docs/:uid` passed the whole body to the service, so `author` / `authorType` in it put anyone's name on an edit. The intake tools took a plan that does not exist (`mark_external_synced` recorded a watermark for one), and `create_plan_from_external` made a plan with no project when none was open. **Fixed in 0.4l** | `mcp/tools/system-docs-tools.ts`, `server.ts`, `mcp/tools/intake-tools.ts` | "Who wrote this?" answered wrongly, in the direction that makes an agent's work look reviewed |
| 48 | A new plan ignored the default visibility unless an agent made it. `create_plan` wrote the plan into `.codetrellis/plans/` under a "shared" default; `POST /api/plans` (the app window's "New plan") and the phone's `plan.create` left it in the database, so a person's own plans read "Local" beside a setting saying Shared. Found in the 0.5 audit (m20). **Fixed in 0.6**: one helper, `exportIfSharedByDefault`, used by all three. Two consequences handled with it: a plan still called "Untitled plan" (the window creates it before the person types) is written once it has a name, and a plan's directory follows its title until it has been committed — the window saves the title as it is typed, and a directory keeps its first name, so a plan written at its first save was otherwise named for half a word. Committed directories still keep their name (bug 22) | `server.ts`, `services/mobile-rpc-service.ts`, `services/plan-file-service.ts` | A person's plans did not reach the team through git when the setting said they would |
| 49 | Three MCP tools were counted as tested because a unit test that phrases tool calls for the Timeline mentions their names; nothing ran them. Running them: `search_items` answered an unknown plan with no results and put the query into LIKE unescaped (`%` matched every item); `import_external` recorded "mcp-agent" as the author whoever called it, filed the plan under no project when none was open, and ignored the default visibility (bug 48); `bulk_add_items` needed its unknown-plan refusal. Found in the 0.7 stage review. **Fixed in 0.7** with `tests/e2e/item-batch-search-import.test.ts` | `mcp/tools/plan-item-tools.ts`, `mcp/tools/plan-tools.ts` | The coverage guard credits a name, not a call — see the 0.7 review |
| 50 | The coverage guard credited a REST route by its path whatever the method, so a test of `GET /api/items/:uid` counted for `DELETE` on the same path, and `POST …/attachments` for the `GET` beside it: `DELETE /api/items/:uid` and `GET /api/items/:uid/attachments` had no test at all. Both behaved correctly once tested. The guard had the same flaw as bug 49 for tools and RPC methods. Found making the guard credit calls (Track A, carried from 0.7). **Fixed**: the guard credits what a test sends — the tool called, the RPC method requested, the route requested with its own method — directly or through a harness helper; `tests/e2e/item-delete-attachments.test.ts` | `tools/inventory/extract.ts`, `tools/inventory/run.ts` | The unit column is now mostly empty: unit tests drive services, not the transports |
| 51 | The in-app update download showed no progress, and saved only inside the data folder. The backend stayed `idle` while it fetched the signed manifest; the panel's first poll after Download read that as finished and stopped polling, so the whole download ran with a disabled button and nothing else, then "Show in folder" appeared on the next visit. The browser test stubbed `downloading` the moment Download was pressed, which the real backend never did. Reported by the owner updating 0.1.16 → 0.1.17. **Fixed**: the download is `preparing` from its first line, cancel works while preparing, the panel keeps polling until it sees the download start; and a verified download can be saved where the person chooses (native save dialog in the main process, the copy re-hashed against the verified digest). Unit tests in `update-download-service.test.ts`; browser tests in `pr55-ui.spec.ts` (the idle-polls one fails on the old panel) | `services/update-download-service.ts`, `settings/VerifiedUpdateDownload.tsx`, `electron/main.ts` | |
| 52 | Authorship still went wrong in the ways Stage 0 had fixed one at a time. About twenty REST handlers wrote `human` whoever called (items, comments, attachments, moves, deletes, refs, imports, templates, check runs, artefacts), against §0.4d's rule that plain HTTP is `unverified`; plan docs, doc edits and plans from a template took `author` / `authorType` from the request body, and a comment's `source` too; `PUT /api/plans/:uid` recorded the literal `'user'`; and a channel post from an agent that had not called register_session was recorded as `human`, so it read as the person's own. Found building the authorship guard (Track A, carried from 0.7). **Fixed**: one helper per transport (`personFrom` / `actorFrom` in `server.ts`, `phonePerson` / `phoneActor` on the phone, `authorFromExtra` for MCP), nothing read from the caller, and `src/backend/authorship.test.ts` fails on any handler that names the person outside them (6 failures on the old code). The UI labels `unverified` "local API, unverified" instead of calling it an agent. `tests/e2e/authorship.test.ts` | `server.ts`, `services/mobile-rpc-service.ts`, `mcp/tools/channel-tools.ts`, `mcp/tools/plan-tools.ts`, `services/comment-service.ts` | REST claim still takes `agentId` from the body; A0 reworks claims |
