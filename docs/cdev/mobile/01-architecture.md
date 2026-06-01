# Mobile Architecture

## The fundamental question: push vs pull

Two ways to get desktop data to the mobile:

### Option A: Richer push snapshots

Expand the `ui` channel snapshot to include everything the mobile
could render: full plan item trees, channel event threads, graph
node/edge data, terminal lists. Desktop pushes updates via JSON
patches (already implemented).

**Pros:** simple, reactive, mobile stays dumb.
**Cons:** snapshot gets large as projects grow. Sending the full graph
for a large codebase is impractical (thousands of nodes). The
snapshot model doesn't scale to "open a file's contents" or
"scroll through 200 plan items."

### Option B: RPC over control channel (chosen)

The `ui` channel continues to push a **workspace overview** (what's
in the snapshot today, plus some enrichments). When the mobile needs
detail — drill into a plan, load a terminal, navigate the graph — it
sends an **RPC request** on the `control` channel and the desktop
responds with the requested data.

**Pros:** scales to any data size. Mobile only loads what the user is
looking at. Same pattern as the desktop's own HTTP API. Desktop
already has the service layer.
**Cons:** slightly more complex protocol. Needs request/response
correlation.

### Decision: Option B — RPC over control channel

The mobile uses the `control` data channel as a JSON-RPC transport.
The `ui` channel remains the push layer for live state. This mirrors
the desktop architecture: the frontend makes fetch() calls to the
Express API for data, and receives SSE events for live updates.

## Wire protocol extension

### Control channel: JSON-RPC

Existing protocol (from remote-interaction-service):
```
{ method: string, params: object, id?: string, sourceInstanceId?: string }
```

New mobile-initiated methods:

| Method | Direction | Purpose |
|---|---|---|
| `project.list` | mobile → desktop | List open/recent projects |
| `project.open` | mobile → desktop | Open a project by path |
| `project.state` | mobile → desktop | Get current project state |
| `plan.list` | mobile → desktop | List plans for a project |
| `plan.get` | mobile → desktop | Full plan detail (items, status) |
| `plan.items` | mobile → desktop | Plan item tree for a plan |
| `plan.item-detail` | mobile → desktop | Single item with body, comments |
| `channel.events` | mobile → desktop | Channel events for a plan |
| `channel.post` | mobile → desktop | Post a channel event |
| `channel.resolve` | mobile → desktop | Resolve a channel event |
| `graph.overview` | mobile → desktop | Top-level clusters / packages |
| `graph.expand` | mobile → desktop | Expand a cluster to see files |
| `graph.node` | mobile → desktop | Node detail (symbol, deps) |
| `terminal.list` | mobile → desktop | List active terminals |
| `terminal.subscribe` | mobile → desktop | Start streaming a terminal |
| `terminal.input` | mobile → desktop | Send input to a terminal |
| `terminal.unsubscribe` | mobile → desktop | Stop streaming a terminal |
| `session.list` | mobile → desktop | List agent sessions |
| `presence.cards` | mobile → desktop | Current presence cards |
| `walkthrough.subscribe` | mobile → desktop | Follow a walkthrough |

Response format:
```json
{ "id": "<request-id>", "result": { ... } }
{ "id": "<request-id>", "error": { "code": -1, "message": "..." } }
```

### UI channel: enriched snapshot

The existing `WorkspaceSnapshot` gains new fields:

```typescript
interface WorkspaceSnapshot {
  v: 2;  // bumped
  ts: number;
  // Existing
  plans: PlanSummary[];
  channelEvents: ChannelEventSummary[];
  agents: AgentSummary[];
  presence: PresenceCard[];
  audio: AudioStatus;
  // New in v2
  activeProject: ProjectSummary | null;
  recentProjects: ProjectSummary[];
  terminals: TerminalSummary[];
  walkthroughActive: boolean;
  pendingInputRequests: InputRequestSummary[];
}
```

This gives the mobile enough to render the home screen and top-level
navigation without any RPC calls. Detail views use RPC.

### Terminal channel: unchanged

Binary protocol (0x01–0x06 message types) stays the same. Mobile
subscribes via `terminal.subscribe` RPC, then receives output on
the terminal channel. Sends input via `terminal.input` RPC (which
relays to the terminal channel).

### Audio channel: unchanged

WebM/Opus chunks flow from desktop to mobile. Mobile plays them.
Used for audio walkthroughs and meeting context replay.

## Desktop-side implementation

The desktop needs a **control-channel RPC handler** that routes
incoming methods to the existing service layer:

```
control message { method: 'plan.list', id: '1' }
  → planService.listPlans()
  → respond { id: '1', result: [...] }
```

This is a thin shim over the same services the Express API uses.
Lives in a new `mobile-rpc-service.ts`.

## Mobile-side implementation

The mobile app replaces the inline-HTML WebView with a **proper
React Native navigation** structure. No WebView — native components
throughout, with the same dark theme.

See `02-screens.md` for the screen map.
