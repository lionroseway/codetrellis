# Phase 9 — Discovery and Pairing: Tester Instructions

## What was built

Phase 9 delivers the peer-to-peer foundation for CodeTrellis's multi-device story. Devices discover each other via mDNS, pair via QR code, and communicate over WebRTC data channels — without opening any network ports.

### Components

1. **mDNS discovery service** (`src/backend/services/mdns-service.ts`)
   - Advertises this CodeTrellis instance as `_codetrellis._tcp` on the LAN
   - Browses for other instances continuously
   - Informational only — discovery does not establish connections
   - Uses `bonjour-service` (pure JS, cross-platform)

2. **Paired device storage** (`src/backend/services/paired-device-service.ts`)
   - CRUD for paired devices in `~/.codetrellis/paired-devices.json`
   - Stores fingerprint, alias, device type, shared secret for auto-reconnect

3. **Pairing service** (`src/backend/services/pairing-service.ts`)
   - QR-based WebRTC signalling: desktop generates offer → QR → mobile scans → answer via ephemeral UDP
   - 6-digit confirmation code derived from fingerprint + nonce
   - 60-second expiry window, single-use nonces, replay prevention
   - Manual paste fallback when UDP doesn't work

4. **WebRTC connection service** (`src/backend/services/webrtc-service.ts`)
   - Uses `werift` (pure TypeScript WebRTC, no native deps)
   - Offer/answer creation with ICE gathering via STUN
   - Four named data channels: `control`, `ui`, `terminal`, `audio`
   - Heartbeat on control channel (10s interval, 3 misses = dead)

5. **Peer connection manager** (`src/backend/services/peer-connection-service.ts`)
   - Orchestrates discovery → pairing → WebRTC → reconnect lifecycle
   - High-level API for MCP tools and REST routes

6. **MCP tools** (`src/backend/mcp/tools/peer-tools.ts`)
   - `get_peer_status` — overview of manager state
   - `list_discovered_peers` — mDNS-discovered instances
   - `list_paired_devices` — devices that completed QR pairing
   - `list_peer_connections` — active WebRTC connections
   - `unpair_device` — remove a paired device

7. **REST endpoints** (in `src/backend/server.ts`)
   - `GET /api/peers/status` — peer manager status
   - `GET /api/peers/discovered` — discovered peers
   - `GET /api/peers/devices` — paired devices
   - `GET /api/peers/connections` — active connections
   - `POST /api/pairing/initiate` — start pairing session
   - `POST /api/pairing/cancel` — cancel pairing
   - `DELETE /api/peers/devices/:fingerprint` — unpair device
   - `PATCH /api/peers/devices/:fingerprint` — rename device

8. **Frontend** (`src/frontend/components/pairing/DeviceIndicator.tsx`)
   - TopBar widget showing connected peer count
   - Click to open popover: connected peers, paired devices, nearby instances
   - "Pair new device" button

9. **Settings** (Settings → Devices)
   - Device name (shown to peers during discovery)
   - Advertise on local network (mDNS toggle)
   - Share audio capture with paired devices

10. **Shared types** (`src/shared/types/peer.ts`)
    - `DiscoveredPeer`, `PairedDevice`, `PairingQrPayload`, `PairingAnswer`
    - `PeerConnectionInfo`, `PeerConnectionState`, `DataChannelName`
    - `DeviceSettings` added to `AppSettings`

## How to test

### Prerequisites

- `npm run dev` running (web mode)
- A browser (Chrome recommended)
- An MCP client connected (Claude Code, or the test harness)

### Manual testing

1. **Verify mDNS advertising**
   - Start the backend (`npm run dev`)
   - Check the console for: `[mDNS] Advertising as "..." (...)`
   - Hit `GET /api/peers/status` — verify `discoveryActive: true`

2. **Device indicator in TopBar**
   - Open the web UI at `http://localhost:5173`
   - Look for the "Devices" pill next to "Connected Agents" in the TopBar
   - Click it — should show empty state: "No devices found"

3. **MCP tools**
   - Have an agent call `get_peer_status` — verify `running: true`
   - Call `list_discovered_peers` — should return `count: 0` (unless another CodeTrellis is running)
   - Call `list_paired_devices` — should return `count: 0`
   - Call `list_peer_connections` — should return `count: 0`
   - Call `unpair_device` with a fake fingerprint — should return `removed: false`

4. **Settings → Devices**
   - Open Settings → Devices section
   - Verify device name field (empty = hostname)
   - Toggle "Advertise on local network" — verify mDNS restarts
   - Toggle "Share audio capture with paired devices"

5. **Two-instance discovery** (if you can run two copies)
   - Start a second CodeTrellis on a different port: `PORT=3002 npm run dev:backend`
   - After a few seconds, each should discover the other via mDNS
   - Check `GET /api/peers/discovered` on either instance — should see the other

### Automated tests

```bash
npx playwright test --config playwright.harness.config.ts cdev-phase9
```

5 tests:
- Peer manager reports status via MCP
- Discovered peers empty when no peers on network
- Paired devices empty initially
- Peer connections empty when no connections
- Unpair unknown fingerprint returns false

## What to look for

1. **Zero ports exposed**: All existing ports (:3001, :5173, :19432) stay bound to `127.0.0.1`. The mDNS service uses UDP multicast (port 5353) which is standard and handled by the OS.

2. **Graceful degradation**: If mDNS fails (port 5353 in use, firewall), the backend starts normally. The `[mDNS] Failed to...` warning appears in the console but nothing crashes.

3. **Clean shutdown**: On `npm run dev` restart (tsx watch), the mDNS service unpublishes and the peer manager stops cleanly.

4. **Device settings persistence**: Changes in Settings → Devices are saved to `~/.codetrellis/settings.json` immediately.

## Known limitations

- **No real pairing yet**: The QR code display and scanning flow requires the frontend PairingModal (Phase 9.4 deferred). The backend services handle the full handshake but there's no UI to trigger it end-to-end.
- **WebRTC untested in production**: The `werift` library is pure TypeScript (no native deps) but is pre-1.0. Data channel creation is implemented but not yet exercised with a real peer.
- **Single-network only**: mDNS only works on the same LAN. Off-LAN discovery requires the user's VPN (Tailscale, etc).
- **No auto-reconnect yet**: The infrastructure is in place (stored shared secrets, mDNS peer matching) but auto-reconnect on discovery is stubbed.
