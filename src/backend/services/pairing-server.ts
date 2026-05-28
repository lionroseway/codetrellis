/**
 * Temporary pairing micro-server — Phase 11 v4 of the CDev target architecture.
 *
 * Opens a short-lived HTTP server on a random port so the mobile phone
 * can exchange full WebRTC SDPs with the desktop over the LAN. The QR
 * code (or typed code) just points the phone to this server — no SDP
 * embedded in the QR itself.
 *
 * Flow:
 *   1. Desktop calls `startPairingServer()` → opens HTTP on random port.
 *   2. QR contains `{v:4, h:<lan-ip>, p:<port>, c:<6-digit-code>}`.
 *   3. Phone scans QR → `GET /offer?c=<code>` → receives full SDP + ICE + nonce.
 *   4. Phone creates answer → `POST /answer` with `{c, answer, ice, fingerprint, nonce}`.
 *   5. Desktop receives answer → resolves promise → both sides establish WebRTC.
 *   6. After WebRTC connects, both derive Bluetooth-style confirmation code
 *      from `hash(nonce + sorted_fingerprints)`.
 *   7. Server auto-closes after one successful exchange or 60 seconds.
 *
 * Only 2 endpoints. CORS enabled for any origin. No auth except the
 * pairing code. Server binds `0.0.0.0` so it's reachable from the LAN.
 */

import http from 'node:http';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';

// --- Constants ---------------------------------------------------------------

const PAIRING_TIMEOUT_MS = 60_000;
const CODE_LENGTH = 6;
const NONCE_BYTES = 16;

// --- Types -------------------------------------------------------------------

export interface PairingServerOpts {
  /** Full WebRTC SDP offer (from `createOffer()`). */
  offerSdp: string;
  /** ICE candidates gathered during offer creation. */
  iceCandidates: string[];
  /** Desktop's DTLS fingerprint. */
  fingerprint: string;
}

export interface PairingServerResult {
  /** 6-digit pairing code. */
  code: string;
  /** LAN IPv4 address the server is bound to. */
  address: string;
  /** Port the server is listening on. */
  port: number;
  /** Random nonce for this pairing session. */
  nonce: string;
  /** Promise that resolves when the phone posts a valid answer. */
  waitForAnswer: () => Promise<PairingAnswer>;
  /** Stop the server early (cancel). */
  stop: () => void;
}

export interface PairingAnswer {
  /** Full answer SDP from the phone. */
  answerSdp: string;
  /** ICE candidates from the phone. */
  iceCandidates: string[];
  /** Phone's DTLS fingerprint. */
  fingerprint: string;
  /** Nonce echoed back (must match). */
  nonce: string;
}

// --- State -------------------------------------------------------------------

let activeServer: http.Server | null = null;
let activeTimeout: ReturnType<typeof setTimeout> | null = null;

// --- Public API --------------------------------------------------------------

/**
 * Start a temporary pairing HTTP server. Returns the pairing code,
 * address, port, and a promise for the phone's answer.
 *
 * Only one pairing server can be active at a time.
 */
export function startPairingServer(opts: PairingServerOpts): Promise<PairingServerResult> {
  // Close any existing server
  stopPairingServer();

  const code = generateCode();
  const nonce = randomBytes(NONCE_BYTES).toString('hex');

  return new Promise<PairingServerResult>((resolveStart, rejectStart) => {
    let answerResolve: ((answer: PairingAnswer) => void) | null = null;
    let answerReject: ((err: Error) => void) | null = null;
    let answered = false;

    const answerPromise = new Promise<PairingAnswer>((res, rej) => {
      answerResolve = res;
      answerReject = rej;
    });

    const server = http.createServer((req, res) => {
      // CORS headers for all responses
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      // GET /offer?c=<code> — phone fetches the desktop's offer
      if (req.method === 'GET' && url.pathname === '/offer') {
        const submittedCode = url.searchParams.get('c');
        if (submittedCode !== code) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid pairing code' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          offer: opts.offerSdp,
          ice: opts.iceCandidates,
          fingerprint: opts.fingerprint,
          nonce,
        }));
        return;
      }

      // POST /answer — phone sends its answer back
      if (req.method === 'POST' && url.pathname === '/answer') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            // Validate pairing code
            if (data.c !== code) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid pairing code' }));
              return;
            }
            // Validate nonce
            if (data.nonce !== nonce) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Nonce mismatch' }));
              return;
            }
            // Validate required fields
            if (!data.answer || !data.fingerprint) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing answer or fingerprint' }));
              return;
            }

            if (answered) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Already answered' }));
              return;
            }
            answered = true;

            // Derive the Bluetooth-style confirmation code that both
            // sides will display. Uses sorted fingerprints so both
            // sides get the same result regardless of who's the offerer.
            const confirmCode = deriveConfirmationCode(
              nonce,
              opts.fingerprint,
              data.fingerprint,
            );

            // Reply to the phone with the confirmation code
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              accepted: true,
              confirmCode,
            }));

            // Cancel the timeout — answer arrived, no longer waiting
            if (activeTimeout) {
              clearTimeout(activeTimeout);
              activeTimeout = null;
            }

            // Resolve the answer promise
            const answer: PairingAnswer = {
              answerSdp: data.answer,
              iceCandidates: data.ice ?? [],
              fingerprint: data.fingerprint,
              nonce: data.nonce,
            };

            answerResolve?.(answer);

            // Auto-close the HTTP server after successful exchange
            // (pairing state is preserved in pairing-service)
            setTimeout(() => stopPairingServer(), 500);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      // 404 for anything else
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.on('error', (err) => {
      console.error('[PairingServer] Error:', err);
      rejectStart(err);
    });

    // Bind to 0.0.0.0 so reachable from LAN, random port
    server.listen(0, '0.0.0.0', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectStart(new Error('Failed to get server address'));
        return;
      }

      activeServer = server;
      const port = addr.port;
      const lanAddress = getLocalIpAddress();

      console.log(`[PairingServer] Listening on ${lanAddress}:${port} (code=${code})`);

      // Auto-close after timeout
      activeTimeout = setTimeout(() => {
        if (!answered) {
          console.log('[PairingServer] Timed out after 60s');
          answerReject?.(new Error('Pairing timed out'));
        }
        stopPairingServer();
      }, PAIRING_TIMEOUT_MS);

      resolveStart({
        code,
        address: lanAddress,
        port,
        nonce,
        waitForAnswer: () => answerPromise,
        stop: () => stopPairingServer(),
      });
    });
  });
}

/**
 * Stop the active pairing server.
 */
export function stopPairingServer(): void {
  if (activeTimeout) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
  if (activeServer) {
    try {
      activeServer.close();
    } catch { /* already closed */ }
    activeServer = null;
    console.log('[PairingServer] Stopped');
  }
}

/**
 * Whether a pairing server is currently running.
 */
export function isPairingServerActive(): boolean {
  return activeServer !== null;
}

// --- Confirmation code -------------------------------------------------------

/**
 * Derive a 6-digit Bluetooth-style confirmation code from the nonce
 * and both fingerprints. Both sides compute the same result because
 * fingerprints are sorted before hashing.
 *
 * This is NOT embedded in the QR — it's displayed AFTER WebRTC
 * connects, so the user can visually confirm both devices are
 * talking to each other (like Bluetooth Secure Simple Pairing).
 */
export function deriveConfirmationCode(
  nonce: string,
  fingerprintA: string,
  fingerprintB: string,
): string {
  const sorted = [fingerprintA, fingerprintB].sort();
  const hash = createHash('sha256')
    .update(`${nonce}:${sorted[0]}:${sorted[1]}`)
    .digest('hex');
  const num = parseInt(hash.slice(0, 8), 16) % 1_000_000;
  return num.toString().padStart(CODE_LENGTH, '0');
}

// --- Helpers -----------------------------------------------------------------

/**
 * Generate a random 6-digit pairing code.
 */
function generateCode(): string {
  const num = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(CODE_LENGTH, '0');
}

/**
 * Get the first non-internal IPv4 address (LAN address).
 * Falls back to 127.0.0.1 if nothing found.
 */
function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}
