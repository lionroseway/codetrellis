/**
 * The audio capture routes (Phase 32 §0.4i).
 *
 * The window records from the microphone in chunks and posts them here; an
 * agent (with the `capture` capability) reads the recent audio back. Five
 * routes had no test: start, chunk, status, recent, stop.
 *
 * Writing it found bug 35: nothing about a request was checked. A
 * `maxBufferSeconds` that is not a number made the window NaN, so the
 * buffer was never trimmed and grew without bound; a `durationMs` sent as
 * text was added with `+`, so "10" concatenated and bufferedSeconds went to
 * nonsense; and a start that named no size silently kept the previous one.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

interface Status { capturing: boolean; bufferedSeconds: number; chunkCount: number; maxBufferSeconds: number; startedAt: string | null }

test.describe.serial('Audio capture routes', () => {
  test.setTimeout(60_000);

  let h: Harness;
  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const chunk = (text: string, durationMs: number) => ({ audioBase64: Buffer.from(text).toString('base64'), durationMs });

  test.beforeAll(async () => { h = await setupHarness('audio-rest'); });
  test.afterAll(async () => { await h?.teardown(); });

  test('before anything is captured: not capturing, nothing to read', async () => {
    const status = (await req('GET', '/api/audio/status')) as Status;
    expect(status).toMatchObject({ capturing: false, chunkCount: 0, bufferedSeconds: 0 });
    expect((await h.client.raw('GET', '/api/audio/recent')).status).toBe(404);
    // A chunk while not capturing is refused, not buffered.
    expect((await h.client.raw('POST', '/api/audio/chunk', chunk('x', 1000))).status).toBe(409);
  });

  test('start, chunks in, the recent audio out in order; a window of seconds narrows it', async () => {
    const started = (await req('POST', '/api/audio/start', { maxBufferSeconds: 60 })) as Status;
    expect(started).toMatchObject({ capturing: true, chunkCount: 0, maxBufferSeconds: 60 });
    expect(started.startedAt).toBeTruthy();

    expect(await req('POST', '/api/audio/chunk', chunk('first-', 2000))).toEqual({ accepted: true, bufferedSeconds: 2 });
    expect(await req('POST', '/api/audio/chunk', chunk('second', 1500))).toEqual({ accepted: true, bufferedSeconds: 3.5 });

    const recent = await req('GET', '/api/audio/recent');
    expect(Buffer.from(recent.audioBase64, 'base64').toString()).toBe('first-second');
    expect(recent).toMatchObject({ mimeType: 'audio/webm;codecs=opus', durationSeconds: 3.5, chunkCount: 2 });
    expect(Date.parse(recent.endsAt)).toBeGreaterThan(Date.parse(recent.startsAt));

    expect((await req('GET', '/api/audio/recent?seconds=30')).chunkCount).toBe(2);
  });

  test('stop keeps what was captured and refuses more; a new start clears it', async () => {
    expect(await req('POST', '/api/audio/stop')).toMatchObject({ capturing: false, chunkCount: 2 });
    expect((await h.client.raw('POST', '/api/audio/chunk', chunk('late', 1000))).status).toBe(409);
    expect((await req('GET', '/api/audio/recent')).chunkCount).toBe(2);

    // No size named: the default, not whatever the last start chose (bug 35).
    const again = (await req('POST', '/api/audio/start', {})) as Status;
    expect(again).toMatchObject({ capturing: true, chunkCount: 0, maxBufferSeconds: 120 });
    expect((await h.client.raw('GET', '/api/audio/recent')).status).toBe(404);
  });

  test('a request that is not one is refused, and the buffer stays sane (bug 35)', async () => {
    for (const body of [{ maxBufferSeconds: 'abc' }, { maxBufferSeconds: -5 }, { maxBufferSeconds: 10_000_000 }]) {
      expect((await h.client.raw('POST', '/api/audio/start', body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const body of [
      {},
      { audioBase64: Buffer.from('x').toString('base64') },
      chunk('x', 0),
      { audioBase64: Buffer.from('x').toString('base64'), durationMs: '10' },
      chunk('x', -100),
      { audioBase64: 42, durationMs: 1000 },
    ]) {
      expect((await h.client.raw('POST', '/api/audio/chunk', body)).status, JSON.stringify(body)).toBe(400);
    }
    const status = (await req('GET', '/api/audio/status')) as Status;
    expect(status).toMatchObject({ capturing: true, chunkCount: 0, bufferedSeconds: 0, maxBufferSeconds: 120 });
    await req('POST', '/api/audio/stop');
  });
});
