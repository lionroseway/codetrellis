# Phase 22 — Agent activity clarity

> Drafted: 2026-09-17
> Status: designed, not built
> Blocks: [Phase 23](PHASE-23-BUDGETS.md) — budgets attribute time to
> the turn grouping introduced here.

---

## 1. The problem

The data is good. The reading of it is bad.

Every MCP tool call from every agent already broadcasts an
`agent-event` with `{ tool, args, phase, durationMs, sessionId,
agentType, agentModel }` (`src/backend/mcp/server.ts`). The Timeline
renders them. `ConnectedAgents` shows a count and a popover.

What a user sees is a flat stream of tool names — `get_item`,
`get_item`, `search_symbols`, `update_item`, `get_next_item` — from
which they are expected to infer what the agent is *doing* and whether
it is *going well*. Nobody does that inference. They watch it scroll,
learn nothing, and close the panel.

Three changes fix it. None require new data collection.

## 2. Change A — group calls into turns

An agent reads three files, greps, edits two, runs a test. That is one
intention and seven rows.

Group consecutive events from the same `sessionId` into a **turn** when
the gap between them is under a threshold (start at 30s, make it a
constant not a setting). Render one card:

> **Claude Code** · edited 2 files in `auth/` · 7 calls · 41s
> *Add refresh-token rotation* ▸

Expandable to the raw rows, which stay exactly as they are today. The
grouping is a view concern — do not throw away or rewrite the
underlying events, because the Timeline's value in a post-mortem is
that it is complete.

`stuck-sensor-service.ts` already maintains a per-session window of
recent calls; the windowing concept exists and can be borrowed, but
keep the two separate — the sensor's window is tuned for loop
detection, not display.

### Summarising a turn

Derive the headline from the calls, in priority order:

1. **Mutating tools win over reading tools.** `update_item`,
   `add_item`, `post_channel_event` describe intent; `get_item` and
   `search_symbols` are how the agent got there.
2. **File changes win over everything.** If the file watcher saw writes
   during the turn's window, lead with those — that is the thing that
   changed the world.
3. Fall back to a call count and the dominant tool.

## 3. Change B — say what it means, not what was called

A row should read as a sentence about the work:

| Today | Instead |
|---|---|
| `update_item {"uid":"itm_4f…","status":"in_progress"}` | Started **Add refresh-token rotation** |
| `claim_item {"uid":"itm_91…"}` | Claimed **Rotate signing keys** |
| `post_channel_event {"type":"need-decision"…}` | Asked for a decision on **Token TTL** |
| `search_symbols {"query":"validateToken"}` | Looked for `validateToken` |

This is a lookup table from tool name to a template, living next to the
tool definitions so a new tool that ships without a phrasing is
obvious. Unknown tools fall back to the raw name — degrade, don't
crash.

The raw JSON stays available behind a disclosure. Power users and
bug reports need it.

## 4. Change C — a live, in-scope status line per agent

This is the one that changes behaviour rather than comfort.

`ConnectedAgents` currently answers "how many agents are connected".
The question a user actually has is **"what is it doing right now, and
is that what I asked for?"**

Per connected agent, show:

- agent type and model
- the item it has claimed (already tracked — `claim_item`,
  `set_active_plan`)
- files touched in the last 60s (from the file watcher)
- **an in-scope badge**: green when every touched file is in the active
  item's `fileSpecs`, amber when some are not, with the out-of-scope
  files listed

The amber case is the product's whole thesis made visible. We compute
drift already (`deviation-service`, `plan-changes-service`), but it is
framed as an after-the-fact report. The same data, framed as *this
agent, right now, is editing files nobody planned for*, is the thing a
user would leave open on a second monitor.

Pair it with one action: **"add to plan"** or **"flag"**. A signal with
no adjacent action trains people to ignore the signal.

## 5. Change D — an idle state that says something

When nothing is happening, the panel currently shows nothing, which is
indistinguishable from broken. Show the last turn's summary plus a
relative timestamp: *"Last activity 4 minutes ago — edited 2 files in
`auth/`"*. `power-service` already knows about sleep/wake, so an agent
quiet because the machine slept can say so.

## 6. Scope discipline

This phase is **presentation only**. No new tables, no new MCP tools, no
new broadcast types. If a change here needs a schema migration, it has
escaped its scope — move it to Phase 23, which is where new storage
legitimately belongs.

The one exception worth allowing: persisting turn boundaries if
recomputing them on every render proves too slow on a long session.
Measure first.

## 7. Tests

Mostly harness-level, driving the scripted MCP agent from
`tests/harness/`:

1. Calls within the window group into one turn; a gap splits them.
2. Concurrent agents never cross-attribute (this was a real bug once —
   see `inferAgentFromSession`'s comment — so it deserves a standing
   test).
3. A mutating call outranks reads in the turn headline.
4. An agent editing a file outside the claimed item's `fileSpecs`
   produces the amber state; editing an in-scope file produces green.
5. An unknown tool name renders rather than throwing.

## 8. Done when

- A 20-minute agent session reads as ~10 turn cards, not 200 rows.
- A user can answer "is it doing what I asked?" from the panel alone,
  without opening the plan.
- Learn Trellis's "agents" cluster gains a step showing the in-scope
  badge, since it is now the main thing to look at.
