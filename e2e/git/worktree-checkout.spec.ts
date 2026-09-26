/**
 * A linked worktree opened as a project, seen through the UI (Phase 32 §0.4a).
 *
 * In a linked worktree `.git` is a file. The branch chip read `.git/HEAD`
 * by hand, so it showed "..." forever, the popover warned "No commits
 * yet", and neither the branches nor the other checkout were listed.
 * The API half of this is tests/e2e/worktree-project.test.ts.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gotoWithProject } from '../helpers/setup';

let tmp: string;
let main: string;
let wt: string;

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

test.beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e2e-wt-')));
  main = path.join(tmp, 'app');
  wt = path.join(tmp, 'app-feature');
  fs.mkdirSync(path.join(main, 'src'), { recursive: true });
  fs.writeFileSync(path.join(main, 'src', 'a.ts'), "import { b } from './b';\nexport const a = b + 1;\n");
  fs.writeFileSync(path.join(main, 'src', 'b.ts'), 'export const b = 1;\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/wt', wt);
});

test.afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test.describe('A linked worktree as a project', () => {
  test('the branch chip and popover show the worktree\'s branch, commits and the other checkout', async ({ page }) => {
    await gotoWithProject(page, { projectPath: wt });

    const chip = page.locator('button[title*="Branch info"]');
    await expect(chip).toHaveText(/feature\/wt/, { timeout: 10_000 });

    await chip.click();
    const popover = page.locator('[data-branch-popover]');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('No commits yet')).toHaveCount(0);
    // `main` twice: once as the other local branch, once as the main
    // checkout under Worktrees.
    await expect(popover.getByText('Worktrees')).toBeVisible();
    await expect(popover.getByRole('button', { name: /^main$/ })).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath('worktree-branch-popover.png') });
  });
});
