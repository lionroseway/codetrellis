/**
 * Phase 32 E3 — the evolution view: a file at two points side by side,
 * each side scrubbing back through its commits, or both locked in time.
 *
 * The journey: Priya opens refund logic she did not write. Evolution puts
 * the file on billing-v2 (a teammate's agent's branch) on the left and her
 * checkout on the right. She scrubs the left back through its commits; the
 * card names each commit, its git author and, where CodeTrellis knows, the
 * agent and how it knows; between the two, what was decided. Locked,
 * moving one side moves the other to the same moment.
 *
 * The histories and file contents are served from a realistic state; the
 * real git paths are the harness's (tests/e2e/file-history.test.ts).
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

const commit = (sha: string, daysAgo: number, subject: string, extra: Record<string, unknown> = {}) => ({
  spec: `commit:${sha}`, kind: 'commit', path: FILE, sha, short: sha.slice(0, 7), at: T - daysAgo * DAY,
  author: 'Sam Lee', email: 'sam@acme.test', subject, status: 'modified', attribution: null, ...extra,
});

const HISTORIES: Record<string, unknown> = {
  'commit:refs/heads/billing-v2': {
    at: 'commit:refs/heads/billing-v2', label: 'billing-v2', path: FILE, truncated: false, command: `git log --follow billing-v2 -- ${FILE}`,
    positions: [
      commit('4a1b2c3d4e5f60718293a4b5c6d7e8f901234567', 1, 'Half-even, as approved', { attribution: { agent: 'codex', how: 'seen', words: "codex, seen: it landed while CodeTrellis recorded codex's session in acme-billing", sessionId: 's-bill' } }),
      commit('5b2c3d4e5f60718293a4b5c6d7e8f90123456789', 3, 'Round to the cent', { attribution: { agent: 'codex', how: 'commit message', words: 'codex, from the commit message' } }),
      commit('6c3d4e5f60718293a4b5c6d7e8f9012345678901', 9, 'Name it for refunds', { status: 'renamed', from: 'ROUND.md', path: 'ROUND.md' }),
    ],
  },
  live: {
    at: 'live', label: 'Your working copy', path: FILE, truncated: false, command: `git log --follow -- ${FILE}`,
    positions: [
      { spec: 'live', kind: 'working', path: FILE, sha: null, short: null, at: null, author: null, email: null, subject: null, status: null, attribution: null },
      commit('7d4e5f60718293a4b5c6d7e8f901234567890123', 2, 'Changelog'),
      commit('6c3d4e5f60718293a4b5c6d7e8f9012345678901', 9, 'Name it for refunds', { status: 'renamed', from: 'ROUND.md' }),
    ],
  },
};

const CONTENT: Record<string, string> = {
  '4a1b2c3': '# Refunds\n\nRound half-even, to the cent.\n',
  '5b2c3d4': '# Refunds\n\nRound to the cent.\n',
  '6c3d4e5': '# Refunds\n\nRound.\n',
  '7d4e5f6': '# Refunds\n\nRound.\n\nSee the changelog.\n',
  live: '# Refunds\n\nRound.\n\nSee the changelog.\n',
};

async function serve(page: Page, asked: string[]) {
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/source-control?*', (r) => r.fulfill(json({ project: PROJECT_PATH, git: true, branch: 'main', head: null, groups: [], words: 'Nothing has changed.' })));
  await page.route('**/api/git/refs?*', (r) => r.fulfill(json({
    project: PROJECT_PATH, git: true, branch: 'main', fetchedAt: null,
    groups: [
      { kind: 'checkout', title: 'This checkout', words: '', git: { term: 'HEAD', command: 'git status' }, refs: [{ spec: 'live', kind: 'checkout', name: 'Working copy', words: '', term: 'working tree', sha: null, at: null, subject: null }] },
      { kind: 'branch', title: 'Branches', words: '', git: { term: 'branch', command: 'git branch' }, refs: [
        { spec: 'commit:refs/heads/main', kind: 'branch', name: 'main', words: '', term: 'branch', sha: '7d4e5f6', at: T - 2 * DAY, subject: 'Changelog', current: true },
        { spec: 'commit:refs/heads/billing-v2', kind: 'branch', name: 'billing-v2', words: '', term: 'branch', sha: '4a1b2c3', at: T - DAY, subject: 'Half-even, as approved' },
      ] },
    ],
  })));
  await page.route('**/api/git/file-history?*', (r) => {
    const at = new URL(r.request().url()).searchParams.get('at') ?? 'live';
    return r.fulfill(HISTORIES[at] ? json(HISTORIES[at]) : json({ error: 'No such side' }, 400));
  });
  await page.route('**/api/file/at?*', (r) => {
    const u = new URL(r.request().url());
    const at = u.searchParams.get('at') ?? '';
    asked.push(`${u.searchParams.get('path')}|${at}`);
    const key = at === 'live' ? 'live' : at.slice('commit:'.length, 'commit:'.length + 7);
    return r.fulfill(json({ ok: true, content: CONTENT[key] ?? null, label: at }));
  });
  await page.route('**/api/record/decisions?*', (r) => r.fulfill(json({
    from: 0, to: 0, words: '1 decision recorded on this computer between these two moments.',
    decisions: [{ seq: 41, at: T - 1.5 * DAY, type: 'criterion_decided', words: 'Sam approved “Refunds round half-even”' }],
  })));
}

test.describe('The evolution view', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a file at two points, each scrubbing its own commits, the cards say who and how, and locked they move together', async ({ page }) => {
    const asked: string[] = [];
    await serve(page, asked);
    await gotoWithProject(page);
    await page.getByRole('button', { name: FILE, exact: true }).first().click();
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await page.getByTestId('code-evolution').click();

    const view = page.getByTestId('evolution');
    const left = view.locator('[data-testid="evo-side"][data-side="left"]');
    const right = view.locator('[data-testid="evo-side"][data-side="right"]');
    // This checkout on both sides to start: the last commit against the working copy.
    await expect(right.getByTestId('evo-card-subject')).toHaveText('The working copy, as it is now');
    await expect(left.getByTestId('evo-card-subject')).toHaveText('Changelog');

    // The left side becomes the agent's branch.
    const leftPicker = view.locator('[data-testid="ref-picker"][data-side="before"]');
    await leftPicker.getByTestId('ref-picker-open').click();
    await leftPicker.locator('[data-testid="ref-option"][data-spec="commit:refs/heads/billing-v2"]').click();
    await expect(left.getByTestId('evo-card-subject')).toHaveText('Half-even, as approved');
    await expect(left.getByTestId('evo-position')).toHaveText('3 of 3');
    await expect(left.getByTestId('evo-card-attribution')).toHaveText("codex, seen: it landed while CodeTrellis recorded codex's session in acme-billing");
    await expect(view.getByTestId('evo-command').first()).toHaveText(`$ git log --follow billing-v2 -- ${FILE}`);
    await expect(page.getByText('Round half-even, to the cent.').first()).toBeVisible({ timeout: 20_000 });
    await expect(view.getByTestId('evo-decision')).toHaveText([/Sam approved “Refunds round half-even”/]);
    await page.screenshot({ path: shot('evolution') });

    // Scrubbing the left side back: the commit before, from the commit message.
    await left.getByTestId('evo-older').click();
    await expect(left.getByTestId('evo-card-subject')).toHaveText('Round to the cent');
    await expect(left.getByTestId('evo-card-author')).toContainText('Sam Lee');
    await expect(left.getByTestId('evo-card-attribution')).toHaveText('codex, from the commit message');
    await expect(page.getByText('Round to the cent.').first()).toBeVisible({ timeout: 20_000 });
    // Back past the rename: read at the path it had then.
    await left.getByTestId('evo-older').click();
    await expect(left.getByTestId('evo-card-author')).toContainText('renamed from ROUND.md');
    await expect.poll(() => asked).toContain('ROUND.md|commit:6c3d4e5f60718293a4b5c6d7e8f9012345678901');

    // Locked: moving the left to three days ago puts the right where it stood then.
    await view.getByTestId('evo-lock').click();
    await expect(view.getByTestId('evo-lock')).toHaveAttribute('aria-pressed', 'true');
    await left.getByTestId('evo-newer').click();
    await expect(left.getByTestId('evo-card-subject')).toHaveText('Round to the cent');
    await expect(right.getByTestId('evo-card-subject')).toHaveText('Name it for refunds');
    await left.getByTestId('evo-newer').click();
    await expect(right.getByTestId('evo-card-subject')).toHaveText('Changelog');
    await page.screenshot({ path: shot('evolution-locked') });
  });
});
