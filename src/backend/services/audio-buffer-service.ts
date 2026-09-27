/**
 * Audio buffer service — Phase 8.1 of the CDev target architecture.
 *
 * Maintains a rolling in-memory buffer of audio chunks streamed from
 * the frontend's MediaRecorder. When the user invokes the AI (hotkey
 * or button), the recent buffer is packaged and served via MCP.
 *
 * The buffer NEVER persists to disk. It is pure ephemeral memory.
 *
 * Audio format: WebM/Opus (what MediaRecorder produces natively).
 * Chunks arrive every ~2 seconds from the frontend via POST.
 */

// --- Types -------------------------------------------------------------------

export interface AudioChunk {
  /** Raw audio data (WebM/Opus segment). */
  data: Buffer;
  /** When this chunk was received (ms since epoch). */
  timestamp: number;
  /** Duration of this chunk in milliseconds. */
  durationMs: number;
}

export interface AudioCaptureStatus {
  capturing: boolean;
  /** Total seconds of audio currently buffered. */
  bufferedSeconds: number;
  /** Number of chunks in the buffer. */
  chunkCount: number;
  /** Maximum buffer duration in seconds. */
  maxBufferSeconds: number;
  /** When capture started (ISO), null if not capturing. */
  startedAt: string | null;
}

export interface AudioSnapshot {
  /** Base64-encoded audio data (concatenated chunks). */
  audioBase64: string;
  /** MIME type of the audio. */
  mimeType: string;
  /** Duration of the audio in seconds. */
  durationSeconds: number;
  /** When the audio starts (ISO). */
  startsAt: string;
  /** When the audio ends (ISO). */
  endsAt: string;
  /** Number of chunks concatenated. */
  chunkCount: number;
}

// --- Service -----------------------------------------------------------------

const DEFAULT_MAX_BUFFER_MS = 120_000; // 2 minutes

/** Bounds on what a caller may ask for (Phase 32 §0.4i, bug 35). */
export const MAX_BUFFER_SECONDS_LIMIT = 600;
export const MAX_CHUNK_MS = 60_000;

export class AudioRequestError extends Error {}

/**
 * Check a requested window: a whole number of seconds, 1–600. It was used
 * as given, so a string made the window NaN and nothing was ever trimmed.
 */
export function checkBufferSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > MAX_BUFFER_SECONDS_LIMIT) {
    throw new AudioRequestError(`maxBufferSeconds must be a number from 1 to ${MAX_BUFFER_SECONDS_LIMIT}`);
  }
  return value;
}

/** A chunk's length in ms: a positive number up to a minute. Text was added with `+` and concatenated. */
export function checkChunkMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_CHUNK_MS) {
    throw new AudioRequestError(`durationMs must be a number from 1 to ${MAX_CHUNK_MS}`);
  }
  return value;
}

class AudioBufferService {
  private chunks: AudioChunk[] = [];
  private maxBufferMs: number = DEFAULT_MAX_BUFFER_MS;
  private capturing = false;
  private startedAt: Date | null = null;

  /**
   * Start accepting audio chunks. Clears any existing buffer.
   */
  startCapture(maxBufferSeconds?: number): void {
    // A start that names no size gets the default, not whatever the last
    // start chose.
    this.maxBufferMs = (checkBufferSeconds(maxBufferSeconds) ?? DEFAULT_MAX_BUFFER_MS / 1000) * 1000;
    this.chunks = [];
    this.capturing = true;
    this.startedAt = new Date();
  }

  /**
   * Stop accepting audio chunks. Buffer is preserved until next start.
   */
  stopCapture(): void {
    this.capturing = false;
  }

  /**
   * Whether capture is currently active.
   */
  isCapturing(): boolean {
    return this.capturing;
  }

  /**
   * Add an audio chunk to the rolling buffer. Evicts old chunks
   * that exceed the max buffer duration.
   */
  addChunk(data: Buffer, durationMs: number): void {
    if (!this.capturing) return;
    checkChunkMs(durationMs);

    this.chunks.push({
      data,
      timestamp: Date.now(),
      durationMs,
    });

    this.evictOldChunks();
  }

  /**
   * Get the most recent N seconds of audio as a concatenated buffer.
   * If seconds is omitted, returns the entire buffer.
   */
  getRecentAudio(seconds?: number): AudioSnapshot | null {
    if (this.chunks.length === 0) return null;

    let targetChunks = this.chunks;

    if (seconds) {
      const cutoffMs = seconds * 1000;
      const now = Date.now();
      targetChunks = this.chunks.filter(
        (c) => now - c.timestamp <= cutoffMs,
      );
    }

    if (targetChunks.length === 0) return null;

    // Concatenate all chunk data
    const totalData = Buffer.concat(targetChunks.map((c) => c.data));
    const totalDurationMs = targetChunks.reduce((sum, c) => sum + c.durationMs, 0);
    const startsAt = new Date(targetChunks[0].timestamp);
    const lastChunk = targetChunks[targetChunks.length - 1];
    const endsAt = new Date(lastChunk.timestamp + lastChunk.durationMs);

    return {
      audioBase64: totalData.toString('base64'),
      mimeType: 'audio/webm;codecs=opus',
      durationSeconds: Math.round(totalDurationMs / 1000 * 10) / 10,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      chunkCount: targetChunks.length,
    };
  }

  /**
   * Get current capture status.
   */
  getStatus(): AudioCaptureStatus {
    const bufferedMs = this.chunks.reduce((sum, c) => sum + c.durationMs, 0);

    return {
      capturing: this.capturing,
      bufferedSeconds: Math.round(bufferedMs / 1000 * 10) / 10,
      chunkCount: this.chunks.length,
      maxBufferSeconds: this.maxBufferMs / 1000,
      startedAt: this.startedAt?.toISOString() ?? null,
    };
  }

  /**
   * Clear the buffer entirely.
   */
  clear(): void {
    this.chunks = [];
  }

  // --- Internals ---

  private evictOldChunks(): void {
    const now = Date.now();
    const cutoff = now - this.maxBufferMs;

    // Remove chunks older than the max buffer duration
    while (this.chunks.length > 0 && this.chunks[0].timestamp < cutoff) {
      this.chunks.shift();
    }
  }
}

// Singleton instance
export const audioBuffer = new AudioBufferService();
