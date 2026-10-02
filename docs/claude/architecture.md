# Architecture

CodeTrellis is an Electron desktop app with an embedded Express backend, a Vite-served React renderer, and an Expo/React Native mobile companion. The desktop and mobile communicate peer-to-peer over WebRTC under a "bring your own VPN" connectivity model — see `peer-network.md`.

## Runtime topology

- **Desktop (primary)** — Electron 41, ships installers for macOS (arm64 + x64 DMG), Windows (NSIS Setup + Portable exe), Linux (AppImage, .deb, .rpm).
- **Embedded Express** — runs in-process on `:3001`. Same server is used in Electron and in web/dev mode; web mode is a fallback for browser-based development.
- **Vite dev server** — `:5173`, HMR for the renderer in development.
- **MCP server** — SSE transport on `:19432`. Any MCP-speaking client (Claude Code, Codex, Cursor, aider, Claude Desktop, …) appears as an attributed agent in the timeline. See `mcp-tools.md`.
- **Mobile companion** — Expo SDK 54 + React Native 0.81.5, iOS + Android. Discovers desktops on the LAN and connects over WebRTC. See `mobile-companion.md`.

## Directory layout

```
src/
  backend/              Express app + services + MCP server
    services/           ~50 services, grouped by domain (see below)
    tools/              MCP tool definitions, ~18 categories
    parsers/            Per-language tree-sitter parser plugins
    resolvers/          Per-language import/symbol resolvers
    callsites/          Per-language HTTP/SQL/subprocess callsite extractors
  frontend/             React 19 + Tailwind 4 + React Flow 12 renderer
    components/         Domain component trees
    stores/             Zustand stores, one per domain
    bridge/             Runtime transport switch (HTTP / IPC / WebRTC)
    lib/, hooks/
  electron/             Main process + preload
  shared/               Types shared backend ↔ frontend
mobile/                 Expo companion app (see mobile-companion.md)
resources/tree-sitter/  WASM grammars (TS/TSX/JS/JSX/Py/Rust/PHP/Java)
docs/claude/            Reference docs for Claude/agent context (this folder)
```

## Backend service domains

The `src/backend/services/` directory holds ~50 services. Grouped by responsibility:

- **AST & code analysis** — parsers, resolvers, callsites, `cross-system-service`, `system-discovery`, `projection-service`.
- **Peer & pairing** — `peer-connection-service`, `webrtc-service`, `pairing-service`, `pairing-server`, `paired-device-service`, `mdns-service`.
- **Remote execution** — `remote-terminal-service`, `remote-audio-service`, `remote-interaction-service`, `mobile-rpc-service`, `mobile-api-server`, `audio-buffer-service`.
- **Power & lifecycle** — `power-service`, `power-signals`, `state-sync-service`.
- **Plans & collaboration** — `plan-service`, `plan-import-service`, `plan-history-service`, `plan-conflict-service`, `plan-progress-service`, `plan-event-service`, `plan-documents-service`, `plan-templates`, `phase-service`, `spec-service`, `template-service`, `channel-event-service`, `channel-event-file-service`, `channel-dispatcher-service`, `comment-service`, `task-attachments-service`.
- **Governance & drift** — `freeze-service`, `contribution-service`, `deviation-service`, `schema-reconciler`.
- **Persistence & filesystem** — `file-watcher`, `claude-code-watcher`, `recent-projects-service`, `project-config-service`, `settings-service`, `system-docs-service`.
- **Agent comms** — MCP server, `session-service`, `stuck-sensor-service`, `sensor-bridge-service`, `self-write-tracker`, `agent-event-log` (Phase 32 B1: every broadcast agent event, stamped with session, agent and workstream, secrets masked; `GET /api/agent-events`), linked into the record's hash chain as it is written (`record-chain`, B10.1; `GET /api/record`), kept as long as Settings → Data says (`retention`, B10.2: 14 days by default, or 30, 90, 365, or everything; the person's only).
- **Cross-system & external** — `cross-system-service`, `external-refs-service`, `external-pointer-service`, `pantry-resolution-service`, `personal-sync-service`.
- **Utilities** — `update-service`, `push-notification-service`, `git-activity-service`, `git-commit-service`, `ipc-dispatcher`, `terminal-service`, `trellis-service`.

## Frontend

- **Stores** (Zustand, one per domain) — graph, plan, agent, project, ui, toast, presence, channels, terminal, system-docs.
- **Bridge abstraction** at `src/frontend/bridge/` — picks transport at runtime: HTTP for web/dev, Electron IPC in the desktop app, WebRTC data channels for peer-routed calls. `isElectron()` is the original switch but peer routing extends it.
- **Component trees** — graph (ReactFlow custom nodes + edges, dagre + d3-force layout), plan editor (react-markdown + remark-gfm), terminal (xterm.js), pairing (QR), presence (peer avatars + status), audio (capture/stream UI), settings, top-bar `ConnectedAgents` widget.

## Data layer

- **sql.js** in-memory with autosave to disk + manual export. No FTS yet.
- **Schema self-heal** via `schema-reconciler` — recovers from drift in user-owned data.
- **Tree-sitter WASM** grammars for AST analysis (TS/TSX/JS/JSX/Python/Rust/PHP/Java). Per-language plugins live under `services/parsers/<lang>.ts`, `services/resolvers/<lang>.ts`, `services/callsites/<lang>.ts` and register in the matching `index.ts`.

## Secrets and review hosts (Phase 32 C2.2)

- **Secrets** (`services/secret-store.ts`). A review host's token is the only
  secret the app keeps for the person. In the packaged app the backend runs
  in Electron's main process, whose `safeStorage` encrypts with a key the OS
  keychain holds; only ciphertext is written, one file per secret under
  `<dataDir>/secrets/` (mode 0600, named by the key's hash). Under plain
  Node (dev, the harness), or on Linux where Electron would fall back to
  `basic_text`, a secret is kept in memory only until the app quits, and
  Settings says so. Never plain text on disk, in the database or in a
  response.
- **Review hosts** (`services/review-host/`). `detect.ts` reads the host from
  the `origin` remote (GitHub supported; GitLab and Bitbucket recognised for
  C2.3). `switch.ts` holds the per-project switch in this device's database
  (`review_hosts`), never in the committed `.codetrellis/config.json`, so a
  cloned repository cannot turn itself on; it records the repository it was
  turned on for, and a changed remote switches it off. Turning on and saving
  a token are grants (app window only, `grant-guard.ts`); turning off and
  forgetting are anyone's. `activeReviewHost` is the one gate the adapter
  asks before any request. Routes: `GET/PUT /api/review-host`,
  `PUT/DELETE /api/review-host/token`; UI: Settings → Review hosts.
- **GitHub behind it** (C2.2b, `review-host/github.ts`, `host-state.ts`).
  For each branch a plan works on: its pull request by head branch, and
  when open its check runs, combined status and reviews. GET only, the base
  fixed for github.com (`CODETRELLIS_GITHUB_API` points tests at a
  stand-in), redirects refused so the token never reaches another host,
  the token only in that request's header. Answers are kept two minutes
  (one read per branch per two minutes, inside the 60 an hour a public
  repository allows), shared while in flight, and forgotten when the host
  is turned on or off or its token changes. `overlayHost` combines: open is
  `in-review`, merged is `merged` by `pull-request`, closed is `closed`,
  each `source: 'github'`; no pull request or a failed read keeps git's
  state with a `hostNote`; git's proof of a merge stands over the host.
- **GitLab and Bitbucket** (C2.3, `review-host/gitlab.ts`, `bitbucket.ts`),
  on the same switch, cache and overlay, through the one reader table in
  `host-state.ts` and the one request helper `review-host/http.ts` (GET only,
  redirects refused, refusals in words). GitLab: a branch's merge request
  (`!42`) by `source_branch`, its `head_pipeline` and approvals, the token as
  `PRIVATE-TOKEN` (`read_api`), subgroups in the project path. Bitbucket
  Cloud: a branch's pull request by `source.branch.name`, its participants'
  approvals and changes requested, the commit's build statuses, declined or
  superseded read as closed, the token as a bearer. Each state's `source` is
  the host (`gitlab`, `bitbucket`), said "from GitLab", "from Bitbucket".
  `CODETRELLIS_GITLAB_API` and `CODETRELLIS_BITBUCKET_API` point tests at
  stand-ins; the harness points all three at nowhere by default. Azure
  DevOps and Gitea are follow-ups on the same shape.

## A plan's status, read and never written (Phase 32 C2.4)

`services/plan-status.ts` over `shared/lib/item-status.ts` (pure). Every item
gets a state with its `source`: an item on a branch git can see takes git's
state, or the review host's where one is on (`item-git-state.ts`); everything
else takes **the plan's own** — a task's status in words ("in progress, 60%",
"blocked: …", "done, signed off by Priya" from its criteria), with who
recorded it (the newest `status_changed` plan event); a section sums the
tasks under it ("1 of 3 tasks done; 1 blocked"), and one with none is
`context`. A branch git has not seen yet keeps the plan's state with a
`gitNote` ("no refunds branch yet"). The plan's view adds progress (done in
the plan, or merged by git or a host), what waits on someone (blocked, or a
criterion waiting for sign-off), what is under way, and a lineage per branch:
ticket → this plan → "PR #118 (open)" only when a host said so, otherwise
what git proves ("board-charts pushed"). One answer for
`GET /api/plans/:uid/status` (the header chip's view, each tree row's hover,
the item page's State line), the phone's `plan.status` and `get_plan`'s
`state`. Nothing is written: there is no STATUS.md, and reading writes no
file.

C2.4b keeps state out of the plan's files too. `serializeItem` writes no
`status`, `progressPercent`, `blockedReason`, claim (`assignee*`),
progress report or `updatedAt`; `updateItem` schedules no write-through for
an update that changes only those (`isStateOnly`, `shared/lib/item-status.ts`)
and `claimItem` none at all; `writeFileAtomic` leaves a file alone when its
content would not change. Import still reads an older file's `status`, and a
file without a claim or blocked reason leaves this machine's alone.

## Task state as records (Phase 32 C3.1)

`services/task-records/shared-state.ts` over `record.ts` (pure). Off until
the person turns on Settings → Shared task state for a project (a row in
`shared_task_state` on this device, never the committed config; turning on
is a grant, turning off anyone's). On, `plan-item-service`'s state-write
listener writes each state change made here (status, claim, progress,
blocker; not one taken from a record or an older plan file, which run under
`withoutStateRecords`) as one new file,
`.codetrellis/records/<plan>/<item>/<writer>-<counter>.yaml`. Order is by
each writer's counter and what it had seen of the others, never clocks.
Records are read on project open, after a plan's import, and when the
folder changes (a chokidar watcher, while sharing is on): an item's settled
head that is a teammate's and new to this machine (`task_record_heads`) is
applied through `applyRecordedState` with author type `record`, which
`recordedWords` says as "recorded by Sam Lee in their record, unverified".
Heads that disagree (people acting at once) are kept unapplied with the
split kept in `task_record_heads` (`task-records/heads.ts`, database only). C3.2 names it:
the item's state carries `atOnce` ("set two ways at once: Sam Lee says in
progress, Dana Ortiz says blocked"), it joins what the plan waits on, an
agent's `get_plan` says `set_at_once`, and it is a `state-split` signal in
the inbox (see awareness.md); Keep on the item page (`POST
/api/items/:uid/keep-state`) writes this machine's state again as a record
that has seen both, which ends it. Two different records under one writer
and counter are a forged split: neither is taken. Records are untrusted: uid folder names only, a
record naming another task than its folder is refused, 16 KB and 5,000 per
item at most, read through `readTextWithin`, written through
`writeFileWithin`. Routes: `GET/PUT /api/shared-task-state`.

**Signed records (C3.3).** `task-records/signing.ts` (pure) and
`trust.ts`. Each record is signed as it is written, over its body as
canonical JSON (keys sorted): with git's SSH key when git signing is set up
with one (`signingSetup` from C2.5b, `ssh-keygen -Y sign`, namespace
`codetrellis-task-record`), else with this device's own Ed25519 key, made
once and kept in `task_record_device_key` (the private half never leaves
the database). A device key is introduced to the project once, as
`.codetrellis/keys/<writer>.yaml`; a teammate's introduction is kept in
`task_record_keys` as `new` until the person trusts it in Settings → Shared
task state (`POST /api/shared-task-state/keys`; trusting is a grant,
refusing anyone's), having compared the fingerprint, which is computed and
never read from the file. Trust is per device key, so a teammate is
introduced once across projects. On read, a record verifies when its
signature is good for a key trusted for the device that wrote it, or for
git's key of a signer listed in git's allowed signers; anything else (not
signed, a key not trusted or refused, bytes changed after signing, a key the
team does not list) is unverified, with why. The verdict is kept beside the
head (`task_record_heads.verdict`) and laid over the status event by
`plan-status`, so trusting a key turns that device's records "signed"
without anyone changing a task: `recordedWords` says "in their signed
record", `recordCheckWords` the hover, `get_plan` `recorded_in`. Checks are
cached per record content (ssh-keygen is a process). The harness sets
`CODETRELLIS_GIT_SIGN_RECORDS=0`, so its records use the device key unless
a test turns git signing on.

## A linked plans folder (Phase 32 C3.4a)

`services/plans-home.ts`. A project's plans, task records and key
introductions live under `.codetrellis/` in the project unless its
committed `.codetrellis/config.json` names a plans folder,
`plans.folder`: `{ kind: "git", remote }` (a planning repository) or
`{ kind: "synced", provider, place }` (a folder OneDrive or SharePoint
syncs, by its place under the provider's root). The config never holds a
full path; `parsePlansFolderRef` refuses a remote with credentials and a
place that is absolute or climbs. Each device's copy is confirmed by the
person (`linked_plans_folder`, never the config alone), and only accepted
when it is a real directory, not the project, and a copy of the folder
named (its git remote, normalised by `normaliseRemote`, or its path ending
in the place). `plansHome(project)` is the folder every plan-file, record
and key path is built under: the project, the linked copy, or null when a
folder is named but not linked here (or the config names another, or the
copy has gone), and then nothing is read or written and an export is
refused with the reason. Plans imported from a linked folder belong to
its project (`projectOfPlansHome`), and `resolveTrustedPlanDir` accepts
plan directories in a folder linked to an opened project. Routes: `GET/PUT
/api/plans-folder` (naming is a grant), `POST/DELETE
/api/plans-folder/link` (linking is a grant, unlinking anyone's); a change
rebinds the plan and record watchers and imports what is there. Settings →
Plans folder. The records watcher's start is awaited where a record may
be written next: a folder created before chokidar is ready may never be
watched.

**OneDrive, SharePoint and placeholders (C3.4b).** `services/cloud-files.ts`.
`cloudRoots()` finds where the sync client mounts OneDrive and SharePoint
libraries: macOS `~/Library/CloudStorage/OneDrive-*` (and
`OneDrive-SharedLibraries-*` for SharePoint; the older `~/OneDrive - <Org>`),
Windows `%OneDrive%`, `%OneDriveCommercial%`, `%OneDriveConsumer%` and the
client's registered mount points (`reg query
HKCU\Software\SyncEngines\Providers\OneDrive`), Linux `~/OneDrive`;
`CODETRELLIS_CLOUD_ROOTS` replaces them (the harness sets it to `[]`). The
plans-folder status offers them, and for a named synced folder not linked
here the copy found under them (`found`). `isPlaceholder(file)` never opens
the file: on POSIX a non-empty file with no blocks under a cloud root (an
ordinary sparse file elsewhere is read as usual), on Windows the offline
attribute from `attrib`. A placeholder is never read or written: plan
discovery skips a plan whose `plan.yaml` is one and import says why; an item
file that is one is skipped with a warning and its task kept; a record or
key introduction waits; `sha256FileWithin` refuses to hash one
(`NotOnDeviceError`), so recording a material says why and a refresh keeps
the last hash; and `writeFileAtomic` neither reads nor overwrites one, and
the export's stale-file pruning does not delete one, since either would
replace or remove what may be a teammate's newer copy in the cloud. The
status counts placeholders under the folder (`notOnDevice`) and says how to
keep it on the device.

**Materials by their place (C3.4c).** `services/material-place.ts`. A
material (a `file_ref` attachment with a role) is stored by its place, never
a full path: relative to the project's root, as since Phase 31, or, for a
file in the project's linked plans folder, as `plans://<path in the folder>`.
`locateStored(value, projectRoot)` resolves either on this device (the
plans form against `plansHome`, refusing anything that climbs) and every
reader goes through it: recording, hash refresh, serving and the material
reader, criterion checks, sign-off pack verification and the artefact
watcher; `placeOf` turns a file back into its stored form. The stored value
and its sha256 are what A6's material signals compare, so two machines
whose copies of the folder sit at different paths read one material as
one. A file reference's role now travels in the plan files (written and
read; never its hash, size or time, which each device takes itself), and
the artefacts of an imported plan are watched like ones recorded here.

**Teammates' material reads (C3.5).** `task-records/material-reads.ts` over
`read-record.ts` (pure). A6.2 kept each read on the machine it happened on,
so the material signals compared one person's tasks. With task state shared,
`read_material` also writes, through `shareMaterialRead`, which version of
which material the task read as
`.codetrellis/reads/<plan>/<item>/<writer>-<counter>.yaml`, beside the
task-state records: one per version, not per read (nothing is written when
the device's latest record for that material names the same sha256). The
material is its stored value (C3.4c), so it is one material on every
machine. Each is signed with the record key (C3.3; the body carries
`kind: material-read`, so it never parses as a task-state record or the
reverse) and checked when read. Teammates' are read with the records
(`readProjectRecords`, the same watcher, now over `reads/` too) into
`teammate_material_reads`, never a device's own; a folder must be a task
this machine has, in that plan of that project, and a file's name must be
its writer and counter. `taskFootprint` merges them with this machine's
reads by time, so `get_brief`'s `read_so_far` says "claude-code for Alex
Kim (unverified)" and the signals' latest read per task can be a
teammate's; a version split or stale base then names whose read it was in
its words ("“Draft the board report” (Alex Kim)"), never in its shape, so
the same signal is not reopened. The switch is a row in
`shared_material_reads`: none means on whenever task state is shared (the
owner's choice); `PUT /api/shared-task-state {materialReads}` sets it, on
being the person's (`mayGrant`), off anyone's. Off, or task state unshared,
teammates' reads are forgotten here so no signal rests on them; trusting or
refusing a key forgets that device's and reads them again, checked anew.
Whose read it was also travels in the signal as `subject.readBy` (by task
workstream), beside `labels` and like it left out of the shape, so the
Awareness tab's sides ("Check the figures (Sam Lee)"), the side words and
each task's Brief line name the teammate too, not only the summary (C3.6).

## Approvals as signed statements (Phase 32 C2.5b)

`services/signed-approvals.ts` over `signed-approval-record.ts` (pure). A
person's approval of a criterion (the app window, or a confirmed phone;
never plain HTTP, which may be a script) is kept here as always. Where the
plan is shared through a folder and git signing is set up with an SSH key
(`gpg.format ssh`, `user.signingkey`, `user.email`), it is also written as
`<plan>/approvals/<uid>.yaml`: the statement (canonical JSON of the
criterion, its wording's sha256, the evidence hashes, the signer and when)
and an `ssh-keygen -Y sign` signature under the namespace
`codetrellis-approval`. One file per approval, only ever added. Import checks
each with `ssh-keygen -Y verify` against git's `gpg.ssh.allowedSignersFile`:
a verified record for an unchanged criterion adds that person's sign-off
(channel `file`); anything else is kept as "can't verify" with why and
counts for nothing. Without signing, the approval stays on the machine and
says why. `signed_approvals` holds each outcome; `GET
/api/items/:uid/signed-approvals` lists them and the criteria block shows
one line under each criterion. The app holds no key and implements no
signature scheme. The harness sets `CODETRELLIS_SIGN_APPROVALS=0` so a
developer's own git key is never used by a test; the signing spec turns it
on.

## Teammates' plans after a pull (Phase 32 C2.6a)

`services/plan-arrivals.ts`. When an import finds a plan this machine has
never had, its arrival is recorded in `plan_arrivals` with who added it and
in which commit, from `git log` on its `plan.yaml` (`lastCommitOf`, as skill
arrivals do), never from the file's own `author` field. A folder imported
before it was committed records nulls and learns its commit on a later
import; one already known is never rewritten. `GET /api/plans` carries
`arrival`, the Stack's plans `arrival` in words ("from Priya Shah, in
3f9c2e1"), and `get_plan` `arrived_from`. The app never fetches: the pull is
the person's, and the plan-file watcher imports what it lands.

## Session persistence & power awareness

CodeTrellis treats long-running agent sessions as first-class — desktops don't sleep while agents are working, and reconnects rehydrate state rather than starting fresh.

- **`power-service`** wraps Electron `powerMonitor` + `powerSaveBlocker`. Blocks app/system sleep while agents are active; emits suspend/resume/ac-state events.
- **`power-signals`** is the event stream + heartbeat that other services subscribe to.
- **`state-sync-service`** rehydrates terminal scrollback, plan state, and agent-session metadata when a peer reconnects.
- **`session-service`** tracks agent sessions and attributes tool calls to the originating client.
- **`pack-seal`** signs each sign-off pack (Phase 32 B10.3) with this computer's device key, in its own namespace, carrying the record's head; verifying says who signed it (this computer, a trusted teammate's key, or a key not known here), whether it changed since, and whether the record it names still holds.
- **`evidence`** (Phase 32 B10.4) packages a plan or a window of an opened project for an auditor: every record entry in the window with the link before it, so the chain recomputes from the file alone (the record is the computer's, so other projects' entries in the window ride along); the replay frames; the stack and signals at both ends; the breakpoints and decisions in words; the plan's sign-off pack. Sealed like a pack in its own namespace (`codetrellis-evidence`). Verifying says who signed it, whether its chain holds, and, on the computer that made it, which entries changed in the record since.
- **`test-clock`** (Phase 32 B10.5) moves the backend's clock when the harness sets `CODETRELLIS_CLOCK_OFFSET_MS`, so a test can come back months later (the G2 done-when); imported first in `server.ts`. Unset, nothing changes. See `docs/claude/record.md`.
- **`agent-event-log`** keeps every broadcast agent event (Phase 32 B1), for the person's retention window (B10.2, 14 days by default), so the Timeline survives a reload; each is linked into the record (B10.1), which retention trims as its oldest block so it still verifies.
- **`replay-frames`** keeps a graph snapshot at the moments replay steps between (Phase 32 B5.1): a session's turn ends (30 s quiet, `src/shared/lib/turn-gap.ts`, the Timeline's rule), an item's status changes, or a checkout's HEAD moves. Only for the project the server holds and never mid-scan; at most one per project every 10 s (moments inside merge into one); a frame whose graph digest matches the last points at it (`same_as`) instead of copying. Frames are `trellis_snapshots` rows of type `frame`, listed by `GET /api/replay/frames?project=`, left out of the checkpoint list.
- **`replay-state`** answers `GET /api/replay/state?project=&at=` (B5.2): the frame at or before `at` and how the graph differs from it now (only when the server holds that project), each action's status then (from `plan_events`), breakpoint hits waiting then, and the signals open then (from `awareness_signal_spans`, one row per opening, written by `refreshSignals`). Nothing is recorded for it; the lanes up to `at` are `/api/agent-events?before=`.
- **`source-control`** (Phase 32 E1) answers what has changed in an opened project with no plan, grouped as an editor's source control tab: staged, unstaged, untracked, committed since the graph's baseline, and each other worktree or branch, each group with the two comparands its files are diffed between (`GET /api/source-control`; the sidebar's Changes tab). `workstream-commits` keeps each workstream's commits by head and merge base, and the awareness store reads one at a time, so file changes in many worktrees cannot pile reads up.
- **`git-refs`** (Phase 32 E2) lists every point a person can compare (`GET /api/git/refs`: this checkout, branches, remote-tracking branches as last fetched, tags, other worktrees) and the files between any two (`GET /api/git/refs/compare`), each side said plainly and as the git command that shows the same. Sides are comparand specs the rest of the app reads: full ref names (`commit:refs/tags/v1`), `merge-base:<a>...<b>`, `workstream:<id>` for a worktree's working copy, written as a tree through a copy of its own index so the checkout is never touched. `snapshot-compare-service` resolves them for the graph and `/api/file/at`.
- **Replay in the window** (B5.3): `stores/replay-store.ts` holds the frames and the cursor. While it is on, `TimelineLanes`, `AwarenessTab`/`BreakpointsWaiting`, `PlanItemTree` and `MainCanvas` read the state at the cursor instead of live (read-only: no answering from the past); `ReplayBar` (above every Plan panel tab) steps them with `PlaybackBar`.

## Cross-system extraction

Per-language callsite extractors match HTTP / SQL / subprocess / env patterns. `cross-system-service` pairs them across languages to build cross-system edges (e.g. a TS `fetch('/api/foo')` paired with a Python Flask route). System-discovery auto-detects microservices, endpoints, and data flows.
