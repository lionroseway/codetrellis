# Session-persistence — manual playbooks

Manual verification for the session-persistence plan
(`Session persistence — survive sleep, background, and network changes`).
Each playbook codifies one shape of transport interruption + the
expected end-state. Run before tagging a release that touched any of
the persistence surfaces.

---

## Playbook 1 — Backgrounded-and-return (the screenshot bug)

**Why this exists:** original user report — iPhone locked /
backgrounded for ~30s; on foreground the terminal view rendered blank
with `Request timed out after 6s (terminal.stream)` in a red toast,
while desktop kept receiving keystrokes. Both sides were in
broken-but-not-disconnected state with no recovery handshake.

**Setup**

1. Desktop running CodeTrellis (web or Electron) on `dev/saif` or later.
2. Mobile companion paired (Settings → Devices → QR pair).
3. Open a terminal on the desktop, produce some scrollback (e.g.
   `seq 1 50`).
4. On mobile, open the terminal view — confirm scrollback is rendered.

**Action**

1. Lock the iPhone screen (or send the app to background).
2. Wait **30 seconds**.
3. Unlock / foreground the app.
4. Tap the terminal entry to open it.

**Expected**

- Terminal view shows full scrollback within **~5 seconds**.
- No red `terminal.stream` timeout toast.
- No `Retry` button.
- Typing into the terminal input reaches the desktop on the first try.

**Wired by**

- Server-side: `remote-terminal-service.sendTerminalSnapshots()` replays
  the per-terminal ring buffer over the existing 0x02 TERMINAL_OUTPUT
  wire op on any `connected` transition, prefixed with `\x1b[2J\x1b[H`
  (Plan items 7.1 + 7.2).
- Buffer size bumped to 256 KB per terminal in
  `src/backend/services/terminal-service.ts`.
- Mobile-side lifecycle handler (Plan item 5.1) lives in the mobile
  companion repo — once it ships, the foreground-stalled RPC will also
  be force-reconnected proactively, killing the toast entirely.

**On failure**

- Check desktop `/api/peer/status` — confirm the peer transitions
  through `disconnected` → `connected` when foregrounding (if not, the
  WebRTC layer is keeping a stale "connected" state).
- Check desktop logs for `[RemoteTerminal] Started` and confirm
  `sendTerminalSnapshots(fingerprint)` is wired in the connection
  handler.
- Verify the ring buffer is populated: call `terminal.read` via MCP
  for the affected terminal id, confirm scrollback exists server-side.

---

## Playbook 2 — Network change (Wi-Fi ↔ cellular)

**Setup**

1. Desktop + paired mobile, terminal open with active scrollback.
2. Mobile on Wi-Fi.

**Action**

1. In the middle of a terminal stream (e.g. `top -d 1` running on
   desktop), toggle Wi-Fi off on the iPhone (forces fallback to
   cellular).
2. Wait until the next NetInfo callback (~1-3s).
3. Toggle Wi-Fi back on (forces another network transition).

**Expected (once mobile lifecycle 5.x ships)**

- Sub-2s drops: silent — no badge change, no toast.
- Drops longer than 2s: a `reconnecting` badge appears in the mobile
  chrome; clears when the connection is re-established.
- After reconnect: terminal scrollback is intact (server side pushes a
  fresh snapshot on the new connection); live stream resumes.
- No data loss visible to the user.

**Wired by**

- 5.2 NetInfo handler + 5.3 reconnect state machine + 5.4 silent
  suppression — mobile companion repo.
- 7.2 snapshot-on-attach — this repo (already shipped).

---

## Playbook 3 — VPN drop / reattach

**Setup**

1. BYO-VPN active (Tailscale, WireGuard, etc.).
2. Desktop + paired mobile reachable over the VPN.
3. Terminal session active.

**Action**

1. Disconnect the VPN on the mobile device (e.g. flip the Tailscale
   toggle off).
2. Wait ~10 seconds.
3. Re-enable the VPN.

**Expected**

- Mobile connection-status badge transitions to `offline` after the
  ~2s suppression window.
- Once VPN re-attaches, badge reverts via `reconnecting` → `connected`.
- Terminal scrollback restored on reconnect; channel-event activity
  replayed via `channel.eventsSinceSeq` (7.3 + 7.4 — this repo).
- No `Retry` prompts.

**Wired by**

- 7.3 channel-event seqnums + 7.4 replay-since-seq — this repo.
- 5.2 NetInfo + 5.3 reconnect state machine — mobile companion repo.

---

## Playbook 4 — Desktop awake while AFK (Track A end-to-end)

**Why this exists:** the user's reframe — "I want to set stuff and come
back to it." Track A's goal is that an unattended desktop doesn't sleep
mid-run.

**Setup**

1. Desktop on AC power, lid open.
2. Open Settings → Power.
3. Enable `Keep awake when… A mobile companion is connected`.
4. Leave `Disable when on battery` checked.
5. Mobile paired and currently connected.

**Action**

1. Verify the Zap indicator in the TopBar glows emerald (hover →
   "Keeping desktop awake — Mobile connected").
2. Walk away for ~10 minutes.
3. Come back; confirm the desktop is still awake — no lock screen
   beyond the user's own screensaver-trigger time.

**Repeat with mobile disconnected**

1. Disconnect mobile (close companion app).
2. Wait ~10s. Confirm the Zap indicator dims (idle).
3. Desktop is allowed to sleep on its normal schedule.

**Repeat on battery**

1. Unplug the laptop.
2. Confirm the Zap indicator dims (the AC-only gate engaged).
3. Re-plug → indicator brightens again.

**Wired by**

- 1.1–1.3 settings shape + RPCs.
- 2.1 power-service.ts state machine.
- 2.2 mobile-connected signal.
- 2.4 AC power signal.
- 3.1 powerSaveBlocker.
- 4.1 Settings UI + 4.2 TopBar indicator.

**Lid-close add-on (macOS)**

- Enable `Also prevent lid-close sleep` in Settings → Power.
- Verify a `caffeinate` process is running while the assertion is held
  (`ps -ef | grep caffeinate`).
- Close the laptop lid; mobile companion stays reachable.
- Untoggle setting → caffeinate process exits within a debounce window.
