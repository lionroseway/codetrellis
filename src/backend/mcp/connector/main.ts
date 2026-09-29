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
import fs from 'node:fs';
import { HOOK_FLAG, HOOK_PRE_TOOL_USE, HOOK_GEMINI_BEFORE_TOOL, runPreToolUseHook, runGeminiBeforeToolHook, CHECK_EDIT_FLAG, OLD_TEXT_FILE_FLAG, runCheckEdit } from './hook';

declare const __CONNECTOR_VERSION__: string | undefined;
const VERSION = typeof __CONNECTOR_VERSION__ === 'string' ? __CONNECTOR_VERSION__ : 'dev';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const dataDir = argValue('--data-dir') ?? defaultDataDir();
const log = (line: string) => process.stderr.write(`[codetrellis-mcp] ${line}\n`);

/** One connection to the app, the token and endpoint read fresh, bound to `cwd`. */
const connectFrom = (cwd: string) => {
  const target = readConnectTarget(dataDir);
  if (!target.ok) throw new Error(target.reason);
  return connectSseUpstream({
    url: target.url,
    token: target.token,
    binding: { cwd, hostTerminal: process.env.CODETRELLIS_HOST_TERMINAL ?? null },
  });
};

// As a Claude Code PreToolUse hook (A3.4): read the call, answer once, exit.
// Always exit 0: a hook that fails must never stand in the way of an edit.
// As Gemini CLI's BeforeTool hook (A8.3), the same way: its own input and output.
if (argValue(HOOK_FLAG) === HOOK_PRE_TOOL_USE || argValue(HOOK_FLAG) === HOOK_GEMINI_BEFORE_TOOL) {
  const run = argValue(HOOK_FLAG) === HOOK_GEMINI_BEFORE_TOOL ? runGeminiBeforeToolHook : runPreToolUseHook;
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => { input += chunk; });
  process.stdin.on('end', () => {
    void run({ stdin: input, connect: async (cwd) => connectFrom(cwd), version: VERSION })
      .catch(() => null)
      // Exit once it is written: on macOS a pipe write is asynchronous.
      .then((out) => { if (out) process.stdout.write(`${out}\n`, () => process.exit(0)); else process.exit(0); });
  });
} else if (argValue(CHECK_EDIT_FLAG) !== null) {
  // Any client's pre-edit check (A8.2): exit 0 go ahead, 2 held (reason on
  // stderr), and 0 with nothing printed on any failure.
  const file = argValue(CHECK_EDIT_FLAG)!;
  const oldTextFile = argValue(OLD_TEXT_FILE_FLAG);
  let oldText: string | null = null;
  try { oldText = oldTextFile ? fs.readFileSync(oldTextFile, 'utf8').slice(0, 20_000) : null; } catch { oldText = null; }
  void runCheckEdit({ file, cwd: process.cwd(), oldText, connect: async (cwd) => connectFrom(cwd), version: VERSION })
    .catch(() => ({ code: 0 as const, stdout: null, stderr: null }))
    .then((r) => {
      // Exit once both are written: on macOS a pipe write is asynchronous.
      const out = () => (r.stdout ? process.stdout.write(`${r.stdout}\n`, () => process.exit(r.code)) : process.exit(r.code));
      if (r.stderr) process.stderr.write(`${r.stderr}\n`, out); else out();
    });
} else {
  runConnector();
}

function runConnector(): void {
  const core = new ConnectorCore({
    version: VERSION,
    log,
    send: (msg: JsonRpcMessage) => {
      process.stdout.write(`${JSON.stringify(msg)}\n`);
    },
    // Read both files on EVERY connect. This is the entire point: the token
    // rotates on each launch, and the port moves when a second instance runs.
    // The agent launched us in its working directory; a CodeTrellis terminal
    // also names itself. The server binds the session to a workstream from
    // these, re-derived on every connect (Phase 32 A1.1).
    connect: async () => connectFrom(process.cwd()),
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
}
