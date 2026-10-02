/**
 * Phase 32 E2a — compare any two points, with no plan.
 *
 * In the Changes tab, "Compare two points" offers this checkout, every
 * branch, remote branch, tag and worktree, each with git's word; choosing
 * two lists the files that differ, with the command that shows the same;
 * "From where they split" narrows it to what the second side changed; a
 * file opens its diff in the code view, both sides named above it.
 *
 * The listing and the two sides of each file are served from a realistic
 * state, as changes.spec serves its own; the real git paths are the
 * harness's (tests/e2e/refs.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, PROJECT_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const diffLoaded = (page: Page) => expect(page.getByText(/Loading the diff editor/)).toHaveCount(0, { timeout: 20_000 });
const shot = (name: string) => { fs.mkdirSync(OUT, { recursive: true }); return path.join(OUT, `${name}.png`); };

const FILE = 'README.md';
const SPLIT = 'merge-base:refs/heads/main...refs/heads/billing-v2';

const SC = { project: PROJECT_PATH, git: true, branch: 'main', head: { sha: '3f9c2e1', subject: 'Changelog' }, words: 'Nothing has changed: this checkout matches its last commit (3f9c2e1 “Changelog”), and no other worktree or branch has work in progress.', groups: [] };

const REFS = {
  project: PROJECT_PATH, git: true, branch: 'main', fetchedAt: Date.now() - 2 * 3_600_000,
  groups: [
    { kind: 'checkout', title: 'This checkout', words: 'Your working copy, what is staged, and the last commit on main', git: { term: 'HEAD', command: 'git status' }, refs: [
      { spec: 'live', kind: 'checkout', name: 'Working copy', words: 'Your files as they are now', term: 'working tree', sha: null, at: null, subject: null },
      { spec: 'index', kind: 'checkout', name: 'Staged', words: 'What goes into the next commit', term: 'index', sha: null, at: null, subject: null },
      { spec: 'commit:HEAD', kind: 'checkout', name: 'Last commit', words: '3f9c2e1 “Changelog”', term: 'HEAD', sha: '3f9c2e1', at: null, subject: 'Changelog' },
    ] },
    { kind: 'branch', title: 'Branches', words: 'Branches in this repository', git: { term: 'branch', command: 'git branch' }, refs: [
      { spec: 'commit:refs/heads/main', kind: 'branch', name: 'main', words: 'A branch here, last changed 1 h ago', term: 'branch', sha: '3f9c2e1', at: Date.now() - 3_600_000, subject: 'Changelog', current: true },
      { spec: 'commit:refs/heads/billing-v2', kind: 'branch', name: 'billing-v2', words: 'A branch here, last changed 3 days ago', term: 'branch', sha: '4a1b2c3', at: Date.now() - 3 * 86_400_000, subject: 'Round refunds half-even' },
    ] },
    { kind: 'remote', title: 'Remote branches', words: "Other copies' branches as this repository last fetched them: fetched 2 h ago", git: { term: 'remote-tracking', command: 'git branch -r' }, refs: [
      { spec: 'commit:refs/remotes/origin/main', kind: 'remote', name: 'origin/main', words: "origin's main, as last fetched (2 h ago)", term: 'remote-tracking branch', sha: '3f9c2e1', at: Date.now() - 3_600_000, subject: 'Changelog' },
    ] },
    { kind: 'tag', title: 'Tags', words: 'Named points, usually releases', git: { term: 'tag', command: 'git tag' }, refs: [
      { spec: 'commit:refs/tags/v1.0', kind: 'tag', name: 'v1.0', words: 'A tag, made 9 days ago', term: 'tag', sha: 'a1b2c3d', at: Date.now() - 9 * 86_400_000, subject: 'First release' },
    ] },
    { kind: 'worktree', title: 'Worktrees', words: 'Other working copies of this repository', git: { term: 'worktree', command: 'git worktree list' }, refs: [
      { spec: 'workstream:/work/acme-agent', kind: 'worktree', name: 'refunds-agent', words: 'A worktree at /work/acme-agent, worked on by codex: its files now, committed or not', term: 'worktree', sha: '3f9c2e1', at: null, subject: null, agents: ['codex'] },
    ] },
  ],
};

function pairFor(before: string, after: string) {
  const name = (s: string) => (s === SPLIT ? 'where main and billing-v2 split (a1b2c3d)' : s === 'live' ? 'your working copy' : s.replace(/^commit:refs\/(heads|tags|remotes)\//, ''));
  const label = (s: string) => (s === SPLIT ? 'Where main and billing-v2 split (a1b2c3d)' : s === 'live' ? 'Your working copy' : name(s));
  const split = before === SPLIT;
  const files = split ? [{ path: FILE, status: 'modified' }] : [{ path: FILE, status: 'modified' }, { path: 'CHANGELOG.md', status: 'deleted' }];
  return {
    before, after, labels: { before: label(before), after: label(after) }, truncated: false, files,
    command: split ? 'git diff main...billing-v2' : `git diff ${name(before)} ${name(after)}`,
    words: `${files.length} file${files.length === 1 ? ' differs' : 's differ'} between ${name(before)} and ${name(after)}.`,
  };
}

async function serve(page: Page, asked: string[]) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/source-control?*', (r) => r.fulfill(json(SC)));
  await page.route('**/api/git/refs?*', (r) => r.fulfill(json(REFS)));
  await page.route('**/api/git/refs/compare?*', async (r) => {
    const u = new URL(r.request().url());
    // A comparison is read on demand; the chip shows while it is.
    await new Promise((res) => setTimeout(res, 300));
    return r.fulfill(json(pairFor(u.searchParams.get('before')!, u.searchParams.get('after')!)));
  });
  await page.route('**/api/file/at?*', (r) => {
    const u = new URL(r.request().url());
    const at = u.searchParams.get('at') ?? '';
    asked.push(`${u.searchParams.get('path')}|${at}`);
    const content = at.includes('billing-v2') && !at.startsWith('merge-base:')
      ? '# CodeTrellis\n\nRefunds round half-even.\n'
      : '# CodeTrellis\n\nRefunds round.\n';
    return r.fulfill(json({ ok: true, content, label: at }));
  });
}

test.describe('Compare two points', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('any branch, tag, remote branch or worktree on either side; from where they split; a file opens its diff', async ({ page }) => {
    const asked: string[] = [];
    await serve(page, asked);
    await gotoWithProject(page);
    await page.getByTestId('sidebar-changes').first().click();
    const panel = page.getByTestId('source-control').last();
    await panel.getByTestId('compare-pair-toggle').click();

    // Opened on this checkout's branch against the working copy.
    const before = panel.locator('[data-testid="ref-picker"][data-side="before"]');
    const after = panel.locator('[data-testid="ref-picker"][data-side="after"]');
    await expect(before.getByTestId('ref-picker-name')).toHaveText('main');
    await expect(after.getByTestId('ref-picker-name')).toHaveText('Working copy');

    // Every point, grouped as git groups them, each group with its command.
    await after.getByTestId('ref-picker-open').click();
    const menu = after.getByTestId('ref-menu');
    await expect(menu.getByTestId('ref-group-title')).toHaveText(['This checkout', 'Branches', 'Remote branches', 'Tags', 'Worktrees']);
    await expect(menu.getByText('$ git branch -r')).toBeVisible();
    await expect(menu.locator('[data-testid="ref-option"][data-spec="workstream:/work/acme-agent"]')).toContainText('codex');
    await page.screenshot({ path: shot('compare-ref-menu') });
    // A filter narrows the list.
    await menu.getByTestId('ref-filter').fill('billing');
    await expect(menu.getByTestId('ref-option')).toHaveCount(1);
    await menu.getByTestId('ref-option').click();
    await expect(after.getByTestId('ref-picker-name')).toHaveText('billing-v2');

    await expect(panel.getByTestId('pair-words')).toHaveText('2 files differ between main and billing-v2.');
    await expect(panel.getByTestId('pair-git-command')).toHaveText('$ git diff main billing-v2');
    await expect(panel.getByTestId('pair-file')).toHaveCount(2);

    // From where they split: only what billing-v2 changed.
    await panel.getByTestId('compare-from-split').check();
    await expect(panel.getByTestId('pair-loading')).toBeVisible();
    await expect(panel.getByTestId('pair-words')).toHaveText('1 file differs between where main and billing-v2 split (a1b2c3d) and billing-v2.');
    await expect(panel.getByTestId('pair-git-command')).toHaveText('$ git diff main...billing-v2');
    await panel.screenshot({ path: shot('compare-pair') });

    // A file opens its diff between those two, both named.
    await panel.getByTestId('pair-file').filter({ hasText: FILE }).click();
    await expect(page.getByTestId('code-compare-words')).toHaveText('Two points: Where main and billing-v2 split (a1b2c3d) → billing-v2');
    await expect(page.getByTestId('code-git-command')).toHaveText(`$ git diff main...billing-v2 -- ${FILE}`);
    await diffLoaded(page);
    await expect.poll(() => asked).toEqual(expect.arrayContaining([`${FILE}|${SPLIT}`, `${FILE}|commit:refs/heads/billing-v2`]));
    await expect(page.getByText('Refunds round half-even.').first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot('compare-diff') });

    // Swapped, it reads the other way: what main changed since the two split.
    await panel.getByTestId('compare-swap').click();
    await expect(before.getByTestId('ref-picker-name')).toHaveText('billing-v2');
    await expect(after.getByTestId('ref-picker-name')).toHaveText('main');
    await expect(panel.getByTestId('compare-from-split')).toBeChecked();
  });

  test('the graph compares the same two: its marks are what differs between them, said at the top, and it stops', async ({ page }) => {
    const asked: string[] = [];
    await serve(page, asked);
    const compared: string[] = [];
    await page.route('**/api/compare?*', async (r) => {
      const u = new URL(r.request().url());
      compared.push(`${u.searchParams.get('before')} → ${u.searchParams.get('after')}`);
      await new Promise((res) => setTimeout(res, 300));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        before: { spec: SPLIT, label: 'Where main and billing-v2 split (a1b2c3d)', fileCount: 480, edgesKnown: true },
        after: { spec: 'commit:refs/heads/billing-v2', label: 'billing-v2', fileCount: 481, edgesKnown: true },
        diff: {
          addedFiles: ['src/backend/services/rounding.ts'], removedFiles: [], modifiedFiles: ['src/backend/server.ts', 'src/backend/services/git-refs.ts'],
          addedEdges: [{ source: 'src/backend/services/git-refs.ts', target: 'src/backend/services/rounding.ts' }], removedEdges: [], blastRadius: [],
          summary: { added: 1, removed: 0, modified: 2, edgesAdded: 1, edgesRemoved: 0 },
        },
        edgesComparable: true, notes: [],
      }) });
    });
    await gotoWithProject(page);
    await page.getByTestId('sidebar-changes').first().click();
    const panel = page.getByTestId('source-control').last();
    await panel.getByTestId('compare-pair-toggle').click();
    const after = panel.locator('[data-testid="ref-picker"][data-side="after"]');
    await after.getByTestId('ref-picker-open').click();
    await after.locator('[data-testid="ref-option"][data-spec="commit:refs/heads/billing-v2"]').click();
    await panel.getByTestId('compare-from-split').check();
    await expect(panel.getByTestId('pair-words')).toHaveText(/^1 file differs/);

    await panel.getByTestId('compare-on-graph').click();
    await expect(panel.getByTestId('compare-on-graph')).toHaveAttribute('aria-pressed', 'true');
    const banner = page.getByTestId('graph-pair');
    await expect(banner.getByTestId('graph-pair-words')).toHaveText('Comparing Where main and billing-v2 split (a1b2c3d) → billing-v2 · 1 file added, 2 changed, 0 removed · 1 import added, 0 removed');
    await expect(banner.getByTestId('graph-pair-command')).toHaveText('$ git diff main...billing-v2');
    expect(compared).toContain(`${SPLIT} → commit:refs/heads/billing-v2`);
    await page.screenshot({ path: shot('compare-graph') });

    // Changing a side redraws it.
    await panel.getByTestId('compare-from-split').uncheck();
    await expect.poll(() => compared).toContain('commit:refs/heads/main → commit:refs/heads/billing-v2');

    // Stopping returns the graph to its own changes.
    await banner.getByTestId('graph-pair-stop').click();
    await expect(page.getByTestId('graph-pair')).toHaveCount(0);
    await expect(panel.getByTestId('compare-on-graph')).toHaveAttribute('aria-pressed', 'false');
  });
});
