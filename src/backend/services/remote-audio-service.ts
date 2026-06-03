/**
 * Remote audio forwarding — Phase 10.3 of the CDev target architecture.
 *
 * When audio capture is active on one device, streams WebM/Opus chunks
 * to connected peers over the `audio` data channel. On the receiving
 * side, chunks are fed into the local audio-buffer-service so that an
 * agent calling `get_audio_context` transparently gets audio from the
 * remote device's microphone.
 *
 * Wire protocol on the `audio` data channel:
 *
 *   [1-byte message type][payload]
 *
 *   Message types:
 *     0x01 = audio status (JSON: { capturing, bufferedSeconds })
 *     0x02 = audio chunk  (binary WebM/Opus data)
 *     0x03 = audio stopped (no payload)
 *
 * Privacy: forwarding only happens if `settings.device.shareAudio` is
 * true on the sender. The receiver's agent sees the audio as local.
 */

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___audio_buffer_service from './audio-buffer-service';
import { DATA_CHANNELS } from '../../shared/types';
import {
  onChannelMessage,
  onConnectionStateChange,
  broadcastToAllPeers,
  sendToPeer,
} from './webrtc-service';
import { getSettings } from './settings-service';

// --- Constants ---------------------------------------------------------------

const MSG = {
  AUDIO_STATUS:  0x01,
  AUDIO_CHUNK:   0x02,
  AUDIO_STOPPED: 0x03,
} as const;

// --- Types -------------------------------------------------------------------

export interface RemoteAudioStatus {
  /** Fingerprint of the peer streaming audio. */
  peerFingerprint: string;
  /** Whether the peer is currently capturing audio. */
  capturing: boolean;
  /** Seconds of audio buffered on the peer. */
  bufferedSeconds: number;
}

// --- State -------------------------------------------------------------------

let running = false;
let unsubMessage: (() => void) | null = null;
let unsubConnection: (() => void) | null = null;

/** Remote audio status from connected peers. */
const remoteAudioStatus = new Map<string, RemoteAudioStatus>();

/** Listeners for remote audio events. */
const listeners = new Set<(event: string, data: unknown) => void>();

// --- Public API --------------------------------------------------------------

/**
 * Start the remote audio forwarding service.
 */
export function startRemoteAudio(): void {
  if (running) return;
  running = true;

  unsubMessage = onChannelMessage(DATA_CHANNELS.AUDIO, handleAudioMessage);

  unsubConnection = onConnectionStateChange((fingerprint, state) => {
    if (state === 'connected') {
      // Send current audio status to the newly connected peer
      sendAudioStatus(fingerprint);
    } else if (state === 'disconnected' || state === 'failed') {
      remoteAudioStatus.delete(fingerprint);
      emitEvent('remote-audio-changed', { fingerprint, capturing: false });
    }
  });

  console.log('[RemoteAudio] Started');
}

/**
 * Stop the remote audio forwarding service.
 */
export function stopRemoteAudio(): void {
  if (!running) return;
  running = false;

  if (unsubMessage) { unsubMessage(); unsubMessage = null; }
  if (unsubConnection) { unsubConnection(); unsubConnection = null; }

  remoteAudioStatus.clear();

  console.log('[RemoteAudio] Stopped');
}

/**
 * Forward a local audio chunk to all connected peers.
 * Called from the audio buffer service when a new chunk arrives.
 *
 * Only forwards if `settings.device.shareAudio` is true.
 */
export function forwardAudioChunk(chunkData: Buffer): void {
  if (!running) return;

  const settings = getSettings();
  if (!settings.device.shareAudio) return;

  // Send: [0x02][binary data]
  const payload = Buffer.alloc(1 + chunkData.length);
  payload[0] = MSG.AUDIO_CHUNK;
  chunkData.copy(payload, 1);
  broadcastToAllPeers(DATA_CHANNELS.AUDIO, payload);
}

/**
 * Broadcast audio capture status to all peers.
 * Called when capture starts or stops.
 */
export function broadcastAudioStatus(capturing: boolean, bufferedSeconds: number): void {
  if (!running) return;

  const settings = getSettings();
  if (!settings.device.shareAudio) return;

  const status = JSON.stringify({ capturing, bufferedSeconds });
  const msg = Buffer.from(String.fromCharCode(MSG.AUDIO_STATUS) + status);
  broadcastToAllPeers(DATA_CHANNELS.AUDIO, msg);
}

/**
 * Broadcast that audio capture has stopped.
 */
export function broadcastAudioStopped(): void {
  if (!running) return;

  const msg = Buffer.from([MSG.AUDIO_STOPPED]);
  broadcastToAllPeers(DATA_CHANNELS.AUDIO, msg);
}

/**
 * Get audio status from all connected peers.
 */
export function getRemoteAudioStatuses(): RemoteAudioStatus[] {
  return Array.from(remoteAudioStatus.values());
}

/**
 * Get audio status from a specific peer.
 */
export function getRemoteAudioStatus(fingerprint: string): RemoteAudioStatus | null {
  return remoteAudioStatus.get(fingerprint) ?? null;
}

/**
 * Register a listener for remote audio events.
 */
export function onRemoteAudioEvent(
  cb: (event: string, data: unknown) => void,
): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Whether remote audio is running.
 */
export function isRemoteAudioRunning(): boolean {
  return running;
}

// --- Internals ---------------------------------------------------------------

function sendAudioStatus(fingerprint: string): void {
  const settings = getSettings();
  if (!settings.device.shareAudio) return;

  let capturing = false;
  let bufferedSeconds = 0;

  try {
    const instance = _lazy___audio_buffer_service.audioBuffer;
    if (instance) {
      capturing = instance.isCapturing?.() ?? false;
      const status = instance.getStatus?.();
      if (status) bufferedSeconds = status.bufferedSeconds ?? 0;
    }
  } catch { /* audio service not available */ }

  const status = JSON.stringify({ capturing, bufferedSeconds });
  const msg = Buffer.from(String.fromCharCode(MSG.AUDIO_STATUS) + status);
  sendToPeer(fingerprint, DATA_CHANNELS.AUDIO, msg);
}

function handleAudioMessage(fingerprint: string, data: Buffer | string): void {
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    if (buf.length < 1) return;

    const msgType = buf[0];

    switch (msgType) {
      case MSG.AUDIO_STATUS: {
        const json = buf.slice(1).toString('utf-8');
        const { capturing, bufferedSeconds } = JSON.parse(json);
        remoteAudioStatus.set(fingerprint, {
          peerFingerprint: fingerprint,
          capturing: !!capturing,
          bufferedSeconds: bufferedSeconds ?? 0,
        });
        emitEvent('remote-audio-changed', {
          fingerprint,
          capturing: !!capturing,
          bufferedSeconds,
        });
        break;
      }

      case MSG.AUDIO_CHUNK: {
        // Feed into the local audio buffer service so agents can access it
        const chunkData = buf.slice(1);
        if (chunkData.length > 0) {
          try {
            const instance = _lazy___audio_buffer_service.audioBuffer;
            if (instance && typeof instance.addChunk === 'function') {
              // Estimate duration from chunk size (~32kbps Opus)
              const estimatedDurationMs = Math.round((chunkData.length / 4000) * 1000);
              instance.addChunk(chunkData, estimatedDurationMs);
            }
          } catch { /* audio service not available */ }

          emitEvent('remote-audio-chunk', { fingerprint, size: chunkData.length });
        }
        break;
      }

      case MSG.AUDIO_STOPPED: {
        const status = remoteAudioStatus.get(fingerprint);
        if (status) {
          status.capturing = false;
          emitEvent('remote-audio-changed', { fingerprint, capturing: false });
        }
        break;
      }
    }
  } catch (err) {
    console.warn('[RemoteAudio] Invalid message:', err);
  }
}

function emitEvent(event: string, data: unknown): void {
  for (const cb of listeners) {
    try { cb(event, data); } catch { /* listener error */ }
  }
}
