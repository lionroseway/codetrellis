/**
 * The CLI as an agent (Phase 32 D1.2): one MCP connection to the backend,
 * the way the stdio connector makes one, so every verb is an agent's call:
 * attributed (`authorFromExtra`), checked against the capability matrix and
 * the breakpoints, and shown in the Timeline. It reads the token and the
 * endpoint from the data dir on every run, as the connector does, and says
 * which folder it works in, so the backend binds it to that worktree.
 *
 * It names itself after the agent running it: `--as`, else
 * `CODETRELLIS_AGENT`, else Claude Code's own marker, else `codetrellis-cli`.
 * A name is attribution, never authority: the server maps it, and refuses
 * the names reserved for the person.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { bindingHeaders } from '../backend/mcp/binding-headers';
import { defaultDataDir, readConnectTarget } from '../backend/mcp/connector/files';
import { headlessDataDir } from './args';

/** The agent running this command, as it will be named in the Timeline. */
export function agentName(asFlag: string | undefined, env: NodeJS.ProcessEnv): string {
  if (asFlag && asFlag.trim()) return asFlag.trim();
  if (env.CODETRELLIS_AGENT && env.CODETRELLIS_AGENT.trim()) return env.CODETRELLIS_AGENT.trim();
  if (env.CLAUDECODE === '1') return 'claude-code';
  return 'codetrellis-cli';
}

/**
 * The backend to talk to: the one named, else the headless one for this
 * folder (when it has published an endpoint), else the desktop app's.
 */
export function dataDirFor(given: string | undefined, cwd: string, env: NodeJS.ProcessEnv): string {
  if (given) return path.resolve(given);
  const here = headlessDataDir(cwd, env, os.homedir());
  if (fs.existsSync(path.join(here, 'mcp-endpoint.json'))) return here;
  return defaultDataDir(env);
}

export interface ToolAnswer {
  /** The tool's own answer: its first text entry. */
  text: string;
  /** Parsed, when it is JSON. */
  json: unknown;
  isError: boolean;
}

export interface Agent {
  call(name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
  close(): Promise<void>;
}

export class NotRunningError extends Error {}

export async function connectAgent(opts: { dataDir: string; name: string; cwd: string }): Promise<Agent> {
  const target = readConnectTarget(opts.dataDir);
  if (!target.ok) {
    throw new NotRunningError(`CodeTrellis is not running for this folder (${target.reason}). Start it with \`codetrellis serve\`, or open the app.`);
  }
  // SSE is EventSource underneath: the token goes as the query parameter the
  // server accepts on this transport, and the folder as the connector's header.
  const url = new URL(target.url);
  url.searchParams.set('ct_token', target.token);
  const headers = bindingHeaders({ cwd: opts.cwd });
  const transport = new SSEClientTransport(url, {
    eventSourceInit: {
      fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), ...headers } }),
    },
    requestInit: { headers },
  });
  const client = new Client({ name: opts.name, version: 'cli' }, { capabilities: {} });
  await client.connect(transport);
  return {
    async call(name, args) {
      const res = (await client.callTool({ name, arguments: args })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      const text = (res.content ?? []).find((c) => c.type === 'text' && typeof c.text === 'string')?.text ?? '';
      let json: unknown = null;
      try { json = JSON.parse(text); } catch { /* words, not JSON */ }
      return { text, json, isError: res.isError === true };
    },
    async close() {
      try { await client.close(); } catch { /* best effort */ }
    },
  };
}
