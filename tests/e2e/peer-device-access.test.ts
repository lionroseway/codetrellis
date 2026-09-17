/**
 * Phase 19, finding 15 — terminal access is granted per device, and recorded.
 *
 * WHAT WAS WRONG
 *
 * A paired device could enumerate the desktop's terminals, read their
 * scrollback, subscribe to live output and type into them. There was no
 * authorisation step of any kind, no way for the user to say which devices may
 * do it, and no record of which ones did.
 *
 * "Which devices may" and "which devices did" are different questions. The
 * capability matrix answers the first. These tests cover the second — the one
 * asked after a phone is lost, where the honest answer used to be "no idea".
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prepareFixture, startBackend, createClient } from '../harness';

const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const SECRET = 'a'.repeat(64);

/** A backend whose data dir already contains one paired device. */
async function seeded(name: string, capabilities?: string[]) {
  const fixture = prepareFixture(name);
  fs.mkdirSync(fixture.dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(fixture.dataDir, 'paired-devices.json'),
    JSON.stringify([{
      fingerprint: FP,
      pairingId: '00000000-1111-2222-3333-444444444444',
      alias: 'Seeded Phone',
      deviceType: 'mobile',
      pairedAt: new Date().toISOString(),
      lastConnected: null,
      sharedSecret: SECRET,
      instanceId: null,
      ...(capabilities ? { capabilities } : {}),
      confirmedAt: new Date().toISOString(),
    }], null, 2),
  );

  const backend = await startBackend({ dataDir: fixture.dataDir });
  const client = createClient(backend.baseUrl, backend.capabilityToken);
  return {
    client,
    dataDir: fixture.dataDir,
    teardown: async () => { await backend.stop(); fixture.cleanup(); },
  };
}

test.describe('15 — what a device may do is the user\'s decision', () => {
  test('the reconnect secret never leaves the backend', async () => {
    // This list feeds the settings UI and an MCP tool. The secret is the whole
    // proof a device presents to reconnect — serving the record whole would
    // hand any agent with MCP access a permanent pairing credential.
    const h = await seeded('device-access-no-secret');
    try {
      const raw = await h.client.raw('GET', '/api/peers/devices').then(r => r.text());
      expect(raw, 'the stored secret must not be in the response at all').not.toContain(SECRET);
      expect(raw).not.toContain('sharedSecret');

      const devices = JSON.parse(raw) as Array<{ hasSecret: boolean; alias: string }>;
      expect(devices).toHaveLength(1);
      expect(devices[0].hasSecret, 'but whether one EXISTS is worth knowing').toBe(true);
    } finally {
      await h.teardown();
    }
  });

  test('a newly-paired device has no terminal or settings access', async () => {
    const h = await seeded('device-access-defaults', ['read', 'write', 'project', 'files']);
    try {
      const devices = await h.client.raw('GET', '/api/peers/devices').then(r => r.json()) as
        Array<{ capabilities: string[] }>;
      expect(devices[0].capabilities).not.toContain('terminal');
      expect(devices[0].capabilities).not.toContain('settings');
      expect(devices[0].capabilities).toContain('read');
    } finally {
      await h.teardown();
    }
  });

  test('granting and revoking terminal access works, and both are recorded', async () => {
    const h = await seeded('device-access-grant', ['read']);
    try {
      const patch = (capabilities: string[]) =>
        h.client.raw('PATCH', `/api/peers/devices/${encodeURIComponent(FP)}`, { capabilities });

      const granted = await patch(['read', 'terminal']).then(r => r.json()) as { capabilities: string[] };
      expect(granted.capabilities).toContain('terminal');

      const revoked = await patch(['read']).then(r => r.json()) as { capabilities: string[] };
      expect(revoked.capabilities).not.toContain('terminal');

      // A capability granted for an afternoon and revoked leaves no trace in
      // the device record — and "was this phone ever allowed a shell?" is
      // exactly the question asked afterwards.
      const audit = await h.client.raw('GET', `/api/peers/audit?fingerprint=${encodeURIComponent(FP)}`)
        .then(r => r.json()) as { entries: Array<{ kind: string; detail?: string }> };

      const changes = audit.entries.filter(e => e.kind === 'capability-change');
      expect(changes.length, 'both the grant and the revoke must be recorded').toBe(2);
      expect(changes.map(e => e.detail).join(' | ')).toContain('granted terminal');
      expect(changes.map(e => e.detail).join(' | ')).toContain('revoked terminal');
    } finally {
      await h.teardown();
    }
  });

  test('an unrecognised capability name is dropped, not stored', async () => {
    // A typo that persisted would show as a grant in the settings UI and deny
    // at runtime — the worst of both.
    const h = await seeded('device-access-bad-name', ['read']);
    try {
      const res = await h.client.raw('PATCH', `/api/peers/devices/${encodeURIComponent(FP)}`, {
        capabilities: ['read', 'terminals', 'root', '__proto__'],
      }).then(r => r.json()) as { capabilities: string[] };

      expect(res.capabilities).toEqual(['read']);
    } finally {
      await h.teardown();
    }
  });

  test('patching an unknown device is a 404, not a silent success', async () => {
    const h = await seeded('device-access-unknown');
    try {
      const res = await h.client.raw('PATCH', '/api/peers/devices/NO:SUCH:DEVICE', {
        capabilities: ['read'],
      });
      expect(res.status).toBe(404);
    } finally {
      await h.teardown();
    }
  });

  test('the audit trail survives a restart', async () => {
    // A record that only lives in memory answers nothing after the event that
    // makes someone want to read it.
    const fixture = prepareFixture('device-access-durable');
    fs.mkdirSync(fixture.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixture.dataDir, 'paired-devices.json'),
      JSON.stringify([{
        fingerprint: FP, pairingId: 'p', alias: 'Phone', deviceType: 'mobile',
        pairedAt: new Date().toISOString(), lastConnected: null,
        sharedSecret: SECRET, instanceId: null, capabilities: ['read'],
        confirmedAt: new Date().toISOString(),
      }], null, 2),
    );

    let backend = await startBackend({ dataDir: fixture.dataDir });
    try {
      let client = createClient(backend.baseUrl, backend.capabilityToken);
      await client.raw('PATCH', `/api/peers/devices/${encodeURIComponent(FP)}`, {
        capabilities: ['read', 'terminal'],
      });

      // The audit log is flushed on a short timer so a burst of entries is not
      // a write per entry.
      await new Promise(r => setTimeout(r, 1500));
      await backend.stop();

      backend = await startBackend({ dataDir: fixture.dataDir });
      client = createClient(backend.baseUrl, backend.capabilityToken);
      const audit = await client.raw('GET', '/api/peers/audit').then(r => r.json()) as
        { entries: Array<{ kind: string; detail?: string }> };

      expect(audit.entries.some(e => e.kind === 'capability-change' && e.detail?.includes('granted terminal')))
        .toBe(true);
    } finally {
      await backend.stop();
      fixture.cleanup();
    }
  });
});
