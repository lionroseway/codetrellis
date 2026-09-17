/**
 * In-process Express dispatcher for the Electron desktop build.
 *
 * Why this exists:
 *
 *   - Web mode (`npm run dev`) needs the backend to listen on a TCP
 *     port — the browser fetches `http://localhost:3001/api/…`.
 *   - Electron mode does NOT need a TCP port. The renderer is in the
 *     same process group; it can talk to the backend via IPC. Binding
 *     a backend TCP port causes collisions with users' own dev work
 *     and surfaces an attack surface (other local processes could
 *     hit it). The MCP server keeps its port (external agents need
 *     a stable URL); the backend's HTTP API does not.
 *
 * This module synthesises a fake `IncomingMessage` + `ServerResponse`
 * for each IPC request and feeds them to the Express app via
 * `app.handle()`. Express has no idea the request didn't come over
 * the wire — it goes through every middleware (CORS, body parsing,
 * routing) exactly the same way.
 */

import { Socket } from 'node:net';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { getCapabilityToken, TOKEN_HEADER } from './capability-token';

export interface IpcRequest {
  /** HTTP method, uppercased. */
  method: string;
  /** Path + query string, e.g. `/api/plans?summary=1`. No host. */
  url: string;
  /** Lowercase header names. Body-related headers (content-length,
   *  content-type) are auto-set if omitted. */
  headers?: Record<string, string>;
  /**
   * Request body. Strings get UTF-8 encoded; Uint8Arrays pass through.
   * `null` / `undefined` means no body (correct for GET/DELETE).
   */
  body?: string | Uint8Array | null;
}

export interface IpcResponse {
  status: number;
  /** Lowercased header names. */
  headers: Record<string, string>;
  /**
   * Response body as a UTF-8 string. The vast majority of `/api/…`
   * responses are JSON — UTF-8 decoding is correct. Binary endpoints
   * (none today) would need a different encoding strategy.
   */
  body: string;
}

/**
 * Dispatch an IPC request from our own renderer, authenticated.
 *
 * WHY THIS EXISTS (and why it is not optional)
 *
 * `dispatch` runs the request through EVERY middleware, which is the whole
 * point of it — including the capability-token check added in Gate 1.1. The
 * renderer cannot supply that token: it has no filesystem access, and handing
 * it one would put a live credential inside a web context for no reason.
 *
 * So the main process attaches it here. That is sound because this path has no
 * socket: it is our own renderer, over a contextIsolated preload, inside the
 * same process. Nothing else can reach it. The alternative — exempting IPC
 * requests inside the auth middleware — would put a bypass branch in the one
 * piece of code that must not have one.
 *
 * WITHOUT THIS THE PACKAGED APP IS A BLANK WINDOW. Every `/api/*` call 401s,
 * the renderer gets `{error: …}` where it expected data, and the first deep
 * property read throws. It is invisible in dev (the Vite proxy attaches the
 * token) and invisible to the harness (it speaks HTTP with a token), so only
 * launching the packaged binary and LOOKING at it catches this.
 */
export function dispatchAuthorised(app: Express, req: IpcRequest): Promise<IpcResponse> {
  return dispatch(app, {
    ...req,
    headers: {
      ...(req.headers ?? {}),
      // Last, deliberately: a caller cannot override it with a wrong value.
      [TOKEN_HEADER]: getCapabilityToken(),
    },
  });
}

/**
 * Send a request through the Express app in-process. Resolves once
 * `res.end()` has been called by the route handler.
 *
 * Errors thrown synchronously by the app or middleware come back
 * as a 500 with the error message in the body, matching what
 * Express's default error handler would do over the wire.
 */
export function dispatch(app: Express, req: IpcRequest): Promise<IpcResponse> {
  return new Promise((resolve) => {
    const fakeReq = buildFakeRequest(req);
    const fakeRes = buildFakeResponse(fakeReq, (response) => resolve(response));

    try {
      // `app.handle` is the same entry point http.createServer would
      // use. Express figures out routing + middleware from there.
      app(fakeReq as unknown as IncomingMessage, fakeRes as unknown as ServerResponse);
    } catch (err) {
      // Synchronous throw inside a middleware — Express usually
      // catches these via its async wrapper, but if a middleware
      // throws before the wrapper kicks in we resolve with a 500.
      if (!fakeRes.writableEnded) {
        resolve({
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          body: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
}

// --- Internals ---

function buildFakeRequest(input: IpcRequest): FakeIncomingMessage {
  // Construct via the real prototype so methods like .on, .pipe,
  // .pause exist. The "socket" is a bare net.Socket that Express
  // and body-parser only ever read trivial properties off.
  const fakeSocket = new Socket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fakeSocket as any)._handle = null;

  const req = new IncomingMessage(fakeSocket) as FakeIncomingMessage;
  req.method = (input.method || 'GET').toUpperCase();
  req.url = input.url;

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    headers[k.toLowerCase()] = v;
  }

  // Auto-fill body-related headers if the caller didn't.
  let bodyBuf: Buffer | null = null;
  if (input.body != null) {
    bodyBuf = typeof input.body === 'string' ? Buffer.from(input.body, 'utf-8') : Buffer.from(input.body);
    if (!('content-length' in headers)) {
      headers['content-length'] = String(bodyBuf.length);
    }
    if (!('content-type' in headers)) {
      // Best-effort default — JSON is the overwhelmingly common case
      // for /api/*. If a route ever needs raw bytes, the caller can
      // override.
      headers['content-type'] = 'application/json; charset=utf-8';
    }
  }

  req.headers = headers;
  req.rawHeaders = Object.entries(headers).flatMap(([k, v]) => [k, v]);
  req.complete = false;

  // Push the body and signal end so body-parser can read it.
  // process.nextTick keeps the order natural — Express attaches
  // its data/end listeners synchronously, then the data drains.
  process.nextTick(() => {
    if (bodyBuf) req.push(bodyBuf);
    req.push(null);
    req.complete = true;
  });

  return req;
}

interface FakeIncomingMessage extends IncomingMessage {
  // sharpen the types we actually set
  url: string;
  method: string;
}

interface FakeServerResponse extends ServerResponse {
  // expose the captured response for our resolver
  __chunks: Buffer[];
  __statusCode: number;
  __headers: Record<string, string>;
  __finished: boolean;
}

function buildFakeResponse(
  req: FakeIncomingMessage,
  done: (r: IpcResponse) => void,
): FakeServerResponse {
  const res = new ServerResponse(req) as FakeServerResponse;
  res.__chunks = [];
  res.__statusCode = 200;
  res.__headers = {};
  res.__finished = false;

  // Override the methods Express uses so we capture instead of
  // writing to a socket. `assignSocket` would normally connect us
  // to the wire — we skip it entirely.

  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: number | string | readonly string[]) => {
    res.__headers[name.toLowerCase()] = Array.isArray(value)
      ? value.join(', ')
      : String(value);
    return origSetHeader(name, value);
  };

  res.removeHeader = (name: string) => {
    delete res.__headers[name.toLowerCase()];
  };

  // writeHead can be called either as writeHead(status) or
  // writeHead(status, headers) or writeHead(status, statusMessage, headers).
  // We cast through unknown because ServerResponse's typed overloads
  // are too strict for an in-process shim.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).writeHead = function writeHead(
    status: number,
    arg2?: string | Record<string, number | string | string[]>,
    arg3?: Record<string, number | string | string[]>,
  ) {
    res.__statusCode = status;
    res.statusCode = status;
    const headerArg = typeof arg2 === 'object' ? arg2 : arg3;
    if (headerArg) {
      for (const [k, v] of Object.entries(headerArg)) {
        const value = Array.isArray(v) ? v.join(', ') : String(v);
        res.__headers[k.toLowerCase()] = value;
      }
    }
    return res;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).write = function write(chunk: unknown) {
    if (chunk != null) {
      res.__chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return true;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).end = function end(chunk?: unknown) {
    if (res.__finished) return res;
    if (chunk != null && typeof chunk !== 'function') {
      res.__chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    res.__finished = true;
    // writableEnded / finished / headersSent are getter-only on
    // ServerResponse — both at the TS level AND at runtime. Express
    // reads these to decide whether to retry / log / no-op, so we
    // override the property descriptors. defineProperty is the only
    // way past a getter-only definition.
    try {
      Object.defineProperty(res, 'writableEnded', { value: true, writable: true, configurable: true });
    } catch { /* best-effort */ }
    try {
      Object.defineProperty(res, 'finished', { value: true, writable: true, configurable: true });
    } catch { /* best-effort */ }
    try {
      Object.defineProperty(res, 'headersSent', { value: true, writable: true, configurable: true });
    } catch { /* best-effort */ }

    // statusCode might have been set via res.status(n) instead of
    // writeHead — pick whichever is freshest.
    res.__statusCode = res.statusCode || res.__statusCode || 200;

    // Express sometimes uses res.getHeader / res._header for
    // bookkeeping; merge our captured map with whatever it set.
    for (const name of res.getHeaderNames()) {
      const v = res.getHeader(name);
      if (v != null && !(name.toLowerCase() in res.__headers)) {
        res.__headers[name.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }

    done({
      status: res.__statusCode,
      headers: res.__headers,
      body: Buffer.concat(res.__chunks).toString('utf-8'),
    });
    return res;
  };

  return res;
}
