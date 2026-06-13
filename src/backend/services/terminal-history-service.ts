/**
 * Terminal history — Session-persistence plan §7.5.
 *
 * Per-terminal append-only on-disk log that captures the raw PTY
 * output stream (ANSI intact) so users can scroll back through far
 * more than the 256KB in-memory ring buffer holds. The disk log
 * survives terminal-detail un-mount and CodeTrellis restarts; it is
 * the durable counterpart to the in-memory ring in `terminal-service.ts`.
 *
 * Design (hybrid, per plan body recommendation):
 *   - In-memory ring stays the hot path for live reads (zero added
 *     latency for `terminal.stream` poll).
 *   - Writes also flow here, buffered and batched to disk (avoid
 *     blocking the PTY data callback at the request frequency).
 *   - Reads via `getHistoryChunk(id, before?, limit)` walk backwards
 *     through the file by absolute byte offset.
 *
 * Cap: per-terminal hard limit. Once hit, further appends are dropped
 * (the in-memory ring still cycles, so live reads still work — only
 * older history beyond the cap is unavailable). v1 doesn't rotate;
 * rotation can land in a follow-up if real sessions hit the cap.
 *
 * Storage location: `<dataDir>/terminals/<id>.log`. Never synced via
 * the personal-sync path (the persistence service handles dir scoping
 * separately) — terminal output can contain secrets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './persistence';

/** Per-terminal hard cap. Many hours of an interactive session. */
const PER_TERMINAL_CAP_BYTES = 200 * 1024 * 1024; // 200 MB
/** Pending writes are batched + flushed at the first of:
 *  - WRITE_FLUSH_INTERVAL_MS since the previous flush
 *  - WRITE_FLUSH_BYTES of pending data
 *  - explicit flush() (e.g., before a read) */
const WRITE_FLUSH_INTERVAL_MS = 1_000;
const WRITE_FLUSH_BYTES = 16 * 1024;
/** Default read chunk if the caller doesn't specify. ~5-10 screens
 *  of typical output. */
const DEFAULT_READ_CHUNK_BYTES = 64 * 1024;

interface TerminalLog {
  fd: number;
  pendingWrites: string[];
  pendingBytes: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Total bytes written to disk so far (== file size). */
  bytesWritten: number;
  /** True once bytesWritten + pendingBytes ≥ cap — further appends drop. */
  capped: boolean;
}

const logs = new Map<string, TerminalLog>();

function getTerminalsDir(): string {
  return path.join(getDataDir(), 'terminals');
}

function getLogPath(terminalId: string): string {
  return path.join(getTerminalsDir(), `${terminalId}.log`);
}

function ensureLog(terminalId: string): TerminalLog {
  let log = logs.get(terminalId);
  if (log) return log;

  const dir = getTerminalsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = getLogPath(terminalId);
  // 'a+' = read + append. Writes always go to EOF; reads accept an
  // explicit position arg so we can walk backwards.
  const fd = fs.openSync(filePath, 'a+');
  const stat = fs.fstatSync(fd);
  log = {
    fd,
    pendingWrites: [],
    pendingBytes: 0,
    flushTimer: null,
    bytesWritten: stat.size,
    capped: stat.size >= PER_TERMINAL_CAP_BYTES,
  };
  logs.set(terminalId, log);
  return log;
}

function flushLog(log: TerminalLog): void {
  if (log.pendingWrites.length === 0) {
    if (log.flushTimer) { clearTimeout(log.flushTimer); log.flushTimer = null; }
    return;
  }
  const buf = Buffer.from(log.pendingWrites.join(''), 'utf-8');
  log.pendingWrites = [];
  log.pendingBytes = 0;
  if (log.flushTimer) { clearTimeout(log.flushTimer); log.flushTimer = null; }
  try {
    fs.writeSync(log.fd, buf);
    log.bytesWritten += buf.length;
    if (log.bytesWritten >= PER_TERMINAL_CAP_BYTES) log.capped = true;
  } catch (err) {
    console.warn('[TerminalHistory] flush failed:', err);
  }
}

/**
 * Append a chunk of PTY output to the on-disk log. Buffered + flushed
 * asynchronously so the caller (PTY data callback) is never blocked.
 * Silently drops once the per-terminal cap is hit.
 */
export function appendHistory(terminalId: string, data: string): void {
  if (data.length === 0) return;
  const log = ensureLog(terminalId);
  if (log.capped) return;
  log.pendingWrites.push(data);
  log.pendingBytes += Buffer.byteLength(data, 'utf-8');
  if (log.pendingBytes >= WRITE_FLUSH_BYTES) {
    flushLog(log);
    return;
  }
  if (!log.flushTimer) {
    log.flushTimer = setTimeout(() => {
      const current = logs.get(terminalId);
      if (current) flushLog(current);
    }, WRITE_FLUSH_INTERVAL_MS);
  }
}

/**
 * Read a chunk of history ending at `before` (absolute byte offset
 * into the file). Omit `before` to start at the tail (file size).
 * Returns the data + the offset to pass on the next call to walk
 * further back + `hasMore` if there's still earlier content + the
 * current `fileSize` so the caller knows the total range.
 */
export function getHistoryChunk(
  terminalId: string,
  before: number | undefined,
  limit: number = DEFAULT_READ_CHUNK_BYTES,
): { data: string; prevOffset: number; hasMore: boolean; fileSize: number; capped: boolean } {
  const log = ensureLog(terminalId);
  // Flush so reads see the latest buffered writes.
  flushLog(log);

  const fileSize = log.bytesWritten;
  let endOffset = before ?? fileSize;
  if (endOffset > fileSize) endOffset = fileSize;
  const startOffset = Math.max(0, endOffset - limit);
  const readLen = endOffset - startOffset;
  if (readLen <= 0) {
    return { data: '', prevOffset: 0, hasMore: false, fileSize, capped: log.capped };
  }
  const buf = Buffer.alloc(readLen);
  try {
    fs.readSync(log.fd, buf, 0, readLen, startOffset);
  } catch (err) {
    console.warn('[TerminalHistory] read failed:', err);
    return { data: '', prevOffset: 0, hasMore: false, fileSize, capped: log.capped };
  }
  return {
    data: buf.toString('utf-8'),
    prevOffset: startOffset,
    hasMore: startOffset > 0,
    fileSize,
    capped: log.capped,
  };
}

/** Total bytes recorded for this terminal. */
export function getHistorySize(terminalId: string): number {
  const log = logs.get(terminalId);
  if (log) return log.bytesWritten;
  // Hasn't been opened this session — peek at the file on disk.
  try {
    return fs.statSync(getLogPath(terminalId)).size;
  } catch {
    return 0;
  }
}

/**
 * Close the disk handle for a terminal (e.g., when it's killed).
 * The log file is left on disk so a subsequent open can still scroll
 * through it. GC of dead-terminal logs is a follow-up item.
 */
export function closeTerminalHistory(terminalId: string): void {
  const log = logs.get(terminalId);
  if (!log) return;
  flushLog(log);
  try { fs.closeSync(log.fd); } catch { /* */ }
  logs.delete(terminalId);
}

/** Flush + close every open log. Call on server shutdown. */
export function closeAllTerminalHistory(): void {
  for (const id of Array.from(logs.keys())) {
    closeTerminalHistory(id);
  }
}
