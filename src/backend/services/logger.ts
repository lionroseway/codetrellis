/**
 * File-based logger — mirrors `console.log` / `console.warn` /
 * `console.error` output to `<dataDir>/logs/<YYYY-MM-DD>.log` so the
 * packaged Electron app produces a discoverable log trail when
 * stdout isn't visible (no terminal attached).
 *
 * Designed to be opt-in (called explicitly by `installFileLogger`)
 * so dev mode keeps clean console output. The Electron main process
 * calls it during boot.
 *
 * Idempotent — calling twice is a no-op.
 *
 * Reads the data dir lazily via `getDataDir()` so the
 * `CODETRELLIS_DATA_DIR` env var (E2E harness) wins over the
 * default.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './persistence';

let installed = false;
let logStream: fs.WriteStream | null = null;
let currentLogPath: string | null = null;
/** Bytes in today's file, so the cap below needs no stat per line. */
let currentBytes = 0;
let capNoticeWritten = false;

/**
 * Retention.
 *
 * Files rotated daily and were never removed or bounded. One install
 * had 1.8 GB of logs, single days reaching 656 MB, on a machine whose
 * disk was 99% full. A log is for "what happened recently"; nobody reads
 * day 40, and a runaway loop writing the same warning should cost a
 * bounded amount of disk, not the disk.
 */
export const LOG_RETENTION_DAYS = 14;
export const LOG_DAILY_CAP_BYTES = 50 * 1024 * 1024;

export function installFileLogger(): void {
  if (installed) return;
  installed = true;

  // Open / rotate the log file before we try to use it. If anything
  // goes wrong here, we fall back to console-only and log a warning
  // so the user can see something.
  try {
    rotateIfNeeded();
  } catch (err) {
    console.warn('[Logger] Failed to open log file — console only:', err);
    return;
  }

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origInfo = console.info.bind(console);

  const writeLine = (level: string, args: unknown[]) => {
    try {
      rotateIfNeeded();
      const ts = new Date().toISOString();
      const line = `${ts} [${level}] ${formatArgs(args)}\n`;
      if (currentBytes >= LOG_DAILY_CAP_BYTES) {
        if (!capNoticeWritten) {
          capNoticeWritten = true;
          logStream?.write(`${ts} [warn] [Logger] Daily cap of ${LOG_DAILY_CAP_BYTES} bytes reached; further lines today go to the console only.\n`);
        }
        return;
      }
      currentBytes += Buffer.byteLength(line);
      logStream?.write(line);
    } catch {
      // Don't recurse into console.* if the write itself failed.
    }
  };

  console.log = (...args) => { origLog(...args); writeLine('info', args); };
  console.info = (...args) => { origInfo(...args); writeLine('info', args); };
  console.warn = (...args) => { origWarn(...args); writeLine('warn', args); };
  console.error = (...args) => { origError(...args); writeLine('error', args); };

  process.on('uncaughtException', (err) => {
    writeLine('uncaught', [err?.stack || String(err)]);
  });
  process.on('unhandledRejection', (reason) => {
    writeLine('unhandled', [reason instanceof Error ? reason.stack : String(reason)]);
  });

  console.log(`[Logger] File logging enabled at ${currentLogPath}`);
}

/**
 * Resolve the absolute path to the current day's log file, creating
 * the logs directory if needed.
 */
export function getCurrentLogPath(): string {
  rotateIfNeeded();
  return currentLogPath || path.join(logDir(), `${ymd(new Date())}.log`);
}

export function getLogDir(): string {
  return logDir();
}

/**
 * Read the tail of the current log file. Used by the Settings panel
 * to surface recent activity inline. Capped to avoid hauling
 * megabytes of history into the renderer.
 */
export function tailLog(maxBytes = 64 * 1024): string {
  try {
    const p = getCurrentLogPath();
    if (!fs.existsSync(p)) return '';
    const stat = fs.statSync(p);
    if (stat.size <= maxBytes) {
      return fs.readFileSync(p, 'utf-8');
    }
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
      // Discard the partial first line so we don't render a half-line.
      const text = buf.toString('utf-8');
      const firstNewline = text.indexOf('\n');
      return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

// --- internals ---

function logDir(): string {
  return path.join(getDataDir(), 'logs');
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rotateIfNeeded(): void {
  const targetPath = path.join(logDir(), `${ymd(new Date())}.log`);
  if (currentLogPath === targetPath && logStream) return;

  if (logStream) {
    try { logStream.end(); } catch { /* ignore */ }
    logStream = null;
  }
  if (!fs.existsSync(logDir())) {
    fs.mkdirSync(logDir(), { recursive: true });
  }
  logStream = fs.createWriteStream(targetPath, { flags: 'a', encoding: 'utf-8' });
  currentLogPath = targetPath;
  try { currentBytes = fs.statSync(targetPath).size; } catch { currentBytes = 0; }
  capNoticeWritten = false;
  pruneOldLogs(logDir(), new Date());
}

/**
 * Delete daily logs older than the retention window.
 *
 * Only files named exactly `YYYY-MM-DD.log` are candidates, so nothing
 * else a user or tool put in the directory is touched. Exported for the
 * test; runs on each day's rotation.
 */
export function pruneOldLogs(dir: string, now: Date, keepDays = LOG_RETENTION_DAYS): string[] {
  const removed: string[] = [];
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffYmd = ymd(cutoff);
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (!m || m[1] >= cutoffYmd) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch { /* in use or already gone */ }
  }
  return removed;
}

function formatArgs(args: unknown[]): string {
  return args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}
