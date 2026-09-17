/**
 * Finding 18 — what the pairing server puts on the wire, and who may use it.
 *
 * The exchange still crosses the LAN as plaintext HTTP for 60 seconds. That is
 * the part `pairing-v5` is for. These tests cover what can be fixed WITHOUT
 * encryption:
 *
 *   - the pairing code is no longer in a URL, where access logs, proxies,
 *     browser history and `Referer` all keep copies of it;
 *   - the offer is served to ONE client, so a race has a clear winner and the
 *     loser fails immediately instead of reaching a confirmation step whose
 *     numbers cannot match;
 *   - only the client that took the offer may answer it.
 */

import { test, expect } from '@playwright/test';
import { prepareFixture, startBackend, createClient } from '../harness';

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
