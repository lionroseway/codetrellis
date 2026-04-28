/**
 * Thin MCP client for the harness — connects to the spawned
 * backend's MCP SSE server (`http://127.0.0.1:<mcpPort>/sse`) using
 * the same `@modelcontextprotocol/sdk` Claude Code / Codex / Cursor
 * use in production, so the harness exercises the same wire format
 * real agents speak.
 *
 * The wrapper is deliberately minimal — `connect`, `callTool`,
 * `disconnect`. The richer "scripted agent" (`scripted-agent.ts`)
 * builds plan-walking helpers on top.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export interface McpClientOptions {
  /** Backend MCP port — usually `RunningBackend.mcpPort`. */
  mcpPort: number;
  /** Identifies this client in MCP introspection. Default: `harness-client`. */
  clientName?: string;
  /** Default: `1.0.0`. */
  clientVersion?: string;
}

export interface McpToolResult {
  /** Raw `content` array from the MCP response. */
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  /** True if the tool returned an error per the MCP spec. */
  isError?: boolean;
  /** Best-effort decoded text — concatenation of every text-typed
   *  content entry. Empty string if there's no text. */
  text: string;
}

export interface ScriptedMcp {
  /** Open the SSE transport + perform the MCP handshake. */
  connect(): Promise<void>;
  /** Close the transport. Idempotent. */
  disconnect(): Promise<void>;
  /** Call any registered tool by name; throws if the SDK errors. */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  /** Return the registered tool list (useful for introspection in tests). */
  listTools(): Promise<Array<{ name: string; description?: string }>>;
  /** True between `connect()` and `disconnect()`. */
  readonly connected: boolean;
}

export function createMcpClient(opts: McpClientOptions): ScriptedMcp {
  const url = new URL(`http://127.0.0.1:${opts.mcpPort}/sse`);
  let client: Client | null = null;
  let transport: SSEClientTransport | null = null;
  let connected = false;

  return {
    get connected() {
      return connected;
    },

    async connect() {
      if (connected) return;
      transport = new SSEClientTransport(url);
      client = new Client(
        { name: opts.clientName ?? 'harness-client', version: opts.clientVersion ?? '1.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
      connected = true;
    },

    async disconnect() {
      if (!connected) return;
      try {
        await client?.close();
      } catch {
        /* swallow — disconnect is idempotent and best-effort */
      }
      connected = false;
      client = null;
      transport = null;
    },

    async callTool(name, args) {
      if (!client || !connected) {
        throw new Error('MCP client not connected — call connect() first');
      }
      const result = (await client.callTool({ name, arguments: args })) as {
        content: Array<{ type: string; text?: string; [k: string]: unknown }>;
        isError?: boolean;
      };
      const text = (result.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');
      return {
        content: result.content ?? [],
        isError: result.isError,
        text,
      };
    },

    async listTools() {
      if (!client || !connected) {
        throw new Error('MCP client not connected — call connect() first');
      }
      const result = await client.listTools();
      return result.tools.map((t) => ({ name: t.name, description: t.description }));
    },
  };
}
