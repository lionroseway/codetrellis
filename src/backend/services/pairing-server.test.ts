/**
 * The pairing window (pairing-server.ts): one exchange, then it closes.
 *
 * After a phone's answer is accepted the server closes itself half a second
 * later. That close must be of the server that answered, never of whichever
 * server is running by then: a second pairing started within that half
 * second (pairing two devices one after the other, or a test that does) had
 * its fresh window shut under it, and its phone's answer was refused with
 * ECONNREFUSED (seen in CI, harness `awareness-h1.test.ts`).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPairingServer, stopPairingServer, isPairingServerActive } from './pairing-server';
import { computeAnswerMac } from '../../../mobile/lib/peer-auth';

const fp = (byte: string) => Array.from({ length: 32 }, () => byte).join(':');
const sdp = (fingerprint: string) => [
  'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd', 'a=ice-pwd:abcdefghijklmnopqrstuvwx',
  `a=fingerprint:sha-256 ${fingerprint}`, 'a=setup:actpass', 'a=mid:0',
  'a=candidate:1 1 udp 2122260223 127.0.0.1 50000 typ host', '',
].join('\r\n');
const DESKTOP = fp('AA');
const PHONE = fp('BB');
const open = () => startPairingServer({ offerSdp: sdp(DESKTOP), iceCandidates: [], fingerprint: DESKTOP });
const post = (port: number, path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

after(() => stopPairingServer());

test('a second pairing started just after the first answered keeps its own window open', async () => {
  const first = await open();
  const answered = await post(first.port, '/answer', {
    answer: sdp(PHONE), fingerprint: PHONE, nonce: first.nonce, mac: computeAnswerMac(first.code, first.nonce, PHONE),
  });
  assert.equal(answered.status, 200);
  assert.equal((await first.waitForAnswer()).fingerprint.toUpperCase(), PHONE);

  // At once, the next device: its window opens before the first one's closes.
  const second = await open();
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(isPairingServerActive(), true, 'the second window is still open');
  const offer = await post(second.port, '/offer', { c: second.code });
  assert.equal(offer.status, 200);
  assert.equal(((await offer.json()) as { nonce: string }).nonce, second.nonce);

  // The first one's own stop no longer reaches the second either.
  first.stop();
  assert.equal(isPairingServerActive(), true);
  second.stop();
  assert.equal(isPairingServerActive(), false);
});
