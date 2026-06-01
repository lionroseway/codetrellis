# Graph on Mobile

The dependency graph is CodeTrellis's signature feature on desktop.
On mobile, we need a different approach.

## Why not port ReactFlow

The desktop graph is a free-form canvas: pan, zoom, drag nodes,
select edges. This works with a mouse and a 27" monitor. On a phone:

- **Touch targets are too small.** Nodes that are 120×40px on desktop
  are finger-sized on a 393pt-wide phone. Tapping the right node in
  a dense graph is frustrating.
- **Pinch-zoom fights scrolling.** The user constantly confuses
  zoom gestures with scroll gestures.
- **Information density doesn't fit.** A graph that's readable at
  1920×1080 becomes an illegible hairball at 393×852.
- **Performance.** Rendering 500+ SVG nodes with edge paths in a
  WebView on a phone will stutter.

## The alternative: hierarchical drill-down

The graph data has a natural hierarchy:

```
Project
  └── Clusters (packages / directories)
       └── Files
            └── Symbols (functions, classes, exports)
                 └── Dependencies (edges to other symbols)
```

On mobile, we render this as a **drill-down list** — the same data,
the same relationships, but presented as nested screens that the
phone is good at.

## Screen structure

### Level 1: Cluster overview

A grid of cards, one per top-level cluster. Each card:

```
┌────────────────────┐
│  📁 src/backend    │
│  services          │
│                    │
│  23 files          │
│  147 symbols       │
│  34 cross-deps     │
└────────────────────┘
```

Cards are coloured by cluster type (same palette as desktop nodes).
Sorted by file count (largest first) or alphabetical.

### Level 2: Cluster → files

A list of files in the selected cluster:

```
webrtc-service.ts      12 symbols  ↗8 ↙14
state-sync-service.ts   7 symbols  ↗3 ↙5
peer-connection-svc.ts 15 symbols  ↗6 ↙11
```

↗ = outbound deps (this file uses), ↙ = inbound deps (other files
use this). Tappable → level 3.

### Level 3: File → symbols

A list of exported symbols in the file:

```
● createOffer()          function    ↗2 ↙3
● connectWithAnswer()    function    ↗4 ↙1
● sendToPeer()           function    ↗1 ↙7
○ PeerEntry              interface   ↗0 ↙2
```

● = exported, ○ = internal. Each shows type and edge counts.

### Level 4: Symbol detail

Full detail for one symbol:

```
sendToPeer()
  function — webrtc-service.ts:276

  Called by:
    state-sync-service.ts → sendFullSnapshot()
    remote-terminal-service.ts → relayOutput()
    mobile-api-server.ts → handleTestSend()
    ...

  Calls:
    peers.get() — Map.get
    wrapper.channel.send() — werift

  Cross-system:
    (none)
```

Each "called by" and "calls" entry is tappable → navigates to that
symbol's detail.

### Breadcrumb trail

A horizontal breadcrumb at the top:

```
src/backend ▸ services ▸ webrtc-service.ts ▸ sendToPeer
```

Tappable to jump back to any level.

## Search

A search bar at any level filters by name. On the overview level,
search across all files and symbols (full-text). Results show
the match with its location in the hierarchy.

## "Show on desktop"

A button in the symbol detail view sends a remote-interaction
command to the desktop, which highlights that node in the ReactFlow
canvas. Useful when the user finds something interesting on mobile
and wants to see it in context on the big screen.

## Cross-system callsites

When a symbol has HTTP / SQL / subprocess callsites (detected by
the callsite extractors), they appear in the symbol detail view
with the target service/table/command. This is one of CodeTrellis's
unique features — the phone shows the same cross-system coupling
the desktop graph shows.

## Data source

All data comes from the desktop's in-memory graph via RPC:

- `graph.overview` → cluster summaries
- `graph.expand { clusterId }` → files + edges
- `graph.node { nodeId }` → symbols + dependencies

The desktop already has all this data indexed. The RPC handler
queries the existing graph store (the same data the ReactFlow
frontend queries via HTTP).
