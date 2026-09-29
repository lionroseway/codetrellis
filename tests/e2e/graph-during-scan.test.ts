/**
 * The canvas's graph answer while a scan runs (the "blank graph on rescan"
 * fix; frontend/lib/graph-answer.ts). A scan truncates the AST tables before
 * it refills them, so `/api/dependencies?include=cross_system` used to answer
 * 200 `[]` in that window, and a canvas took it as the graph. Now it answers
 * 503 `{ scanning: true }` until the scan lands, and afterwards names the
 * project its edges belong to.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('The graph answer during a scan', () => {
  test.setTimeout(180_000);
  let h: Harness;

  test.beforeAll(async () => { h = await setupHarness('graph-during-scan'); });
  test.afterAll(async () => { await h?.teardown(); });

  test('while a scan runs it says so; once it lands, the edges and whose they are', async () => {
    const root = h.fixture.projectPath;
    await h.client.scanProject(root);
    // A rescan, with a graph already there: what a canvas showing it is asked.
    const scan = h.client.raw('POST', '/api/project/scan', { projectPath: root });
    // Ask until the scan is seen running or has finished: a small fixture
    // scans quickly, so seeing it running is not guaranteed, but an empty
    // 200 must never come back while it runs.
    let sawScanning = false;
    let done = false;
    void scan.then(() => { done = true; });
    while (!done) {
      const res = await h.client.raw('GET', '/api/dependencies?include=cross_system');
      if (res.status === 503) {
        expect(await res.json()).toMatchObject({ scanning: true, project: root });
        expect(res.headers.get('retry-after')).toBe('1');
        sawScanning = true;
      } else {
        expect(res.status).toBe(200);
        const edges = (await res.json()) as unknown[];
        // Never the truncated table: an answer is the whole graph.
        expect(edges.length).toBeGreaterThan(0);
      }
    }
    expect((await scan).status).toBe(200);

    const after = await h.client.raw('GET', '/api/dependencies?include=cross_system');
    expect(after.status).toBe(200);
    expect(decodeURIComponent(after.headers.get('x-codetrellis-project') ?? '')).toBe(root);
    expect(((await after.json()) as unknown[]).length).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'saw-scanning', description: String(sawScanning) });
  });
});
