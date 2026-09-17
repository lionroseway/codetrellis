/**
 * Gate 4 — the reconnect identity matrix, against a real DTLS handshake.
 *
 * Phase 19. This is the acceptance suite for findings 2 and 1.2, and it is the
 * only test in the repo that pairs a peer with the desktop the way the phone
 * actually does: the temp pairing server, a real werift certificate, a real
 * offer/answer exchange, a confirmation code derived independently on both
 * sides, and a reconnect authenticated with the secret that pairing produced.
 *
 * WHY IT HAS TO BE END-TO-END
 *
 * Every other test here asserts one link. The claim the review is being asked
 * to accept is a chain:
 *
 *   the SDP commits to exactly one fingerprint
 *     -> the DTLS handshake is verified against that fingerprint
 *       -> so a peer that completes the handshake demonstrably holds it
 *         -> so comparing it to the paired record is an identity check.
 *
 * The second link is an assumption about werift, and an assumption is what
 * this file exists to remove. `a tampered fingerprint fails the handshake` is
 * the test that earns the whole chain — without it, the structural parser is
 * carefully reading a value nothing enforces.
 */

import { test, expect } from '@playwright/test';
import { RTCPeerConnection, RTCSessionDescription } from 'werift';
import { prepareFixture, startBackend, createClient } from '../harness';
// The MOBILE mirrors, deliberately: this test plays the phone, so it should
// compute what the phone computes.
import {
  computeAnswerMac,
  computeChallengeMac,
  computeReconnectAnswerMac,
  deriveConfirmationCode,
} from '../../mobile/lib/peer-auth';
import { extractSingleFingerprint } from '../../mobile/lib/sdp-fingerprint';
import { reconstructOfferSdp, ensureColonFingerprint } from '../../mobile/lib/sdp-minimal';

const OTHER_FP = '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

// --- The DTLS binding itself -------------------------------------------------

test.describe('Gate 4 — the SDP fingerprint binds the certificate', () => {
  test('an honest answer completes the handshake', async () => {
    const a = new RTCPeerConnection({});
    const b = new RTCPeerConnection({});
    try {
      const channel = a.createDataChannel('control');
      let opened = false;
      channel.stateChanged.subscribe((s: string) => { if (s === 'open') opened = true; });

      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(new RTCSessionDescription(a.localDescription!.sdp, 'offer'));
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(new RTCSessionDescription(b.localDescription!.sdp, 'answer'));

      await expect.poll(() => opened, { timeout: 15_000 }).toBe(true);
    } finally {
      await a.close().catch(() => {});
      await b.close().catch(() => {});
    }
  });

  test('A CLAIMED FINGERPRINT THE PEER DOES NOT HOLD FAILS THE HANDSHAKE', async () => {
    // The load-bearing assumption. If werift did NOT verify the handshake
    // against the fingerprint in the SDP it parsed, then reading that
    // fingerprint carefully would prove nothing about who is on the other end,
    // and every identity check built on it would be decoration.
    const a = new RTCPeerConnection({});
    const b = new RTCPeerConnection({});
    try {
      const channel = a.createDataChannel('control');
      let opened = false;
      channel.stateChanged.subscribe((s: string) => { if (s === 'open') opened = true; });

      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(new RTCSessionDescription(a.localDescription!.sdp, 'offer'));
      await b.setLocalDescription(await b.createAnswer());

      // B answers honestly, then the answer is rewritten in flight to claim a
      // different certificate — exactly what an attacker asserting a victim's
      // stored fingerprint would have to do.
      const tampered = b.localDescription!.sdp.replace(
        /a=fingerprint:sha-256 \S+/g,
        `a=fingerprint:sha-256 ${OTHER_FP}`,
      );
      expect(tampered, 'precondition: the SDP really was rewritten')
        .not.toBe(b.localDescription!.sdp);

      await a.setRemoteDescription(new RTCSessionDescription(tampered, 'answer')).catch(() => {
        // Some implementations reject at set time rather than at handshake
        // time. Either is a pass; what must not happen is a channel opening.
      });

      // Deliberately generous. A flaky "never opened" would be worthless, so
      // give it longer than the honest case takes to succeed above.
      await new Promise((r) => setTimeout(r, 12_000));
      expect(opened, 'a peer must not connect while claiming a certificate it does not hold').toBe(false);
    } finally {
      await a.close().catch(() => {});
      await b.close().catch(() => {});
    }
  });
});

// --- The whole ceremony, end to end -----------------------------------------

interface PairedResult {
  pairingId: string;
  desktopFingerprint: string;
  phoneFingerprint: string;
  sharedSecret: string;
  mobilePort: number;
}

test.describe('Gate 4 — pair for real, then reconnect', () => {
  test('a werift peer pairs, derives the same code, and reconnects with the secret it was given', async () => {
    test.setTimeout(120_000);

    const fixture = prepareFixture('gate4-pair-and-reconnect');
    const backend = await startBackend({ dataDir: fixture.dataDir });
    const client = createClient(backend.baseUrl, backend.capabilityToken);
    const phone = new RTCPeerConnection({});

    try {
      // The LAN listener has to be on for reconnect later.
      await client.raw('PUT', '/api/settings', { device: { exposeMobileApi: true } });

      // Read the port the listener ACTUALLY bound, not the one configured.
      // `startMobileApiServer` auto-increments when 19480 is taken, so on a
      // machine already running CodeTrellis the configured value points at
      // somebody else's process — and this test then drives THAT, which is
      // how it first failed: every request went to a dev server whose paired
      // devices are different, and the refusals looked like a code bug.
      let mobilePort = 0;
      await expect.poll(async () => {
        const status = await client.raw('GET', '/api/peers/status').then((r) => r.json());
        mobilePort = status.mobileApiPort ?? 0;
        return status.mobileApi === true && mobilePort > 0;
      }, { timeout: 15_000, message: 'the mobile API never came up' }).toBe(true);

      // ── 1. Desktop opens the pairing window ────────────────────────
      const { qrPayload } = await client.raw('POST', '/api/pairing/initiate').then((r) => r.json());
      expect(qrPayload.v).toBe(5);
      const pairingBase = `http://127.0.0.1:${qrPayload.p}`;

      // The QR has to stay scannable. v4 was ~60 bytes and this is ~250; if it
      // grows much further the code gets dense enough to be a support problem,
      // which is exactly why v4 moved away from this shape in the first place.
      expect(
        JSON.stringify(qrPayload).length,
        'the QR payload must stay within a comfortably scannable size',
      ).toBeLessThan(400);

      // ── 2. NOTHING IS FETCHED (finding 18) ─────────────────────────
      //
      // The phone rebuilds the desktop's offer from the QR alone. That is the
      // whole point of v5: the pairing exchange crosses the LAN in the clear,
      // so anything fetched over it is readable by anyone on that network —
      // and substitutable. A QR is out-of-band.
      const offerSdp = reconstructOfferSdp({
        iu: qrPayload.iu,
        ip: qrPayload.ip,
        fp: ensureColonFingerprint(qrPayload.fp),
        candidateAddrs: qrPayload.hs,
        candidatePort: qrPayload.cp,
        maxMessageSize: qrPayload.mms,
      });

      const desktopFingerprint = extractSingleFingerprint(offerSdp);
      const offerData = { offer: offerSdp, nonce: qrPayload.n };

      // ── 3. Phone answers ───────────────────────────────────────────
      let controlOpen = false;
      let deliveredSecret = '';
      let deliveredPairingId = '';
      phone.onDataChannel.subscribe((ch: any) => {
        if (ch.label === 'control') {
          ch.stateChanged.subscribe((s: string) => { if (s === 'open') controlOpen = true; });
          ch.onMessage.subscribe((data: string | Buffer) => {
            try {
              const msg = JSON.parse(String(data));
              if (msg.type === 'pairing.secret') {
              deliveredSecret = msg.secret;
              deliveredPairingId = msg.pairingId;
            }
            } catch { /* not ours */ }
          });
        }
      });

      await phone.setRemoteDescription(new RTCSessionDescription(offerData.offer, 'offer'));
      await phone.setLocalDescription(await phone.createAnswer());
      const answerSdp = phone.localDescription!.sdp;
      const phoneFingerprint = extractSingleFingerprint(answerSdp);

      // ── 4. Both sides derive the code independently ────────────────
      const phoneCode = deriveConfirmationCode(offerData.nonce, desktopFingerprint, phoneFingerprint);
      expect(phoneCode).toMatch(/^\d{6}$/);

      const posted = await fetch(`${pairingBase}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: answerSdp,
          ice: [],
          fingerprint: phoneFingerprint,
          nonce: offerData.nonce,
          // The code is NOT sent — we prove we saw the QR instead.
          mac: computeAnswerMac(qrPayload.c, qrPayload.n, phoneFingerprint),
        }),
      }).then((r) => r.json());

      expect(posted.accepted).toBe(true);
      expect(
        Object.keys(posted),
        'the desktop must NOT send the confirmation code — that is what made the ceremony vacuous',
      ).not.toContain('confirmCode');

      // ── 5. The desktop agrees the code is right ────────────────────
      await expect.poll(
        async () => (await client.raw('GET', '/api/pairing/status').then((r) => r.json())).codeReady,
        { timeout: 20_000, message: 'the desktop never registered the answer' },
      ).toBe(true);

      const confirmed = await client.raw('POST', '/api/pairing/confirm', {
        code: phoneCode,          // derived HERE, never transmitted to us
        alias: 'Gate 4 Phone',
        deviceType: 'mobile',
      });
      expect(
        confirmed.ok,
        'the code the phone derived by itself must be the code the desktop expects',
      ).toBe(true);

      const body = await confirmed.json();
      expect(JSON.stringify(body), 'the confirm response must not carry the secret')
        .not.toContain('sharedSecret');

      // ── 6. The secret arrives over DTLS, not over HTTP ─────────────
      await expect.poll(() => controlOpen, { timeout: 25_000, message: 'control channel never opened' }).toBe(true);
      await expect.poll(() => deliveredSecret, { timeout: 15_000, message: 'pairing secret never arrived' })
        .toMatch(/^[0-9a-f]{64}$/);

      // The pairing id rides the same message rather than the QR, so it costs
      // no scannability.
      expect(deliveredPairingId, 'the pairing id must arrive with the secret')
        .toBe(body.device.pairingId);

      const paired: PairedResult = {
        pairingId: deliveredPairingId,
        desktopFingerprint,
        phoneFingerprint,
        sharedSecret: deliveredSecret,
        mobilePort,
      };

      // A newly-paired phone may read plans. It may not run commands.
      expect(body.device.capabilities).toContain('read');
      expect(body.device.capabilities).not.toContain('terminal');
      expect(body.device.capabilities).not.toContain('settings');

      // ── 7. The matrix, over the real LAN listener ──────────────────
      const lan = `http://127.0.0.1:${paired.mobilePort}`;
      const challenge = async () =>
        fetch(`${lan}/api/mobile/auth/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairingId: paired.pairingId }),
        }).then((r) => r.json()) as Promise<{ nonce: string; expiresAt: number }>;

      const reconnect = (b: unknown) =>
        fetch(`${lan}/api/mobile/reconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(b),
        });

      // 7a. the secret the DTLS channel delivered actually works
      const good = await challenge();
      const goodProof = {
        pairingId: paired.pairingId,
        nonce: good.nonce,
        expiresAt: good.expiresAt,
        mac: computeChallengeMac(paired.sharedSecret, paired.pairingId, good.nonce, good.expiresAt),
      };
      expect((await reconnect(goodProof)).ok, 'the delivered secret must authenticate').toBe(true);

      // 7b. and not twice
      expect((await reconnect(goodProof)).status, 'replay').toBe(403);

      // 7c. the id alone — the entire credential the old code asked for
      const bare = await challenge();
      expect((await reconnect({ pairingId: paired.pairingId })).ok, 'bare pairingId').toBe(false);
      expect((await reconnect({
        pairingId: paired.pairingId, nonce: bare.nonce, expiresAt: bare.expiresAt, mac: 'f'.repeat(64),
      })).status, 'guessed proof').toBe(403);

      // 7d. a proof signed with someone else's secret
      const foreign = await challenge();
      expect((await reconnect({
        pairingId: paired.pairingId,
        nonce: foreign.nonce,
        expiresAt: foreign.expiresAt,
        mac: computeChallengeMac('b'.repeat(64), paired.pairingId, foreign.nonce, foreign.expiresAt),
      })).status, 'wrong secret').toBe(403);

      // 7e. a client-extended expiry, signed consistently
      const stretch = await challenge();
      const far = stretch.expiresAt + 3_600_000;
      expect((await reconnect({
        pairingId: paired.pairingId,
        nonce: stretch.nonce,
        expiresAt: far,
        mac: computeChallengeMac(paired.sharedSecret, paired.pairingId, stretch.nonce, far),
      })).status, 'self-extended expiry').toBe(403);

      // ── 8. Answering as somebody else ──────────────────────────────
      //
      // Authenticate properly, take the offer, then answer it claiming an
      // identity we are not. This is the reviewer's original demonstration,
      // run against the fixed code.
      //
      // The impostor's answer is BUILT, not produced by a second
      // RTCPeerConnection: werift derives one self-signed certificate per
      // process and reuses it, so an in-process "other peer" presents the same
      // fingerprint and is not an impostor at all. A test written that way
      // fails for the right-looking reason and proves nothing. The desktop
      // never sees a certificate here anyway — only an SDP — and whether a
      // peer can hold a certificate it claims is settled by the handshake
      // tests above.
      const auth = await challenge();
      const offer2 = await reconnect({
        pairingId: paired.pairingId,
        nonce: auth.nonce,
        expiresAt: auth.expiresAt,
        mac: computeChallengeMac(paired.sharedSecret, paired.pairingId, auth.nonce, auth.expiresAt),
      }).then((r) => r.json());
      expect(offer2.offer).toContain('v=0');

      const honestAnswer = phone.localDescription!.sdp;
      const submitAnswer = (answer: string, fingerprint: string, mac?: string) =>
        fetch(`${lan}/api/mobile/reconnect/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingId: paired.pairingId,
            answer,
            ice: [],
            fingerprint,
            mac: mac ?? computeReconnectAnswerMac(
              paired.sharedSecret, paired.pairingId, offer2.answerNonce, fingerprint,
            ),
          }),
        });

      // (i) an UNSIGNED answer — the shape an observer of this plaintext
      //     exchange could inject. The certificate is irrelevant; what they
      //     cannot produce is the proof.
      const foreignSdp = honestAnswer.replace(
        /a=fingerprint:sha-256 \S+/g,
        `a=fingerprint:sha-256 ${OTHER_FP}`,
      );
      expect(
        (await submitAnswer(foreignSdp, OTHER_FP, '')).status,
        'an answer with no proof must be refused',
      ).toBe(403);

      // (ii) SIGNED WITH THE WRONG SECRET.
      expect(
        (await submitAnswer(foreignSdp, OTHER_FP, computeReconnectAnswerMac(
          'b'.repeat(64), paired.pairingId, offer2.answerNonce, OTHER_FP,
        ))).status,
        'a proof signed with the wrong secret must be refused',
      ).toBe(403);

      // (iii) TWO fingerprints — the smuggling shape.
      //      Refused by the parser, before any comparison happens.
      const smuggled = foreignSdp.replace(
        /^(t=0 0\r?\n)/m,
        `$1a=fingerprint:sha-256 ${paired.phoneFingerprint}\r\n`,
      );
      expect(
        smuggled.match(/a=fingerprint:sha-256 (\S+)/)![1].toUpperCase(),
        'precondition: a regex really would return the smuggled value',
      ).toBe(paired.phoneFingerprint.toUpperCase());
      expect(
        (await submitAnswer(smuggled, paired.phoneFingerprint)).status,
        'a smuggled fingerprint must be refused',
      ).toBe(403);

      // (iv) claiming one fingerprint in the BODY while the SDP says another —
      //      the body field used to be taken at face value.
      expect(
        (await submitAnswer(foreignSdp, paired.phoneFingerprint)).status,
        'the body field must not override the SDP',
      ).toBe(403);

    } finally {
      await phone.close().catch(() => {});
      await backend.stop();
      fixture.cleanup();
    }
  });
});
