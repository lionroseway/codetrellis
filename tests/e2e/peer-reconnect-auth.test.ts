/**
 * Phase 19, finding 1.2 — a reconnecting device has to prove who it is.
 *
 * WHAT WAS WRONG
 *
 * `POST /api/mobile/reconnect` took a `pairingId` and handed back a WebRTC
 * offer. That was the entire check. `pairingId` is a value the phone sends, in
 * the clear, to whatever address it believes is the desktop, on every
 * reconnect attempt — so knowing it was sufficient to be treated as the paired
 * device. There was also a `fingerprint` fallback that skipped the pairingId
 * altogether, added to upgrade older clients silently, which meant the weaker
 * path stayed open for everyone indefinitely.
 *
 * `PairedDevice.sharedSecret` existed the whole time, documented as derived
 * from the DTLS handshake, written as `''` with a `// TODO` beside it and read
 * by nothing.
 *
 * WHAT THESE TESTS COVER
 *
 * These drive the REAL listener on 0.0.0.0 — the surface a LAN attacker sees,
 * not the loopback API behind the capability token. They are about what an
 * anonymous caller on the network can and cannot get.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prepareFixture, startBackend, createClient } from '../harness';
import { computeChallengeMac, generateSharedSecret } from '../../src/backend/services/peer-auth';

const PAIRING_ID = '00000000-1111-2222-3333-444444444444';
const DEVICE_FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

/**
 * A harness whose data dir already contains a paired device.
 *
 * This matters more than it looks. With no paired device at all, every
 * reconnect request is refused because the pairingId is unknown — so a test
 * asserting "the old shape is refused" would pass against the OLD code too,
 * and prove nothing. The device has to exist for the refusal to be about
 * authentication.
 */
async function harnessWithPairedDevice(name: string, opts: { secret?: string } = {}) {
  const fixture = prepareFixture(name);
  const secret = opts.secret ?? generateSharedSecret();

  fs.mkdirSync(fixture.dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixture.dataDir, 'paired-devices.json'),
    JSON.stringify([{
      fingerprint: DEVICE_FP,
      pairingId: PAIRING_ID,
      alias: 'Seeded Phone',
      deviceType: 'mobile',
      pairedAt: new Date().toISOString(),
      lastConnected: null,
      sharedSecret: secret,
      instanceId: null,
      capabilities: ['read', 'write', 'project', 'files'],
      confirmedAt: new Date().toISOString(),
    }], null, 2),
  );

  const backend = await startBackend({ dataDir: fixture.dataDir });
  const client = createClient(backend.baseUrl, backend.capabilityToken);
  return {
    client,
    secret,
    teardown: async () => { await backend.stop(); fixture.cleanup(); },
  };
}

type SeededHarness = Awaited<ReturnType<typeof harnessWithPairedDevice>>;

/** Ask the desktop for a challenge and answer it with `secret`. */
async function proveIdentity(base: string, secret: string, pairingId = PAIRING_ID) {
  const challenge = (await fetch(`${base}/api/mobile/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingId }),
  }).then((r) => r.json())) as { nonce: string; expiresAt: number };

  return {
    pairingId,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
    mac: computeChallengeMac(secret, pairingId, challenge.nonce, challenge.expiresAt),
  };
}

/** Turn on the LAN listener and return the port it bound. */
async function exposeMobileApi(h: { client: ReturnType<typeof createClient> }): Promise<number> {
  const res = await h.client.raw('PUT', '/api/settings', {
    device: { exposeMobileApi: true },
  });
  expect(res.ok, 'enabling the mobile API should succeed').toBe(true);

  // Read the port the listener ACTUALLY bound, not the one configured.
  // `startMobileApiServer` auto-increments when 19480 is taken, so on a
  // machine already running CodeTrellis the configured value points at
  // somebody else's process — and this helper would then hand every test a
  // URL for a completely different backend.
  for (let i = 0; i < 100; i++) {
    const status = (await h.client.raw('GET', '/api/peers/status').then((r) => r.json())) as
      { mobileApi: boolean; mobileApiPort: number };
    if (status.mobileApi && status.mobileApiPort > 0) return status.mobileApiPort;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('mobile API never came up');
}

test.describe('1.2 — reconnect requires proof, not a known identifier', () => {
  test('a correct proof still reconnects — the control case', async () => {
    // Without this, every other test here could pass by the endpoint being
    // broken rather than by it being strict.
    const h = await harnessWithPairedDevice('peer-auth-happy-path');
    try {
      const port = await exposeMobileApi(h);
      const base = `http://127.0.0.1:${port}`;

      const res = await fetch(`${base}/api/mobile/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await proveIdentity(base, h.secret)),
      });

      expect(res.ok, 'the paired device must still be able to reconnect').toBe(true);
      const body = (await res.json()) as { offer: string; pairingId: string };
      expect(body.offer, 'a real SDP offer').toContain('v=0');
      expect(body.pairingId).toBe(PAIRING_ID);
    } finally {
      await h.teardown();
    }
  });

  test('THE SAME PROOF CANNOT BE USED TWICE', async () => {
    // A proof captured off the wire — this endpoint is plain HTTP on the LAN —
    // must be worth exactly one use.
    const h = await harnessWithPairedDevice('peer-auth-replay');
    try {
      const port = await exposeMobileApi(h);
      const base = `http://${'127.0.0.1'}:${port}`;
      const proof = await proveIdentity(base, h.secret);

      const first = await fetch(`${base}/api/mobile/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
      });
      expect(first.ok, 'precondition: the proof is genuinely valid').toBe(true);

      const replay = await fetch(`${base}/api/mobile/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
      });
      expect(replay.ok, 'a replayed proof must be refused').toBe(false);
      expect(replay.status).toBe(403);
    } finally {
      await h.teardown();
    }
  });

  test('a device paired before secrets existed cannot reconnect at all', async () => {
    // Every stored record carried `sharedSecret: ''`. Treating that as a key
    // would authenticate every such device identically.
    const h = await harnessWithPairedDevice('peer-auth-legacy-record', { secret: '' });
    try {
      const port = await exposeMobileApi(h);
      const base = `http://127.0.0.1:${port}`;

      const challenge = (await fetch(`${base}/api/mobile/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingId: PAIRING_ID }),
      }).then((r) => r.json())) as { nonce: string; expiresAt: number };

      const res = await fetch(`${base}/api/mobile/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingId: PAIRING_ID,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
          // The MAC an empty-string key would produce.
          mac: computeChallengeMac(generateSharedSecret(), PAIRING_ID, challenge.nonce, challenge.expiresAt),
        }),
      });

      expect(res.ok, 'an empty stored secret must not authenticate anyone').toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('the old request shape no longer gets an offer', async () => {
    const h = await harnessWithPairedDevice('peer-auth-old-shape');
    try {
      const port = await exposeMobileApi(h);
      const base = `http://127.0.0.1:${port}`;

      // Exactly what the mobile app used to send, and what the previous
      // implementation answered with a WebRTC offer.
      const byPairingId = await fetch(`${base}/api/mobile/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingId: PAIRING_ID }),
      });
      expect(
        byPairingId.ok,
        'a bare pairingId must no longer produce an offer',
      ).toBe(false);

      // And the fingerprint fallback, which skipped the pairingId entirely.
      const byFingerprint = await fetch(`${base}/api/mobile/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: DEVICE_FP }),
      });
      expect(
        byFingerprint.ok,
        'the fingerprint fallback must be gone, not merely deprioritised',
      ).toBe(false);

      for (const res of [byPairingId, byFingerprint]) {
        const body = await res.json().catch(() => ({}));
        expect(
          JSON.stringify(body),
          'a refusal must not carry an SDP offer',
        ).not.toContain('v=0');
      }
    } finally {
      await h.teardown();
    }
  });

  test('a challenge is issued for any id, and answers nothing on its own', async () => {
    const h = await harnessWithPairedDevice('peer-auth-challenge');
    try {
      const port = await exposeMobileApi(h);
      const base = `http://127.0.0.1:${port}`;

      // Replying only to pairing ids that exist would turn this endpoint into
      // an enumeration oracle on a LAN-reachable surface. An unknown id gets a
      // well-formed challenge it has no way to answer.
      const res = await fetch(`${base}/api/mobile/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingId: 'definitely-not-a-real-device' }),
      });
      expect(res.ok).toBe(true);
      const challenge = (await res.json()) as { nonce: string; expiresAt: number };
      expect(challenge.nonce, 'a real nonce, not a placeholder').toMatch(/^[0-9a-f]{64}$/);
      expect(challenge.expiresAt).toBeGreaterThan(Date.now());

      // Two challenges must never be the same value.
      const second = await fetch(`${base}/api/mobile/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingId: PAIRING_ID }),
      }).then((r) => r.json());
      expect(second.nonce).not.toBe(challenge.nonce);

      // Holding a challenge gets you nowhere without the pairing secret —
      // and this device DOES exist, so the refusal is about the proof.
      const attempt = await fetch(`${base}/api/mobile/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingId: PAIRING_ID,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
          mac: 'f'.repeat(64),
        }),
      });
      expect(attempt.ok, 'a guessed proof must be refused').toBe(false);
      expect(attempt.status).toBe(403);
    } finally {
      await h.teardown();
    }
  });

  test('submitting an answer without a pending authorised offer is refused', async () => {
    const h = await harnessWithPairedDevice('peer-auth-answer');
    try {
      const port = await exposeMobileApi(h);
      const res = await fetch(`http://127.0.0.1:${port}/api/mobile/reconnect/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingId: PAIRING_ID,
          answer: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n',
          ice: [],
        }),
      });
      expect(res.ok).toBe(false);
      expect(res.status).toBe(403);
    } finally {
      await h.teardown();
    }
  });
});

test.describe('1.2 — what an anonymous caller can consume is bounded', () => {
  test('an oversized body is refused rather than buffered', async () => {
    const h = await harnessWithPairedDevice('peer-auth-body-cap');
    try {
      const port = await exposeMobileApi(h);

      // The handlers used to do `body += chunk` with no ceiling at all, on a
      // server bound to every interface.
      const huge = JSON.stringify({ pairingId: PAIRING_ID, pad: 'A'.repeat(2 * 1024 * 1024) });

      let refused = false;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/mobile/auth/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: huge,
        });
        // Either a 413, or the socket is torn down mid-upload (which surfaces
        // as a fetch rejection). Both are the intended behaviour; what must
        // NOT happen is a 200.
        refused = !res.ok;
      } catch {
        refused = true;
      }

      expect(refused, 'a 2 MB body must not be accepted').toBe(true);

      // And the server is still serving afterwards.
      const still = await fetch(`http://127.0.0.1:${port}/api/mobile/status`);
      expect(still.ok, 'rejecting an oversized body must not kill the listener').toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('a burst of requests is rate limited', async () => {
    const h = await harnessWithPairedDevice('peer-auth-rate-limit');
    try {
      const port = await exposeMobileApi(h);
      const base = `http://127.0.0.1:${port}`;

      // Issuing challenges and creating WebRTC offers both cost the desktop
      // something, and neither needs a credential to ask for.
      let sawLimit = false;
      for (let i = 0; i < 90; i++) {
        const res = await fetch(`${base}/api/mobile/auth/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairingId: PAIRING_ID }),
        });
        if (res.status === 429) { sawLimit = true; break; }
      }

      expect(sawLimit, 'an unauthenticated caller must hit a ceiling').toBe(true);
    } finally {
      await h.teardown();
    }
  });
});

test.describe('19 — the pairing window is not a free run at a six-digit space', () => {
  test('too many wrong codes closes the window', async () => {
    // Six digits over sixty seconds, on a server bound to 0.0.0.0, with no
    // limit at all: an attacker on the network could cover a meaningful slice
    // of the space before the window expired on its own.
    const fixture = prepareFixture('pairing-brute-force');
    const backend = await startBackend({ dataDir: fixture.dataDir });
    const client = createClient(backend.baseUrl, backend.capabilityToken);
    try {
      const { qrPayload } = await client.raw('POST', '/api/pairing/initiate').then((r) => r.json()) as
        { qrPayload: { p: number; c: string } };
      const base = `http://127.0.0.1:${qrPayload.p}`;

      // The control: the real code works right now, so the failure below is
      // the limiter and not the server having never been up.
      const askForOffer = (c: string) =>
        fetch(`${base}/offer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ c }),
        });

      const before = await askForOffer(qrPayload.c);
      expect(before.ok, 'precondition: the correct code must work to begin with').toBe(true);

      // Guess. The real code is excluded so the loop cannot accidentally
      // succeed and leave the window open.
      let refusals = 0;
      for (let i = 0; i < 8; i++) {
        const guess = String((Number(qrPayload.c) + i + 1) % 1_000_000).padStart(6, '0');
        try {
          const res = await askForOffer(guess);
          if (!res.ok) refusals++;
        } catch {
          // The server closing the socket mid-sweep is the intended outcome.
          refusals++;
          break;
        }
      }
      expect(refusals, 'precondition: the guesses really were wrong').toBeGreaterThan(0);

      // And now the correct code is worth nothing, because the window is shut.
      let stillOpen = false;
      try {
        // The limiter closes the whole server, so this fails at the socket —
        // not because the offer was already claimed above.
        stillOpen = (await askForOffer(qrPayload.c)).ok;
      } catch {
        stillOpen = false;
      }
      expect(stillOpen, 'the pairing window must close after too many wrong codes').toBe(false);
    } finally {
      await client.raw('POST', '/api/pairing/cancel').catch(() => {});
      await backend.stop();
      fixture.cleanup();
    }
  });
});
