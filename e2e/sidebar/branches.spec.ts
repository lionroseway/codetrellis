/**
 * Phase 32 E5 — branches and pull requests, with no plan.
 *
 * In the Changes tab, "Branches and pull requests" lists each branch with
 * its upstream, ahead and behind, plainly and in git's words; Fetch now
 * brings a teammate's pushed branch and its pull request; a pull request's
 * Compare fills "Compare two points" with its base and head from where they
 * split; the line about keeping remotes current opens Settings → Git, off by
 * default, where it turns on with an interval.
 *
 * The listings are served from a realistic state; the real git and gh paths
 * are the harness's (tests/e2e/branches.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, PROJECT_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const shot = (name: string) => { fs.mkdirSync(OUT, { recursive: true }); return path.join(OUT, `${name}.png`); };

const SC = { project: PROJECT_PATH, git: true, branch: 'main', head: { sha: '3f9c2e1', subject: 'Changelog' }, words: 'Nothing has changed: this checkout matches its last commit (3f9c2e1 “Changelog”), and no other worktree or branch has work in progress.', groups: [] };
const REFS = { project: PROJECT_PATH, git: true, branch: 'main', fetchedAt: null, groups: [] };

const H = 3_600_000;
const row = (r: Partial<Record<string, unknown>>) => ({ sha: '3f9c2e1', subject: null, current: false, upstream: null, ahead: null, behind: null, gone: false, trackedBy: null, ...r });

function listing(fetched: boolean, auto = false) {
  const remote = [
    row({ spec: 'commit:refs/remotes/origin/main', kind: 'remote', name: 'origin/main', at: Date.now() - (fetched ? 0.2 : 2) * H, words: 'main on origin, as last fetched; your main follows it', term: 'upstream of main', trackedBy: 'main' }),
    row({ spec: 'commit:refs/remotes/origin/billing-v2', kind: 'remote', name: 'origin/billing-v2', at: Date.now() - 26 * H, words: 'billing-v2 on origin, as last fetched; your billing-v2 follows it', term: 'upstream of billing-v2', trackedBy: 'billing-v2' }),
    ...(fetched ? [row({ spec: 'commit:refs/remotes/origin/refunds-agent', kind: 'remote', name: 'origin/refunds-agent', at: Date.now() - 0.3 * H, words: 'refunds-agent on origin, as last fetched; no branch here follows it', term: 'remote-tracking' })] : []),
  ];
  return {
    project: PROJECT_PATH, git: true, branch: 'main', remotes: ['origin'],
    branches: [
      row({ spec: 'commit:refs/heads/main', kind: 'branch', name: 'main', at: Date.now() - 2 * H, current: true, upstream: 'origin/main', ahead: 0, behind: fetched ? 1 : 0,
        words: fetched ? '1 commit on origin/main not here yet' : 'Level with origin/main', term: fetched ? 'behind 1' : 'up to date' }),
      row({ spec: 'commit:refs/heads/billing-v2', kind: 'branch', name: 'billing-v2', at: Date.now() - 20 * H, upstream: 'origin/billing-v2', ahead: 2, behind: 0, words: '2 commits not pushed yet', term: 'ahead 2' }),
      row({ spec: 'commit:refs/heads/spike', kind: 'branch', name: 'spike', at: Date.now() - 72 * H, words: 'Only here: not pushed anywhere yet', term: 'no upstream' }),
    ],
    remoteBranches: remote,
    commands: { branches: 'git branch -vv', remoteBranches: 'git branch -r' },
    fetch: {
      at: Date.now() - (fetched ? 0 : 2) * H, words: fetched ? 'Last fetched just now' : 'Last fetched 2 h ago', command: 'git fetch --all --prune', running: false, error: null,
      auto: auto
        ? { on: true, everyMinutes: 30, words: 'Kept current: fetched every 30 min while this project is open (Settings → Git).' }
        : { on: false, everyMinutes: 15, words: 'Remotes are as last fetched. Fetch now, or keep them current in Settings → Git (off).' },
    },
    pulls: fetched ? {
      status: 'ok', readAt: Date.now(), command: 'gh pr list --state all', words: '1 open of the 2 most recent, read just now.',
      pulls: [
        { number: 7, title: 'Refunds, by the agent', state: 'open', head: 'refunds-agent', base: 'main', author: 'teammate', updatedAt: Date.now() - 0.3 * H, url: 'https://github.com/acme/billing/pull/7', review: 'waiting on review',
          words: 'Open, waiting on review · refunds-agent into main · teammate · 18 min ago',
          compare: { before: 'merge-base:refs/remotes/origin/main...refs/remotes/origin/refunds-agent', after: 'commit:refs/remotes/origin/refunds-agent' } },
        { number: 5, title: 'Round refunds half-even', state: 'merged', head: 'billing-v1', base: 'main', author: 'sam', updatedAt: Date.now() - 96 * H, url: 'https://github.com/acme/billing/pull/5', review: null,
          words: 'Merged · billing-v1 into main · sam · 4 days ago', compare: null },
      ],
    } : { status: 'never', readAt: null, pulls: [], command: 'gh pr list --state all', words: 'Pull requests are read through the gh CLI when you fetch.' },
  };
}

async function serve(page: Page, state: { fetched: boolean; asked: string[] }) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/source-control?*', (r) => r.fulfill(json(SC)));
  await page.route('**/api/git/refs?*', (r) => r.fulfill(json(REFS)));
  await page.route('**/api/git/branches?*', (r) => r.fulfill(json(listing(state.fetched))));
  await page.route('**/api/git/fetch?*', async (r) => {
    // A fetch reaches the remote; the button says so while it does.
    await new Promise((res) => setTimeout(res, 400));
    state.fetched = true;
    return r.fulfill(json({ ok: true, at: Date.now(), words: 'Fetched origin just now.', command: 'git fetch --all --prune', error: null, listing: listing(true) }));
  });
  await page.route('**/api/git/refs/compare?*', (r) => {
    const u = new URL(r.request().url());
    state.asked.push(`${u.searchParams.get('before')} → ${u.searchParams.get('after')}`);
    return r.fulfill(json({
      before: u.searchParams.get('before'), after: u.searchParams.get('after'),
      labels: { before: 'Where origin/main and origin/refunds-agent split (3f9c2e1)', after: 'origin/refunds-agent (remote, as last fetched)' },
      files: [{ path: 'src/refunds.ts', status: 'added' }], truncated: false,
      command: 'git diff origin/main...origin/refunds-agent',
      words: '1 file differs between where origin/main and origin/refunds-agent split (3f9c2e1) and origin/refunds-agent (remote, as last fetched).',
    }));
  });
}

test.describe('Branches and pull requests', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('each branch ahead and behind; Fetch now brings a pushed branch and its pull request; Compare fills the two points', async ({ page }) => {
    const state = { fetched: false, asked: [] as string[] };
    await serve(page, state);
    await gotoWithProject(page);
    await page.getByTestId('sidebar-changes').first().click();
    const panel = page.getByTestId('source-control').last();
    const br = panel.getByTestId('branches');
    await br.getByTestId('branches-toggle').click();

    await expect(br.getByTestId('br-fetched')).toHaveText('Last fetched 2 h ago');
    await expect(br.getByTestId('br-fetch-command')).toHaveText('$ git fetch --all --prune');
    await expect(br.getByTestId('br-heading')).toHaveText(['Branches', 'Remote branches', 'Pull requests']);
    const billing = br.locator('[data-testid="br-row"][data-name="billing-v2"]');
    await expect(billing.getByTestId('br-words')).toHaveText('2 commits not pushed yet');
    await expect(billing.getByTestId('br-term')).toHaveText('ahead 2');
    await expect(br.locator('[data-testid="br-row"][data-name="spike"]').getByTestId('br-term')).toHaveText('no upstream');
    await expect(br.getByTestId('br-pulls-words')).toHaveText('Pull requests are read through the gh CLI when you fetch.');
    await expect(br.locator('[data-testid="br-row"][data-name="origin/refunds-agent"]')).toHaveCount(0);

    await br.getByTestId('br-fetch').click();
    await expect(br.getByTestId('br-fetch')).toHaveText('Fetching…');
    await expect(br.getByTestId('br-fetch-words')).toHaveText('Fetched origin just now.');
    await expect(br.getByTestId('br-fetched')).toHaveText('Last fetched just now');
    const main = br.locator('[data-testid="br-row"][data-name="main"]');
    await expect(main.getByTestId('br-words')).toHaveText('1 commit on origin/main not here yet');
    await expect(main.getByTestId('br-term')).toHaveText('behind 1');
    await expect(br.locator('[data-testid="br-row"][data-name="origin/refunds-agent"]').getByTestId('br-words')).toHaveText('refunds-agent on origin, as last fetched; no branch here follows it');
    await expect(br.getByTestId('br-pulls-words')).toHaveText('1 open of the 2 most recent, read just now.');
    const pr = br.locator('[data-testid="br-pull"][data-number="7"]');
    await expect(pr.getByTestId('br-pull-state')).toHaveText('Open');
    await expect(pr.getByTestId('br-pull-words')).toHaveText('Open, waiting on review · refunds-agent into main · teammate · 18 min ago');
    await expect(pr.getByTestId('br-pull-link')).toHaveAttribute('href', 'https://github.com/acme/billing/pull/7');
    await expect(br.locator('[data-testid="br-pull"][data-number="5"]')).toContainText('Its branch is not fetched here');
    await expect(br.getByTestId('branches-count')).toHaveText('3 · 1 PR');
    await br.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot('branches') });

    // A pull request's Compare: its base and head, from where they split.
    await pr.getByTestId('br-pull-compare').click();
    await expect(panel.locator('[data-testid="ref-picker"][data-side="before"]')).toBeVisible();
    await expect(panel.getByTestId('compare-from-split')).toBeChecked();
    await expect.poll(() => state.asked).toContain('merge-base:refs/remotes/origin/main...refs/remotes/origin/refunds-agent → commit:refs/remotes/origin/refunds-agent');
    await expect(panel.getByTestId('pair-git-command')).toHaveText('$ git diff origin/main...origin/refunds-agent');
    await expect(panel.getByTestId('pair-file')).toHaveText(/refunds\.ts/);

    // A branch compares with this checkout, from where they split.
    await billing.click();
    await expect.poll(() => state.asked).toContain('merge-base:refs/heads/main...refs/heads/billing-v2 → commit:refs/heads/billing-v2');
  });

  test('Settings → Git: keeping remotes current, off by default, turned on with an interval', async ({ page }) => {
    const state = { fetched: false, asked: [] as string[] };
    await serve(page, state);
    const put: unknown[] = [];
    // Saved here, not by the backend: turned on for real it would fetch this checkout.
    await page.route('**/api/settings', async (r) => {
      if (r.request().method() !== 'PUT') return r.fallback();
      const patch = r.request().postDataJSON();
      put.push(patch);
      const current = await (await r.fetch({ method: 'GET' })).json();
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...current, git: { ...current.git, ...patch.git } }) });
    });
    await gotoWithProject(page);
    await page.getByTestId('sidebar-changes').first().click();
    const br = page.getByTestId('source-control').last().getByTestId('branches');
    await br.getByTestId('branches-toggle').click();
    await expect(br.getByTestId('br-auto')).toHaveText('Remotes are as last fetched. Fetch now, or keep them current in Settings → Git (off).');
    await br.getByTestId('br-auto').click();

    const settings = page.getByTestId('git-settings');
    const keep = settings.getByTestId('git-keep-current').locator('input[type="checkbox"]');
    await expect(keep).not.toBeChecked();
    await expect(settings.getByTestId('git-every')).toBeDisabled();
    await expect(page.getByTestId('git-last-fetched')).toHaveText('Last fetched 2 h ago');
    await expect(page.getByTestId('git-pulls-words')).toHaveText('Pull requests are read through the gh CLI when you fetch.');
    // Checked once saved: the box shows what is stored.
    await keep.click();
    await expect(keep).toBeChecked();
    await expect(settings.getByTestId('git-every')).toBeEnabled();
    await settings.getByTestId('git-every').selectOption('30');
    await expect.poll(() => put).toEqual([{ git: { keepRemotesCurrent: true, everyMinutes: 15 } }, { git: { keepRemotesCurrent: true, everyMinutes: 30 } }]);
    await expect(settings.getByTestId('git-every')).toHaveValue('30');
    await page.screenshot({ path: shot('branches-settings') });
  });
});
