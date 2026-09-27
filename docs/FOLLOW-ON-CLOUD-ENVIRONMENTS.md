# Follow-on: CodeTrellis in cloud coding environments

> Status: proposal for after Phase 32. Not scheduled. Phase 32 is one
> developer on one machine (PHASE-32-LOG, Decisions); this widens that, so
> it is its own piece of work.

## 1. The situation

More agent work now runs in cloud environments rather than on the
developer's machine: a container is cloned fresh, an agent works in it,
and it is thrown away when the session ends. Claude Code on the web works
this way, and so do other hosted agents.

CodeTrellis currently watches agents on the developer's desktop. An agent
in a cloud container is invisible to it until its commits are pulled, and
even then the session itself (what it planned, what it touched, where it
stalled) is gone.

The goal: a developer running agents in cloud environments gets the same
picture as one running them locally, without hosting anything and without
code leaving where it already goes.

## 2. What already exists

Most of the pieces are already there. Evidence is from the current tree.

| Piece | Today |
|---|---|
| The backend without Electron | Runs as plain Node (`tsx src/backend/index.ts`). The harness and the browser suite both run it that way (`tests/harness/backend.ts`, `playwright.config.ts`). |
| The UI without Electron | `vite.web.config.ts` builds the web version; the bridge picks HTTP when there is no Electron (`src/frontend/bridge/`). |
| Isolated data | `CODETRELLIS_DATA_DIR` puts the database, token and settings anywhere. Every test uses it. |
| Agents connecting | The stdio connector (`src/backend/mcp/connector/`) re-reads the per-launch token on every connect. An agent in the same container connects exactly as it does on a desktop. |
| Plans travelling through git | Plans write through to `.codetrellis/plans/` in the repo, and the desktop's plan watcher imports what arrives by pull. |

So "CodeTrellis inside a container" already works for the tests. What is
missing is a way for a developer to use it: a command to start it, a way
for sessions to pick it up automatically, and a way to see what it saw.

## 3. The hard part: seeing it

A cloud container usually cannot be reached from the developer's
browser, and the security rules forbid pretending otherwise: remote
surfaces are off by default, loopback is not an authorisation boundary,
and every transport authenticates (CLAUDE.md, Phase 19). There are three
ways to get the picture out, in order of effort and risk.

1. **Through git (no live view).** The CLI records the session and
   commits a status snapshot beside the plans: plan progress, blockers,
   what changed, which agent did it. The developer opens the repo in
   desktop CodeTrellis and sees it. This is Phase 32 track C2 ("team
   status through git") pointed at a cloud session, and needs nothing new
   on the network.
2. **A snapshot report.** The CLI renders a self-contained HTML page of
   the graph, plan and timeline at the end of a session (or on demand).
   The session hands the file over like any other output. No live
   connection, so nothing to secure.
3. **A live view through the developer's own tunnel.** The CLI serves the
   full UI, token-gated, and the developer reaches it through a tunnel or
   VPN they control. This matches the "bring your own VPN" model the phone
   already uses (docs/claude/peer-network.md). It is the most useful and
   needs the most care, so it comes last and gets its own security review.

## 4. Proposed design

### 4.1 A `codetrellis` command

A small CLI over the existing backend, shipped as an npm package so a
cloud environment's setup script can install it:

| Command | Does |
|---|---|
| `codetrellis serve [--project .]` | Starts the backend headless (no Electron, no mDNS, no peer mesh, no update check) and opens the project. Prints the connector command for agents. |
| `codetrellis scan` | One-off scan; prints coverage and counts. |
| `codetrellis status` | Plans, items, blockers and recent agent activity, as text or `--json`. |
| `codetrellis snapshot [--out file]` | Writes the status snapshot (option 1) and, with `--html`, the report (option 2). |

Headless mode is a set of switches the backend mostly has already. The
data dir goes inside the container (or a cache dir the environment keeps
between sessions, where it has one).

### 4.2 Sessions pick it up automatically

A SessionStart hook in the repository's `.claude/settings.json` starts
`codetrellis serve` and registers the connector as an MCP server for the
session. Every session in that repo is then observed without the
developer doing anything. Other hosted agents get the same through their
own setup scripts and MCP config.

### 4.3 What gets committed

The snapshot sits in `.codetrellis/` beside the plans. It is data the
developer already chose to share by committing plans; it adds status,
not code. It carries no secrets, no tokens and no absolute paths from
the container (paths are project-relative). An environment that should
not commit status just doesn't run `snapshot`.

### 4.4 Security

- Headless mode keeps every Phase 19 rule: token on every transport,
  exact CORS allowlist, Host validation, confined file access.
- The CLI never opens a listening port beyond loopback unless told to
  (option 3), and says so when it does.
- The capability matrix applies unchanged. In particular `terminal`,
  `settings` and `capture` stay off by default; in a cloud container
  `capture` (screen, clipboard, microphone) is meaningless and stays off.

## 5. Steps

| # | Step | Result |
|---|---|---|
| 1 | Headless switches in the backend; `codetrellis serve` | CodeTrellis runs in a container; an agent connects |
| 2 | SessionStart hook recipe and docs | Sessions are observed automatically |
| 3 | `status` and `snapshot` (text/JSON) committed via git | Option 1: the desktop shows what the cloud session did |
| 4 | `snapshot --html` | Option 2: a report for anyone |
| 5 | Security review, then live view through a developer's tunnel | Option 3 |

Steps 1–3 depend on Phase 32 track C2 (status through git), so this
starts after it.

## 6. Open questions

- Package name and distribution (npm, or a single-file binary like the
  connector?).
- Where the data dir lives when the environment has a persistent cache,
  and what happens when two sessions share one.
- Whether the snapshot is one file per session or one rolling file, and
  how merges between sessions behave.
- How a desktop shows "this came from a cloud session" in the timeline.
