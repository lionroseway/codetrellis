/**
 * `?limit=100` returned twenty frames.
 *
 * `buildPlaybackSequence` clamps its limit to 2..100 and asks git for
 * that many commit timestamps, but its only source of commit SPECS was
 * `listComparands`, which ran `git log -20` unconditionally. So playback
 * over a long history was capped at twenty points whatever was asked
 * for, and the "showing N of M" note counted M out of the same capped
 * list — the ceiling could not even be seen from the response.
 *
 * Exercised against a real repository because the defect was in the
 * argument passed to git, which a mocked git cannot show.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-comparands-db-'));
process.env.CODETRELLIS_DATA_DIR = dataDir;

let repo: string;
let listComparands: typeof import('./snapshot-compare-service').listComparands;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

before(async () => {
  const { initDatabase } = await import('./database');
  await initDatabase();
  ({ listComparands } = await import('./snapshot-compare-service'));

  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-comparands-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  for (let i = 1; i <= 35; i++) {
    fs.writeFileSync(path.join(repo, 'a.txt'), `rev ${i}\n`);
    git('add', 'a.txt');
    git('commit', '-q', '-m', `commit ${i}`);
  }
});

after(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const commits = (limit?: number) =>
  listComparands(repo, limit as number).filter((c) => c.kind === 'commit');

describe('listComparands honours the commit limit (m1)', () => {
  test('the default is still the picker’s twenty', () => {
    assert.equal(commits().length, 20);
  });

  test('a larger limit returns more commits', () => {
    // This was the whole defect: 35 commits in the repository, 100
    // requested, 20 returned, and nothing anywhere said so.
    assert.equal(commits(30).length, 30);
    assert.equal(commits(100).length, 35);
  });

  test('a smaller limit returns fewer', () => {
    assert.equal(commits(5).length, 5);
  });

  test('a nonsense limit falls back rather than passing garbage to git', () => {
    // The value reaches `git log -<n>` as an argument, so it is clamped
    // to something git will accept rather than trusted.
    assert.equal(commits(0).length, 20);
    assert.equal(commits(-5).length, 1);
    assert.equal(commits(NaN).length, 20);
  });

  test('live is always offered, whatever the limit', () => {
    assert.ok(listComparands(repo, 2).some((c) => c.kind === 'live'));
  });
});
