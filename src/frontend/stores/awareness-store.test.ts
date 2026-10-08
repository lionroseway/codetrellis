/**
 * The awareness store (Phase 32 E1, E2b): one read at a time, and a read
 * that started before a person's answer never turns the card back.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAwarenessStore, resetAwarenessReads } from './awareness-store';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetAwarenessReads(); useAwarenessStore.setState({ root: null, signals: [], workstreams: [], loaded: false, workstreamsLoaded: false }); });

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

test('the signals are shown as soon as they answer; the lines of work fill in when the slower listing lands', async () => {
  useAwarenessStore.setState({ root: '/p', signals: [], workstreams: [], loaded: false, workstreamsLoaded: false });
  let releaseListing!: () => void;
  const listingHeld = new Promise<void>((r) => { releaseListing = r; });
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.startsWith('/api/workstreams/commits')) return json({ commits: {} });
    if (u.startsWith('/api/workstreams')) { await listingHeld; return json([{ root: '/p/wt', branch: 'b', idle: false }]); }
    if (u.startsWith('/api/awareness?')) return json({ signals: [signal('open')] });
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  const reading = useAwarenessStore.getState().refresh('/p');
  for (let i = 0; i < 20 && !useAwarenessStore.getState().loaded; i++) await new Promise((r) => setTimeout(r, 5));
  const early = useAwarenessStore.getState();
  assert.equal(early.loaded, true, 'the tab opens on the signals');
  assert.equal(early.signals.length, 1);
  assert.equal(early.workstreamsLoaded, false, 'and knows the listing has not landed');
  releaseListing();
  await reading;
  const done = useAwarenessStore.getState();
  assert.equal(done.workstreamsLoaded, true);
  assert.deepEqual(done.workstreams.map((w) => w.root), ['/p/wt']);
});
