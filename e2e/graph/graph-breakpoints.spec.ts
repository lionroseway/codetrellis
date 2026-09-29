/**
 * Breakpoints on the graph (Phase 32 B4.3b): a person sets one where they
 * are looking at the code, and sees where one is set.
 *
 * 1. Right-click a file in the graph: "Ask me before this changes".
 * 2. A toast says what happens next; the node now carries ⏸, and its hover
 *    says, in words, what it holds.
 * 3. Awareness lists it under Breakpoints.
 * 4. Right-click again: "Stop asking before this changes" clears it, and
 *    the ⏸ goes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator } from '@playwright/test';
import { gotoWithProject, reachableNodes, API, authHeaders } from '../helpers/setup';
import type { Breakpoint } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');

test.describe('Breakpoints on the graph', () => {
  test.setTimeout(120_000);
  let target: string | null = null;

  test.afterEach(async ({ request }) => {
    if (!target) return;
    const res = await request.get(`${API}/breakpoints`, { headers: authHeaders() });
    const { breakpoints } = (await res.json()) as { breakpoints: Breakpoint[] };
    for (const b of breakpoints.filter((x) => x.target === target)) {
      await request.delete(`${API}/breakpoints/${b.id}`, { headers: authHeaders() });
    }
  });

  test('right-click a file: ask me before this changes, ⏸ on it, listed, then cleared', async ({ page }) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Files', exact: true }).click();

    // Close enough to read: the whole repository's graph opens zoomed far out.
    // Zoom first, at the canvas's centre, and only then pick a node: a node
    // picked before zooming can end up under the toolbar, which then takes
    // the right-click.
    await reachableNodes(page);
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(120); }
    await page.waitForTimeout(400);

    // Any file node that can be clicked where it is: other specs share the
    // backend and the layout is not fixed, so the test picks what is there.
    let node: Locator | null = null;
    await expect.poll(async () => {
      for (const n of await reachableNodes(page)) {
        const id = await n.getAttribute('data-id');
        if (id && /\/[^/]+\.[a-z]+$/.test(id) && !id.includes('::')) { node = n; target = id; return id; }
      }
      return null;
    }, { timeout: 20_000 }).not.toBeNull();
    const file = node!;
    const name = target!.split('/').pop()!;
    await expect(file.getByTestId('node-breakpoint')).toHaveCount(0);

    // The right-click goes to the node itself. It was clear when picked, but a
    // layout still settling can slide it under the toolbar, which then took
    // every click for two minutes (#196, Browser suite 1/3). The menu is what
    // is under test, not hit-testing.
    const rightClick = async (n: Locator) => {
      const box = (await n.boundingBox())!;
      await n.dispatchEvent('contextmenu', { bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    };
    await rightClick(file);
    const ask = page.getByTestId('node-menu-breakpoint');
    await expect(ask).toHaveText('Ask me before this changes');
    await ask.click();
    await expect(page.getByText(`An agent about to change ${name} will wait for you. You answer in Awareness.`)).toBeVisible();

    const badge = file.getByTestId('node-breakpoint');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('title', `Ask me first: ${target}, before it changes`);
    fs.mkdirSync(OUT, { recursive: true });
    const at = (await file.boundingBox())!;
    const vp = page.viewportSize()!;
    const x = Math.max(0, at.x - 120), y = Math.max(0, at.y - 80);
    await page.screenshot({ path: path.join(OUT, 'graph-breakpoint-node.png'), clip: { x, y, width: Math.min(at.width + 240, vp.width - x), height: Math.min(at.height + 160, vp.height - y) } });

    // Listed where breakpoints are answered and cleared.
    await page.getByRole('button', { name: /^Awareness( \d+)?$/ }).click();
    const set = page.getByTestId('breakpoints-set');
    await set.getByRole('button', { name: /Breakpoints/ }).click();
    await expect(set.getByTestId('breakpoint-set').filter({ hasText: target! })).toContainText('before it changes');

    // The same menu clears it.
    await rightClick(file);
    await expect(ask).toHaveText('Stop asking before this changes');
    await page.screenshot({ path: path.join(OUT, 'graph-breakpoint-menu.png') });
    await ask.click();
    await expect(page.getByText(`Agents no longer wait for you before ${name} changes.`)).toBeVisible();
    await expect(file.getByTestId('node-breakpoint')).toHaveCount(0);
    await expect(set.getByTestId('breakpoint-set').filter({ hasText: target! })).toHaveCount(0);
  });
});
