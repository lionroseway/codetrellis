/**
 * Phase 32 B8.4b — watching coverage land, in replay (JOURNEYS J2).
 *
 * Sam's project already has tested money helpers. An agent writes
 * packages/billing (an invoice and a tax module) with no tests: at that
 * moment the overlay says billing has none. It writes the billing tests,
 * runs them and hands over the report, 12 passing: at that moment both
 * files read "✓ 12 tests passing". Then tax.ts changes: from that moment
 * tax.ts reads "⚠ tests older than the code" while invoice.ts stays ✓.
 * Stepping back in replay, each moment says what it said then, on the graph
 * as it was then: the test file is not there before it was written.
 *
 * The timers are shortened (a frame at most every 200 ms).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const BILLING = 'packages/billing/src';
const UTIL = 'packages/billing-util/src';
const report = (file: string, n: number) => `<?xml version="1.0"?>\n<testsuites>\n<testsuite name="${file}">\n${
  Array.from({ length: n }, (_, i) => `<testcase classname="${path.basename(file)}" name="case ${i + 1}" file="${file}"/>`).join('\n')
}\n</testsuite>\n</testsuites>\n`;

interface MapAt {
  at?: number; frameAt?: number | null; hasResults: boolean; note?: string | null;
  files: Record<string, { state: string; words: string }>;
}
interface Frame { id: number; at: number; reasons: string[] }

test.describe.serial('The grounding overlay in replay', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let item: string;
  const moments: Record<'before' | 'untested' | 'tested' | 'changed', number> = { before: 0, untested: 0, tested: 0, changed: 0 };

  const write = (rel: string, body: string) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  const json = async <T>(url: string) => (await (await h.client.raw('GET', url)).json()) as T;
  const mapAt = (at?: number) => json<MapAt>(`/api/tests/grounding/map?project=${encodeURIComponent(root)}${at ? `&at=${at}` : ''}`);
  const frames = async () => (await json<{ frames: Frame[] }>(`/api/replay/frames?project=${encodeURIComponent(root)}`)).frames;
  /** A status change keeps a frame of the graph as it is now; the moment is that frame's. */
  let flip = 0;
  const moment = async (): Promise<number> => {
    const before = (await frames()).reduce((m, f) => Math.max(m, f.id), 0);
    expect((await h.client.raw('PUT', `/api/items/${item}`, { status: flip++ % 2 ? 'pending' : 'in_progress' })).status).toBe(200);
    const until = Date.now() + 15_000;
    for (;;) {
      const f = (await frames()).find((x) => x.id > before && x.reasons.includes('status'));
      if (f) return f.at;
      if (Date.now() > until) throw new Error('no frame for the status change');
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const handOver = async (rel: string, xml: string) => {
    write(rel, xml);
    const r = await agent.callTool('report_tests', { path: rel });
    expect(r.isError, r.text).toBeFalsy();
  };

  test.beforeAll(async () => {
    h = await setupHarness('grounding-replay', { env: { CODETRELLIS_FRAME_INTERVAL_MS: '200', CODETRELLIS_TURN_GAP_MS: '600000' } });
    root = h.fixture.projectPath;
    write(`${UTIL}/money.ts`, 'export const pence = (n: number) => Math.round(n * 100);\n');
    write(`${UTIL}/money.test.ts`, "import { pence } from './money';\nexport const t = pence(1);\n");
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
    const plan = await h.client.createPlan({ title: 'Billing', projectPath: root });
    item = ((await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title: 'Write billing' })).json()) as { uid: string }).uid;
    moments.before = await moment();
    await handOver('reports/util.xml', report(`${UTIL}/money.test.ts`, 2));
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('before any report: nothing to say', async () => {
    const m = await mapAt(moments.before);
    expect(m).toMatchObject({ at: moments.before, frameAt: moments.before, hasResults: false, files: {}, note: null });
  });

  test('billing written with no tests: the overlay says billing has none', async () => {
    write(`${BILLING}/invoice.ts`, "import { tax } from './tax';\nexport const total = (n: number) => n + tax(n);\n");
    write(`${BILLING}/tax.ts`, 'export const tax = (n: number) => n * 0.2;\n');
    await h.client.scanProject(root);
    moments.untested = await moment();
    const m = await mapAt(moments.untested);
    expect(m.hasResults).toBe(true);
    expect(m.files[`${UTIL}/money.ts`]).toEqual({ state: 'passing', words: '✓ 2 tests passing' });
    // No billing file is reached by a test: the overlay reads each as "○ no tests".
    expect(Object.keys(m.files).filter((f) => f.startsWith(BILLING))).toEqual([]);
  });

  test('the billing tests land, 12 passing: from that moment both files read ✓', async () => {
    write(`${BILLING}/invoice.test.ts`, "import { total } from './invoice';\nimport { tax } from './tax';\nexport const t = [total(1), tax(1)];\n");
    await h.client.scanProject(root);
    await handOver('reports/billing.xml', report(`${BILLING}/invoice.test.ts`, 12));
    moments.tested = await moment();
    const m = await mapAt(moments.tested);
    expect(m.files[`${BILLING}/invoice.ts`]).toEqual({ state: 'passing', words: '✓ 12 tests passing' });
    expect(m.files[`${BILLING}/tax.ts`]).toEqual({ state: 'passing', words: '✓ 12 tests passing' });
    expect(m.files[`${BILLING}/invoice.test.ts`]).toEqual({ state: 'passing', words: '✓ 12 tests passing' });
    // The moment before still says what it said then: the report came after it.
    expect(Object.keys((await mapAt(moments.untested)).files).filter((f) => f.startsWith(BILLING))).toEqual([]);
  });

  test('tax.ts changes after the run: from that moment it reads older than the code; before it, ✓', async () => {
    write(`${BILLING}/tax.ts`, 'export const tax = (n: number) => Math.round(n * 20) / 100;\n');
    // Seconds after the run, as an edit is: within 2 s the live overlay counts them as one moment.
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(root, BILLING, 'tax.ts'), later, later);
    await h.client.scanProject(root);
    moments.changed = await moment();
    const then = await mapAt(moments.changed);
    expect(then.files[`${BILLING}/tax.ts`]).toEqual({ state: 'stale', words: '⚠ tests older than the code: it changed after its 12 tests last ran' });
    expect(then.files[`${BILLING}/invoice.ts`]).toEqual({ state: 'passing', words: '✓ 12 tests passing' });
    expect((await mapAt(moments.tested)).files[`${BILLING}/tax.ts`].state).toBe('passing');
    // Live, the overlay says the same of tax.ts now.
    expect((await mapAt()).files[`${BILLING}/tax.ts`].state).toBe('stale');
  });

  test('a moment with no frame yet has no graph to mark; a bad time is refused', async () => {
    expect(await mapAt(moments.before - 60_000)).toMatchObject({ frameAt: null, files: {} });
    expect((await h.client.raw('GET', `/api/tests/grounding/map?project=${encodeURIComponent(root)}&at=soon`)).status).toBe(400);
  });
});
