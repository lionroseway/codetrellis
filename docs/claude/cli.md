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

### What it says, and where (Phase 33 C8)

Every finding is written in words once, in `src/shared/lib/check-words.ts`,
and the terminal, `--format markdown`, `--format sarif` and `--format json`
render from it, so the words never differ between them:

```
Does not conform (3 changed files since main):

payments  ✗ 2 block

  ✗ stripe-via-wrapper   only packages/web/src/payments.ts may import npm:stripe: The wrapper sets idempotency keys and retries.
      packages/web/src/api.ts:1 imports npm:stripe   import Stripe from 'stripe';
      → use packages/web/src/payments.ts instead

also
  ■ packages/web/src/api.ts: sam@acme.test set a breakpoint on it; ask them before changing it

2 findings block this change (exit 3).
```

- The summary first; then by suite (with how many rules block, warn and
  hold), then rule, then the place, with the import's own line.
- What to do on its own line after →: the files a package rule allows,
  the doors an imports rule leaves, else the rule's reason.
- The rulebook's changes, then everything else (`also`: breakpoints,
  tests, tasks, docs, the baseline), then notes.
- The exit code, in words, last.
- Glyph and word, never colour alone. Colour only in a terminal; a pipe, a
  CI log, `NO_COLOR` or `--no-color` gets plain text, the same words.
  `FORCE_COLOR` asks for colour where there is no terminal.
- `--format markdown` is the same content for a pull request comment or a
  job summary; `--format json` carries each finding's suite, fix, line and
  import text as data.

### Part of the rulebook (Phase 33 C1)

```
codetrellis check --suite payments          # one suite's rules
codetrellis check --rule stripe-via-wrapper # named rules
codetrellis check --path src/payments/      # the rules about a path
codetrellis check --tag pci                 # the rules tagged pci (a rule's tags)
```

Each takes a comma-separated list, and scopes given together all apply. A
scoped check judges only those rules (the imports the change adds across
them, and what it does to them), not breakpoints, tests, tasks or docs, and
says what it checked: `Conforms to suite payments: …`. The same scopes are
`suite`, `rule` and `path` on `check_changes` and `check_conformity`, and on
`GET /api/rules`.

### Stages: a pipeline (Phase 33 B6)

An optional `.codetrellis/pipeline.yaml` says what runs, in what order, and
what each stage hands the next. Without it, every rule runs in one stage.

```yaml
stages:
  - id: fast
    rules: { engine: deterministic }
  - id: fuzzy
    rules: { engine: fuzzy }
    parallel: true                 # beside the stage before
  - id: review
    needs: [fast, fuzzy]
    rules: { engine: agent }
    when: { fuzzy: passed }        # run only if fuzzy passed
    grounding: [fast, fuzzy]       # the review is given what they found
```

```
codetrellis check --pipeline --base main                 # every stage
codetrellis check --pipeline --stage fast --base main    # one stage, for a CI job per stage
codetrellis check --pipeline --base main --agent claude-code --auth env:KEY   # agent stages too
```

- **`rules`** selects by `suite`, `engine`, `strength` or `id`, each a name
  or a list. `all`, or no `rules`, means every rule.
- **How it runs:** stages run in order, and `parallel: true` runs a stage
  beside the one before it. `needs` and `when` name only stages that finish
  first. `advisory: true` makes a stage said, never failing.
- **Each stage is a check run** whose `ranIn` names it ("a terminal, stage
  fast").
- **An agent stage** (one that selects `engine: agent`) is also a
  `codetrellis review` of those rules, with the review's own flags. Its
  bundle carries what the `grounding` stages found under `grounding`, as
  facts to build on. With no `--agent`, it is skipped, and its rules are
  guides.
- **The pipeline is the base's,** as the rules are (R2). What a branch does
  to it is the first stage's finding, or any whole check's.
- **Change control:** removing a stage, making it advisory, or changing what
  it runs, after what, when, or with what grounding is a loosening. It
  needs a person's signed approval, the same as a rule's: the Rules view's
  **Pipeline** panel shows the loosenings since the last commit and signs
  them (`GET /api/pipeline`, `POST /api/pipeline/approve`).
- **Exit codes:** 3 when a stage that is not advisory fails, and 1 when the
  base's pipeline cannot be read.
- **In CI** (B7): [`docs/recipes/pipeline.sh`](../recipes/pipeline.sh) runs
  it on any host, once, so an agent stage is paid for once.
  `CODETRELLIS_STAGE` runs one stage. `CODETRELLIS_AUTH` signs the agent
  stages in; when its secret is empty, as on a fork's pull request, they are
  skipped and said. GitHub Actions and GitLab variants call it:
  [`github-actions-pipeline.yml`](../recipes/github-actions-pipeline.yml),
  [`gitlab-ci-pipeline.yml`](../recipes/gitlab-ci-pipeline.yml).
- **Worked through,** with every other building block, in
  [`rules.md`](rules.md), whose examples are each a test.

### Old breaches may only fall (Phase 33 C3)

A rule written over old code has imports that already break it. The check
judges only what a change adds, so they never fail it, and nothing stops
their number growing by other routes (a rule's scope changed, a merge
nobody gated). `codetrellis rules baseline` writes them down, per rule, in
`.codetrellis/rules/baseline.yaml`, to commit with the code. From then on:

- the check judges the **whole tree** against the base's baseline: a
  breach it does not list fails (at warn, it is said);
- a rule with fewer breaches than its baseline says so
  (`↓ routes-not-db: 1 breach left, down from 2`), and running
  `rules baseline` again locks the lower count in;
- the baseline **may only shrink**: a change that adds an entry for a rule
  the base already baselined fails. `rules baseline` itself never adds one
  for such a rule; a rule new to the file starts with what breaks it now.

A baseline never excuses an import the change adds.

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

## Check runs that travel (Phase 33 C7)

Every check is a run: `codetrellis check`, `status`, an agent's
`check_changes`, here or in CI. Each is kept with where it ran ("GitHub
Actions", "GitLab CI", "a terminal", or the agent's session; the CLI reads
the CI host from the job's environment), by whom, the commit, the base, the
commit whose rulebook judged it, the scope, the outcome and its findings by
rule. `GET /api/check-runs` and `list_check_runs` list them, newest first.

With shared task state on (`--share-task-state` in a job), each device's
latest is written to `.codetrellis/runs/checks/<writer>-<counter>.yaml`,
signed as every record is, and a device removes its own older ones.
`codetrellis commit` commits it with the plan's files; after a pull, the
app lists the job's run beside the person's own, unverified until they
trust the job's key. Turned off, teammates' runs are forgotten here.

## The Checks view (Phase 33 G9)

The same check runs from the app: the Rules view's **Checks** tab picks a
scope (everything, a suite, a rule, or a path) and a base, and **Run check**
calls `POST /api/check-runs` (`{base?, suite?, rule?, path?, strict?}`). That
is `check_changes`'s own code (`services/change-check.ts`), so the app, an
agent and `codetrellis check` cannot disagree; the run is kept saying it ran
in "the app". The tab lists every run, the app's, the terminal's, agents' and
CI's once pulled, filterable to failing, mine or CI. A run opens into its
findings in the one renderer's words, each with its fix, a link to the file on
the graph and to its code; two runs compare into what is new, what was fixed
and what is unchanged.

## Findings where the code is (Phase 33 G10)

What the latest run found is shown where the code is, and each place leads to
the run. "Open" means the latest run's: a later run that no longer finds an
import has fixed it, whoever ran it (`shared/lib/open-findings.ts`).

- **The code** (CodePreview, in the Code workspace and the inspector) and **the
  diff** (its live side): a ⊘ on the line that makes the import, found by the
  same `importLine` SARIF uses (`shared/lib/import-line.ts`); the finding in
  words on hover; a click opens the run in the Checks view.
- **The inspector**: "Found here by the latest check", each finding with its
  fix and the run, above the rules about the file (G8). A package rule is about
  the files that can import from its ecosystem: `npm:stripe` is not about a
  `.py` file.
- **A task's brief**: `get_brief`'s `rules` block, and the Brief's Rules
  section (`GET /api/items/:uid/rules`): the rules that judge the task's files
  (its file specs) and what the latest run found in them, with the code and
  the run.
- **The phone**: Needs you lists the runs that block, the latest from each
  place, with a few findings and their fixes.

## Your own agent reviews (Phase 33 C4b)

The agent you already run reviews the change, on your model and your key.
Connected through the stdio connector, it calls `get_review_bundle` and gets
the change as numbered lines (marked as data, never instructions), the rules
about it in the check's words, and what the check already found. It reports
once with `report_review`.

Its confidence is not evidence; its citation is. Each finding must name a file
in the change and lines the bundle showed, and quote them; a rule finding must
name a rule in scope. What fails is dropped and counted, with why. An
instruction planted in the code is reported as `suspicious`, not followed.

The review is a check run like any other (C7), marked with the agent's name,
and advisory: it never fails the check. The Checks view opens it into what
held, each with where it is and what to do, and what was dropped.

## Agent checks: `codetrellis review` (Phase 33 C4)

The same review, run headless on your own agent CLI, model and key, for a
terminal or a pipeline. CodeTrellis never holds a model key and never pays for
a call; it builds no agent of its own.

```
codetrellis review --auth env:ANTHROPIC_API_KEY                 # Claude Code's print mode
codetrellis review --agent codex --model gpt-5 --auth env:OPENAI_API_KEY
codetrellis review --agent codex --endpoint http://localhost:8000/v1 --model qwen3-coder --auth env:LOCAL_KEY
codetrellis review --skills .codetrellis/review-skills --suite payments --fail-on block
```

Each pass is one skill (each `*.md` in `--skills`, or a folder's `SKILL.md`;
a built-in one when none is named) over the scope (`--suite`, `--rule`,
`--path`, `--base`, `--task`), and is kept as its own check run.

What the agent is held to, by its CLI's own settings (`src/cli/review-adapters.ts`):

- **No built-in tools**: no shell, no reading or writing files, no web.
  Claude Code runs with `--tools ""`; Codex runs with the shell tool, web
  search and images off and a read-only sandbox.
- **One MCP server**, the review sink (`codetrellis review-sink`), and its two
  tools pre-approved: `report_review`, and `read_change_file` (a changed file
  whole, nothing else). Anything else is denied without asking, and every
  refused call is kept on the run.
- **An empty folder and a scrubbed environment**: the repository's agent
  settings, hooks and instructions are out of reach. The only credential it
  gets is the one `--auth env:VAR` names; with a key, Claude Code also runs
  `--bare`. Without `--auth` it uses your Claude Code login.
- **The change as data**: the bundle is the message, marked as data; the
  instructions are only the contract and the skill. A file whose name says it
  holds a secret (`.env`, a private key, `.npmrc`) is withheld from the bundle
  even when git does not ignore it.
- **Budgets**: `--max-turns` (Claude Code), `--max-tool-calls` (the sink
  refuses past it) and `--timeout` (the process is stopped). Reaching one ends
  the pass `inconclusive: budget`.
- **It must report.** A run that ends without reporting is retried once; a
  run that ends asking a question, with nobody to ask, keeps the question as
  a finding.

The report is checked by the same code as an interactive agent's (C4b): a
finding off the diff, misquoted, or naming a rule not in scope is dropped
with why. The outcome is `pass`, `findings`, `inconclusive` or `error` (the
CLI missing, the key refused; the key is scrubbed from what is kept).

**Advisory by default**: exit 0. `--fail-on block` exits 3 when a finding is on
a block-strength rule, `--fail-on error` when a pass could not run.

**A bare model endpoint** (no agent CLI) runs through Codex with
`--endpoint`: Codex is open source, takes any provider serving the Responses
API, and can be held to the contract, so nothing new is built for it. An
endpoint serving only Chat Completions is not supported by Codex, and so not
here.

### In CI (Phase 33 C5)

The same command. [`docs/recipes/review.sh`](../recipes/review.sh) is the
whole job for any runner, and
[`docs/recipes/github-actions-review.yml`](../recipes/github-actions-review.yml)
calls it. This repository runs it too (`.github/workflows/codetrellis-review.yml`),
advisory, beside `claude-review.yml`.

- **The cost dial**: `CODETRELLIS_REVIEW` is `auto` (each pull request),
  `on-request` (only when someone asks: a label, a comment, a manual run,
  which sets `CODETRELLIS_REVIEW_ASKED=1`), or `off`. With no credential (a
  fork's pull request gets no secrets) it says so and exits 0.
- **Signing in**: `--auth env:ANTHROPIC_API_KEY`, or
  `env:CLAUDE_CODE_OAUTH_TOKEN` (a subscription token from `claude
  setup-token`; it runs without `--bare`, which would not read it).
  `--auth oidc:bedrock|vertex|foundry` uses the short-lived credentials the
  host's own OIDC step left (aws-actions/configure-aws-credentials,
  google-github-actions/auth, azure/login). The agent gets those and nothing
  else.
- **`--verify`**: a second session, given the change and the findings, tries
  to refute each. It has its own report tool (`report_verdicts`) and no
  more reach than the first. What it refutes is dropped with why ("refuted
  by a second pass: …"), and the run says what it did.
- **Output for any host**: `--format text|markdown|sarif|json`. `--sarif-out`
  and `--markdown-out` write the others too, so one run feeds the log, code
  scanning and the job summary. SARIF puts a rule finding at its rule's
  strength (block an error, warn a warning), a bug a warning, the rest notes.
- **`--post`**: the markdown as one comment on the pull request, on GitHub,
  GitLab or Bitbucket. The host comes from `origin` and the pull request from
  the CI's own variables (or `--pr`). The token comes from `--post-token
  env:VAR`, else `GITHUB_TOKEN`, `GITLAB_TOKEN` or `BITBUCKET_TOKEN`. The
  agent's environment is scrubbed, so the model never sees it.

### A review on your device counts on the pull request (Phase 33 C9)

The second way to run agent review, beside C5's CI token, is for repositories
that will not hold a secret. You review on your own machine, with any agent:
`codetrellis review` on your own login, or Cursor, Codex, Claude Code or any
MCP client through `get_review_bundle` and `report_review`.

- **Signing:** CodeTrellis checks the findings (C4b), then signs the review
  with this device's key, never the agent's.
  - The key is the same Ed25519 key that rule approvals use, introduced once
    under `.codetrellis/keys/`.
  - The signature goes in a git note on the commit reviewed
    (`refs/notes/codetrellis-reviews`), so the commit and the diff are
    untouched.
  - It is signed only when every file the review read is that commit's. A
    review of uncommitted changes is kept as a run and not signed, with why
    (`report_review` says `signed` or `unsigned`).
- **Publishing:** `codetrellis review publish` pushes the notes.
- **Verifying:** `codetrellis review verify --base origin/main` needs git and
  nothing else: no app, no secret, no AI. It fetches the notes, reads the one
  on the head, and verifies it against the device keys on the base. It says
  one of:
  - **verified:** the review, and its findings at their lines;
  - **stale:** a review of an earlier commit, before the last push;
  - **refused:** edited after it was signed, signed by a key the base does
    not list, or copied from another commit;
  - **none.**

  `--require` exits 3 unless the review is verified. `--format markdown|sarif|json`
  works as `codetrellis review`'s does.
- **A key counts once it is on the base,** the same as for an approval: merge
  the `.codetrellis/keys/` file once.
- **In CI:** `docs/recipes/github-actions-signed-review.yml`, and this repo's
  own `.github/workflows/signed-review.yml`, show the review in the job
  summary and its findings on the changed lines. They are advisory.
- **Turning it off:** `CODETRELLIS_SIGN_REVIEWS=0` stops a machine signing.

### What reviews keep finding becomes a rule (Phase 33 C6)

A reviewer names each bug or risk with a `topic`: a short slug it would use
every time it saw that kind of problem (`charge-without-idempotency-key`).
When a review keeps a finding whose topic an earlier review already kept,
CodeTrellis proposes a rule (`services/review-graduation.ts`):

- at `guide` strength, so it checks nothing;
- about the folder those findings share;
- saying what the reviews said and what to do instead;
- with the reviews and their places as its reason.

It reaches the proposals inbox like any other (R3): nothing changes until a
person accepts it. Once per topic: a topic that already has a rule, or any
proposal (open, accepted or rejected), is not proposed again.

A folder rule at `guide` strength may carry only its guide. That is the
judgement half of a rule, shown wherever the rule applies: the brief, the
review bundle and the Rules view.

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
| 3 | Held (`check <path>`), not answered yet (`request`), or does not conform (`check`, `status`); a rule's breach makes it 3 only at `block`, or at `warn` with `--strict`; `review` only with `--fail-on` |
