/**
 * Phase 19 finding A3 / gate 1.4 — the LAN surface is off by default.
 *
 * WHAT WAS WRONG
 *
 * `settings.device.advertise` defaulted to `true`, so every new profile
 * announced itself over mDNS on whatever network the machine joined. Worse,
 * only mDNS ever honoured that flag: `startMobileApiServer()` ran
 * unconditionally, so the mobile API bound `0.0.0.0` — every interface — on
 * every launch regardless of the setting. The machine was reachable on any
 * network it touched and merely not announcing itself.
 *
 * That listener is the entry point behind the whole peer finding set:
 * pairing, reconnect, terminal broadcast, the debug endpoints. Closing it by
 * default removes the LAN attacker from all of them at once.
 *
 * WHY TWO SWITCHES
 *
 * The review asks for discovery and exposure to be independent. They are now:
 * advertising without a listener is inert, and a listener without advertising
 * is still reachable by anyone who knows the address. The listener is the
 * security-relevant one, so it gets its own flag rather than riding on a
 * setting whose name only mentions advertising.
 */

import { test, expect } from '@playwright/test';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prepareFixture, startBackend, createClient, findFreePort } from '../harness';

/**
 * A backend whose mobile API port is unique to this test.
 *
 * The default is 19480 for everyone, so probing it proves nothing on a machine
 * that is already running CodeTrellis — the socket check would see somebody
 * else's listener and fail, or worse, pass for the wrong reason. The whole
 * value of this file is the SOCKET assertion (the flag is not the control),
 * so the port has to belong to this backend alone.
 */
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

/** Is anything accepting TCP connections on this port? */
function isListening(port: number, host = '127.0.0.1', timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

test.describe('A3 — LAN exposure is off by default', () => {
  test('a fresh profile neither advertises nor binds the mobile API', async () => {
    const h = await backendWithOwnMobilePort('a3-lan-exposure-defaults');
    try {
      const settings = (await h.client.raw('GET', '/api/settings').then((r) => r.json())) as {
        device: { advertise: boolean; exposeMobileApi: boolean; mobileApiPort: number };
      };

      // ── the defaults themselves ─────────────────────────────────────
      expect(
        settings.device.advertise,
        'a new profile must not advertise over mDNS until asked',
      ).toBe(false);

      expect(
        settings.device.exposeMobileApi,
        'a new profile must not bind the mobile API on 0.0.0.0 until asked',
      ).toBe(false);

      // ── and the socket really is closed ─────────────────────────────
      //
      // The setting is not the control; the listener is. Asserting only the
      // boolean would have PASSED against the previous code, where the
      // listener ignored the flag entirely. This is the assertion that
      // would have caught it.
      const port = settings.device.mobileApiPort;
      expect(port, 'the seeded port must be the one in effect').toBe(h.mobileApiPort);
      expect(
        await isListening(port),
        `nothing must be listening on the mobile API port (${port}) by default — ` +
          'the flag is not the control, the socket is',
      ).toBe(false);
    } finally {
      await h.teardown();
    }
  });

  test('the two switches are independent', async () => {
    const h = await backendWithOwnMobilePort('a3-discovery-vs-exposure');
    try {
      // Turning on DISCOVERY must not open the listener. These used to be a
      // single switch, so a user enabling one silently got the other.
      const res = await h.client.raw('PUT', '/api/settings', {
        device: { advertise: true },
      });
      expect(res.ok, 'settings update should succeed').toBe(true);

      const after = (await h.client.raw('GET', '/api/settings').then((r) => r.json())) as {
        device: { advertise: boolean; exposeMobileApi: boolean; mobileApiPort: number };
      };

      expect(after.device.advertise, 'advertise should have been turned on').toBe(true);
      expect(
        after.device.exposeMobileApi,
        'enabling discovery must NOT enable API exposure',
      ).toBe(false);

      expect(
        await isListening(h.mobileApiPort),
        'enabling discovery must not open the mobile API socket',
      ).toBe(false);
    } finally {
      await h.teardown();
    }
  });
});
