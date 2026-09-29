# Mobile Companion

The CodeTrellis Companion is an Expo / React Native app that pairs with a desktop CodeTrellis instance and acts as a remote control + monitoring surface for AI coding agents running on the desktop. It lives in `/mobile/`.

## App identity

| Field | Value |
|---|---|
| Display name | CodeTrellis Companion |
| Slug | `codetrellis` |
| Version | `0.1.12` (from `mobile/app.json`) |
| iOS bundle ID | `dev.codetrellis.mobile` |
| Android package ID | `dev.codetrellis.mobile` |
| Expo org / owner | `ailar` |
| EAS project ID | `47be6d4e-2e16-47a9-958d-afb4ebaab412` |

## Stack

- **Expo SDK 57.0.23**
- **Expo Router 6.0.23** with `typedRoutes: true` — file-based routing rooted at `mobile/app/`.
- **React 19.2.3**, **React Native 0.86.3**
- **Zustand 5** for state (`useWorkspaceStore` is the main one)
- **react-native-webrtc 124** (via `@config-plugins/react-native-webrtc`) — peer transport
- **react-native-zeroconf 0.14** — mDNS browser for `_codetrellis._tcp`
- **expo-camera** — QR code scanning for pairing
- **expo-secure-store** — persistent paired-device credentials
- **expo-notifications** — push notifications
- **react-native-view-shot** — screenshot capture (for the `screenshot` MCP command)
- **`@xterm/xterm` + `@xterm/addon-fit`** — terminal emulation for remote PTYs
- **fast-json-patch** — applies JSON patches on the `ui` data channel
- **qrcode**, **react-native-markdown-display**, **react-native-webview**

## Routes

Routes are file-based under `mobile/app/`, with `_layout.tsx` driving a Stack at the root:

- `index` — splash / initial routing
- `pair` *(modal)* — QR camera + pairing flow
- `(tabs)` — tabbed home (plans, projects, etc.)
- `workspace`, `projects`, `settings` — top-level screens
- `plan-detail`, `plan-channel`, `plan-templates` — plan-focused
- `item-detail`, `project-browser`, `system-docs`, `system-doc-detail` — content browsing
- `terminal-detail` — remote PTY via xterm.js
- `event-detail`, `changes`, `graph-file-detail` — event/diff viewers
- `input-request` *(modal)* — user input requested by an agent
- `approvals`, `approval` — work waiting on the person, and approving or sending back one criterion (Phase 31 §12; see below)
- `body-editor` *(modal)* — content editor
- `connection-switcher` *(modal)* — switch between paired desktops
- `doc-viewer` — document rendering

## Connection & transport

The mobile app does not speak HTTP to the desktop. All communication is over WebRTC data channels established during pairing — see `peer-network.md` for the channel inventory. The relevant files:

- `mobile/lib/discovery.ts` — mDNS browser, parses `_codetrellis._tcp` TXT records.
- `mobile/lib/webrtc.ts` — lazy-loads `react-native-webrtc`, creates the peer connection (dev builds only; not Expo Go).
- `mobile/lib/connection.ts` — connection lifecycle, channel routing, MCP command dispatch.
- `mobile/lib/rpc.ts` — JSON-RPC request/response correlation by id; default 30s timeout, user-tunable in Settings.
- `mobile/lib/bridge.ts` — forwards state snapshots/patches into an embedded WebView; captures `postMessage` events back.

## Approving from the phone (Phase 31 §12)

The person can approve an agent's work, or send it back, from the phone. How it fits together:

- **Where it starts.** A push titled "Approval needed" carries `criterionUid` and `itemUid`, and `routeForNotification` opens `/approval` directly. The home tab's "waiting for your approval" card and an item's CRITERIA section open the same screen.
- **What it calls.** `mobile/lib/approvals.ts` wraps four RPCs:
  - `criteria.awaiting` (read);
  - `criteria.list` (read);
  - `criterion.decide` (write — it also needs a pairing confirmed on the desktop, because the sign-off is recorded as the person's);
  - `artefact.preview` (files).
  The desktop half is `src/backend/services/mobile-approvals.ts`.
- **How previews arrive.** They are streamed, not returned, because one control message is capped at 64 KB. The phone picks a transfer id, and the desktop sends `preview.chunk` messages under it to that phone only. `mobile/lib/preview-transfer.ts` takes chunks only for ids it is waiting on, and it fails a transfer that changes its declared shape, passes its caps, or stalls.
- **What a preview shows.** It is what `read_material` reads, at the cited place:
  - a sheet's cells, with context rows and columns and the cited cells marked;
  - a document's page;
  - lines of a file;
  - or an image, which Electron scales down for the phone.

## Breakpoints on the phone (Phase 32 B4.4)

An agent held at a breakpoint the person set is answered from the phone as it is on the desktop. How it fits together:

- **Where it starts.**
  - On Home, "An agent is waiting on you" is the first card under NEEDS ATTENTION, above approvals: an agent is stopped until the person answers. It opens `/breakpoints`.
  - The snapshot carries `waitingBreakpoints`, a live count of held calls. An open app re-reads the list when it moves, so a new one shows without a push, and the tab badge counts it.
  - A phone that is not connected gets a push: "Waiting on you" for a pause, "Edited past a breakpoint" for a breach. The words name the agent only; which file, task or note is held loads over WebRTC once the app wakes. The data is `{ type: 'breakpoint', ref, planUid? }`, and `routeForNotification` opens `/breakpoints`.
- **What it shows.** Each card is the desktop's own wording, from `src/shared/lib/breakpoint-words.ts` and `workstream-words.ts`:
  - who wants to do what, in which workstream;
  - why it is waiting on the person;
  - the note the person left on the breakpoint.
  A breach is never worded as a pause: it happened, and the agent was told to stop and wait.
- **What it calls.** `mobile/lib/breakpoints.ts` wraps two RPCs:
  - `breakpoint.waiting` (read) returns the held calls, oldest first;
  - `breakpoint.answer` (write) sends continue, steer (with a note the agent reads) or stop. It also needs a pairing confirmed on the desktop, because the answer is recorded as the person's. It is audited against the device, and the desktop is told.
  The first answer stands wherever it was given. A late answer from the phone gets back the answer that stood, marked `alreadyAnswered`.
  The desktop half is `src/backend/services/mobile-breakpoints.ts`.

### What overlaps (Phase 32 A4.2)

The desktop half is `src/backend/services/mobile-awareness.ts`; the screens
come in A4.5. It follows the approvals pattern: pulled over RPC, with a count
in the snapshot.

- **The count.** The snapshot carries `openSignals`: open high and medium
  signals in the opened project, as the desktop's Awareness tab counts them
  (`countNeedsYou`, one indexed count). The folder and ref watchers keep the
  stored signals current, window open or not.
- **What it calls.**
  - `awareness.needsYou` (read) returns the digest's lines (`awareness-digest.ts`)
    and the high and medium signals still in play: open first, then seen. Low
    and set-aside signals are left to the desktop.
  - `awareness.signal` (read) returns one signal with each side in plain words
    (`src/shared/lib/signal-words.ts`, the desktop's words), its files, the
    agents told and what they said, and the replies.
  - `awareness.answer` (write) acknowledges, marks intended, dismisses or
    reopens.
  - `awareness.reply` (write) sends the person's words to the agents in the
    signal's workstreams, the desktop's own path (`replyToSignalAsPerson`,
    A4.1). The agent reads it as "from the person, from their phone".
  Both writes need a pairing confirmed on the desktop, are audited against the
  device, carry the phone as the channel (`phoneActor()`), and tell the
  desktop.

### A serious overlap, pushed (Phase 32 A4.4)

When a high signal opens (new, back after resolving, reopened after the
person answered it, or raised to high while open: `newlySerious` in
`awareness-signals.ts`), `refreshSignals` calls `pushForSignal`. A phone that
is not connected gets "Needs you" with one sentence naming the kind of
overlap and nothing else. No file, function, branch or agent reaches Expo.
The data is `{ type: 'signal', id }`. One push per kind per minute per
device, never to a phone watching live, whose `openSignals` count moves
instead. The watchers run this with no window open, which is the point.

`CODETRELLIS_PUSH_URL` can point pushes at a receiver on this machine
(`127.0.0.1` or `localhost` only; anything else is ignored), which is how the
harness sees them. The tap's route to the signal's screen comes with the
screens in A4.5.

### The lines of work (Phase 32 A4.3)

`src/backend/services/mobile-workstreams.ts`, read-only:

- `workstreams.list` returns each line of work as the strip names it
  (`chipLabel`), idle ones left out: its agents, the unfinished tasks they
  have claimed, how many files it has changed, the live signals naming it and
  how many of those need the person.
- `workstreams.detail` takes an id from that list, never a folder the phone
  makes up. It returns the changed files (with line counts where git gave
  them), how far it is from main, and its ten most recent turns, newest first,
  grouped and summarised by the Timeline's own code
  (`src/shared/lib/agent-turns.ts` and `tool-phrasing.ts`, moved from the
  frontend for this). A turn is named by its session's agent as it stands now,
  not by the `mcp-client` guess a session carries until its client names
  itself.

## Seeing the screens (Phase 32 A4.5a)

`npm run test:phone` renders the real screens from `mobile/` in a browser and
photographs them to `test-results/phone/`. `tools/phone-preview` is a Vite
page: `react-native` is react-native-web, `expo-router` and the native
modules are stand-ins in `tools/phone-preview/stubs/`, and `mobile/lib/rpc.ts`
answers from fixtures. A spec (`tests/phone/*.spec.ts`) opens one screen with
the desktop's side given:

```ts
await openScreen(page, 'breakpoints', {
  state: { waitingBreakpoints: 2 },                  // typed as WorkspaceSnapshot
  rpc: { 'breakpoint.waiting': { hits: [HELD] } },   // answers to the phone's calls
});
expect(await calls(page)).toContainEqual(...);        // what a tap sent
expect(await navigations(page)).toContainEqual(...);  // where it asked to go
```

A new screen joins the preview's table in `tools/phone-preview/main.tsx` (name,
title, import). CI runs the specs and uploads the screenshots. It is a way to
see screens, not a web build: WebRTC, the camera, push and the terminal never
run there.
## State sync

Desktop pushes a full snapshot of relevant workspace state on connect over the `ui` channel, then streams `fast-json-patch` diffs. Mobile applies them into `useWorkspaceStore`. This is the same pattern used for plan state, terminal scrollback metadata, presence, and channel events.

## Mobile MCP commands

The desktop can drive the mobile UI via the `control` channel using MCP-flavoured commands. Three are wired today:

| Command | Effect |
|---|---|
| `mobile_navigate` | Pushes a route onto the mobile Stack (e.g. jump to `plan-detail?id=…`) |
| `mobile_screenshot` | Mobile captures its current screen via `react-native-view-shot`, downscales to 540px JPEG, chunks it under 8KB, streams `screenshot.chunk` events back over `control` |
| `mobile_present` | Presents a modal/sheet (the user-input-request and connection-switcher modals are driven this way) |

The reverse direction (mobile streams the desktop's window to phone) is the window-streaming feature currently being designed. The `screenshot.chunk` pattern is a working precedent for the rudimentary path; WebRTC video tracks on the same `RTCPeerConnection` are the slick path.

## Scripts

From `mobile/package.json`:

| Script | Command | Use |
|---|---|---|
| `npm start` | `expo start` | Expo dev server |
| `npm run dev` | `expo start --dev-client` | Dev mode against a custom dev client (needed for `react-native-webrtc`) |
| `npm run ios` | `expo run:ios` | Local iOS build + run |
| `npm run android` | `expo run:android` | Local Android build + run |
| `npm run build:dev` | `eas build --profile development --platform all` | EAS dev client build |
| `npm run build:preview` | `eas build --profile preview --platform all` | EAS internal-distribution build |
| `npm run build:prod` | `eas build --profile production --platform all` | EAS production build |
| `npm run lint` | `eslint . --ext .ts,.tsx` | Lint — **currently broken**: no eslint config or dependency in `mobile/`, and `--ext` was removed in ESLint 9. The desktop got a flat config in Phase 29; this package did not. |
| `npm run typecheck` | `tsc --noEmit` | Type check |

## Release flow

Mobile release is **build-only today** — there is no `eas.json` and no submit configuration, so the App Store and Play Store steps are manual:

1. Bump the version in `mobile/app.json`.
2. `cd mobile && npm run build:prod` — kicks off an EAS build for iOS + Android.
3. Once builds complete in EAS, download the IPA / AAB.
4. Submit manually to TestFlight / Play Console.

Gaps to close when mobile release is formalised:
- Add `mobile/eas.json` with `development` / `preview` / `production` build profiles and `submit` config for both stores.
- Add a `scripts/release-mobile.sh` analogous to the desktop `scripts/release.sh`.
- Decide whether mobile version bumps are coupled to desktop version bumps or independent.

The desktop release flow (`scripts/release.sh`) covers macOS / Windows / Linux only — mobile is not integrated into it.
