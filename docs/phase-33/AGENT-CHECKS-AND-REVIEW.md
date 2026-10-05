# Phase 33 — Agent checks, review, and how checks are seen

> The second design doc of Phase 33, beside
> [RULES-AND-CLARITY.md](RULES-AND-CLARITY.md). It covers three things:
> - how an agent runs a check with nobody to talk to;
> - the review features worth adding;
> - one clean way to show rules and check results, in the terminal, in a
>   pull request and in the app.
>
> The owner's asks, 2026-10-05.

---

## 1. Agent checks with nobody to talk to

An agent check runs where no person is watching: a CI job, or a laptop
hook. Three things that are harmless in a chat become blockers there:

| In a chat | Headless, it becomes |
|---|---|
| A question | A hang until the job times out |
| A permission prompt | The same hang, or a silent denial |
| Something remiss: a command, a write, a guess presented as fact, a finding about code it never read | Damage, a leaked secret, or a confident wrong answer in someone's pull request |

So an agent check is **a bounded job with a contract**, not a
conversation. The design makes each of the three impossible by
construction, rather than unlikely by instruction.

### 1.1 Who runs it: an orchestrator, and passes as subagents

`codetrellis review` is the orchestrator: plain code, not a model. It runs
one or more **passes**. Each pass is an isolated agent session, like a
subagent:

- its own instructions (a skill);
- its own tools;
- its own budget;
- one job.

A pass never sees another pass's conversation, only the orchestrator's
summary of results.

```
codetrellis review --suite payments
  │
  ├─ assemble the bundle (deterministic)
  │    diff · rules in scope · gate results · task + criteria · system docs
  │
  ├─ pass: review     one per suite or per skill, in parallel, read-only tools
  │     └─ must end by calling report(findings | inconclusive)
  │
  ├─ verify (deterministic)   every finding cites lines that exist in the diff
  │                           and quotes them exactly; otherwise dropped
  │
  ├─ pass: verify (optional)  a second agent tries to refute each finding;
  │                           refuted findings are dropped
  │
  └─ result   pass · findings · inconclusive · error   →  text / json / sarif / markdown
              recorded as a check run (§3.2)
```

**Why passes and not one agent.**
- A narrow pass with one skill and one suite is cheaper and more accurate.
- Passes can run in parallel.
- A pass that fails costs only itself.

The code-review pattern this repository already uses (review, then
adversarial verify) is the same shape.

### 1.2 The contract every pass runs under

**1. Tools are an allowlist, so there is nothing to ask permission for.**
The pass gets only:
- read a file inside the checkout;
- search the checkout;
- list a folder;
- CodeTrellis's own read tools, the `read` capability in
  `services/mcp-capabilities.ts`: `get_brief`, `list_rules`,
  `search_symbols`, the graph queries;
- `report`.

It gets no shell, no network, no write and no `request`/ask tool. A
permission prompt cannot happen, because nothing that would need one is
offered.

**2. A question becomes a finding, not a pause.** The report schema has a
`question` kind: what the pass could not decide, and why. The run carries
on, and the question reaches the author in the review (§2.4). Questions
never block by default.

**3. The run must end in a report.**
- A pass ends only by calling `report`, with findings matching a schema,
  or with `inconclusive` and a reason.
- Text without a report is an invalid pass.
- An invalid pass is retried once, then counted as `error`.

**4. Budgets end it, not a timeout.** Each pass has limits on:
- turns;
- tokens;
- wall time;
- tool calls.

Reaching one ends the pass as `inconclusive: budget`, with what it found
so far.

**5. Grounding is checked by code.** A finding must name a file and line
range in the change, and quote the code. The orchestrator checks:
- the lines exist in the diff;
- the quote matches;
- a rule finding names a rule that is in scope.

A finding that fails any check is dropped and counted. The agent's
confidence is not evidence; the citation is.

**6. Untrusted text is data.**
- The diff, the pull request's title, body and comments, and file
  contents are passed in a marked block that carries no instruction
  authority.
- The pass's instructions come only from the skill and the orchestrator.
- An instruction found inside the data is itself reported, as a
  `suspicious` finding.

**7. Remiss behaviour is recorded, not hidden.** Every refused tool call
(a tool not on the allowlist), every dropped finding and every retry goes
into the run record. A pass that keeps trying to reach for a shell is
something the team should see.

**8. The outcome is one of four, and only one blocks by default:**

| Outcome | Meaning | Default |
|---|---|---|
| `pass` | Nothing found | ✓ |
| `findings` | Grounded findings | Advisory; `--fail-on block` makes findings on `block`-strength rules fail |
| `inconclusive` | Budget, invalid report, or the pass said it could not decide | Advisory, with the reason |
| `error` | Model unreachable, credential refused, invalid twice | Advisory; `--fail-on error` for teams that want it |

### 1.3 Bring your own agent, locally

- **On a laptop with an agent already running** (Claude Code, Codex,
  Cursor), the interactive agent can do the review itself. It asks
  CodeTrellis for the bundle (`get_review_bundle`) and returns the same
  schema (`report_review`).
- **The orchestrator still checks the citations**, so a chatty agent's
  findings meet the same bar as a headless one's.
- **No second model or credential is needed.**

### 1.4 Which agent runtime

- **The default is CodeTrellis's own small agent loop** over two APIs:
  - the Anthropic Messages API;
  - the OpenAI-compatible chat API, which covers vLLM, Ollama and LiteLLM
    gateways, and through them most providers.

  Owning the loop is what makes §1.2 enforceable: the tools offered are
  exactly the allowlist. It also keeps CodeTrellis model- and
  host-neutral.
- **Adapters for an existing agent CLI** come later, for teams that want
  their agent's own skills and settings:
  - Claude Code in print mode, with an explicit allowed-tools list and JSON
    output;
  - Codex's non-interactive mode.

  An adapter must still end in the report schema, and still gets its
  citations verified. Each adapter is checked against that CLI's own
  documentation before it ships, as Phase 32 A8.3 did for hooks.

---

## 2. Review features worth adding

CodeTrellis already has a lot of review machinery:
- the review queue and Review tab (Phase 32 A5);
- `review_plan`, with other work in flight;
- PR drafts;
- read-only host status for GitHub, GitLab and Bitbucket (Phase 32 C2);
- sign-off packs, signed approvals and the evidence export (B10).

These build on it. Each one is proposed; the owner chooses.

### 2.1 What this change does to the architecture (recommended)

A section at the top of every review: the change's **structural diff**,
not its text diff.
- The imports added and removed between folders.
- New outside packages.
- New cross-system calls: HTTP, SQL, subprocess.
- The rules and suites it touches, with any breach or loosening.

The diff engine and the graph already know all of it. A reviewer sees
"adds a call from `web/` to `api.stripe.com`" before reading a line.

### 2.2 Review in order of risk (recommended)

The files in a change, ordered by what a mistake there would cost:
- how many files depend on it;
- whether it is in a `block` rule's scope;
- whether its tests are failing or older than the code;
- whether another line of work is changing it.

Each file gets one line saying why it is where it is. "Review these
three first" is the most useful thing a big agent-written change can say.

### 2.3 Re-review only what changed (recommended)

- Remember the commit each reviewer last reviewed.
- After a push, show what changed since then, and which earlier findings
  that push addressed.

This saves the most time on long agent pull requests that get pushed to
many times.

### 2.4 Questions go to the author

- The `question` findings from agent checks (§1.2) become questions on the
  review.
- The author, human or agent, answers them in the app, on the phone (the
  Phase 32 A4 reply path) or through MCP.
- An unanswered question is shown, never silently dropped.

### 2.5 Is a finding right?

- Every finding can be marked **useful** or **wrong**, with one line of
  why. The mark goes into the record.
- Wrong findings of the same kind are suppressed on later runs, and the
  suppression is visible and can be undone.
- Useful ones count towards graduation (RULES-AND-CLARITY §5.5).
- Over time this measures whether agent checks earn their cost.

### 2.6 Did the change do what the task said?

For a change linked to a task:
- the task's criteria, each with its check's result;
- the planned footprint against the actual one (files the plan expected
  and did not touch, files it touched and did not plan).

`review_plan` has the parts; this puts them in the review.

### 2.7 Who should review

- Suggested reviewers, from who owns the suites the change touches
  (CODEOWNERS and the rule's `by`) and who changed those files recently.
- Shown only. CodeTrellis never assigns.

### 2.8 The review record

- When a change is approved, the sign-off pack includes the check runs,
  the agent findings with their marks, and the questions and answers.
- It is signed as packs are today.

Months later, "what did the checks say when this merged?" has an answer.

**Order, if all are taken:** 2.1, 2.2, 2.3 first: cheap, built on what
exists, and the most visible. Then 2.4 and 2.5, which need agent checks.
Then 2.6, 2.7, 2.8.

---

## 3. One clean way to show rules and results

The owner: "we really need to nail a clean UI for the CLI enforcement
rules but also being able to check in app and see the output."

### 3.1 One renderer, four outputs

- A rule and a finding are written in words **once**, in
  `src/shared/lib/check-words.ts`.
- The terminal, the pull request (markdown and SARIF), the app and the
  phone all render from it.
- The words never differ between surfaces, so a person who has read one
  has read them all.
- G1's visual vocabulary gives each state its glyph and colour.

A rule, everywhere:

> **Only `src/payments/index.ts` may import `stripe`** · block · payments
> The wrapper sets idempotency keys and retries.

A finding, everywhere:

> ✗ **`src/checkout/pay.ts:14` imports `stripe`** · `stripe-via-wrapper` (block)
> Import `createCharge` from `src/payments/index.ts` instead.

The terminal (`codetrellis check`, text):

```
payments  ✗ 1 blocks · ⚠ 1 warns · ✓ 2 rules hold          (base: origin/main a1b2c3d)

  ✗ stripe-via-wrapper   Only src/payments/index.ts may import stripe
      src/checkout/pay.ts:14   import Stripe from 'stripe'
      → import createCharge from src/payments/index.ts instead

  ⚠ charge-from-checkout-only   Only src/checkout/ may import createCharge
      src/admin/refund.ts:3    import { createCharge } from '../payments'
      → refunds use refundCharge

rulebook  ⚠ this change tightens no-direct-stripe-http (adds it at warn)

1 rule blocks this change (exit 3). Run in the app: Checks → payments.
```

The rules for the terminal:
- grouped by suite, then rule, then place;
- the summary line first;
- the fix on its own line, starting with →;
- glyph and word, never colour alone;
- no colour at all when output is not a terminal;
- the exit code stated in words.

`--format json | sarif | markdown` carry the same content.

### 3.2 Every check is a run you can open

- Every check, wherever it ran, is a **check run**:
  - deterministic or agent;
  - CLI, CI, the app or an agent's MCP call.
- A run records:
  - where and by whom;
  - the scope;
  - the rulebook's commit;
  - the outcome;
  - its findings, with their marks.
- **Runs travel like test runs** (Phase 32 D1.5a). With shared task state
  on, a CI run is written to `.codetrellis/runs/checks/` and arrives on
  every teammate's desktop with the next pull.
- The phone sees runs that need a person.

### 3.3 The Checks view in the app

A workspace of its own, beside the Rules view (G7). The two are one place
with two tabs: what the rules are, and what the checks say.

```
┌ Checks ─────────────────────────────────────────────────────────────┐
│ Run ▾ [ payments ▾ ] [ deterministic | agent ]   ▶ Run now           │
├─────────────────────────────┬────────────────────────────────────────┤
│ Runs                        │ ✗ payments · CI · feat/checkout · 2m    │
│ ✗ payments   CI    2m       │   base origin/main a1b2c3d · rulebook ✓ │
│ ✓ all        you   1h       │                                         │
│ ◐ payments   agent 1h       │ ✗ stripe-via-wrapper (block)            │
│ ✓ ui         CI    3h       │   src/checkout/pay.ts:14  [graph][code] │
│                             │   → import createCharge from …          │
│ filter: failing · mine · CI │ ⚠ charge-from-checkout-only (warn)      │
│                             │   src/admin/refund.ts:3   [graph][code] │
│                             │ ? question (agent)                      │
│                             │   Is refundCharge idempotent? [answer]  │
└─────────────────────────────┴────────────────────────────────────────┘
```

- **Run any check** from the app, at any scope: a suite, a rule, the
  selected path, the current change. Deterministic or agent.
- **Runs from CI show here** beside local ones, marked with where they ran.
- **Compare two runs**: what is new, what was fixed, what stayed.
- **Every finding has a way to its place:** [graph] selects the breaching
  edge; [code] opens the file at the line.

### 3.4 Findings where the code is

| Where | What it shows |
|---|---|
| Graph | A breaching edge in the breach style; a node with findings has a mark; the legend explains both |
| Code (CodePreview, the diff view) | A gutter mark on the line, with the finding in words on hover; the same mechanism as today's plan markers |
| Inspector | For the selected file: the rules that cover it, its open findings, and the plans and tasks that touch it (G5) |
| Brief and notes | A task's brief lists its rules in scope and the latest run over its files |
| Pull request | One comment per run in markdown, plus SARIF annotations on the lines |
| Phone | Runs that block or ask a question, in Needs you |

---

## 4. What this adds to the plan

| Step | What |
|---|---|
| C4 | The agent check orchestrator, refined: passes, the contract (§1.2), the four outcomes, the report schema, grounding verification |
| C4b | Bring your own agent locally: `get_review_bundle`, `report_review` |
| C5 | In CI, plus the optional verify pass |
| C7 | Check runs as records that travel (§3.2) |
| C8 | One renderer: `check-words.ts`, and the terminal, markdown and SARIF from it (§3.1) |
| G9 | The Checks view: run, history, compare (§3.3) |
| G10 | Findings where the code is: graph, code gutter, inspector, brief (§3.4) |
| V1–V8 | Review features (§2), proposed; added to the checklist as the owner chooses |
