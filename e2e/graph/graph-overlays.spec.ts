/**
 * Overlays on the graph (Phase 32 B3.3a), the journey.
 *
 * Two other workstreams change the same file, and the overlap between them is
 * open. On the graph that file's node reads "2 workstreams: ＋12 −3, ＋4"
 * (who changed how much, in words, on hover) and carries a dashed ring with
 * ⚠ (the overlap's summary on hover). The Overlays menu turns each overlay
 * off and on again; with Workstreams off the counts go, with Collision zones
 * off the ring goes.
 *
 * The workstreams and the overlap are given, on whichever file node is
 * reachable, so what is drawn is exact; the counts' source is
 * `workstream-watch-service.test.ts` (numstat) and B3.1's harness test.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator } from '@playwright/test';
import { gotoWithProject, reachableNodes, FIXTURE_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');

test.describe('Overlays on the graph', () => {
  test.setTimeout(120_000);

  test('a file two workstreams change: counts and a collision zone, each overlay turned off and on', async ({ page }) => {
    let target: string | null = null;
    const ws = (root: string, branch: string, files: Array<{ path: string; added: number; removed: number }>, main = false) => ({
      root, branch, head: null, main, shape: 'worktree', agents: [], idle: false,
      changes: { base: null, truncated: false, files: files.map((f) => ({ ...f, status: 'modified' })) },
    });
    await page.route('**/api/workstreams?*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(target ? [
        ws(FIXTURE_PATH, 'main', [], true),
        ws(`${FIXTURE_PATH}-billing`, 'billing-v2', [{ path: target, added: 12, removed: 3 }]),
        ws(`${FIXTURE_PATH}-exports`, 'exports', [{ path: target, added: 4, removed: 0 }]),
      ] : [ws(FIXTURE_PATH, 'main', [], true)]),
    }));
    await page.route('**/api/awareness?*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ signals: target ? [{
        id: 'b33-sig', kind: 'collision', severity: 'medium', subject: { file: target },
        workstreams: [`${FIXTURE_PATH}-billing`, `${FIXTURE_PATH}-exports`],
        summary: `\`billing-v2\` and \`exports\` both change ${target}`, firstSeen: Date.now(), lastSeen: Date.now(), state: 'open',
      }] : [] }),
    }));
    await page.route('**/api/workstreams/commits?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: Date.now(), commits: {} }) }));

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    // The sample app's graph opens at a size to read (HD2); no zooming in, which
    // put every node's centre off the canvas there.
    await reachableNodes(page);
    const canvas = (await page.locator('.react-flow').boundingBox())!;

    // Whichever file node is reachable: the layout is not fixed.
    let node: Locator | null = null;
    await expect.poll(async () => {
      for (const n of await reachableNodes(page)) {
        const id = await n.getAttribute('data-id');
        if (!id || !/\/[^/]+\.[a-z]+$/.test(id) || id.includes('::')) continue;
        // Wholly on the canvas, below the toolbar, so its marks can be seen and shot.
        const box = await n.boundingBox();
        if (!box || box.y < canvas.y + 170 || box.y + box.height > canvas.y + canvas.height - 10) continue;
        node = n; target = id; return id;
      }
      return null;
    }, { timeout: 20_000 }).not.toBeNull();
    const file = node!;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('workstreams-changed')));

    const count = file.getByTestId('node-work-count');
    await expect(count).toHaveText('2 workstreams: ＋12 −3, ＋4', { timeout: 10_000 });
    await expect(count).toHaveAttribute('title', 'billing-v2: 12 lines added, 3 removed\nexports: 4 lines added');
    const zone = file.getByTestId('node-collision');
    await expect(zone).toHaveAttribute('title', `\`billing-v2\` and \`exports\` both change ${target}`);
    fs.mkdirSync(OUT, { recursive: true });
    const at = (await file.boundingBox())!;
    const vp = page.viewportSize()!;
    const x = Math.max(0, at.x - 120), y = Math.max(0, at.y - 80);
    await page.screenshot({ path: path.join(OUT, 'graph-overlays-node.png'), clip: { x, y, width: Math.min(at.width + 240, vp.width - x), height: Math.min(at.height + 160, vp.height - y) } });

    // The menu: all six on (B8.3a added test grounding, Phase 33 G8 the rules); each turned off and on again.
    const menuButton = page.getByTestId('graph-overlays');
    await expect(menuButton).toContainText('6/6');
    await menuButton.click();
    const menu = page.getByTestId('graph-overlays-menu');
    await expect(menu.locator('label')).toHaveText([
      /Plan intent/, /Workstreams/, /Collision zones/, /Breakpoints/, /Test grounding/, /Rules/,
    ]);
    await page.screenshot({ path: path.join(OUT, 'graph-overlays-menu.png') });
    await menu.getByTestId('overlay-workstreams').uncheck();
    await expect(count).toHaveCount(0);
    await expect(zone).toBeVisible();
    await menu.getByTestId('overlay-collisions').uncheck();
    await expect(zone).toHaveCount(0);
    await expect(menuButton).toContainText('4/6');
    await menu.getByTestId('overlay-workstreams').check();
    await menu.getByTestId('overlay-collisions').check();
    await expect(file.getByTestId('node-work-count')).toBeVisible();
    await expect(file.getByTestId('node-collision')).toBeVisible();

    // Escape closes it and gives the button the focus back.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(menuButton).toBeFocused();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });
});
