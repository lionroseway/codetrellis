/**
 * Minimal SDP extraction and reconstruction for QR-carried pairing.
 *
 * MOBILE COPY — a standalone mirror of the desktop's
 * `src/shared/lib/sdp-minimal.ts`. The Expo project cannot import from that
 * workspace. The desktop's `mobile-desktop-parity.test.ts` runs both over the
 * same inputs, because a divergence here would show up as a pairing that
 * silently fails to connect rather than as anything that looks like a bug.
 *
 * WHY THIS EXISTS (Phase 19, finding 18)
 *
 * The pairing handshake crosses the LAN as plaintext HTTP. Anything the phone
 * FETCHES over it is readable by anyone on that network for the sixty seconds
 * the window is open, and anything it fetches is also something an attacker
 * could have substituted.
 *
 * A QR code is a trusted out-of-band channel: the user is looking at their own
 * desktop's screen. So the desktop's connection parameters — including the
 * DTLS fingerprint that authenticates it — travel by QR, and the phone
 * rebuilds the offer locally. Nothing is fetched, so nothing is exposed.
 *
 * What still crosses the wire is the phone's ANSWER, which contains its own
 * fingerprint and ICE credentials. Those are not secrets: every DTLS handshake
 * publishes them, and holding them without the matching private key is worth
 * nothing. An attacker who substitutes the answer pairs the desktop with
 * themselves — and is caught, because the confirmation code each device
 * derives then disagrees.
 *
 * HISTORY WORTH KNOWING
 *
 * This was the v3 pairing design. v4 replaced it with a fetch because the QR
 * was getting large, and the files were left behind unused. The QR is bigger
 * again now — around 200 bytes, a version-9 code at error correction L — which
 * scans fine at the size the pairing dialog renders. The reason it was dropped
 * is worth remembering, not repeating: keep an eye on the payload size.
 */

import { extractSingleFingerprint } from './sdp-fingerprint';

export interface MinimalSdpParams {
  /** ICE ufrag. */
  iu: string;
  /** ICE pwd. */
  ip: string;
  /** DTLS fingerprint (sha-256, with colons: "AA:BB:CC:..."). */
  fp: string;
  /**
   * Every address the peer is reachable on, not just one.
   *
   * A desktop on a LAN and a VPN has a candidate per interface, and dropping
   * all but one is what would make a pairing work at a desk and fail over
   * Tailscale — the exact case the address list exists to serve.
   */
  candidateAddrs: string[];
  /**
   * The UDP port the candidates share.
   *
   * werift gathers from a single socket, so every host candidate has the same
   * port. Asserted during extraction rather than assumed.
   */
  candidatePort: number;
  /**
   * `a=max-message-size` from the real offer.
   *
   * EXTRACTED, NOT GUESSED. The v3 template hardcoded 262144 while werift
   * actually advertises 65536 — a four-fold disagreement that would surface
   * only as large payloads (a UI snapshot, terminal scrollback) going missing
   * on a link that otherwise looked healthy.
   */
  maxMessageSize: number;
}

// --- Extraction --------------------------------------------------------------

/** Pull an ICE candidate line out of whatever shape it arrived in. */
function candidateLine(raw: unknown): string {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed?.candidate ?? raw;
    } catch {
      return raw;
    }
  }
  return (raw as { candidate?: string })?.candidate ?? String(raw);
}

const CANDIDATE_RE =
  /candidate:\S+\s+\d+\s+udp\s+\d+\s+([\d.]+)\s+(\d+)\s+typ\s+(host|srflx)/i;

/**
 * Extract minimal SDP parameters from a full SDP and its gathered candidates.
 * Throws if anything essential is missing or inconsistent.
 */
export function extractSdpParams(
  sdp: string,
  iceCandidates: string[] = [],
): MinimalSdpParams {
  const iu = sdp.match(/a=ice-ufrag:(\S+)/)?.[1];
  const ip = sdp.match(/a=ice-pwd:(\S+)/)?.[1];
  // STRUCTURAL, not a regex (Phase 19, finding 2). A regex returns the FIRST
  // match anywhere in the document, so a peer could prepend a victim's
  // fingerprint as an extra session-level attribute and have this function
  // report an identity it does not hold.
  const fp = extractSingleFingerprint(sdp);

  if (!iu) throw new Error('SDP missing ice-ufrag');
  if (!ip) throw new Error('SDP missing ice-pwd');

  // Gather from both places candidates can appear: the separately-emitted
  // list, and inlined in the SDP. A host candidate beats a reflexive one, but
  // a reflexive one is better than nothing on a machine behind a NAT.
  const hosts = new Map<string, number>();
  const reflexive = new Map<string, number>();

  const consider = (line: string) => {
    const m = CANDIDATE_RE.exec(line);
    if (!m) return;
    const [, addr, port, typ] = m;
    (typ.toLowerCase() === 'host' ? hosts : reflexive).set(addr, Number(port));
  };

  for (const raw of iceCandidates) consider(candidateLine(raw));
  for (const m of sdp.matchAll(/^a=candidate:.*$/gm)) consider(m[0]);

  const chosen = hosts.size > 0 ? hosts : reflexive;
  if (chosen.size === 0) throw new Error('No usable ICE candidate found');

  const ports = new Set(chosen.values());
  if (ports.size > 1) {
    // Carrying one port per address would grow the QR and has never been
    // needed — werift gathers from a single socket. If this ever throws, the
    // payload needs a port list, not a silently-dropped candidate.
    throw new Error(
      `ICE candidates span ${ports.size} ports (${[...ports].join(', ')}); ` +
      'the compact payload assumes one',
    );
  }

  const maxMessageSize = Number(sdp.match(/a=max-message-size:(\d+)/)?.[1] ?? 65536);

  return {
    iu,
    ip,
    fp,
    candidateAddrs: [...chosen.keys()],
    candidatePort: [...ports][0],
    maxMessageSize,
  };
}

// --- Reconstruction ----------------------------------------------------------

function buildSdp(params: MinimalSdpParams, setup: 'actpass' | 'active'): string {
  const fp = ensureColonFingerprint(params.fp);
  return [
    'v=0',
    'o=- 0 0 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${params.iu}`,
    `a=ice-pwd:${params.ip}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    `a=max-message-size:${params.maxMessageSize}`,
    // One line per interface, so a pairing made at a desk still connects over
    // a VPN. Priority descends with index purely so the order is stable.
    ...params.candidateAddrs.map(
      (addr, i) =>
        `a=candidate:${i + 1} 1 udp ${2113937151 - i} ${addr} ${params.candidatePort} typ host generation 0`,
    ),
    // Without this the peer waits for candidates that will never arrive and
    // pays a gathering timeout before it gives up.
    'a=end-of-candidates',
    '',
  ].join('\r\n');
}

/** Rebuild the offerer's SDP. */
export function reconstructOfferSdp(params: MinimalSdpParams): string {
  return buildSdp(params, 'actpass');
}

/** Rebuild the answerer's SDP. */
export function reconstructAnswerSdp(params: MinimalSdpParams): string {
  return buildSdp(params, 'active');
}

// --- Fingerprint helpers -----------------------------------------------------

/** "AA:BB:CC" → "AABBCC", for compact QR encoding. */
export function stripColonFingerprint(fp: string): string {
  return fp.replace(/:/g, '');
}

/** "AABBCC" → "AA:BB:CC". Leaves an already-colonised value alone. */
export function ensureColonFingerprint(fp: string): string {
  if (fp.includes(':')) return fp;
  return fp.match(/.{1,2}/g)?.join(':') ?? fp;
}
