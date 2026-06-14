# UX Audit — Channels / Messages / Plan Workspace (v0.1.7)

> **Status:** Findings from a live UX-driving session on **2026-06-13/14**.
> **Goal of session:** First real UX pass since v0.1.7 shipped. Drive the running
> desktop app via MCP, walk the human-facing flows, and surface friction —
> especially around **channel events, threaded messages, and message groups**.
> **This doc is the handoff artifact** — written to be picked up cold in a fresh
> context window. It contains the environment, exact UIDs, repro steps, and
> recommended fixes for everything found.

---

## ⓘ Implementation status (updated 2026-06-14)

A first round of fixes has landed in source (typecheck clean; not yet rebuilt
into a packaged binary, so verify after `npm run build` / a dev run).

| Finding | Status | Where |
|---|---|---|
| **F1** badge/signal for open events | ✅ done | `PlanWorkspaceShellV2.tsx` — amber count badge on Channel button + channels hydrate on plan load (badge works while panel closed) |
| **F3** open-first sort + filter | ✅ done | `ChannelPanel.tsx` — open roots sort to top; "Open / All" filter toggle |
| **F4** clickable decision options | ✅ done | `ChannelPanel.tsx` — open decision options are buttons; choosing posts a steer + resolves |
| **F5** anchor chip on cards | ✅ done | `ChannelPanel.tsx` — anchored item shown as a chip; click jumps to the item |
| **F7** comments composer order | ✅ done | `PlanItemCanvas.tsx` — composer now renders below the thread |
| **F8** undo on resolve/dismiss | ✅ done (reopen) | `ChannelPanel.tsx` — resolved/dismissed roots get a "Reopen" button (no destructive one-click left without an escape hatch) |
| **F12** title clips mid-word | ✅ done | `PlanWorkspaceShellV2.tsx` — added `min-w-0` + hover `title` so it ellipsizes |
| **F13** contradictory progress | ✅ done | `PlanWorkspaceShellV2.tsx` — toolbar now derives `done/total` from the live V2 item tree (kind==='action'), matching the progress card |
| **F2** feed not live | ⏬ **downgraded — likely a test artifact** | plumbing traced end-to-end and is correct (see revised §3 F2). No code change. |
| **F14** unlabeled 44% pill | ➖ already has a tooltip | `PlanReadinessRing.tsx` already sets `title="Plan readiness: N% — …"`; left as-is. Optional: add a visible label. |
| **F9** `select_item` stale-by-one | ✅ done | `useWebSocket.ts` — `ui-select-item` now awaits reset+hydrate then applies the selection on the next frame, after the shell's reset effect |
| **F10** no MCP tool opens Channel/History | ✅ done | `toggle_panel` enum extended to `channel`/`activity`/`history` (`session-tools.ts`); `ui-toggle` handler + a `toggle-history-rail` window event (`useWebSocket.ts`, `PlanWorkspaceShellV2.tsx`); `ui-nav` guide updated |
| **F11** `navigate_to('timeline')` no-op | ✅ done | `useWebSocket.ts` — `timeline` now opens the plan workspace **and** the activity feed (distinct from `plan`) |
| **F6** item-comments ↔ channel decisions | 🟡 piece 1 done | **Decision: cross-link, don't merge** (honors the locked D1 "separate tables" decision; the item is the join key). Piece 1 shipped: `PlanItemCanvas.tsx` `ItemChannelBand` surfaces open Channel events anchored to the item + opens the panel. Follow-ups: (2) "Escalate to Channel" from a blocker/question comment + auto-unblock on resolve; (3) intent-clarifying copy. |

Verify the visual fixes by rebuilding (`npm run build`) or a dev run
(`npm run dev`) — source edits don't appear in the already-running packaged app.

---

## 0. How to resume this audit (read first)

**Environment observed this session:**
- Desktop was a **packaged production build** (Electron). Only **Express `:3001`**
  was listening; **Vite `:5173` was NOT** running. The renderer is served
  in-process to Electron, so **Playwright / browser automation cannot attach** —
  there is no `localhost:5173` UI to drive.
- Driving was done entirely through the **`codetrellis` MCP server** (SSE on
  `:19432`, status bar showed "Connected"). Screenshots via `mcp__codetrellis__screenshot`.
- Project: `/Users/saif/Workspaces/AILAR/codetrellis`, branch `dev/saif`
  (the project tab later showed `master` — see note in §6).

**If you want full click-level control next time:** quit the packaged app and run
`npm run dev` so Vite serves `:5173`, then attach Playwright to
`http://localhost:5173`. The Express backend (`:3001`, sql.js) holds all state,
so a dev renderer talks to the same data. Otherwise you're limited to the MCP
nav tools, several of which are unreliable (see §4).

**Key MCP tools used:** `open_project`, `open_plan`, `list_plans`,
`list_items`, `list_channel_events`, `post_channel_event`,
`get_channel_thread`, `resolve_channel_event`, `dismiss_channel_event`,
`list_item_comments`, `select_item`, `navigate_to`, `toggle_activity_drawer`,
`refresh_ui`, `screenshot`. The `ui-nav` flavor of `get_app_guide` documents the
intended driving toolset.

**To re-open the exact state:**
1. `open_project("/Users/saif/Workspaces/AILAR/codetrellis")`
2. `open_plan("a69842bf-a916-421e-b2a1-162ad6ccf269")` — the showcase plan
3. Click the **`Channel`** button (top-right of plan toolbar) — **there is no MCP
   tool to open this panel; a human must click it** (this is itself finding F10).

---

## 1. Reference data (plans, items, channel events)

### Plans in this project
| Title | UID | Items | Notes |
|---|---|---|---|
| Add MCP health-check (ping) tool | `dc3cad6e-8937-4be6-ad6b-97aadd3e01e2` | **0** | empty draft |
| Update README install instructions | `7f610f8d-37d3-4f67-8eb8-f729438fd673` | **0** | empty draft |
| **Realtime Collaboration Sync (showcase)** | `a69842bf-a916-421e-b2a1-162ad6ccf269` | 7 | the test bed; rich content + channel events across all 6 types |

> Two of three plans are **zero-item drafts**. Worth deciding whether empty
> drafts should be prunable / flagged in the Plans list.

### Showcase plan items (UIDs for repro)
| Title | UID | Kind | Status |
|---|---|---|---|
| Architecture context | `6703a480-3ee4-41c1-ba9f-8d65b4e5517b` | object (page) | — |
| WebSocket presence channel | `24bd39d9-5a12-414f-8515-1577b47eb157` | action | in_progress |
| Server: presence broadcast loop | `a45229b0-1071-472e-bdd2-83fdad66cd7d` | action | done |
| Client: presence Zustand store | `64bbbd0f-99ea-42a6-b75e-2ca9c92c9dbf` | action | in_progress |
| Cursor & selection overlay | `d4800899-5c9a-4c43-b941-89f855b529b8` | action | pending |
| **Conflict-free plan edits (CRDT)** | `b328baf9-4863-4acf-81bb-2ff7abab032e` | action | **blocked** |
| Open questions | `298b994a-a7c8-43f5-9690-2307d82b23ef` | object (page) | — |

### Pre-existing channel events on showcase plan (before this session)
All authored by `saif@ailar.ai` / `claude-code`.
| Type | UID | Status | Note |
|---|---|---|---|
| need-decision | `71828bb5-...` | open | "Yjs or Automerge?" — **anchored to CRDT item** `b328baf9` |
| weigh-in | `3b45815a-...` | open | "Leaning Yjs…" |
| stuck | `7c7ad1d1-...` | open | "Remote cursors drift ~40px…" (has `attempted[]`) |
| need-context | `ac3db4a0-...` | open | "Where does WebRTC mesh expose per-peer fingerprints?" |
| weigh-in | `2e82c9d3-...` | dismissed | "[demo] Probing whether channel posting works…" |
| need-decision | `55a58000-...` | resolved | "Push test ✅ … last-write-wins or CRDT merge?" |
| need-decision | `bec8052e-...` | resolved | "Push test (build 19) 🔔 … deep-link" |

### Item comments (the *other* messages surface)
- CRDT item `b328baf9` → 1 comment, kind `blocker`: *"Blocked on the
  Yjs-vs-Automerge decision…"* — **same topic as the channel need-decision above,
  but a separate thread** (see F6).
- WebSocket presence item `24bd39d9` → 2 comments: kind `progress` ("Server fan-out
  loop is live at 20Hz…") and kind `question` ("Should presence deltas ride the
  `control` channel or get their own?").

### Test events created during this session — **already cleaned up**
- `2c0922e3-...` need-decision ("badge probe") → **dismissed**
- `cb31a447-...` steer (reply to Yjs decision) → **dismissed**
- `b73a3b71-...` stuck ("live-update probe") → **resolved** (via UI ✓ click)

No residual test noise should remain in "open" lists.

---

## 2. Channel taxonomy & layout (as built)

The Channel panel (right rail, opened via the toolbar `Channel` button) has:
- **Composer at top.** Event type chips grouped into two rows:
  - **ASK:** `Stuck` · `Decision` · `Context`
  - **OFFER:** `Steer` · `Weigh-in` · `Handoff`
  - (maps to the 6 MCP types: stuck / need-decision / need-context / steer /
    weigh-in / handing-off)
  - An **anchor dropdown** ("No anchor" → pick a plan item), a textarea whose
    **placeholder adapts to the selected type**, `⌘+Enter to post`, `Post` button.
- **Feed below**, newest-activity first. Each card: type label, author
  (`saif@ailar.ai's claude-code`), status badge (`Open`/`Resolved`/`Dismissed`),
  tiny inline **`✓` resolve / `✕` dismiss** icons, body, options (for decisions),
  timestamp, and a per-card **`↩ Reply`**.
- **Replies render nested/indented** under the parent with an accent bar.
- Panel header shows a count: `Channel (N)`. A **manual ↻ refresh** lives in the
  header.

---

## 3. FINDINGS — Channels & messages (priority order)

### 🔴 F1 — No pending signal anywhere outside the Channel panel
With **6+ open** channel events (including blocking decisions):
- the toolbar **`Channel` button shows no count/badge**,
- **no toast** fires on a new event,
- the **"Activity" pane (labeled *Live*) does NOT include channel events** — it
  only lists item-creation activity.
The only count is *inside* the Channel panel header, which you must already be
viewing. **A human has no way to know a decision is waiting.** Highest-impact gap.
**Repro:** sit on the plan with Channel closed → `post_channel_event(... need-decision)`
→ observe no badge/toast (verified, incl. after `refresh_ui`).
**Fix:** badge the `Channel` toolbar button with open-event count; toast on new
open events (respect the existing notification/presence bus); optionally fold
channel events into the Activity "Live" stream.

### ⏬ F2 — "Channel feed is not live" — DOWNGRADED (likely a test artifact)
Original observation: posted a `stuck` with the panel open → nothing appeared
until `refresh_ui`. **On investigation the live-update plumbing is correct
end-to-end**, so this was most likely a screenshot race (capture taken in the
sub-second before the IPC→refetch→render chain finished), not a broken feature.
Traced path:
- `post_channel_event` (MCP) → `channel-tools.ts:96` `deps.broadcast('channel-event-posted', {planUid,…})`.
- `deps.broadcast` **is the same** central `broadcast` (`server.ts:182`) the HTTP
  route uses — `mcp/server.ts:20` imports it; passed as a dep at `mcp/server.ts:197`.
- Packaged desktop loads via `file://`, so the renderer's `new WebSocket('ws://…')`
  is monkey-patched by `electron-ipc-shim.ts` → `IpcBroadcastWebSocket`, sourcing
  messages from `codetrellisIpc.onWsEvent` (`preload.ts:50`), fed by
  `attachBroadcastForwarding` → `addBroadcastTarget` (`main.ts:118`).
- `useWebSocket.ts` handles `channel-event-posted` → `channels-store.onEventPosted`
  → refetch → re-render. Payload shape (`planUid`) matches the store's guard.
**So the real gap was never "no live update" — it was "no signal" (F1).** With the
F1 badge now live (it refetches on the same WS event), a new open event is
visible immediately whether or not the panel is open. Re-verify after a rebuild;
if a genuine lag remains, the suspect is WS/IPC delivery latency, not missing wiring.

### 🔴 F3 — Feed sort ignores status; open items don't float up
Sort is **most-recent-activity, descending**, with **no status weighting and no
"open only" filter** in the panel. Consequences observed:
- A 9-day-old **open** `need-context` sat **below resolved + dismissed** items.
- After resolving a card, the **`Resolved` card stayed pinned at the top**, above
  a still-**`Open`** decision.
"What needs my attention" is effectively buried.
**Fix:** add a status filter (Open / All / Resolved) and/or a sort that floats
open+actionable above resolved/dismissed. The MCP `list_channel_events` already
supports `status` filters — surface that in the UI.

### 🟠 F4 — `need-decision` options are display-only
Decision options (`1. Yjs… 2. Automerge…`) render as greyed text with **no
click-to-choose**. To answer you must `↩ Reply` with a freeform steer **and then
separately** resolve — two manual steps for what visually looks like a pick-one.
**Fix:** make options selectable; selecting one posts the choice + resolves (or
prompts to resolve) in one action.

### 🟠 F5 — Anchored events don't show their anchor
The Yjs `need-decision` is anchored to CRDT item `b328baf9`, but the **card gives
no indication** of that. You can't distinguish a plan-global event from an
item-scoped one in the feed, and can't jump to the anchored item from the card.
**Fix:** show an anchor chip (↳ item title) on anchored cards; click → select item.

### 🟠 F6 — Two parallel conversations about the same thing, never linked
The CRDT item is `Blocked` with a **blocker comment** ("Blocked on
Yjs-vs-Automerge") **and** the Channel has a **need-decision** on the exact same
question anchored to that item. The item view doesn't surface the channel
decision; the channel card doesn't surface the item thread. Two overlapping
comment systems:
- **Item comments:** kinds `Note / Progress / Blocker / Question`, source agent/human.
- **Channel events:** 6-type ASK/OFFER vocabulary.
A human must mentally join them. **Decide the intended relationship** between
item-comments and channel-events (merge, cross-link, or clearly differentiate).

### 🟡 F7 — Item comment composer sits above existing comments
On `COMMENTS · 1`, the composer ("Note for the room…", 4 kind tabs) occupies the
prime space and pushes the single existing comment below the fold.

### 🟡 F8 — No confirm/undo on resolve & dismiss
The inline `✓`/`✕` icons are **tiny** and act on a single click with no
confirmation or visible undo. Easy to mis-resolve. (Resolve itself works and
gives immediate `Open → Resolved` green-badge feedback — that part is good.)

---

## 4. FINDINGS — MCP driver-tool fidelity (affects narration / mobile story)

The `ui-nav` guide positions a sub-agent driving the UI during walkthroughs.
Several documented tools were unreliable this session:

### 🟡 F9 — `select_item` updates the canvas one selection behind (stale-by-one)
- 1st `select_item(CRDT)` → **canvas did not change** (stayed on plan overview).
- 2nd `select_item(Architecture context)` → **canvas showed the CRDT item** (the
  *previous* request). The 3rd action finally showed Architecture context.
Reproducible off-by-one in the select→render pipeline.

### 🟡 F10 — No MCP tool opens the `Channel` or `History` panels
`navigate_to` only supports `plan/graph/split/timeline`; `toggle_panel` only
`sidebar/inspector/terminal/split`. **Nothing opens Channel or History.** A
narration sub-agent literally cannot show a human the pending decisions —
directly undercuts the collaboration/walkthrough use case.
**Fix:** add a nav target / tool to open Channel + History (and ideally select a
specific event).

### 🟡 F11 — Visual no-ops
- `navigate_to('timeline')` produced **no visible change** vs the plan view.
- `toggle_activity_drawer()` produced **no visible change** (Activity pane was
  already open; toggle didn't close it).

---

## 5. FINDINGS — Plan workspace polish

### 🟡 F12 — H1 title clips mid-word
Heading renders **"Realtime Collaboration Sync (sh"** instead of ellipsizing
"…(showcase)". Hard clip, no ellipsis.

### 🟡 F13 — Contradictory progress numbers
Toolbar chip reads **`0/0 actions · 0%`** while the progress card reads
**`20% · 1/5 tasks done`** with a 5-item breakdown (1 done, 2 in progress, 1
blocked, 1 pending). "actions" vs "tasks" terminology mismatch **and** a count
bug (toolbar thinks there are 0).

### 🟡 F14 — Unlabeled `44%` ⏱ pill
A red **`44%`** pill with a clock icon sits next to "Hand off" with no label or
tooltip. Meaning ambiguous (context budget? time? battery?). Needs a label/tooltip.

---

## 6. Notes / things to verify, not yet findings

- **Timestamps are fine.** Cards briefly showed "11h ago" for minutes-old events,
  but the createdAt→updatedAt deltas confirmed **~11.2h of real elapsed session
  time** (the clock genuinely advanced across the day rollover). **Not a bug** —
  do not chase this.
- **Project tab branch label** changed from `dev/saif` (start) to `master` later
  in the session, while an **embedded terminal** was running a *different* repo
  (`~/Workspaces/opensource/opencues`). Likely the branch indicator was reflecting
  the focused terminal's cwd rather than the open project — **worth confirming**
  the project tab's branch chip tracks the *project*, not the active terminal.

---

## 7. What works well (keep)

- **Inline reply composer** is good: opens contextually under the card with
  **response-types correctly scoped** (`Steer / Weigh-in / Handoff / Context` —
  no "Stuck"/"Decision"; you can't reply to a stuck *with* a stuck). Inline
  `Post`/`Cancel`.
- **ASK / OFFER** grouping of the 6 event types is a clean mental model;
  composer placeholder adapts to selected type.
- **Threading renders** clearly (nested, accent bar, per-card reply).
- **Status badges** + inline resolve/dismiss are present; resolve gives instant
  feedback.
- **Item-detail view is rich:** status dropdown, Gate, Targets (CREATE/MODIFY
  files), Context files, External-reference chips, typed comments.
- **Empty-page nudge:** "✨ This page needs more context… Tip: ask your AI agent
  to suggest the anchors." Nice guidance affordance.
- The data layer is solid: `post_channel_event`, `responds_to` threading,
  `get_channel_thread`, resolve/dismiss lifecycle, item-anchoring all behaved
  correctly. **The weakness is surfacing/discoverability, not the model.**

---

## 8. Recommended fix order (highest leverage first)

1. **F2** make the Channel feed live (push to open panel).
2. **F1** Channel badge + toast for new open events.
3. **F3** status filter / open-first sort.
4. **F6** reconcile item-blocker comments with anchored channel decisions
   (cross-link + show anchor — also closes F5).
5. **F10** MCP tool to open Channel/History (unblocks narration walkthroughs).
6. **F4** click-to-choose decision options.
7. Polish: **F12 / F13 / F14**, then **F7 / F8 / F9 / F11**.

---

## 9. Suggested next actions

- Turn F1–F6 into tracked plan items (a "v0.1.x — Channel UX" plan) or channel
  `need-decision`s so they live in-app.
- Re-run this audit in **dev mode (`:5173`) with Playwright** to cover the
  click-level flows MCP couldn't reach (inline composers, drag, hover states,
  the History panel, the bottom `Comments`/`Timeline`/`Proposed` tabs which were
  **not** exercised this session).
- Surfaces **not yet tested** and worth a pass: Graph view interactions, the
  mobile companion's channel/message rendering (`mobile_*` tools), the
  `Proposed` and `Changes` tabs, and multi-peer presence (only one author in
  this data set).
