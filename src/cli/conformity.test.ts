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

test('the gate in words: what was checked, the findings by kind, the exit code last (C8)', () => {
  const base = { files: 3, base: 'origin/main', breakpoints: [], tests: [], criteria: [], docs: [], rules: [], rulebook: [], notes: [] };
  assert.equal(
    gateWords({ ...base, ok: true, says: [] }),
    'Conforms: 3 changed files since origin/main. No breakpoint holds them, none of their tests fail or are older than the code, no done task fails its checks, no doc that describes them is stale, they add no import an architecture rule forbids, and they loosen no rule.\n\nNothing blocks this change (exit 0).',
  );
  assert.equal(
    gateWords({ ...base, files: 1, ok: false, says: ['src/a.ts: ✗ 1 of 2 tests failing'] }),
    'Does not conform (1 changed file since origin/main):\n\nalso\n  src/a.ts: ✗ 1 of 2 tests failing\n\n1 finding blocks this change (exit 3).',
  );
  // A7.3: a rule's finding, under its suite and rule, with where in the file when it can be read.
  const rule = { path: 'web/reports.ts', imports: 'db/client.ts', rule: 'web-not-db', words: 'web/ may not import db/', because: 'web talks to db through the API', strength: 'block', suite: 'architecture', fix: null };
  assert.equal(
    gateWords({ ...base, files: 1, ok: false, rules: [rule], says: ['✗ web/reports.ts now imports db/client.ts, which the rule “web/ may not import db/” forbids: web talks to db through the API'] }, {
      read: (rel) => (rel === 'web/reports.ts' ? "import { a } from './a';\nimport { query } from '../db/client';\n" : null),
    }),
    [
      'Does not conform (1 changed file since origin/main):', '',
      'architecture  ✗ 1 blocks', '',
      '  ✗ web-not-db   web/ may not import db/',
      "      web/reports.ts:2 imports db/client.ts   import { query } from '../db/client';",
      '      → web talks to db through the API', '',
      '1 finding blocks this change (exit 3).',
    ].join('\n'),
  );
  assert.match(gateWords({ ...base, ok: true, says: [], rulesNote: 'The architecture rules were not checked.' }), /\n\nThe architecture rules were not checked\.\n\nNothing blocks this change \(exit 0\)\.$/);
  // Phase 33 R2: a rule added or tightened is said, and does not fail the gate.
  assert.match(
    gateWords({ ...base, ok: true, says: [], notes: ['⚠ This change adds the rule “api/ may not import db/” (api-not-db). It is checked once it is on the base branch.'] }),
    /\n\nnotes\n {2}⚠ This change adds the rule “api\/ may not import db\/” \(api-not-db\)\. It is checked once it is on the base branch\.\n/,
  );
});

test('a change to the rules alone is still a change to check (Phase 33 R2)', () => {
  const { root, git, write } = repo();
  git('checkout', '-qb', 'sam/loosen');
  write('.codetrellis/rules/architecture.yaml', 'rules: []\n');
  const c = changedFiles(root, 'main', {});
  assert.deepEqual(c.files, [], 'still not a file of the work');
  assert.equal(c.rulebook, true);
  write('.codetrellis/plans/exports/plan.yaml', 'title: Exports\n');
  const { root: other, write: w2 } = repo();
  w2('.codetrellis/plans/exports/plan.yaml', 'title: Exports\n');
  assert.equal(changedFiles(other, undefined, {}).rulebook, false, 'a plan changing is not the rules changing');
});

test('a scoped check says what it checked, and answers only that (C1)', () => {
  const base = { files: 2, base: 'origin/main', breakpoints: [], tests: [], criteria: [], docs: [], rules: [], rulebook: [], notes: [], scope: 'suite payments' };
  assert.equal(gateWords({ ...base, ok: true, says: [] }), 'Conforms to suite payments: 2 changed files since origin/main. They add no import those rules forbid, and loosen none of them.\n\nNothing blocks this change (exit 0).');
  const rule = { path: 'web/a.ts', imports: 'npm:stripe', rule: 'stripe-via-wrapper', words: 'only src/payments/index.ts may import npm:stripe', because: '', strength: 'block', suite: 'payments', fix: 'use src/payments/index.ts instead' };
  assert.equal(
    gateWords({ ...base, ok: false, rules: [rule], says: ['✗ web/a.ts now imports npm:stripe, which the rule “only src/payments/index.ts may import npm:stripe” forbids'] }),
    'Does not conform to suite payments (2 changed files since origin/main):\n\npayments  ✗ 1 blocks\n\n  ✗ stripe-via-wrapper   only src/payments/index.ts may import npm:stripe\n      web/a.ts imports npm:stripe\n      → use src/payments/index.ts instead\n\n1 finding blocks this change (exit 3).',
  );
});
