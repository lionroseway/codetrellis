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
 *   POST /api/mobile/reconnect       — request a fresh WebRTC offer
 *   POST /api/mobile/reconnect/answer — submit the WebRTC answer
 *   GET  /api/mobile/status           — health check + desktop info
 */

import http from 'node:http';
import { getSettings } from './settings-service';
import {
  startReconnection,
  completeReconnection,
  getPeerManagerStatus,
  getThisInstanceId,
} from './peer-connection-service';
import {
  getPeerConnections,
  broadcastToAllPeers,
} from './webrtc-service';
import { DATA_CHANNELS } from '../../shared/types';

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
    try { server.close(); } catch { /* already closed */ }
    server = null;
    boundPort = 0;
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

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Route
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

  // Debug: peer connection details including channel states
  if (req.method === 'GET' && url.pathname === '/api/mobile/debug/peers') {
    handleDebugPeers(res);
    return;
  }

  // Debug: force-send a test snapshot to all connected peers
  if (req.method === 'POST' && url.pathname === '/api/mobile/debug/test-send') {
    handleTestSend(res);
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// --- Endpoint handlers -------------------------------------------------------

function handleReconnect(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { pairingId, fingerprint } = data;

      // Accept pairingId (preferred) or fingerprint (fallback for upgrade)
      if (!pairingId && !fingerprint) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing pairingId or fingerprint' }));
        return;
      }

      const result = await startReconnection(pairingId, fingerprint);
      if (!result) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Device not paired or unknown' }));
        return;
      }

      // Always return pairingId so pre-upgrade clients can store it
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        offer: result.offer,
        ice: result.iceCandidates,
        fingerprint: result.fingerprint,
        pairingId: result.pairingId,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
}

function handleReconnectAnswer(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { pairingId, fingerprint, answer, ice } = data;

      if (!pairingId || !answer) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing pairingId or answer' }));
        return;
      }

      const success = await completeReconnection(
        pairingId,
        answer,
        ice ?? [],
        fingerprint ?? '',
      );

      if (!success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Reconnection failed or no pending offer' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
}

function handleDebugPeers(res: http.ServerResponse): void {
  try {
    const peers = getPeerConnections();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ peers }, null, 2));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

function handleTestSend(res: http.ServerResponse): void {
  try {
    const testSnapshot = {
      type: 'snapshot',
      snapshot: {
        agents: [],
        plans: [],
        channelEvents: [],
        presence: [],
        audio: { active: false },
        ts: Date.now(),
      },
      ts: Date.now(),
      sourceInstanceId: getThisInstanceId(),
    };
    const sent = broadcastToAllPeers(
      DATA_CHANNELS.UI,
      JSON.stringify(testSnapshot),
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sent, message: `Broadcast to ${sent} peers` }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
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
