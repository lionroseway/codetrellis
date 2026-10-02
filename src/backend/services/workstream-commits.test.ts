/**
 * Reading a workstream's own commits (Phase 32 B2.2): the log format parsed
 * into commits, a merge told apart, and the agent named in the message.
 * Which commits each lane gets, from real git, is tests/e2e/lane-marks.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommits } from './workstream-commits';

const RS = '\x1e';
const US = '\x1f';
const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const record = (sha: string, parents: string, at: string, author: string, subject: string, body = '') =>
  [sha, parents, at, author, subject, body].join(US) + RS;

test('commits in order, a merge by its parents, and the agent from an `agent:` line', () => {
  const raw = [
    record(a, `${b} ${c}`, '2026-09-28T10:00:05Z', 'Sam', 'Merge auth-side'),
    `\n${record(b, c, '2026-09-28T10:00:00Z', 'Sam', 'Tighten email check', 'Why.\n\nagent: codex · model: x\n')}`,
  ].join('');
  assert.deepEqual(parseCommits(raw), [
    { sha: a, at: Date.parse('2026-09-28T10:00:05Z'), author: 'Sam', subject: 'Merge auth-side', merge: true, agent: null },
    { sha: b, at: Date.parse('2026-09-28T10:00:00Z'), author: 'Sam', subject: 'Tighten email check', merge: false, agent: 'codex' },
  ]);
});

test('anything that is not a commit record is left out', () => {
  assert.deepEqual(parseCommits(''), []);
  assert.deepEqual(parseCommits(`not a sha${US}x${US}y${RS}`), []);
});

test('kept by head (E1): asked again with the same head, git is not run again; a new head is read afresh', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { commitsByWorkstream, forgetKeptCommits } = await import('./workstream-commits');
  forgetKeptCommits();
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wc-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
  git('add', '-A'); git('commit', '-qm', 'One');
  const ws = (head: string) => [{ root: dir, branch: 'main', head, main: true, shape: 'worktree', idle: false, agents: [], changes: { base: null, files: [], truncated: false } }] as never;
  const since = Date.now() - 60_000;
  const head1 = git('rev-parse', 'HEAD');
  assert.deepEqual(commitsByWorkstream(ws(head1), since)[dir].map((c) => c.subject), ['One']);

  // With git gone, the same head still answers: it was kept.
  fs.renameSync(path.join(dir, '.git'), path.join(dir, '.git-away'));
  assert.deepEqual(commitsByWorkstream(ws(head1), since + 1)[dir].map((c) => c.subject), ['One']);
  fs.renameSync(path.join(dir, '.git-away'), path.join(dir, '.git'));

  // A commit lands: a new head is read afresh.
  fs.writeFileSync(path.join(dir, 'a.txt'), '2\n');
  git('commit', '-qam', 'Two');
  assert.deepEqual(commitsByWorkstream(ws(git('rev-parse', 'HEAD')), since)[dir].map((c) => c.subject), ['Two', 'One']);
  forgetKeptCommits();
});
