/**
 * Unit tests for structural SDP fingerprint extraction (Phase 19, finding 2).
 *
 * The multi-fingerprint tests are the point. Each one is an SDP a REGEX
 * accepts while returning a value the attacker chose — the reviewer
 * demonstrated exactly this shape against a live handshake, with every data
 * channel opening afterwards.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSingleFingerprint,
  collectFingerprints,
  fingerprintsEqual,
  normaliseFingerprint,
  SdpFingerprintError,
} from './sdp-fingerprint';

const REAL = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const VICTIM = '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

/** Minimal but realistically-shaped SDP. */
function sdp(sessionAttrs: string[], mediaAttrs: string[] = []): string {
  return [
    'v=0',
    'o=- 1 1 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    ...sessionAttrs,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...mediaAttrs,
  ].join('\r\n');
}

describe('extractSingleFingerprint — the legitimate shapes', () => {
  test('session-level only', () => {
    assert.equal(extractSingleFingerprint(sdp([`a=fingerprint:sha-256 ${REAL}`])), REAL);
  });

  test('media-level only', () => {
    assert.equal(extractSingleFingerprint(sdp([], [`a=fingerprint:sha-256 ${REAL}`])), REAL);
  });

  test('the same value in both sections is fine', () => {
    assert.equal(
      extractSingleFingerprint(sdp([`a=fingerprint:sha-256 ${REAL}`], [`a=fingerprint:sha-256 ${REAL}`])),
      REAL,
    );
  });

  test('lowercase input is normalised', () => {
    assert.equal(
      extractSingleFingerprint(sdp([`a=fingerprint:sha-256 ${REAL.toLowerCase()}`])),
      REAL,
    );
  });

  test('LF-only line endings are accepted', () => {
    const lf = sdp([`a=fingerprint:sha-256 ${REAL}`]).replace(/\r\n/g, '\n');
    assert.equal(extractSingleFingerprint(lf), REAL);
  });
});

describe('extractSingleFingerprint — the attacks (finding 2)', () => {
  test('REFUSES a prepended session-level fingerprint', () => {
    // The reviewer's shape: the attacker holds the certificate matching
    // REAL, and prepends VICTIM so a first-match reader believes the
    // connection belongs to the victim device.
    const malicious = sdp([
      `a=fingerprint:sha-256 ${VICTIM}`,
      `a=fingerprint:sha-256 ${REAL}`,
    ]);

    // A REGEX ACCEPTS THIS AND RETURNS THE ATTACKER'S CHOICE:
    const regexResult = malicious.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/)?.[1];
    assert.equal(regexResult, VICTIM, 'precondition: the old implementation returns the smuggled value');

    assert.throws(() => extractSingleFingerprint(malicious), SdpFingerprintError);
  });

  test('REFUSES a media-level fingerprint that overrides the session one', () => {
    // RFC 8122 lets a media-level attribute override the session-level one,
    // which is exactly why disagreement must not be resolved silently:
    // two readers applying different precedence rules see different peers.
    const malicious = sdp([`a=fingerprint:sha-256 ${VICTIM}`], [`a=fingerprint:sha-256 ${REAL}`]);
    assert.throws(() => extractSingleFingerprint(malicious), SdpFingerprintError);
  });

  test('REFUSES duplicate session-level attributes even when they agree', () => {
    const odd = sdp([
      `a=fingerprint:sha-256 ${REAL}`,
      `a=fingerprint:sha-256 ${REAL}`,
    ]);
    assert.throws(() => extractSingleFingerprint(odd), SdpFingerprintError);
  });

  test('REFUSES a weaker hash offered alongside — a downgrade, not compatibility', () => {
    const downgrade = sdp([
      'a=fingerprint:sha-1 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD',
      `a=fingerprint:sha-256 ${REAL}`,
    ]);
    assert.throws(() => extractSingleFingerprint(downgrade), SdpFingerprintError);
  });

  test('REFUSES a malformed fingerprint value', () => {
    assert.throws(() => extractSingleFingerprint(sdp(['a=fingerprint:sha-256 not-a-fingerprint'])), SdpFingerprintError);
    assert.throws(() => extractSingleFingerprint(sdp(['a=fingerprint:sha-256 AA:BB'])), SdpFingerprintError);
  });

  test('REFUSES an SDP with no fingerprint at all', () => {
    assert.throws(() => extractSingleFingerprint(sdp([])), SdpFingerprintError);
    assert.throws(() => extractSingleFingerprint(''), SdpFingerprintError);
  });
});

describe('collectFingerprints — section attribution', () => {
  test('attributes each occurrence to its section', () => {
    const found = collectFingerprints(
      sdp([`a=fingerprint:sha-256 ${VICTIM}`], [`a=fingerprint:sha-256 ${REAL}`]),
    );
    assert.equal(found.length, 2);
    assert.equal(found[0].section, 'session');
    assert.equal(found[1].section, 0, 'the first m= section is index 0');
  });
});

describe('fingerprintsEqual', () => {
  test('matches regardless of case and colons', () => {
    assert.equal(fingerprintsEqual(REAL, REAL.toLowerCase()), true);
    assert.equal(fingerprintsEqual(REAL, REAL.replace(/:/g, '')), true);
  });

  test('does not match a different fingerprint', () => {
    assert.equal(fingerprintsEqual(REAL, VICTIM), false);
  });

  test('never matches on empty or malformed input', () => {
    assert.equal(fingerprintsEqual('', ''), false);
    assert.equal(fingerprintsEqual(REAL, ''), false);
    // @ts-expect-error deliberately wrong type
    assert.equal(fingerprintsEqual(REAL, undefined), false);
  });

  test('normaliseFingerprint re-inserts colons on bare hex', () => {
    assert.equal(normaliseFingerprint(REAL.replace(/:/g, '')), REAL);
  });
});
