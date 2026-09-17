/**
 * Finding 18 — what the pairing server puts on the wire, and who may use it.
 *
 * Two paths, and they are not equally exposed:
 *
 *   - **QR** carries the desktop's parameters, so the phone fetches NOTHING
 *     and an observer on the network sees only the phone's answer. That
 *     answer holds its fingerprint and ICE credentials, which every DTLS
 *     handshake publishes and which are useless without the private key.
 *   - **Manual entry** still fetches the offer over plaintext HTTP, because
 *     nobody types a 250-byte payload. It leaks handshake metadata, and is
 *     still safe against an ACTIVE attacker because the confirmation code
 *     both devices derive independently will not match after a substitution.
 *
 * And the pairing code itself is now on neither path's wire: it left the URL,
 * and it left the answer body.
 */

import { test, expect } from '@playwright/test';
import { prepareFixture, startBackend, createClient } from '../harness';
// The MOBILE mirror deliberately: this test stands in for the phone.
import { computeAnswerMac } from '../../mobile/lib/peer-auth';

/** Boot a backend and open a pairing window. Returns the temp server's base URL. */
async function pairingWindow(name: string) {
  const fixture = prepareFixture(name);
  const backend = await startBackend({ dataDir: fixture.dataDir });
  const client = createClient(backend.baseUrl, backend.capabilityToken);

  const { qrPayload } = await client.raw('POST', '/api/pairing/initiate').then((r) => r.json()) as
    { qrPayload: { p: number; c: string } };

  return {
    base: `http://127.0.0.1:${qrPayload.p}`,
    code: qrPayload.c,
    teardown: async () => {
      await client.raw('POST', '/api/pairing/cancel').catch(() => {});
      await backend.stop();
      fixture.cleanup();
    },
  };
}

const postJson = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test.describe('18 — the pairing code is not in the URL', () => {
  test('the query-string form is gone, and the body form works', async () => {
    const w = await pairingWindow('pairing-code-not-in-url');
    try {
      // What the mobile app used to send. A query string is the worst place
      // for a short-lived secret: it is written to access logs, kept in proxy
      // and history records, and forwarded in `Referer`.
      const viaQuery = await fetch(`${w.base}/offer?c=${w.code}`);
      expect(viaQuery.ok, 'the pairing code must not be accepted in the URL').toBe(false);

      // And the replacement really does work, so the refusal above is about
      // the query string and not about the endpoint being broken.
      const viaBody = await postJson(`${w.base}/offer`, { c: w.code });
      expect(viaBody.ok, 'the code in a POST body must be accepted').toBe(true);
      const offer = await viaBody.json() as { offer: string; nonce: string };
      expect(offer.offer).toContain('v=0');
      expect(offer.nonce).toBeTruthy();
    } finally {
      await w.teardown();
    }
  });

  test('a wrong code in the body is refused', async () => {
    const w = await pairingWindow('pairing-wrong-code-body');
    try {
      const wrong = String((Number(w.code) + 1) % 1_000_000).padStart(6, '0');
      const res = await postJson(`${w.base}/offer`, { c: wrong });
      expect(res.status).toBe(403);
    } finally {
      await w.teardown();
    }
  });
});

test.describe('18 — the offer goes to one client', () => {
  test('the same client may ask again; the exchange still completes', async () => {
    // A lost response would otherwise kill the QR the user just scanned, and
    // they would have to restart pairing on the desktop to find out why.
    const w = await pairingWindow('pairing-offer-retry');
    try {
      const first = await postJson(`${w.base}/offer`, { c: w.code });
      expect(first.ok).toBe(true);
      const again = await postJson(`${w.base}/offer`, { c: w.code });
      expect(again.ok, 'a retry from the same client must still be served').toBe(true);

      const a = await first.json() as { nonce: string };
      const b = await again.json() as { nonce: string };
      expect(b.nonce, 'and it must be the same pairing session').toBe(a.nonce);
    } finally {
      await w.teardown();
    }
  });

  test('the phone racing several addresses at once still pairs', async () => {
    // The mobile client fires one request per advertised address and takes
    // whichever answers first. All but one are refused, and that is expected —
    // but if the one-shot rule broke this, pairing would fail for every user
    // on a machine with more than one interface.
    const w = await pairingWindow('pairing-offer-race');
    try {
      const attempts = await Promise.allSettled(
        Array.from({ length: 4 }, () => postJson(`${w.base}/offer`, { c: w.code })),
      );
      const ok = attempts.filter(
        (r) => r.status === 'fulfilled' && r.value.ok,
      );
      expect(ok.length, 'at least one of the raced requests must succeed').toBeGreaterThan(0);
    } finally {
      await w.teardown();
    }
  });

  test('an answer that never went through the exchange is refused', async () => {
    const w = await pairingWindow('pairing-answer-unclaimed');
    try {
      const res = await postJson(`${w.base}/answer`, {
        c: w.code,
        nonce: 'whatever',
        answer: 'v=0\r\n',
        fingerprint: 'AA:BB',
      });
      expect(res.ok, 'an answer with no preceding offer must be refused').toBe(false);
    } finally {
      await w.teardown();
    }
  });

  /*
   * NOT TESTED HERE: only the client that took the offer may answer it.
   *
   * The server records the source address that claimed the offer and refuses
   * an answer from anywhere else. Every connection in this harness comes from
   * 127.0.0.1, so a second "client" is indistinguishable from the first and
   * the check cannot be exercised — the test above is refused on the nonce,
   * not on the binding, and saying otherwise would be claiming coverage that
   * does not exist.
   *
   * It is depth rather than a boundary in any case: an attacker who can READ
   * the exchange can also complete it, which is the part that needs
   * encryption rather than bookkeeping. What the binding stops is a caller
   * that can inject but not read.
   */
});

test.describe('18 — the code never appears on the wire', () => {
  test('the answer carries a proof, not the code', async () => {
    const w = await pairingWindow('pairing-answer-mac');
    try {
      // Learn the nonce the way the manual path does. On the QR path it comes
      // out of the QR and nothing is fetched at all.
      const offer = await postJson(`${w.base}/offer`, { c: w.code })
        .then((r) => r.json()) as { nonce: string };
      const fp = 'AA:BB:CC:DD';

      // What the phone used to send. Anyone watching the network read the
      // pairing code straight out of this body.
      const withCode = await postJson(`${w.base}/answer`, {
        c: w.code, answer: 'v=0\r\n', ice: [], fingerprint: fp, nonce: offer.nonce,
      });
      expect(withCode.status, 'the raw code must no longer be accepted').toBe(400);

      // A proof computed with the code gets past the code check. It fails
      // afterwards on the SDP, which this fixture has no way to produce — and
      // that is the right place for it to fail.
      const withMac = await postJson(`${w.base}/answer`, {
        answer: 'v=0\r\n',
        ice: [],
        fingerprint: fp,
        nonce: offer.nonce,
        mac: computeAnswerMac(w.code, offer.nonce, fp),
      });
      const body = await withMac.text();
      expect(body, 'a correct proof must get past the code check').not.toContain('Invalid pairing code');
      expect(body, 'and fail on the SDP instead').toContain('certificate');
    } finally {
      await w.teardown();
    }
  });

  test('a proof computed with the wrong code is refused', async () => {
    const w = await pairingWindow('pairing-answer-mac-wrong');
    try {
      const offer = await postJson(`${w.base}/offer`, { c: w.code })
        .then((r) => r.json()) as { nonce: string };
      const wrong = String((Number(w.code) + 7) % 1_000_000).padStart(6, '0');
      const fp = 'AA:BB:CC:DD';
      const res = await postJson(`${w.base}/answer`, {
        answer: 'v=0\r\n',
        ice: [],
        fingerprint: fp,
        nonce: offer.nonce,
        mac: computeAnswerMac(wrong, offer.nonce, fp),
      });
      expect(res.status).toBe(403);
    } finally {
      await w.teardown();
    }
  });
});
