/**
 * Terminal control tools — create, write, read, list, kill, resize, focus.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';

const agentPresetEnum = z.enum(['shell', 'claude', 'codex', 'aider']);

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'terminal_create',
    {
      description:
        'Create a new terminal session in CodeTrellis. Returns the session ID for use with terminal_write / terminal_read. ' +
        'Preset "shell" opens a plain shell; "claude", "codex", "aider" open a shell and launch that agent after 500ms. ' +
        'Multiple terminals can run concurrently (up to 20). By default the new terminal is focused in the UI — ' +
        'set focus: false for background terminals that shouldn\'t steal the user\'s view.',
      inputSchema: {
        preset: agentPresetEnum.optional().describe('Agent preset or plain shell. Default: "shell".'),
        cwd: z.string().optional().describe('Working directory. Defaults to the active project root.'),
        title: z.string().optional().describe('Tab title. Auto-generated if omitted.'),
        focus: z.boolean().optional().describe('Focus the new terminal tab in the UI. Default true. Set false for background terminals.'),
      },
    },
    async ({ preset, cwd, title, focus }) => {
      try {
        const session = deps.terminalService.createTerminal({
          preset: preset ?? 'shell',
          cwd,
          title,
        });
        deps.broadcast('terminal-created', { session, focus: focus !== false });
        return { content: [{ type: 'text' as const, text: JSON.stringify(session, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'terminal_write',
    {
      description:
        'Send input to a terminal session (keystrokes, commands). The text is written as-is — include "\\n" to press Enter. ' +
        'Use terminal_list to find active session IDs. Each terminal is independent — target the right one. ' +
        'Set focus: true to switch the UI to this terminal tab so the user sees the output live. ' +
        'IMPORTANT: Before writing, make sure you know what is running in the target terminal (use terminal_read first). ' +
        'Never write to your own host terminal — if you are running inside a CodeTrellis terminal, writing to it creates a feedback loop.',
      inputSchema: {
        session_id: z.string().describe('Terminal session ID (from terminal_create or terminal_list).'),
        input: z.string().describe('Text to write. Include "\\n" to execute a command.'),
        focus: z.boolean().optional().describe('Focus this terminal tab in the UI before writing. Default false.'),
      },
    },
    async ({ session_id, input, focus }) => {
      // Unescape common terminal escape sequences. MCP clients (including
      // Claude Code) may send literal two-char sequences like \n \r \t
      // instead of the actual control bytes, because the JSON layer
      // double-escapes them. We normalise here so `terminal_write` "just
      // works" regardless of how the client encodes newlines.
      const unescaped = input
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');

      if (focus) {
        deps.broadcast('ui-terminal-focus', { sessionId: session_id });
      }

      const ok = deps.terminalService.writeTerminal(session_id, unescaped);
      if (!ok) {
        return { content: [{ type: 'text' as const, text: `Terminal ${session_id} not found or not alive.` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: `Wrote ${unescaped.length} chars to ${session_id}` }] };
    },
  );

  server.registerTool(
    'terminal_read',
    {
      description:
        'Read recent output from a terminal session. Returns the last N lines of terminal output with ANSI codes stripped (plain text). ' +
        'Useful for checking command results, build output, test results, or agent responses. ' +
        'The terminal keeps a 64KB scrollback buffer — older output is lost.',
      inputSchema: {
        session_id: z.string().describe('Terminal session ID.'),
        lines: z.number().int().min(1).max(500).optional().describe('Number of lines to return. Default 50.'),
      },
    },
    async ({ session_id, lines }) => {
      const output = deps.terminalService.readTerminalOutput(session_id, lines);
      if (output === null) {
        return { content: [{ type: 'text' as const, text: `Terminal ${session_id} not found.` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: output }] };
    },
  );

  server.registerTool(
    'terminal_list',
    {
      description:
        'List all terminal sessions with their ID, preset, title, PID, and alive status. ' +
        'Use this to find the right session_id for terminal_write / terminal_read.',
      inputSchema: {
        alive_only: z.boolean().optional().describe('Only show alive sessions. Default true.'),
      },
    },
    async ({ alive_only }) => {
      let sessions = deps.terminalService.listTerminals();
      if (alive_only !== false) {
        sessions = sessions.filter((s) => s.alive);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(sessions, null, 2) }] };
    },
  );

  server.registerTool(
    'terminal_kill',
    {
      description: 'Kill a terminal session. The terminal tab is removed from the CodeTrellis UI.',
      inputSchema: {
        session_id: z.string().describe('Terminal session ID to kill.'),
      },
    },
    async ({ session_id }) => {
      const ok = deps.terminalService.killTerminal(session_id);
      if (!ok) {
        return { content: [{ type: 'text' as const, text: `Terminal ${session_id} not found.` }], isError: true };
      }
      deps.broadcast('terminal-killed', { id: session_id });
      return { content: [{ type: 'text' as const, text: `Killed terminal ${session_id}` }] };
    },
  );

  server.registerTool(
    'terminal_resize',
    {
      description: 'Resize a terminal session (cols x rows). Useful before reading output to ensure clean line wrapping.',
      inputSchema: {
        session_id: z.string(),
        cols: z.number().int().min(40).max(400).describe('Column width.'),
        rows: z.number().int().min(10).max(100).describe('Row height.'),
      },
    },
    async ({ session_id, cols, rows }) => {
      const ok = deps.terminalService.resizeTerminal(session_id, cols, rows);
      if (!ok) {
        return { content: [{ type: 'text' as const, text: `Terminal ${session_id} not found or not alive.` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: `Resized ${session_id} to ${cols}x${rows}` }] };
    },
  );

  server.registerTool(
    'terminal_focus',
    {
      description:
        'Switch the terminal panel to show a specific terminal tab. Use this when you want the user to see ' +
        'a particular terminal\'s output — e.g. before writing commands the user should watch, or after a ' +
        'background terminal produces interesting results. Also opens the terminal panel if it\'s hidden.',
      inputSchema: {
        session_id: z.string().describe('Terminal session ID to focus.'),
      },
    },
    async ({ session_id }) => {
      // Verify the terminal exists
      const sessions = deps.terminalService.listTerminals();
      const exists = sessions.some((s) => s.id === session_id);
      if (!exists) {
        return { content: [{ type: 'text' as const, text: `Terminal ${session_id} not found.` }], isError: true };
      }
      deps.broadcast('ui-terminal-focus', { sessionId: session_id });
      return { content: [{ type: 'text' as const, text: `Focused terminal ${session_id}` }] };
    },
  );
}
