# Phase 32 — Wireframes

> ASCII sketches of the observability surface in
> [PHASE-32-OBSERVABILITY.md](PHASE-32-OBSERVABILITY.md). They show
> layout and wording, not visual style: the real thing uses the app's
> existing dark `glass-panel` look.

Legend used throughout:

| Glyph | Means |
|---|---|
| `▶` | agent working |
| `●` | agent action on the timeline |
| `◆` | commit or merge |
| `⚠` | warning (collision, contract change, drift) |
| `⏸` | breakpoint: waiting for a person |
| `✎` | spec change or proposal |
| `✓` `✗` `○` | passing / failing / not yet |
| `◇` | planned, not yet real |
| `░` | a collision zone on the graph |

---

## 1. The main screen, live

Five workstreams running. Two things need attention; everything else is
quiet.

```
┌─ CodeTrellis ─ acme-payments ───────────────────────────────────────────────────────────┐
│ ▶auth-refresh  ▶billing-v2 ⚠  ▶checkout-fix ⚠  ▶exports  ○docs      ⚠ 1 zone  ⏸ 1 you   │
├─ STACK ────────────────┬─ GRAPH ─────────── live ▾ ─ layers ▾ ─┬─ INBOX ────────────────┤
│                        │                                       │                        │
│ JIRA-142 Billing v2    │    ┌─────────┐        ┌──────────┐    │ ⏸ WAITING ON YOU       │
│ ████████░░  ◐ 1 you    │    │  auth/  │        │  web/    │    │ billing-v2 wants to    │
│  ✓ Invoice format      │    │ session │        │ checkout │    │ change payments/       │
│  ▶ Currency  billing-v2│    └────┬────┘        └────┬─────┘    │ refund.ts              │
│     ⚠ overlaps JIRA-150│         │                  │          │ [Continue] [Steer]     │
│  ○ Exports  waits ↑    │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      │ [Stop]         4m ago  │
│                        │    ░ ⚠ 2 workstreams          ░       │                        │
│ JIRA-150 Checkout fix  │    ░ ┌──────────────────────┐ ░       │ ⚠ SERIOUS              │
│ ████░░░░░░             │    ░ │ billing/invoice.ts   │ ░       │ billing changed what   │
│  ▶ Submit  checkout-fix│    ░ │ createInvoice()      │ ░       │ checkout uses:         │
│     ⚠ overlaps JIRA-142│    ░ └──────────────────────┘ ░       │ createInvoice(opts,    │
│                        │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      │   currency)            │
│ JIRA-151 Auth refresh  │         │                  │          │ Agents told ✓          │
│ ██████████ ✓ review    │    ┌────┴────┐        ┌────┴─────┐    │ [Open] [Intended]      │
│                        │    │payments/│ ⏸      │ exports/ │    │                        │
│ JIRA-155 Exports       │    │ refund  │        │  csv     │    │ 3 minor notes ▸        │
│ ██░░░░░░░░             │    └─────────┘        └──────────┘    │                        │
│  ▶ CSV columns exports │                                       │                        │
├─ TIMELINE ─────────────┴───────────────────────────────────────┴────────────────────────┤
│ auth-refresh  ●──●───●●───◆───────────●──✓                                              │
│ billing-v2    ●───●──●──⚠──●──●──⏸━━━━━━━━━━━━━━━━━                                     │
│ checkout-fix  ────●──●──⚠───●●──●──●                                                    │
│ exports       ──────────●───●────●──●──●                                                │
│ main          ──────────────◆ merge auth-refresh                                        │
│ ◀◀  ◀  ▶  ▶▶   1×                    09:00        10:00        11:00             ● now  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- The **top bar** shows one chip per workstream, plus counts that open the
  inbox.
- The **graph** is the centre: the shaded zone is where two workstreams
  overlap, and `⏸` marks a breakpoint on `payments/`.
- In the **timeline**, `⏸━━━` is a live wait. It grows until someone
  answers.

---

## 2. The quiet state

Most of the time, nothing needs you. Collapse everything and it's the
graph and one line.

```
┌─ CodeTrellis ─ acme-payments ───────────────────────────────────────────────────────────┐
│ ▶auth-refresh  ▶billing-v2  ▶checkout-fix  ▶exports                     all quiet ✓     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│            ┌─────────┐           ┌──────────┐           ┌──────────┐                    │
│            │  auth/  │───────────│ billing/ │───────────│   web/   │                    │
│            └─────────┘           └──────────┘           └──────────┘                    │
│                  │                     │                      │                         │
│            ┌─────────┐           ┌──────────┐           ┌──────────┐                    │
│            │payments/│           │ exports/ │           │  shared/ │                    │
│            └─────────┘           └──────────┘           └──────────┘                    │
│                                                                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ 4 agents working · 0 need you · 37 tests passing · last merge 10:42      ▴ show panels  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Clicking a collision zone

The zone opens a side-by-side of both workstreams. Everything else
filters to these two.

```
┌─ ⚠ Collision zone ─ billing/invoice.ts › createInvoice() ─────────────── open 38 min ──┐
│                                                                                        │
│  billing-v2  (JIRA-142, Claude Code)          checkout-fix  (JIRA-150, Codex)          │
│  ──────────────────────────────────           ────────────────────────────────         │
│  CHANGED the inputs:                          USES it in 2 files:                      │
│    createInvoice(opts)                          checkout/submit.ts                     │
│  → createInvoice(opts, currency)                checkout/retry.ts                      │
│                                                                                        │
│  Told at 10:14 ✓  "noted, will keep           Told at 10:15 ✓  "will update both       │
│  the old signature as a default"               callers after billing merges"           │
│                                                                                        │
│  Suggested order:  merge billing-v2 first → checkout-fix updates → merge               │
│                                                                                        │
│  [Open both diffs]   [Message an agent]   [Mark intended]   [Dismiss]                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. A breakpoint fires

Sam set "ask me before touching `payments/`". An agent's claim is paused
until they answer.

```
┌─ ⏸ Breakpoint ─ payments/ ────────────────────────────────────────── waiting 4 min ──┐
│                                                                                      │
│  billing-v2 (Claude Code) wants to change:                                           │
│      payments/refund.ts   ›  calculateRefund()                                       │
│                                                                                      │
│  Why (from the agent):                                                               │
│      "Refunds must use the invoice currency now that invoices carry one."            │
│                                                                                      │
│  Breakpoint set by Sam · 23 Sep · "ask me before touching payments"                  │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Steer (optional): only change the currency lookup, not the rounding rules_     │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  [Continue]   [Continue with steer]   [Stop]            Recorded for audit ✓         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

And when an agent without hook support edits there anyway. This is the
honest version:

```
┌─ ⚠ Breach ─ payments/ ───────────────────────────────────────────────────── 10:51 ──┐
│  exports (aider) edited payments/refund.ts without stopping.                        │
│  This agent can't be paused before editing; it has been told to stop and wait.      │
│  [Review the edit]   [Revert]   [Allow]                                             │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. An agent proposes a spec change

Conferring: one agent's finding, every affected plan's answer, one
decision.

```
┌─ ✎ Spec change proposed ─ "Invoice format" › Fields ──────────────────────── 11:02 ──┐
│                                                                                      │
│  From billing-v2 (JIRA-142)                                                          │
│  Change:  add a required `currency` field (ISO 4217)                                 │
│  Why:     amounts are ambiguous for EU customers                                     │
│  Evidence: ✗ test invoice_eu.spec — "expected EUR, got undefined"                    │
│                                                                                      │
│  AFFECTS                                          THEIR AGENT SAYS                   │
│  ─────────────────────────────────────────────    ─────────────────────────────────  │
│  JIRA-150 Checkout fix  · "Submit flow"           ✓ no change needed                 │
│  JIRA-155 Exports       · "CSV columns"           ◐ needs a new column (~1 task)     │
│  JIRA-160 Reporting     · not started             ○ no agent yet                     │
│                                                                                      │
│  [Accept]   [Amend]   [Reject]   [Ask billing-v2]                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Replay: catching up

The cursor is in the past. Everything shows that moment, and the chrome
says so.

```
┌─ CodeTrellis ─ acme-payments ────────────── ◀ REPLAY  10:14:32 ▸ ─ back to live ⏎ ──────┐
│ Showing 10:14:32 · comparing with 09:00 (when you left) · 4× · frame 23 of 61           │
├─ STACK @10:14 ─────────┬─ GRAPH @10:14 ────────────────────────┬─ INBOX @10:14 ─────────┤
│ JIRA-142  ██████░░░░   │                                       │ ⚠ new: collision on    │
│  ▶ Currency billing-v2 │     ░░░░░░░░░░░░░░░░░░░░░░░░░░        │ createInvoice()        │
│ JIRA-150  ███░░░░░░░   │     ░ ⚠ zone opens here     ░         │   (opened 10:14)       │
│  ▶ Submit checkout-fix │     ░  billing/invoice.ts   ░         │                        │
│ JIRA-151  █████████░   │     ░░░░░░░░░░░░░░░░░░░░░░░░░░        │ 0 waiting on you       │
│                        │                                       │   at this moment       │
├─ TIMELINE ─────────────┴───────────────────────────────────────┴────────────────────────┤
│ auth-refresh  ●──●───●●───◆───────────●──✓                                              │
│ billing-v2    ●───●──●──⚠──●──●──⏸━━━━━━━━━━━━━━━━━                                     │
│ checkout-fix  ────●──●──⚠───●●──●──●                                                    │
│                         ▲ 10:14                                                         │
│ ◀◀  ◀  ⏸  ▶▶   4×      ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░         ● now      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Play forward: what the plans will do

From now, into the planned future. Dashed means not real yet.

```
┌─ CodeTrellis ─ acme-payments ─────────── ◇ PLAYING FORWARD  now → all plans done ───────┐
│ Planned by 4 active plans · nothing here exists yet                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│      ┌──────────┐          ┌ ─ ─ ─ ─ ─ ─ ┐          ┌──────────┐                        │
│      │ billing/ │─ ─ ─ ─ ─ ◇ currency/   ◇ ─ ─ ─ ─ ─│ exports/ │                        │
│      └──────────┘          └ ─ ─ ─ ─ ─ ─ ┘          └──────────┘                        │
│            │                                             │                              │
│      ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                │                             │
│      ◇ ◇ planned overlap                  ◇               │                             │
│      ◇ JIRA-142 and JIRA-155 both plan to ◇  ─ ─ ─ ─ ─ ─ ─┘                             │
│      ◇ change exports/csv.ts              ◇                                             │
│      └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                                              │
│                                                                                         │
│  [Re-sequence these plans]   [Tell both agents]   [Fine, leave it]                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Grounding on the graph

Tests linked to the code they cover. The last row is the one that
catches stale claims.

```
┌─ GRAPH ─ layers: [✓ tests] [ workstreams] [ zones] [ plan] ─────────────────────────────┐
│                                                                                         │
│   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐                    │
│   │ billing/         │   │ checkout/        │   │ payments/        │                    │
│   │ ✓ 12 passing     │   │ ✗ 2 failing      │   │ ○ no tests       │                    │
│   └──────────────────┘   └──────────────────┘   └──────────────────┘                    │
│                                                                                         │
│   ┌──────────────────┐                                                                  │
│   │ exports/         │   ⚠ tests older than the code: last run 09:40,                   │
│   │ ⚠ 6 passing,     │     csv.ts changed 10:55 by exports agent                        │
│   │   out of date    │                                                                  │
│   └──────────────────┘                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. The review queue

End of day: what's ready, and in what order.

```
┌─ REVIEW ─────────────────────────────────────────────────────────────────────────────────┐
│  Suggested merge order                                                                   │
│                                                                                          │
│  1  auth-refresh   JIRA-151   ✓ criteria 4/4   ✓ no serious warnings   ◆ merged 10:42    │
│  2  billing-v2     JIRA-142   ✓ criteria 3/3   ✓ no serious warnings   [Review]          │
│       → first because checkout-fix uses what it changes                                  │
│  3  checkout-fix   JIRA-150   ◐ criteria 2/3   ⚠ 1: update callers after #2              │
│  4  exports        JIRA-155   ○ criteria 0/2   ⚠ tests out of date                       │
│                                                                                          │
│  Each review includes "Other work in flight" and the decisions made along the way.       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. On the phone

Glance and decide. No graph, no scrubbing.

```
┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│ acme-payments        ⚙    │   │ ← Breakpoint              │   │ ← Last hour               │
│                           │   │                           │   │                           │
│ NEEDS YOU (2)             │   │ ⏸ payments/               │   │ auth-refresh              │
│ ┌───────────────────────┐ │   │                           │   │  ◆ merged 10:42 ✓         │
│ │⏸ billing-v2 wants to  │ │   │ billing-v2 wants to       │   │                           │
│ │  change payments/     │ │   │ change refund.ts          │   │ billing-v2                │
│ │  refund.ts      4m    │ │   │                           │   │  ⚠ collision 10:14        │
│ └───────────────────────┘ │   │ "Refunds must use the     │   │  ⏸ waiting on you         │
│ ┌───────────────────────┐ │   │ invoice currency now."    │   │                           │
│ │✎ Spec change:         │ │   │                           │   │ checkout-fix              │
│ │  Invoice format       │ │   │ Steer:                    │   │  ⚠ collision 10:14        │
│ │  3 plans affected     │ │   │ ┌───────────────────────┐ │   │  12 edits                 │
│ └───────────────────────┘ │   │ │ currency only, not    │ │   │                           │
│                           │   │ │ rounding_             │ │   │ exports                   │
│ WORK                      │   │ └───────────────────────┘ │   │  ⚠ tests out of date      │
│  4 agents · ⚠ 1 zone      │   │                           │   │                           │
│  JIRA-142  ████████░░     │   │ [ Continue ]              │   │                           │
│  JIRA-150  ████░░░░░░     │   │ [ Continue with steer ]   │   │                           │
│  JIRA-151  ✓ merged       │   │ [ Stop ]                  │   │                           │
└───────────────────────────┘   └───────────────────────────┘   └───────────────────────────┘
      Home: Needs you                 Tap → decide                     Glance at activity
```
