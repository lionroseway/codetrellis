/**
 * The desktop and the phone must compute the same answers.
 *
 * Phase 19, findings 1.2 and 2.
 *
 * WHY THESE FILES ARE DUPLICATED AT ALL
 *
 * `mobile/` is a separate Expo project with its own Metro bundler, and it
 * cannot import from the desktop workspace. So three security-relevant modules
 * exist twice: the SHA-256/HMAC primitives, the challenge and confirmation-code
 * derivations built on them, and the structural SDP fingerprint parser. The
 * copies are deliberate; the drift is what has to be prevented.
 *
 * A divergence here does not announce itself. Both sides keep working in
 * isolation — their own tests pass — and the failure only appears as a phone
 * that suddenly cannot reconnect, or a pairing where the two confirmation
 * codes never match and the user assumes the app is broken. Worse, a
 * divergence in the SDP parser means one side accepts an SDP the other
 * refuses, which is precisely the ambiguity finding 2 is about.
 *
 * These are plain computations — no backend, no fixture, no harness.
 */

import { test, expect } from '@playwright/test';
import { createHash, createHmac, randomBytes } from 'node:crypto';

// Desktop implementations
import * as desktopAuth from '../../src/backend/services/peer-auth';
import * as desktopSdp from '../../src/shared/lib/sdp-fingerprint';

// Mobile mirrors
import * as mobileCrypto from '../../mobile/lib/crypto';
import * as mobileAuth from '../../mobile/lib/peer-auth';
import * as mobileSdp from '../../mobile/lib/sdp-fingerprint';
import * as desktopMinimal from '../../src/shared/lib/sdp-minimal';
import * as mobileMinimal from '../../mobile/lib/sdp-minimal';

const FP_A = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const FP_B = '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

test.describe('the phone\'s hand-written SHA-256 matches the real one', () => {
  test('agrees with node:crypto across every block-boundary length', () => {
    // The padding bug this catches only shows up at lengths where the message
    // lands exactly on a block boundary — 55, 119, 183 — and nowhere else. A
    // handful of ad-hoc strings would have missed it entirely.
    for (let n = 0; n <= 260; n++) {
      const s = 'a'.repeat(n);
      expect(mobileCrypto.sha256Hex(s), `sha256 of ${n} bytes`).toBe(
        createHash('sha256').update(s).digest('hex'),
      );
    }
  });

  test('agrees on multi-byte UTF-8', () => {
    for (const s of ['ünïcødé', '日本語テスト', 'emoji free but accented: café', '']) {
      expect(mobileCrypto.sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });

  test('HMAC agrees across key lengths either side of the 64-byte block', () => {
    // A key longer than the block is hashed first and a shorter one is
    // zero-padded; getting either wrong is invisible until it meets the
    // desktop.
    for (const keyBytes of [1, 16, 31, 32, 63, 64, 65, 100, 128]) {
      const keyHex = randomBytes(keyBytes).toString('hex');
      for (const msg of ['', 'short', 'x'.repeat(200)]) {
        expect(mobileCrypto.hmacSha256Hex(keyHex, msg), `key=${keyBytes}B msg=${msg.length}B`).toBe(
          createHmac('sha256', Buffer.from(keyHex, 'hex')).update(msg).digest('hex'),
        );
      }
    }
  });
});

test.describe('the reconnect proof', () => {
  test('the canonical message is identical on both sides', () => {
    for (const [pid, nonce, exp] of [
      ['abc', 'def', 1],
      ['00000000-1111-2222-3333-444444444444', 'f'.repeat(64), 1789000000000],
      ['', '', 0],
    ] as [string, string, number][]) {
      expect(mobileAuth.canonicalChallenge(pid, nonce, exp)).toBe(
        desktopAuth.canonicalChallenge(pid, nonce, exp),
      );
    }
  });

  test('a proof computed on the phone verifies on the desktop', () => {
    // The end-to-end statement: the phone's MAC is the one the desktop expects.
    const secret = desktopAuth.generateSharedSecret();
    const pairingId = '00000000-1111-2222-3333-444444444444';
    const challenge = desktopAuth.issueChallenge(pairingId);

    const mac = mobileAuth.computeChallengeMac(secret, pairingId, challenge.nonce, challenge.expiresAt);

    expect(
      desktopAuth.verifyChallengeResponse({
        pairingId,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
        mac,
        secret,
      }),
    ).toEqual({ ok: true });
  });

  test('both sides agree on which stored secrets are unusable', () => {
    for (const s of ['', 'nope', 'ab', desktopAuth.generateSharedSecret()]) {
      expect(mobileAuth.isUsableSecret(s), `usability of ${JSON.stringify(s)}`).toBe(
        desktopAuth.isUsableSecret(s),
      );
    }
  });
});

test.describe('the confirmation code', () => {
  test('both devices derive the same six digits', () => {
    for (const nonce of ['a', 'deadbeef', randomBytes(16).toString('hex')]) {
      expect(mobileAuth.deriveConfirmationCode(nonce, FP_A, FP_B)).toBe(
        desktopAuth.deriveConfirmationCode(nonce, FP_A, FP_B),
      );
      // And regardless of which side passes which argument first.
      expect(mobileAuth.deriveConfirmationCode(nonce, FP_B, FP_A)).toBe(
        desktopAuth.deriveConfirmationCode(nonce, FP_A, FP_B),
      );
    }
  });

  test('formatting differences between the codebases do not change it', () => {
    // The desktop carries fingerprints with colons and uppercase; the phone
    // gets whatever react-native-webrtc puts in the SDP. If normalisation
    // differed, every pairing would show two different numbers and the feature
    // would look broken rather than insecure — which is how this would be
    // discovered, eventually, by a user.
    expect(mobileAuth.deriveConfirmationCode('n', FP_A.toLowerCase(), FP_B.replace(/:/g, ''))).toBe(
      desktopAuth.deriveConfirmationCode('n', FP_A, FP_B),
    );
  });
});

test.describe('the SDP fingerprint parser', () => {
  const sdp = (session: string[], media: string[] = []) =>
    [
      'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 't=0 0', ...session,
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...media,
    ].join('\r\n');

  const CASES: { name: string; sdp: string }[] = [
    { name: 'session-level only', sdp: sdp([`a=fingerprint:sha-256 ${FP_A}`]) },
    { name: 'media-level only', sdp: sdp([], [`a=fingerprint:sha-256 ${FP_A}`]) },
    { name: 'same value in both', sdp: sdp([`a=fingerprint:sha-256 ${FP_A}`], [`a=fingerprint:sha-256 ${FP_A}`]) },
    { name: 'lowercase', sdp: sdp([`a=fingerprint:sha-256 ${FP_A.toLowerCase()}`]) },
    { name: 'LF line endings', sdp: sdp([`a=fingerprint:sha-256 ${FP_A}`]).replace(/\r\n/g, '\n') },
    { name: 'smuggled session fingerprint', sdp: sdp([`a=fingerprint:sha-256 ${FP_B}`, `a=fingerprint:sha-256 ${FP_A}`]) },
    { name: 'media overriding session', sdp: sdp([`a=fingerprint:sha-256 ${FP_B}`], [`a=fingerprint:sha-256 ${FP_A}`]) },
    { name: 'duplicate agreeing attributes', sdp: sdp([`a=fingerprint:sha-256 ${FP_A}`, `a=fingerprint:sha-256 ${FP_A}`]) },
    { name: 'sha-1 downgrade alongside', sdp: sdp(['a=fingerprint:sha-1 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD', `a=fingerprint:sha-256 ${FP_A}`]) },
    { name: 'malformed value', sdp: sdp(['a=fingerprint:sha-256 not-a-fingerprint']) },
    { name: 'no fingerprint', sdp: sdp([]) },
    { name: 'empty', sdp: '' },
  ];

  for (const c of CASES) {
    test(`both sides reach the same verdict: ${c.name}`, () => {
      const run = (fn: (s: string) => string) => {
        try { return { ok: true as const, value: fn(c.sdp) }; }
        catch (err) { return { ok: false as const, value: (err as Error).message }; }
      };

      const desk = run(desktopSdp.extractSingleFingerprint);
      const mob = run(mobileSdp.extractSingleFingerprint);

      // Accept/refuse must match, and when accepted so must the value. The
      // messages are allowed to differ; the decision is not.
      expect(mob.ok, `${c.name}: one side accepted and the other refused`).toBe(desk.ok);
      if (desk.ok) expect(mob.value).toBe(desk.value);
    });
  }

  test('fingerprintsEqual agrees', () => {
    const pairs: [string, string][] = [
      [FP_A, FP_A.toLowerCase()],
      [FP_A, FP_A.replace(/:/g, '')],
      [FP_A, FP_B],
      ['', ''],
      [FP_A, ''],
    ];
    for (const [a, b] of pairs) {
      expect(mobileSdp.fingerprintsEqual(a, b)).toBe(desktopSdp.fingerprintsEqual(a, b));
    }
  });
});

test.describe('the minimal SDP the QR carries', () => {
  const REAL_OFFER = [
    'v=0', 'o=- 61118042 0 IN IP4 0.0.0.0', 's=-', 't=0 0',
    'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic:WMS *',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    'a=candidate:0456f 1 udp 2116026367 10.0.0.184 58208 typ host generation 0 ufrag 85a4',
    'a=candidate:80234 1 udp 1679818751 80.177.10.172 58208 typ srflx raddr 10.0.0.184 rport 58208',
    'a=end-of-candidates', 'a=ice-ufrag:85a4', 'a=ice-pwd:01a55f6def2e0f80b1b60b',
    'a=ice-options:trickle', `a=fingerprint:sha-256 ${FP_A}`, 'a=setup:actpass',
    'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:65536', '',
  ].join('\r\n');

  test('both sides rebuild byte-identical SDPs', () => {
    // A divergence here does not look like a bug. Both sides keep working
    // alone, and the failure surfaces as a phone that scans a QR and then
    // silently never connects.
    const params = desktopMinimal.extractSdpParams(REAL_OFFER, []);
    expect(mobileMinimal.reconstructOfferSdp(params)).toBe(desktopMinimal.reconstructOfferSdp(params));
    expect(mobileMinimal.reconstructAnswerSdp(params)).toBe(desktopMinimal.reconstructAnswerSdp(params));
  });

  test('both sides extract the same parameters', () => {
    expect(mobileMinimal.extractSdpParams(REAL_OFFER, []))
      .toEqual(desktopMinimal.extractSdpParams(REAL_OFFER, []));
  });

  test('max-message-size is READ, not guessed', () => {
    // The v3 template hardcoded 262144 while werift advertises 65536. A
    // four-fold disagreement surfaces only as large payloads — a UI snapshot,
    // terminal scrollback — going missing on a link that otherwise looks fine.
    const params = desktopMinimal.extractSdpParams(REAL_OFFER, []);
    expect(params.maxMessageSize).toBe(65536);
    expect(desktopMinimal.reconstructOfferSdp(params)).toContain('a=max-message-size:65536');
  });

  test('every interface gets a candidate, so a LAN pairing still works over a VPN', () => {
    const twoInterfaces = REAL_OFFER.replace(
      'a=end-of-candidates',
      'a=candidate:99999 1 udp 2116026367 100.101.102.103 58208 typ host generation 0\r\na=end-of-candidates',
    );
    const params = desktopMinimal.extractSdpParams(twoInterfaces, []);
    expect(params.candidateAddrs).toEqual(['10.0.0.184', '100.101.102.103']);

    const rebuilt = desktopMinimal.reconstructOfferSdp(params);
    expect(rebuilt).toContain('10.0.0.184 58208 typ host');
    expect(rebuilt).toContain('100.101.102.103 58208 typ host');
  });

  test('host candidates win over reflexive ones', () => {
    const params = desktopMinimal.extractSdpParams(REAL_OFFER, []);
    expect(params.candidateAddrs, 'the srflx address must not be carried when a host one exists')
      .toEqual(['10.0.0.184']);
  });

  test('candidates on different ports are refused rather than silently dropped', () => {
    // The compact payload carries ONE port. If that assumption ever breaks,
    // it has to break loudly — dropping a candidate would look like an
    // intermittent connection failure on one interface.
    const mixedPorts = REAL_OFFER.replace(
      'a=end-of-candidates',
      'a=candidate:99999 1 udp 2116026367 100.101.102.103 40404 typ host generation 0\r\na=end-of-candidates',
    );
    expect(() => desktopMinimal.extractSdpParams(mixedPorts, [])).toThrow(/ports/);
    expect(() => mobileMinimal.extractSdpParams(mixedPorts, [])).toThrow(/ports/);
  });

  test('the reconnect proofs agree in both directions', () => {
    // Neither side can recognise the other by a stored fingerprint —
    // react-native-webrtc mints a certificate per connection and werift one
    // per process — so these MACs are what authenticate a reconnect. A
    // divergence would lock every phone out of every desktop.
    const secret = 'c'.repeat(64);
    expect(mobileAuth.computeReconnectAnswerMac(secret, 'pid', 'n', FP_A))
      .toBe(desktopAuth.computeReconnectAnswerMac(secret, 'pid', 'n', FP_A));
    expect(mobileAuth.computeReconnectOfferMac(secret, 'pid', 'n', FP_A))
      .toBe(desktopAuth.computeReconnectOfferMac(secret, 'pid', 'n', FP_A));
    // And formatting differences between the codebases must not matter.
    expect(mobileAuth.computeReconnectOfferMac(secret, 'pid', 'n', FP_A.toLowerCase().replace(/:/g, '')))
      .toBe(desktopAuth.computeReconnectOfferMac(secret, 'pid', 'n', FP_A));
  });

  test('the answer MAC agrees, so the code never has to be sent', () => {
    expect(mobileAuth.computeAnswerMac('640428', 'nonce-1', FP_A))
      .toBe(desktopAuth.computeAnswerMac('640428', 'nonce-1', FP_A));
    // Colons and case differ between the two codebases; the MAC must not.
    expect(mobileAuth.computeAnswerMac('640428', 'nonce-1', FP_A.toLowerCase().replace(/:/g, '')))
      .toBe(desktopAuth.computeAnswerMac('640428', 'nonce-1', FP_A));
  });
});
