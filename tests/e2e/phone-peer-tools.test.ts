/**
 * The peer MCP tools, with a phone actually connected (Phase 32 §0.4j).
 *
 * Until the harness had a peer these were only ever called with nothing on
 * the other end, which checks that they answer, not what they say. Here a
 * paired phone is connected, shares a terminal and asks a question, and each
 * tool is checked against it — and each refuses what is not there instead of
 * reporting `sent: false` as a success.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone, type ScriptedAgent } from '../harness';

test.describe.serial('Peer tools with a phone connected', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let phone: Phone;
  let agent: ScriptedAgent;

  const json = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return JSON.parse(res.text);
  };
  const refused = async (name: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name} ${JSON.stringify(args)}: ${res.text}`).toBe(true);
    return res.text;
  };

  test.beforeAll(async () => {
    h = await setupHarness('phone-peer-tools');
    await h.client.scanProject(h.fixture.projectPath);
    await h.client.grantMcpCapabilities(['read', 'write', 'terminal', 'settings', 'capture']);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    phone = await pairPhone(h.client, { alias: 'Tools phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await h?.teardown();
  });

  test('status, paired devices and connections name the phone', async () => {
    const status = await json('get_peer_status');
    expect(status).toMatchObject({ pairedDevices: 1, connectedPeers: 1, running: true });

    const paired = await json('list_paired_devices');
    const device = paired.devices.find((d: { fingerprint: string }) => d.fingerprint === phone.fingerprint);
    expect(device).toMatchObject({ alias: 'Tools phone', deviceType: 'mobile' });
    expect(JSON.stringify(paired), 'the reconnect secret is never handed to an agent').not.toMatch(/sharedSecret"\s*:\s*"[0-9a-f]{16,}/);

    const connections = await json('list_peer_connections');
    expect(connections.connections.find((c: { fingerprint: string }) => c.fingerprint === phone.fingerprint))
      .toMatchObject({ alias: 'Tools phone', state: 'connected' });
    expect(Array.isArray((await json('list_discovered_peers')).peers)).toBe(true);
  });

  test('get_remote_state returns what the peer sent; a peer that sent nothing is refused', async () => {
    expect(await refused('get_remote_state', { fingerprint: phone.fingerprint })).toMatch(/No state from this peer/);
    phone.sendUi({ type: 'snapshot', snapshot: { ...phone.state(), deviceAddresses: ['10.1.2.3'] }, ts: Date.now(), sourceInstanceId: 'harness-phone' });
    await expect.poll(async () => (await agent.callTool('get_remote_state', { fingerprint: phone.fingerprint })).isError, { timeout: 5000 }).not.toBe(true);
    expect((await json('get_remote_state', { fingerprint: phone.fingerprint })).deviceAddresses).toEqual(['10.1.2.3']);
    expect((await json('get_remote_state')).peerCount).toBe(1);
  });

  test('a peer\'s shared terminal: listed, and input reaches it; an unknown one is refused', async () => {
    phone.sendTerminal(Buffer.concat([Buffer.from([0x01]), Buffer.from(JSON.stringify([{ id: 'far-1', preset: 'shell', title: 'Far shell', cwd: '/far', alive: true, index: 0 }]))]));
    await expect.poll(async () => (await json('list_remote_terminals')).count, { timeout: 5000 }).toBe(1);
    expect((await json('list_remote_terminals', { fingerprint: phone.fingerprint })).terminals[0])
      .toEqual({ id: 'far-1', preset: 'shell', title: 'Far shell', cwd: '/far', alive: true, peerFingerprint: phone.fingerprint });

    const before = phone.terminal.length;
    expect(await json('write_remote_terminal', { fingerprint: phone.fingerprint, terminal_id: 'far-1', data: 'uptime\n' })).toMatchObject({ sent: true });
    await expect.poll(() => phone.terminal.slice(before).some((b) => b[0] === 0x03 && b[1] === 0 && b.subarray(2).toString() === 'uptime\n'), { timeout: 5000 }).toBe(true);
    expect(await refused('write_remote_terminal', { fingerprint: phone.fingerprint, terminal_id: 'no-such-terminal', data: 'x' })).toMatch(/not found/);
  });

  test('a peer\'s question: listed, answered once by the agent, then refused', async () => {
    phone.sendControl({ method: 'user-input-request', params: { requestId: 'q-1', prompt: 'Deploy now?' } });
    await expect.poll(async () => (await json('list_remote_input_requests')).count, { timeout: 5000 }).toBe(1);
    expect((await json('list_remote_input_requests')).requests[0]).toMatchObject({ requestId: 'q-1', prompt: 'Deploy now?' });
    expect(await json('respond_remote_input', { request_id: 'q-1', response: 'wait' })).toMatchObject({ sent: true });
    await phone.waitForControl((m) => m.method === 'user-input-response' && (m.params as { requestId: string }).requestId === 'q-1');
    expect(await refused('respond_remote_input', { request_id: 'q-1', response: 'go' })).toMatch(/not found or already answered/);
  });

  test('get_remote_audio reports the peer\'s audio status', async () => {
    const audio = await json('get_remote_audio');
    expect(audio).toMatchObject({ count: expect.any(Number) });
  });

  test('unpair_device disconnects and forgets the phone; an unknown device is refused', async () => {
    expect(await refused('unpair_device', { fingerprint: 'AA:BB:no-such-device' })).toMatch(/No device found/);
    expect(await json('unpair_device', { fingerprint: phone.fingerprint })).toMatchObject({ removed: true });
    expect((await json('list_paired_devices')).devices.map((d: { fingerprint: string }) => d.fingerprint)).not.toContain(phone.fingerprint);
    await expect.poll(async () => (await json('list_peer_connections')).connections.some((c: { fingerprint: string; state: string }) => c.fingerprint === phone.fingerprint && c.state === 'connected'), { timeout: 10_000 }).toBe(false);
  });
});
