/**
 * Test grounding on the graph (Phase 32 B8.3a).
 *
 * Sam turns on Overlays → Test grounding. A file whose tests failed on the
 * last run handed over reads ✗, with why in words on hover; one changed
 * after its tests ran reads ⚠ "tests older than the code"; a file no test
 * reaches reads ○. In the cluster view each cluster sums its files ("✗ 1 ·
 * ✓ 1"). Before any report the overlay draws nothing: "no tests" on every
 * node would say nothing.
 *
 * The map is served, on whichever file nodes are reachable (the layout is
 * not fixed); the backend's side, the same answer per file as the Inspector,
 * is tests/e2e/test-grounding.test.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator } from '@playwright/test';
import { gotoWithProject, reachableNodes, FIXTURE_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');

test.describe('Test grounding on the graph', () => {
  test.setTimeout(120_000);
  // Three device pixels per CSS pixel: the fixture's nodes are small at the
  // layout's own zoom, and zooming in moves them under the minimap.
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });

  test('files read ✗, ⚠, ✓ or ○ with words on hover; clusters sum them; nothing before any report', async ({ page }) => {
    let map: { hasResults: boolean; files: Record<string, { state: string; words: string }> } = { hasResults: false, files: {} };
    await page.route('**/api/tests/grounding/map?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(map) }));
    await page.addInitScript(() => { try { localStorage.removeItem('codetrellis.graphOverlays'); } catch { /* */ } });

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await reachableNodes(page);
    const canvas = (await page.locator('.react-flow').boundingBox())!;

    // Two reachable file nodes, wholly on the canvas.
    const picked: Array<{ node: Locator; id: string }> = [];
    await expect.poll(async () => {
      picked.length = 0;
      for (const n of await reachableNodes(page)) {
        const id = await n.getAttribute('data-id');
        if (!id || !/\/[^/]+\.[a-z]+$/.test(id) || id.includes('::')) continue;
        const box = await n.boundingBox();
        if (!box || box.y < canvas.y + 170 || box.y + box.height > canvas.y + canvas.height - 10) continue;
        picked.push({ node: n, id });
        if (picked.length === 3) break;
      }
      return picked.length;
    }, { timeout: 20_000 }).toBe(3);
    const [failing, stale, untested] = picked;

    // Before any report: nothing drawn.
    await expect(page.getByTestId('node-grounding')).toHaveCount(0);

    map = {
      hasResults: true,
      files: {
        [failing.id]: { state: 'failing', words: '✗ 1 of 3 tests failing' },
        [stale.id]: { state: 'stale', words: '⚠ tests older than the code: it changed after its 2 tests last ran' },
      },
    };
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('tests-reported')));

    const mark = (n: Locator) => n.getByTestId('node-grounding');
    await expect(mark(failing.node)).toHaveText('✗', { timeout: 10_000 });
    await expect(mark(failing.node)).toHaveAttribute('title', '✗ 1 of 3 tests failing');
    await expect(mark(stale.node)).toHaveText('⚠');
    await expect(mark(stale.node)).toHaveAttribute('data-state', 'stale');
    await expect(mark(untested.node)).toHaveText('○');
    await expect(mark(untested.node)).toHaveAttribute('title', '○ no tests: no test with a reported result imports it');
    fs.mkdirSync(OUT, { recursive: true });
    const at = (await failing.node.boundingBox())!;
    const x = Math.max(0, at.x - 24), y = Math.max(0, at.y - 18);
    await page.screenshot({ path: path.join(OUT, 'graph-grounding-node.png'), clip: { x, y, width: Math.min(at.width + 48, 1440 - x), height: Math.min(at.height + 36, 900 - y) } });

    // Clusters sum their files, worst first.
    await page.getByRole('button', { name: 'Clusters', exact: true }).click();
    await expect.poll(async () => (await page.getByTestId('node-grounding').allTextContents()).some((t) => t.startsWith('✗ 1')), { timeout: 15_000 }).toBe(true);
    await page.screenshot({ path: path.join(OUT, 'graph-grounding-clusters.png') });

    // Turned off, the marks go.
    await page.getByTestId('graph-overlays').click();
    await page.getByTestId('overlay-tests').uncheck();
    await expect(page.getByTestId('node-grounding')).toHaveCount(0);
  });
});
