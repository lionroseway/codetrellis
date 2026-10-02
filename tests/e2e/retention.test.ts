/**
 * Phase 32 B10.2 — how long the record is kept, end to end.
 *
 * Sam's team must keep a year of evidence. He sets "Keep the record for" to
 * a year: the change is itself kept in the record (from 14 days to a year,
 * and who), the record still verifies, and a value that is not one of the
 * choices is refused with what it must be. Set back to 14 days, a log file
 * older than the window goes at once. From plain HTTP, with grants off, the
 * change is refused with where to make it: shortening the window removes
 * evidence, so no agent or script may.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import type { RecordCheck } from '../../src/shared/types/record';

interface Stored { type: string; payload: Record<string, unknown> }

test.describe.serial('Retention you can set', () => {
  test.setTimeout(120_000);
  let h: Harness;

  const settings = async () => (await (await h.client.raw('GET', '/api/settings')).json()) as { data: Record<string, unknown> };
  const setRetention = async (retentionDays: number | null) => {
    const now = await settings();
    return h.client.raw('PUT', '/api/settings', { data: { ...now.data, retentionDays } });
  };
  const events = async () => ((await (await h.client.raw('GET', '/api/agent-events?limit=2000')).json()) as { events: Stored[] }).events;

  test.beforeAll(async () => { h = await setupHarness('retention'); });
  test.afterAll(async () => { await h?.teardown(); });

  test('14 days unless chosen; set to a year, the change is kept in the record with who, and the record verifies', async () => {
    expect((await settings()).data.retentionDays).toBe(14);
    const res = await setRetention(365);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await settings()).data.retentionDays).toBe(365);

    await expect.poll(async () => (await events()).filter((e) => e.type === 'retention_changed').length, { timeout: 10_000 }).toBe(1);
    const changed = (await events()).find((e) => e.type === 'retention_changed')!;
    // Who, from how the call arrived: the harness speaks plain HTTP.
    expect(changed.payload).toMatchObject({ from: 14, to: 365, fromWords: '14 days', toWords: 'a year', authorType: 'unverified' });

    const r = (await (await h.client.raw('GET', '/api/record')).json()) as RecordCheck;
    expect(r.ok, r.words).toBe(true);
  });

  test('a window that is not one of the choices is refused with what it must be, and nothing changes', async () => {
    const res = await setRetention(7);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('data.retentionDays must be 14, 30, 90 or 365 days, or null to keep everything');
    expect((await settings()).data.retentionDays).toBe(365);
  });

  test('shortened, it applies at once: a log file older than the window goes; keeping everything keeps it', async () => {
    const logs = path.join(h.fixture.dataDir, 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const old = path.join(logs, '2020-01-01.log');
    const other = path.join(logs, 'notes.txt');
    fs.writeFileSync(old, 'old\n');
    fs.writeFileSync(other, 'not a daily log\n');

    expect((await setRetention(null)).status).toBe(200);
    expect(fs.existsSync(old)).toBe(true);

    expect((await setRetention(14)).status).toBe(200);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(other), 'only YYYY-MM-DD.log files are ever removed').toBe(true);
    expect((await events()).filter((e) => e.type === 'retention_changed').map((e) => [e.payload.fromWords, e.payload.toWords]))
      .toEqual([['14 days', 'a year'], ['a year', 'everything'], ['everything', '14 days']]);
  });
});

test.describe.serial('Retention from plain HTTP, grants off', () => {
  test.setTimeout(120_000);
  let h: Harness;
  test.beforeAll(async () => { h = await setupHarness('retention-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } }); });
  test.afterAll(async () => { await h?.teardown(); });

  test('changing it is refused with where to change it; reading it is not; other Data settings still save', async () => {
    const now = ((await (await h.client.raw('GET', '/api/settings')).json()) as { data: Record<string, unknown> });
    const refused = await h.client.raw('PUT', '/api/settings', { data: { ...now.data, retentionDays: null } });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe('Only you can change data.retentionDays — in the CodeTrellis app, Settings → Data.');
    const after = ((await (await h.client.raw('GET', '/api/settings')).json()) as { data: { retentionDays: unknown } });
    expect(after.data.retentionDays).toBe(14);
    // The Settings window saves whole sections: an unchanged window riding along is not a grant.
    expect((await h.client.raw('PUT', '/api/settings', { data: { ...now.data, personalSyncMode: 'none' } })).status).toBe(200);
  });
});
