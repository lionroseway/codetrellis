# Mobile Companion — Revised Vision

The mobile companion started as a status viewer: pair, connect, see
a summary of plans and channel events. That proved the transport
(WebRTC data channels work end-to-end over LAN) but the result is a
ticker, not a useful mobile workspace.

This revision reframes the mobile app: **the phone is a mobile-friendly
rendering of the same desktop workspace**, not a dashboard of it.

## What changed from the original 16-mobile-companion spec

The original spec said:

> The mobile companion is a streamed view of the desktop, not a
> separate application.

That principle is correct and we keep it. But the spec went on to say
"mobile is a thin window" and explicitly deferred most interaction.
What we learned building v1:

1. **The transport works.** WebRTC data channels stream state reliably
   over LAN. The bottleneck is not bandwidth or latency — it's that
   we're streaming a flat summary instead of the actual workspace.

2. **A summary is not useful.** Seeing "Reval chain — 0/7 items" tells
   you nothing you couldn't see from a push notification. To be
   useful, the mobile must let you *do something* with that plan.

3. **Desktop-side services already exist.** Remote terminals,
   remote interaction, audio forwarding — all built in Phase 10.
   The mobile just doesn't use them yet.

## The revised model

The phone renders the same workspace the desktop does, adapted for
the mobile form factor. Not a dashboard — the actual workspace:

- **Projects**: see open projects, open new ones, switch between them
- **Plans**: drill into plan items, read bodies, see the tree,
  respond to channel events
- **Graph**: browse the dependency graph (touch-optimised, not the
  full ReactFlow canvas — a simplified, tap-to-navigate view)
- **Terminals**: watch and inject input into desktop terminals
- **AI interaction**: respond to `await_user_input`, see agent
  sessions, watch walkthroughs in real time
- **Presence**: see and hear the same Presence Pane walkthroughs
  that play on the desktop

## What doesn't change

- **Desktop is authoritative.** No mobile-only state, no sync layer.
- **No agent inference on mobile.** Same BYO ethos.
- **No separate mobile backend.** The desktop Express server remains
  the only backend; the mobile API server (port 19480) handles only
  reconnection and health checks.
- **WebRTC transport.** All data flows over the existing four
  data channels (control, ui, terminal, audio).

## What this requires from the desktop

The desktop currently streams a `WorkspaceSnapshot` summary (plan
counts, agent list, channel event summaries). That was useful for the
dashboard prototype but too coarse for a real workspace.

The desktop needs to stream **richer state** — the same state the
frontend Zustand stores hold — or provide an RPC mechanism for the
mobile to request specific data on demand (plan items, file contents,
graph nodes).

This is the key architectural decision: **push richer snapshots** vs
**mobile-initiated RPC over the control channel**. See
`01-architecture.md`.
