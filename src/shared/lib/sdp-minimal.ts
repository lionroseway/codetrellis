/**
 * Minimal SDP extraction / reconstruction for zero-port QR pairing.
 *
 * The pairing flow encodes only the essential WebRTC parameters in a
 * QR code (~190 bytes) instead of the full SDP (~600+ bytes). Both
 * sides reconstruct valid-but-minimal SDPs from these parameters.
 *
 * Used by:
 *   - Desktop backend: extract params from werift's SDP for the offer QR
 *   - Desktop backend: reconstruct answer SDP from the scanned answer QR
 *
 * The mobile app has its own copy of the reconstruction logic
 * (`mobile/lib/sdp-minimal.ts`) because it's a standalone Expo project.
 * The two implementations MUST produce identical SDPs for the same input.
 */

// --- Types -------------------------------------------------------------------

export interface MinimalSdpParams {
  /** ICE ufrag. */
  iu: string;
  /** ICE pwd. */
  ip: string;
  /** DTLS fingerprint (sha-256, with colons: "AA:BB:CC:..."). */
  fp: string;
  /** Best ICE candidate address (LAN IPv4). */
  candidateAddr: string;
  /** Best ICE candidate port. */
  candidatePort: number;
}

// --- Extraction --------------------------------------------------------------

/**
 * Extract minimal SDP parameters from a full SDP string and its
 * gathered ICE candidates. Throws if essential fields are missing.
 */
export function extractSdpParams(
  sdp: string,
  iceCandidates: string[],
): MinimalSdpParams {
  const iu = sdp.match(/a=ice-ufrag:(\S+)/)?.[1];
  const ip = sdp.match(/a=ice-pwd:(\S+)/)?.[1];
  const fp = sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/)?.[1];

  if (!iu) throw new Error('SDP missing ice-ufrag');
  if (!ip) throw new Error('SDP missing ice-pwd');
  if (!fp) throw new Error('SDP missing fingerprint');

  // Find the best host (or srflx) candidate
  let candidateAddr = '';
  let candidatePort = 0;

  for (const raw of iceCandidates) {
    try {
      // werift emits candidates as JSON-serialised RTCIceCandidate objects
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const line: string = parsed.candidate ?? parsed;

      // ICE candidate line format:
      // candidate:<foundation> <component> <transport> <priority> <addr> <port> typ <type> ...
      const m = line.match(
        /candidate:\S+\s+\d+\s+udp\s+\d+\s+([\d.]+)\s+(\d+)\s+typ\s+(host|srflx)/i,
      );
      if (m) {
        const [, addr, port, typ] = m;
        // Prefer host candidates; fall back to srflx
        if (typ === 'host' || !candidateAddr) {
          candidateAddr = addr;
          candidatePort = Number(port);
          if (typ === 'host') break; // host is best, stop looking
        }
      }
    } catch {
      // Skip unparseable candidates
    }
  }

  // Fallback: try extracting a candidate from the SDP itself
  if (!candidateAddr) {
    const sdpCandidate = sdp.match(
      /a=candidate:\S+\s+\d+\s+udp\s+\d+\s+([\d.]+)\s+(\d+)\s+typ\s+(host|srflx)/i,
    );
    if (sdpCandidate) {
      candidateAddr = sdpCandidate[1];
      candidatePort = Number(sdpCandidate[2]);
    }
  }

  if (!candidateAddr) {
    throw new Error('No usable ICE candidate found');
  }

  return { iu, ip, fp, candidateAddr, candidatePort };
}

// --- Reconstruction ----------------------------------------------------------

/**
 * Reconstruct a minimal-but-valid SDP offer from extracted parameters.
 * The offer uses `a=setup:actpass` (standard for the offerer).
 *
 * Includes the ICE candidate inline so WebRTC implementations (werift,
 * react-native-webrtc) pick it up from `setRemoteDescription` without
 * needing an explicit `addIceCandidate` call.
 */
export function reconstructOfferSdp(params: MinimalSdpParams): string {
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
    `a=fingerprint:sha-256 ${fp}`,
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    `a=candidate:1 1 udp 2113937151 ${params.candidateAddr} ${params.candidatePort} typ host generation 0`,
    '',
  ].join('\r\n');
}

/**
 * Reconstruct a minimal-but-valid SDP answer from extracted parameters.
 * The answer uses `a=setup:active` (standard for the answerer).
 *
 * Includes the ICE candidate inline (see `reconstructOfferSdp` for why).
 */
export function reconstructAnswerSdp(params: MinimalSdpParams): string {
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
    `a=fingerprint:sha-256 ${fp}`,
    'a=setup:active',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    `a=candidate:1 1 udp 2113937151 ${params.candidateAddr} ${params.candidatePort} typ host generation 0`,
    '',
  ].join('\r\n');
}

/**
 * Format an ICE candidate init object from an address and port.
 * Returns a standard `RTCIceCandidateInit`-shaped object.
 */
export function formatIceCandidate(
  addr: string,
  port: number,
): { candidate: string; sdpMid: string; sdpMLineIndex: number } {
  return {
    candidate: `candidate:1 1 udp 2113937151 ${addr} ${port} typ host generation 0`,
    sdpMid: '0',
    sdpMLineIndex: 0,
  };
}

// --- Fingerprint helpers -----------------------------------------------------

/**
 * Strip colons from a sha-256 fingerprint for compact QR encoding.
 * "AA:BB:CC" → "AABBCC"
 */
export function stripColonFingerprint(fp: string): string {
  return fp.replace(/:/g, '');
}

/**
 * Re-insert colons into a hex fingerprint.
 * "AABBCC" → "AA:BB:CC"
 */
export function ensureColonFingerprint(fp: string): string {
  if (fp.includes(':')) return fp; // already has colons
  return fp.match(/.{1,2}/g)?.join(':') ?? fp;
}
