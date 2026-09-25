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
