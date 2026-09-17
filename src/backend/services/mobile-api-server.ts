/**
 * Mobile API server — Phase 11 of the CDev target architecture.
 *
 * A lightweight HTTP server bound to `0.0.0.0` on a configurable port
 * (default 19480) so paired mobile devices can reach the desktop over
 * the LAN. Only exposes mobile-specific endpoints (reconnection,
 * status). The main Express server stays on `localhost` for the
 * desktop UI.
 *
 * Port strategy:
 *   - Default port from settings (`device.mobileApiPort`, default 19480).
 *   - If the port is in use, auto-increments up to 10 slots.
 *   - mDNS advertises the actual bound port so the phone discovers it.
 *
 * Endpoints:
 *   POST /api/mobile/auth/challenge   — get a single-use nonce to prove identity
 *   POST /api/mobile/reconnect        — request a fresh WebRTC offer (proof required)
 *   POST /api/mobile/reconnect/answer — submit the WebRTC answer
 *   GET  /api/mobile/status           — health check
 *
 * EVERYTHING HERE IS REACHABLE BY ANYONE WHO CAN ROUTE TO THE MACHINE
 * (Phase 19, findings A3 / 1.2 / 19).
 *
 * The listener no longer starts unless the user turns it on, but when it is on
 * it is on for the whole network. So each handler bounds what an anonymous
 * caller can consume — body size, connection lifetime, request rate — and the
 * reconnect path requires a proof computed with the secret agreed at pairing
 * rather than a `pairingId` the phone broadcasts on every attempt.
 */

import http from 'node:http';
import { getSettings } from './settings-service';
import {
  startReconnection,
  completeReconnection,
  getPeerManagerStatus,
  issueReconnectChallenge,
} from './peer-connection-service';

// --- Limits ------------------------------------------------------------------

/** An answer SDP with inlined ICE is a few KB; 256 KB is generous. */
const MAX_BODY_BYTES = 256 * 1024;

/** A caller that has not finished its request by now is not a phone reconnecting. */
const SOCKET_TIMEOUT_MS = 15_000;

/** Rate limit: requests per source address per window. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;

/** Ceiling on tracked source addresses, so the limiter cannot itself be a leak. */
const RATE_MAX_SOURCES = 1024;

// --- State -------------------------------------------------------------------

let server: http.Server | null = null;
let boundPort = 0;

// --- Public API --------------------------------------------------------------

/**
 * Start the mobile API server. Binds to 0.0.0.0 on the configured
 * port (with auto-fallback if in use). Returns the actual port.
 */
export async function startMobileApiServer(): Promise<number> {
  if (server) {
    return boundPort;
  }

  const settings = getSettings();
  const requestedPort = settings.device.mobileApiPort || 19480;

  return new Promise<number>((resolve, reject) => {
    const tryPort = (candidate: number, attemptsLeft: number) => {
      const srv = http.createServer(handleRequest);

      srv.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          console.log(`[MobileAPI] Port ${candidate} in use, trying ${candidate + 1}…`);
          tryPort(candidate + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      });

      srv.setTimeout(SOCKET_TIMEOUT_MS, (socket) => socket.destroy());
      srv.headersTimeout = SOCKET_TIMEOUT_MS;
      srv.requestTimeout = SOCKET_TIMEOUT_MS;

      srv.listen(candidate, '0.0.0.0', () => {
        server = srv;
        boundPort = candidate;
        console.log(`[MobileAPI] Listening on 0.0.0.0:${candidate}`);
        resolve(candidate);
      });
    };

    tryPort(requestedPort, 10);
  });
}

/**
 * Stop the mobile API server.
 */
export function stopMobileApiServer(): void {
  if (server) {
    try {
      // Same keep-alive caveat as the pairing server: `close()` alone leaves
      // existing sockets being served, so a listener the user just turned OFF
      // would keep answering whoever was already connected.
      server.closeAllConnections?.();
      server.close();
    } catch { /* already closed */ }
    server = null;
    boundPort = 0;
    hits.clear();
    console.log('[MobileAPI] Stopped');
  }
}

/**
 * Get the actual port the mobile API server is bound to.
 * Returns 0 if not running.
 */
export function getMobileApiPort(): number {
  return boundPort;
}

/**
 * Whether the mobile API server is currently running.
 */
export function isMobileApiRunning(): boolean {
  return server !== null;
}

// --- Request handler ---------------------------------------------------------

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // CORS for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (rateLimited(req)) {
    sendJson(res, 429, { error: 'Too many requests' });
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Route
  if (req.method === 'POST' && url.pathname === '/api/mobile/auth/challenge') {
    handleChallenge(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mobile/reconnect') {
    handleReconnect(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mobile/reconnect/answer') {
    handleReconnectAnswer(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/mobile/status') {
    handleStatus(res);
    return;
  }

  // DEBUG ROUTES REMOVED (Phase 19, finding 13).
  //
  // `/api/mobile/debug/peers` disclosed peer connection details and
  // `/api/mobile/debug/test-send` broadcast a message to every connected
  // peer — both unauthenticated, on the server that binds 0.0.0.0.
  //
  // The review asked for these to be removed from production bundles rather
  // than gated on NODE_ENV, on the grounds that a runtime flag is one
  // misconfiguration away from shipping. Deleting them outright is the
  // strongest form of that, and costs nothing: `/api/peers/connections` on
  // the Express API carries the same data behind the capability token, and
  // the test-send helper has no callers anywhere in this repo or in mobile/.
  //
  // If a LAN-side debug hook is ever needed again, it must sit behind the
  // pairing credential, not on the open surface.

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// --- Endpoint handlers -------------------------------------------------------

function handleChallenge(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req).then((data) => {
    const pairingId = typeof data.pairingId === 'string' ? data.pairingId : '';
    if (!pairingId) {
      sendJson(res, 400, { error: 'Missing pairingId' });
      return;
    }
    // Answers for any id, known or not — see `issueReconnectChallenge`.
    sendJson(res, 200, issueReconnectChallenge(pairingId));
  }).catch((err) => failBody(res, err));
}

function handleReconnect(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req).then(async (data) => {
    const pairingId = typeof data.pairingId === 'string' ? data.pairingId : '';
    const nonce = typeof data.nonce === 'string' ? data.nonce : '';
    const mac = typeof data.mac === 'string' ? data.mac : '';
    const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : 0;

    // The `fingerprint` fallback is gone (Phase 19, finding 1.2). It let a
    // caller skip the pairingId entirely, and it was never going to be
    // retired on its own — it existed to upgrade clients silently, so the
    // weaker path stayed open for everyone indefinitely.
    if (!pairingId || !nonce || !mac || !expiresAt) {
      sendJson(res, 400, { error: 'Missing pairingId or challenge response' });
      return;
    }

    const result = await startReconnection(pairingId, { nonce, expiresAt, mac });
    if (!result) {
      // One answer for every failure: unknown device, no stored secret, bad
      // proof, expired or replayed nonce. Distinguishing them tells an
      // anonymous caller which pairing ids are real.
      sendJson(res, 403, { error: 'Reconnection refused' });
      return;
    }

    sendJson(res, 200, {
      offer: result.offer,
      ice: result.iceCandidates,
      fingerprint: result.fingerprint,
      pairingId: result.pairingId,
      // Consumed with the answer, so a captured proof is worth one use.
      answerNonce: result.answerNonce,
      // Lets the phone verify it is talking to the desktop it paired with,
      // without depending on a certificate that changes every restart.
      offerMac: result.offerMac,
    });
  }).catch((err) => failBody(res, err));
}

function handleReconnectAnswer(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req).then(async (data) => {
    const pairingId = typeof data.pairingId === 'string' ? data.pairingId : '';
    const answer = typeof data.answer === 'string' ? data.answer : '';
    const fingerprint = typeof data.fingerprint === 'string' ? data.fingerprint : '';
    const ice = Array.isArray(data.ice) ? (data.ice as string[]) : [];
    const mac = typeof data.mac === 'string' ? data.mac : '';

    if (!pairingId || !answer) {
      sendJson(res, 400, { error: 'Missing pairingId or answer' });
      return;
    }

    const success = await completeReconnection(pairingId, answer, ice, fingerprint, mac);
    if (!success) {
      sendJson(res, 403, { error: 'Reconnection refused' });
      return;
    }

    sendJson(res, 200, { connected: true });
  }).catch((err) => failBody(res, err));
}

function handleStatus(res: http.ServerResponse): void {
  try {
    const status = getPeerManagerStatus();
    const settings = getSettings();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      deviceName: settings.device.deviceName || require('node:os').hostname(),
      port: boundPort,
      ...status,
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

// --- Request plumbing --------------------------------------------------------

/**
 * Read a JSON body with a hard ceiling.
 *
 * The handlers used to do `body += chunk` with no limit, on a server bound to
 * every interface — an anonymous caller could make the process buffer as much
 * as it cared to send. An oversized request is destroyed rather than answered:
 * a caller doing this is not waiting for a reply, and the point is to stop
 * receiving.
 */
function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new BadJson());
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new BadJson());
      }
    });
    req.on('error', reject);
  });
}

class BodyTooLarge extends Error { readonly status = 413; }
class BadJson extends Error { readonly status = 400; }

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function failBody(res: http.ServerResponse, err: unknown): void {
  if (err instanceof BodyTooLarge) return sendJson(res, 413, { error: 'Request body too large' });
  if (err instanceof BadJson) return sendJson(res, 400, { error: 'Invalid JSON' });
  console.warn('[MobileAPI] Request failed:', err);
  // Deliberately opaque. This surface is anonymous and on the network; an
  // internal error message is free reconnaissance.
  sendJson(res, 500, { error: 'Request failed' });
}

// --- Rate limiting -----------------------------------------------------------

const hits = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed-window counter per source address.
 *
 * Crude on purpose. It is not trying to be fair between clients — it is
 * putting a ceiling on how fast an anonymous caller can drive the endpoints
 * that create WebRTC offers and issue challenges, neither of which is free.
 */
function rateLimited(req: http.IncomingMessage, now = Date.now()): boolean {
  const source = req.socket.remoteAddress ?? 'unknown';
  const entry = hits.get(source);

  if (!entry || entry.resetAt <= now) {
    if (hits.size >= RATE_MAX_SOURCES) {
      for (const [key, value] of hits) if (value.resetAt <= now) hits.delete(key);
      if (hits.size >= RATE_MAX_SOURCES) {
        const oldest = hits.keys().next();
        if (!oldest.done) hits.delete(oldest.value);
      }
    }
    hits.set(source, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  if (entry.count > RATE_MAX_REQUESTS) {
    if (entry.count === RATE_MAX_REQUESTS + 1) {
      console.warn(`[MobileAPI] Rate limiting ${source} — ${entry.count} requests in the window`);
    }
    return true;
  }
  return false;
}

/** Test seam. */
export function resetMobileApiRateLimit(): void {
  hits.clear();
}
