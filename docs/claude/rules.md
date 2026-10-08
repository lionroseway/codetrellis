# Rules

A rulebook is YAML in `.codetrellis/rules/`, one suite per file, committed
with the code. `codetrellis check` holds a change to the rules on the branch
it goes into (the base), never the change's own copy: a branch cannot loosen
the rules it is checked by (R2). The Rules view in the app writes the same
files, and shows each rule with what breaks it today.

This page is the building blocks rules are made of (Phase 33 B1–B6). The
whole of the rulebook, change control and the checks are in
[`cli.md`](cli.md) and [`mcp-tools.md`](mcp-tools.md).

## Every example on this page is a test

`tests/e2e/rules-docs.test.ts` reads this page and runs each example as
written: a fresh repository with the example's files on `main`, its change
committed on a branch, and its commands run there. What a command prints
must be what the page shows, to the character, and it must exit as the
page says. An example that drifts from the code fails the build.

The page marks this in each code block's first line, which a rendered page
hides: `file=… at=main` or `at=change` for a file, `exit=3` on a command,
and `text` for what the command prints. `tools/doc-examples/` reads them.
To add an example, write it the same way; the test finds it.

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
