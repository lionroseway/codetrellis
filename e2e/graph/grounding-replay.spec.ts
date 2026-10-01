/**
 * Watching coverage land, in replay (Phase 32 B8.4b, JOURNEYS J2).
 *
 * Sam replays the last hour with Overlays → Test grounding on. At the first
 * moment the billing cluster reads "○ 2": its two files have no tests. At
 * the next, its tests have landed: "✓ 3", the test file now there too. At
 * the last, tax.ts changed after they ran: "⚠ 1 · ✓ 2". The canvas says the
 * marks are the tests as reported by then. Back to live, the overlay asks
 * for now again.
 *
 * The moments are served (the backend's answer at a past moment is
 * tests/e2e/grounding-replay.test.ts, against a real backend).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const MIN = 60_000;
const now = Date.now();

const frame = (id: number, at: number) => ({
  id, at, reasons: ['turn-end'], ref: null, sessionId: `s-${id}`, agentType: 'claude-code', workstreamRoot: null,
  commitSha: null, branch: 'main', sameAs: null, fileCount: 4, edgeCount: 3,
});
const FRAMES = [frame(21, now - 50 * MIN), frame(22, now - 30 * MIN), frame(23, now - 10 * MIN)];

const CODE = [
  { source: 'src/billing/invoice.ts', target: 'src/billing/tax.ts', specifiers: ['tax'] },
  { source: 'src/billing/invoice.ts', target: 'src/util/money.ts', specifiers: ['pence'] },
  { source: 'src/util/money.test.ts', target: 'src/util/money.ts', specifiers: ['pence'] },
];
const TESTS = [
  { source: 'src/billing/invoice.test.ts', target: 'src/billing/invoice.ts', specifiers: ['total'] },
  { source: 'src/billing/invoice.test.ts', target: 'src/billing/tax.ts', specifiers: ['tax'] },
];
const graphOf = (id: number) => {
  const edges = id === 21 ? CODE : [...CODE, ...TESTS];
  const files = [...new Set(edges.flatMap((e) => [e.source, e.target]))].map((p) => ({ path: p, contentHash: p, language: 'typescript', symbolCount: 1 }));
  return { id, data: { files, edges } };
};

const PASS12 = { state: 'passing', words: '✓ 12 tests passing' };
const MONEY = { 'src/util/money.ts': { state: 'passing', words: '✓ 2 tests passing' }, 'src/util/money.test.ts': { state: 'passing', words: '✓ 2 tests passing' } };
const mapAt = (at: number) => {
  const f = [...FRAMES].reverse().find((x) => x.at <= at)!;
  const files: Record<string, { state: string; words: string }> = { ...MONEY };
  if (f.id >= 22) Object.assign(files, { 'src/billing/invoice.ts': PASS12, 'src/billing/tax.ts': PASS12, 'src/billing/invoice.test.ts': PASS12 });
  if (f.id === 23) files['src/billing/tax.ts'] = { state: 'stale', words: '⚠ tests older than the code: it changed after its 12 tests last ran' };
  return { at, frameAt: f.at, hasResults: true, files, counts: {}, note: null };
};

async function serve(page: Page, asked: string[]) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/replay/frames?*', (r) => r.fulfill(json({ frames: FRAMES })));
  await page.route('**/api/replay/state?*', (r) => {
    const at = Number(new URL(r.request().url()).searchParams.get('at'));
    const f = [...FRAMES].reverse().find((x) => x.at <= at) ?? null;
    return r.fulfill(json({ at, projectPath: '/work/acme', frame: f, sinceFrame: null, tasks: [], signals: [], waiting: [] }));
  });
  await page.route(/\/api\/trellis\/2[123]$/, (r) => r.fulfill(json(graphOf(Number(r.request().url().slice(-2))))));
  await page.route('**/api/tests/grounding/map?*', (r) => {
    const at = new URL(r.request().url()).searchParams.get('at');
    asked.push(at ?? 'live');
    return r.fulfill(json(at ? mapAt(Number(at)) : { hasResults: false, files: {} }));
  });
}

test.describe('The grounding overlay in replay', () => {
  test.setTimeout(120_000);
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });

  test('billing goes from ○ no tests to ✓ as its tests land, then ⚠ when the code moves on', async ({ page }) => {
    const asked: string[] = [];
    await serve(page, asked);
    await page.addInitScript(() => { try { localStorage.removeItem('codetrellis.graphOverlays'); } catch { /* */ } });
    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();
    await page.getByTestId('replay-start').click();
    const bar = page.getByTestId('replay-bar');
    await expect(bar).toBeVisible();

    const marks = () => page.getByTestId('node-grounding').allTextContents();
    /** The billing cluster, photographed by its mark, with the canvas's note. */
    const shoot = async (mark: string, name: string) => {
      const node = page.locator('.react-flow__node').filter({ has: page.getByTestId('node-grounding').filter({ hasText: mark }) }).first();
      fs.mkdirSync(OUT, { recursive: true });
      await node.screenshot({ path: path.join(OUT, `${name}.png`) });
    };
    const pill = page.getByTestId('replay-canvas');
    // The first moment: billing written, no tests yet.
    await expect.poll(marks, { timeout: 15_000 }).toContain('○ 2');
    await expect(pill).toContainText(/As it was at \d\d:\d\d · 4 files · tests as reported by then · replaying/);
    expect(asked).toContain(String(FRAMES[0].at));
    await shoot('○ 2', 'grounding-replay-before');
    await pill.screenshot({ path: path.join(OUT, 'grounding-replay-pill.png') });

    // The tests land: every billing file ✓, the test file there too.
    await bar.getByTitle('Next frame').click();
    await expect.poll(marks, { timeout: 15_000 }).toContain('✓ 3');
    expect(await marks()).not.toContain('○ 2');

    // tax.ts changes after they ran.
    await bar.getByTitle('Next frame').click();
    await expect.poll(marks, { timeout: 15_000 }).toContain('⚠ 1 · ✓ 2');
    await shoot('⚠ 1 · ✓ 2', 'grounding-replay-after');

    // Back to live: the overlay asks for now.
    const before = asked.length;
    await page.getByTestId('replay-live').click();
    await expect.poll(() => asked.slice(before)).toContain('live');
  });
});
