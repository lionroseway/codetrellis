/**
 * Terminal control tools — create, write, read, list, kill, resize.
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
        'Multiple terminals can run concurrently (up to 20). The terminal is visible in the CodeTrellis UI.',
      inputSchema: {
        preset: agentPresetEnum.optional().describe('Agent preset or plain shell. Default: "shell".'),
        cwd: z.string().optional().describe('Working directory. Defaults to the active project root.'),
        title: z.string().optional().describe('Tab title. Auto-generated if omitted.'),
      },
    },
    async ({ preset, cwd, title }) => {
      try {
        const session = deps.terminalService.createTerminal({
          preset: preset ?? 'shell',
          cwd,
          title,
        });
        deps.broadcast('terminal-created', { session });
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
        'Use terminal_list to find active session IDs. Each terminal is independent — target the right one.',
      inputSchema: {
        session_id: z.string().describe('Terminal session ID (from terminal_create or terminal_list).'),
        input: z.string().describe('Text to write. Include "\\n" to execute a command.'),
      },
    },
    async ({ session_id, input }) => {
      const ok = deps.terminalService.writeTerminal(session_id, input);
      if (!ok) {
        return { content: [{ type: 'text' as const, text: `Terminal ${session_id} not found or not alive.` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: `Wrote ${input.length} chars to ${session_id}` }] };
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
}
