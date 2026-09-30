/**
 * Phase 32 C2.1 — an item's state from git, on real repositories: building,
 * pushed, and merged each of three ways (a merge or fast-forward, a squash or
 * rebase, a gone branch a commit names), a branch that stopped staying
 * "pushed", and a fresh branch never mistaken for merged.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { branchGitState } from './item-git-state';
import { gitStateWords, shortDate } from '../../shared/lib/git-state-words';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-state-'));
const origin = path.join(tmp, 'origin.git');
const repo = path.join(tmp, 'repo');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { env: ENV, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), text); };
const commit = (file: string, text: string, msg: string) => { write(file, text); g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
const state = (branch: string, keys: string[] = []) => branchGitState(repo, branch, 'main', keys);

before(() => {
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  g('remote', 'add', 'origin', origin);
  commit('README.md', 'hello\n', 'start');
  g('push', '-q', '-u', 'origin', 'main');
});

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('an item\'s state from git', () => {
  test('no branch: none, in words that say so', () => {
    const s = state('nothing-yet');
    assert.deepEqual([s.state, s.source, s.commit], ['none', 'git', null]);
    assert.equal(gitStateWords(s), 'no nothing-yet branch yet');
  });

  test('a fresh branch with no commits of its own is building, never merged, even after main moves on', () => {
    g('branch', 'fresh');
    assert.equal(state('fresh').state, 'building');
    commit('other.md', 'x\n', 'main moves on');
    assert.equal(state('fresh').state, 'building');
  });

  test('building: its own commits, not pushed', () => {
    g('checkout', '-q', '-b', 'billing', 'main');
    const head = commit('billing.ts', 'export const a = 1;\n', 'billing work');
    g('checkout', '-q', 'main');
    const s = state('billing');
    assert.deepEqual([s.state, s.commit], ['building', head]);
    assert.equal(gitStateWords(s), 'building on billing, not pushed');
  });

  test('pushed: on the remote as last fetched; commits since say so', () => {
    g('push', '-q', 'origin', 'billing');
    const s = state('billing');
    assert.deepEqual([s.state, s.remote, s.unpushed], ['pushed', 'origin', undefined]);
    assert.equal(gitStateWords(s), 'pushed, not merged');
    g('checkout', '-q', 'billing');
    commit('billing.ts', 'export const a = 2;\n', 'more billing');
    g('checkout', '-q', 'main');
    assert.equal(gitStateWords(state('billing')), 'pushed, not merged; 1 commit not pushed yet');
  });

  test('a branch that stopped stays pushed, never merged, however far main moves', () => {
    g('checkout', '-q', '-b', 'abandoned', 'main');
    commit('abandoned.ts', 'x\n', 'an idea');
    g('push', '-q', 'origin', 'abandoned');
    g('checkout', '-q', 'main');
    for (let i = 0; i < 3; i++) commit('main.md', `${i}\n`, `main ${i}`);
    assert.equal(state('abandoned').state, 'pushed');
  });

  test('merged by a merge commit: the merge is the proof', () => {
    g('checkout', '-q', '-b', 'exports', 'main');
    commit('exports.ts', 'export const e = 1;\n', 'exports');
    g('checkout', '-q', 'main');
    g('merge', '-q', '--no-ff', '-m', 'Merge exports', 'exports');
    const merge = g('rev-parse', 'HEAD');
    const s = state('exports');
    assert.deepEqual([s.state, s.how, s.commit], ['merged', 'merge', merge]);
    assert.equal(gitStateWords(s), `merged into main (merge commit, ${shortDate(s.at!)})`);
  });

  test('merged by fast-forward', () => {
    g('checkout', '-q', '-b', 'ff', 'main');
    const head = commit('ff.ts', 'x\n', 'ff work');
    g('checkout', '-q', 'main');
    g('merge', '-q', '--ff-only', 'ff');
    assert.deepEqual([state('ff').state, state('ff').how, state('ff').commit], ['merged', 'fast-forward', head]);
  });

  test('merged by squash: no ancestry, the branch\'s changes are on main', () => {
    g('checkout', '-q', '-b', 'squashed', 'main');
    commit('sq/a.ts', 'a1\n', 'sq 1');
    commit('sq/b.ts', 'b1\n', 'sq 2');
    g('checkout', '-q', 'main');
    g('merge', '-q', '--squash', 'squashed');
    g('commit', '-q', '-m', 'Squashed work (#12)');
    const squash = g('rev-parse', 'HEAD');
    const s = state('squashed');
    assert.deepEqual([s.state, s.how, s.commit], ['merged', 'squash-or-rebase', squash]);
    assert.match(gitStateWords(s), /^merged into main \(squash or rebase, /);
  });

  test('merged by rebase: new commits on main with the branch\'s versions', () => {
    g('checkout', '-q', '-b', 'rebased', 'main');
    commit('rb.ts', 'r1\n', 'rb 1');
    g('checkout', '-q', 'main');
    commit('unrelated.md', 'u\n', 'main moves first');
    g('cherry-pick', 'rebased');
    assert.equal(state('rebased').how, 'squash-or-rebase');
  });

  test('a squash that changed the file differently is not merged', () => {
    g('checkout', '-q', '-b', 'partial', 'main');
    commit('partial.ts', 'mine\n', 'partial');
    g('checkout', '-q', 'main');
    commit('partial.ts', 'theirs\n', 'something else in the same file');
    assert.equal(state('partial').state, 'building');
  });

  test('gone after merging: a commit on main naming the item\'s key', () => {
    g('checkout', '-q', '-b', 'refunds', 'main');
    commit('refunds.ts', 'r\n', 'refunds');
    g('checkout', '-q', 'main');
    g('merge', '-q', '--squash', 'refunds');
    g('commit', '-q', '-m', 'Validate refunds (task 9f2c41ab)');
    const named = g('rev-parse', 'HEAD');
    g('branch', '-q', '-D', 'refunds');
    assert.equal(state('refunds').state, 'none');
    const s = state('refunds', ['9f2c41ab']);
    assert.deepEqual([s.state, s.how, s.commit], ['merged', 'names-key', named]);
    assert.match(gitStateWords(s), /a commit names it/);
    // Part of a longer word is not a match.
    assert.equal(state('refunds', ['9f2c41']).state, 'none');
  });

  test('a branch name git would refuse is never passed to it', () => {
    assert.equal(branchGitState(repo, '--output=/tmp/x', 'main', []).state, 'none');
    // An unusable base: the branch's own state, with no merge check against it.
    assert.equal(branchGitState(repo, 'billing', '--all', []).state, 'pushed');
  });
});
