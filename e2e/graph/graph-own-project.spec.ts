/**
 * The canvas shows its own project's graph, whichever project the app last
 * scanned. The AST tables hold one project at a time, and another window may
 * have opened another (lib/graph-answer.ts).
 *
 * A canvas showing its graph keeps it when another project is scanned: no
 * node of its graph goes, and no error is shown. (A canvas with nothing on
 * screen scans its own project again; a reload here would lose the test's
 * project, so that path is covered by graph-answer's rules and CI's shared
 * backend, where it happens by itself.)
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, reachableNodes, API, PROJECT_PATH } from '../helpers/setup';

const OTHER = path.join(PROJECT_PATH, 'tests/fixtures/sample-app');

test.describe('The graph belongs to this window\'s project', () => {
  test.setTimeout(120_000);

  test('another project scanned: this project\'s graph stays on screen', async ({ page, request }) => {
    await gotoWithProject(page);
    await reachableNodes(page, 30_000);
    const ids = () => page.locator('.react-flow__node').evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.id ?? ''));
    // Settled: the same nodes twice running.
    let before: string[] = [];
    await expect.poll(async () => { const now = (await ids()).sort().join('|'); const same = now === before.join('|'); before = now.split('|'); return same; }, { timeout: 30_000 }).toBe(true);

    // Another window opens the sample app: the backend now holds its graph.
    const other = await request.post(`${API}/project/scan`, { data: { projectPath: OTHER } });
    expect(other.ok()).toBeTruthy();
    const held = await request.get(`${API}/dependencies?include=cross_system`);
    expect(decodeURIComponent(held.headers()['x-codetrellis-project'] ?? '')).toBe(OTHER);

    // The graph on screen is this project's, and stays: none of its nodes go.
    await page.waitForTimeout(1500);
    const after = new Set(await ids());
    expect(before.filter((id) => !after.has(id))).toEqual([]);
    await expect(page.getByText('The dependency graph did not load')).toHaveCount(0);
  });
});
