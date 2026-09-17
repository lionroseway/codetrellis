/**
 * Pairing a phone opens the door that phone needs.
 *
 * WHAT WENT WRONG ON A REAL DEVICE
 *
 * `exposeMobileApi` defaults off (finding A3), so the LAN listener does not run
 * on a machine nobody asked to expose. Correct — but pairing did not turn it
 * on, and nothing in the flow mentioned it.
 *
 * So pairing SUCCEEDED, the phone stored a usable reconnect secret, and every
 * connection attempt afterwards failed with
 *
 *     Could not connect to the server
 *
 * which blames the network for a switch on the desktop. The user has no way to
 * tell those apart, and the phone shows every desktop as Offline because it
 * probes the port that is not listening.
 *
 * The default is unchanged: a machine that never pairs never listens.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prepareFixture, startBackend, createClient, findFreePort } from '../harness';

async function backendWithOwnMobilePort(name: string) {
  const fixture = prepareFixture(name);
  const mobileApiPort = await findFreePort();
  fs.mkdirSync(fixture.dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixture.dataDir, 'settings.json'),
    JSON.stringify({ device: { mobileApiPort } }, null, 2),
  );
  const backend = await startBackend({ dataDir: fixture.dataDir });
  return {
    client: createClient(backend.baseUrl, backend.capabilityToken),
    mobileApiPort,
    teardown: async () => { await backend.stop(); fixture.cleanup(); },
  };
}

test.describe('A3 — the default stands, but pairing is consent', () => {
  test('a machine that never pairs never listens', async () => {
    const h = await backendWithOwnMobilePort('pairing-lan-default-off');
    try {
      const status = await h.client.raw('GET', '/api/peers/status').then((r) => r.json());
      expect(status.mobileApi, 'nothing listens until someone asks').toBe(false);

      const settings = await h.client.raw('GET', '/api/settings').then((r) => r.json());
      expect(settings.device.exposeMobileApi).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('completing a pairing turns the listener on', async () => {
    const h = await backendWithOwnMobilePort('pairing-lan-enabled-on-pair');
    try {
      expect(
        (await h.client.raw('GET', '/api/peers/status').then((r) => r.json())).mobileApi,
        'precondition: off to begin with',
      ).toBe(false);

      // Drive a real pairing far enough to confirm it. The werift peer and the
      // confirmation-code derivation are covered by gate4; here the subject is
      // only what confirming does to the listener.
      const { qrPayload } = await h.client.raw('POST', '/api/pairing/initiate').then((r) => r.json());
      const base = `http://127.0.0.1:${qrPayload.p}`;

      const { RTCPeerConnection, RTCSessionDescription } = await import('werift');
      const { reconstructOfferSdp, ensureColonFingerprint } = await import('../../mobile/lib/sdp-minimal');
      const { extractSingleFingerprint } = await import('../../mobile/lib/sdp-fingerprint');
      const { computeAnswerMac, deriveConfirmationCode } = await import('../../mobile/lib/peer-auth');

      const phone = new RTCPeerConnection({});
      try {
        const offerSdp = reconstructOfferSdp({
          iu: qrPayload.iu,
          ip: qrPayload.ip,
          fp: ensureColonFingerprint(qrPayload.fp),
          candidateAddrs: qrPayload.hs,
          candidatePort: qrPayload.cp,
          maxMessageSize: qrPayload.mms,
        });
        await phone.setRemoteDescription(new RTCSessionDescription(offerSdp, 'offer'));
        await phone.setLocalDescription(await phone.createAnswer());
        const answerSdp = phone.localDescription!.sdp;
        const phoneFp = extractSingleFingerprint(answerSdp);

        await fetch(`${base}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answer: answerSdp,
            ice: [],
            fingerprint: phoneFp,
            nonce: qrPayload.n,
            mac: computeAnswerMac(qrPayload.c, qrPayload.n, phoneFp),
          }),
        });

        await expect.poll(
          async () => (await h.client.raw('GET', '/api/pairing/status').then((r) => r.json())).codeReady,
          { timeout: 20_000 },
        ).toBe(true);

        const code = deriveConfirmationCode(
          qrPayload.n, extractSingleFingerprint(offerSdp), phoneFp,
        );
        const confirmed = await h.client.raw('POST', '/api/pairing/confirm', {
          code, alias: 'Test Phone', deviceType: 'mobile',
        });
        expect(confirmed.ok, 'precondition: the pairing must actually complete').toBe(true);

        // THE POINT.
        await expect.poll(
          async () => (await h.client.raw('GET', '/api/peers/status').then((r) => r.json())).mobileApi,
          { timeout: 15_000, message: 'pairing must leave the phone able to reconnect' },
        ).toBe(true);

        const settings = await h.client.raw('GET', '/api/settings').then((r) => r.json());
        expect(settings.device.exposeMobileApi, 'and the setting reflects it, so the user can turn it back off')
          .toBe(true);
      } finally {
        await phone.close().catch(() => {});
      }
    } finally {
      await h.teardown();
    }
  });
});
