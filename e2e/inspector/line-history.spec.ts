/**
 * Phase 32 E4 — line history in the code view.
 *
 * The journey: a line in a file Priya did not write looks wrong. "Line
 * history" puts who wrote each run of lines beside the line numbers: the
 * agent where CodeTrellis knows, the git author otherwise. Choosing a run
 * opens its card: the commit, its git author, "codex, seen: it landed
 * while CodeTrellis recorded codex's session", how CodeTrellis knows, the
 * task and plan; from there, how the file changed around it opens
 * Evolution at that commit.
 *
 * The line history is served from a realistic state; the real git paths
 * are the harness's (tests/e2e/line-history.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, PROJECT_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const shot = (name: string) => { fs.mkdirSync(OUT, { recursive: true }); return path.join(OUT, `${name}.png`); };
const FILE = 'README.md';
const DAY = 86_400_000;
const T = Date.now();
const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const B = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const C = 'c3d4e5f60718293a4b5c6d7e8f90123456789012';

const HISTORY = {
  at: 'live', path: FILE, lineCount: 40, uncommitted: 2, command: `git blame -- ${FILE}`,
  hunks: [{ start: 1, end: 6, sha: A }, { start: 7, end: 12, sha: B }, { start: 13, end: 20, sha: C }, { start: 21, end: 38, sha: A }, { start: 39, end: 40, sha: null }],
  commits: {
    [A]: { sha: A, short: A.slice(0, 7), author: 'Sam Lee', email: 'sam@acme.test', at: T - 40 * DAY, subject: 'Start the readme', attribution: null },
    [B]: {
      sha: B, short: B.slice(0, 7), author: 'Sam Lee', email: 'sam@acme.test', at: T - 3 * DAY, subject: 'Round refunds to the cent',
      attribution: { agent: 'codex', how: 'seen', words: "codex, seen: it landed while CodeTrellis recorded codex's session in acme-billing", sessionId: 's-bill', task: { uid: 't1', title: 'Round refunds' }, plan: { uid: 'p1', title: 'Refunds to the cent' } },
    },
    [C]: {
      sha: C, short: C.slice(0, 7), author: 'Sam Lee', email: 'sam@acme.test', at: T - 1 * DAY, subject: 'Half-even, as approved',
      attribution: { agent: 'claude', how: 'commit message', words: "claude, from the commit's Co-Authored-By trailer (Claude Opus 5.5)" },
    },
  },
};

async function serve(page: Page, asked: string[]) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/source-control?*', (r) => r.fulfill(json({ project: PROJECT_PATH, git: true, branch: 'main', head: null, groups: [], words: 'Nothing has changed.' })));
  await page.route('**/api/git/line-history?*', async (r) => {
    asked.push(new URL(r.request().url()).searchParams.get('path') ?? '');
    await new Promise((res) => setTimeout(res, 250));
    return r.fulfill(json(HISTORY));
  });
  await page.route('**/api/git/refs?*', (r) => r.fulfill(json({ project: PROJECT_PATH, git: true, branch: 'main', fetchedAt: null, groups: [] })));
  await page.route('**/api/git/file-history?*', (r) => {
    const at = new URL(r.request().url()).searchParams.get('at') ?? '';
    asked.push(`history:${at}`);
    return r.fulfill(json({
      at, label: at === 'live' ? 'Your working copy' : 'Commit b2c3d4e', path: FILE, truncated: false, command: `git log --follow -- ${FILE}`,
      positions: at === 'live'
        ? [{ spec: 'live', kind: 'working', path: FILE, sha: null, short: null, at: null, author: null, email: null, subject: null, status: null, attribution: null }]
        : [{ spec: `commit:${B}`, kind: 'commit', path: FILE, sha: B, short: B.slice(0, 7), at: T - 3 * DAY, author: 'Sam Lee', email: 'sam@acme.test', subject: 'Round refunds to the cent', status: 'modified', attribution: HISTORY.commits[B].attribution }],
    }));
  });
}

test.describe('Line history', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('who wrote each run of lines, the card says who, how CodeTrellis knows, and leads to how the file changed', async ({ page }) => {
    const asked: string[] = [];
    await serve(page, asked);
    await gotoWithProject(page);
    await page.getByRole('button', { name: FILE, exact: true }).first().click();
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await page.getByTestId('code-line-history').click();

    await expect(page.getByTestId('line-history-words')).toHaveText('5 runs of lines from 3 commits; 2 lines not yet committed. Choose a run to see who and why.');
    await expect(page.getByTestId('line-history-command')).toHaveText(`$ git blame -- ${FILE}`);
    const first = page.locator('[data-testid="blame-cell"][data-first="true"]');
    await expect(first).toHaveText(['Sam Lee · 40d · Start the readme', 'codex · 3d · Round refunds to the cent', 'claude · 1d · Half-even, as approved', 'Sam Lee · 40d · Start the readme', 'Not committed yet']);
    expect(asked).toContain(FILE);

    await first.nth(1).click();
    const card = page.getByTestId('line-card');
    await expect(card.getByTestId('line-card-subject')).toHaveText('Lines 7–12: Round refunds to the cent');
    await expect(card.getByTestId('line-card-author')).toContainText('Sam Lee <sam@acme.test>');
    await expect(card.getByTestId('line-card-attribution')).toContainText("codex, seen: it landed while CodeTrellis recorded codex's session in acme-billing · session s-bill");
    await expect(card.getByTestId('line-card-how')).toHaveText('How CodeTrellis knows: CodeTrellis recorded the session when the commit landed.');
    await expect(card.getByTestId('line-card-task')).toHaveText('Worked on the task “Round refunds” in the plan “Refunds to the cent”.');
    await expect(card.getByTestId('line-card-command')).toHaveText('$ git show b2c3d4e');
    await page.screenshot({ path: shot('line-history') });

    // A person's commit: the git author only, said plainly.
    await first.nth(0).click();
    await expect(card.getByTestId('line-card-attribution')).toHaveText('CodeTrellis knows only the git author for this commit.');
    await expect(card.getByTestId('line-card-task-open')).toHaveCount(0);

    // From a run to how the file changed around it.
    await first.nth(1).click();
    await card.getByTestId('line-card-evolution').click();
    await expect(page.getByTestId('evolution')).toBeVisible();
    await expect.poll(() => asked).toContain(`history:commit:${B}`);
    await expect(page.locator('[data-testid="evo-side"][data-side="left"]').getByTestId('evo-card-subject')).toHaveText('Round refunds to the cent');
  });
});
