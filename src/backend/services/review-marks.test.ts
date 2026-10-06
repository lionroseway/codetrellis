/**
 * Phase 33 V3 — a reviewer's last look is kept per line of work, and the next
 * review says only what moved since: the files, the findings the pushes
 * addressed, and the new ones.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-review-marks-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const repo = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'repo-')));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8', env: ENV }).trim();

let marks: typeof import('./review-marks');
let first = '';
let second = '';

before(async () => {
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'one');
  first = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(repo, 'c.ts'), 'export const c = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'two');
  second = git('rev-parse', 'HEAD');
  await (await import('./database')).initDatabase();
  marks = await import('./review-marks');
});

describe('review marks', () => {
  test('a mark is kept per reviewer and line of work, and the latest replaces the last', () => {
    assert.equal(marks.lastMark(repo, 'payments', 'sam'), null);
    marks.markReviewed(repo, { target: 'payments', reviewer: 'sam', reviewerType: 'human', base: 'main', commit: first, findings: ['x'] }, 1);
    marks.markReviewed(repo, { target: 'payments', reviewer: 'claude-code', reviewerType: 'mcp', base: 'main', commit: first, findings: [] }, 2);
    marks.markReviewed(repo, { target: 'payments', reviewer: 'sam', reviewerType: 'human', base: 'main', commit: second, findings: ['y'] }, 3);
    assert.deepEqual(marks.lastMark(repo, 'payments', 'sam'), { target: 'payments', reviewer: 'sam', reviewerType: 'human', base: 'main', commit: second, findings: ['y'], at: 3 });
    assert.equal(marks.lastMark(repo, 'payments', 'claude-code')?.commit, first);
    assert.equal(marks.lastMark(repo, 'other', 'sam'), null);
  });

  test('since a look: the files that moved, the findings addressed and the new ones', () => {
    const mark = { target: 'payments', reviewer: 'sam', reviewerType: 'human', base: 'main', commit: first, findings: ['✗ breach', 'Adds stripe'], at: 1 };
    const s = marks.sinceLastLook(repo, mark, second, ['Adds stripe', 'Adds an HTTP call']);
    assert.deepEqual(s.changed, ['a.ts', 'c.ts']);
    assert.deepEqual(s.addressed, ['✗ breach']);
    assert.deepEqual(s.added, ['Adds an HTTP call']);
    assert.equal(s.words, `Since you looked at ${first.slice(0, 7)}: 2 files changed, 1 finding addressed, 1 new.`);
  });

  test('nothing moved: said so, and nothing is addressed', () => {
    const mark = { target: 'payments', reviewer: 'sam', reviewerType: 'human', base: 'main', commit: second, findings: ['Adds stripe'], at: 1 };
    const s = marks.sinceLastLook(repo, mark, second, ['Adds stripe']);
    assert.deepEqual([s.changed, s.addressed, s.added, s.gone], [[], [], [], false]);
    assert.equal(s.words, `Nothing changed since you looked at ${second.slice(0, 7)}.`);
  });

  test('a commit git no longer has (a force-push) says to review it whole, not that nothing changed', () => {
    const mark = { target: 'payments', reviewer: 'sam', reviewerType: 'human', base: 'main', commit: 'f'.repeat(40), findings: [], at: 1 };
    const s = marks.sinceLastLook(repo, mark, second, []);
    assert.equal(s.gone, true);
    assert.match(s.words, /^The commit you looked at, fffffff, is no longer in the history/);
  });
});
