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
 *   3. Phone scans QR → `POST /offer` with `{c}` → receives full SDP + ICE + nonce.
 *      Served EXACTLY ONCE, so the first caller wins and the loser fails
 *      immediately rather than reaching a confirmation step that cannot match.
 *   4. Phone creates answer → `POST /answer` with `{c, answer, ice, fingerprint, nonce}`.
 *   5. Desktop receives answer → resolves promise → both sides establish WebRTC.
 *   6. After WebRTC connects, both derive Bluetooth-style confirmation code
 *      from `hash(nonce + sorted_fingerprints)`.
 *   7. Server auto-closes after one successful exchange or 60 seconds.
 *
 * Only 2 endpoints. The pairing code is the only credential, and the server
 * binds `0.0.0.0` so it is reachable from the LAN — which is why the window is
 * 60 seconds, wrong codes are counted, and bodies are capped (Phase 19,
 * findings 19 and 1.2).
 *
 * WHAT THIS NO LONGER DOES
 *
 * It used to compute the confirmation code and send it to the phone, which
 * displayed the number it was given. The user then compared the desktop's
 * number against the desktop's number — a relay in the middle supplies both,
 * so the comparison confirmed nothing. Each side derives it independently now;
 * this server does not send it.
 */

import http from 'node:http';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { generateSharedSecret, deriveConfirmationCode } from './peer-auth';
import { extractSingleFingerprint, fingerprintsEqual } from '../../shared/lib/sdp-fingerprint';
import { extractSdpParams, type MinimalSdpParams } from '../../shared/lib/sdp-minimal';
import { computeAnswerMac, macsEqual } from './peer-auth';

// --- Constants ---------------------------------------------------------------

const PAIRING_TIMEOUT_MS = 60_000;
const CODE_LENGTH = 6;
const NONCE_BYTES = 16;

/**
 * An answer SDP with inlined ICE runs to a few KB. 256 KB is generous and
 * still bounds what an unauthenticated LAN caller can make the process buffer
 * — the handler used to concatenate chunks with no limit at all.
 */
const MAX_BODY_BYTES = 256 * 1024;

/** A client that has not finished its request by now is not pairing. */
const SOCKET_TIMEOUT_MS = 15_000;

/**
 * Wrong pairing codes tolerated before the server closes.
 *
 * The code is six digits and the window is 60 seconds, so an unthrottled
 * attacker on the LAN could cover a meaningful slice of the space. Five
 * attempts makes guessing hopeless while leaving room for a genuine typo on
 * the manual-entry path (finding 19).
 */
const MAX_CODE_ATTEMPTS = 5;

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
  /** Primary IPv4 address (first reachable; kept for back-compat). */
  address: string;
  /** All reachable IPv4 addresses (LAN + Tailscale/VPN), so the phone can
   *  try each — this is what lets a pairing made on LAN also work over a VPN. */
  addresses: string[];
  /** Port the server is listening on. */
  port: number;
  /** Random nonce for this pairing session. */
  nonce: string;
  /** Stable pairing identity — survives app restarts. */
  pairingId: string;
  /**
   * The desktop's WebRTC parameters, for the QR.
   *
   * These go OUT OF BAND so the phone never has to fetch them over plaintext
   * HTTP (Phase 19, finding 18).
   */
  sdpParams: MinimalSdpParams;
  /**
   * Pairing secret for later reconnect authentication (hex).
   *
   * Generated here but NEVER served by this server: it goes to the phone over
   * the DTLS-protected `control` channel once WebRTC is up. Anything this
   * server sends is plaintext on the LAN. See `peer-auth.ts`.
   */
  sharedSecret: string;
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
  /** Stable pairing identity echoed back from the offer. */
  pairingId: string;
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
  const pairingId = randomUUID();
  const sharedSecret = generateSharedSecret();

  // Fail here, loudly, rather than shipping a QR the phone cannot use.
  const sdpParams = extractSdpParams(opts.offerSdp, opts.iceCandidates);

  return new Promise<PairingServerResult>((resolveStart, rejectStart) => {
    let answerResolve: ((answer: PairingAnswer) => void) | null = null;
    let answerReject: ((err: Error) => void) | null = null;
    let answered = false;
    let codeAttempts = 0;
    /**
     * Source address of the client that took the offer, or null if nobody has.
     *
     * Only the holder may post the answer. This is DEPTH, not a boundary: an
     * attacker who can read the exchange can also complete it, which is the
     * part that needs encryption rather than bookkeeping (finding 18, and see
     * the pairing-v5 work). What it does stop is a caller that can INJECT but
     * not read — one that learned the code some other way and skipped
     * straight to posting an answer.
     */
    let offerClaimedBy: string | null = null;

    const answerPromise = new Promise<PairingAnswer>((res, rej) => {
      answerResolve = res;
      answerReject = rej;
    });

    /**
     * Count a wrong pairing code, and close the window once there have been
     * too many. Without this, the 60-second window is a free run at a
     * six-digit space for anyone on the network (finding 19).
     */
    const noteBadCode = (): void => {
      codeAttempts += 1;
      if (codeAttempts >= MAX_CODE_ATTEMPTS) {
        console.warn(`[PairingServer] ${codeAttempts} wrong pairing codes — closing the window`);
        answerReject?.(new Error('Too many incorrect pairing codes'));
        stopPairingServer();
      }
    };

    /**
     * Read a request body with a hard ceiling.
     *
     * The previous handler did `body += chunk` with no limit, on a server
     * bound to every interface. `req.destroy()` rather than a 413 reply: a
     * caller sending an oversized body is not going to read the response, and
     * continuing to receive it is the thing being avoided.
     */
    const readBody = (req: http.IncomingMessage): Promise<string> =>
      new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', (chunk: Buffer | string) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY_BYTES) {
            reject(new Error('Request body too large'));
            req.destroy();
            return;
          }
          body += chunk;
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
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

      // POST /offer — phone fetches the desktop's offer
      //
      // A POST, not a GET, because the pairing code used to travel as
      // `?c=123456` (Phase 19, finding 18). A query string is the worst place
      // to put a short-lived secret: it is written to access logs, kept in
      // proxy and history records, and forwarded in `Referer`. None of those
      // are hypothetical on a corporate network with a transparent proxy.
      if (req.method === 'POST' && url.pathname === '/offer') {
        readBody(req).then((body) => {
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }

          if (data.c !== code) {
            noteBadCode();
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid pairing code' }));
            return;
          }

          // SERVED EXACTLY ONCE (finding 18).
          //
          // Anyone who watched the exchange knows the code, so the code alone
          // cannot decide who is allowed to pair. Making the offer one-shot
          // turns that race into first-one-wins with a clear loser: if an
          // attacker gets in first, the phone's own fetch fails immediately
          // and the user sees pairing fail, instead of reaching the
          // confirmation step and being asked to compare numbers that will
          // not match.
          //
          // The phone races several addresses at once, so refusing the later
          // ones is normal and expected — `Promise.any` on that side takes
          // whichever succeeded.
          //
          // The same client may ask again: if its response was lost in
          // transit, the QR it just scanned would otherwise be dead and the
          // user would have to restart pairing on the desktop to find out
          // why. A DIFFERENT client is refused.
          const source = req.socket.remoteAddress ?? 'unknown';
          if (offerClaimedBy !== null && offerClaimedBy !== source) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Offer already claimed' }));
            return;
          }
          offerClaimedBy = source;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            offer: opts.offerSdp,
            ice: opts.iceCandidates,
            fingerprint: opts.fingerprint,
            nonce,
            pairingId,
          }));
        }).catch((err: Error) => {
          console.warn(`[PairingServer] Rejected offer request: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large' }));
          }
        });
        return;
      }

      // POST /answer — phone sends its answer back
      if (req.method === 'POST' && url.pathname === '/answer') {
        readBody(req).then((body) => {
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }

          // Validate pairing code
          // THE CODE IS NOT SENT (Phase 19, finding 18).
          //
          // It used to be in this body verbatim, so an observer on the network
          // read it off the wire. The phone proves it saw the QR by signing
          // the nonce and its own fingerprint with the code instead.
          //
          // Six digits is a weak key and an observer can recover it offline in
          // milliseconds — but only AFTER this request, by which point the
          // offer is claimed and the session is answered. What it buys is that
          // the code is not simply readable in flight.
          if (typeof data.fingerprint !== 'string' || typeof data.mac !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing fingerprint or mac' }));
            return;
          }
          if (!macsEqual(computeAnswerMac(code, nonce, data.fingerprint), data.mac)) {
            noteBadCode();
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
          if (typeof data.answer !== 'string' || typeof data.fingerprint !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing answer or fingerprint' }));
            return;
          }

          if (answered) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Already answered' }));
            return;
          }

          // If someone took the offer, only they may answer it.
          //
          // On the QR path NOBODY takes it — the phone rebuilds the offer from
          // the QR and fetches nothing, which is the point of v5. There the
          // MAC above is the check, and it is the stronger of the two: it
          // proves the sender saw the QR, where an address proves only that
          // packets came from somewhere.
          //
          // The binding still applies to the manual-entry path, which does
          // fetch.
          const source = req.socket.remoteAddress ?? 'unknown';
          if (offerClaimedBy !== null && source !== offerClaimedBy) {
            console.warn(`[PairingServer] Rejected answer from ${source} — the offer was claimed by another client`);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not the client that requested the offer' }));
            return;
          }

          // THE IDENTITY COMES FROM THE SDP, NOT THE `fingerprint` FIELD
          // (Phase 19, finding 2).
          //
          // The body field was taken at face value and became the paired
          // device's stored identity — so whatever a caller claimed here is
          // what every later reconnect would be checked against. It is now
          // read structurally from the answer SDP, which the DTLS handshake
          // is verified against, and the claimed value is only used to catch
          // a client disagreeing with itself.
          let sdpFingerprint: string;
          try {
            sdpFingerprint = extractSingleFingerprint(data.answer);
          } catch (err) {
            console.warn(`[PairingServer] Rejected answer — unusable SDP: ${(err as Error).message}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Answer SDP does not commit to a single certificate' }));
            return;
          }

          if (!fingerprintsEqual(sdpFingerprint, data.fingerprint)) {
            console.warn('[PairingServer] Rejected answer — claimed fingerprint disagrees with the SDP');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Claimed fingerprint does not match the answer SDP' }));
            return;
          }

          answered = true;

          // NO CONFIRMATION CODE IN THIS RESPONSE (Phase 19, finding 1.2).
          //
          // It used to be computed here and sent back, and the phone showed
          // whatever arrived. The user was then asked to compare the desktop's
          // number with the desktop's number, which a relay in the middle
          // would happily supply to both screens. The phone derives its own
          // now, from the fingerprint in the offer SDP it actually received
          // and its own certificate — so a relay makes the numbers differ.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true, pairingId }));

          // Cancel the timeout — answer arrived, no longer waiting
          if (activeTimeout) {
            clearTimeout(activeTimeout);
            activeTimeout = null;
          }

          const answer: PairingAnswer = {
            answerSdp: data.answer,
            iceCandidates: Array.isArray(data.ice) ? (data.ice as string[]) : [],
            fingerprint: sdpFingerprint,
            nonce: String(data.nonce),
            pairingId,
          };

          answerResolve?.(answer);

          // Auto-close the HTTP server after successful exchange
          // (pairing state is preserved in pairing-service)
          setTimeout(() => stopPairingServer(), 500);
        }).catch((err: Error) => {
          console.warn(`[PairingServer] Rejected answer body: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large' }));
          }
        });
        return;
      }

      // 404 for anything else
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    // A LAN-reachable server must not hold sockets open for a client that
    // opens a connection and then says nothing.
    server.setTimeout(SOCKET_TIMEOUT_MS, (socket) => socket.destroy());
    server.headersTimeout = SOCKET_TIMEOUT_MS;
    server.requestTimeout = SOCKET_TIMEOUT_MS;

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
      const addresses = getAllAddresses();
      const lanAddress = addresses[0] ?? '127.0.0.1';

      console.log(`[PairingServer] Listening on ${addresses.join(', ') || lanAddress}:${port} (code=${code})`);

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
        addresses,
        port,
        nonce,
        pairingId,
        sdpParams,
        sharedSecret,
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
      // `close()` only stops NEW connections. A client using keep-alive — which
      // `fetch` does by default — keeps its existing socket and carries on
      // being served, so closing after too many wrong codes would not actually
      // shut the window (Phase 19, finding 19). Drop the sockets too.
      activeServer.closeAllConnections?.();
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
 * Re-exported so existing importers keep working. The implementation moved to
 * `peer-auth.ts`, alongside the mobile mirror it has to agree with — keeping
 * it here, in a file about an HTTP server, is how the two drifted into the
 * desktop computing the code and the phone merely displaying it.
 */
export { deriveConfirmationCode };

// --- Helpers -----------------------------------------------------------------

/**
 * Generate a random 6-digit pairing code.
 */
function generateCode(): string {
  const num = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(CODE_LENGTH, '0');
}

/**
 * All non-internal IPv4 addresses this host is reachable on, ordered:
 * regular LAN (192.168/10/172.16) first, then CGNAT/Tailscale (100.64.0.0/10),
 * then anything else. The phone races these when pairing/reconnecting, so a
 * pairing made on the LAN also works later over a VPN like Tailscale.
 */
export function getAllAddresses(): string[] {
  const out: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const addr of interfaces[name] ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  const rank = (ip: string): number => {
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return 0; // LAN
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 1;     // CGNAT / Tailscale
    return 2;                                                              // other / public
  };
  return out.sort((a, b) => rank(a) - rank(b));
}

