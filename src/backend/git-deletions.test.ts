/**
 * Deleted code had nowhere to be shown.
 *
 * `computeGitLineAnnotations` returned one status per surviving line —
 * 'unchanged' | 'added' | 'modified' — and a removal is not a property of
 * a surviving line. The line is gone. So the old hunk loop, which walked
 * `+newStart,newLen`, iterated zero times for a pure deletion and simply
 * dropped it, and discarded the `-oldStart,oldLen` side entirely, which
 * is precisely where the information lives.
 *
 * What a reader saw: a refactor that cut forty lines and added two
 * rendered as two modified lines and no other trace. The product claims
 * to sit on top of git; git has shown deletions since 2005.
 *
 * These build real repositories, because the parsing is of git's actual
 * output and a fixture string would be testing my idea of that output.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-del-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let repo: string;
let compute: typeof import('./server').computeGitLineAnnotations;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Write, commit, rewrite — then ask what git says about the result. */
function scenario(name: string, before: string, after: string) {
  const file = path.join(repo, `${name}.txt`);
  fs.writeFileSync(file, before);
  git('add', '-A');
  git('commit', '-qm', name);
  fs.writeFileSync(file, after);
  const lineCount = after.split('\n').length;
  return compute(repo, file, lineCount)!;
}

before(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-del-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, '.keep'), '');
  git('add', '-A');
  git('commit', '-qm', 'base');
  ({ computeGitLineAnnotations: compute } = await import('./server'));
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('a deletion is recorded even though it has no line', () => {
  test('lines removed from the middle are reported above the survivor', () => {
    const r = scenario('middle', 'a\nb\nc\nd\ne\n', 'a\nb\ne\n');
    const total = Object.values(r.deletedBefore).reduce((x, y) => x + y, 0);
    assert.equal(total, 2, 'two lines went and the report must say two');
    assert.ok(
      Object.keys(r.deletedBefore).length > 0,
      'a pure deletion produced no marker at all — the old behaviour',
    );
  });

  test('a shrinking block reports the surplus, not silence', () => {
    // The user's case: cut a lot, add a little. The survivors are
    // 'modified'; without this the 38 lost lines are invisible.
    const before = ['keep', ...Array.from({ length: 40 }, (_, i) => `old${i}`), 'tail'].join('\n') + '\n';
    const after = ['keep', 'new0', 'new1', 'tail'].join('\n') + '\n';
    const r = scenario('shrink', before, after);
    const total = Object.values(r.deletedBefore).reduce((x, y) => x + y, 0);
    assert.equal(total, 38, `expected 38 surplus removals, got ${total}`);
    assert.ok(r.annotations.includes('modified'), 'survivors should still read as modified');
  });

  test('a pure addition reports no deletions', () => {
    const r = scenario('grow', 'a\nb\n', 'a\nnew\nb\n');
    assert.deepEqual(r.deletedBefore, {}, 'nothing was removed, so nothing should be claimed');
    assert.ok(r.annotations.includes('added'));
  });

  test('an untouched file reports neither', () => {
    const file = path.join(repo, 'stable.txt');
    fs.writeFileSync(file, 'a\nb\n');
    git('add', '-A');
    git('commit', '-qm', 'stable');
    const r = compute(repo, file, 2)!;
    assert.deepEqual(r.deletedBefore, {});
    assert.ok(r.annotations.every((a) => a === 'unchanged'));
  });

  test('an untracked file is all-added and claims no deletions', () => {
    const file = path.join(repo, 'brand-new.txt');
    fs.writeFileSync(file, 'x\ny\n');
    const r = compute(repo, file, 2)!;
    assert.deepEqual(r.annotations, ['added', 'added']);
    assert.deepEqual(r.deletedBefore, {});
  });

  test('anchors are real line numbers, never zero', () => {
    // A marker at line 0 renders above nothing and reads as a file-level
    // claim. `+0,0` is a legal hunk header for a deletion at the top.
    const r = scenario('top', 'gone1\ngone2\nkeep\n', 'keep\n');
    for (const k of Object.keys(r.deletedBefore)) {
      assert.ok(Number(k) >= 1, `anchor ${k} is not a line`);
    }
  });
});
