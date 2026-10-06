/**
 * Phase 33 G8 — rules on the graph.
 *
 * With the Rules overlay on, an import that breaks a rule is drawn in the
 * breach style and says which rule on hover; the file it starts from carries
 * a ⊘ mark; the legend explains both. Selecting that file, the inspector
 * lists the rules about it and what breaks them there; "Show the suite"
 * fades every node its rules are not about, until "Show all".
 *
 * The rules are served (what breaks a rule is proven against the real graph
 * by tests/e2e/architecture-rules.test.ts and package-rules.test.ts), on an
 * import the sample app really has, so the edge is the graph's own.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, reachableNodes, FIXTURE_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');

test.describe('Rules on the graph', () => {
  test.setTimeout(120_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a breaching import is drawn and named, its file marked, the legend says both; the inspector shows the suite', async ({ page }) => {
    let rules: unknown[] = [];
    await page.route((url) => url.pathname === '/api/rules', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rules }) }));
    await page.addInitScript(() => { try { localStorage.setItem('codetrellis.graphOverlays', JSON.stringify(['plan'])); } catch { /* */ } });

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await reachableNodes(page);

    // An import the sample app has, between two files on the canvas.
    let from = '';
    let to = '';
    await expect.poll(async () => {
      for (const e of await page.locator('.react-flow__edge[data-id^="hub:"]').all()) {
        const m = /^hub:(.+)->(.+)$/.exec((await e.getAttribute('data-id')) ?? '');
        if (m && !m[1].includes('::') && !m[2].includes('::')) { [, from, to] = m; return true; }
      }
      return false;
    }, { timeout: 20_000 }).toBe(true);
    const edge = page.locator(`.react-flow__edge[data-id="hub:${from}->${to}"]`);
    const folder = from.split('/').slice(0, -1).join('/') + '/';
    rules = [{
      rule: { id: 'keep-apart', from: folder, mayNotImport: to, except: [], because: 'they talk through the API', strength: 'block', suite: 'payments', since: '2026-10-06T00:00:00.000Z', by: 'Sam Lee' },
      where: '.codetrellis/rules/payments.yaml', words: `${folder} may not import ${to}: they talk through the API`,
      breaches: [{ rule: 'keep-apart', from, to }], breachWords: '1 import breaks this today',
    }];

    // Off, nothing is drawn.
    await expect(edge.getByTestId('edge-breach')).toHaveCount(0);
    await page.getByTestId('graph-overlays').click();
    await page.getByTestId('overlay-rules').check();
    await page.keyboard.press('Escape');

    await expect(edge.getByTestId('edge-breach')).toHaveAttribute('data-rules', 'keep-apart');
    await expect(edge.getByTestId('edge-breach')).toHaveText('⊘ breaks keep-apart');
    const mark = page.locator(`.react-flow__node[data-id="${from}"]`).getByTestId('node-rule-breach');
    await expect(mark).toHaveText('⊘ 1 breach');
    await expect(mark).toHaveAttribute('title', `⊘ 1 import breaks a rule:\n${from} → ${to} (keep-apart)`);
    const legend = page.getByTestId('legend-graph');
    await expect(legend.locator('[data-testid="legend-entry"][data-key="edge:breach"]')).toContainText('rule breach');
    await expect(legend.locator('[data-testid="legend-entry"][data-key="mark:breach"]')).toContainText('Breach');

    // The inspector: the rules about the file, and the suite on the graph.
    await page.locator(`.react-flow__node[data-id="${from}"]`).click();
    const box = page.getByTestId('file-rules');
    await expect(box.getByTestId('file-rule-words')).toHaveText(`${folder} may not import ${to}: they talk through the API`);
    await expect(box.getByTestId('file-rule-breach')).toHaveText(`⊘ imports ${to}`);
    await box.getByTestId('file-rule-show-suite').click();
    await expect(page.getByTestId('rule-suite-focus')).toContainText('Showing what the payments rules are about');
    await expect(page.getByTestId('rule-suite-fade')).toHaveCount(1);
    await expect.poll(async () => Number(await page.locator(`.react-flow__node[data-id="${from}"]`).evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'graph-rules-overlay.png') });
    await page.getByTestId('rule-suite-focus-clear').click();
    await expect(page.getByTestId('rule-suite-fade')).toHaveCount(0);

    // Off again: the breach and the mark go.
    await page.getByTestId('graph-overlays').click();
    await page.getByTestId('overlay-rules').uncheck();
    await page.keyboard.press('Escape');
    await expect(edge.getByTestId('edge-breach')).toHaveCount(0);
    await expect(page.getByTestId('node-rule-breach')).toHaveCount(0);
  });
});
