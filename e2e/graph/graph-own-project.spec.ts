/**
 * The canvas shows its own project's graph, whichever project the app last
 * scanned. The AST tables hold one project at a time, and another window may
 * have opened another (lib/graph-answer.ts).
 *
 * A canvas showing its graph keeps it when another project is scanned: no
 * node of its graph goes, none of the other project's files joins it as a
 * ghost (its working-tree diff is its own, HD1), and no error is shown.
 *
 * The graph is read from the minimap, not from the canvas's DOM. The canvas
 * mounts only the nodes in view (`onlyRenderVisibleElements`), and this
 * repository's graph is fitted at the 0.1 minimum zoom with a few nodes past
 * the edge, so which ids are in the DOM moves with the viewport: on CI three
 * edge clusters left the DOM while still in the graph. The minimap draws every
 * node at its place in the layout, whatever the viewport. (A canvas with nothing on
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
    // Every node of the graph, as the minimap places it: a node that goes, or
    // a ghost that joins, changes the set and moves the layout.
    const graph = () => page.locator('.react-flow__minimap-node').evaluateAll((ns) =>
      ns.map((n) => ['x', 'y', 'width', 'height'].map((a) => n.getAttribute(a)).join(',')).sort());
    // Settled: the same nodes twice running.
    let before: string[] = [];
    await expect.poll(async () => { const now = await graph(); const same = now.length > 0 && now.join('|') === before.join('|'); before = now; return same; }, { timeout: 30_000 }).toBe(true);

    // Another window opens the sample app: the backend now holds its graph.
    const other = await request.post(`${API}/project/scan`, { data: { projectPath: OTHER } });
    expect(other.ok()).toBeTruthy();
    const held = await request.get(`${API}/dependencies?include=cross_system`);
    expect(decodeURIComponent(held.headers()['x-codetrellis-project'] ?? '')).toBe(OTHER);

    // Its working-tree diff is asked for now, not at the next 10 s poll: before
    // HD1 it came back as the other project's files, about twenty ghost nodes.
    await page.getByTitle('Check for changes now').click();

    // The graph on screen is this project's, and stays: none of its nodes go,
    // and nothing of the other project's arrives.
    await page.waitForTimeout(2500);
    expect(await graph()).toEqual(before);
    await expect(page.getByText('The dependency graph did not load')).toHaveCount(0);
  });
});
