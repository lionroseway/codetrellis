/**
 * From an overlap to its lines (Phase 32 B3.3b), the journey.
 *
 * billing-v2 and exports both change `src/backend/services/database.ts`.
 * 1. On the overlap's card in Awareness, "Show on graph" switches to the
 *    graph and brings that file's node to the middle of the canvas.
 * 2. Right-click the node: "Show line changes" opens the file in the code
 *    view, where each workstream's lines are marked (B3.2).
 * 3. Back on the card, "Show lines" goes straight there.
 *
 * The workstreams and the overlap are given, so the file is known.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, FIXTURE_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const FILE = 'services/api/app/db.py';

test.describe('From an overlap to its lines', () => {
  test.setTimeout(120_000);

  test('show on graph centres the file; its menu and the card open its lines', async ({ page }) => {
    const ws = (root: string, branch: string, main = false) => ({
      root, branch, head: null, main, shape: 'worktree', agents: [], idle: false,
      changes: { base: null, truncated: false, files: main ? [] : [{ path: FILE, status: 'modified', added: 3, removed: 1 }] },
    });
    await page.route('**/api/workstreams?*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([ws(FIXTURE_PATH, 'main', true), ws(`${FIXTURE_PATH}-billing`, 'billing-v2'), ws(`${FIXTURE_PATH}-exports`, 'exports')]),
    }));
    await page.route('**/api/awareness?*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ signals: [{
        id: 'b33b-sig', kind: 'collision', severity: 'medium', subject: { file: FILE },
        workstreams: [`${FIXTURE_PATH}-billing`, `${FIXTURE_PATH}-exports`],
        summary: `\`billing-v2\` and \`exports\` both change ${FILE}`, firstSeen: Date.now() - 60_000, lastSeen: Date.now(), state: 'open',
      }] }),
    }));
    await page.route('**/api/workstreams/commits?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: Date.now(), commits: {} }) }));

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const node = page.locator(`.react-flow__node[data-id="${FILE}"]`);
    await expect(node).toHaveCount(1, { timeout: 20_000 });

    // 1. The card's chip brings the node to the middle.
    const openAwareness = async () => {
      await page.getByRole('button', { name: /^Awareness( \d+)?$/ }).click();
      return page.getByTestId('awareness-signal').filter({ hasText: FILE });
    };
    let card = await openAwareness();
    await expect(card.getByTestId('signal-show-on-graph')).toHaveAttribute('title', `Focus the graph on ${FILE}`);
    fs.mkdirSync(OUT, { recursive: true });
    await card.screenshot({ path: path.join(OUT, 'signal-to-lines-card.png') });
    await card.getByTestId('signal-show-on-graph').click();
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    const mid = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 + 40 };
    // Focused: zoomed onto the node, which then covers the middle of the canvas.
    await expect.poll(async () => {
      const b = await node.boundingBox();
      return !!b && mid.x >= b.x && mid.x <= b.x + b.width && mid.y >= b.y && mid.y <= b.y + b.height;
    }, { timeout: 10_000, message: 'the file node should be brought to the middle of the canvas' }).toBe(true);
    await page.screenshot({ path: path.join(OUT, 'signal-to-lines-graph.png') });

    // 2. Its menu opens the file in the code view.
    // Where the node is under the middle of the canvas, clear of the toolbar and the panel below.
    await page.mouse.click(mid.x, mid.y, { button: 'right' });
    const show = page.getByTestId('node-menu-show-changes');
    await expect(show).toHaveText('Show line changes');
    await show.click();
    await expect(page.locator(`[data-code-file$="${FILE}"]`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('code-workstreams')).toBeVisible();

    // 3. Back on the card, "Show lines" goes straight there.
    await page.getByTitle('Back to the graph').first().click();
    await expect(page.locator('.react-flow')).toHaveCount(1, { timeout: 10_000 });
    card = await openAwareness();
    await card.getByTestId('signal-show-lines').click();
    await expect(page.locator(`[data-code-file$="${FILE}"]`).first()).toBeVisible({ timeout: 15_000 });
  });
});
