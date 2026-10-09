/**
 * The branch popover on a repository with many branches and worktrees.
 *
 * Reported on 0.1.17: with sixty-odd branches the popover ran off the
 * bottom of the window, nothing in it scrolled, there was no way to type a
 * name, and the worktrees — listed after every branch — could not be
 * reached, so the popover looked as if it did not detect them at all.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gotoWithProject } from '../helpers/setup';

let tmp: string;
let main: string;
const BRANCHES = Array.from({ length: 80 }, (_, i) => `AGC-${String(100 + i * 7)}-some-longish-branch-name`);
const WORKTREES = ['finn-rewrite', 'stateful-cards', 'zz-last-one'];

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

test.beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e2e-branches-')));
  main = path.join(tmp, 'ai-chat');
  fs.mkdirSync(path.join(main, 'src'), { recursive: true });
  fs.writeFileSync(path.join(main, 'src', 'a.ts'), "import { b } from './b';\nexport const a = b + 1;\n");
  fs.writeFileSync(path.join(main, 'src', 'b.ts'), 'export const b = 1;\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  for (const b of BRANCHES) git(main, 'branch', b);
  // Where Claude Code puts its own: inside the checkout, under .claude/.
  for (const w of WORKTREES) git(main, 'worktree', 'add', '-q', '-b', `claude/${w}`, path.join(main, '.claude', 'worktrees', w));
});

test.afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test.describe('Branch popover with many branches', () => {
  test('fits the window, lists the worktrees first, scrolls, and finds what you type', async ({ page }) => {
    await gotoWithProject(page, { projectPath: main });

    const chip = page.locator('button[title*="Branch info"]');
    await expect(chip).toHaveText(/main/, { timeout: 10_000 });
    await chip.click();

    const popover = page.locator('[data-branch-popover]');
    await expect(popover).toBeVisible();
    const viewport = page.viewportSize()!;

    // The whole popover is inside the window, its last row included.
    const box = (await popover.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(popover.getByRole('button', { name: 'Rescan project' })).toBeInViewport();

    // Worktrees are detected and can be seen without scrolling.
    await expect(popover.getByText('Worktrees', { exact: true })).toBeInViewport();
    const worktrees = popover.getByTestId('branch-popover-worktrees');
    for (const w of WORKTREES) {
      await expect(worktrees.getByRole('button', { name: `claude/${w}` })).toBeInViewport();
    }

    // The list scrolls to the last branch.
    const list = popover.getByTestId('branch-popover-list');
    const last = popover.getByRole('button', { name: BRANCHES[BRANCHES.length - 1] });
    await expect(last).not.toBeInViewport();
    await list.hover();
    await page.mouse.wheel(0, 10_000);
    await expect(last).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('branch-popover-scrolled.png') });

    // Typing narrows branches and worktrees alike; focus starts in the box.
    const search = popover.getByTestId('branch-popover-search');
    await expect(search).toBeFocused();
    await page.keyboard.type('agc-247');
    await expect(popover.getByRole('button', { name: /^AGC-/ })).toHaveCount(1);
    await expect(popover.getByRole('button', { name: 'AGC-247-some-longish-branch-name' })).toBeVisible();
    await expect(popover.getByText('Worktrees', { exact: true })).toHaveCount(0);

    await search.fill('stateful');
    await expect(worktrees.getByRole('button', { name: 'claude/stateful-cards' })).toBeVisible();
    await expect(popover.getByRole('button', { name: /^AGC-/ })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('branch-popover-search.png') });

    await search.fill('no-such-thing');
    await expect(popover.getByTestId('branch-popover-none')).toContainText('84 branches and 3 worktrees');

    // Escape clears the box first, then closes.
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
  });

  test('a worktree opens in its own tab', async ({ page }) => {
    await gotoWithProject(page, { projectPath: main });
    await page.locator('button[title*="Branch info"]').click();
    const popover = page.locator('[data-branch-popover]');
    await popover.getByTestId('branch-popover-search').fill('finn');
    await popover.getByTestId('branch-popover-worktrees').getByRole('button', { name: 'claude/finn-rewrite' }).click();
    await expect(page.locator(`span[title="${path.join(main, '.claude', 'worktrees', 'finn-rewrite')}"]`)).toBeVisible({ timeout: 15_000 });
  });
});
