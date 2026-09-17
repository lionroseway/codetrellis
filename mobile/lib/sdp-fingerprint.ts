/**
 * Structural extraction of the DTLS fingerprint from an SDP offer or answer.
 *
 * MOBILE COPY — a standalone mirror of the desktop's
 * `src/shared/lib/sdp-fingerprint.ts`. The Expo project cannot import from the
 * desktop workspace, the same arrangement as `sdp-minimal.ts`. The desktop's
 * `tests/e2e/mobile-desktop-parity.test.ts` runs both files over the same
 * inputs so they cannot drift apart.
 *
 * The phone needs this for the reverse direction of finding 2: the desktop
 * checks the phone's certificate against the paired record, and the phone must
 * check the DESKTOP's the same way. Doing it with a regex here would leave the
 * phone connectable to anyone who could prepend an attribute — the identical
 * defect, aimed the other way.
 *
 * THE ATTACK THIS EXISTS TO STOP (Phase 19, finding 2)
 *
 * The previous implementation was one regex:
 *
 *     sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/)?.[1]
 *
 * A regex takes the FIRST match anywhere in the document. SDP is a sectioned
 * format — a session part, then one or more `m=` media parts — and an
 * attribute may legitimately appear in either. So a peer holding a different
 * DTLS certificate could simply prepend the victim's fingerprint as an extra
 * session-level attribute: the regex returned the value the attacker chose,
 * while the handshake proceeded with the attacker's real certificate.
 *
 * The reviewer demonstrated exactly this against a live handshake — a peer
 * with a different certificate inserted the stored fingerprint, and every
 * data channel opened.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Splits the SDP into its sections, collects every fingerprint with the
 * section it came from, and refuses anything ambiguous:
 *
 *   - more than one DISTINCT fingerprint value, anywhere;
 *   - a media-level fingerprint that disagrees with the session-level one
 *     (RFC 8122 permits media-level to override, which is precisely why it
 *     must not be accepted silently here);
 *   - duplicate session-level attributes;
 *   - a fingerprint that is not well-formed sha-256.
 *
 * An SDP that a legitimate implementation produces has one fingerprint, or
 * the same one repeated. Anything else is refused rather than resolved — a
 * parser that picks a winner is a parser an attacker gets to aim.
 *
 * THIS IS NOT AUTHENTICATION ON ITS OWN
 *
 * It establishes what the SDP CLAIMS, unambiguously. What the peer actually
 * proved is the certificate the DTLS handshake used, which only the
 * transport knows. The claim must still be checked against the transport —
 * see `assertRemoteFingerprintMatches` in webrtc-service.
 */

export class SdpFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdpFingerprintError';
  }
}

/** A sha-256 fingerprint: 32 colon-separated uppercase hex octets. */
const SHA256_FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export interface FingerprintOccurrence {
  /** 'session' for the part before the first `m=` line, else the media index. */
  section: 'session' | number;
  /** Hash algorithm as written, lowercased (e.g. "sha-256"). */
  algorithm: string;
  /** Fingerprint value, normalised to uppercase with colons. */
  value: string;
}

/** Every `a=fingerprint` line in the SDP, tagged with where it appeared. */
export function collectFingerprints(sdp: string): FingerprintOccurrence[] {
  if (typeof sdp !== 'string' || sdp.length === 0) {
    throw new SdpFingerprintError('SDP is empty');
  }

  const out: FingerprintOccurrence[] = [];
  let section: 'session' | number = 'session';
  let mediaIndex = -1;

  // SDP lines are CRLF by spec but LF in practice; accept both, and ignore
  // blank lines rather than treating them as section boundaries.
  for (const rawLine of sdp.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith('m=')) {
      mediaIndex += 1;
      section = mediaIndex;
      continue;
    }

    if (!line.startsWith('a=fingerprint:')) continue;

    const rest = line.slice('a=fingerprint:'.length).trim();
    const sp = rest.search(/\s/);
    if (sp <= 0) {
      throw new SdpFingerprintError(`Malformed fingerprint attribute: "${line.slice(0, 80)}"`);
    }
    const algorithm = rest.slice(0, sp).toLowerCase();
    const value = rest.slice(sp + 1).trim().toUpperCase();

    out.push({ section, algorithm, value });
  }

  return out;
}

/**
 * The single fingerprint this SDP unambiguously commits to.
 *
 * Throws on anything an attacker could use to make two readers disagree.
 */
export function extractSingleFingerprint(sdp: string): string {
  const all = collectFingerprints(sdp);

  if (all.length === 0) {
    throw new SdpFingerprintError('SDP contains no DTLS fingerprint');
  }

  // Only sha-256 is accepted. A weaker hash offered alongside is a
  // downgrade attempt, not a compatibility gesture.
  const nonSha256 = all.filter((f) => f.algorithm !== 'sha-256');
  if (nonSha256.length > 0) {
    throw new SdpFingerprintError(
      `SDP offers a non-sha-256 fingerprint (${nonSha256.map((f) => f.algorithm).join(', ')}); refusing`,
    );
  }

  for (const f of all) {
    if (!SHA256_FINGERPRINT.test(f.value)) {
      throw new SdpFingerprintError(
        `Malformed sha-256 fingerprint "${f.value.slice(0, 40)}"`,
      );
    }
  }

  const distinct = new Set(all.map((f) => f.value));
  if (distinct.size > 1) {
    // The core of finding 2. Two values means two readers can disagree
    // about which peer this is, and the attacker chooses which reader sees
    // which.
    throw new SdpFingerprintError(
      `SDP contains ${distinct.size} conflicting DTLS fingerprints; refusing to guess which is authoritative`,
    );
  }

  // Duplicate session-level attributes are malformed even when they agree —
  // an SDP that repeats a session attribute was not produced by a normal
  // implementation, and accepting it means accepting whatever else is odd
  // about it.
  const sessionCount = all.filter((f) => f.section === 'session').length;
  if (sessionCount > 1) {
    throw new SdpFingerprintError(
      `SDP repeats the session-level fingerprint attribute ${sessionCount} times`,
    );
  }

  return all[0].value;
}

/** Normalise for comparison: uppercase, colon-separated. */
export function normaliseFingerprint(fp: string): string {
  if (typeof fp !== 'string') return '';
  const hex = fp.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 64) return fp.trim().toUpperCase();
  return (hex.match(/.{2}/g) ?? []).join(':');
}

/** Constant-time-ish equality on normalised fingerprints. */
export function fingerprintsEqual(a: string, b: string): boolean {
  const na = normaliseFingerprint(a);
  const nb = normaliseFingerprint(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na.length !== nb.length) return false;
  let diff = 0;
  for (let i = 0; i < na.length; i++) diff |= na.charCodeAt(i) ^ nb.charCodeAt(i);
  return diff === 0;
}
