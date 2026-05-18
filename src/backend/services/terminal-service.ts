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
 */
export function createTerminal(opts: {
  preset?: AgentPreset;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
}): TerminalSessionInfo {
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

  // Pipe PTY output to all registered listeners
  pty.onData((data) => {
    for (const fn of dataListeners) fn(id, data);
  });

  pty.onExit(({ exitCode }) => {
    session.alive = false;
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
  }
  sessions.clear();
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
