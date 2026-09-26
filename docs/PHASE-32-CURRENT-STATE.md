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
- The scan baseline is **in memory only** (`diff-engine.ts:44-58`),
  re-pinned on every scan and lost on restart.

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
| 9 | The scan baseline lives in memory and is lost on restart | `diff-engine.ts:44-58` | "Diff since baseline" silently changes meaning after a restart |
| 10 | Spec body edits write no `plan_events` row | `plan-item-service.ts:616-619` | The history of a spec's content is only in versions, invisible to timelines and audit |
| 11 | Cross-plan dependencies never resolve | `plan-item-service.ts:1137-1159` | An item that depends on another plan's item is never offered as next |
| 15 | 21 entries across five agent guides named arguments the tools don't take (`claim_item(item_uid)` for `uid`, the plan-history tools' `plan_slug` documented as `plan_uid`, `update_settings(path, value)` for a sectioned object, and more). **Fixed in 0.6a**, with a guard test that checks every documented call against the registered schema | `mcp/skill-guide.ts` | An agent following the guide got a validation error and had to guess |
