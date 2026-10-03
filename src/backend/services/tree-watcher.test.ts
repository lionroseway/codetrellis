/**
 * The tree watcher (tree-watcher.ts): chokidar's events, from macOS's own
 * recursive watch there.
 *
 * The case that failed: new folders appearing in eight sibling folders at
 * once, as a pull brings channel events to eight plans. chokidar 5 on macOS
 * reported the first two folders and nothing for the other six.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchTree, type TreeEvent } from './tree-watcher';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tree-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `pred` holds, polling; false after `ms`. */
async function until(pred: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await settle(50); }
  return pred();
}

function tree(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

async function watching(root: string, opts: Parameters<typeof watchTree>[1] = {}) {
  const events: string[] = [];
  const w = watchTree(root, { ignoreInitial: true, ...opts });
  w.on('all', (e: TreeEvent, p: string) => events.push(`${e} ${path.relative(root, p)}`));
  await new Promise<void>((r) => w.once('ready', () => r()));
  await settle(300);
  return { w, events };
}

test('a burst of new folders in eight sibling folders: every folder and every file is reported', async () => {
  const root = tree('burst');
  for (let i = 0; i < 8; i++) { fs.mkdirSync(path.join(root, `p${i}`)); fs.writeFileSync(path.join(root, `p${i}`, 'plan.yaml'), 'x'); }
  const { w, events } = await watching(root, { awaitWriteFinish: { stabilityThreshold: 100 } });
  try {
    for (let i = 0; i < 8; i++) {
      const c = path.join(root, `p${i}`, 'channels');
      fs.mkdirSync(c);
      for (let n = 0; n < 3; n++) fs.writeFileSync(path.join(c, `e${n}.yaml`), 'y');
    }
    const want = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map((n) => `add ${path.join(`p${i}`, 'channels', `e${n}.yaml`)}`)).flat();
    await until(() => want.every((e) => events.includes(e)));
    assert.deepEqual(want.filter((e) => !events.includes(e)), [], 'files never reported');
    for (let i = 0; i < 8; i++) assert.ok(events.includes(`addDir ${path.join(`p${i}`, 'channels')}`), `p${i}/channels never reported`);
  } finally {
    await w.close();
  }
});

test('change and unlink, a folder removed with its files, and nothing reported twice', async () => {
  const root = tree('lifecycle');
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), '1');
  fs.writeFileSync(path.join(root, 'src', 'deep', 'b.ts'), '1');
  const { w, events } = await watching(root);
  try {
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), '22');
    assert.ok(await until(() => events.includes(`change ${path.join('src', 'a.ts')}`)), events.join('\n'));
    fs.rmSync(path.join(root, 'src', 'deep'), { recursive: true });
    assert.ok(await until(() => events.includes(`unlinkDir ${path.join('src', 'deep')}`)), events.join('\n'));
    assert.ok(events.includes(`unlink ${path.join('src', 'deep', 'b.ts')}`), events.join('\n'));
    await settle(300);
    assert.equal(events.filter((e) => e === `change ${path.join('src', 'a.ts')}`).length, 1);
  } finally {
    await w.close();
  }
});

test('an ignored subtree is never reported, and a depth limit holds', async () => {
  const root = tree('ignored');
  fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'a', 'b', 'c'), { recursive: true });
  const { w, events } = await watching(root, { ignored: (p) => p.includes(`${path.sep}node_modules`), depth: 1 });
  try {
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'x.js'), '1');
    // depth 1, as chokidar means it: the root and one level of folders.
    fs.writeFileSync(path.join(root, 'a', 'b', 'too-deep.ts'), '1');
    fs.writeFileSync(path.join(root, 'a', 'ok.ts'), '1');
    assert.ok(await until(() => events.includes(`add ${path.join('a', 'ok.ts')}`)), events.join('\n'));
    await settle(400);
    assert.deepEqual(events.filter((e) => e.includes('node_modules') || e.includes('too-deep')), []);
  } finally {
    await w.close();
  }
});

test('a tree of many files costs a handful of descriptors on macOS', { skip: process.platform !== 'darwin' }, async () => {
  const root = tree('many');
  for (let d = 0; d < 20; d++) {
    fs.mkdirSync(path.join(root, `d${d}`));
    for (let f = 0; f < 50; f++) fs.writeFileSync(path.join(root, `d${d}`, `f${f}.ts`), '');
  }
  const open = () => fs.readdirSync('/dev/fd').length;
  const before = open();
  const { w } = await watching(root);
  try {
    assert.ok(open() - before < 20, `watching 1,000 files opened ${open() - before} descriptors`);
    assert.equal(w.getWatched()[path.join(root, 'd3')]?.length, 50);
  } finally {
    await w.close();
  }
});
