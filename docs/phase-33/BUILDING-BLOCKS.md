# Building blocks: rules anyone can put together

Phase 33, Track B. Added by the owner on 2026-10-07, before Z1.

## Why

The rule kinds so far (imports, package, symbol, calls, folder) each answer one
question well, and each matches its target exactly or by a glob. Teams need more
than five fixed questions. They need to catch:

- the different ways different systems make the same API call;
- text that should never appear, or must always appear;
- names that look like something they shouldn't be;
- rules that only a person or a model can judge.

Then they need to put those checks together in the order and the pipeline they
already run.

So CodeTrellis offers **blocks**, not a fixed list of checks:

- **Matchers:** how a rule recognises something.
- **Rule kinds:** what a rule looks at.
- **Patterns:** what counts as a call, or as any other thing worth capturing.
- **Engine and strength:** who judges, and how hard it holds.
- **Pipelines:** what runs, in what order, and what each stage hands the next.

Every block is small, written in YAML beside the code, and explained in words
wherever it reports. A developer builds up the rules they need from these, and
none of them is special-cased.

## What stays true

These hold however the blocks are put together:

- **Deterministic and fuzzy rules give the same answer every time.** Each finding
  says which rule, which file and line, and why, in one sentence.
- **Strength is the owner's choice for every rule:** `block`, `warn` or `guide`.
  Any rule can be loosened or tightened. Loosening still needs a person's signed
  approval (R2).
- **An agent never blocks unless the rule's owner chose `block` for an
  `engine: agent` rule.** Even then, every finding must cite the diff and is
  checked by code (C4b).
- **The pipeline file is a rule file.** It goes through change control like a
  suite. Removing a stage, or making a stage advisory, counts as a loosening.
- **Nothing needs a server.** The same files run:
  - on a laptop;
  - in an agent's session;
  - in any CI (C2's recipes);
  - with or without AI;
  - with or without a secret.

## B1 Matchers

Every rule target can say how it matches. The default stays as today.

```yaml
- id: stripe-anywhere
  kind: calls
  calls: { match: glob, value: "http:*.stripe.com" }
  only: [src/payments/]
```

| `match` | Means | For example |
|---|---|---|
| `exact` (default for names) | the same, after the kind's own normalisation | `npm:stripe` |
| `glob` (default for paths) | `*` within a segment, `**` across | `sql:payments_*`, `src/db.ts#raw*` |
| `regex` | a regular expression, anchored | `http:api\.(stripe\|paypal)\.com/.*` |
| `fuzzy` | similar enough, with a `threshold` (B3) | `npm:requests`, threshold 0.85 |

Built in B1: `glob` and `regex` on package, symbol and call targets. A `*` in a
name already means `glob`, so `http:*.stripe.com` needs no `match:`. In the
suite file the matcher is written beside the target (`calls: …` and
`match: regex`). Folder names and grep text gain matchers with their kinds
(B2), `fuzzy` with B3.

A matcher works on packages, call hosts and paths, SQL tables, export names,
folder names and grep text alike. One matcher, every kind, so a developer learns
it once.

## B2 Grep rules

A rule kind over file contents. It needs no parser, so it works for every
language and every file type.

```yaml
- id: no-console-in-backend
  kind: grep
  in: [src/backend/**/*.ts]
  except: ['**/*.test.ts']
  mustNot: { match: regex, value: "console\\.(log|debug)\\(" }
  strength: warn
  because: The backend logs through services/logger, which redacts.

- id: routes-check-auth
  kind: grep
  in: [src/routes/*.ts]
  must: { match: exact, value: requireAuth }
  strength: block
  because: Every route authenticates; the loopback is not a boundary.
```

- **`mustNot`** reports each line that matches.
- **`must`** reports each file in scope that never matches.
- **Case:** `ignoreCase: true`.
- **Old breaches:** counted in `baseline.yaml` like any other rule's, and the
  count may only shrink (C3).
- **Change control:** the gate reads only the lines a change adds, so an edited
  file is not blamed for its old lines.

Built in B2. Grep text is literal unless `match` says otherwise, and a `*` in
it stays a `*`, unlike a package, symbol or call target. A line is keyed by its
text, so an edit above an old line does not make it new. The Rules view has a
**Text** kind for it.

## B3 Fuzzy matching

`match: fuzzy` compares normalised strings. It lowercases them and splits them
on case, `-`, `_`, `.` and `/`. It then scores their similarity from 0 to 1,
and matches at or above `threshold` (default 0.85).

- **What it's for:**
  - **look-alike names:** a package one letter from a known one;
  - **near-duplicates:** a second `formatMoney` in another folder;
  - **renamed copies:** `stripeClient2.ts`.
- **What it says:** the score and what it was close to, for example "`reqeusts`
  is 0.93 like `requests`".
- **Determinism:** the same inputs always give the same score. There is no model
  and no network.
- **Grep:** `kind: grep` with `match: fuzzy` matches whole tokens, never
  substrings, so it doesn't fire on every partial word.

## B4 Your own patterns: what counts as a call

Today the extractors in `callsites/<lang>.ts` turn source into call entries
(`http:host/path`, `sql:table`), and `calls` rules and the cross-system map read
those entries. B4 lets a team add its own extractors, without code:

```yaml
# .codetrellis/patterns/payments.yaml
patterns:
  - id: payments-sdk
    in: ['**/*.{ts,js,py}']
    find: { match: regex, value: "paymentsClient\\.(charge|refund)\\(" }
    is: http:api.stripe.com/v1/charges
  - id: orders-queue
    in: ['**/*.{ts,py,go}']
    find: { match: regex, value: "publish\\(['\"]orders\\.(\\w+)" }
    is: queue:orders.$1
```

- **One rule covers every route to an API.** A pattern's `is` becomes an entry
  like any extractor's, so `calls` rules, the graph's cross-system edges and
  reviews treat `paymentsClient.charge()` exactly as a direct `fetch` to
  Stripe.
- **New kinds of entry:** `is` may name kinds CodeTrellis has never heard of
  (`queue:`, `event:`, `flag:`, `secret:`). Any rule can then hold them; for
  example, "only `src/billing/` publishes to `queue:orders.*`".
- **Normalisation:** entries go through the same route and URL normalisation as
  the built-in extractors (`callsites/shared.ts`), so they pair across languages.
- **Explained:** each entry says which pattern found it, so a surprising edge can
  be explained.

## B5 Engine and strength, per rule

```yaml
- id: money-through-ledger
  engine: agent
  strength: warn
  rule: Code that moves money records it through services/ledger, never by writing balances directly.
  in: [src/]
```

| `engine` | Judged by | Can it block? |
|---|---|---|
| `deterministic` (default) | code: graph, extractors, grep | when `strength: block` |
| `fuzzy` | code: B3's similarity | when `strength: block` |
| `agent` | an agent review (C4, C5, C9), against the rule's words | only when the owner sets `strength: block` |

- **Where an agent rule goes:** it is sent to the review in its bundle. A finding
  that cites it is held to the contract: it must quote the diff, and its rule
  must be in scope.
- **With no review configured:** an agent rule behaves as a `guide`. It is shown
  in briefs and the Rules view, and checked nowhere.
- **C6 graduation:** when the review keeps finding the same thing, C6 proposes a
  rule. B5 adds a second path: a person can harden an agent rule into a
  deterministic or fuzzy one once its shape is clear.

## B6 Pipelines: order, parallel, grounding

An optional file. Without it, every rule runs in one stage, as today.

```yaml
# .codetrellis/pipeline.yaml
stages:
  - id: fast
    rules: { engine: deterministic }
  - id: fuzzy
    rules: { engine: fuzzy }
    parallel: true
  - id: review
    needs: [fast, fuzzy]
    rules: { engine: agent }
    when: { fast: passed }      # skip the review when the fast stage blocked
    grounding: [fast, fuzzy]    # the agent sees what they found
  - id: security
    rules: { suite: security }
    parallel: true
```

- **`rules`** selects rules by `suite`, `engine`, `strength`, `id` or `tag`.
- **Order:** stages run in order, and `parallel: true` runs a stage beside the one
  before it. **`needs`** names stages that must finish first; `when` decides
  whether a stage runs at all.
- **Grounding:** a stage's results become grounding for any stage that names it.
  The agent's bundle carries those findings as facts (C4b already carries "what
  the check already found"). So the review builds on the deterministic results,
  and doesn't rediscover or contradict them.
- **Records:** every stage is a check run (C7), and the run says where it ran:
  laptop, session or CI. A later stage may run somewhere else; for example, a
  signed local review (C9) fills the `review` stage for CI.
- **One command:** `codetrellis check --pipeline` runs it all. `--stage <id>`
  runs one stage, so a CI that wants its own job per stage can have it. The C2
  recipes take the flag.

## B7 The docs

`docs/claude/rules.md` gains a **Building blocks** section, with one worked
example per block:
- API calls made several ways;
- text that must or must not appear;
- look-alike packages;
- an agent rule;
- a pipeline whose agent stage is grounded by the stages before it.

`docs/recipes/` gains `pipeline.sh` and its CI variants.

## Agent review: three ways to run it

The blocks don't decide where the agent runs. Teams choose per repository:

| Mode | Where the agent runs | Secret in CI? | Suits |
|---|---|---|---|
| CI token (C5) | in CI, on the team's key, OAuth token or cloud (OIDC) | yes, the team's | enterprises, private repositories |
| Signed local (C9) | the developer's device, any agent (Cursor, Codex, Claude Code, any MCP client) | no | open source, bring your own agent |
| Off | nowhere | no | deterministic and fuzzy rules only (R10) |

## Order

After R10, which is this repository's own rulebook:

1. **B1** matchers;
2. **B2** grep rules;
3. **B3** fuzzy matching;
4. **B4** your own patterns;
5. **B5** engine per rule;
6. **B6** pipelines;
7. **C9** signed local review;
8. **B7** docs;
9. **Z1**.

R11, the wildcard targets proposed earlier the same day, is B1.
