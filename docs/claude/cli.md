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
"command": "codetrellis start --share-task-state --quiet && codetrellis status; exit 0"
```

It starts CodeTrellis once (a second session finds it running), sharing
task state so that what the agent claims, reports and runs reaches the
person's desktop when the session pushes (a cloud session's container
goes, and its database with it; drop the flag to keep it there), and prints
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
`.github/workflows/ci.yml`, over its own unit run, and uploads the SARIF.

### Any other host (Phase 33 C2)

No CI host comes first. `codetrellis check --format sarif` writes SARIF
2.1.0 (validated against the schema in `tools/sarif/`): each finding at the
line it is about where there is one (a rule's breach at its import), an
error at `block`, a warning at `warn`, an approved loosening a note.
GitHub code scanning, GitLab, Azure DevOps and Jenkins's Warnings NG read it.

[`docs/recipes/check.sh`](../recipes/check.sh) is the whole job as a plain
shell script any runner can call: it installs CodeTrellis if it is not
there, starts it, hands it the JUnit report, writes the SARIF, prints the
words and exits 0, or 3 when the change does not conform. It reads the base
from each host's own variable. The other recipes only call it:
[GitLab CI](../recipes/gitlab-ci.yml),
[Azure Pipelines](../recipes/azure-pipelines.yml),
[Bitbucket Pipelines](../recipes/bitbucket-pipelines.yml) and
[Jenkins](../recipes/Jenkinsfile).

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
| ✗ A changed file adds an import an architecture rule forbids | the team's rules in `.codetrellis/rules/<suite>.yaml` (A7; Phase 33 R1 moved them out of `.codetrellis/config.json`, where any still there count until a person moves them), each changed file's imports now against the branch's merge base, which the CLI passes as `base`; an import already there before the branch is the rule's to list, not this change's |

### Part of the rulebook (Phase 33 C1)

```
codetrellis check --suite payments          # one suite's rules
codetrellis check --rule stripe-via-wrapper # named rules
codetrellis check --path src/payments/      # the rules about a path
```

Each takes a comma-separated list, and scopes given together all apply. A
scoped check judges only those rules (the imports the change adds across
them, and what it does to them), not breakpoints, tests, tasks or docs, and
says what it checked: `Conforms to suite payments: …`. The same scopes are
`suite`, `rule` and `path` on `check_changes` and `check_conformity`, and on
`GET /api/rules`.

### How hard a rule holds (Phase 33 R4)

Every rule has a `strength`:

| Strength | In the check | To agents | Signal |
|---|---|---|---|
| ■ `block` | ✗ fails it, exit 3 | told on their next call | high |
| ⚠ `warn` | said in the notes; exit 0 | told | medium |
| ○ `guide` | not checked | shown when their work touches it | none |

`--strict` (`codetrellis check --strict`, `status --strict`, or `strict`
on `check_changes`) makes a rule at warn fail the check like one at block.

**A new rule starts at warn**: a blocking rule with false positives costs
more trust than it earns, so a team raises it to block once it is clean. A
rule written before strength existed has none, and reads as `block`, which
is what every rule did then; no existing rule gets weaker without a person
saying so. Lowering a rule's strength is loosening it (R2): from block to
warn, the imports that break it would no longer fail CI, and the check says
so until a person approves it.

### A loosening carries a person's approval (Phase 33 R3)

The check judges a branch by its base's rules (R2), so removing a rule, or
lowering its strength, does not let the branch's own imports through: the
change to the rulebook is its own finding, and a loosening fails it.

It passes only with a person's approval, made in the app. Changing a rule
there shows first what the change does against the code (what becomes
allowed, what becomes forbidden, what breaks it today); a loosening then
waits for the person to confirm it. Confirmed, it is signed with their key
(git's SSH key when git signing uses one, namespace
`codetrellis-rule-change`; else their device key) and written beside the
suites as `.codetrellis/rules/approvals/<rule>-<hash>.yaml`, to commit with
the change.

The check accepts an approval only when:

- it is for exactly this change: the same rule, the base's terms before,
  the branch's after (paths, exceptions and strength);
- it was made on or after the merge base, so an old approval cannot be
  carried into a new change;
- it verifies against keys **on the base**: git's allowed signers as the
  base has them (when that file is in the repository), or a device key
  introduced under `.codetrellis/keys/` on the base. A pull request cannot
  add a key and use it in the same change.

An approved loosening is said as a note (`✓ … Sam approved it in the app,
signed`) and passes; one whose approval does not count says why. No agent
can change a rule through CodeTrellis: `propose_rule` keeps what it wants,
with why, for a person to accept or reject in the app, and accepting is the
person's change, confirmed and signed like any other. One that edits the
files directly is caught by the same check.

What a runner can and cannot see: plans, task records, criteria and system
docs arrive with the checkout; test results arrive with the report the job
hands over. **Breakpoints do not**: they are a person's, set in their own
app, and live in that machine's database. So the breakpoint gate holds on
a laptop (a pre-push hook with the app open, where `check` talks to the
app) and finds none in CI. That is deliberate: a breakpoint is "ask me
first", and nobody can be asked from a runner.

Rules, unlike breakpoints, **do** travel: they are committed. Checking them
needs the project's imports resolved, which `serve` does when it scans the
checkout; if they cannot be read (another project is loaded), the answer
says the rules were not checked rather than passing them silently.

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
| 3 | Held (`check <path>`), not answered yet (`request`), or does not conform (`check`, `status`); a rule's breach makes it 3 only at `block`, or at `warn` with `--strict` |
