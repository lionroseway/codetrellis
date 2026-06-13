/**
 * Phase 17.B / Terminal — PTY session manager.
 *
 * Spawns shell processes via node-pty, multiplexes I/O over a
 * WebSocket channel. Each terminal gets a unique ID; the frontend
 * connects via WS and sends/receives raw bytes per terminal.
 *
 * Agent presets: "claude", "codex", "aider", or plain shell. A preset
 * sets the initial command (e.g. `claude --dangerously-skip-permissions`)
 * and environment tweaks.
 *
 * The service also supports "inject" — piping a constructed prompt
 * into a running terminal. Used by the 17.B "Explain with agent" flow.
 */

import os from 'node:os';
import path from 'node:path';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import { appendHistory, closeTerminalHistory } from './terminal-history-service';

export type AgentPreset = 'claude' | 'codex' | 'aider' | 'shell';

export interface TerminalSession {
  id: string;
  pty: IPty;
  preset: AgentPreset;
  title: string;
  cwd: string;
  pid: number;
  createdAt: number;
  alive: boolean;
}

interface TerminalSessionInfo {
  id: string;
  preset: AgentPreset;
  title: string;
  cwd: string;
  pid: number;
  createdAt: number;
  alive: boolean;
}

const sessions = new Map<string, TerminalSession>();
let counter = 0;

/**
 * Per-session output ring buffer. Stores the last RING_BUFFER_MAX_BYTES
 * of PTY output so:
 *  - MCP `terminal_read` can read recent content without a live WS,
 *  - the `terminal.stream` RPC can hand a fresh client the existing
 *    scrollback via `readTerminalDelta(id)` with no `since`,
 *  - the remote-terminal relay can hydrate a freshly-connected peer
 *    (e.g. mobile after backgrounding) so its terminal view never
 *    renders blank.
 *
 * 256 KB ≈ many minutes of an interactive session at typical output
 * rates and is the snapshot ceiling sent over the wire on attach.
 * Keep it in-memory only — encrypted persistence across desktop
 * restarts is out of scope for v1 per the plan's "OUT" list.
 */
const RING_BUFFER_MAX_BYTES = 256 * 1024;
const outputBuffers = new Map<string, string>();
/** Monotonic total bytes ever written per session (for delta streaming). */
const bufferTotals = new Map<string, number>();

function appendToBuffer(id: string, data: string): void {
  const existing = outputBuffers.get(id) ?? '';
  const combined = existing + data;
  bufferTotals.set(id, (bufferTotals.get(id) ?? 0) + data.length);
  // Trim from the front if over budget
  if (combined.length > RING_BUFFER_MAX_BYTES) {
    outputBuffers.set(id, combined.slice(combined.length - RING_BUFFER_MAX_BYTES));
  } else {
    outputBuffers.set(id, combined);
  }
}

/**
 * Read incremental raw output since a byte offset, for streaming into a
 * terminal emulator (xterm). Returns the raw bytes (ANSI intact) appended
 * since `since`, the new monotonic total, and whether the caller must
 * reset first (gap — `since` predates the ring buffer, or first read).
 */
export function readTerminalDelta(
  id: string,
  since?: number,
): { data: string; total: number; reset: boolean } | null {
  const buf = outputBuffers.get(id);
  if (buf === undefined) return null;
  const total = bufferTotals.get(id) ?? buf.length;
  const bufStart = total - buf.length; // total-offset of buf[0]
  if (since == null || since < bufStart) {
    return { data: buf, total, reset: true };
  }
  if (since >= total) {
    return { data: '', total, reset: false };
  }
  return { data: buf.slice(since - bufStart), total, reset: false };
}

/**
 * Maximum concurrent PTY sessions. Each session is a full shell process
 * with its own PID, file descriptors, and memory. Unbounded creation
 * (e.g. from multiple concurrent agents each requesting terminals) can
 * exhaust PIDs / file descriptors and crash the backend.
 */
const MAX_TERMINAL_SESSIONS = 20;

// Listeners for terminal data — supports multiple consumers so both
// the WebSocket layer (web mode) and the Electron IPC layer can
// coexist without overwriting each other.
const dataListeners: Array<(id: string, data: string) => void> = [];
const exitListeners: Array<(id: string, code: number) => void> = [];

export function onTerminalData(fn: (id: string, data: string) => void): () => void {
  dataListeners.push(fn);
  return () => {
    const idx = dataListeners.indexOf(fn);
    if (idx >= 0) dataListeners.splice(idx, 1);
  };
}

export function onTerminalExit(fn: (id: string, code: number) => void): () => void {
  exitListeners.push(fn);
  return () => {
    const idx = exitListeners.indexOf(fn);
    if (idx >= 0) exitListeners.splice(idx, 1);
  };
}

/**
 * Get the user's default shell.
 */
function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/zsh';
}

/**
 * Build the command + args for a given agent preset.
 */
function presetCommand(preset: AgentPreset): { file: string; args: string[] } {
  const shell = getDefaultShell();
  // Spawn as a login shell (-l) so the user's profile (.zshrc, .bash_profile)
  // is sourced — this gives colored prompts, aliases, PATH, etc.
  switch (preset) {
    case 'claude':
      return { file: shell, args: ['-l'] };
    case 'codex':
      return { file: shell, args: ['-l'] };
    case 'aider':
      return { file: shell, args: ['-l'] };
    case 'shell':
    default:
      return { file: shell, args: ['-l'] };
  }
}

/**
 * Get the initial command to type after the shell starts for agent presets.
 */
function presetInitCommand(preset: AgentPreset): string | null {
  switch (preset) {
    case 'claude':
      return 'claude\n';
    case 'codex':
      return 'codex\n';
    case 'aider':
      return 'aider\n';
    default:
      return null;
  }
}

/**
 * Create a new terminal session.
 * Throws if the session limit is reached — callers (REST route)
 * should catch and return 503 / a user-facing message.
 */
export function createTerminal(opts: {
  preset?: AgentPreset;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
}): TerminalSessionInfo {
  // Reap dead sessions first — a terminal whose PTY exited still sits
  // in the map until explicitly killed. Auto-reap keeps the count
  // honest so users don't hit the limit with all-dead sessions.
  for (const [id, s] of sessions) {
    if (!s.alive) sessions.delete(id);
  }

  if (sessions.size >= MAX_TERMINAL_SESSIONS) {
    throw new Error(
      `Terminal session limit reached (${MAX_TERMINAL_SESSIONS}). ` +
      `Close unused terminals before opening new ones.`,
    );
  }

  const id = `term-${++counter}-${Date.now().toString(36)}`;
  const preset = opts.preset ?? 'shell';
  const cwd = opts.cwd ?? process.cwd();
  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 30;

  const { file, args } = presetCommand(preset);

  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    // Enable colored output for ls, grep, and other tools
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    LSCOLORS: 'GxFxCxDxBxegedabagaced',
    // Avoid pager for git and other tools inside the terminal
    GIT_PAGER: '',
    PAGER: '',
    // Self-write detection: agents running inside this PTY can read
    // this env var and pass it to register_session(host_terminal_id=...)
    // so terminal_write can reject writes to their own host terminal.
    CODETRELLIS_HOST_TERMINAL: id,
  };

  const pty = ptySpawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: env as Record<string, string>,
  });

  const session: TerminalSession = {
    id,
    pty,
    preset,
    title: opts.title ?? `${preset === 'shell' ? 'Terminal' : preset} ${counter}`,
    cwd,
    pid: pty.pid,
    createdAt: Date.now(),
    alive: true,
  };

  sessions.set(id, session);

  // Pipe PTY output to ring buffer + persistent history + all registered listeners.
  // The history append is async-buffered (terminal-history-service flushes
  // in the background), so the PTY data callback isn't blocked.
  pty.onData((data) => {
    appendToBuffer(id, data);
    appendHistory(id, data);
    for (const fn of dataListeners) fn(id, data);
  });

  pty.onExit(({ exitCode }) => {
    session.alive = false;
    // Plan 11.3 — flush + close the disk-history fd on natural PTY
    // exit (process ended, user typed `exit`). Without this, the fd
    // stayed open until killTerminal was called, which never happens
    // for naturally-exited sessions. Idempotent — safe if
    // killTerminal also calls it later.
    closeTerminalHistory(id);
    for (const fn of exitListeners) fn(id, exitCode);
  });

  // For agent presets, type the agent command after a short delay
  // to let the shell initialize.
  const initCmd = presetInitCommand(preset);
  if (initCmd) {
    setTimeout(() => {
      if (session.alive) pty.write(initCmd);
    }, 500);
  }

  return sessionToInfo(session);
}

/**
 * Write data to a terminal (keyboard input from the frontend).
 */
export function writeTerminal(id: string, data: string): boolean {
  const s = sessions.get(id);
  if (!s || !s.alive) return false;
  s.pty.write(data);
  return true;
}

/**
 * Resize a terminal.
 */
export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const s = sessions.get(id);
  if (!s || !s.alive) return false;
  s.pty.resize(cols, rows);
  return true;
}

/**
 * Inject text into a terminal (e.g. paste a prompt for an agent).
 * This writes the text directly as if the user typed it.
 */
export function injectPrompt(id: string, text: string): boolean {
  const s = sessions.get(id);
  if (!s || !s.alive) return false;
  s.pty.write(text);
  return true;
}

/**
 * Kill a terminal session.
 */
export function killTerminal(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.alive = false;
  s.pty.kill();
  sessions.delete(id);
  outputBuffers.delete(id);
  // Close the disk handle; the log file is left on disk so the user
  // can still scroll through it from a later session before GC runs.
  closeTerminalHistory(id);
  return true;
}

/**
 * List all active terminal sessions.
 */
export function listTerminals(): TerminalSessionInfo[] {
  return Array.from(sessions.values()).map(sessionToInfo);
}

/**
 * Get a specific terminal session info.
 */
export function getTerminal(id: string): TerminalSessionInfo | null {
  const s = sessions.get(id);
  return s ? sessionToInfo(s) : null;
}

/**
 * Kill all terminals (cleanup on server shutdown).
 */
export function killAllTerminals(): void {
  for (const s of sessions.values()) {
    s.pty.kill();
    // Best-effort close of each history file; closeTerminalHistory
    // also flushes pending writes.
    try { closeTerminalHistory(s.id); } catch { /* */ }
  }
  sessions.clear();
  outputBuffers.clear();
}

/**
 * Read recent output from a terminal's ring buffer.
 * Returns the last `lines` lines (default 50). ANSI escape codes are
 * stripped so the output is readable as plain text.
 */
export function readTerminalOutput(id: string, lines?: number, raw = false): string | null {
  const buf = outputBuffers.get(id);
  if (buf === undefined) return null;
  // `raw` keeps ANSI so the client (e.g. the mobile app) can colour it
  // itself. Otherwise strip escape sequences for clean plain text (used
  // by agents via the MCP tool). The CSI class now includes `?` so
  // private sequences like \x1b[?2004h (bracketed paste) are fully
  // removed instead of leaving a literal "[?2004h".
  let text: string;
  if (raw) {
    text = buf;
  } else {
    text = buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\x1b\].*?\x07/g, '')     // OSC sequences
      .replace(/\x1b[()][A-Z0-9]/g, '')  // character set selects
      .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, ''); // control chars (keep \n \r)
  }
  const allLines = text.split('\n');
  const maxLines = lines ?? 50;
  const tail = allLines.slice(-maxLines);
  return tail.join('\n');
}

function sessionToInfo(s: TerminalSession): TerminalSessionInfo {
  return {
    id: s.id,
    preset: s.preset,
    title: s.title,
    cwd: s.cwd,
    pid: s.pid,
    createdAt: s.createdAt,
    alive: s.alive,
  };
}
