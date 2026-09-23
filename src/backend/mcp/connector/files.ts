/**
 * The two files a local MCP client needs to reach this app, and nothing else.
 *
 * `<dataDir>/capability-token` holds this launch's token (see
 * `services/capability-token.ts`). `<dataDir>/mcp-endpoint.json` holds the
 * URL the MCP server actually bound, which is not always :19432 — a second
 * instance walks forward to the next free port.
 *
 * This module is imported by the stdio connector, which ships as its own
 * bundle and runs outside the app. So it may use Node built-ins and nothing
 * from the backend: pulling in `persistence` or `settings-service` would drag
 * the database layer into a process that must start in milliseconds.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TOKEN_FILE = 'capability-token';
export const ENDPOINT_FILE = 'mcp-endpoint.json';

export interface McpEndpoint {
  /** The SSE URL, e.g. `http://127.0.0.1:19432/sse`. */
  url: string;
  /** Process that wrote it — so a stopping app removes only its own file. */
  pid: number;
  startedAt: number;
}

/**
 * The data dir when the caller was not told one.
 *
 * Mirrors `persistence.resolveDataDir` minus the settings override, which
 * lives in a file this process has no business parsing. The connector is
 * normally given `--data-dir` by the config the app generated, so this is
 * the fallback for a hand-written config.
 */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CODETRELLIS_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return path.join(os.homedir(), '.codetrellis');
}

/**
 * Only loopback SSE URLs are accepted from the endpoint file.
 *
 * The connector sends the capability token to whatever URL this file names.
 * Anything that can write the file can already read the token beside it, so
 * this is not the only line of defence — but a token must never be sent off
 * the machine because a file said so, and checking costs nothing.
 */
export function isLoopbackSseUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:') return false;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return false;
  return u.pathname === '/sse' && u.username === '' && u.password === '';
}

/**
 * Publish the bound endpoint. 0600, written atomically, so a reader never
 * sees half a file.
 */
export function writeEndpointFile(dataDir: string, endpoint: McpEndpoint): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, ENDPOINT_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(endpoint), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, target);
}

/**
 * Remove the endpoint file — but only if this process wrote it. A second
 * instance that bound a different port owns the file now, and deleting it
 * on the way out would strand every connector pointed at the survivor.
 */
export function removeEndpointFile(dataDir: string, pid: number): void {
  const target = path.join(dataDir, ENDPOINT_FILE);
  const current = readEndpoint(dataDir);
  if (current && current.pid !== pid) return;
  try {
    fs.unlinkSync(target);
  } catch {
    /* already gone */
  }
}

/** The published endpoint, or null if it is missing, malformed or not loopback. */
export function readEndpoint(dataDir: string): McpEndpoint | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, ENDPOINT_FILE), 'utf-8')) as Partial<McpEndpoint>;
    if (typeof parsed.url !== 'string' || !isLoopbackSseUrl(parsed.url)) return null;
    return {
      url: parsed.url,
      pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

/** This launch's token, or null if the app has never run with this data dir. */
export function readToken(dataDir: string): string | null {
  try {
    const token = fs.readFileSync(path.join(dataDir, TOKEN_FILE), 'utf-8').trim();
    return token.length >= 16 ? token : null;
  } catch {
    return null;
  }
}

export type ConnectTarget =
  | { ok: true; url: string; token: string }
  | { ok: false; reason: string };

/**
 * Where to connect, and with what — or why not yet.
 *
 * The endpoint must have been published AFTER the token. At launch the app
 * writes the new token first and binds the MCP port a moment later, so for
 * that moment the endpoint file still names the PREVIOUS launch's port. If
 * something else has taken that port since — another user's process on a
 * shared machine, say — connecting would hand it a live token. So an
 * endpoint older than the token means "the app is still starting": wait.
 *
 * For the same reason there is no fallback to the default port when the
 * endpoint file is missing. Every build that ships this connector also
 * writes the file, so a missing one means the app is not up yet.
 */
export function readConnectTarget(dataDir: string): ConnectTarget {
  const token = readToken(dataDir);
  if (!token) return { ok: false, reason: `no capability token in ${dataDir} yet` };
  const endpoint = readEndpoint(dataDir);
  if (!endpoint) return { ok: false, reason: 'the app has not published its MCP endpoint yet' };
  try {
    const tokenAt = fs.statSync(path.join(dataDir, TOKEN_FILE)).mtimeMs;
    const endpointAt = fs.statSync(path.join(dataDir, ENDPOINT_FILE)).mtimeMs;
    if (endpointAt < tokenAt) return { ok: false, reason: 'the app is still starting' };
  } catch {
    return { ok: false, reason: 'the app is still starting' };
  }
  return { ok: true, url: endpoint.url, token };
}
