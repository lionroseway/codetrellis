# Mobile Implementation Phases

Build-out plan from current state (working pairing + flat snapshot
dashboard) to the full mobile workspace.

## Current state (done)

- Pairing via QR code (v4 Bluetooth-style flow)
- WebRTC connection with four data channels
- pairingId-based reconnection (persists across restarts)
- mDNS discovery
- Flat snapshot dashboard (plan summaries, event summaries, audio)
- Inline HTML WebView rendering

## Phase M1 — Native navigation + enriched snapshot

**Goal:** replace the WebView dashboard with native React Native
screens and proper tab navigation. Enrich the snapshot so the home
screen and plan list are useful without RPC.

### Desktop changes
- Enrich `WorkspaceSnapshot` to v2: add `activeProject`,
  `recentProjects`, `terminals`, `pendingInputRequests`,
  `walkthroughActive`
- Snapshot collection includes project state and terminal summaries

### Mobile changes
- Replace single `workspace.tsx` WebView with Expo Router tab layout
- Five tabs: Home, Plans, Graph, Terminals, Activity
- Home tab: active project, recent projects, agent strip, attention
  badges (including deviation counts and recent file changes)
- Plans tab: plan list with progress bars, status filters
- Activity tab: channel events list with type badges
- Terminals tab: terminal list (cards, no detail yet)
- Graph tab: placeholder ("Open a project on desktop to explore")
- All tabs render from the `WorkspaceSnapshot` — no RPC yet

### Result
The mobile looks like a real app with navigation. Every tab shows
live data from the snapshot. Tapping a plan or terminal does nothing
yet (no detail views).

---

## Phase M2 — Control channel RPC + plan detail

**Goal:** implement the RPC layer and the first detail views (plans
and items).

### Desktop changes
- New `mobile-rpc-service.ts`: routes control-channel RPC methods to
  existing services
- Methods: `plan.list`, `plan.get`, `plan.items`, `plan.item-detail`
- Methods: `channel.events`, `channel.post`, `channel.resolve`
- Methods: `project.list`, `project.open`, `project.state`

### Mobile changes
- RPC client module (`lib/rpc.ts`): sends requests on control channel,
  correlates responses by ID, timeout handling
- Plan detail screen: header + tabs (Items, Channel, Changes, Drift)
- Plan item tree: collapsible tree with status chips
- Item detail screen: markdown body, comment thread, action buttons
- Channel event response: inline steer/weigh-in composer
- **Drift tab**: deviations for the plan with accept/ignore actions
- Project switcher: list recent projects, tap to open

### Result
The mobile can drill into plans, read item bodies, respond to
channel events, manage deviations, and switch projects. This is
the first point where mobile becomes genuinely useful for work.

---

## Phase M3 — Terminal interaction

**Goal:** watch and type into desktop terminals from the phone.

### Desktop changes
- RPC methods: `terminal.list`, `terminal.subscribe`,
  `terminal.unsubscribe`, `terminal.input`
- Terminal subscribe sends scrollback in response, then streams
  output via terminal data channel
- Input arrives via RPC, relayed to the PTY

### Mobile changes
- Terminal detail screen with monospace output rendering
  (either react-native terminal component or a small WebView
  with xterm.js — evaluate both)
- Input bar at bottom with keyboard
- Auto-scroll, selection, copy support
- Subscribe/unsubscribe on mount/unmount

### Result
The key "inject into terminal" interaction works. User sees Claude
Code running on the desktop, types a response on their phone. This
is the "respond to the AI from the couch" use case.

---

## Phase M4 — Graph browser

**Goal:** browse the dependency graph on mobile via the drill-down
hierarchy pattern (not a free-form canvas).

### Desktop changes
- RPC methods: `graph.overview`, `graph.expand`, `graph.node`
- RPC methods: `graph.recent-changes`, `graph.dependency-diff`
- `graph.overview` returns cluster summaries (grouped by
  package/directory)
- `graph.expand` returns files + edges for a cluster
- `graph.node` returns symbols + dependencies for a file
- `graph.recent-changes` returns files changed since timestamp with
  symbol/dependency impact summaries
- `graph.dependency-diff` returns edges added/removed since timestamp

### Mobile changes
- Graph overview screen: cluster tiles (coloured, sized by
  file count)
- **Graph change feed**: recent file changes with impact summaries
  (+/~/- files, new symbols, new/broken dependencies)
- **Dependency diff view**: edges added/removed since last check
- Cluster detail: file list with dep counts
- File detail: symbol list with dep/dependant edges
- Symbol detail: inbound/outbound edges, cross-system callsites
- Back navigation (breadcrumb trail)
- "Show on desktop" button (remote-interaction highlights the node)

### Result
The graph is browsable on mobile. Not as visual as the desktop
canvas, but functionally equivalent for understanding dependencies.

---

## Phase M5 — AI interaction + walkthroughs

**Goal:** respond to agent input requests, follow walkthroughs,
see the Presence Pane.

### Desktop changes
- Walkthrough events broadcast on control channel when a presence
  card targets a graph node
- `walkthrough.subscribe` / `walkthrough.unsubscribe` RPC
- Input request forwarding already works (remote-interaction-service)

### Mobile changes
- User input modal: appears when `user-input-request` arrives.
  Push notification if app is backgrounded
- Agent session detail: what the agent is doing, active plan,
  last tool call
- Walkthrough overlay: floating narration card, auto-navigates
  Graph tab to the walkthrough target
- Presence cards in Activity tab
- Audio playback for walkthrough narration (expo-av)

### Result
The mobile is a full participant in AI collaboration. Walkthroughs
play on both screens simultaneously. Agent questions get answered
from anywhere.

---

## Phase M6 — Polish + push notifications

**Goal:** production-quality UX, offline-safe push, notification
channels.

### Desktop changes
- Push notification payloads enriched with deep-link URLs
- Notification channel mapping: which events get push vs silent

### Mobile changes
- Push notification handling: deep links into the correct screen
- Notification permissions onboarding
- Haptic feedback for channel events and input requests
- Offline indicator + auto-reconnect UX
- Settings screen: notification preferences, device management
- Accessibility: VoiceOver labels, dynamic type support
- Performance: virtualised lists, lazy loading, memory management

### Result
The mobile app is shippable. A developer can leave the desk, get
notified of a stuck event, respond from the phone, watch what the
agent does next in a terminal, and see the walkthrough summary.

---

## Sequencing rationale

M1 → M2 → M3 is the critical path. These three phases deliver the
core value: see plans, respond to events, interact with terminals.

M4 (graph) and M5 (walkthroughs) are valuable but not blocking.
They can be built in parallel with polish work.

M6 (push + polish) is the ship gate. Everything before M6 can ship
as a beta / TestFlight build.

## Estimated effort

| Phase | Desktop | Mobile | Total |
|---|---|---|---|
| M1 | 0.5 day | 2 days | 2.5 days |
| M2 | 1 day | 3 days | 4 days |
| M3 | 0.5 day | 2 days | 2.5 days |
| M4 | 1 day | 2 days | 3 days |
| M5 | 1 day | 2 days | 3 days |
| M6 | 0.5 day | 3 days | 3.5 days |
| **Total** | **4.5 days** | **14 days** | **18.5 days** |

Desktop work is lighter because the services already exist — the
desktop changes are mostly thin RPC wrappers over existing code.
The mobile is where the UI work lives.
