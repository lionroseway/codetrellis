/**
 * Granting is the person's (owner's decision, Phase 32).
 *
 * Every agent can read the capability token, and the token opens the REST API
 * as well as MCP — so a grant an agent could make over HTTP was a grant the
 * MCP matrix had refused it. This backend runs with test-mode grants OFF, as
 * a real one does: from plain HTTP and from MCP, every change that widens
 * reach is refused and says where the person makes it. (The app window's
 * requests arrive over Electron IPC; that marking is unit-tested in
 * ipc-dispatcher.test.ts.)
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

test.describe.serial('Only the person grants', () => {
  test.setTimeout(90_000);

  let h: Harness;
  let agent: ScriptedAgent;

  test.beforeAll(async () => {
    // The agent holds `settings`, granted by the person beforehand (in the
    // file, as the app would have written it) — so what is checked below is
    // the grant rule, not the capability gate in front of it.
    h = await setupHarness('grant-guard', {
      env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' },
      settings: { updates: { autoCheck: false }, mcp: { capabilities: ['read', 'write', 'project', 'files', 'settings'] } },
    });
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('over plain HTTP: every grant refused with where to make it; nothing changes', async () => {
    const before = await (await h.client.raw('GET', '/api/settings')).json();
    for (const [body, field, where] of [
      [{ mcp: { capabilities: ['read', 'write', 'terminal', 'settings'] } }, 'mcp.capabilities', 'Settings → MCP Server'],
      [{ mcp: { projectScope: 'anywhere' } }, 'mcp.projectScope', 'Settings → MCP Server'],
      [{ device: { exposeMobileApi: true } }, 'device.exposeMobileApi', 'Settings → Devices'],
      [{ device: { advertise: true } }, 'device.advertise', 'Settings → Devices'],
      [{ device: { shareAudio: true } }, 'device.shareAudio', 'Settings → Devices'],
      [{ webhooks: { allowedHosts: ['evil.example.com'] } }, 'webhooks.allowedHosts', 'Settings → Plans'],
      [{ webhooks: { allowLoopback: true } }, 'webhooks.allowLoopback', 'Settings → Plans'],
      [{ git: { keepRemotesCurrent: true } }, 'git.keepRemotesCurrent', 'Settings → Git'],
    ] as const) {
      const res = await h.client.raw('PUT', '/api/settings', body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect((await res.json()).error).toBe(`Only you can change ${field} — in the CodeTrellis app, ${where}.`);
    }
    const after = await (await h.client.raw('GET', '/api/settings')).json();
    expect({ ...after, updatedAt: '' }).toEqual({ ...before, updatedAt: '' });
  });

  test('over plain HTTP: what does not grant still saves, even with an unchanged grant riding along', async () => {
    const now = await (await h.client.raw('GET', '/api/settings')).json();
    const res = await h.client.raw('PUT', '/api/settings', { mcp: { ...now.mcp, autodetectOnCollision: !now.mcp.autodetectOnCollision }, identity: { displayName: 'Dana' } });
    expect(res.ok).toBe(true);
    expect((await res.json()).identity.displayName).toBe('Dana');
  });

  test('over plain HTTP: device grants and confirming a pairing are refused', async () => {
    const patch = await h.client.raw('PATCH', '/api/peers/devices/AA:BB', { capabilities: ['read', 'terminal'] });
    expect(patch.status).toBe(403);
    expect((await patch.json()).error).toMatch(/Only you can change a device's capabilities/);
    // Renaming is not granting.
    expect((await h.client.raw('PATCH', '/api/peers/devices/AA:BB', { alias: 'x' })).status).not.toBe(403);

    const confirm = await h.client.raw('POST', '/api/pairing/confirm', { code: '123456', alias: 'Sneaky' });
    expect(confirm.status).toBe(403);
    expect((await confirm.json()).error).toMatch(/Only you can change pairings/);
  });

  test('over MCP: an agent cannot turn on advertising or audio sharing; other settings still save', async () => {
    for (const device of [{ advertise: true }, { shareAudio: true }]) {
      const res = await agent.callTool('update_settings', { device });
      expect(res.isError, JSON.stringify(device)).toBe(true);
      expect(res.text).toMatch(/^Only you can change device\./);
    }
    const ok = await agent.callTool('update_settings', { identity: { displayName: 'Set by the agent' } });
    expect(ok.isError, ok.text).not.toBe(true);
  });
});
