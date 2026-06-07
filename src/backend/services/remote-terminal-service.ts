/**
 * Remote terminal relay — Phase 10.2 of the CDev target architecture.
 *
 * Bridges local PTY terminals to connected WebRTC peers over the
 * `terminal` data channel. Peers see remote terminals in their terminal
 * panel (with a "remote" badge) and can type commands from either machine.
 *
 * Wire protocol on the `terminal` data channel:
 *
 *   [1-byte message type][payload]
 *
 *   Message types:
 *     0x01 = terminal list (JSON array of terminal summaries)
 *     0x02 = terminal output (1-byte terminal-index + UTF-8 data)
 *     0x03 = terminal input  (1-byte terminal-index + UTF-8 data)
 *     0x04 = terminal created (JSON: { id, preset, title, cwd })
 *     0x05 = terminal exited  (JSON: { id, exitCode })
 *     0x06 = terminal resized (JSON: { id, cols, rows })
 *
 * Local terminals are relayed to peers automatically once the service
 * starts. Remote terminals received from peers are stored and exposed
 * via the `getRemoteTerminals()` API.
 */

import { DATA_CHANNELS } from '../../shared/types';
import {
  onChannelMessage,
  onConnectionStateChange,
  broadcastToAllPeers,
  sendToPeer,
} from './webrtc-service';
import {
  listTerminals,
  onTerminalData,
  onTerminalExit,
  writeTerminal,
  resizeTerminal,
  readTerminalDelta,
} from './terminal-service';

// --- Constants ---------------------------------------------------------------

/** Message type bytes for the terminal wire protocol. */
const MSG = {
  TERMINAL_LIST:    0x01,
  TERMINAL_OUTPUT:  0x02,
  TERMINAL_INPUT:   0x03,
  TERMINAL_CREATED: 0x04,
  TERMINAL_EXITED:  0x05,
  TERMINAL_RESIZED: 0x06,
} as const;

// --- Types -------------------------------------------------------------------

export interface RemoteTerminalInfo {
  /** Terminal ID on the remote machine. */
  id: string;
  /** Agent preset (claude, codex, aider, shell). */
  preset: string;
  /** Terminal title. */
  title: string;
  /** Working directory on the remote machine. */
  cwd: string;
  /** Whether the terminal is still alive. */
  alive: boolean;
  /** Fingerprint of the peer that owns this terminal. */
  peerFingerprint: string;
  /** Alias of the peer device. */
  peerAlias: string;
  /** Index in the terminal list (for wire protocol addressing). */
  index: number;
}

// --- State -------------------------------------------------------------------

let running = false;
let unsubMessage: (() => void) | null = null;
let unsubConnection: (() => void) | null = null;
let unsubTerminalData: (() => void) | null = null;
let unsubTerminalExit: (() => void) | null = null;

/**
 * Remote terminals received from peers.
 * Map: fingerprint → array of terminal infos.
 */
const remoteTerminals = new Map<string, RemoteTerminalInfo[]>();

/** Listeners for remote terminal events. */
const remoteTerminalListeners = new Set<(event: string, data: unknown) => void>();

/**
 * Local terminal ID → index mapping. The wire protocol uses a 1-byte
 * index for efficiency; we map IDs to indices on each list broadcast.
 */
let localTerminalIds: string[] = [];

// --- Public API --------------------------------------------------------------

/**
 * Start the remote terminal relay. Bridges local terminals to peers
 * and receives remote terminal data from peers.
 */
export function startRemoteTerminals(): void {
  if (running) return;
  running = true;

  // Listen for terminal channel messages from peers
  unsubMessage = onChannelMessage(DATA_CHANNELS.TERMINAL, handleTerminalMessage);

  // Send terminal list AND scrollback snapshot when a peer connects.
  //
  // The snapshot push is the session-persistence fix (Plan 7.2): when
  // mobile resumes from background / lock-screen / network change, the
  // WebRTC layer transitions through disconnected → connected, and the
  // peer's terminal view is blank until live PTY output happens to
  // arrive. Replaying the buffered scrollback here primes their xterm
  // so it never renders empty, with no client-side change required.
  unsubConnection = onConnectionStateChange((fingerprint, state) => {
    if (state === 'connected') {
      sendTerminalList(fingerprint);
      sendTerminalSnapshots(fingerprint);
    } else if (state === 'disconnected' || state === 'failed') {
      remoteTerminals.delete(fingerprint);
      emitEvent('remote-terminals-changed', { fingerprint });
    }
  });

  // Forward local terminal output to all peers
  unsubTerminalData = onTerminalData((id, data) => {
    const idx = localTerminalIds.indexOf(id);
    if (idx < 0) {
      // New terminal — rebuild the list
      refreshLocalTerminalList();
      broadcastTerminalList();
      return;
    }
    // Send: [0x02][1-byte index][UTF-8 data]
    const payload = Buffer.alloc(2 + Buffer.byteLength(data, 'utf-8'));
    payload[0] = MSG.TERMINAL_OUTPUT;
    payload[1] = idx;
    payload.write(data, 2, 'utf-8');
    broadcastToAllPeers(DATA_CHANNELS.TERMINAL, payload);
  });

  // Notify peers when a local terminal exits
  unsubTerminalExit = onTerminalExit((id, exitCode) => {
    const msg = Buffer.from(
      String.fromCharCode(MSG.TERMINAL_EXITED) +
      JSON.stringify({ id, exitCode }),
    );
    broadcastToAllPeers(DATA_CHANNELS.TERMINAL, msg);
    refreshLocalTerminalList();
    broadcastTerminalList();
  });

  console.log('[RemoteTerminal] Started');
}

/**
 * Stop the remote terminal relay.
 */
export function stopRemoteTerminals(): void {
  if (!running) return;
  running = false;

  if (unsubMessage) { unsubMessage(); unsubMessage = null; }
  if (unsubConnection) { unsubConnection(); unsubConnection = null; }
  if (unsubTerminalData) { unsubTerminalData(); unsubTerminalData = null; }
  if (unsubTerminalExit) { unsubTerminalExit(); unsubTerminalExit = null; }

  remoteTerminals.clear();
  localTerminalIds = [];

  console.log('[RemoteTerminal] Stopped');
}

/**
 * Get all remote terminals from all connected peers.
 */
export function getRemoteTerminals(): RemoteTerminalInfo[] {
  const result: RemoteTerminalInfo[] = [];
  for (const terminals of remoteTerminals.values()) {
    result.push(...terminals);
  }
  return result;
}

/**
 * Get remote terminals from a specific peer.
 */
export function getRemoteTerminalsForPeer(fingerprint: string): RemoteTerminalInfo[] {
  return remoteTerminals.get(fingerprint) ?? [];
}

/**
 * Write input to a remote terminal.
 * Sends the data to the peer that owns the terminal.
 */
export function writeRemoteTerminal(fingerprint: string, terminalId: string, data: string): boolean {
  const terminals = remoteTerminals.get(fingerprint);
  if (!terminals) return false;

  const terminal = terminals.find((t) => t.id === terminalId);
  if (!terminal) return false;

  // Send: [0x03][1-byte index][UTF-8 data]
  const payload = Buffer.alloc(2 + Buffer.byteLength(data, 'utf-8'));
  payload[0] = MSG.TERMINAL_INPUT;
  payload[1] = terminal.index;
  payload.write(data, 2, 'utf-8');
  return sendToPeer(fingerprint, DATA_CHANNELS.TERMINAL, payload);
}

/**
 * Resize a remote terminal (send resize request to the peer).
 */
export function resizeRemoteTerminal(
  fingerprint: string,
  terminalId: string,
  cols: number,
  rows: number,
): boolean {
  const msg = Buffer.from(
    String.fromCharCode(MSG.TERMINAL_RESIZED) +
    JSON.stringify({ id: terminalId, cols, rows }),
  );
  return sendToPeer(fingerprint, DATA_CHANNELS.TERMINAL, msg);
}

/**
 * Register a listener for remote terminal events.
 */
export function onRemoteTerminalEvent(
  cb: (event: string, data: unknown) => void,
): () => void {
  remoteTerminalListeners.add(cb);
  return () => { remoteTerminalListeners.delete(cb); };
}

/**
 * Whether the remote terminal relay is running.
 */
export function isRemoteTerminalRunning(): boolean {
  return running;
}

// --- Internals ---------------------------------------------------------------

function refreshLocalTerminalList(): void {
  localTerminalIds = listTerminals().map((t) => t.id);
}

function broadcastTerminalList(): void {
  const terminals = listTerminals();
  localTerminalIds = terminals.map((t) => t.id);

  const list = terminals.map((t, i) => ({
    id: t.id,
    preset: t.preset,
    title: t.title,
    cwd: t.cwd,
    alive: t.alive,
    index: i,
  }));

  const msg = Buffer.from(
    String.fromCharCode(MSG.TERMINAL_LIST) + JSON.stringify(list),
  );
  broadcastToAllPeers(DATA_CHANNELS.TERMINAL, msg);
}

/**
 * Replay each alive local terminal's buffered scrollback to a single
 * peer, encoded as ordinary TERMINAL_OUTPUT (0x02) messages so existing
 * mobile-companion builds render it correctly without any protocol
 * change. Prefixes ANSI clear-screen + cursor-home so the peer's xterm
 * replaces whatever stale state it had (from before the disconnect)
 * with the authoritative server-side scrollback.
 *
 * Called from the connection-state handler immediately after
 * `sendTerminalList(fingerprint)`. Indices match the list just sent.
 *
 * Backward-compatible by design: this is "live output that happens to
 * be the snapshot" on the wire — no new opcode, no new fields. A
 * smarter snapshot opcode (0x07) can be added later if we want to
 * distinguish replay from live for richer UI affordances.
 */
function sendTerminalSnapshots(fingerprint: string): void {
  const terminals = listTerminals();
  // Keep indices consistent with the list just broadcast.
  localTerminalIds = terminals.map((t) => t.id);

  // ESC[2J = erase entire display; ESC[H = move cursor to home.
  // Sent once per terminal so the snapshot fully overwrites any
  // partial / stale content the peer's xterm was holding.
  const SCREEN_RESET = '\x1b[2J\x1b[H';

  for (let i = 0; i < terminals.length; i++) {
    const t = terminals[i];
    if (!t.alive) continue;

    const delta = readTerminalDelta(t.id);
    if (delta === null || delta.data.length === 0) continue;

    const data = SCREEN_RESET + delta.data;
    const payload = Buffer.alloc(2 + Buffer.byteLength(data, 'utf-8'));
    payload[0] = MSG.TERMINAL_OUTPUT;
    payload[1] = i;
    payload.write(data, 2, 'utf-8');
    sendToPeer(fingerprint, DATA_CHANNELS.TERMINAL, payload);
  }
}

function sendTerminalList(fingerprint: string): void {
  const terminals = listTerminals();
  localTerminalIds = terminals.map((t) => t.id);

  const list = terminals.map((t, i) => ({
    id: t.id,
    preset: t.preset,
    title: t.title,
    cwd: t.cwd,
    alive: t.alive,
    index: i,
  }));

  const msg = Buffer.from(
    String.fromCharCode(MSG.TERMINAL_LIST) + JSON.stringify(list),
  );
  sendToPeer(fingerprint, DATA_CHANNELS.TERMINAL, msg);
}

function handleTerminalMessage(fingerprint: string, data: Buffer | string): void {
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    if (buf.length < 1) return;

    const msgType = buf[0];

    switch (msgType) {
      case MSG.TERMINAL_LIST: {
        const json = buf.slice(1).toString('utf-8');
        const list = JSON.parse(json) as Array<{
          id: string; preset: string; title: string; cwd: string; alive: boolean; index: number;
        }>;
        const terminals: RemoteTerminalInfo[] = list.map((t) => ({
          ...t,
          peerFingerprint: fingerprint,
          peerAlias: '', // filled in by the UI from the paired device record
        }));
        remoteTerminals.set(fingerprint, terminals);
        emitEvent('remote-terminals-changed', { fingerprint, terminals });
        break;
      }

      case MSG.TERMINAL_OUTPUT: {
        // [0x02][1-byte index][data]
        if (buf.length < 3) return;
        const idx = buf[1];
        const output = buf.slice(2).toString('utf-8');
        emitEvent('remote-terminal-output', { fingerprint, index: idx, data: output });
        break;
      }

      case MSG.TERMINAL_INPUT: {
        // Peer wants to type into one of our local terminals
        if (buf.length < 3) return;
        const idx = buf[1];
        const input = buf.slice(2).toString('utf-8');
        const terminalId = localTerminalIds[idx];
        if (terminalId) {
          writeTerminal(terminalId, input);
        }
        break;
      }

      case MSG.TERMINAL_CREATED: {
        const json = buf.slice(1).toString('utf-8');
        const info = JSON.parse(json);
        emitEvent('remote-terminal-created', { fingerprint, ...info });
        // Request updated list
        // (The peer will also broadcast the list after creation)
        break;
      }

      case MSG.TERMINAL_EXITED: {
        const json = buf.slice(1).toString('utf-8');
        const info = JSON.parse(json);
        emitEvent('remote-terminal-exited', { fingerprint, ...info });
        break;
      }

      case MSG.TERMINAL_RESIZED: {
        // Peer wants to resize one of our local terminals
        const json = buf.slice(1).toString('utf-8');
        const { id, cols, rows } = JSON.parse(json);
        if (id && cols && rows) {
          resizeTerminal(id, cols, rows);
        }
        break;
      }
    }
  } catch (err) {
    console.warn('[RemoteTerminal] Invalid message:', err);
  }
}

function emitEvent(event: string, data: unknown): void {
  for (const cb of remoteTerminalListeners) {
    try { cb(event, data); } catch { /* listener error */ }
  }
}
