# Mobile Data Flow

How data moves between desktop and mobile for each feature.

## Channel overview

```
Desktop                          Mobile
───────                          ──────
Express services ──┐
                   ├──▶ ui channel ──────▶ snapshot store → UI
                   │    (push: snapshots     (overview: plans,
                   │     + JSON patches)      agents, projects,
                   │                          events, terminals)
                   │
                   ├──▶ control channel ──▶ RPC response handler
                   │    (req/resp: RPC        (detail views:
                   │     + events + input)     plan items, graph
                   │                           nodes, sessions)
                   │
                   ├──▶ terminal channel ─▶ terminal view
                   │    (binary: PTY I/O)     (xterm.js in
                   │                           WebView, or RN
                   │                           native terminal)
                   │
                   └──▶ audio channel ───▶ audio player
                        (binary: WebM/Opus)   (expo-av)
```

## Data flow per feature

### 1. Project switching

```
Mobile                              Desktop
──────                              ───────
[Home tab shows recentProjects       ← snapshot.recentProjects
 from snapshot]

User taps a project
  → control: { method: 'project.open', params: { path }, id: '1' }
  → desktop opens project, re-indexes
  ← control: { id: '1', result: { ok: true } }
  ← ui channel: new snapshot with activeProject set

Mobile re-renders all tabs with new project context
```

### 2. Plan drill-down

```
Mobile                              Desktop
──────                              ───────
[Plans tab shows plan list           ← snapshot.plans
 from snapshot]

User taps "Reval chain"
  → control: { method: 'plan.get', params: { uid }, id: '2' }
  ← control: { id: '2', result: { plan detail + items } }

Mobile renders plan detail screen

User taps an item
  → control: { method: 'plan.item-detail', params: { uid, itemUid }, id: '3' }
  ← control: { id: '3', result: { item with body, comments } }

Mobile renders item detail with markdown body

Meanwhile, if plan state changes on desktop:
  ← ui channel: JSON patch updates plan summary
  Mobile re-renders plan list and detail if visible
```

### 3. Channel event interaction

```
Mobile                              Desktop
──────                              ───────
[Activity tab shows events           ← snapshot.channelEvents
 from snapshot]

User taps "Respond" on a stuck event
  → Mobile shows response composer (native UI)

User types "Try the fallback parser" and taps Send
  → control: { method: 'channel.post',
      params: { planUid, eventType: 'steer', message: '...' },
      id: '4' }
  ← control: { id: '4', result: { uid: '<new-event>' } }
  ← ui channel: snapshot patch adds the new event

The desktop also shows the new event in its Channel panel
```

### 4. Terminal interaction

```
Mobile                              Desktop
──────                              ───────
[Terminals tab shows terminal list   ← snapshot.terminals
 from snapshot]

User taps "claude-session-1"
  → control: { method: 'terminal.subscribe',
      params: { terminalId }, id: '5' }
  ← control: { id: '5', result: { ok: true, scrollback: '...' } }
  ← terminal channel: 0x02 + output data (streaming)

Mobile renders terminal view with scrollback + live output

User types "yes" and taps Send
  → control: { method: 'terminal.input',
      params: { terminalId, data: 'yes\n' }, id: '6' }
  ← control: { id: '6', result: { ok: true } }
  (desktop writes 'yes\n' to the PTY)
  ← terminal channel: 0x02 + echo output

User navigates away
  → control: { method: 'terminal.unsubscribe',
      params: { terminalId }, id: '7' }
```

### 5. AI user-input response

```
Mobile                              Desktop
──────                              ───────
Agent calls await_user_input
  → remote-interaction-service broadcasts:
  ← control: { method: 'user-input-request',
      params: { requestId, prompt, options } }

  Mobile shows input modal (push notification if backgrounded)

User taps option or types response
  → control: { method: 'user-input-response',
      params: { requestId, response: '...' }, id: '8' }
  ← control: { id: '8', result: { accepted: true } }

  Desktop routes response to the agent
```

### 6. Graph navigation

```
Mobile                              Desktop
──────                              ───────
[Graph tab starts at overview level]
  → control: { method: 'graph.overview', id: '9' }
  ← control: { id: '9', result: { clusters: [...] } }

User taps "src/backend/services"
  → control: { method: 'graph.expand',
      params: { clusterId: '...' }, id: '10' }
  ← control: { id: '10', result: { files: [...], edges: [...] } }

User taps "webrtc-service.ts"
  → control: { method: 'graph.node',
      params: { nodeId: '...' }, id: '11' }
  ← control: { id: '11', result: { symbols: [...], deps: [...] } }
```

### 7. Walkthrough following

```
Mobile                              Desktop
──────                              ───────
AI starts a walkthrough (narrating graph navigation)
  ← ui channel: snapshot patch sets walkthroughActive: true
  ← control: { method: 'walkthrough-step',
      params: { nodeId, narration, action } }

  Mobile shows walkthrough overlay:
  - Navigates Graph tab to the relevant node
  - Shows narration text in a floating card
  - Plays audio if on audio channel

  Each step arrives as a control message; mobile animates between

AI ends walkthrough
  ← ui channel: snapshot patch sets walkthroughActive: false
  Mobile dismisses overlay
```

## State management on mobile

The mobile uses a single Zustand-like store (or simple React
context) with these slices:

| Slice | Populated by | Updated by |
|---|---|---|
| `overview` | ui channel snapshot | ui channel patches |
| `planDetail` | RPC `plan.get` response | ui patches + re-fetch |
| `graphView` | RPC `graph.*` responses | navigation actions |
| `terminalOutput` | terminal channel | terminal channel |
| `pendingRpc` | outgoing RPC tracking | RPC responses |
| `connection` | connection manager | state changes |

The store is in-memory only. When the connection drops, all state
clears. When it reconnects, a fresh snapshot arrives and the mobile
re-renders from scratch. No persistence, no sync conflicts, no
offline mode.
