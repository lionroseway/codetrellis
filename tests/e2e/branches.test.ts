/**
 * Phase 32 E5 — branches and pull requests, end to end, with no plan.
 *
 * The opened project is a clone of a local bare remote. GET /api/git/branches
 * lists its branches with upstream, ahead and behind, as last fetched; a
 * teammate's push shows only after POST /api/git/fetch, which broadcasts
 * `git-remotes-changed`; pull requests come through gh (here a stand-in
 * script), each with the pair that shows it; with no gh the listing says
 * the gh CLI is needed; Settings → Git is off by default and refuses an
 * interval it does not offer.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { openEventStream, setupHarness, type Harness } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

interface Row { name: string; spec: string; upstream: string | null; ahead: number | null; behind: number | null; words: string; term: string; trackedBy: string | null; current: boolean }
interface Listing {
  git: boolean; branch: string | null; remotes: string[]; branches: Row[]; remoteBranches: Row[];
  commands: { branches: string; remoteBranches: string };
  fetch: { at: number | null; words: string; command: string; error: string | null; auto: { on: boolean; everyMinutes: number; words: string } };
  pulls: { status: string; words: string; command: string; pulls: Array<{ number: number; state: string; words: string; compare: { before: string; after: string } | null }> };
}

test.describe.serial('Branches and pull requests', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let teammate: string;
  let main: string;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-branches-e2e-'));
  const fakeGh = path.join(tmp, 'gh');
  const prs = path.join(tmp, 'prs.json');

  const q = () => `project=${encodeURIComponent(root)}`;
  const branches = async () => (await (await h.client.raw('GET', `/api/git/branches?${q()}`)).json()) as Listing;

  test.beforeAll(async () => {
    fs.writeFileSync(prs, '[]');
    fs.writeFileSync(fakeGh, `#!/bin/sh\ncat "${prs}"\n`, { mode: 0o755 });
    h = await setupHarness('branches', { env: { CODETRELLIS_GH: fakeGh } });
    root = h.fixture.projectPath;
    git(root, 'config', 'user.name', 'Sam Lee');
    git(root, 'config', 'user.email', 'sam@acme.test');
    main = git(root, 'symbolic-ref', '--short', 'HEAD');
    const remote = path.join(tmp, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', main, remote]);
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'push', '-q', '-u', 'origin', main);
    git(root, 'checkout', '-qb', 'billing-v2');
    fs.writeFileSync(path.join(root, 'cents.ts'), 'export const cents = 100;\n');
    git(root, 'add', 'cents.ts');
    git(root, 'commit', '-qm', 'Cents');
    git(root, 'push', '-q', '-u', 'origin', 'billing-v2');
    fs.appendFileSync(path.join(root, 'cents.ts'), '// half-even\n');
    git(root, 'commit', '-qam', 'Half-even');
    git(root, 'checkout', '-q', main);
    teammate = path.join(tmp, 'teammate');
    execFileSync('git', ['clone', '-q', remote, teammate]);
    await h.client.scanProject(root);
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('each branch with its upstream, ahead and behind, said plainly and as git says it', async () => {
    const l = await branches();
    expect(l.git).toBe(true);
    expect(l.branch).toBe(main);
    expect(l.remotes).toEqual(['origin']);
    const billing = l.branches.find((b) => b.name === 'billing-v2')!;
    expect(billing).toMatchObject({ upstream: 'origin/billing-v2', ahead: 1, behind: 0, words: '1 commit not pushed yet', term: 'ahead 1', spec: 'commit:refs/heads/billing-v2' });
    expect(l.branches.find((b) => b.name === main)).toMatchObject({ current: true, words: `Level with origin/${main}`, term: 'up to date' });
    expect(l.remoteBranches.find((b) => b.name === 'origin/billing-v2')).toMatchObject({ trackedBy: 'billing-v2', term: 'upstream of billing-v2' });
    expect(l.commands).toEqual({ branches: 'git branch -vv', remoteBranches: 'git branch -r' });
    expect(l.fetch.command).toBe('git fetch --all --prune');
    expect(l.fetch.auto).toMatchObject({ on: false, everyMinutes: 15 });
    expect(l.fetch.auto.words).toMatch(/off\)\.$/);
    expect(l.pulls.status).toBe('never');
    expect(l.pulls.words).toBe('Pull requests are read through the gh CLI when you fetch.');
  });

  test('a teammate\'s push shows after Fetch now, with its pull request', async () => {
    git(teammate, 'checkout', '-qb', 'refunds-agent');
    fs.writeFileSync(path.join(teammate, 'refunds.ts'), 'export const refund = 1;\n');
    git(teammate, 'add', '-A');
    git(teammate, 'commit', '-qm', 'Refunds, by the agent');
    git(teammate, 'push', '-q', 'origin', 'refunds-agent');
    fs.writeFileSync(prs, JSON.stringify([{
      number: 7, title: 'Refunds, by the agent', state: 'OPEN', isDraft: false, headRefName: 'refunds-agent', baseRefName: main,
      author: { login: 'teammate' }, updatedAt: new Date().toISOString(), url: 'https://github.com/acme/billing/pull/7', reviewDecision: 'REVIEW_REQUIRED',
    }]));
    expect((await branches()).remoteBranches.map((b) => b.name)).not.toContain('origin/refunds-agent');

    const events = await openEventStream(h.backend);
    try {
      const res = await h.client.raw('POST', `/api/git/fetch?${q()}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; words: string; command: string; listing: Listing };
      expect(body.ok).toBe(true);
      expect(body.words).toBe('Fetched origin just now.');
      expect(body.listing.remoteBranches.find((b) => b.name === 'origin/refunds-agent')).toMatchObject({ trackedBy: null, term: 'remote-tracking' });
      await events.waitFor('git-remotes-changed', (p) => p.project === root, 5_000);
    } finally {
      await events.close();
    }
    const l = await branches();
    expect(l.fetch.words).toBe('Last fetched just now');
    expect(l.pulls.status).toBe('ok');
    expect(l.pulls.words).toBe('1 open of the 1 most recent, read just now.');
    const [pr] = l.pulls.pulls;
    expect(pr).toMatchObject({ number: 7, state: 'open', compare: { before: `merge-base:refs/remotes/origin/${main}...refs/remotes/origin/refunds-agent`, after: 'commit:refs/remotes/origin/refunds-agent' } });
    expect(pr.words).toMatch(new RegExp(`^Open, waiting on review · refunds-agent into ${main} · teammate · just now$`));
    // The pair compares through E2's route.
    const cmp = await h.client.raw('GET', `/api/git/refs/compare?${q()}&before=${encodeURIComponent(pr.compare!.before)}&after=${encodeURIComponent(pr.compare!.after)}`);
    expect(((await cmp.json()) as { files: Array<{ path: string; status: string }> }).files).toEqual([{ path: 'refunds.ts', status: 'added' }]);
  });

  test('Settings → Git: keeping remotes current is off by default, and takes only the intervals offered', async () => {
    const s = (await (await h.client.raw('GET', '/api/settings')).json()) as { git: { keepRemotesCurrent: boolean; everyMinutes: number } };
    expect(s.git).toEqual({ keepRemotesCurrent: false, everyMinutes: 15 });
    const bad = await h.client.raw('PUT', '/api/settings', { git: { everyMinutes: 2 } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('git.everyMinutes must be 5, 15, 30, 60 minutes');
    const ok = await h.client.raw('PUT', '/api/settings', { git: { keepRemotesCurrent: true, everyMinutes: 30 } });
    expect(ok.status).toBe(200);
    expect((await branches()).fetch.auto).toMatchObject({ on: true, everyMinutes: 30, words: 'Kept current: fetched every 30 min while this project is open (Settings → Git).' });
    await h.client.raw('PUT', '/api/settings', { git: { keepRemotesCurrent: false } });
  });

  test('refused: no project, a project not open', async () => {
    expect((await h.client.raw('GET', '/api/git/branches')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/git/branches?project=${encodeURIComponent('/not/opened')}`)).status).toBe(403);
    expect((await h.client.raw('POST', `/api/git/fetch?project=${encodeURIComponent('/not/opened')}`)).status).toBe(403);
    expect((await h.client.raw('POST', '/api/git/fetch')).status).toBe(400);
  });
});

test.describe.serial('Pull requests with no gh', () => {
  test.setTimeout(120_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('branches-no-gh', { env: { CODETRELLIS_GH: path.join(os.tmpdir(), 'ct-no-such-gh') } });
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('branches still list, and the pull requests say the gh CLI is needed', async () => {
    const root = h.fixture.projectPath;
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-no-gh-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'push', '-q', 'origin', 'HEAD');
    const q = `project=${encodeURIComponent(root)}`;
    const fetched = await h.client.raw('POST', `/api/git/fetch?${q}`);
    expect(fetched.status).toBe(200);
    const l = (await (await h.client.raw('GET', `/api/git/branches?${q}`)).json()) as Listing;
    expect(l.branches.length).toBeGreaterThan(0);
    expect(l.pulls.status).toBe('no-gh');
    expect(l.pulls.words).toBe('Pull requests need the gh CLI (cli.github.com), installed and signed in. Branches work without it.');
  });
});
