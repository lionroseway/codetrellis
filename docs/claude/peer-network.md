# Peer Network

CodeTrellis devices (desktops and mobile companions) form a peer-to-peer mesh over WebRTC. There is no central CodeTrellis server brokering traffic — peers find each other on the local network via mDNS, exchange SDP through a small pairing handshake, and then talk directly over WebRTC data channels.

## BYO-VPN philosophy

The "bring your own VPN" model means CodeTrellis assumes peers are reachable to each other but does not run its own relay or signaling service. On the same LAN that's automatic. For remote scenarios users bring their own connectivity — Tailscale, WireGuard, ZeroTier, corp VPN, whatever — and CodeTrellis treats the result the same as a LAN. STUN is used for NAT traversal where direct paths are available; there is currently no first-party TURN relay.

Practical consequences:
- No CodeTrellis account or login is required for peering.
- No telemetry on traffic flows through CodeTrellis infrastructure — pairing and session content stay between paired devices.
- Internet reachability is the user's problem to solve via their VPN of choice.

## Discovery (mDNS)

Desktops advertise the service `_codetrellis._tcp` over mDNS. TXT records carry:
- Desktop IP
- Mobile API port
- Identity fingerprint
- Human-readable device name

Mobile uses `react-native-zeroconf` to browse for instances. Desktop uses `mdns-service` (built on `bonjour-service`) for both advertising and discovering peers.

## Pairing flow

Pairing establishes a persistent, encrypted association between two devices.

1. Desktop's `pairing-server` exposes a short-lived HTTP endpoint that returns a pairing handshake. A QR code rendered on the desktop encodes the pairing host, port, and a 6-digit pairing code (~50 bytes, QR v4).
2. Mobile scans the QR via `expo-camera`, hits the pairing server, and exchanges SDP offer/answer.
3. Both devices independently derive a 6-digit *confirmation* code (Bluetooth-style) from the negotiated SDP. The user visually compares them on screen before approving — this guarantees the channel wasn't MITM'd during SDP exchange.
4. Peer identity is persisted: mobile stores in `expo-secure-store`, desktop via `paired-device-service`. Subsequent reconnects skip the QR step entirely.

`pairing-service` orchestrates the desktop side; `app/pair.tsx` is the mobile screen.

## WebRTC mesh

Once paired, peers establish a standard `RTCPeerConnection` per session. Desktop uses [werift](https://github.com/shinyoshiaki/werift-webrtc) (pure-JS WebRTC for Node). Mobile uses `react-native-webrtc` (linked via the `@config-plugins/react-native-webrtc` Expo config plugin; requires a dev/prod build, not Expo Go).

`peer-connection-service` manages the mesh: liveness, reconnect, and bidirectional peer sync. `webrtc-service` orchestrates the data channels described below.

## Data channels

Four named data channels carry all peer traffic. Each has a distinct protocol and payload type:

| Channel | Protocol | Payload | Used for |
|---|---|---|---|
| `control` | JSON-RPC over text | `{ method, params, id, rpc: true }` envelopes | RPC calls, channel events, user-input requests, MCP commands (`mobile_navigate`, `mobile_screenshot`, `mobile_present`) |
| `ui` | Snapshots + JSON patches | Full state snapshot, then `fast-json-patch` diffs | State sync — workspace store hydration on connect, then live patches |
| `terminal` | Binary framing | `[0x03][index][UTF-8 input]` / `[0x02][index][output]` | PTY proxy between desktop terminals and mobile xterm.js |
| `audio` | WebM/Opus chunks | Binary frames | Mic + system audio streaming, buffered server-side by `audio-buffer-service` |

The `control` channel is the bidirectional RPC backbone. Mobile sends RPC requests via `mobile/lib/rpc.ts` (request–response correlation by id, default 30s timeout, user-tunable). Desktop dispatches via `mobile-rpc-service`. Either side can also send MCP-flavoured commands: `{ mcp: true, cmd: 'navigate' | 'screenshot' | 'present', route?, id? }`.

For window streaming (the inbound desktop → mobile case the team is currently considering), the natural fit is either a fifth channel (`video` or `frames`) on the same WebRTC connection, or extending the existing `ui` channel with image-frame payloads. The `screenshot.chunk` pattern (JPEG downscaled to 540px, chunked under 8KB) used in the reverse direction is a working precedent.

## Identity & auth

- Each device has a stable identity (fingerprint advertised in the mDNS TXT record).
- The pairing flow's 6-digit confirmation guarantees the SDP exchange wasn't MITM'd.
- Persistent peer credentials live in `expo-secure-store` on mobile and via `paired-device-service` on desktop.
- There is no CodeTrellis account system — auth is entirely peer-to-peer.

## Multi-device & presence

- Multiple desktops can be paired to a single mobile, and vice versa.
- `connection-switcher` (mobile route) lets the user pick which paired desktop to view.
- `presence-store` (frontend) tracks peer online/offline + device metadata for the topbar `ConnectedAgents` widget and the presence component tree.
- `remote-interaction-service` resolves cross-device events like user-input requests — first response wins.
