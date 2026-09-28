# Parallel awareness

How CodeTrellis notices that parallel lines of work (worktrees, branches,
clones, each with its agents) are about to collide, and tells the person
and the agents in few words. Built in Phase 32 Track A. The design is
[`docs/PHASE-32-PARALLEL-AWARENESS.md`](../PHASE-32-PARALLEL-AWARENESS.md);
this is the map of what exists, for people working on CodeTrellis itself.

## The pipeline

```
worktrees / branches / clones        agents (MCP sessions, Claude Code logs)
        │                                     │
        ▼                                     ▼
  workstreams  ◄──── bound by folder ──── sessions + declared intent
        │
        ▼  per workstream: changed files, symbols, signatures, scope
  footprints
        │
        ▼  pure
  computeSignals ──► reconcileSignals ──► awareness_signals (rows)
                                               │
                   ┌───────────────────────────┼──────────────────────────┐
                   ▼                           ▼                          ▼
          Awareness tab / strip          get_awareness,             inline notices
          (digest, answers)              check_footprint            (next tool result)
                                                                    + the PreToolUse hook
```

## Workstreams

A workstream is one line of work in the opened repository. They are
**derived, never created**.

- **Worktrees**: `git worktree list`, the main checkout included
  (`worktree-service.ts`, `workstream-service.ts`).
- **Branches** with no checkout here, ahead of main, changed within
  `sensors.awareness.branchWindowDays` (default 7), and not already merged
  by content, so a squash merge counts (`branch-workstreams.ts`, bug 53).
  Only local refs are read, never fetched.
- **Clones**: a folder an agent reports that no trusted root covers becomes
  a *folder request*. The person includes it or dismisses it
  (`folder-requests.ts`, `trusted-roots.ts`). Nothing is read from it
  before then.
- **Who is in each**: MCP sessions are bound by the folder the connector
  or an MCP root reports, matched only against roots already trusted
  (`workstream-binding.ts`, A1.1). Claude Code sessions are followed
  through their own logs (`agent/claude-code-watcher.ts`, A1.2). Two or
  more agents in one folder make it `shared`, which the UI names.

`list_workstreams` (MCP), `GET /api/workstreams` and the TopBar
`WorkstreamStrip` all read `listWorkstreams`.

## Footprints

What each workstream is changing, kept current without rebuilding the
graph.

- **Changed files**: git, from the merge base with main, plus uncommitted
  and untracked work. Each folder has one light chokidar watcher and a
  debounced recompute (`workstream-watch-service.ts`; the debounce is
  `CODETRELLIS_WORKSTREAM_DEBOUNCE_MS` in tests).
- **Symbols**: only the changed files are parsed, current vs merge base,
  giving added / removed / modified (`workstream-symbols.ts`, A1.5).
- **Signatures and exports**: TS/JS and Python (A2.1). `SymbolChange.exported`
  follows `export`, or for Python no leading underscore or `__all__`.
- **Importers**: through barrels (`export … from`), with the names imported
  (`importers.ts`, A2.2).
- **Declared intent**: what an agent says it is about to change, per MCP
  session, in memory, gone with the session (`intent-service.ts`,
  `declare_intent`, A2.4).
- **Scope**: the files and folders of the plan items the workstream's
  agents claimed (`file_specs`, `scope_path`), plus intent (A2.5).

## Signals

`awareness-signals.ts` is pure: footprints in, signals out. Each has
a kind, a severity, a subject, the workstreams it names, and a summary
written by CodeTrellis.

| Kind | When | Severity |
|---|---|---|
| `collision` | Two workstreams change the same file (declared intent counts) | high on the same symbol, else medium |
| `contract` | An exported signature changed or an export was removed, and the other side's changed files import it | high; medium for a namespace import only |
| `drift` | Changes outside the workstream's scope | medium |
| `stale-base` | Main changed files this workstream changes, since it branched | low |

**Staying quiet** (spec §4.4):
- The id is derived from kind, subject and workstreams, so a signal that
  keeps firing is one row, updated.
- A signal whose cause went away is resolved.
- Each signal has a **shape**: what it is about, for example each side's
  names in the file plus any new signature. An `acknowledged` or `intended`
  answer holds while the shape holds. When the shape changes, the signal
  reopens with `reopened: { from, at }` and the agents are told again
  (A3.2). `dismissed` stays dismissed.

`awareness-service.ts` gathers the inputs, runs `computeSignals`, and
reconciles into `awareness_signals`. The person's answer and the agents'
notes are stored separately (`awareness_signal_notes`). It broadcasts
`awareness-changed`. The server refreshes signals 500 ms after a watcher
event, for the active project.

## Telling people and agents

- **The digest** (`src/shared/lib/awareness-digest.ts`, A3.1) is pure. It
  lists only open high and medium signals, grouped by kind and workstreams,
  so two worktrees overlapping in four places is one line. Each line says
  what changed, who is affected, whether the agents were told, and what the
  person is asked. It is capped at five lines, then "and N more", and low
  signals are counted rather than listed. The Awareness tab shows it, and
  `get_awareness` returns the same words as `digest`.
- **The Awareness tab** (`components/layout/AwarenessTab.tsx`, in
  `PlanPanel`) shows the digest, then the cards: "Needs you" first, then
  the person's answers (acknowledged / intended / dismissed). It also shows
  which agents were told and what they said, and why a reopened signal is
  back. Its store is `awareness-store.ts`.
- **Agents, asked**: `get_awareness` (the digest plus the signals affecting
  the caller's workstream) and `check_footprint(paths, symbols?)` (who else
  changed these files, and what imports them). The tools are in
  `mcp/tools/awareness-tools.ts`.
- **Agents, not asked** (`awareness-notices.ts`, A2.6): an unseen high or
  medium signal for the caller's workstream is appended once to its next
  tool result as a "── CodeTrellis awareness ──" block. This happens at the
  one interception in `mcp/server.ts`, and
  `sensors.awareness.inlineNotices: false` turns it off.
  `acknowledge_signal(id, note?)` records the agent's note, which never
  sets the person's answer.
- **The guide**: `get_app_guide(flavor='parallel')` /
  `codetrellis://skill/parallel` (A3.3) is the contract an agent follows:
  awareness, then intent, then footprint, then fix or ask.
- **Claude Code extras**, offered from Settings and written only on a click
  (A3.4, `services/claude-code-parallel.ts`, IPC only):
  - the `codetrellis-parallel` skill, generated from the guide;
  - an optional `PreToolUse` hook: the connector's `--hook pre-tool-use`
    mode (`mcp/connector/hook.ts`). Before an edit, it runs `check_footprint`
    for the file and returns `additionalContext`. It never blocks or approves
    an edit, and it fails open and silent.

## Rules to keep

- **An agent is never handed another agent's text** (principle 5).
  Notices, the digest and the hook describe changes from git and the
  parser. Intent summaries are shown to the person and to their author,
  never to other agents.
- **Roots never come from a request.** Folders an agent reports only choose
  among trusted roots, and a clone needs the person's consent.
- **Only the person answers a signal.** An agent's note sits beside the
  answer.
- **Nothing is installed silently.** The skill and the hook follow Add to
  Claude Desktop: a diff first, then only what was ticked, from the app
  window only.

## Tests worth knowing

- Unit:
  - `awareness-signals.test.ts` (the rules);
  - `awareness-digest.test.ts`;
  - `awareness-notices.test.ts`;
  - `workstream-*.test.ts`;
  - `claude-code-parallel.test.ts`;
  - `connector/hook.test.ts`.
- Harness, all on real worktrees:
  - `awareness` (M1: collisions and stale base), `awareness-answers`;
  - `awareness-contract`, `awareness-drift`, `declare-intent`;
  - `awareness-notices`, the M2 "done when";
  - `awareness-cooldown`;
  - `parallel-hook`;
  - `awareness-m3`, the M3 "done when": five workstreams, seven overlaps,
    a five-line digest well under a minute to read, and intended staying
    quiet until a side changes shape.
- Browser: `e2e/agent/awareness-tab.spec.ts`, `e2e/agent/workstream-strip.spec.ts`,
  `e2e/settings/mcp-server.spec.ts`.
