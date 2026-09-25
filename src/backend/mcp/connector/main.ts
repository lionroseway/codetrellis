/**
 * `codetrellis-mcp` — the stdio connector an agent's config launches.
 *
 * Usage (the app generates this; nobody should have to type it):
 *
 *   ELECTRON_RUN_AS_NODE=1 <CodeTrellis binary> <resources>/connector/mcp-connector.cjs --data-dir <dir>
 *
 * Run by the app's own binary in Node mode, so an agent's machine needs no
 * Node install, and no window or dock icon appears. See `core.ts` for what
 * it does and why it exists.
 *
 * stdout carries the protocol and nothing else. Diagnostics go to stderr,
 * which Claude Code and Claude Desktop both keep in their MCP logs.
 */

import { ConnectorCore, type JsonRpcMessage } from './core';
import { connectSseUpstream } from './sse-upstream';
import { defaultDataDir, readConnectTarget } from './files';

declare const __CONNECTOR_VERSION__: string | undefined;
const VERSION = typeof __CONNECTOR_VERSION__ === 'string' ? __CONNECTOR_VERSION__ : 'dev';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const dataDir = argValue('--data-dir') ?? defaultDataDir();
const log = (line: string) => process.stderr.write(`[codetrellis-mcp] ${line}\n`);

const core = new ConnectorCore({
  version: VERSION,
  log,
  send: (msg: JsonRpcMessage) => {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  },
  connect: async () => {
    // Read both files on EVERY connect. This is the entire point: the token
    // rotates on each launch, and the port moves when a second instance runs.
    const target = readConnectTarget(dataDir);
    if (!target.ok) throw new Error(target.reason);
    return connectSseUpstream({ url: target.url, token: target.token });
  },
});

// Newline-delimited JSON-RPC on stdin, per the MCP stdio transport.
let buffer = '';
let queue: Promise<void> = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let newline: number;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      log('Ignored a line that was not JSON.');
      continue;
    }
    // In order: an `initialize` that is still deciding must not be
    // overtaken by the `initialized` notification that follows it.
    queue = queue.then(() => core.handleClientMessage(msg)).catch((err) => {
      log(`Error handling a message: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
});

// The client closing stdin is the only way this process is told to stop.
const shutdown = () => {
  core.stop();
  process.exit(0);
};
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
// A client that has gone leaves a closed pipe; writing to it raises EPIPE.
process.stdout.on('error', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

log(`Starting (data dir ${dataDir}).`);
core.start();
