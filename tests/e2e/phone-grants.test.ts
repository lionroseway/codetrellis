/**
 * The raw relays answer to a device's grants, including grants changed while
 * it is connected (Phase 32 §0.4k).
 *
 * Owner's decision: the microphone goes to a paired device only when
 * "Share audio capture" is on AND that device holds `capture` — the switch
 * alone shared it with every connected device. And a grant takes effect at
 * once: a device granted `terminal` or `capture` gets what a connecting
 * device would, instead of nothing until it reconnects.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone } from '../harness';

const AUDIO_STATUS = 0x01;
const TERMINAL_LIST = 0x01;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe.serial('Relays follow the device\'s grants', () => {
  test.setTimeout(90_000);

  let h: Harness;
  let phone: Phone;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };

  test.beforeAll(async () => {
    h = await setupHarness('phone-grants');
    await h.client.scanProject(h.fixture.projectPath);
    await req('PUT', '/api/settings', { device: { shareAudio: true } });
    phone = await pairPhone(h.client, { alias: 'Grants phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await h?.teardown();
  });

  test('sharing on, no capture grant: the phone is sent nothing about the microphone', async () => {
    await pause(1500);
    expect(phone.audio, 'audio frames reached a device without the capture grant').toEqual([]);
  });

  test('granted capture while connected: the capture state arrives at once', async () => {
    await phone.grant(['read', 'write', 'project', 'files', 'capture']);
    await expect.poll(() => phone.audio.length, { timeout: 5000 }).toBeGreaterThan(0);
    const frame = phone.audio[0];
    expect(frame[0]).toBe(AUDIO_STATUS);
    expect(JSON.parse(frame.subarray(1).toString())).toMatchObject({ capturing: false });
  });

  test('sharing off: a capture grant alone sends nothing', async () => {
    await phone.grant(['read', 'write', 'project', 'files']);
    await req('PUT', '/api/settings', { device: { shareAudio: false } });
    const before = phone.audio.length;
    await phone.grant(['read', 'write', 'project', 'files', 'capture']);
    await pause(1000);
    expect(phone.audio.length).toBe(before);
  });

  test('granted terminal while connected: the terminal list arrives at once, not at the next reconnect', async () => {
    const shell = await req('POST', '/api/terminals', { preset: 'shell', title: 'Granted later', cwd: h.fixture.projectPath });
    await pause(500);
    expect(phone.terminal.some((b) => b[0] === TERMINAL_LIST), 'the list went to a device without the grant').toBe(false);
    await phone.grant(['read', 'write', 'project', 'files', 'terminal']);
    await expect.poll(() => phone.terminal.some((b) => b[0] === TERMINAL_LIST && b.subarray(1).toString().includes(shell.id)), { timeout: 5000 }).toBe(true);
    await req('DELETE', `/api/terminals/${shell.id}`);
  });
});
