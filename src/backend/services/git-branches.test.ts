/**
 * Branches and pull requests (Phase 32 E5): ahead and behind said plainly
 * and in git's words; a teammate's push shows only after a fetch; gh's pull
 * requests read through a stand-in gh, mapped to the pair that shows them;
 * gh missing, signed out, or not on GitHub each said so; keeping remotes
 * current fetches only when on and due.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  fetchRemotes, ghStatus, keeperDue, keeperTick, listBranches, parseTrack, pullListing, readPullRequests,
  resetBranchState, toPulls, trackWords,
} from './git-branches';
import { settingsPatchProblem, mergeWithDefaults } from './settings-service';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const OFF = { keepRemotesCurrent: false, everyMinutes: 15 };

afterEach(() => { resetBranchState(); delete process.env.CODETRELLIS_GH; });

/** A clone of a bare remote, with main pushed and billing-v2 one commit ahead; and a teammate's clone. */
function repos() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-branches-'));
  const remote = path.join(tmp, 'remote.git');
  const seed = path.join(tmp, 'seed');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  fs.mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'refund.ts'), 'round(x)\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'Start');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', 'main');
  const mine = path.join(tmp, 'mine');
  execFileSync('git', ['clone', '-q', remote, mine]);
  git(mine, 'checkout', '-qb', 'billing-v2');
  fs.appendFileSync(path.join(mine, 'refund.ts'), 'half-even\n');
  git(mine, 'commit', '-qam', 'Half-even');
  git(mine, 'push', '-q', '-u', 'origin', 'billing-v2');
  fs.appendFileSync(path.join(mine, 'refund.ts'), 'cents\n');
  git(mine, 'commit', '-qam', 'Cents');
  git(mine, 'checkout', '-q', 'main');
  return { tmp, remote, seed, mine };
}

test('ahead and behind, plainly and in git\'s words', () => {
  assert.deepEqual(parseTrack('[ahead 2, behind 1]'), { ahead: 2, behind: 1, gone: false });
  assert.deepEqual(parseTrack('[gone]'), { ahead: 0, behind: 0, gone: true });
  assert.deepEqual(parseTrack(''), { ahead: 0, behind: 0, gone: false });
  assert.deepEqual(trackWords('origin/x', { ahead: 2, behind: 1, gone: false }), {
    words: '2 commits not pushed yet; 1 commit on origin/x not here yet', term: 'ahead 2, behind 1',
  });
  assert.deepEqual(trackWords('origin/x', { ahead: 0, behind: 0, gone: false }), { words: 'Level with origin/x', term: 'up to date' });
  assert.deepEqual(trackWords(null, { ahead: 0, behind: 0, gone: false }), { words: 'Only here: not pushed anywhere yet', term: 'no upstream' });
  assert.equal(trackWords('origin/x', { ahead: 0, behind: 0, gone: true }).term, 'upstream gone');
});

test('the branches here and on the remote, as last fetched; a teammate\'s push shows after a fetch', async () => {
  const { seed, mine } = repos();
  let l = await listBranches(mine, OFF);
  assert.equal(l.git, true);
  assert.equal(l.branch, 'main');
  const billing = l.branches.find((b) => b.name === 'billing-v2')!;
  assert.equal(billing.upstream, 'origin/billing-v2');
  assert.equal(billing.ahead, 1);
  assert.equal(billing.behind, 0);
  assert.equal(billing.words, '1 commit not pushed yet');
  assert.equal(billing.spec, 'commit:refs/heads/billing-v2');
  assert.equal(l.branches.find((b) => b.name === 'main')!.current, true);
  const remoteBilling = l.remoteBranches.find((b) => b.name === 'origin/billing-v2')!;
  assert.equal(remoteBilling.trackedBy, 'billing-v2');
  assert.match(remoteBilling.words, /^billing-v2 on origin, as last fetched; your billing-v2 follows it$/);
  assert.deepEqual(l.commands, { branches: 'git branch -vv', remoteBranches: 'git branch -r' });
  assert.match(l.fetch.words, /^Never fetched/);
  assert.equal(l.fetch.auto.on, false);

  // The teammate pushes main on.
  git(seed, 'pull', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(seed, 'notes.md'), 'n\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'Notes');
  git(seed, 'push', '-q', 'origin', 'main');
  l = await listBranches(mine, OFF);
  assert.equal(l.branches.find((b) => b.name === 'main')!.behind, 0, 'not seen before a fetch');

  process.env.CODETRELLIS_GH = path.join(os.tmpdir(), 'no-such-gh-binary');
  const fetched = await fetchRemotes(mine);
  assert.equal(fetched.ok, true);
  assert.equal(fetched.command, 'git fetch --all --prune');
  assert.match(fetched.words, /^Fetched origin just now\.$/);
  l = await listBranches(mine, OFF);
  const main = l.branches.find((b) => b.name === 'main')!;
  assert.equal(main.behind, 1);
  assert.equal(main.words, '1 commit on origin/main not here yet');
  assert.match(l.fetch.words, /^Last fetched just now$/);
  assert.equal(l.pulls.status, 'no-gh');
  assert.match(l.pulls.words, /need the gh CLI/);
});

test('a fetch that cannot reach its remote says why, and no remote is said plainly', async () => {
  const { tmp, mine } = repos();
  fs.renameSync(path.join(tmp, 'remote.git'), path.join(tmp, 'moved.git'));
  process.env.CODETRELLIS_GH = path.join(os.tmpdir(), 'no-such-gh-binary');
  const r = await fetchRemotes(mine);
  assert.equal(r.ok, false);
  assert.match(r.words, /^Could not fetch: /);
  assert.equal((await listBranches(mine, OFF)).fetch.error, r.error);
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-lone-'));
  git(lone, 'init', '-q');
  const none = await fetchRemotes(lone);
  assert.equal(none.words, 'This repository has no remote to fetch from.');
  assert.equal((await listBranches(lone, OFF)).fetch.words, 'No remote: this repository is only here');
});

test('two asks at once make one fetch', async () => {
  const { mine } = repos();
  process.env.CODETRELLIS_GH = path.join(os.tmpdir(), 'no-such-gh-binary');
  const a = fetchRemotes(mine);
  const b = fetchRemotes(mine);
  assert.equal(a, b);
  await a;
});

test('pull requests through gh, each with the pair that shows what it changes', async () => {
  const { tmp, mine } = repos();
  const fake = path.join(tmp, 'gh');
  const rows = [
    { number: 12, title: 'Round refunds half-even', state: 'OPEN', isDraft: false, headRefName: 'billing-v2', baseRefName: 'main', author: { login: 'sam' }, updatedAt: new Date().toISOString(), url: 'https://github.com/acme/billing/pull/12', reviewDecision: 'REVIEW_REQUIRED' },
    { number: 11, title: 'Old idea', state: 'CLOSED', isDraft: false, headRefName: 'gone-branch', baseRefName: 'main', author: { login: 'kim' }, updatedAt: '2026-09-01T00:00:00Z', url: 'javascript:alert(1)', reviewDecision: '' },
  ];
  fs.writeFileSync(path.join(tmp, 'prs.json'), JSON.stringify(rows));
  fs.writeFileSync(fake, `#!/bin/sh\ncat "${path.join(tmp, 'prs.json')}"\n`, { mode: 0o755 });
  process.env.CODETRELLIS_GH = fake;
  assert.equal(pullListing(mine).status, 'never');
  const l = await readPullRequests(mine);
  assert.equal(l.status, 'ok');
  assert.equal(l.command, 'gh pr list --state all');
  assert.match(l.words, /^1 open of the 2 most recent, read just now\.$/);
  const [open, closed] = l.pulls;
  assert.equal(open.state, 'open');
  assert.equal(open.review, 'waiting on review');
  assert.match(open.words, /^Open, waiting on review · billing-v2 into main · sam · just now$/);
  assert.deepEqual(open.compare, { before: 'merge-base:refs/remotes/origin/main...refs/remotes/origin/billing-v2', after: 'commit:refs/remotes/origin/billing-v2' });
  assert.equal(closed.state, 'closed');
  assert.equal(closed.compare, null, 'its branch was never fetched here');
  assert.equal(closed.url, null, 'only an https link is kept');

  // gh failing later keeps what was read.
  fs.writeFileSync(fake, '#!/bin/sh\necho "To get started with GitHub CLI, please run:  gh auth login" >&2\nexit 4\n', { mode: 0o755 });
  const after = await readPullRequests(mine);
  assert.equal(after.status, 'signed-out');
  assert.equal(after.pulls.length, 2);
  assert.match(after.words, /run gh auth login/);
});

test('what gh said, as something a person can act on', () => {
  const ran = (code: number, stderr: string) => ({ code, stdout: '', stderr, missing: false });
  assert.equal(ghStatus({ code: -1, stdout: '', stderr: '', missing: true }).status, 'no-gh');
  assert.equal(ghStatus(ran(4, '')).status, 'signed-out');
  assert.equal(ghStatus(ran(1, 'none of the git remotes configured for this repository point to a known GitHub host')).status, 'not-github');
  assert.deepEqual(ghStatus(ran(1, 'HTTP 502: Bad Gateway\nmore')), { status: 'error', detail: 'HTTP 502: Bad Gateway' });
  assert.equal(toPulls([{ number: 1, title: 't', state: 'OPEN', isDraft: true, headRefName: 'a', baseRefName: 'main' }], [], Date.now())[0].state, 'draft');
  assert.equal(toPulls([{ number: 2, title: 't', state: 'MERGED', headRefName: 'a', baseRefName: 'main', reviewDecision: 'APPROVED' }], [], Date.now())[0].review, null);
});

test('keeping remotes current: off by default, and on only when due', async () => {
  const s = mergeWithDefaults({});
  assert.deepEqual(s.git, { keepRemotesCurrent: false, everyMinutes: 15 });
  assert.equal(settingsPatchProblem({ git: { everyMinutes: 7 } }), 'git.everyMinutes must be 5, 15, 30, 60 minutes');
  assert.equal(settingsPatchProblem({ git: { keepRemotesCurrent: 'yes' } }), 'git.keepRemotesCurrent must be true or false');
  assert.equal(settingsPatchProblem({ git: { keepRemotesCurrent: true, everyMinutes: 30 } }), null);
  assert.equal(mergeWithDefaults({ git: { everyMinutes: 7 } }).git.everyMinutes, 15);

  const now = 10_000_000;
  const on = { keepRemotesCurrent: true, everyMinutes: 15 };
  assert.equal(keeperDue(OFF, null, null, now), false);
  assert.equal(keeperDue(on, null, null, now), true);
  assert.equal(keeperDue(on, now - 14 * 60_000, null, now), false);
  assert.equal(keeperDue(on, now - 15 * 60_000, null, now), true);
  assert.equal(keeperDue(on, null, now - 60_000, now), false, 'a failed try waits the interval too');

  const { mine } = repos();
  process.env.CODETRELLIS_GH = path.join(os.tmpdir(), 'no-such-gh-binary');
  const fetched: string[] = [];
  const deps = (git: typeof OFF) => ({ settings: () => git, activeRoot: () => mine, onFetched: (r: string) => { fetched.push(r); } });
  assert.equal(keeperTick(deps(OFF)), null);
  const run = keeperTick(deps(on));
  assert.ok(run);
  await run;
  assert.deepEqual(fetched, [mine]);
  assert.equal(keeperTick(deps(on)), null, 'not due again yet');
  assert.equal(keeperTick({ ...deps(on), activeRoot: () => null }), null);
});
