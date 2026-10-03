/**
 * The checkout watchers' shared ignore rule (watch-ignore.ts).
 *
 * Two faults the 0.1.18 demo found, both silent:
 *  - a line of work's watcher followed links and did not skip ios/Pods, so a
 *    React Native checkout held a descriptor per file (20,000) until git
 *    could not start, and every line of work came back empty;
 *  - the project watcher tested the absolute path for dot segments, so a
 *    project inside any dot folder had its root ignored and was never watched.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchTree } from './tree-watcher';
import { isIgnoredByWatchers, checkoutWatchOptions } from './watch-ignore';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-watch-ignore-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('only the part under the checkout is tested: a checkout inside a dot folder is watched', () => {
  const root = '/home/sam/.config/app';
  assert.equal(isIgnoredByWatchers(root, root), false);
  assert.equal(isIgnoredByWatchers(`${root}/src/index.ts`, root), false);
  assert.equal(isIgnoredByWatchers(`${root}/.git/HEAD`, root), true);
  assert.equal(isIgnoredByWatchers(`${root}/.venv/lib/x.py`, root), true);
});

test('dependencies, build output and Xcode / CocoaPods trees are skipped at any depth', () => {
  const root = '/w/app';
  for (const rel of [
    'node_modules/react/index.js',
    'mobile/node_modules/react-native/Libraries/x.h',
    'mobile/ios/Pods/Headers/Public/React/RCTBridge.h',
    'ios/build/Release/app',
    'Carthage/Checkouts/x',
    'DerivedData/x',
    'server/target/debug/app',
    'logs/app.log',
  ]) assert.equal(isIgnoredByWatchers(path.join(root, rel), root), true, rel);
  for (const rel of ['mobile/ios/App/AppDelegate.swift', 'src/build-info.ts', 'README.md']) {
    assert.equal(isIgnoredByWatchers(path.join(root, rel), root), false, rel);
  }
});

test('a watcher over a checkout with Pods linking into node_modules holds no descriptor per file', { skip: process.platform === 'win32' }, async () => {
  const root = path.join(tmp, '.dotted', 'app');
  const deps = path.join(root, 'node_modules', 'dep');
  const pods = path.join(root, 'ios', 'Pods', 'Headers');
  fs.mkdirSync(deps, { recursive: true });
  fs.mkdirSync(pods, { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (let i = 0; i < 400; i++) {
    fs.writeFileSync(path.join(deps, `f${i}.h`), '');
    fs.symlinkSync(path.join(deps, `f${i}.h`), path.join(pods, `f${i}.h`));
  }
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export {}\n');

  const open = () => fs.readdirSync(process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd').length;
  const before = open();
  const watcher = watchTree(root, { ...checkoutWatchOptions(root), ignoreInitial: true, persistent: true });
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  try {
    assert.ok(open() - before < 50, `the watcher opened ${open() - before} descriptors over 800 skipped files`);

    // And the source under a dot-folder checkout is watched. Read from what
    // the watcher holds rather than waited for as an event: file events are
    // late or lost on a loaded macOS, and that read as a missing watch.
    const watched = watcher.getWatched();
    assert.deepEqual(watched[path.join(root, 'src')], ['index.ts']);
    assert.equal(watched[path.join(root, 'node_modules')], undefined);
    assert.equal(watched[path.join(root, 'ios', 'Pods')], undefined);
  } finally {
    await watcher.close();
  }
});
