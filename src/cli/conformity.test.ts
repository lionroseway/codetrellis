import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { baseRef, changedFiles, gateWords } from './conformity';

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 's@x', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 's@x' };

function repo(): { root: string; git: (...a: string[]) => string; write: (f: string, s: string) => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-conformity-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', env: GIT_ENV }).trim();
  const write = (f: string, s: string) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  git('init', '-q', '-b', 'main');
  write('src/a.ts', 'export const a = 1;\n');
  write('src/b.ts', 'export const b = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'start');
  return { root, git, write };
}

test('this work is the branch since its base, plus what is not committed, without CodeTrellis\'s own files', () => {
  const { root, git, write } = repo();
  git('checkout', '-qb', 'sam/work');
  write('src/a.ts', 'export const a = 2;\n');
  git('commit', '-qam', 'a');
  write('src/b.ts', 'export const b = 2;\n'); // changed, not committed
  write('src/c.ts', 'export const c = 1;\n'); // new, untracked
  write('.codetrellis/plans/exports/plan.yaml', 'title: Exports\n'); // the plan: not a change to conform
  const c = changedFiles(root, 'main', {});
  assert.equal(c.base, 'main');
  assert.equal(c.since, git('rev-parse', 'main'));
  assert.deepEqual(c.files, ['src/a.ts', 'src/b.ts', 'src/c.ts']);

  // With no base found, only what is not committed.
  assert.deepEqual(changedFiles(root, undefined, {}).files, ['src/b.ts', 'src/c.ts']);
  assert.throws(() => changedFiles(root, 'no-such-branch', {}), /no-such-branch is not a commit in this repository/);
});

test('the base: --base, else the pull request\'s base in GitHub Actions, else origin\'s default branch', () => {
  const { root, git } = repo();
  assert.equal(baseRef(root, undefined, {}), null);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(baseRef(root, undefined, {}), 'origin/main');
  git('update-ref', 'refs/remotes/origin/feat/phase-32', 'HEAD');
  assert.equal(baseRef(root, undefined, { GITHUB_BASE_REF: 'feat/phase-32' }), 'origin/feat/phase-32');
  // A base ref the clone does not have falls through, rather than failing the job.
  assert.equal(baseRef(root, undefined, { GITHUB_BASE_REF: 'gone' }), 'origin/main');
  assert.equal(baseRef(root, 'main', { GITHUB_BASE_REF: 'feat/phase-32' }), 'main');
});

test('the gate in words: what was checked, then one line per finding', () => {
  const base = { files: 3, base: 'origin/main', breakpoints: [], tests: [], criteria: [], docs: [] };
  assert.equal(
    gateWords({ ...base, ok: true, says: [] }),
    'Conforms: 3 changed files since origin/main. No breakpoint holds them, none of their tests fail or are older than the code, no done task fails its checks, and no doc that describes them is stale.',
  );
  assert.equal(
    gateWords({ ...base, files: 1, ok: false, says: ['src/a.ts: ✗ 1 of 2 tests failing'] }),
    'Does not conform (1 changed file since origin/main):\n  src/a.ts: ✗ 1 of 2 tests failing',
  );
});
