/**
 * Unit tests for webhook egress (Phase 19, finding 20).
 *
 * THE THREAT, RESTATED
 *
 * The URL comes from `<projectRoot>/.codetrellis/config.json` — a file in the
 * REPOSITORY. Cloning a repo and opening it used to be enough to make this
 * process POST plan data to an address that repo's author chose, from inside
 * the developer's network. So every test here is about what a URL found in
 * somebody else's repository is allowed to do.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, resolveWebhookTarget, WebhookBlocked } from './webhook-egress';

const APPROVED = ['hooks.example.com'];

describe('address classification', () => {
  test('the cloud metadata address is private', () => {
    // 169.254.169.254 is the single most valuable SSRF target on a developer
    // machine in a cloud environment, and it is a plain link-local address.
    assert.equal(isPrivateAddress('169.254.169.254'), true);
    assert.equal(isPrivateAddress('169.254.0.1'), true);
  });

  test('loopback, RFC1918, CGNAT and friends are private', () => {
    for (const addr of [
      '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.1',
      '100.64.0.1', '100.127.255.255', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    ]) {
      assert.equal(isPrivateAddress(addr), true, `${addr} must be treated as private`);
    }
  });

  test('ordinary public addresses are not', () => {
    for (const addr of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.169.0.1', '100.128.0.1']) {
      assert.equal(isPrivateAddress(addr), false, `${addr} should be public`);
    }
  });

  test('IPv6 loopback, unique-local, link-local and multicast are private', () => {
    for (const addr of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      assert.equal(isPrivateAddress(addr), true, `${addr} must be treated as private`);
    }
    assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  });

  test('an IPv4 address wearing an IPv6 hat is still that IPv4 address', () => {
    // ::ffff:169.254.169.254 reaches the metadata service. A classifier that
    // only looked at the IPv6 form would wave it through.
    assert.equal(isPrivateAddress('::ffff:169.254.169.254'), true);
    assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateAddress('::FFFF:10.0.0.1'), true);
    assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
  });

  test('anything unclassifiable is treated as private', () => {
    // Refusing to guess. A string that is not an address cannot be shown to
    // be public, and "not obviously private" is not the same as "safe".
    for (const junk of ['', 'not-an-address', '999.999.999.999', 'localhost']) {
      assert.equal(isPrivateAddress(junk), true, `${JSON.stringify(junk)} must not be treated as public`);
    }
  });
});

describe('URL validation', () => {
  test('http is refused — the body carries plan data', async () => {
    await assert.rejects(
      () => resolveWebhookTarget('http://hooks.example.com/x', APPROVED),
      WebhookBlocked,
    );
  });

  test('non-http schemes are refused', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://x/', 'ws://x/']) {
      await assert.rejects(() => resolveWebhookTarget(url, APPROVED), WebhookBlocked, url);
    }
  });

  test('a URL with credentials is refused', async () => {
    await assert.rejects(
      () => resolveWebhookTarget('https://user:pass@hooks.example.com/x', APPROVED),
      WebhookBlocked,
    );
  });

  test('garbage is refused', async () => {
    for (const url of ['', 'not a url', '//example.com']) {
      await assert.rejects(() => resolveWebhookTarget(url, APPROVED), WebhookBlocked, JSON.stringify(url));
    }
  });
});

describe('approval', () => {
  test('an unapproved host is refused even though it is public', async () => {
    // The core of the finding: a URL in a cloned repository has no standing.
    await assert.rejects(
      () => resolveWebhookTarget('https://example.com/hook', APPROVED),
      WebhookBlocked,
    );
  });

  test('an empty approval list refuses everything', async () => {
    await assert.rejects(
      () => resolveWebhookTarget('https://hooks.example.com/x', []),
      WebhookBlocked,
    );
  });

  test('approval is EXACT — no suffix matching, no wildcards', async () => {
    // "hooks.example.com.evil.test" ends with nothing useful, but a naive
    // `endsWith` or `includes` check would accept it.
    for (const host of [
      'hooks.example.com.evil.test',
      'evil-hooks.example.com',
      'hooks.example.common',
    ]) {
      await assert.rejects(
        () => resolveWebhookTarget(`https://${host}/x`, APPROVED),
        WebhookBlocked,
        host,
      );
    }
    // And a wildcard entry approves nothing, because it is dropped as a host.
    await assert.rejects(
      () => resolveWebhookTarget('https://anything.example.com/x', ['*.example.com']),
      WebhookBlocked,
    );
  });

  test('approving a host does NOT approve reaching into the local network', async () => {
    // A literal address still has to be public.
    for (const host of ['127.0.0.1', '169.254.169.254', '10.0.0.5', '[::1]']) {
      await assert.rejects(
        () => resolveWebhookTarget(`https://${host}/x`, [host.replace(/[[\]]/g, '')]),
        WebhookBlocked,
        host,
      );
    }
  });

  test('a public literal address that IS approved passes', async () => {
    const target = await resolveWebhookTarget('https://8.8.8.8/hook', ['8.8.8.8']);
    assert.equal(target.address, '8.8.8.8');
    assert.equal(target.family, 4);
  });
});

describe('name resolution', () => {
  test('a host that resolves to loopback is refused', async () => {
    // localhost is the simplest rebinding target and needs no DNS trickery.
    await assert.rejects(
      () => resolveWebhookTarget('https://localhost/x', ['localhost']),
      WebhookBlocked,
    );
  });

  test('a host that does not resolve is refused rather than attempted', async () => {
    await assert.rejects(
      () => resolveWebhookTarget('https://no-such-host.invalid/x', ['no-such-host.invalid']),
      WebhookBlocked,
    );
  });
});

describe('the loopback opt-in is exactly loopback', () => {
  test('off by default: an approved loopback host is still refused', async () => {
    await assert.rejects(
      () => resolveWebhookTarget('https://127.0.0.1/x', ['127.0.0.1']),
      WebhookBlocked,
    );
  });

  test('on: an approved loopback host is permitted, over http as well', async () => {
    // A developer running a local receiver is a real case, and over loopback
    // there is no wire to listen on — which is also the only way a
    // self-signed local endpoint can be reached at all.
    const secure = await resolveWebhookTarget('https://127.0.0.1/x', ['127.0.0.1'], { allowLoopback: true });
    assert.equal(secure.address, '127.0.0.1');

    const plain = await resolveWebhookTarget('http://127.0.0.1:8080/x', ['127.0.0.1'], { allowLoopback: true });
    assert.equal(plain.url.port, '8080');
  });

  test('on: the LAN and cloud metadata are STILL unreachable', async () => {
    // The whole point of keeping the opt-in narrow. These are the addresses
    // that make the finding worth anything to an attacker.
    for (const host of ['169.254.169.254', '10.0.0.5', '192.168.1.1', '172.16.0.1', '100.64.0.1']) {
      await assert.rejects(
        () => resolveWebhookTarget(`https://${host}/x`, [host], { allowLoopback: true }),
        WebhookBlocked,
        host,
      );
    }
  });

  test('on: http to a PUBLIC host is still refused', async () => {
    // The exception is about there being no wire, not about being relaxed.
    await assert.rejects(
      () => resolveWebhookTarget('http://8.8.8.8/x', ['8.8.8.8'], { allowLoopback: true }),
      WebhookBlocked,
    );
  });

  test('on: an UNAPPROVED loopback host is still refused', async () => {
    await assert.rejects(
      () => resolveWebhookTarget('http://127.0.0.1/x', [], { allowLoopback: true }),
      WebhookBlocked,
    );
  });
});
