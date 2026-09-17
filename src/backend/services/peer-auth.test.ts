/**
 * Unit tests for reconnect authentication (Phase 19, finding 1.2).
 *
 * The replay tests are the point. Before this existed, the entire proof a
 * reconnecting caller had to present was a `pairingId` — a value the phone
 * transmits in the clear on every attempt — so "replay" was not even the
 * right word for it: there was nothing to replay.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  generateSharedSecret,
  isUsableSecret,
  canonicalChallenge,
  computeChallengeMac,
  macsEqual,
  issueChallenge,
  verifyChallengeResponse,
  resetChallenges,
  outstandingChallengeCount,
  deriveConfirmationCode,
  computeReconnectAnswerMac,
  computeReconnectOfferMac,
  CHALLENGE_TTL_MS,
  PeerAuthError,
} from './peer-auth';

const PAIRING_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';

/**
 * Answer a challenge.
 *
 * `clientSecret` is what the CALLER signs with; `stored` is what the desktop
 * holds for that device. They are separate arguments on purpose — the secret
 * used for verification comes from the paired-device record, never from the
 * request, and a test that conflated them would pass while testing nothing.
 */
function respond(
  clientSecret: string,
  pairingId: string,
  c: { nonce: string; expiresAt: number },
  stored: string = clientSecret,
) {
  return {
    pairingId,
    nonce: c.nonce,
    expiresAt: c.expiresAt,
    mac: computeChallengeMac(clientSecret, pairingId, c.nonce, c.expiresAt),
    secret: stored,
  };
}

beforeEach(() => resetChallenges());

describe('the shared secret', () => {
  test('is 32 bytes of hex and different every time', () => {
    const a = generateSharedSecret();
    const b = generateSharedSecret();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
  });

  test('the empty string every record used to carry is NOT usable', () => {
    // `sharedSecret: ''` with a `// TODO` was what shipped. A verifier that
    // treated it as a key would authenticate everybody identically.
    assert.equal(isUsableSecret(''), false);
    assert.equal(isUsableSecret(undefined), false);
    assert.equal(isUsableSecret(null), false);
    assert.equal(isUsableSecret('not-hex'), false);
    assert.equal(isUsableSecret(generateSharedSecret()), true);
  });

  test('computing a MAC with no usable secret throws rather than returning one', () => {
    assert.throws(() => computeChallengeMac('', PAIRING_ID, 'abcd', 1), PeerAuthError);
  });
});

describe('the canonical message', () => {
  test('is unambiguous — fields cannot be re-split into different values', () => {
    // Without a separator, ("ab","c") and ("a","bc") would sign the same bytes,
    // and a proof for one pairing would verify for another.
    const a = canonicalChallenge('ab', 'c', 1);
    const b = canonicalChallenge('a', 'bc', 1);
    assert.notEqual(a, b);
  });

  test('is versioned, so a later scheme cannot be confused with this one', () => {
    assert.ok(canonicalChallenge('p', 'n', 1).startsWith('ct-peer-auth:v1\n'));
  });

  test('matches a plain HMAC computed independently', () => {
    const secret = generateSharedSecret();
    const expected = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(canonicalChallenge(PAIRING_ID, 'nonce', 42))
      .digest('hex');
    assert.equal(computeChallengeMac(secret, PAIRING_ID, 'nonce', 42), expected);
  });
});

describe('challenge / response', () => {
  test('an honest response verifies', () => {
    const secret = generateSharedSecret();
    const c = issueChallenge(PAIRING_ID);
    assert.deepEqual(verifyChallengeResponse(respond(secret, PAIRING_ID, c)), { ok: true });
  });

  test('THE SAME RESPONSE CANNOT BE USED TWICE', () => {
    const secret = generateSharedSecret();
    const c = issueChallenge(PAIRING_ID);
    const proof = respond(secret, PAIRING_ID, c);

    assert.equal(verifyChallengeResponse(proof).ok, true);
    const second = verifyChallengeResponse(proof);
    assert.equal(second.ok, false, 'a captured proof must not reconnect a second time');
  });

  test('a nonce is burned even by a FAILED attempt', () => {
    // Otherwise an attacker holding a nonce can grind MACs against it.
    const c = issueChallenge(PAIRING_ID);
    const wrong = { ...respond(generateSharedSecret(), PAIRING_ID, c), mac: 'f'.repeat(64) };
    assert.equal(verifyChallengeResponse(wrong).ok, false);
    assert.equal(outstandingChallengeCount(), 0, 'the nonce must not survive a failed attempt');
  });

  test('a made-up nonce is refused', () => {
    const secret = generateSharedSecret();
    const fake = { nonce: 'a'.repeat(64), expiresAt: Date.now() + 10_000 };
    assert.equal(verifyChallengeResponse(respond(secret, PAIRING_ID, fake)).ok, false);
  });

  test('a response signed with the wrong secret is refused', () => {
    const stored = generateSharedSecret();
    const attackers = generateSharedSecret();
    const c = issueChallenge(PAIRING_ID);
    assert.equal(verifyChallengeResponse(respond(attackers, PAIRING_ID, c, stored)).ok, false);
  });

  test('knowing the pairingId alone is not enough — which is the whole finding', () => {
    // The previous implementation asked for exactly this and nothing else.
    const stored = generateSharedSecret();
    const c = issueChallenge(PAIRING_ID);
    const res = verifyChallengeResponse({
      pairingId: PAIRING_ID,
      nonce: c.nonce,
      expiresAt: c.expiresAt,
      mac: '',
      secret: stored,
    });
    assert.equal(res.ok, false);
  });

  test('a challenge issued for one device does not authenticate another', () => {
    const secret = generateSharedSecret();
    const c = issueChallenge(PAIRING_ID);
    const res = verifyChallengeResponse(respond(secret, OTHER_ID, c));
    assert.equal(res.ok, false);
  });

  test('an expired challenge is refused', () => {
    const secret = generateSharedSecret();
    const t0 = 1_000_000;
    const c = issueChallenge(PAIRING_ID, t0);
    const res = verifyChallengeResponse(respond(secret, PAIRING_ID, c), t0 + CHALLENGE_TTL_MS + 1);
    assert.equal(res.ok, false);
  });

  test('the client cannot extend its own expiry', () => {
    // The expiry is covered by the MAC, but it is also SENT — so verification
    // must compare against the issued value, not the presented one.
    const secret = generateSharedSecret();
    const c = issueChallenge(PAIRING_ID);
    const far = c.expiresAt + 3_600_000;
    const res = verifyChallengeResponse({
      pairingId: PAIRING_ID,
      nonce: c.nonce,
      expiresAt: far,
      mac: computeChallengeMac(secret, PAIRING_ID, c.nonce, far),
      secret,
    });
    assert.equal(res.ok, false);
  });

  test('a device with no stored secret cannot authenticate at all', () => {
    const c = issueChallenge(PAIRING_ID);
    const res = verifyChallengeResponse({
      pairingId: PAIRING_ID,
      nonce: c.nonce,
      expiresAt: c.expiresAt,
      mac: 'f'.repeat(64),
      secret: '',
    });
    assert.equal(res.ok, false);
  });

  test('issuing challenges cannot grow memory without bound', () => {
    for (let i = 0; i < 1000; i++) issueChallenge(PAIRING_ID);
    assert.ok(outstandingChallengeCount() <= 256, `capped, got ${outstandingChallengeCount()}`);
  });

  test('an unknown pairingId still gets a challenge — no enumeration oracle', () => {
    const c = issueChallenge('no-such-device');
    assert.match(c.nonce, /^[0-9a-f]{64}$/);
  });
});

describe('macsEqual', () => {
  test('never throws on malformed input', () => {
    assert.equal(macsEqual('', ''), false);
    // @ts-expect-error deliberately wrong type
    assert.equal(macsEqual('abc', undefined), false);
    assert.equal(macsEqual('abc', 'abcd'), false);
    assert.equal(macsEqual('abcd', 'abcd'), true);
  });
});

describe('the confirmation code', () => {
  test('both sides agree regardless of argument order', () => {
    const a = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
    const b = '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';
    assert.equal(deriveConfirmationCode('n', a, b), deriveConfirmationCode('n', b, a));
  });

  test('is insensitive to colons and case, which differ between the two codebases', () => {
    const a = 'AA:BB:CC:DD';
    const b = '11:22:33:44';
    assert.equal(
      deriveConfirmationCode('n', a, b),
      deriveConfirmationCode('n', a.replace(/:/g, '').toLowerCase(), b.toLowerCase()),
    );
  });

  test('a relayed connection produces a DIFFERENT code on each side', () => {
    // This is the whole security value. Desktop sees the relay's certificate
    // where the phone should be; the phone sees the relay's where the desktop
    // should be. Two different numbers, and the user is looking at both.
    const desktop = 'AA:AA:AA:AA';
    const phone = 'BB:BB:BB:BB';
    const relay = 'CC:CC:CC:CC';
    const seenByDesktop = deriveConfirmationCode('n', desktop, relay);
    const seenByPhone = deriveConfirmationCode('n', relay, phone);
    assert.notEqual(seenByDesktop, seenByPhone);
  });

  test('is always six digits', () => {
    for (let i = 0; i < 200; i++) {
      assert.match(deriveConfirmationCode(String(i), 'AA', 'BB'), /^\d{6}$/);
    }
  });
});

describe('binding a certificate to the pairing, not to history', () => {
  const PID = PAIRING_ID;

  test('the same certificate signed with different secrets gives different proofs', () => {
    const a = generateSharedSecret();
    const b = generateSharedSecret();
    assert.notEqual(
      computeReconnectAnswerMac(a, PID, 'n', 'AA:BB'),
      computeReconnectAnswerMac(b, PID, 'n', 'AA:BB'),
    );
  });

  test('a proof is bound to the nonce, so it cannot be reused next time', () => {
    const secret = generateSharedSecret();
    assert.notEqual(
      computeReconnectAnswerMac(secret, PID, 'nonce-1', 'AA:BB'),
      computeReconnectAnswerMac(secret, PID, 'nonce-2', 'AA:BB'),
    );
  });

  test('a proof is bound to the certificate it names', () => {
    // The point of the whole mechanism: an observer of this plaintext
    // exchange cannot swap in their own certificate, because the proof
    // covers it.
    const secret = generateSharedSecret();
    assert.notEqual(
      computeReconnectAnswerMac(secret, PID, 'n', 'AA:BB'),
      computeReconnectAnswerMac(secret, PID, 'n', 'CC:DD'),
    );
  });

  test('a proof is bound to the pairing, so one device cannot answer for another', () => {
    const secret = generateSharedSecret();
    assert.notEqual(
      computeReconnectAnswerMac(secret, PID, 'n', 'AA:BB'),
      computeReconnectAnswerMac(secret, OTHER_ID, 'n', 'AA:BB'),
    );
  });

  test('offer and answer proofs are not interchangeable', () => {
    // Domain separation. Without it, a captured offer proof would be a valid
    // answer proof and the two directions would collapse into one.
    const secret = generateSharedSecret();
    assert.notEqual(
      computeReconnectOfferMac(secret, PID, 'n', 'AA:BB'),
      computeReconnectAnswerMac(secret, PID, 'n', 'AA:BB'),
    );
  });

  test('fingerprint formatting does not change the proof', () => {
    // The two codebases format fingerprints differently; the MAC must not
    // notice, or every reconnect fails for a cosmetic reason.
    const secret = generateSharedSecret();
    assert.equal(
      computeReconnectAnswerMac(secret, PID, 'n', 'AA:BB:CC:DD'),
      computeReconnectAnswerMac(secret, PID, 'n', 'aabbccdd'),
    );
  });

  test('a device with no secret cannot produce either proof', () => {
    assert.throws(() => computeReconnectAnswerMac('', PID, 'n', 'AA'), PeerAuthError);
    assert.throws(() => computeReconnectOfferMac('', PID, 'n', 'AA'), PeerAuthError);
  });
});
