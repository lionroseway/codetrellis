# Mobile Companion

This document describes the mobile companion as a target architecture — none of it is built yet. Mobile is the last surface to ship; the doc captures the design so the model is settled before implementation begins.

## The premise

Most planning tools that try to do mobile end up building a second product: a parallel client with its own state, its own sync layer, its own offline behaviour. CodeTrellis takes a different approach. The mobile companion is **a streamed view of the desktop**, not a separate application. Desktop is authoritative; mobile is a thin window onto it.

This shape has consequences:

- **No separate mobile state.** Everything the mobile shows is a render of desktop state.
- **No new sync layer.** The desktop is the only thing that has to be right.
- **Drastically less to build and maintain.** Mobile becomes a transport + viewer, not a re-implementation of the workspace.

Think Sidecar for CodeTrellis: when the mobile is connected, it gives you a usable surface for the same workspace; when it disconnects, no state is lost on either side.

## What the mobile companion does

| Capability | What it gives the user |
|---|---|
| **View plans** | Browse plans, drill into items, read comments, see status — streamed from the desktop |
| **Read and respond to channels** | See `stuck`, `need-decision`, `weigh-in` events and post `steer` or `weigh-in` responses back |
| **View terminals** | Watch what's running in a desktop terminal, send input if needed (read-mostly is fine for v1) |
| **Respond to MCP-prompted input** | When an agent calls `await_user_input` and the user is away from the desk, the prompt routes to the paired mobile |
| **Browser tunnel** | Tap "tunnel port 3000" — the mobile loads a local web app from the desktop through the existing P2P connection. Useful for testing what you're building on a real phone without configuring ngrok or finding the LAN IP. |
| **Push notifications** | Stuck events, need-decision events, channel mentions — surfaced as native push so you can respond when not at the desk |

What the mobile companion does *not* do, by design:

- Run its own copy of the plans or graph
- Maintain offline state that needs to sync back later
- Provide a parallel authoring surface (you don't write specs on the phone; you respond)
- Host any agent inference (same BYO ethos as the desktop)

## Pairing

Pairing a mobile device to a desktop is a bidirectional confirmation that also establishes the WebRTC connection — the QR code carries the signalling payload, so no listening port is needed:

1. The desktop generates a **WebRTC offer** (SDP + ICE candidates via STUN) and displays it as a **QR code**.
2. The mobile **scans the QR**. This proves the mobile has line-of-sight to the desktop's screen and gives it the offer.
3. The mobile creates a WebRTC answer, then **displays a 6-digit confirmation code** derived from the answer's fingerprint. The user enters this code on the desktop.
4. The desktop receives the answer payload (via an ephemeral UDP exchange lasting <5 seconds), completes the WebRTC handshake, and the **data channel opens**.

Both ends actively confirm. A leaked photo of the QR is not sufficient — without the numeric back-confirmation and WebRTC answer delivery, the pairing doesn't complete. Both QR and code **expire** after 60 seconds.

Once paired, the mobile device is remembered (shared secret from the DTLS handshake stored in secure storage). Multiple desktops can be paired to one phone (a developer with several machines), and multiple phones to one desktop (rare but supported).

## Discovery

Discovery is AirPlay-shaped. On the same LAN, the mobile sees a list of CodeTrellis desktops via **Bonjour / mDNS** advertisements (`_codetrellis._tcp`). mDNS is informational only — it says "I'm here" but does not establish a connection. The user taps a discovered desktop to see its pairing QR, or the QR is already visible on the desktop screen. Previously-paired devices reconnect automatically over WebRTC when both are on the same network.

On networks where mDNS is blocked (some corporate VPNs, hotel WiFi, restrictive guest networks), the user simply **initiates pairing from the desktop** — the QR appears regardless of whether mDNS works. Most users never need to think about this.

The user experience the discovery model targets:

- Open the mobile app at home → desktop appears in the list → tap to reconnect (WebRTC auto-reconnect)
- Open at the office → office desktop appears alongside home desktop → tap to switch
- Open at a customer site over a guest WiFi where mDNS is blocked → pair via QR code on the desktop screen → connect

## Off-LAN: bring your own VPN

When the user is on a different network from the desktop — at a café, travelling, at a customer site — connecting to the desktop requires a network path between the two devices. CodeTrellis does not provide that path. The user's existing VPN does.

For users on Tailscale, mesh VPNs, or corporate VPNs that pass peer connections, the desktop's address is reachable from the mobile via the VPN. Pairing and reconnection happen exactly as they would on a LAN.

This is the same BYO pattern as everything else. We never run relay servers, never issue certificates, never become a network operator. The user's existing VPN handles the security review their security team has already done; CodeTrellis composes on top.

For users without a VPN, off-LAN access isn't supported, and that's the right answer: introducing our own tunnelling infrastructure would create the security review surface we are explicitly avoiding.

## Transport

The streamed view uses **WebRTC** for the peer-to-peer channel between mobile and desktop. WebRTC punches through NAT without opening any listening ports — CodeTrellis never binds to 0.0.0.0, keeping all existing ports (:3001, :5173, :19432) bound to localhost. The QR-based pairing carries the WebRTC signalling payload directly, eliminating the need for a separate signalling server.

Data flows over multiplexed **WebRTC data channels**: `control` (JSON-RPC commands), `ui` (state snapshots/patches for the mobile WebView), `terminal` (binary PTY I/O), and `audio` (WebM/Opus chunks). The mobile app ships a **bundled copy** of the mobile UI — state arrives over WebRTC and is injected into a local WebView via `postMessage`, so no HTTP connection to the desktop is needed.

On the same LAN or on a Tailscale-style VPN, no TURN relay is needed. For more exotic networks, the user's choice of VPN determines whether peers can reach each other at all — and if their VPN can do it, WebRTC will work.

The connection layer is abstracted: `{ type: 'webrtc' }` for local desktop peers today, with a stubbed `{ type: 'hosted' }` for future cloud-hosted CodeTrellis.

## What ships in v1

The first version of the mobile companion focuses on **read + respond + browser tunnel**:

- Browse plans, items, comments, channel events
- Respond to `stuck`, `need-decision`, `weigh-in` events
- Receive `await_user_input` prompts when away from the desk
- Push notifications for events worth waking the user
- Terminal viewing (read-only first; write later)
- Browser tunnel for local web apps

What's deferred to later:

- Full terminal input (bandwidth and UX are non-trivial on mobile)
- Authoring (creating items, writing specs — better done at a keyboard)
- Multi-stream views (one connection at a time in v1)

## Relation to other levels

The mobile companion does not introduce a new level of adoption. It's an access pattern that extends the existing levels: Level 4 (agent collaboration) gets responsive when the user is away from the desk; Level 5 (team and multi-device) gets a clearer device story; Level 7 (AI in collaboration) gets a path for the AI to surface things to the user wherever they are.

Mobile remains optional — most users will use the desktop and never pair a phone. The companion is for the cases where the work doesn't wait for you to be at the desk.
