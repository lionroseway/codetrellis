# Rules and checks

Phase 33. A team writes down how its code is meant to be put together, and a
check holds every change to it: on a laptop, in an agent's session, and in any
CI. Changing a rule is a person's decision. An agent can review the change too,
on the team's own model and key, under a contract that code enforces.

The design is in [`docs/phase-33/RULES-AND-CLARITY.md`](../phase-33/RULES-AND-CLARITY.md),
[`docs/phase-33/AGENT-CHECKS-AND-REVIEW.md`](../phase-33/AGENT-CHECKS-AND-REVIEW.md)
and [`docs/phase-33/BUILDING-BLOCKS.md`](../phase-33/BUILDING-BLOCKS.md).
The commands, step by step, are in [`cli.md`](cli.md), and the tools are in
[`mcp-tools.md`](mcp-tools.md). The [Building blocks](#building-blocks) below
are worked through one example at a time, and each example is a test.

## The rulebook

Rules live in the repository, one YAML file per suite, committed with the code:
`.codetrellis/rules/<suite>.yaml` (R1). A suite is named by its file, and its
comments survive a rewrite, so a team can say who owns it. The Rules view in
the app writes the same files, and shows each rule with what breaks it today.

```yaml
# Owned by the payments team; see CODEOWNERS.
suite: payments
because: Money moves through one place.
rules:
  - id: stripe-via-wrapper
    kind: package
    package: npm:stripe
    only: [packages/web/src/payments.ts]
    strength: block
    because: The wrapper sets idempotency keys and retries.
```

What a rule can say:

| Kind | Says | Since |
|---|---|---|
| `imports` (the default) | `from` may not import `mayNotImport`, `except` some files | A7, R1 |
| `package` | only `only` may import an outside package (`npm:stripe`, `pypi:requests`) | R5 |
| `symbol` | only `only` may import one export (`src/payments/charge.ts#createCharge`), through barrels too | R6 |
| `calls` | only `only` may make a call: `http:api.stripe.com/v1`, `sql:invoices`, run a command (`exec:git`), read an environment variable (`env:STRIPE_SECRET_KEY`), or a kind of your own (`queue:orders.*`) | R7, B4 |
| `folder` | what the files in a folder are: named to `files`, of `kinds`, `exports: one`, with a `guide` | R8 |
| `grep` | the files `in` a scope must, or must not, hold a line | B2 |
| `engine: agent` | its words, judged by an agent review of the files `in` its scope | B5 |

A target can say how it matches: `glob`, `regex` or `fuzzy` with a
`threshold` (B1, B3). What counts as a call can be widened with your own
patterns in `.codetrellis/patterns/` (B4). Each is worked through below.

Paths (`from`, `only`, `except`, `in`) are written three ways:
- `web/` is a folder and everything under it.
- `db/types.ts` is that file, or that folder if the path goes on under it.
- A glob uses `*` for any run within a name and `**` for any run across
  folders.

A `**` that is a whole folder name matches any number of folders, none
included, as `.gitignore` reads it. So `src/**/*.ts` holds `src/server.ts` as
well as `src/a/b.ts`, and `**/*.test.ts` holds a test at the root. Before the
Phase 33 follow-up it needed at least one folder. This repository's own rules
were measured, and none of their findings changed.

Every rule has an **engine**, which follows from the rule: `deterministic`
(code over the graph and the text), `fuzzy` (a `match: fuzzy` target), or
`agent`. How hard each holds is its **strength** (R4):

- `block`: fails the check, or, for an agent rule, the review's run.
- `warn`: said, and passes; `--strict` makes it fail. A new rule starts here.
- `guide`: checks nothing. It is shown wherever work touches it: in an
  agent's brief, the awareness digest, the review bundle and the Rules view
  (R9). A `folder` rule at `guide` may carry only its guide (C6). An agent
  rule with no review configured is a guide too.

`.codetrellis/rules/baseline.yaml` holds the breaches each rule already had
when it was written. A rule's count of old breaches may only fall (C3).

## Change control

Rules change only through a person (R2, R3):

- **Agents propose.** No tool writes a rule. `propose_rule` keeps what an
  agent wants, with why, for a person to accept or reject in the app.
  Graduated findings arrive the same way (C6).
- **Every change is previewed** against the code before it is made: what
  becomes allowed, what becomes forbidden, and what breaks it today.
- **A loosening is confirmed, then signed** with the person's key, beside
  the suites (`.codetrellis/rules/approvals/`). A loosening is any of these:
  - a rule removed;
  - its scope narrowed;
  - an exception added;
  - its strength lowered;
  - a fuzzy threshold raised;
  - an agent rule's words changed.
- **The pipeline is held as the rules are** (B6). Removing a stage, making
  it advisory, or changing what it runs is a loosening, signed in the Rules
  view's Pipeline panel.
- **The check judges a branch by its base's rules.** A loosening passes only
  with an approval that verifies against keys already on the base. So a pull
  request cannot add a key and use it in the same change. An edit made
  straight to the files is caught by the same check.

## Checks anywhere

The same check runs in every place, through one piece of code (`check_changes`):

- **A session**: `codetrellis check`, or the `check_changes` tool. The
  SessionStart hook starts CodeTrellis for the folder (`cli.md`).
- **The app**: the Rules view's Checks tab, beside the rules (G7, G9).
- **Any CI**: `docs/recipes/check.sh` is the whole job. The GitLab, Azure,
  Bitbucket and Jenkins recipes call it (C2), and `github-actions.yml` runs the
  same steps. `pipeline.sh` runs the pipeline instead (B7).

Every check can be narrowed by `--suite`, `--rule` or `--path`, alone or
together (C1). `check_changes` and a pipeline stage can also select rules by
engine or strength. With `.codetrellis/pipeline.yaml`, `--pipeline` runs the
rules in stages. Each
rule and finding is written in words once (`shared/lib/check-words.ts`).
The terminal, markdown, SARIF 2.1.0 and JSON render from those words, and so
do the app and the phone (C8).

Every check is a **check run** (C7): where it ran, by whom, the commit and
base, the scope and what it found. With task state shared, runs travel with
the repository (`.codetrellis/runs/checks/`), so CI's run shows in a
teammate's app after a pull.

The latest run's findings are shown where the code is (G10):

- the code view's gutter and the diff;
- the inspector;
- a task's brief;
- the phone's Needs you.

## Agent checks

An agent reviews the change, on the team's own agent, model and key.
CodeTrellis builds no agent and holds no model key. It supplies the bundle,
the contract and the verification.

- **The bundle** (`services/review-bundle.ts`) holds:
  - the change, as numbered lines marked as data, never instructions;
  - the rules about the changed files, in the check's words, agent rules
    among them;
  - what the check already found, and what earlier pipeline stages found
    (`grounding`);
  - the task's criteria, when a task is named.

  Files whose names say they hold secrets (`.env`, private keys, `.npmrc`)
  are withheld from it.
- **Grounding is checked by code** (`shared/lib/agent-review.ts`).
  - Each finding must name a file in the change and lines the bundle
    showed, and quote them.
  - A rule finding must name a rule in scope.
  - What fails is dropped and counted, with why.
  - An instruction found in the change is reported as `suspicious`, not
    followed.
- **The outcome** is one of `pass`, `findings`, `inconclusive` or `error`.
  It is advisory, unless `--fail-on` asks otherwise or a finding citing a
  block-strength agent rule holds.

Four ways in:

- **Your own agent, in its session** (C4b): `get_review_bundle`, then
  `report_review`.
- **Headless** (C4): `codetrellis review` runs Claude Code's print mode, or
  Codex's `exec`, held to a deny-by-default tool set by the CLI's own
  settings:
  - no built-in tools at all;
  - one MCP server with two tools (report, and read a changed file);
  - an empty folder and a scrubbed environment;
  - budgets on turns, tool calls and time;
  - one retry when it ends without reporting.

  Every refused call is kept on the run.
- **In CI, on the team's key** (C5): the same command.
  - `--verify` adds a second pass that tries to refute each finding.
  - It writes SARIF for code scanning and markdown for the job summary.
  - `--post` comments on the pull request, with a token the model never sees.
  - `--auth oidc:bedrock|vertex|foundry` signs in through the team's cloud.
  - `docs/recipes/review.sh` adds the cost dial: auto, on-request or off.
- **On your own device, counted in CI with no secret** (C9). A review of a
  committed change, by any of the above, is signed with the device's key as
  a git note on the commit, and `codetrellis review publish` pushes it. In
  CI, `codetrellis review verify` checks it against the keys the base lists.
  It is verified, stale (a review of an earlier commit), refused (edited, or
  an unknown key) or absent. This needs no secret, no AI and no app.

**Graduation** (C6): a reviewer gives each bug or risk a `topic`. A topic
kept in two reviews becomes a proposed `guide` rule, once. That is how a
review discovers rules, and the rules, being deterministic, are what block.
A person can also harden an agent rule into a deterministic or fuzzy one
once its shape is clear (B5).

## Every example on this page is a test

`tests/e2e/rules-docs.test.ts` reads this page and runs each example as
written: a fresh repository with the example's files on `main`, its change
committed on a branch, and its commands run there. What a command prints
must be what the page shows, to the character, and it must exit as the
page says. An example that drifts from the code fails the build.

The page marks this in each code block's first line, which a rendered page
hides: `file=… at=main` or `at=change` for a file, `exit=3` on a command,
and `text` for what the command prints. `tools/doc-examples/` reads them.
To add an example, write it the same way; the test finds it. A block with no
`example=` is an illustration, like the suite under [The rulebook](#the-rulebook),
and is not run.

## Building blocks

| Block | What it adds | Example |
|---|---|---|
| Matchers (B1) | `glob` and `regex` on any target | [API calls made several ways](#api-calls-made-several-ways) |
| Grep rules (B2) | `kind: grep`, over the text of any file | [Text that must or must not appear](#text-that-must-or-must-not-appear) |
| Fuzzy matching (B3) | `match: fuzzy`, look-alikes with a score | [Look-alike packages](#look-alike-packages) |
| Your own patterns (B4) | `.codetrellis/patterns/`, what counts as a call | [API calls made several ways](#api-calls-made-several-ways) |
| Engine per rule (B5) | `engine: agent`, a rule an agent review judges | [An agent rule](#an-agent-rule) |
| Pipelines (B6) | `.codetrellis/pipeline.yaml`, stages in order or beside each other | [A grounded pipeline](#a-grounded-pipeline) |

### API calls made several ways

The team's payments client is the one place that talks to Stripe, because it
sets idempotency keys. Code can reach Stripe two ways: a plain `fetch`, which
CodeTrellis's own extractors see, and the Stripe SDK, which they do not. One
rule holds both.

The rule names every Stripe host with a glob (B1). A `*` in a call target is a
glob already, so it needs no `match:`:

```yaml example=api-calls file=.codetrellis/rules/payments.yaml at=main
suite: payments
because: Every charge carries an idempotency key.
rules:
  - id: stripe-via-client
    kind: calls
    calls: http:*.stripe.com
    only: [src/payments/]
    strength: block
    because: The payments client sets idempotency keys.
```

A pattern (B4) says what an SDK call is. Its `is` becomes a call entry like an
extractor's, so the rule above, the graph's cross-system edges and reviews
all treat `stripe.refunds.create(…)` as a call to Stripe. `$1` is the regex's
first group:

```yaml example=api-calls file=.codetrellis/patterns/stripe.yaml at=main
patterns:
  - id: stripe-sdk
    find: { match: regex, value: "stripe\\.(charges|refunds)\\.create\\(" }
    is: http:api.stripe.com/v1/$1
    method: POST
```

The client, on `main`:

```ts example=api-calls file=src/payments/client.ts at=main
declare const stripe: { refunds: { create(p: { charge: string }): Promise<unknown> } };

export const charge = (cents: number) =>
  fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });

export const refund = (id: string) => stripe.refunds.create({ charge: id });
```

The change adds a quick charge and a quick refund, each going around the client:

```ts example=api-calls file=src/api/quick.ts at=change
declare const stripe: { refunds: { create(p: { charge: string }): Promise<unknown> } };

export const quickCharge = (cents: number) =>
  fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });

export const quickRefund = (id: string) => stripe.refunds.create({ charge: id });
```

```sh example=api-calls exit=3
codetrellis start --quiet
codetrellis check --base main
```

```text example=api-calls
Does not conform (1 changed file since main):

payments  ✗ 1 blocks

  ✗ stripe-via-client   only src/payments/ may call *.stripe.com: The payments client sets idempotency keys.
      src/api/quick.ts:4 calls api.stripe.com/v1/charges   fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });
      → use src/payments/ instead
      src/api/quick.ts:6 calls api.stripe.com/v1/refunds   export const quickRefund = (id: string) => stripe.refunds.create({ charge: id });
      → use src/payments/ instead

2 findings block this change (exit 3).
```

A kind of your own (`queue:`, `event:`, `flag:`) is held by `calls` rules as it
is. To see it on the graph's cross-system map as well, a pattern says which end
of it the code is, `side: sends` or `side: receives`. Each file that sends
`queue:orders.created` is then drawn to each file that receives it, a `queue`
edge labelled with the entry, as an HTTP call is drawn to its route. Without a
side an entry pairs with nothing, because which way it goes cannot be told. An
HTTP entry needs no side: its route is the other end.

```yaml
patterns:
  - id: orders-published
    find: { match: regex, value: "publish\\(['\"]orders\\.(\\w+)" }
    is: queue:orders.$1
    side: sends
  - id: orders-consumed
    find: { match: regex, value: "subscribe\\(['\"]orders\\.(\\w+)" }
    is: queue:orders.$1
    side: receives
```

### Commands and environment variables

A call rule holds a command the code runs (`exec:<program>`) and an
environment variable it reads (`env:<NAME>`) as it holds an HTTP call. They
are found in TypeScript, JavaScript, Python, Go, Ruby, C#, Kotlin, Java,
Swift, Rust and PHP, from literals only: `spawn(cmd)` names nothing a rule
could hold. A command is its program, without its folder, so
`/usr/bin/curl -s …` is `exec:curl`.

```yaml example=exec-env file=.codetrellis/rules/secrets.yaml at=main
suite: secrets
because: The payments key stays in the payments client.
rules:
  - id: stripe-key-in-payments
    kind: calls
    calls: env:STRIPE_SECRET_KEY
    only: [src/payments/]
    strength: block
    because: Only the payments client may hold the Stripe key.
  - id: no-shelling-out
    kind: calls
    calls: exec:*
    only: [scripts/]
    strength: warn
    because: The app talks to services through clients, not a shell.
```

```ts example=exec-env file=src/payments/client.ts at=main
const key = process.env.STRIPE_SECRET_KEY;
export const auth = () => `Bearer ${key}`;
```

The change reads the key in a report, and shells out to fetch it:

```ts example=exec-env file=src/reports/daily.ts at=change
import { execSync } from 'node:child_process';

const key = process.env.STRIPE_SECRET_KEY;
export const pull = () => execSync(`curl -s -H "Authorization: Bearer ${key}" https://api.stripe.com/v1/balance`);
```

```sh example=exec-env exit=3
codetrellis start --quiet
codetrellis check --base main
```

```text example=exec-env
Does not conform (1 changed file since main):

secrets  ✗ 1 blocks · ⚠ 1 warns

  ✗ stripe-key-in-payments   only src/payments/ may read the environment variable STRIPE_SECRET_KEY: Only the payments client may hold the Stripe key.
      src/reports/daily.ts:3 reads the environment variable STRIPE_SECRET_KEY   const key = process.env.STRIPE_SECRET_KEY;
      → use src/payments/ instead

  ⚠ no-shelling-out   only scripts/ may run any command: The app talks to services through clients, not a shell.
      src/reports/daily.ts:4 runs curl   export const pull = () => execSync(`curl -s -H "Authorization: Bearer ${key}" https://api.stripe.com/v1/balance`);
      → use scripts/ instead

1 finding blocks this change (exit 3).
```

### Text that must or must not appear

A grep rule (B2) reads the text of the files in its `in`, so it works for any
language and any file. `mustNot` reports each line that matches; `must`
reports each file in scope that never does. The gate reads only the lines a
change adds, so an old line in an edited file is not blamed on the change.

```yaml example=text file=.codetrellis/rules/server.yaml at=main
suite: server
because: The server is reachable from any page on the machine.
rules:
  - id: no-console
    kind: grep
    in: [src/server/]
    except: ['**/*.test.ts']
    mustNot: { match: regex, value: "console\\.(log|debug)\\(" }
    strength: warn
    because: The server logs through log.ts, which redacts.
  - id: routes-check-auth
    kind: grep
    in: [src/server/routes/*.ts]
    must: requireAuth
    strength: block
    because: Every route authenticates; loopback is no boundary.
```

```ts example=text file=src/server/routes/users.ts at=main
import { requireAuth } from '../auth';
export const users = [requireAuth, () => 'users'];
```

```ts example=text file=src/server/auth.ts at=main
export const requireAuth = () => true;
```

The change adds a route that forgets the check, and a debug line:

```ts example=text file=src/server/routes/admin.ts at=change
export const admin = [() => 'admin'];
```

```ts example=text file=src/server/boot.ts at=change
export const boot = () => {
  console.log('booting');
};
```

```sh example=text exit=3
codetrellis start --quiet
codetrellis check --base main
```

```text example=text
Does not conform (2 changed files since main):

server  ✗ 1 blocks · ⚠ 1 warns

  ✗ routes-check-auth   every file in src/server/routes/*.ts must contain “requireAuth”
      src/server/routes/admin.ts:1 never contains “requireAuth”   export const admin = [() => 'admin'];
      → Every route authenticates; loopback is no boundary.

  ⚠ no-console   no file in src/server/ may contain a line matching /console\.(log|debug)\(/
      src/server/boot.ts:2 contains “console.log('booting');”   console.log('booting');
      → The server logs through log.ts, which redacts.

1 finding blocks this change (exit 3).
```

### Look-alike packages

`match: fuzzy` (B3) compares names after lowercasing them and splitting them on
case, `-`, `_`, `.` and `/`, and scores how alike they are from 0 to 1. A
score is one less the edits between them over the longer name's length, so
one swapped pair of letters in `requests` is 1 − 1/8 = 0.88. Fuzzy means
"like it, and not it": the real name never matches, so `only` may be empty,
and then nothing may import a look-alike. The same names always give the
same score; there is no model and no network.

```yaml example=look-alikes file=.codetrellis/rules/supply-chain.yaml at=main
suite: supply-chain
because: A package one typo from a real one is how a typosquat gets in.
rules:
  - id: no-requests-lookalikes
    kind: package
    package: pypi:requests
    match: fuzzy
    threshold: 0.85
    only: []
    strength: block
    because: A package one typo from a real one is how a typosquat gets in.
```

```python example=look-alikes file=app/fetch.py at=main
import requests

def get(url):
    return requests.get(url)
```

```python example=look-alikes file=app/fetch.py at=change
import requests
import reqeusts

def get(url):
    return requests.get(url)
```

```sh example=look-alikes exit=3
codetrellis start --quiet
codetrellis check --base main
```

```text example=look-alikes
Does not conform (1 changed file since main):

supply-chain  ✗ 1 blocks

  ✗ no-requests-lookalikes   nothing may import a look-alike of pypi:requests (0.85 or closer): A package one typo from a real one is how a typosquat gets in.
      app/fetch.py:2 imports pypi:reqeusts   import reqeusts
      → pypi:reqeusts is 0.88 like pypi:requests: did you mean it?

1 finding blocks this change (exit 3).
```

### An agent rule

Some rules are not a shape code can check. `engine: agent` (B5) keeps a
rule's words, and an agent review judges the files in its `in` against
them. The words are part of the rule's signed terms, so changing them is a
change to the rule. With no review, an agent rule is a guide: shown in
briefs and the Rules view, checked nowhere, never failing `check`.

```yaml example=agent-rule file=.codetrellis/rules/money.yaml at=main
suite: money
because: Every movement of money is audited.
rules:
  - id: money-through-ledger
    engine: agent
    rule: Code that moves money records it through src/ledger, never by writing balances directly.
    in: [src/]
    strength: block
    because: Every movement is audited.
```

```ts example=agent-rule file=src/ledger.ts at=main
export const record = (userId: string, cents: number) => ({ userId, cents });
```

The change writes a balance directly:

```ts example=agent-rule file=src/refunds.ts at=change
declare const balances: Record<string, number>;
export function refund(userId: string, cents: number) {
  balances[userId] += cents;
}
```

`check` runs no agent, so it does not judge the rule, and the change passes:

```sh example=agent-rule
codetrellis start --quiet
codetrellis check --base main
```

```text example=agent-rule
Conforms: 1 changed file since main. No breakpoint holds them, none of their tests fail or are older than the code, no done task fails its checks, no doc that describes them is stale, they add no import an architecture rule forbids, and they loosen no rule.

Nothing blocks this change (exit 0).
```

`codetrellis review` runs your own agent on your own key, sends it the rule
in its bundle, and holds what it reports to the contract: a finding must
quote the diff at the lines it names, and cite a rule in scope. Say the agent
reports this (in the test, a stand-in plays the agent's part and reports
exactly it):

```json example=agent-rule agent=report
{
  "findings": [
    {
      "kind": "rule",
      "file": "src/refunds.ts",
      "start_line": 3,
      "end_line": 3,
      "quote": "balances[userId] += cents;",
      "says": "The refund writes the balance directly, with no ledger record.",
      "rule": "money-through-ledger",
      "fix": "record(userId, cents) from src/ledger"
    }
  ]
}
```

A finding that cites a block-strength agent rule, and holds, fails the run.
Run on your own device, the review is also signed with the device's key as a
git note on the commit, which CI verifies with no secret (C9, in
[`cli.md`](cli.md)):

```sh example=agent-rule exit=3
codetrellis review --base main --agent claude-code --auth env:ANTHROPIC_API_KEY --fail-on block
```

```text example=agent-rule
review: Claude Code's review: ✗ 1 block · ⚠ 1 finding
  ✗ rule (money-through-ledger) · src/refunds.ts:3: The refund writes the balance directly, with no ledger record. → record(userId, cents) from src/ledger

Kept as check runs; the Checks view opens each. Exit 3: --fail-on.
```

### A grounded pipeline

Without `.codetrellis/pipeline.yaml`, every rule runs in one stage. With it,
stages run in order; `parallel: true` runs a stage beside the one before it;
`needs` names stages that must finish first; `when` decides whether a stage
runs at all; and `grounding` hands a stage what earlier stages found, so a
review builds on them rather than finding them again (B6). Each stage is a
check run naming itself. Removing a stage, or making it advisory, loosens
the pipeline, and needs a person's signed approval as a rule does.

```yaml example=pipeline file=.codetrellis/pipeline.yaml at=main
stages:
  - id: fast
    rules: { engine: deterministic }
  - id: fuzzy
    rules: { engine: fuzzy }
    parallel: true
  - id: review
    needs: [fast, fuzzy]
    rules: { engine: agent }
    when: { fast: passed }
    grounding: [fast, fuzzy]
```

```yaml example=pipeline file=.codetrellis/rules/payments.yaml at=main
suite: payments
because: Money is audited and goes through one client.
rules:
  - id: stripe-via-client
    kind: calls
    calls: http:*.stripe.com
    only: [src/payments/]
    strength: warn
    because: The payments client sets idempotency keys.
  - id: no-stripe-lookalikes
    kind: package
    package: npm:stripe
    match: fuzzy
    only: []
    strength: block
    because: A package one typo from a real one is how a typosquat gets in.
  - id: money-through-ledger
    engine: agent
    rule: Code that moves money records it through src/ledger, never by writing balances directly.
    in: [src/]
    strength: warn
    because: Every movement is audited.
```

```ts example=pipeline file=src/payments/client.ts at=main
export const charge = (cents: number) =>
  fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: String(cents) });
```

```ts example=pipeline file=src/api/refunds.ts at=change
declare const balances: Record<string, number>;
export async function refund(userId: string, cents: number) {
  balances[userId] += cents;
  await fetch('https://api.stripe.com/v1/refunds', { method: 'POST', body: userId });
}
```

```json example=pipeline agent=report
{
  "findings": [
    {
      "kind": "rule",
      "file": "src/api/refunds.ts",
      "start_line": 3,
      "end_line": 3,
      "quote": "balances[userId] += cents;",
      "says": "The refund writes the balance directly; the fast stage already found it calls Stripe outside the client.",
      "rule": "money-through-ledger"
    }
  ]
}
```

```sh example=pipeline
codetrellis start --quiet
codetrellis check --pipeline --base main --agent claude-code --auth env:ANTHROPIC_API_KEY
```

```text example=pipeline
✓ stage fast: deterministic rules
  Conforms to engine deterministic: 1 changed file since main. They add no import those rules forbid, and loosen none of them.

  payments  ⚠ 1 warns

    ⚠ stripe-via-client   only src/payments/ may call *.stripe.com: The payments client sets idempotency keys.
        src/api/refunds.ts:4 calls api.stripe.com/v1/refunds   await fetch('https://api.stripe.com/v1/refunds', { method: 'POST', body: userId });
        → use src/payments/ instead

  Nothing blocks this change (exit 0).
✓ stage fuzzy: fuzzy rules, beside the stage before
  Conforms to engine fuzzy: 1 changed file since main. They add no import those rules forbid, and loosen none of them.

  payments  ✓ 1 rule holds

  Nothing blocks this change (exit 0).
✓ stage review: agent rules, after fast and fuzzy, when fast passed, grounded by fast and fuzzy
  review: ⚠ 1 finding
    ✗ rule (money-through-ledger) · src/api/refunds.ts:3: The refund writes the balance directly; the fast stage already found it calls Stripe outside the client.
✓ The pipeline passes (3 of 3 stages ran).
```

`--stage <id>` runs one stage, for a CI that wants a job per stage:

```sh example=pipeline
codetrellis check --pipeline --stage fuzzy --base main
```

```text example=pipeline
✓ stage fuzzy: fuzzy rules, beside the stage before
  Conforms to engine fuzzy: 1 changed file since main. They add no import those rules forbid, and loosen none of them.

  payments  ✓ 1 rule holds

  Nothing blocks this change (exit 0).
✓ The pipeline passes (1 of 1 stages ran).
```

[`docs/recipes/pipeline.sh`](../recipes/pipeline.sh) runs the pipeline on
any CI host, with variants for GitHub Actions
([`github-actions-pipeline.yml`](../recipes/github-actions-pipeline.yml))
and GitLab ([`gitlab-ci-pipeline.yml`](../recipes/gitlab-ci-pipeline.yml)).
The test runs it on this example too.
