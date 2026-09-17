# Phase 23 — Time and cost budgets

> Drafted: 2026-09-17
> Status: designed, not built
> Depends on: [Phase 22](PHASE-22-AGENT-ACTIVITY-CLARITY.md) turn grouping.

---

## 1. What this is

Three numbers on every plan item, and one consequence.

| Number | Source | Confidence |
|---|---|---|
| **Estimate** | Authored — by a human at plan time, or by an agent via `update_item` | Whatever the author's is |
| **Actual** | Measured — `durationMs` on every MCP tool event, plus token `usage` from the Claude Code session JSONL | High for time, exact for Claude |
| **Forecast** | Derived — actual-so-far projected against the item's satisfied-change ratio | Rough, and labelled rough |

The consequence is a **ceiling**: a plan can declare a budget, and
crossing it fires a channel event, a push, and — optionally — a gate
that an agent must not proceed past.

## 2. Why it belongs here and not in an agent

Agents can count their own tokens. What they cannot do is answer "how
much has *this plan* cost across three agents and two days, and which
item ate it." CodeTrellis sits at exactly the join — it is the only
component that sees every agent's calls attributed to a shared plan.
That makes this a structural advantage, not a feature.

## 3. Data

### Time — works for every agent

Every `agent-event` already carries `durationMs`. Summing tool time
undercounts badly, though: an agent's wall-clock includes model
thinking between calls, and that is most of it. Use the **turn** from
Phase 22 as the unit — first call to last call, plus the tail — and sum
turns attributed to the claimed item. That is honest wall-clock and it
works for Codex, Cursor, aider and anything else that speaks MCP.

Guard against the machine sleeping mid-turn: `power-service` knows, and
a 14-hour "turn" because the laptop closed is the obvious first bug.

### Cost — works where the agent reports it

Claude Code's session JSONL carries usage; the watcher already tails
it. For every other MCP client we have no token data and must not
invent it.

So the rule, stated plainly in the UI: **time for everyone, cost where
the agent reports it.** An item worked by a non-reporting agent shows
its time and a dash for cost, with a tooltip saying why. Fabricating a
dollar figure from a token estimate would be the single fastest way to
lose a user's trust in every other number we show.

Pricing itself must be a data table, versioned and visible in Settings,
never hardcoded in a service — prices change, and a stale multiplier
silently corrupts every historical figure.

### Storage

New columns on plan items (`estimate_minutes`, `estimate_cost`), and a
new `item_time_entries` table: `(item_uid, session_id, agent_type,
started_at, ended_at, tokens_in, tokens_out, cost)`. One row per turn.
Roll up on read; do not maintain a denormalised total that can drift
from its rows.

Per the Phase 19 rules: the writer derives `item_uid` from the claiming
session's stored state, **never from a request body**, and the MCP tool
that sets an estimate authorises per tool by capability like every
other.

## 4. Surfaces

- **Item chip** — `~2h` estimate, `1h 40m · $3.10` actual once work
  starts, amber past 1.5× estimate, rose past 2×.
- **Plan header burn-down** — spent vs. budget, plus forecast-to-finish.
  A sparkline of spend per day if the plan runs long.
- **`PlanCompletionSummary`** — the retrospective: *planned 4h / $8,
  actual 6h 20m / $14.40, 3 of 11 items over estimate*. This is the
  screen that makes the next plan's estimates better.
- **Per-agent attribution** — when three agents work one plan, who spent
  what. Falls straight out of the table.

## 5. Budgets as governance

The governance primitives already exist — `set_freeze`, `check_freeze`,
`approve_gate`. A budget ceiling is the same shape:

1. A plan declares `budget: { minutes, cost }`.
2. At 80%, a `need-decision` channel event fires and pushes to the
   phone.
3. At 100%, `check_budget` (new, mirrors `check_freeze`) returns
   `false`, and a well-behaved agent stops and asks. The MCP skill
   resource tells agents to call it before claiming an item.
4. A human can raise the ceiling or exempt the plan, exactly as with
   freeze exemptions.

This is deliberately **advisory, not enforced** — the same posture as
the stuck sensor. We do not have a mechanism to halt an agent, and
pretending we do would be worse than honest advice. Say so in the docs.

The prize: *"let it run overnight, stop at $20"* becomes a sentence a
user can act on. That is what makes an autonomous agent feel safe to
leave alone, and it is worth more than the reporting.

## 6. Estimation help

Once there is history, estimates can be seeded rather than guessed:
"items touching 3–5 files in this repo have averaged 45 minutes." One
number, from this project's own data, shown as a placeholder the author
can overwrite. No model call, no cross-project data, nothing leaves the
machine.

Do not ship this before there is history to draw on — an average over
four items is noise wearing a suit.

## 7. Tests

1. Turn time sums into the claimed item; unclaimed time is attributed
   to the plan, not silently dropped.
2. A sleep/wake cycle mid-turn does not produce a fantasy duration.
3. Claude sessions produce token and cost figures; a generic MCP
   session produces time and a null cost, never a zero.
4. Crossing 80% fires exactly one event, not one per call.
5. `check_budget` returns false past the ceiling and true for an
   exempt plan.
6. Rollups match the sum of their rows after out-of-order turn writes.

## 8. Done when

- A real plan worked by a real agent reports a time and cost the user
  recognises as roughly right.
- The completion summary shows planned vs. actual for both.
- A ceiling fires on the phone before it is crossed, with an action
  attached.
