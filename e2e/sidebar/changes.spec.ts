/**
 * Phase 32 E1 — the Changes panel: source control with no plan needed.
 *
 * The owner's report: someone edited, the graph showed changes, the code
 * view showed no diff, and there was no plan. Here the panel lists where
 * each change is (this checkout, committed since the project was opened,
 * another worktree an agent works in), and picking a file opens the code
 * view on the diff between that group's two points, said above it. A file
 * opened from the tree that changed says so, with the way to its diff.
 *
 * Source control and the two sides of each file are served here from a
 * realistic state, as the replay spec serves its frames; the real git
 * paths are the harness's (tests/e2e/source-control.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, PROJECT_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
/** The diff editor loads on demand; its first load on the dev server can take a while (code-and-docs.spec allows 20 s). */
const diffLoaded = (page: Page) => expect(page.getByText(/Loading the diff editor/)).toHaveCount(0, { timeout: 20_000 });
const shot = (name: string) => { fs.mkdirSync(OUT, { recursive: true }); return path.join(OUT, `${name}.png`); };

// Real files of the opened project (this repository), so the tree and the code view can open them.
const README = 'README.md';
const PKG = 'package.json';
const BASE = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const SC = {
  project: PROJECT_PATH, git: true, branch: 'main', head: { sha: '3f9c2e1', subject: 'Round refunds half-even' },
  words: '1 file changed in this checkout; 1 file committed since you opened it; work in 1 other worktree or branch.',
  groups: [
    { id: 'changes', kind: 'changes', title: 'Changed, not staged', words: 'Edited but not yet staged for a commit. Compared with what is staged', git: { term: 'unstaged', command: 'git diff' }, before: 'index', after: 'live', labels: { before: 'Staged', after: 'Working tree' }, files: [{ path: README, status: 'modified' }] },
    { id: 'since-opened', kind: 'since-opened', title: 'Committed since you opened it', words: `2 commits since ${BASE.slice(0, 7)}, when the graph's baseline was taken`, git: { term: null, command: `git diff ${BASE.slice(0, 7)}..HEAD` }, before: `commit:${BASE}`, after: 'commit:HEAD', labels: { before: `When you opened it (${BASE.slice(0, 7)})`, after: 'Last commit (3f9c2e1)' }, files: [{ path: PKG, status: 'modified' }] },
    {
      id: 'workstream:/work/acme-billing', kind: 'workstream', title: 'billing-v2', words: 'A worktree with 2 changed files since it left main, worked on by codex',
      git: { term: 'worktree', command: `git -C /work/acme-billing diff ${BASE.slice(0, 7)}` },
      before: `commit:${BASE}`, after: 'workstream:/work/acme-billing', labels: { before: `Where it left main (${BASE.slice(0, 7)})`, after: 'billing-v2' },
      files: [{ path: 'src/payments/refund.ts', status: 'modified' }, { path: 'src/payments/round.ts', status: 'added' }],
      workstream: { id: '/work/acme-billing', branch: 'billing-v2', agents: ['codex'] },
    },
  ],
};

const SIDES: Record<string, string> = {
  [`${README}|index`]: '# CodeTrellis\n\nSee the docs.\n',
  [`${README}|live`]: '# CodeTrellis\n\nSee the docs, and docs/claude/record.md.\n',
  [`${PKG}|commit:${BASE}`]: '{\n  "name": "codetrellis",\n  "version": "0.1.16"\n}\n',
  [`${PKG}|commit:HEAD`]: '{\n  "name": "codetrellis",\n  "version": "0.1.17"\n}\n',
  [`src/payments/refund.ts|commit:${BASE}`]: 'export const refund = (x: number) => Math.round(x * 100) / 100;\n',
  ['src/payments/refund.ts|workstream:/work/acme-billing']: 'import { roundHalfEven } from \'./round\';\n\nexport const refund = (x: number) => roundHalfEven(x, 2);\n',
};

async function serve(page: Page, asked: string[]) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/source-control?*', (r) => r.fulfill(json(SC)));
  await page.route('**/api/file/at?*', (r) => {
    const u = new URL(r.request().url());
    const key = `${u.searchParams.get('path')}|${u.searchParams.get('at')}`;
    asked.push(key);
    const at = u.searchParams.get('at') ?? '';
    return r.fulfill(json({ ok: true, content: SIDES[key] ?? null, label: at.startsWith('workstream:') ? 'billing-v2' : at }));
  });
}

test.describe('Changes panel', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('no plan: where each change is, and picking one opens its diff between the right two points', async ({ page }) => {
    const asked: string[] = [];
    await serve(page, asked);
    await gotoWithProject(page);

    await expect(page.getByTestId('sidebar-changes-count')).toHaveText('4');
    await page.getByTestId('sidebar-changes').click();
    // Code mode draws its own sidebar over the main one: the panel in view is the last.
    const panel = page.getByTestId('source-control').last();
    await expect(panel.getByTestId('sc-words')).toHaveText(SC.words);
    await expect(panel.getByTestId('sc-checkout')).toHaveText('This checkout · main · 3f9c2e1');
    await expect(panel.getByTestId('sc-group-title')).toHaveText(['Changed, not staged', 'Committed since you opened it', 'billing-v2']);
    // Two readings: git's own word beside the plain title, and the command beneath.
    await expect(panel.getByTestId('sc-git-term')).toHaveText(['unstaged', 'worktree']);
    await expect(panel.getByTestId('sc-git-command')).toHaveText(['$ git diff', `$ git diff ${BASE.slice(0, 7)}..HEAD`, `$ git -C /work/acme-billing diff ${BASE.slice(0, 7)}`]);
    await expect(panel.getByTestId('sc-group').filter({ hasText: 'billing-v2' })).toContainText('codex');
    await panel.screenshot({ path: shot('changes-panel') });

    // An agent's work in another worktree: its copy against where it left main.
    await panel.getByTestId('sc-file').filter({ hasText: 'refund.ts' }).click();
    await expect(page.getByTestId('code-compare-words')).toHaveText('billing-v2 · since it left main: A worktree with 2 changed files since it left main, worked on by codex');
    await diffLoaded(page);
    await expect(page.getByTestId('code-git-command')).toHaveText(`$ git -C /work/acme-billing diff ${BASE.slice(0, 7)} -- src/payments/refund.ts`);
    await expect.poll(() => asked).toEqual(expect.arrayContaining([`src/payments/refund.ts|commit:${BASE}`, 'src/payments/refund.ts|workstream:/work/acme-billing']));
    await expect(page.getByText('roundHalfEven(x, 2)').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`Where it left main (${BASE.slice(0, 7)})`).first()).toBeVisible();
    await page.screenshot({ path: shot('changes-diff-worktree') });

    // Committed since the project was opened: the baseline's commit against the last.
    await panel.getByTestId('sc-file').filter({ hasText: PKG }).click();
    await expect(page.getByTestId('code-compare-words')).toHaveText(`Committed since you opened it: 2 commits since ${BASE.slice(0, 7)}, when the graph's baseline was taken`);
    await diffLoaded(page);
    await expect.poll(() => asked).toEqual(expect.arrayContaining([`${PKG}|commit:${BASE}`, `${PKG}|commit:HEAD`]));
  });

  test('a changed file opened from the tree says it changed, and leads to its diff', async ({ page }) => {
    const asked: string[] = [];
    await serve(page, asked);
    await gotoWithProject(page);
    // The root README, not one in a folder: the tree has more than one.
    await page.locator(`button[data-path="${path.join(PROJECT_PATH, README)}"]`).click();
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    const chip = page.getByTestId('code-changed-chip');
    await expect(chip).toContainText('Changed, not staged');
    await chip.screenshot({ path: shot('changes-chip') });
    await chip.getByRole('button', { name: 'Show the diff' }).click();
    await expect(page.getByTestId('code-compare-words')).toHaveText('Changed, not staged: Edited but not yet staged for a commit. Compared with what is staged');
    await diffLoaded(page);
    await expect.poll(() => asked).toEqual(expect.arrayContaining([`${README}|index`, `${README}|live`]));
  });
});
