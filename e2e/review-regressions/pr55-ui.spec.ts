/**
 * Browser regressions for the UI findings of the PR #55 review.
 *
 * These were fixed without tests, on the stated grounds that the
 * repository has no component harness. That was wrong: `e2e/` is a
 * browser suite that boots the real backend and the real Vite bundle,
 * and every one of them is reachable through it. The claim is corrected
 * here rather than repeated.
 *
 * What genuinely has no harness is M32, which lives in
 * `mobile/app/plan-review.tsx` — React Native, no browser, and this file
 * cannot reach it. That one is still unproven and is named as such in
 * the tracker rather than quietly folded in with the rest.
 *
 * Each test asserts the DEFECT is gone, not that the code looks a
 * certain way, and each was run against the pre-fix source to confirm it
 * fails there — otherwise it is decoration.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const API = 'http://localhost:3001/api';

/**
 * Every local transport authenticates with the per-launch capability
 * token — loopback is not an authorisation boundary, which is a Phase 19
 * rule. The browser gets it from the page bootstrap; a Playwright
 * `request` context is a separate client and has to send it too, or it
 * gets a 401 that looks like a broken test.
 */
const authHeaders = (): Record<string, string> => {
  const file = path.join(os.homedir(), '.codetrellis', 'capability-token');
  try {
    return { 'x-codetrellis-token': fs.readFileSync(file, 'utf-8').trim() };
  } catch {
    return {};
  }
};

/**
 * The small fixture, not this repository.
 *
 * `gotoWithProject` defaults to `process.cwd()`, and scanning CodeTrellis
 * itself takes tens of seconds — eight of those in one file exhausted the
 * per-test timeout and had scans overlapping ("A scan is already in
 * progress"), which fails for reasons that have nothing to do with any
 * finding. The sample app is ~40 files, has the directories and symbols
 * these tests need, and is already the harness's fixture.
 */
const PROJECT_PATH = path.resolve(process.cwd(), 'tests/fixtures/sample-app');

/** Open the app with the fixture scanned. */
const openApp = (page: Page) => gotoWithProject(page, { projectPath: PROJECT_PATH });

/**
 * The code-first surface.
 *
 * Scoped, because in code mode TWO sidebars are in the DOM: the
 * graph-layout one behind and this one beside the editor. An unscoped
 * `.glass-panel.border-r` matches both, and Playwright will happily aim
 * clicks at the one underneath the overlay.
 */
const codeSurface = (page: Page): Locator =>
  page.locator('div.absolute.inset-0.z-30.bg-background');

async function enterCodeMode(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const surface = codeSurface(page);
  await surface.getByRole('button', { name: 'Source', exact: true }).waitFor({ timeout: 10_000 });
  return surface;
}

/** The file-name label in the code surface's own toolbar. */
const openFileLabel = (surface: Locator): Locator => surface.locator('span.font-mono').first();

test.describe('Code mode (M11, M12, m10, m11)', () => {
  test.setTimeout(90_000);

  test('the graph is unmounted, not covered (M11)', async ({ page }) => {
    await openApp(page);
    // Precondition: the graph really is there to begin with, or the
    // assertion below would pass on an app that never rendered one.
    await expect(page.locator('.react-flow')).toHaveCount(1);

    await enterCodeMode(page);

    // The whole claim of the layer — repeated in the module docstring, in
    // the commit subject and in the TopBar tooltip — is that the graph is
    // not rendering while you read code. An overlay does not achieve
    // that: ReactFlow stayed mounted underneath and dagre + d3-force kept
    // running on every graph change. Nothing was cheaper in code mode.
    await expect(page.locator('.react-flow')).toHaveCount(0);

    // And it comes back, so this is an unmount rather than a teardown.
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await expect(page.locator('.react-flow')).toHaveCount(1);
  });

  test('the sidebar is reachable, and its instruction is followable (M12)', async ({ page }) => {
    await openApp(page);
    const surface = await enterCodeMode(page);

    // With nothing selected the surface says "Pick a file from the
    // sidebar" — and used to cover the sidebar with `absolute inset-0
    // z-30`. Since `selectedNodeId` is not persisted, that is EVERY fresh
    // launch: the instruction on screen pointed at a control the user
    // could not reach, and the mode was a dead end.
    await expect(surface.getByText('Explorer')).toBeVisible();
    await expect(surface.getByText(/Pick a file from the sidebar/)).toBeVisible();

    const file = surface.getByRole('button', { name: /\.(ts|tsx|json|md)$/ }).first();
    await file.waitFor({ timeout: 10_000 });
    const label = ((await file.textContent()) ?? '').trim();
    await file.click();

    // Following the instruction produces that file, which is the point.
    await expect(openFileLabel(surface)).toContainText(label, { timeout: 10_000 });
  });

  test('a directory selection is explained, not reported as a missing file (m10)', async ({ page }) => {
    await openApp(page);
    const surface = await enterCodeMode(page);

    // Directories are selected with `setSelectedNode(node.path)` too, and
    // this surface read every node id as a file path — so a directory
    // went to /api/file/content and came back 400 "Path is a directory",
    // rendered as an error over an empty pane.
    const dir = surface.getByRole('button', { name: 'services', exact: true }).first();
    await dir.waitFor({ timeout: 10_000 });
    await dir.click();

    await expect(surface.getByText(/That is a directory/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Path is a directory|File not found/)).toHaveCount(0);
  });

  // The SYMBOL half of m10 is covered by
  // `src/frontend/lib/selected-file.test.ts`, not here. Symbol nodes only
  // render in the graph's focus mode — a specific file has to be focused
  // before its symbols exist as nodes — and driving ReactFlow into that
  // state made the test about the graph's layout rather than about the
  // routing rule. A permanently-skipped browser test would have looked
  // like coverage and been none; the rule is a pure function and is
  // tested as one, with all four kinds.

  test('the diff base comes from the project, not from a hardcoded HEAD (m11)', async ({ page }) => {
    await openApp(page);

    // A project with no commits — `git init` and nothing committed, or a
    // plain directory — lists no commit comparand. `listComparands`
    // tolerates both, so this is a real state, not a contrived one.
    await page.route('**/api/comparands*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ spec: 'live', label: 'Live (working tree)', kind: 'live' }]),
      }),
    );

    const surface = await enterCodeMode(page);

    const file = surface.getByRole('button', { name: /\.(ts|tsx|json|md)$/ }).first();
    await file.waitFor({ timeout: 10_000 });
    await file.click();
    await expect(openFileLabel(surface)).not.toHaveText('No file selected', { timeout: 10_000 });

    const atSpecs: string[] = [];
    page.on('request', (req) => {
      const u = new URL(req.url(), 'http://localhost:5173');
      if (u.pathname === '/api/file/at') atSpecs.push(u.searchParams.get('at') ?? '');
    });

    await surface.getByRole('button', { name: 'Diff', exact: true }).click();
    await expect.poll(() => atSpecs.length, { timeout: 20_000 }).toBeGreaterThan(0);

    // `git show HEAD:<path>` throws on a repo with no HEAD, and readFileAt
    // cannot tell "no such ref" from "file not in that tree" — so it
    // answered `content: null`, the view set `addedWholesale`, and the
    // whole file rendered as an insertion badged "added in this range".
    // A confident wrong answer, in the one module whose header says it
    // refuses to give them.
    expect(atSpecs, `asked for: ${atSpecs.join(', ')}`).not.toContain('commit:HEAD');
    await expect(page.getByText('added in this range')).toHaveCount(0);
  });
});

test.describe('Plan template picker (M26)', () => {
  test.setTimeout(90_000);

  test('a plan created from a template is not titled with template syntax', async ({ page, request }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.getByTitle('New plan from template').click();

    // Inside the picker: page-wide, "Performance" also matches the graph
    // toolbar's card-style toggle, which comes first in the DOM.
    const template = page
      .getByRole('dialog', { name: 'New plan from template' })
      .getByRole('button')
      .filter({ hasText: /Feature|Bug fix|Refactor|Migration|Performance/ })
      .first();
    await template.waitFor({ timeout: 10_000 });
    await template.click();

    // The two kinds of input are distinguishable by class: the
    // placeholder fields are `font-mono`, the title box is not. Filling
    // the title box would hide the defect — an earlier version of this
    // test did exactly that, and stayed green with the bug planted back,
    // which is the failure mode this whole pass keeps finding.
    const titleInput = page.locator('input[type="text"]:not(.font-mono)').first();
    const placeholderInputs = page.locator('input[type="text"].font-mono');

    const marker = `ctM26${Date.now()}`;
    const n = await placeholderInputs.count();
    expect(n, 'this template has no placeholders, so it cannot show the defect').toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await placeholderInputs.nth(i).fill(`${marker}${i}`);

    // Left EMPTY on purpose. Accepting the prefilled title was the
    // one-click default path, and the defect: the picker put the raw
    // `Feature: {{feature}}` in here and sent it verbatim.
    await expect(titleInput).toHaveValue('');

    await page.getByRole('button', { name: /Create plan/ }).click();
    await expect(page.getByText('Plan created')).toBeVisible({ timeout: 20_000 });

    // The picker prefilled `titleDraft` with the RAW defaultTitle and sent
    // it verbatim, so `applyTemplate`'s `input.title ?? template.defaultTitle`
    // short-circuited the substituted one. Accepting the prefilled title —
    // one click, the default path — always produced a plan named
    // "Feature: {{feature}}". `mass-refactor` was worse: its
    // `.replace('{name}', input.title)` substituted the title into itself.
    const res = await request.get(`${API}/plans?project=${encodeURIComponent(PROJECT_PATH)}`, {
      headers: authHeaders(),
    });
    expect(res.ok(), `GET /api/plans -> ${res.status()}`).toBeTruthy();
    const plans = (await res.json()) as Array<{ uid: string; title: string; createdAt: number }>;
    const newest = plans.sort((a, b) => b.createdAt - a.createdAt)[0];

    expect(newest.title, 'the title still carries template syntax').not.toMatch(/\{\{|\}\}|\{name\}/);
    expect(newest.title).not.toMatch(/Mass refactor: Mass refactor/);

    await request.delete(`${API}/plans/${newest.uid}`, { headers: authHeaders() });
  });
});

test.describe('Verified update download (M30)', () => {
  test.setTimeout(90_000);

  test('progress and cancel appear while the download is still running', async ({ page }) => {
    // `POST /api/updates/download` awaits the whole ~170MB download and
    // its verification before responding. The poll interval was installed
    // AFTER that await, so for the entire download the panel showed a
    // disabled button and nothing else — no bytes, no phase, no cancel —
    // then flipped straight to "Show in folder". It reads as a hung app.
    //
    // The POST here never resolves, which is exactly the window the panel
    // used to be blind in.
    const available = {
      status: 'available',
      lastCheckedAt: Date.now(),
      platform: 'darwin-arm64',
      currentVersion: '0.1.14',
      lastError: null,
      result: {
        available: true,
        latest: '9.9.9',
        current: '0.1.14',
        source: 'github',
        download: {
          url: 'https://example.invalid/CodeTrellis-9.9.9-arm64.dmg',
          filename: 'CodeTrellis-9.9.9-arm64.dmg',
          size: 170_000_000,
        },
      },
    };
    // The stub keys off whether the POST has been ISSUED, not off a poll
    // counter: React StrictMode mounts effects twice in dev, so a counter
    // reports "downloading" before the user has clicked and the test ends
    // up asserting a state it never drove.
    let started = false;
    let ticks = 0;
    await page.route('**/api/updates/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(available) }),
    );
    await page.route('**/api/updates/download/status', (route) => {
      if (started) ticks++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          phase: started ? 'downloading' : 'idle',
          version: '9.9.9',
          bytesDownloaded: Math.min(ticks * 17_000_000, 170_000_000),
          totalBytes: 170_000_000,
          error: null,
        }),
      });
    });
    // Hangs, like the real one does for minutes.
    await page.route('**/api/updates/download', () => {
      started = true;
      /* deliberately never fulfilled */
    });

    await openApp(page);
    await page.getByTitle(/^Settings/).click();
    await page.getByRole('button', { name: 'Updates', exact: true }).click();
    await expect(page.getByText('v9.9.9 is available')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Download CodeTrellis/ }).click();

    // Both of these were unrendered for the whole download.
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/%\s·\s.*of/)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Linked ticket chip (m8)', () => {
  test.setTimeout(90_000);

  test('a ticket with no parsable key still renders a link you can see', async ({ page, request }) => {
    // The backend types `externalKey` as `string | null` and returns null
    // for every URL `keyFromUrl` does not recognise — Azure DevOps,
    // Shortcut, a wiki page. The chip declared it non-null and used it as
    // both the link text AND the React key, so the popover printed "This
    // plan came from " followed by an anchor with no text: a link the
    // user can neither see nor click.
    //
    // The scan has to come first: `/api/plans` confines `projectPath` to
    // a trusted root, and a project becomes one by being scanned.
    await openApp(page);

    const planRes = await request.post(`${API}/plans`, {
      headers: authHeaders(),
      data: { title: 'ct-m8 ticket chip', description: '', projectPath: PROJECT_PATH },
    });
    expect(planRes.ok(), `POST /api/plans -> ${planRes.status()}`).toBeTruthy();
    const plan = (await planRes.json()) as { uid: string };

    await page.route(`**/api/plans/${plan.uid}/external-sync`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          planUid: plan.uid,
          lastSyncedAt: null,
          changed: [],
          planRefs: [
            {
              externalKey: null,
              url: 'https://dev.azure.com/acme/proj/_workitems/edit/412',
              title: 'Work item 412',
            },
          ],
        }),
      }),
    );

    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.getByText('ct-m8 ticket chip').first().click();

    const chip = page.getByTitle('Linked tickets and whether they have drifted from this plan');
    await chip.waitFor({ timeout: 20_000 });
    await chip.click();

    const link = page.getByRole('link', { name: /Work item 412|dev\.azure\.com/ });
    await expect(link).toBeVisible({ timeout: 10_000 });
    // The defect precisely: an anchor whose text content was empty.
    expect(((await link.textContent()) ?? '').trim().length).toBeGreaterThan(0);

    await request.delete(`${API}/plans/${plan.uid}`, { headers: authHeaders() });
  });
});
