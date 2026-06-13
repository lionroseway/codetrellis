# Notifications — Design Spec

**Status:** Proposed · **Author:** (drafted with Claude) · **Scope:** desktop + mobile companion

A plan to grow CodeTrellis from "two notification triggers" into a coherent,
preference-driven **notification layer** that surfaces the right events — agent
needs you, plan drift, item done, terminal finished, channel activity — on the
phone (push, even when the app is closed) and the desktop (toast), without
becoming noise.

> Researched against the live codebase (June 2026). File:line references are
> anchors for implementation, not guarantees they won't move.

---

## 1. Goals & non-goals

**Goals**
- One **unified notification pipeline** every event source feeds, instead of
  per-feature push code.
- **Push to the phone when the app is backgrounded/closed** (the case in-app
  sync can't cover) — via the existing desktop→Expo path (no central server).
- **Presence-aware**: don't push what the user is already watching.
- **Preference-driven**: per-category enable/disable, quiet hours, per-project
  overrides — reusing the existing routing-rule model, not a parallel one.
- **Cover the real events**: channels (6 types), drift/deviations, plan-item
  status, input requests, agent turn-end, terminal completion, freeze, stuck.
- **Deep-link** every notification to the exact screen that resolves it.

**Non-goals (for now)**
- A central push relay / cloud server (keeps the BYO-VPN, no-server model).
- Email/SMS (webhooks already cover external fan-out; out of scope here).
- Cramming non-collaboration events into the channel vocabulary (see §4).

---

## 2. Current state (grounded)

**What already works**
- **Desktop fires Expo push directly** — `push-notification-service.ts`
  (`EXPO_PUSH_URL = https://exp.host/--/api/v2/push/send`). Batched POST,
  per-`(fingerprint,eventType)` rate-limit (60 s), `data` payload for
  deep-linking, `channelId: 'codetrellis-events'`. **This is the right
  architecture — keep it.**
- **Token plumbing** — mobile `registerForPush()` → `getExpoPushTokenAsync` →
  `sendPushTokenToDesktop()` over the control channel (`register-push-token`),
  handled in `remote-interaction-service.ts`; also a REST fallback
  (`POST /api/peers/push-tokens`). Re-sent on every connect.
- **Mobile receive/tap** — `mobile/lib/push.ts` `onNotificationTap()` +
  `getInitialNotification()` read `data` (today: `{ eventId, planSlug }`).
- **One trigger wired**: `pushForChannelEvent` is called from
  `channel-dispatcher-service.dispatchChannelEvent()` for `stuck` /
  `need-decision` / `need-context` (the `PUSH_WORTHY_EVENTS` set).
- **A routing model exists** — `ChannelRoutingRule` in
  `project-config.ts` (`when` → `notify`), targets `in-app-toast` | `webhook`,
  matched by `matchChannelRoutingRules()`, fired immediately + on a 30 s
  stale-sweep, deduped in-memory by `${ruleId}:${eventUid}`.

**Gaps**
- `pushForInputRequest` **exists but is never called** — "agent needs you" (the
  single highest-value push) is dead code. Quick win.
- Push is a **parallel hardcoded path** (`PUSH_WORTHY_EVENTS`), *not* a routing
  target — so it can't be configured, gated, or extended without code edits.
- **No presence gating** — `connectedPeerCount()` exists but push fires
  regardless of whether the phone is connected/foreground.
- **Tokens are in-memory only** (`Map`), keyed by ephemeral `fingerprint`,
  lost on restart, not cleaned up on unpair/disconnect.
- **No preferences** — no per-category toggle, no quiet hours. `AppSettings`
  has no `notifications` section.
- Only channel events reach push. Plan-item status, agent turn-end, terminal
  completion, deviations (directly), freeze — none notify.

---

## 3. Architecture — a unified notification bus

Introduce a single normalized event and one dispatcher all sources call. This
is the central decision: **generalize, don't funnel everything through channel
events.** (The channel vocabulary is intentionally small — docs explicitly say
"checkpoint-style progress milestones … belong in the plan timeline, not here."
So item-done / turn-end / terminal-done must *not* become channel events.)

```ts
// src/backend/services/notification-service.ts  (evolves push + channel-dispatcher)
interface NotificationEvent {
  category: NotificationCategory;     // see §4 taxonomy
  title: string;
  body: string;
  severity: 'info' | 'attention' | 'urgent';
  projectRoot: string | null;
  planUid?: string;
  dedupeKey: string;                  // collapse duplicates (e.g. `item:${uid}:done`)
  deepLink: DeepLink;                 // §6 — { route, params }
  sinks?: ('push' | 'toast' | 'webhook')[]; // default derived from prefs
  data?: Record<string, unknown>;     // extra payload for the client
}

function notify(event: NotificationEvent): void;
```

**Flow:** source → `notify(event)` → (1) resolve effective prefs (global +
per-project + per-category) → (2) **presence gate** → (3) **dedupe / coalesce /
quiet-hours** → (4) fan out to enabled sinks.

- **push** → `push-notification-service.sendExpoPush()` (existing).
- **toast** → `broadcast('channel-toast-elevated' | 'notification-toast')` (existing desktop path).
- **webhook** → existing `channel-dispatcher` webhook POST.

Channel events become **one source** that calls `notify()`; the current
`channel-dispatcher` push path is replaced by routing through the bus. Existing
`ChannelRoutingRule` is extended with a **`push`** target so per-project rules
can already say "push need-decision events."

---

## 4. Event taxonomy (what notifies, by tier)

Tier = value ÷ effort. Each row: the **source hook** (a real broadcast/fn) and
the **category**.

### Tier 1 — "the agent needs you" (highest value, signals exist)
| Category | Source hook | Notes |
|---|---|---|
| `input-request` | `remote-interaction-service.broadcastInputRequest()` / presence `await_user_input` | **Wire the dead `pushForInputRequest`.** Urgent, no rate-limit. |
| `channel:stuck` | `broadcast('channel-event-posted')` (eventType=stuck) | already pushes; route through bus |
| `channel:need-decision` | same | already pushes |
| `channel:need-context` | same | already pushes |
| `channel:handing-off` | same | **add** (a handoff to *you* should notify) |

### Tier 2 — plan progress (signals exist, just unrouted)
| Category | Source hook | Notes |
|---|---|---|
| `item-done` | `broadcast('plan-item-updated', { changes:{status:'done'} })` | gate to `action` items; coalesce bursts |
| `item-blocked` | same (`status:'blocked'`, `blockedReason`) | attention |
| `plan-complete` | `plan-progress-service` (all actions done) / `task-completion-suggested` | celebratory, once per plan |
| `deviation` (drift) | `broadcast('deviation-detected', { deviation })` | **§5** — severity-gated, debounced |

### Tier 3 — agents & terminals (needs detection work)
| Category | Source hook | Effort |
|---|---|---|
| `agent-turn-end` (Claude) | session-JSONL watcher: assistant turn ends, no pending `tool_use`; corroborate with `agent-event` (tool_call) quiescence + `lastSeen` heartbeat | **medium** |
| `agent-idle` (Codex/aider) | no JSONL → terminal-prompt-return / `lastSeen` stall | medium |
| `terminal-command-done` | **OSC 133 shell-integration markers** (inject prompt-start/end into the PTY env) → reliable "command exited, code N". Heuristic idle is the fallback. | **larger** |
| `terminal-exit` | `terminal-service.onTerminalExit(exitCode)` | small (process died) |

### Tier 4 — governance / housekeeping (low frequency)
| Category | Source hook |
|---|---|
| `freeze-changed` | `broadcast('freeze-changed', { status })` |
| `doc-stale` | sensor-bridge → already a `need-decision` channel event |
| `contribution-ready` | `contribution-service.promote…` (no broadcast yet — add one) |

**Default-on (push):** Tier 1 + `item-blocked`, `plan-complete`, `agent-turn-end`.
**Default-off (toast-only / opt-in):** `item-done`, `terminal-command-done`,
Tier 4 — these are frequent or low-urgency.

---

## 5. Drift / deviations — explicit handling

Drift is first-class per the user's ask, and it's subtle:

- **Two existing entry points:** `detectDeviations()` and on-file-change
  `checkFileDeviation()` both `broadcast('deviation-detected', { deviation })`.
- **Already debounced into channels:** `sensor-bridge-service` batches
  deviations (`drift.debounceMs`, default 2000 ms) and posts a single
  `need-decision` channel event per batch. So a naive "push on every
  deviation-detected" **would double-notify** (raw + the batched channel event).
- **Decision:** notifications for drift ride the **batched channel event**, not
  the raw `deviation-detected`. The bus dedupes by `dedupeKey =
  plan:${planUid}:drift` within the coalesce window so a 12-file scope-creep is
  *one* "Plan has drifted (12 changes)" notification, deep-linking to the plan's
  Changes/Deviations view.
- **Severity gate:** only `severity:'warning'` deviations (scope_creep, off_plan,
  missing/unexpected) notify by default; `info` stays in-app.
- Resolving a deviation (`resolveDeviation`) is **not** a notification (it's the
  user's own action).

---

## 6. Deep-link contract

Notification `data` carries a normalized deep link; mobile routes it on tap
(extend `mobile/lib/push.ts onNotificationTap` + the desktop `mobile_navigate`
path in `connection.ts handleMobileCommand`, which already does `router.navigate`).

```ts
type DeepLink =
  | { route: 'item';   planUid: string; uid: string }   // → /item-detail
  | { route: 'plan';   planUid: string }                // → /plan-detail
  | { route: 'channel-event'; uid: string }             // → /event-detail
  | { route: 'input';  requestId: string }              // → /input-request (modal)
  | { route: 'terminal'; id: string }                   // → /terminal-detail
  | { route: 'changes'; planUid?: string }              // → /changes
  | { route: 'tab'; tab: 'plans'|'activity'|'terminals'|'graph'|'home' };
```

Route table confirmed against `mobile/app/_layout.tsx`. Tapping a notification
for a closed app uses `getInitialNotification()`; for a foregrounded app uses
the tap listener; both translate `DeepLink` → `router.push(...)`.

---

## 7. Preferences model

Reuse the two existing layers rather than invent a third.

**Global (per device/user) — new `AppSettings.notifications`** (`settings.ts`):
```ts
interface NotificationSettings {
  enabled: boolean;                         // master
  quietHours?: { enabled: boolean; start: string; end: string }; // "22:00".."08:00"
  categories: Record<NotificationCategory, {
    push: boolean;       // to phone
    toast: boolean;      // desktop in-app
  }>;
  coalesceWindowMs?: number;                // default 30_000
}
```
Persisted to `settings.json`; merged by `mergeWithDefaults()` (add-only).
Exposed on **desktop** Settings panel and **mobile** `app/settings.tsx`
(synced via the existing `settings.get`/`settings.update` RPC).

**Per-project — extend `ProjectConfig.channels.routing`** with a `push` target
and a generalized `when.category` so a repo can, e.g., mute `item-done` for a
noisy refactor plan or force-push `stuck` to everyone. The bus consults
per-project rules then global prefs (project can only *narrow* push, never
override a user's master-off).

---

## 8. Gating, dedupe, quiet hours

1. **Presence gate** — push only if the target phone is **not actively
   connected+foreground**. Requires a small addition: mobile reports
   foreground/background over the control channel (`AppState` →
   `app-foreground`/`app-background`), desktop tracks it per device. If
   connected+foreground → toast/in-app only; else → push.
2. **Dedupe** — by `dedupeKey` within the coalesce window (persist the fired-set
   so it survives restart — the current in-memory `firedNotifications` set and
   in-memory token map are both restart-fragile).
3. **Coalesce** — burst categories (item-done, drift, agent tool noise) collapse
   to one notification per `coalesceWindowMs` per `(planUid,category)`.
4. **Rate-limit** — keep the existing per-`(device,category)` 60 s floor;
   `input-request`/`urgent` bypass.
5. **Quiet hours** — suppress `push` (not toast) during the window; `urgent`
   (input-request) still breaks through.

---

## 9. Token lifecycle hardening (prereq)

- **Persist** tokens with the paired-device record, keyed by **stable
  `pairingId`** (not ephemeral `fingerprint`), so push survives a desktop
  restart and a mobile reconnect.
- **Clean up** on `unpair` and on a long disconnect (avoid pushing to a token
  the user revoked).
- **Receipts** — read Expo push receipts (currently fire-and-forget); drop
  `DeviceNotRegistered` tokens automatically.

---

## 10. Phased delivery

Each phase is independently shippable and testable.

**Phase N1 — Bus + wire the obvious wins (small)**
- Add `notification-service` with `notify()`, fold the existing channel→push
  path into it, **wire `pushForInputRequest`** (input-request → urgent push),
  add `handing-off`. Presence gate (basic: `connectedPeerCount`). Token persist
  + cleanup.
- *Acceptance:* agent `await_user_input` with the phone backgrounded → push
  arrives, tap opens `/input-request`; the four channel types still push; no
  push when the phone is foreground.

**Phase N2 — Preferences + deep-links (small/med)**
- `NotificationSettings` (types + merge + desktop & mobile Settings UI),
  per-category push/toast toggles, quiet hours. Full `DeepLink` routing on tap.
  Extend `ChannelRoutingRule` with `push` target + `when.category`.
- *Acceptance:* toggling a category off stops its push; quiet hours suppress
  non-urgent push; every notification deep-links correctly.

**Phase N3 — Plan progress + drift (med)**
- `item-done`/`item-blocked`/`plan-complete` sources; drift via the **batched**
  channel event with severity gate + coalesce.
- *Acceptance:* completing the last action → one "Plan complete" push; a
  12-file scope-creep → one "drift" push, not twelve; `info` deviations silent.

**Phase N4 — Agents & terminals (med/larger)**
- Claude turn-end via JSONL watcher; Codex/aider idle heuristic; terminal
  completion via OSC 133 shell integration (opt-in), `terminal-exit` via
  `onTerminalExit`.
- *Acceptance:* "Claude finished in <project>" fires once per turn end (not per
  tool call); a long `npm test` completing with the app closed → push with exit
  status, tap opens `/terminal-detail`.

---

## 11. Risks & open questions

- **Notification fatigue** — the #1 failure mode. Conservative defaults (Tier 1
  on, frequent categories off), aggressive coalescing, and easy muting are
  load-bearing, not polish.
- **Agent turn-end precision** — JSONL "end of turn" vs "paused mid-thought" is
  fuzzy; needs a quiescence debounce (e.g. no tool_call + no JSONL delta for N
  s) to avoid premature "done." Codex/aider without JSONL are best-effort.
- **OSC 133 injection** — reliable terminal-done needs us to inject shell
  prompt markers into the PTY env per shell (zsh/bash/fish); scope carefully or
  ship `terminal-exit` only first.
- **Multi-device** — push fans out to *all* paired phones; per-device prefs?
  (v1: same prefs all devices; revisit.)
- **iOS background limits** — remote push is fine (APNs via Expo); the desktop
  must be reachable to *send* (it is — outbound HTTPS). If desktop is asleep, no
  push — acceptable (the events originate there anyway).
- **Quiet-hours timezone** — use device-local; store as HH:MM, evaluate on the
  desktop's clock (notifications originate desktop-side). Document the caveat.

---

## 12. Testing

- Unit: prefs resolution (global×project×category), quiet-hours window math,
  dedupe/coalesce key collapsing, severity gate.
- Integration (harness): drive `await_user_input` / post each channel type /
  flip item status / inject a deviation batch → assert exactly-one push with the
  right `deepLink`, and zero push when foreground.
- Manual matrix: app foreground / background / killed × each Tier-1 category ×
  iOS + Android; tap-to-deep-link from a cold start.

---

## Appendix — key files

- Push: `src/backend/services/push-notification-service.ts`
- Dispatch/routing: `src/backend/services/channel-dispatcher-service.ts`,
  `project-config-service.ts`, `src/shared/types/project-config.ts` (ChannelRoutingRule)
- Event sources: `channel-event-service.ts`, `deviation-service.ts`,
  `sensor-bridge-service.ts`, `plan-item-service.ts`, `plan-progress-service.ts`,
  `remote-interaction-service.ts`, `session-service.ts`, `terminal-service.ts`,
  `freeze-service.ts`
- Settings: `src/shared/types/settings.ts`, `settings-service.ts`
- Mobile: `mobile/lib/push.ts`, `mobile/lib/connection.ts` (handleMobileCommand),
  `mobile/app/_layout.tsx` (routes), `mobile/app/settings.tsx`
