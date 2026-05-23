# Agent Presence Pane — Builder Spec

## Problem

An MCP agent can drive the CodeTrellis UI (graph_focus, select_item,
open_plan, set_trellis_mode) but has no way to speak inside it.
Narration happens in the agent's own client (terminal/chat), forcing
the human to split attention. The agent can show, but can't articulate
where the user is looking. There's also no back-channel: the agent
can't tell whether the user saw something, and the user can't respond
without leaving the app.

## Concept

A small, movable, dismissable floating pane in the app. The agent posts
short narration cards to it (optionally spoken aloud via TTS). Each
card can request acknowledgement; the user can reply. The agent receives
acks and replies through MCP, so a walkthrough becomes a paced, two-way
presence rather than a blind monologue.

Ephemeral by default — cards live in memory, capped at 50. Individual
cards can be pinned to a plan item (promoting to a durable comment via
the existing `add_item_comment` path).

## Phasing

| Phase | Scope | Ships |
|-------|-------|-------|
| **v1** | Pane + `present` + `await_ack` + built-in TTS + "Got it" button | Core — one-way narration with read-receipts |
| **v2** | `await_user_input` + reply box | Two-way dialogue |
| **v3** | `present_sequence`, BYO premium voice, pin-to-item, push-to-talk STT | Richer |

**Build v1 first. v2 and v3 are documented for context but out of
scope for the initial implementation.**

---

## Architecture overview

```
Agent (Claude Code / Cursor / etc.)
  │
  │ MCP tool call: present({ text, speak, require_ack })
  ▼
src/backend/mcp/tools/presence-tools.ts
  │  ── writes card to in-memory PresenceService
  │  ── deps.broadcast('presence-card', { card })
  │  ── if require_ack: sets up pendingResponses promise
  ▼
WebSocket broadcast  ───►  src/frontend/hooks/useWebSocket.ts
                              │ routes to presence-store
                              ▼
                           src/frontend/stores/presence-store.ts
                              │
                              ▼
                           src/frontend/components/presence/PresencePane.tsx
                              │  ── renders card stack
                              │  ── triggers SpeechSynthesis if speak=true
                              │  ── on "Got it" click or speech end:
                              │     POST /api/presence/ack  ──►  resolves pendingResponses
                              ▼
                           Agent's await_ack() returns { acked: true, via: "click"|"speech-end" }
```

---

## 1. Backend: Presence service

### File: `src/backend/services/presence-service.ts`

In-memory card store. No database — cards are ephemeral session state.

```typescript
export interface PresenceCard {
  id: string;             // "pc-<timestamp>-<random>"
  text: string;           // markdown-lite (bold, code, links)
  speak: boolean;         // trigger TTS on the frontend
  requireAck: boolean;    // show "Got it" button, block await_ack
  tone: 'neutral' | 'success' | 'warning' | 'question';
  linkTo: string | null;  // node ID or item UID to visually anchor
  agentId: string | null; // MCP session ID of the posting agent
  createdAt: number;      // epoch ms
  acked: boolean;         // true once user clicks "Got it" or speech ends
  ackedAt: number | null;
  ackedVia: 'click' | 'speech-end' | 'timeout' | null;
}

// --- Public API ---

/** Post a card. Returns the card with its generated ID. */
export function postCard(input: Omit<PresenceCard, 'id' | 'createdAt' | 'acked' | 'ackedAt' | 'ackedVia'>): PresenceCard;

/** Mark a card as acknowledged. Returns the updated card or null. */
export function ackCard(cardId: string, via: 'click' | 'speech-end'): PresenceCard | null;

/** Get all cards (newest last). */
export function getCards(): PresenceCard[];

/** Get a single card by ID. */
export function getCard(cardId: string): PresenceCard | null;

/** Clear all cards. */
export function clearCards(): void;

/** Submit a user reply. Returns the reply object. */
export function postReply(text: string): UserReply;  // v2

export interface UserReply {                          // v2
  id: string;
  text: string;
  createdAt: number;
}
```

**Implementation notes:**
- Store cards in a simple `Map<string, PresenceCard>`, cap at 50
  (evict oldest when full).
- No DB writes. No persistence across restart. This is intentional —
  ephemeral by design.
- The `postReply` and `UserReply` type are v2 stubs — define the
  interface now but don't implement the MCP tool yet.

---

## 2. Backend: MCP tools

### File: `src/backend/mcp/tools/presence-tools.ts`

Follow the existing pattern: `export function register(server: McpServer, deps: ToolDeps): void`.

### v1 tools

#### `present`

```
inputSchema:
  text:        z.string()         — card body (markdown-lite)
  speak:       z.boolean().optional().default(false)
  require_ack: z.boolean().optional().default(false)
  tone:        z.enum(['neutral','success','warning','question']).optional().default('neutral')
  link_to:     z.string().optional()  — node ID or plan item UID to anchor
```

**Handler:**
1. Call `presenceService.postCard(...)` with agentId from session
   (use `authorFromExtra` pattern from `helpers.ts`).
2. `deps.broadcast('presence-card', { card })` — returns subscriber
   count.
3. Return `resultWithMeta({ card_id: card.id }, n)`.

#### `await_ack`

```
inputSchema:
  card_id:    z.string()
  timeout_ms: z.number().optional().default(30000)  — max 120000
```

**Handler:**
1. Check if card already acked → return immediately with
   `{ acked: true, via: card.ackedVia }`.
2. Otherwise, set up a `pendingResponses` entry keyed by
   `ack-${card_id}`. The frontend will POST to
   `/api/presence/ack` when the user clicks "Got it" or
   speech finishes, which resolves the promise.
3. On timeout, resolve with `{ acked: false, via: 'timeout' }`.

**Important:** Use the same `deps.pendingResponses` map and nonce
pattern used by `screenshot` and `graph_snapshot` tools. The resolve
path is the REST endpoint described below.

#### `dismiss_presence`

```
inputSchema: {}  (no params)
```

**Handler:**
1. `presenceService.clearCards()`.
2. `deps.broadcast('presence-dismissed', {})`.
3. Return `resultWithMeta({ ok: true }, n)`.

### v2 tools (stub the registration, don't implement handler)

#### `await_user_input`

```
inputSchema:
  prompt:     z.string().optional()  — hint shown in the reply box
  timeout_ms: z.number().optional().default(60000)
```

Returns `{ text, at }` or `{ text: null, timed_out: true }`.

#### `present_sequence`

```
inputSchema:
  cards:   z.array(z.object({ text, speak, link_to }))
  advance: z.enum(['ack', 'auto']).default('ack')
  auto_delay_ms: z.number().optional().default(5000)
```

---

## 3. Backend: REST endpoints

### In `src/backend/server.ts`

Add these alongside the existing screenshot-response route:

```typescript
// Presence ack — frontend POSTs when user clicks "Got it" or speech ends
app.post('/api/presence/ack', (req, res) => {
  const { cardId, via } = req.body;
  const card = presenceService.ackCard(cardId, via);
  if (!card) { res.status(404).json({ error: 'Card not found' }); return; }

  // Resolve the pending await_ack promise (same pattern as screenshot)
  const nonce = `ack-${cardId}`;
  const pending = pendingResponses.get(nonce);
  if (pending) {
    clearTimeout(pending.timer);
    pendingResponses.delete(nonce);
    pending.resolve(JSON.stringify({ acked: true, via }));
  }

  broadcast('presence-acked', { cardId, via });
  res.json({ ok: true });
});

// Presence cards — GET for initial hydration
app.get('/api/presence/cards', (_req, res) => {
  res.json(presenceService.getCards());
});

// v2: User reply
app.post('/api/presence/reply', (req, res) => {
  // stub for v2
  res.status(501).json({ error: 'Not implemented (v2)' });
});
```

**Wire `pendingResponses`:** The `pendingResponses` map is created in
`src/backend/mcp/server.ts` and exposed via `(globalThis as any).__screenshotResolve`.
For presence, add a parallel resolver:

```typescript
// In src/backend/mcp/server.ts, alongside __screenshotResolve:
(globalThis as any).__presenceAckResolve = (nonce: string, data: string) => {
  const pending = pendingResponses.get(nonce);
  if (pending) {
    clearTimeout(pending.timer);
    pendingResponses.delete(nonce);
    pending.resolve(data);
  }
};
```

Then in server.ts, the `/api/presence/ack` handler calls
`(globalThis as any).__presenceAckResolve(nonce, JSON.stringify({...}))`.

**Or** — simpler: import and pass `pendingResponses` through `ToolDeps`
as already done. The handler in `presence-tools.ts` uses
`deps.pendingResponses` directly. The REST route in server.ts resolves
via the same globalThis bridge the screenshot uses. Follow whichever
pattern feels cleaner — both work, the screenshot tool already proves
the globalThis approach.

### ToolDeps addition

In `src/backend/mcp/types.ts`, add:

```typescript
presenceService: typeof import('../services/presence-service');
```

And in `src/backend/mcp/server.ts`, import + pass it through.

### Tool registration

In `src/backend/mcp/server.ts`, import and call
`presenceTools.register(server, deps)` alongside the other tool
modules.

---

## 4. Frontend: Presence store

### File: `src/frontend/stores/presence-store.ts`

Zustand store, same pattern as toast-store but richer.

```typescript
import { create } from 'zustand';

export interface PresenceCard {
  id: string;
  text: string;
  speak: boolean;
  requireAck: boolean;
  tone: 'neutral' | 'success' | 'warning' | 'question';
  linkTo: string | null;
  agentId: string | null;
  createdAt: number;
  acked: boolean;
  ackedVia: 'click' | 'speech-end' | 'timeout' | null;
}

interface PresenceState {
  cards: PresenceCard[];
  visible: boolean;       // pane open/closed
  position: { x: number; y: number } | null;  // drag position, null = default corner

  // Actions
  pushCard: (card: PresenceCard) => void;
  ackCard: (cardId: string, via: 'click' | 'speech-end') => void;
  clearCards: () => void;
  setVisible: (v: boolean) => void;
  setPosition: (pos: { x: number; y: number }) => void;

  // v2
  replyText: string;
  setReplyText: (t: string) => void;
}
```

**`pushCard`** appends the card, caps at 50, and sets `visible = true`
(auto-opens the pane when the agent starts speaking).

**`ackCard`** updates the card's `acked` field locally (optimistic)
AND fires `POST /api/presence/ack` to resolve the backend promise.

---

## 5. Frontend: WebSocket handler

### In `src/frontend/hooks/useWebSocket.ts`

Add handlers for the new broadcast events, following the existing
pattern:

```typescript
if (type === 'presence-card') {
  usePresenceStore.getState().pushCard(payload.card);
}
if (type === 'presence-acked') {
  usePresenceStore.getState().ackCard(payload.cardId, payload.via);
}
if (type === 'presence-dismissed') {
  usePresenceStore.getState().clearCards();
  usePresenceStore.getState().setVisible(false);
}
```

Import `usePresenceStore` at the top with the other store imports
(use dynamic import like the existing stores to avoid circular deps).

---

## 6. Frontend: PresencePane component

### File: `src/frontend/components/presence/PresencePane.tsx`

A floating, draggable, dismissable pane. Lives outside the main layout
(rendered in App.tsx alongside `<ToastContainer />`).

### Layout

```
┌─ PresencePane ──────────────────────────────┐
│  ╔═ header ═══════════════════════════════╗  │
│  ║  🤖 Agent  ·  3 cards        [—] [✕]  ║  │
│  ╚════════════════════════════════════════╝  │
│                                              │
│  ┌─ card stack (scrollable) ──────────────┐  │
│  │  Card 1: "Looking at the auth module…" │  │
│  │  ✓ read                                │  │
│  │                                        │  │
│  │  Card 2: "Notice the circular dep…"    │  │
│  │  [ Got it ]                            │  │
│  │                                        │  │
│  │  Card 3: "This is the fix I'd…"       │  │
│  │  🔊 speaking…                          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─ reply box (v2) ──────────────────────┐  │
│  │  Type a reply…                  [↵]   │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### Sizing and position

- **Default**: bottom-left corner, `320px` wide, max `400px` tall.
  Offset from the edge so it doesn't overlap the sidebar or status bar.
- **Draggable**: implement via `onMouseDown` / `onMouseMove` on the
  header bar. Store position in presence-store (survives re-renders,
  not persisted to disk).
- **Dismissable**: X button calls `setVisible(false)`. Minimize button
  collapses to just the header bar (shows unread count badge).
- **Never occludes focused node**: When a `graph_focus` event fires
  (listen for `graph-focused` broadcast), check if the pane overlaps
  the viewport center and nudge it to the opposite corner if so.
  (Nice-to-have for v1; skip if complex.)

### Card rendering

- **Text**: render with basic inline markdown — bold (`**text**`),
  inline code (`` `code` ``), and links. Don't pull in react-markdown
  for this — a simple regex replacer or a tiny `<PresenceCardBody>`
  component that handles `**`, `` ` ``, and `[text](url)` is enough.
  Keep bundle impact near zero.
- **Tone**: maps to a subtle left-border color:
  - `neutral` → accent blue (`border-accent/40`)
  - `success` → green (`border-green-500/40`)
  - `warning` → amber (`border-amber-500/40`)
  - `question` → purple (`border-purple-400/40`)
- **"Got it" button**: shown when `requireAck && !acked`. On click,
  POST `/api/presence/ack` with `via: 'click'`, update store.
- **Acked state**: dim the card slightly, show a small checkmark.
- **Auto-scroll**: scroll the card stack to the bottom when a new card
  arrives.

### TTS (built-in Web Speech API)

When a card arrives with `speak: true`:
1. Create a `SpeechSynthesisUtterance` with the card's text (strip
   markdown formatting first — no `**` or backticks spoken aloud).
2. Set `utterance.rate = 1.0`, `utterance.pitch = 1.0`.
3. Pick a voice: `speechSynthesis.getVoices()`, prefer one whose
   `lang` starts with `'en'`. Cache the voice selection.
4. Call `speechSynthesis.speak(utterance)`.
5. Show a 🔊 indicator on the card while speaking.
6. On `utterance.onend`:
   - If `requireAck`: auto-ack with `via: 'speech-end'` (POST to
     `/api/presence/ack`).
   - Remove the 🔊 indicator.
7. On `utterance.onerror`: log to console, don't crash. Remove
   indicator.

**Important**: `speechSynthesis` is available in both Chromium
(Electron) and the browser. It's local — no audio leaves the machine.
No API key required. This is the v1 floor.

### v3: BYO premium voice

Not v1 scope. Design notes for later:
- Settings modal gets a "Voice" section: provider dropdown
  (Built-in / ElevenLabs / OpenAI TTS), API key field (stored in
  settings-service, never sent to CodeTrellis servers).
- When a premium provider is configured, the PresencePane calls the
  provider's API directly from the renderer (browser fetch), streams
  audio via `AudioContext`, and fires the ack on playback end.
- Built-in remains the fallback if the key is missing or the call
  fails.

---

## 7. Frontend: App.tsx integration

Render `<PresencePane />` at the same level as `<ToastContainer />` —
both are floating overlays outside the main layout.

```tsx
import { PresencePane } from './components/presence/PresencePane';

// In the return JSX, alongside ToastContainer:
<PresencePane />
<ToastContainer />
```

---

## 8. Shared types

### File: `src/shared/types/presence.ts` (new)

Export `PresenceCard` and `UserReply` interfaces shared between
backend and frontend. Both the service and the store import from here.

---

## 9. Build motif alignment

This feature follows the same patterns as everything else:

| Pattern | Presence pane equivalent |
|---------|------------------------|
| MCP tool → broadcast → WS → store → component | `present` → `presence-card` → WS → presence-store → PresencePane |
| pendingResponses for blocking tools | `await_ack` blocks on `ack-<cardId>` nonce, resolved by REST POST |
| ToolDeps injection | `presenceService` added to ToolDeps |
| `register(server, deps)` module | `presence-tools.ts` |
| Zustand store per domain | `presence-store.ts` |
| Ephemeral UI (like toasts) | Cards in memory, capped at 50, no DB |
| Settings for BYO keys (v3) | Same `settings-service` + `SettingsModal.tsx` |

---

## 10. File manifest

| File | Action | Description |
|------|--------|-------------|
| `src/shared/types/presence.ts` | **create** | PresenceCard + UserReply interfaces |
| `src/shared/types/index.ts` | **edit** | Re-export presence types |
| `src/backend/services/presence-service.ts` | **create** | In-memory card store |
| `src/backend/mcp/tools/presence-tools.ts` | **create** | MCP tools: present, await_ack, dismiss_presence |
| `src/backend/mcp/types.ts` | **edit** | Add presenceService to ToolDeps |
| `src/backend/mcp/server.ts` | **edit** | Import + register presence tools, add ack resolver |
| `src/backend/server.ts` | **edit** | Add REST routes: /api/presence/ack, /api/presence/cards |
| `src/frontend/stores/presence-store.ts` | **create** | Zustand store for cards + visibility + position |
| `src/frontend/components/presence/PresencePane.tsx` | **create** | Floating pane component with card stack + TTS |
| `src/frontend/hooks/useWebSocket.ts` | **edit** | Handle presence-card, presence-acked, presence-dismissed |
| `src/frontend/App.tsx` | **edit** | Render `<PresencePane />` |

---

## 11. Acceptance criteria (v1)

- [ ] `present("hello", { speak: true, require_ack: true })` shows a
      card in a floating pane AND speaks it via built-in
      SpeechSynthesis.
- [ ] `await_ack(card_id)` resolves when the user clicks "Got it"
      (returns `via: "click"`) or when speech finishes (returns
      `via: "speech-end"`).
- [ ] `await_ack` returns `{ acked: false, via: "timeout" }` if the
      timeout expires.
- [ ] The pane is draggable by its header and dismissable via X.
- [ ] Dismissing the pane doesn't destroy cards — reopening shows
      them.
- [ ] `dismiss_presence` clears all cards and closes the pane.
- [ ] Posting a card uses the existing broadcast path and returns
      `_meta.broadcast` like other writes.
- [ ] No audio or text leaves the machine in v1 (built-in synth
      only, no network calls for TTS).
- [ ] An agent can run: `present(require_ack: true)` → `graph_focus`
      → `await_ack` → `present(next)` and pace a multi-step
      walkthrough that visibly waits for the human.
- [ ] Cards render markdown-lite (bold, inline code, links) without
      pulling in the full react-markdown dependency.
- [ ] Card stack auto-scrolls to newest card.
- [ ] The pane follows the app's dark theme and Tailwind styling
      conventions (bg-[#0d1117], border-white/[0.08], etc.).
- [ ] Multiple agents can post cards — each card shows its agent
      identity if available.

## 12. Design decisions (pre-made, don't revisit)

1. **`require_ack` defaults to `false`** — most cards are fly-by
   narration. Only walkthroughs need blocking.
2. **One global pane**, not per-plan. Per-plan threading is v3.
3. **User replies (v2) queue for next `await_user_input` poll** —
   don't interrupt a running tool. Matches `wait_for_steer` semantics.
4. **No DB storage** — presence is session-level. Pin-to-item (v3)
   promotes to the existing comment system, which is already durable.
5. **Built-in TTS is the floor** — works everywhere, zero config.
   BYO premium voice is opt-in v3.
