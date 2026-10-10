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
  parseNumstatZ,
  combineChanges,
  computeChanges,
  countStatusEntries,
  getChanges,
  syncWorkstreamWatchers,
  setWorkstreamChangesListener,
  watchedWorkstreamFolders,
  stopWorkstreamWatchers,
  setExternallyWatchedFolder,
  nudgeWorkstream,
  setWorkstreamWatchStartedListener,
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
/**
 * Waited for, not slept on: on a loaded machine (the unit suite beside a
 * browser run) the watcher's start and the git read after an edit took
 * longer than a fixed 300-600 ms, and a test failed now and then. What must
 * happen is polled for, up to 15 s; what must not is still given a fixed time.
 */
const until = async (ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) return false;
    await settle(50);
  }
  return true;
};
/** Resolves once `folder`'s watcher is listening; set it before the sync that starts it. */
const listening = (folder: string) => new Promise<void>((resolve) => setWorkstreamWatchStartedListener((f) => { if (f === folder) resolve(); }));

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ws-watch-')));
  main = path.join(tmp, 'app');
  tree = path.join(tmp, 'app-auth');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, 'src/session.ts', 'export const a = 1;\n');
  write(main, 'src/billing.ts', 'export const b = 1;\n');
  write(main, 'README.md', '# app\n');
  // As a real repository does: what the watcher skips, git ignores too.
  write(main, '.gitignore', 'dist/\nnode_modules/\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'worktree', 'add', '-q', tree, '-b', 'auth-refresh');
});

afterEach(async () => {
  await stopWorkstreamWatchers();
  setWorkstreamChangesListener(() => {});
  setWorkstreamWatchStartedListener(() => {});
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

describe('line counts (B3.3)', () => {
  test('numstat -z: counts per file, a rename by its new path, binary left out', () => {
    const out = '3\t1\tsrc/a.ts\0' + '-\t-\timg.png\0' + '2\t0\t\0old/b.ts\0new/b.ts\0' + '0\t4\tsrc/c d.ts\0';
    assert.deepEqual([...parseNumstatZ(out)], [
      ['src/a.ts', { added: 3, removed: 1 }], ['new/b.ts', { added: 2, removed: 0 }], ['src/c d.ts', { added: 0, removed: 4 }],
    ]);
  });
});

describe('computeChanges', () => {
  test('a clean checkout has changed nothing', async () => {
    const c = await computeChanges(main, 'main');
    assert.deepEqual(c.files, []);
    assert.match(c.base ?? '', /^[0-9a-f]{40}$/);
  });

  test("a worktree's commits, edits, deletions and new files — but not ignored ones", async () => {
    write(tree, 'src/session.ts', 'export const a = 2;\n');
    git(tree, 'commit', '-q', '-am', 'refresh tokens');
    write(tree, 'src/billing.ts', 'export const b = 2;\n'); // uncommitted edit
    fs.rmSync(path.join(tree, 'README.md'));                // uncommitted delete
    write(tree, 'src/refresh.ts');                           // untracked
    write(tree, 'dist/bundle.js');                           // ignored
    const c = await computeChanges(tree, 'main');
    assert.deepEqual(summary(c.files), [
      'deleted README.md', 'modified src/billing.ts', 'added src/refresh.ts', 'modified src/session.ts',
    ]);
    // Each tracked file carries its line counts (B3.3); a file git does not track yet does not.
    const counts = Object.fromEntries(c.files.map((f) => [f.path, f.added === undefined ? null : [f.added, f.removed]]));
    assert.deepEqual(counts['src/session.ts'], [1, 1]);
    assert.deepEqual(counts['src/billing.ts'], [1, 1]);
    assert.equal(counts['src/refresh.ts'], null);
  });

  test('work landing on main after the worktree branched is not the worktree\'s change', async () => {
    write(main, 'src/main-only.ts');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'on main');
    const c = await computeChanges(tree, 'main');
    assert.ok(!c.files.some((f) => f.path === 'src/main-only.ts'), 'measured from the merge base, not from main\'s tip');
    // And on the main checkout, a commit is not a change: only uncommitted work is.
    assert.deepEqual((await computeChanges(main, 'main')).files, []);
  });

  test('how far from main: commits ahead and behind, and files not committed (C5.3b)', async () => {
    // The worktree has one commit of its own; main has one it lacks; three files wait uncommitted.
    const c = await computeChanges(tree, 'main');
    assert.equal(c.ahead, 1);
    assert.equal(c.behind, 1);
    assert.equal(c.uncommitted, 3);
    const m = await computeChanges(main, 'main');
    assert.deepEqual([m.ahead, m.behind, m.uncommitted], [0, 0, 0]);
    // Unknown is left out, never zero.
    const none = await computeChanges(path.join(tmp, 'nope'), 'main');
    assert.deepEqual([none.ahead, none.behind, none.uncommitted], [undefined, undefined, undefined]);
  });

  test('a rename is one uncommitted file, not two', async () => {
    assert.equal(countStatusEntries('R  new.ts\0old.ts\0 M a.ts\0?? b.ts\0'), 3);
    assert.equal(countStatusEntries(''), 0);
  });

  test('an unsafe ref is never passed to git; it falls back to HEAD', async () => {
    const c = await computeChanges(main, '--output=/tmp/pwned');
    assert.deepEqual(c.files, []);
    assert.ok(!fs.existsSync('/tmp/pwned'));
  });

  test('a folder git cannot read has no changes, and nothing throws', async () => {
    const c = await computeChanges(path.join(tmp, 'nope'), 'main');
    assert.deepEqual(c, { base: null, files: [], truncated: false });
  });
});

describe('watching', () => {
  test('a watched folder reports a new change after the debounce', async () => {
    const heard: Array<{ folder: string; files: string[] }> = [];
    setWorkstreamChangesListener((folder, c) => heard.push({ folder, files: c.files.map((f) => f.path) }));
    const ready = listening(tree);
    await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
    assert.deepEqual(watchedWorkstreamFolders(), [tree]);
    await ready; // the watcher has finished its initial scan

    write(tree, 'src/new-feature.ts');
    assert.ok(await until(() => heard.some((h) => h.files.includes('src/new-feature.ts'))), 'the listener was told');
    assert.equal(heard.at(-1)!.folder, tree);
    assert.ok(heard.at(-1)!.files.includes('src/new-feature.ts'));
    // And the answer is served from the watcher without asking git again.
    assert.ok((await getChanges(tree, 'main')).files.some((f) => f.path === 'src/new-feature.ts'));
  });

  test('editing a file that is already changed tells the listener again, though the list is the same (bug 54)', async () => {
    const heard: string[][] = [];
    setWorkstreamChangesListener((_f, c) => heard.push(c.files.map((f) => f.path)));
    const ready = listening(tree);
    await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
    await ready;
    write(tree, 'src/already.ts');
    assert.ok(await until(() => heard.some((h) => h.includes('src/already.ts'))));
    await settle(); // its debounce over: an edit now is a second change, not part of the first
    const before = heard.length;
    // Same file, edited again: the list of changed files does not move, but
    // its symbols and signature can, and signals follow them.
    fs.writeFileSync(path.join(tree, 'src/already.ts'), 'export function f(a: number, b: number) { return a + b; }\n');
    assert.ok(await until(() => heard.length > before), 'told again');
    assert.deepEqual(heard.at(-1), heard[before - 1]);
    fs.rmSync(path.join(tree, 'src/already.ts'));
  });

  test('a change made while the watcher is still starting is not lost', async () => {
    const f = path.join(tree, 'src/during-startup.ts');
    // Waited for, not slept on: on a loaded machine the watcher's ready, and
    // the git read it schedules, took longer than a fixed 600 ms (#370).
    const started = new Promise<void>((resolve) => setWorkstreamWatchStartedListener((folder) => { if (folder === tree) resolve(); }));
    try {
      await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
      write(tree, 'src/during-startup.ts'); // before chokidar is ready: no event for it
      await started;
      const deadline = Date.now() + 15_000;
      let seen = false;
      while (!seen && Date.now() < deadline) {
        seen = (await getChanges(tree, 'main')).files.some((x) => x.path === 'src/during-startup.ts');
        if (!seen) await settle(100);
      }
      assert.ok(seen, 'the change made during startup is in the answer once the watcher is listening');
    } finally {
      setWorkstreamWatchStartedListener(() => {});
      fs.rmSync(f);
    }
  });

  test('a folder newly watched is announced once its watcher is listening, with nothing having changed', async () => {
    const started: string[] = [];
    setWorkstreamWatchStartedListener((folder) => started.push(folder));
    try {
      // An edit made before the listing asked git is in the first answer, so
      // no change is ever reported for it: the start is what says to look.
      write(tree, 'src/before-watching.ts');
      await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
      assert.ok(await until(() => started.length > 0));
      assert.deepEqual(started, [tree]);
      await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
      await settle(300);
      assert.deepEqual(started, [tree], 'a folder already watched is not announced again');
    } finally {
      setWorkstreamWatchStartedListener(() => {});
      fs.rmSync(path.join(tree, 'src/before-watching.ts'));
    }
  });

  test('changes inside ignored folders do not wake it', async () => {
    let calls = 0;
    setWorkstreamChangesListener(() => { calls++; });
    const ready = listening(tree);
    await syncWorkstreamWatchers([{ folder: tree, mainRef: 'main' }]);
    await ready;
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
    assert.ok(await until(() => heard.at(-1)?.includes('NOTES.md') === true), 'the nudge recomputes it');
    fs.rmSync(path.join(main, 'NOTES.md'));
  });
});
