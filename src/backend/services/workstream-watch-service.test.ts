/**
 * A workstream's changed files, kept current (Phase 32 A1.4). Against a real
 * temporary repository with a linked worktree, because what counts as
 * "changed" is git's answer and a fake would only test the fake.
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

process.env.CODETRELLIS_WORKSTREAM_DEBOUNCE_MS = '100';

import {
  parseNameStatusZ,
  combineChanges,
  computeChanges,
  getChanges,
  syncWorkstreamWatchers,
  setWorkstreamChangesListener,
  watchedWorkstreamFolders,
  stopWorkstreamWatchers,
  setExternallyWatchedFolder,
  nudgeWorkstream,
} from './workstream-watch-service';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf-8' });

let tmp: string;
let main: string;
let tree: string;
const write = (dir: string, rel: string, body = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};
const summary = (files: { path: string; status: string; from?: string }[]) =>
  files.map((f) => (f.from ? `${f.status} ${f.from} -> ${f.path}` : `${f.status} ${f.path}`));
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ws-watch-')));
  main = path.join(tmp, 'app');
  tree = path.join(tmp, 'app-auth');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, 'src/session.ts', 'export const a = 1;\n');
  write(main, 'src/billing.ts', 'export const b = 1;\n');
  write(main, 'README.md', '# app\n');
  write(main, '.gitignore', 'dist/\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'worktree', 'add', '-q', tree, '-b', 'auth-refresh');
});

afterEach(async () => {
  await stopWorkstreamWatchers();
  setWorkstreamChangesListener(() => {});
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('parsing git output', () => {
  test('name-status -z, including renames and awkward names', () => {
    const out = ['M', 'src/a.ts', 'A', 'docs/with space.md', 'D', 'old.ts', 'R087', 'src/b.ts', 'src/c.ts', 'T', 'link', ''].join('\0');
    assert.deepEqual(summary(parseNameStatusZ(out)), [
      'modified src/a.ts', 'added docs/with space.md', 'deleted old.ts', 'renamed src/b.ts -> src/c.ts', 'modified link',
    ]);
  });

  test('untracked files are added; a path listed twice keeps its tracked status; capped and sorted', () => {
    const r = combineChanges([{ path: 'b.ts', status: 'modified' }], ['c.ts', 'b.ts', 'a.ts', ''], 2);
    assert.deepEqual(summary(r.files), ['added a.ts', 'modified b.ts']);
    assert.equal(r.truncated, true);
  });
});

describe('computeChanges', () => {
  test('a clean checkout has changed nothing', () => {
    const c = computeChanges(main, 'main');
    assert.deepEqual(c.files, []);
    assert.match(c.base ?? '', /^[0-9a-f]{40}$/);
  });

  test("a worktree's commits, edits, deletions and new files — but not ignored ones", () => {
    write(tree, 'src/session.ts', 'export const a = 2;\n');
    git(tree, 'commit', '-q', '-am', 'refresh tokens');
    write(tree, 'src/billing.ts', 'export const b = 2;\n'); // uncommitted edit
    fs.rmSync(path.join(tree, 'README.md'));                // uncommitted delete
    write(tree, 'src/refresh.ts');                           // untracked
    write(tree, 'dist/bundle.js');                           // ignored
    const c = computeChanges(tree, 'main');
    assert.deepEqual(summary(c.files), [
      'deleted README.md', 'modified src/billing.ts', 'added src/refresh.ts', 'modified src/session.ts',
    ]);
  });

  test('work landing on main after the worktree branched is not the worktree\'s change', () => {
    write(main, 'src/main-only.ts');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'on main');
    const c = computeChanges(tree, 'main');
    assert.ok(!c.files.some((f) => f.path === 'src/main-only.ts'), 'measured from the merge base, not from main\'s tip');
    // And on the main checkout, a commit is not a change: only uncommitted work is.
    assert.deepEqual(computeChanges(main, 'main').files, []);
  });

  test('an unsafe ref is never passed to git; it falls back to HEAD', () => {
    const c = computeChanges(main, '--output=/tmp/pwned');
    assert.deepEqual(c.files, []);
    assert.ok(!fs.existsSync('/tmp/pwned'));
  });

  test('a folder git cannot read has no changes, and nothing throws', () => {
    const c = computeChanges(path.join(tmp, 'nope'), 'main');
    assert.deepEqual(c, { base: null, files: [], truncated: false });
  });
});

describe('watching', () => {
  test('a watched folder reports a new change after the debounce', async () => {
    const heard: Array<{ folder: string; files: string[] }> = [];
    setWorkstreamChangesListener((folder, c) => heard.push({ folder, files: c.files.map((f) => f.path) }));
    await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
    assert.deepEqual(watchedWorkstreamFolders(), [tree]);
    await settle(300); // let the watcher finish its initial scan

    write(tree, 'src/new-feature.ts');
    await settle();
    assert.ok(heard.length >= 1, 'the listener was told');
    assert.equal(heard.at(-1)!.folder, tree);
    assert.ok(heard.at(-1)!.files.includes('src/new-feature.ts'));
    // And the answer is served from the watcher without asking git again.
    assert.ok(getChanges(tree, 'main').files.some((f) => f.path === 'src/new-feature.ts'));
  });

  test('changes inside ignored folders do not wake it', async () => {
    let calls = 0;
    setWorkstreamChangesListener(() => { calls++; });
    await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
    await settle(300);
    write(tree, 'node_modules/pkg/index.js');
    write(tree, 'dist/other.js');
    await settle();
    assert.equal(calls, 0);
  });

  test('a folder dropped from the list stops being watched; another repository\'s folders are left alone', async () => {
    await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }, { folder: main, mainRef: 'main' }]);
    assert.deepEqual(watchedWorkstreamFolders(), [main, tree].sort());
    await syncWorkstreamWatchers([{ folder: main, mainRef: 'main' }], [main, tree]);
    assert.deepEqual(watchedWorkstreamFolders(), [main]);
    // A sync scoped to some other repository does not touch these.
    await syncWorkstreamWatchers([], ['/elsewhere/repo']);
    assert.deepEqual(watchedWorkstreamFolders(), [main]);
  });

  test("the opened project gets no second watcher: the app's own file watcher nudges it", async () => {
    const heard: string[][] = [];
    setWorkstreamChangesListener((_f, c) => heard.push(c.files.map((f) => f.path)));
    setExternallyWatchedFolder(main);
    await syncWorkstreamWatchers([{ folder: main, mainRef: 'main' }, { folder: tree, mainRef: 'main' }]);
    assert.deepEqual(watchedWorkstreamFolders(), [tree], 'only the linked worktree gets a chokidar watcher');

    write(main, 'NOTES.md'); // not a parseable file, still a change git sees
    await settle(300);
    assert.equal(heard.length, 0, 'nothing watches the main checkout itself');
    nudgeWorkstream(main);
    await settle();
    assert.ok(heard.at(-1)?.includes('NOTES.md'), 'the nudge recomputes it');
    fs.rmSync(path.join(main, 'NOTES.md'));
  });
});
