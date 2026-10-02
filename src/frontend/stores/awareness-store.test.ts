/**
 * The awareness store (Phase 32 E1, E2b): one read at a time, and a read
 * that started before a person's answer never turns the card back.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAwarenessStore, resetAwarenessReads } from './awareness-store';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetAwarenessReads(); useAwarenessStore.setState({ root: null, signals: [], workstreams: [], loaded: false }); });

const signal = (state: string) => ({ id: 'sig1', kind: 'collision', state, severity: 'medium', title: 'Collision', replies: [] });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test('a read that started before an acknowledge does not write the card back to open, and another read follows', async () => {
  useAwarenessStore.setState({ root: '/p', signals: [signal('open')] as never, loaded: true });
  let awarenessReads = 0;
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((r) => { releaseFirst = r; });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/workstreams/commits')) return json({ commits: {} });
    if (u.startsWith('/api/workstreams')) return json([]);
    if (u.startsWith('/api/awareness?')) {
      awarenessReads++;
      // The first read is slow and answers with the list as it was before the click.
      if (awarenessReads === 1) { await firstHeld; return json({ signals: [signal('open')] }); }
      return json({ signals: [signal('acknowledged')] });
    }
    if (u.includes('/state') && init?.method === 'POST') return json(signal('acknowledged'));
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  const reading = useAwarenessStore.getState().refresh('/p');
  assert.equal(await useAwarenessStore.getState().answer('sig1', 'acknowledged' as never), null);
  assert.equal(useAwarenessStore.getState().signals[0].state, 'acknowledged');
  releaseFirst();
  await reading;
  assert.equal(useAwarenessStore.getState().signals[0].state, 'acknowledged');
  // The stale read asked for one more, which read the list as it is now.
  assert.equal(awarenessReads, 2);
});

test('refreshes asked for while one runs become one more read, not one each', async () => {
  useAwarenessStore.setState({ root: '/p', signals: [], loaded: true });
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.startsWith('/api/workstreams/commits')) return json({ commits: {} });
    if (u.startsWith('/api/workstreams')) return json([]);
    reads++;
    if (reads === 1) await held;
    return json({ signals: [] });
  }) as typeof fetch;
  const first = useAwarenessStore.getState().refresh('/p');
  const rest = [1, 2, 3, 4].map(() => useAwarenessStore.getState().refresh('/p'));
  release();
  await Promise.all([first, ...rest]);
  assert.equal(reads, 2);
});
