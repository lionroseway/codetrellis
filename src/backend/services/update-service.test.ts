/**
 * The update check is the one request CodeTrellis makes on its own, so a
 * person can turn it off — and off has to mean no request, not a request
 * whose answer is ignored.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-update-service-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

const realFetch = globalThis.fetch;
const requested: string[] = [];
globalThis.fetch = (async (url: string | URL | Request) => {
  requested.push(String(url));
  return new Response('{}', { status: 503 });
}) as typeof fetch;

after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('with automatic checks off, starting the poller requests nothing', async () => {
  const settings = await import('./settings-service');
  const updates = await import('./update-service');
  assert.equal(settings.getSettings().updates.autoCheck, true, 'on by default');

  settings.updateSettings({ updates: { autoCheck: false } });
  updates.startUpdatePolling();
  await new Promise((r) => setTimeout(r, 50));
  updates.stopUpdatePolling();
  assert.deepEqual(requested, []);

  // And on again, it checks — so the test above is not passing because
  // the poller never checks at all.
  settings.updateSettings({ updates: { autoCheck: true } });
  updates.startUpdatePolling();
  await new Promise((r) => setTimeout(r, 50));
  updates.stopUpdatePolling();
  assert.ok(requested.length > 0, 'a check was made');
  assert.ok(requested.every((u) => !/[?&](id|machine|user)=/i.test(u)), `nothing identifying is sent: ${requested.join(', ')}`);
});

test('the setting survives a settings file that lacks it or holds nonsense', async () => {
  const { mergeWithDefaults } = await import('./settings-service');
  assert.equal(mergeWithDefaults({}).updates.autoCheck, true);
  assert.equal(mergeWithDefaults({ updates: { autoCheck: 'no' } }).updates.autoCheck, true);
  assert.equal(mergeWithDefaults({ updates: { autoCheck: false } }).updates.autoCheck, false);
});
