# The `codetrellis` CLI in sessions and pipelines

Phase 32 Track D. The CLI runs CodeTrellis without the desktop app, for an
agent in a cloud session or a job in a pipeline. Its verbs are listed in
[`mcp-tools.md`](mcp-tools.md) (D1.1–D1.3); this page is how a session
and a pipeline pick it up (D1.4), with recipes you can copy from
[`docs/recipes/`](../recipes/).

## Installing it

The package is not published to npm. From a checkout of this repository:

```
npm ci && npm link        # puts `codetrellis` on the PATH
```

`bin/codetrellis.mjs` runs `src/cli/main.ts` through tsx, so the checkout
keeps its `node_modules`. Node 26, as `.nvmrc` says.

## Starting and stopping

| Command | What it does |
|---|---|
| `codetrellis start [--quiet \| --json]` | `serve` in the background for the folder, unless one already runs there; returns once the project is scanned. Being up already is success. Its log is `serve.log` in the data dir |
| `codetrellis stop` | Ends it |
| `codetrellis serve` | The same backend in the foreground (D1.1) |
| `--share-task-state` (on `start` or `serve`) | Writes task state and test runs to the project's files and reads teammates', as the app's Settings switch does (D1.5a). Refused for the desktop app's own data dir, whose switch stays the window's |

The data dir is the user's cache, one folder per project
(`~/.cache/codetrellis/<name>-<hash>` on Linux), never the checkout.
Loopback only, the per-launch token on every transport, no discovery, no
peers, no update check. `start` waits for `serve-ready.json`, which
`serve` writes once it has opened and scanned the project, not for the
MCP endpoint, which is published at boot: a gate run on half a graph would
pass on files it had not read yet.

## A session: Claude Code

Two files. Both are opt-in: Claude Code asks each developer before it
runs a project's MCP server, and the hook can live in your own
`.claude/settings.local.json` rather than the team's `.claude/settings.json`.

[`docs/recipes/mcp.json`](../recipes/mcp.json) as `.mcp.json`: the
connector. `codetrellis mcp` finds the headless backend for the folder it
starts in, else the desktop app's, and re-reads the token on every
connect, so the same line works on a laptop with the app open and in a
cloud session with none.

[`docs/recipes/claude-code-settings.json`](../recipes/claude-code-settings.json):
the SessionStart hook.

```json
"command": "codetrellis start --quiet && codetrellis status; exit 0"
```

It starts CodeTrellis once (a second session finds it running) and prints
`status`, which Claude Code adds to the session's context: the agent
begins knowing what is in progress, what is blocked, what waits on the
person, and whether the work so far conforms. `exit 0` because a hook
that exits non-zero has its output dropped, and a session should start
either way.

## A session: other hosts

Any host with a setup script does the same two things:

```sh
codetrellis start --quiet   # in the environment's setup or start script
```

and an MCP server entry of `codetrellis mcp` (stdio) in the agent's own
config: Codex's `config.toml`, Cursor's `mcp.json`, and so on. A host
with no MCP support uses the verbs directly: `codetrellis next`, `claim`,
`update`, `done`, `commit`.

## A pipeline

[`docs/recipes/github-actions.yml`](../recipes/github-actions.yml) is a
complete job:

1. `actions/checkout` with `fetch-depth: 0`, for the merge base and the
   commits system docs were verified at.
2. Your tests, as you run them now, writing JUnit XML. CodeTrellis runs
   no tests.
3. `codetrellis start --quiet`, `codetrellis report-tests <junit.xml>`,
   `codetrellis check`, each `if: always()` so a test failure still
   reaches CodeTrellis.
4. `codetrellis stop`.

The data dir can be cached between runs (`actions/cache` on
`~/.cache/codetrellis`) to make the scan incremental, or rebuilt each
time; nothing in it is needed for the gate to be right.

This repository runs it on every pull request, in the Desktop job of
`.github/workflows/ci.yml`, over its own unit run.

## The gate

`codetrellis check` with no path, and `codetrellis status`, check this
work and exit **3** when it does not conform. "This work" is the branch
since it left its base, plus what is not committed yet. The base is
`--base <ref>`, else the pull request's base in GitHub Actions
(`GITHUB_BASE_REF`), else origin's default branch, else none (only what
is not committed). Files under `.codetrellis/` are left out: the plan
changing is not a change to conform.

Over those files, the `check_changes` tool reports:

| Finding | From |
|---|---|
| ■ A breakpoint a person set covers a changed file | the breakpoints (A8), read only: nothing is held, no decision is raised |
| ✗ A changed file's tests fail, or ⚠ are older than the code | test grounding (B8.2), from the reports handed over |
| ✗ A task marked done has a criterion whose check fails | the criterion checks (Phase 31 §8.1), run without recording |
| ⚠ A system doc that describes a changed file was verified before it changed | the doc's stamp and `git diff <stamp>` over the working tree |

What a runner can and cannot see: plans, task records, criteria and system
docs arrive with the checkout; test results arrive with the report the job
hands over. **Breakpoints do not**: they are a person's, set in their own
app, and live in that machine's database. So the breakpoint gate holds on
a laptop (a pre-push hook with the app open, where `check` talks to the
app) and finds none in CI. That is deliberate: a breakpoint is "ask me
first", and nobody can be asked from a runner.

## Test runs that travel (D1.5a)

With task state shared, each new run reported (`report-tests`) is also
written to `.codetrellis/runs/<writer>-<counter>.yaml`: by test file, the
counts and the failing tests with why, the commit it ran on, and the files
that differed from that commit then. A device keeps only its latest; its
older files are removed when it writes a new one. `codetrellis commit`
commits it with the plan's files.

A teammate's run, read after a pull, grounds a file on this machine by
commit: its tests are older than the code when the file or its test changed
since that commit, or differed from it when the tests ran. Not by the
file's time: a pull rewrites the files it brings. For each test file the
newest run counts, this machine's or a teammate's; the Inspector names
whose ("✓ 2 tests passing, in ci for Build bot's run at b7e41c0,
unverified"), and Settings → Shared task state lists them.

So a pipeline that should report back to the person's desktop runs
`codetrellis start --share-task-state`, reports, and commits and pushes the
run with `codetrellis commit`. One that only gates needs neither.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done; conforms |
| 1 | Refused (a tool said no, or CodeTrellis is not running) |
| 2 | Usage (a bad flag, a `--base` that is not a commit) |
| 3 | Held (`check <path>`), not answered yet (`request`), or does not conform (`check`, `status`) |
