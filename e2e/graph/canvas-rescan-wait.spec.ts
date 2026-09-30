/**
 * An empty canvas waits while another project's scan holds the backend.
 *
 * The backend holds one project's graph at a time. A canvas with nothing on
 * screen that is answered with another project's graph scans its own project
 * again (lib/graph-answer.ts). While the other scan runs, the scan route
 * refuses with 200 and `astError` "already in progress", an answer rather
 * than an error, and the canvas asked again at once: it spent all 120 tries
 * in a few seconds and stayed empty (#226: multi-select and
 * graph-breakpoints found no node for 15 s). A refusal now waits a second.
 *
 * Here the backend answers as if another project were being scanned: the
 * graph is the other project's, and the canvas's rescans are refused three
 * times. They must come about a second apart, and the graph must arrive once
 * the refusals stop.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, reachableNodes, FIXTURE_PATH } from '../helpers/setup';

const OTHER = '/elsewhere/another-project';

test('a refused rescan waits a second, and the graph arrives when the other scan ends', async ({ page }) => {
  test.setTimeout(90_000);
  const scans: number[] = [];
  let refusalsLeft = 3;
  let helperScanned = false;

  await page.route('**/api/project/scan', async (route) => {
    // The first scan is gotoWithProject's own: it opens the project.
    if (!helperScanned) { helperScanned = true; return route.continue(); }
    scans.push(Date.now());
    if (refusalsLeft > 0) {
      refusalsLeft--;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ astError: `A scan of ${OTHER} is already in progress; wait for it before scanning ${FIXTURE_PATH}` }) });
    }
    return route.continue();
  });
  await page.route('**/api/dependencies?include=cross_system', async (route) => {
    // Another project's graph until the refusals end.
    if (refusalsLeft > 0) {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-CodeTrellis-Project': encodeURIComponent(OTHER) }, body: '[]' });
    }
    return route.continue();
  });

  await gotoWithProject(page, { projectPath: FIXTURE_PATH });

  // The graph arrives once the other scan is over.
  expect((await reachableNodes(page, 30_000)).length).toBeGreaterThan(0);

  // The three refused rescans, each a wait after the one before. (Once the
  // refusals stop, the graph answer is this project's, so no fourth is sent.)
  expect(scans).toHaveLength(3);
  const gaps = scans.slice(1).map((t, i) => t - scans[i]);
  expect(Math.min(...gaps), `rescans ${JSON.stringify(gaps)} ms apart`).toBeGreaterThanOrEqual(800);
  await expect(page.getByText('The dependency graph did not load')).toHaveCount(0);
});
