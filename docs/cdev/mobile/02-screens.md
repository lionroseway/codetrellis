# Mobile Screen Map

The mobile app uses Expo Router (file-based routing). Each screen
maps to a desktop feature, adapted for touch and the phone form
factor.

## Navigation structure

```
Tab Navigator (bottom tabs)
├── Home        — project switcher + overview dashboard
├── Plans       — plan list → plan detail → items → item detail
├── Graph       — simplified dependency graph (tap-to-navigate)
├── Terminals   — terminal list → terminal view (with input)
└── Activity    — channel events + agent sessions + presence

Modal stack (overlays any tab)
├── Pair Device      — QR scanner
├── Plan Item Detail — full item with body, comments, actions
├── Channel Respond  — reply to stuck/need-decision/weigh-in
├── User Input       — respond to await_user_input from an agent
└── Settings         — connection, device, preferences
```

## Screen descriptions

### Home tab

**Purpose:** project context + quick overview. Same role as the
desktop's WelcomeScreen + TopBar.

| Element | Data source | Interaction |
|---|---|---|
| Active project name + branch | snapshot.activeProject | Tap → project switcher |
| Connected agents strip | snapshot.agents | Tap agent → session detail |
| Attention badges | snapshot.channelEvents (unresolved count) | Tap → Activity tab |
| Recent projects list | snapshot.recentProjects | Tap → open project |
| Connection status | connection state | Shows desktop name, latency |

When no project is open, shows the recent projects list prominently
(same as the desktop welcome screen).

### Plans tab

**Purpose:** browse and interact with plans. Same role as the desktop
PlanPanel.

**Plan list** (default view):
- Cards showing plan name, status badge, progress bar, item counts
- Filter by status (draft, active, completed)
- Pull-to-refresh triggers snapshot resync

**Plan detail** (tap a plan):
- Plan header (name, status, readiness ring)
- Tab bar: Items | Channel | Changes | Timeline
- Items tab: tree view of plan items with status chips
- Channel tab: channel events for this plan (post/respond inline)
- Changes tab: proposed changes summary
- Timeline tab: recent activity

**Item detail** (tap an item):
- Item title + status + assignee
- Body rendered as markdown (react-native-markdown)
- Comment thread
- Action buttons: mark done, assign, steer

### Graph tab

**Purpose:** browse the dependency graph. NOT a full ReactFlow
canvas — that's impractical on a phone. Instead: a **drill-down
hierarchy** optimised for touch.

**Overview level:**
- Large tiles for top-level clusters (packages, directories)
- Each tile shows name, file count, edge count
- Colour-coded by cluster type

**Cluster level** (tap a cluster):
- List of files in the cluster
- Each file shows symbol count, inbound/outbound deps
- Search bar for filtering

**File level** (tap a file):
- List of symbols (functions, classes, exports)
- Each symbol shows its dependencies and dependants
- Tap a dependency to navigate to that file

**Node detail** (tap a symbol):
- Symbol signature
- Inbound edges (who calls this)
- Outbound edges (what this calls)
- Cross-system callsites (HTTP, SQL, subprocess)
- "Show on desktop" button → remote-interaction navigates desktop

This is a tree-browser pattern, not a free-form canvas. The phone
is good at lists and drill-down; it's bad at pinch-zooming a
node graph with 500 nodes.

### Terminals tab

**Purpose:** watch and interact with desktop terminals. Same as the
desktop TerminalPanel, adapted for mobile.

**Terminal list:**
- Cards for each active terminal
- Shows: title, preset icon (claude/codex/shell), alive/exited
- Green dot for active, grey for exited

**Terminal view** (tap a terminal):
- Full-screen terminal output (monospace, dark background)
- Auto-scrolls to bottom
- Input bar at bottom (keyboard appears on focus)
- Send button sends input to the desktop terminal
- Terminal output streams in real-time via the terminal data channel

**Key interaction:** The user sees a Claude Code session running on
the desktop. The agent asks a question. The user types the answer
on their phone. The input flows back to the desktop terminal.

### Activity tab

**Purpose:** channel events, agent sessions, presence. The
"what needs my attention" surface.

**Segments** (horizontal filter):

1. **Events** — channel events across all plans
   - Grouped by plan
   - Unresolved events highlighted
   - Tap to respond inline (steer, weigh-in)
   - Badge shows unresolved count

2. **Agents** — active agent sessions
   - Session cards: agent type, model, active plan, last seen
   - Tap for session detail (what the agent is doing)

3. **Presence** — presence pane cards
   - Same narration cards as the desktop
   - Walkthrough playback: when AI navigates, the mobile follows
     along in the Graph tab or shows the walkthrough overlay

## Walkthrough experience

When an AI agent does a walkthrough (narrating as it navigates the
graph), the desktop shows it in the Presence Pane. On mobile:

- A banner appears: "Walkthrough in progress"
- The mobile follows along: as the AI highlights nodes on the
  desktop graph, the mobile shows the same nodes in its Graph tab
  (scrolls to the relevant cluster/file/symbol)
- The narration text streams in a floating overlay
- Audio plays if the audio channel is active

This is the "same walkthrough on mobile" experience. The mobile
doesn't need to render the same ReactFlow canvas — it shows the
walkthrough as a guided tour through the drill-down graph.
