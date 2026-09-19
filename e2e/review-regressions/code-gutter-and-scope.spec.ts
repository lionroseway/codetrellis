/**
 * Two things raised from using the app.
 *
 * 1. "As new files come in I can't click on these files." The explorer was
 *    listing files that are not in the project at all — `e2e/`, `src/` —
 *    and clicking one said "Failed to load source: File not found".
 *    `git status` answers for the whole REPOSITORY and prints paths
 *    relative to the repository root, whatever directory you run it in, so
 *    a project that is a subdirectory of a larger repo inherited every
 *    change in that repo, at paths that could not resolve beneath it.
 *
 * 2. "A sidecar colour for added, diverged, git diff colours on the lines."
 *    That already exists end to end — the backend computes per-line
 *    annotations against HEAD and the reader renders `+` green and `~`
 *    amber — but nothing tested it, and with the tree broken there was no
 *    way to reach a changed file to see it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import os from 'node:os';
import { gotoWithProject } from '../helpers/setup';

const authHeaders = (): Record<string, string> => {
  try {
    return {
      'x-codetrellis-token': fs
        .readFileSync(path.join(os.homedir(), '.codetrellis', 'capability-token'), 'utf-8')
        .trim(),
    };
  } catch {
    return {};
  }
};

const PROJECT_PATH = path.resolve(process.cwd(), 'tests/fixtures/sample-app');
const open = (page: Page) => gotoWithProject(page, { projectPath: PROJECT_PATH });

const codeSurface = (page: Page) => page.locator('div.absolute.inset-0.z-30.bg-background');

async function enterCodeMode(page: Page) {
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const surface = codeSurface(page);
  await surface.getByRole('button', { name: 'Source', exact: true }).waitFor({ timeout: 10_000 });
  return surface;
}

test.describe('The explorer lists this project, and only this project', () => {
  test.setTimeout(90_000);

  test('git status for the project excludes the surrounding repository', async ({ page }) => {
    // Asserted on the ENDPOINT, not on the rendered tree: the sidebar
    // polls this every ten seconds and merges the result into the tree
    // (`mergeGitStatusIntoTree`), so a tree assertion races the poll and
    // passes whether or not the bug is present. It did, which is how I
    // nearly shipped a fix I had not demonstrated.
    const outsider = path.resolve(process.cwd(), 'zz-outside-the-project.tmp.ts');
    fs.writeFileSync(outsider, '// created by code-gutter-and-scope.spec.ts\n');

    try {
      await open(page);
      const res = await page.request.get(
        `http://localhost:3001/api/git/status?path=${encodeURIComponent(PROJECT_PATH)}`,
        { headers: authHeaders() },
      );
      expect(res.ok(), `GET /api/git/status -> ${res.status()}`).toBeTruthy();
      const status = (await res.json()) as Record<string, string[]>;

      const all = [
        ...(status.staged ?? []), ...(status.unstaged ?? []), ...(status.untracked ?? []),
      ];
      // Every path must be inside the project. A repo-relative path like
      // `e2e/review-regressions/x.spec.ts` resolves to
      // `<project>/e2e/...`, which does not exist — which is what put
      // "Failed to load source: File not found" on screen.
      const outside = all.filter((p) => !fs.existsSync(path.join(PROJECT_PATH, p)));
      expect(outside, `paths that do not exist in the project: ${outside.join(', ')}`).toEqual([]);
      expect(all).not.toContain('zz-outside-the-project.tmp.ts');
    } finally {
      fs.rmSync(outsider, { force: true });
    }
  });
});

test.describe('Git diff colours on the lines', () => {
  test.setTimeout(90_000);

  test('a brand new file reads as added, every line', async ({ page }) => {
    // An untracked file is entirely new, so the reader marks all of it —
    // which is the answer to "is this a new file or a change to one".
    const rel = 'services/notifier/zz_new_file.rb';
    const abs = path.join(PROJECT_PATH, rel);
    fs.writeFileSync(abs, "# added by the gutter test\nputs 'one'\nputs 'two'\n");

    try {
      await open(page);
      const surface = await enterCodeMode(page);

      await surface.getByRole('button', { name: /^notifier/ }).first().click({ timeout: 10_000 });
      await surface.getByRole('button', { name: /^zz_new_file\.rb/ }).first().click({ timeout: 10_000 });

      // The gutter marks additions with '+' on an emerald ground.
      const added = surface.locator('.bg-emerald-500\\/20');
      await expect.poll(() => added.count(), { timeout: 15_000 }).toBeGreaterThan(0);
      await expect(added.first()).toContainText('+');

      // Nothing should read as "modified" in a file that never existed.
      await expect(surface.locator('.bg-amber-500\\/20')).toHaveCount(0);
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });

  test('an edited tracked file reads as modified, on the edited lines only', async ({ page }) => {
    const rel = 'services/notifier/app.rb';
    const abs = path.join(PROJECT_PATH, rel);
    const original = fs.readFileSync(abs, 'utf-8');
    fs.writeFileSync(abs, `${original}\n# touched by the gutter test\n`);

    try {
      await open(page);
      const surface = await enterCodeMode(page);

      await surface.getByRole('button', { name: /^notifier/ }).first().click({ timeout: 10_000 });
      await surface.getByRole('button', { name: /^app\.rb/ }).first().click({ timeout: 10_000 });

      // An appended line is an addition with no removal, so it is marked
      // added rather than modified — and the untouched lines carry no
      // mark at all, which is the point of a per-line annotation.
      const marked = surface.locator('.bg-emerald-500\\/20, .bg-amber-500\\/20');
      await expect.poll(() => marked.count(), { timeout: 15_000 }).toBeGreaterThan(0);
      const lineCount = await surface.locator('.bg-emerald-500\\/20, .bg-amber-500\\/20').count();
      expect(lineCount, 'the whole file was marked, so this is not per-line').toBeLessThan(10);
    } finally {
      fs.writeFileSync(abs, original);
    }
  });

  test('an unchanged file carries no marks', async ({ page }) => {
    // The state the app is in most of the time. Marking a clean file would
    // make the signal meaningless.
    await open(page);
    const surface = await enterCodeMode(page);
    await surface.getByRole('button', { name: /^README\.md/ }).first().click({ timeout: 10_000 });
    await expect(surface.locator('pre, code').first()).toBeVisible({ timeout: 10_000 });
    await expect(surface.locator('.bg-emerald-500\\/20')).toHaveCount(0);
    await expect(surface.locator('.bg-amber-500\\/20')).toHaveCount(0);
  });
});
