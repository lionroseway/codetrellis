/**
 * Origin, Host and capability-token enforcement for the local HTTP surface.
 *
 * THE THREAT THIS ADDRESSES
 *
 * The API binds 127.0.0.1, and the previous CORS middleware said outright
 * that this was the access gate ("we already gate access at the bind level").
 * It is not. Loopback keeps out other *machines*; it does not keep out the
 * user's own *browser*. Any page the user visits can issue requests to
 * `http://127.0.0.1:3001`, and because the old middleware reflected the
 * caller's origin with `Access-Control-Allow-Credentials: true`, that page
 * could also READ the responses.
 *
 * Three layers, each closing a different route in:
 *
 *   1. CAPABILITY TOKEN — a browser cannot read a 0600 file, so it cannot
 *      produce the token. This is the load-bearing control.
 *   2. EXACT-ALLOWLIST CORS — even holding a token, only the renderer's own
 *      origin can read a response. `Origin: null` is rejected rather than
 *      treated as trusted.
 *   3. HOST VALIDATION — defeats DNS rebinding, where an attacker-controlled
 *      name resolves to 127.0.0.1 and the request therefore looks same-origin
 *      to the browser.
 */

import type { Request, Response, NextFunction } from 'express';
import { extractToken, verifyCapabilityToken, TOKEN_HEADER, TOKEN_QUERY_PARAM } from '../services/capability-token';

/**
 * Hostnames the API will answer to.
 *
 * A request for `evil.example.com` that resolves to 127.0.0.1 carries
 * `Host: evil.example.com`, so rejecting unknown hosts breaks rebinding even
 * though the socket really is loopback.
 */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Origins allowed to READ responses.
 *
 * `file://` (the packaged renderer) sends `Origin: null`, which is NOT in
 * this set on purpose — "null" is also what a sandboxed iframe and several
 * other untrusted contexts send, so it cannot be used to identify the
 * renderer. The packaged renderer does not need it: it talks over IPC, not
 * HTTP (see `electron-ipc-shim.ts`).
 */
function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  // Vite dev server. Only in development — a production build must never
  // accept a dev origin.
  if (process.env.NODE_ENV !== 'production') {
    const devPort = process.env.CODETRELLIS_DEV_ORIGIN_PORT || '5173';
    set.add(`http://localhost:${devPort}`);
    set.add(`http://127.0.0.1:${devPort}`);
  }
  const extra = process.env.CODETRELLIS_EXTRA_ORIGIN;
  if (extra) set.add(extra);
  return set;
}

/** Paths served without a token. Deliberately tiny. */
function isPublicPath(pathname: string): boolean {
  // Liveness only. Returns no data about the user, the machine or any
  // project — it exists so a supervisor can tell the process is up, and so
  // `startServer`'s own port autodetection can probe.
  return pathname === '/api/health';
}

export function localAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  // ── 1. Host validation (DNS rebinding) ──────────────────────────────
  const hostHeader = (req.headers.host || '').toString();
  const hostname = hostHeader.replace(/:\d+$/, '').toLowerCase();
  if (hostname && !ALLOWED_HOSTS.has(hostname)) {
    res.status(403).json({ error: 'Host not allowed' });
    return;
  }

  // ── 2. CORS, exact allowlist ────────────────────────────────────────
  if (origin) {
    if (allowedOrigins().has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else {
      // No ACAO header at all. The browser then refuses to expose the
      // response to the caller even if the request itself went through.
      // `Origin: null` lands here, which is the point.
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    `Content-Type, Authorization, ${TOKEN_HEADER}`,
  );

  // Preflight. Answer only for allowlisted origins — replying 204 to anything
  // tells an attacker the endpoint exists and is happy to be called.
  if (req.method === 'OPTIONS') {
    if (origin && !allowedOrigins().has(origin)) {
      res.status(403).end();
      return;
    }
    res.sendStatus(204);
    return;
  }

  // ── 3. Capability token ─────────────────────────────────────────────
  if (isPublicPath(req.path)) {
    next();
    return;
  }

  const token = extractToken(
    req.headers as Record<string, string | string[] | undefined>,
    req.originalUrl || req.url,
  );

  if (!verifyCapabilityToken(token)) {
    res.status(401).json({
      error: 'Missing or invalid capability token',
      // Tell a legitimate local client how to authenticate. This leaks
      // nothing to a browser: it is the PATH of the token file, not its
      // contents, and anything that can read that path could have read the
      // file without being told.
      hint: `Send the token from <dataDir>/capability-token as the ${TOKEN_HEADER} header, an Authorization: Bearer value, or the ${TOKEN_QUERY_PARAM} query parameter.`,
    });
    return;
  }

  next();
}

/**
 * Same checks for a WebSocket upgrade.
 *
 * Upgrades bypass Express entirely — they arrive on the raw HTTP server's
 * `upgrade` event — so this has to be applied separately or the socket is an
 * unauthenticated way around every control above.
 *
 * Browsers cannot set headers on a WebSocket handshake, so the query
 * parameter is the practical path here.
 */
export function isUpgradeAuthorised(
  headers: Record<string, string | string[] | undefined>,
  url: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  const hostHeader = (headers.host || '').toString();
  const hostname = hostHeader.replace(/:\d+$/, '').toLowerCase();
  if (hostname && !ALLOWED_HOSTS.has(hostname)) {
    return { ok: false, reason: 'Host not allowed' };
  }

  const originRaw = headers.origin;
  const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
  // A WebSocket from a page carries Origin. Absent means a non-browser client
  // (a CLI, the harness), which is allowed through on the strength of its
  // token alone — it could not have obtained one without filesystem access.
  if (origin && !allowedOrigins().has(origin)) {
    return { ok: false, reason: 'Origin not allowed' };
  }

  const token = extractToken(headers, url);
  if (!verifyCapabilityToken(token)) {
    return { ok: false, reason: 'Missing or invalid capability token' };
  }

  return { ok: true };
}
