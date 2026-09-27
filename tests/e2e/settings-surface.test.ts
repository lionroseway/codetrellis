/**
 * Settings, checked for what they keep (Phase 32 §0.4k).
 *
 * Twenty-odd harness tests call GET/PUT /api/settings, almost all to set one
 * thing up. Not checked: that what is saved is what comes back after a
 * restart, that a value which is not one is refused, and that the other
 * windows are told. Writing this found that writes checked almost nothing
 * (loading checked everything), so a bad value was used as sent and then
 * silently became the default at the next restart.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, openEventStream, startBackend, createClient, type Harness, type EventStream } from '../harness';

test.describe.serial('Settings', () => {
  test.setTimeout(90_000);

  let h: Harness;
  let events: EventStream;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };

  test.beforeAll(async () => {
    h = await setupHarness('settings-surface');
    events = await openEventStream(h.backend);
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('every section is there, and a partial save changes only what it names', async () => {
    const before = await req('GET', '/api/settings');
    expect(Object.keys(before).sort()).toEqual(
      ['data', 'device', 'firstRunComplete', 'identity', 'mcp', 'plans', 'power', 'updatedAt', 'updates', 'webhooks'],
    );
    const saved = await req('PUT', '/api/settings', {
      identity: { displayName: 'Dana' },
      plans: { defaultVisibility: 'local' },
      power: { triggers: { whileAgentActive: true } },
      webhooks: { allowedHosts: ['Hooks.Example.COM ', '*.evil.test', 'hooks.example.com'] },
    });
    expect(saved.identity).toEqual({ ...before.identity, displayName: 'Dana' });
    expect(saved.plans).toEqual({ ...before.plans, defaultVisibility: 'local' });
    // A nested partial keeps its siblings.
    expect(saved.power.triggers).toEqual({ ...before.power.triggers, whileAgentActive: true });
    // Hosts normalised; a wildcard is not a host.
    expect(saved.webhooks.allowedHosts).toEqual(['hooks.example.com']);
    expect(saved.mcp).toEqual(before.mcp);
    await events.waitFor('settings-changed', (p) => p.settings?.identity?.displayName === 'Dana');
  });

  test('a value that is not one is refused with the reason, and nothing is stored', async () => {
    const before = await req('GET', '/api/settings');
    const refusals: Array<[Record<string, unknown>, RegExp]> = [
      [{ mcp: { port: 'abc' } }, /mcp\.port must be a port/],
      [{ mcp: { port: 80 } }, /mcp\.port must be a port/],
      [{ mcp: { capabilities: ['read', 'everything'] } }, /mcp\.capabilities must be a list of/],
      [{ mcp: { projectScope: 'everywhere' } }, /mcp\.projectScope/],
      [{ plans: { defaultVisibility: 'public' } }, /plans\.defaultVisibility/],
      [{ identity: { email: 42 } }, /identity\.email must be text/],
      [{ device: { exposeMobileApi: 'yes' } }, /device\.exposeMobileApi must be true or false/],
      [{ device: { mobileApiPort: -1 } }, /device\.mobileApiPort/],
      [{ power: { triggers: { always: 'on' } } }, /power\.triggers\.always/],
      [{ updates: { autoCheck: 'no' } }, /updates\.autoCheck/],
      [{ webhooks: { allowedHosts: 'hooks.example.com' } }, /webhooks\.allowedHosts/],
      [{ data: { personalSyncMode: 'sometimes' } }, /data\.personalSyncMode/],
      [{ firstRunComplete: 'true' }, /firstRunComplete/],
      [{ device: 'on' }, /device must be an object/],
    ];
    for (const [body, reason] of refusals) {
      const res = await h.client.raw('PUT', '/api/settings', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error, JSON.stringify(body)).toMatch(reason);
    }
    const after = await req('GET', '/api/settings');
    expect({ ...after, updatedAt: '' }).toEqual({ ...before, updatedAt: '' });
  });

  test('first-run check: incomplete, then complete once saved', async () => {
    expect((await req('GET', '/api/settings/first-run-check')).firstRunComplete).toBe(false);
    await req('PUT', '/api/settings', { firstRunComplete: true, identity: { email: 'dana@example.com' } });
    const check = await req('GET', '/api/settings/first-run-check');
    expect(check.firstRunComplete).toBe(true);
    expect(JSON.stringify(check)).toContain('dana@example.com');
  });

  test('what was saved is what comes back after a restart', async () => {
    const saved = await req('PUT', '/api/settings', {
      device: { deviceName: 'Dana laptop', shareAudio: true },
      updates: { autoCheck: false },
      mcp: { capabilities: ['read', 'write', 'terminal'], projectScope: 'anywhere' },
    });
    await h.backend.stop();
    const again = await startBackend({ dataDir: h.fixture.dataDir });
    try {
      const client = createClient(again.baseUrl, again.capabilityToken);
      const reloaded = await (await client.raw('GET', '/api/settings')).json();
      expect({ ...reloaded, updatedAt: '' }).toEqual({ ...saved, updatedAt: '' });
    } finally {
      await again.stop();
    }
  });

  test('logs: the path names today\'s file in the data dir; the tail answers without a file logger, and takes only a number', async () => {
    // A fresh backend: the one this suite started was stopped for the restart.
    const b = await startBackend({ dataDir: h.fixture.dataDir });
    try {
      const client = createClient(b.baseUrl, b.capabilityToken);
      const where = await (await client.raw('GET', '/api/logs/path')).json();
      expect(where.logDir.startsWith(h.fixture.dataDir)).toBe(true);
      expect(where.logFile.startsWith(where.logDir)).toBe(true);
      expect(where.logFile).toMatch(/\d{4}-\d{2}-\d{2}\.log$/);

      const tail = await client.raw('GET', '/api/logs/tail?maxBytes=100');
      expect(tail.ok).toBe(true);
      // The harness runs without the file logger, and the tail says so, so the
      // panel can tell "not writing a file" from "nothing logged yet" (0.5).
      expect(await tail.json()).toMatchObject({ path: where.logFile, content: expect.any(String), writing: false });
      expect((await client.raw('GET', '/api/logs/tail?maxBytes=abc')).status).toBe(400);
      expect((await client.raw('GET', '/api/logs/tail?maxBytes=-5')).status).toBe(400);
    } finally {
      await b.stop();
    }
  });
});
