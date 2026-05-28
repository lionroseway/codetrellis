/**
 * Minimal SDP reconstruction for zero-port QR pairing (mobile copy).
 *
 * This is a standalone copy of the desktop's `src/shared/lib/sdp-minimal.ts`.
 * The mobile app is a separate Expo project and cannot import from the
 * desktop's workspace. The two implementations MUST produce identical
 * SDPs for the same input.
 */

// --- Types -------------------------------------------------------------------

export interface MinimalSdpParams {
  iu: string;
  ip: string;
  fp: string; // with colons: "AA:BB:CC:..."
  candidateAddr: string;
  candidatePort: number;
}

// --- Reconstruction ----------------------------------------------------------

/**
 * Reconstruct a minimal-but-valid SDP offer from extracted parameters.
 * Includes the ICE candidate inline so react-native-webrtc picks it
 * up from `setRemoteDescription` without a separate `addIceCandidate`.
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
 * Extract minimal SDP parameters from an SDP string (without candidates).
 * Returns iu, ip, fp. Does NOT include candidateAddr/candidatePort —
 * those come from gathered ICE candidates (see `parseBestIceCandidate`).
 */
export function extractSdpParams(sdp: string): Omit<MinimalSdpParams, 'candidateAddr' | 'candidatePort'> | null {
  const iu = sdp.match(/a=ice-ufrag:(\S+)/)?.[1];
  const ip = sdp.match(/a=ice-pwd:(\S+)/)?.[1];
  const fp = sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/)?.[1];

  if (!iu || !ip || !fp) return null;
  return { iu, ip, fp };
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

/**
 * Parse gathered ICE candidates and return the best host candidate.
 * Prefers `host` type, falls back to `srflx`.
 *
 * @param candidates JSON-stringified RTCIceCandidate objects from
 *        react-native-webrtc's `onicecandidate` event.
 */
export function parseBestIceCandidate(
  candidates: string[],
): { addr: string; port: number } | null {
  let fallback: { addr: string; port: number } | null = null;

  for (const raw of candidates) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const line: string = parsed.candidate ?? String(parsed);

      // ICE candidate format:
      // candidate:<foundation> <component> <transport> <priority> <addr> <port> typ <type> ...
      const m = line.match(
        /candidate:\S+\s+\d+\s+udp\s+\d+\s+([\d.]+)\s+(\d+)\s+typ\s+(host|srflx)/i,
      );
      if (m) {
        const [, addr, port, typ] = m;
        if (typ === 'host') return { addr, port: Number(port) };
        if (!fallback) fallback = { addr, port: Number(port) };
      }
    } catch {
      // Skip unparseable candidates
    }
  }
  return fallback;
}

// --- Fingerprint helpers -----------------------------------------------------

export function stripColonFingerprint(fp: string): string {
  return fp.replace(/:/g, '');
}

export function ensureColonFingerprint(fp: string): string {
  if (fp.includes(':')) return fp;
  return fp.match(/.{1,2}/g)?.join(':') ?? fp;
}
