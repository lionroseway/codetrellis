/**
 * Line changes per workstream (Phase 32 B3.1): hunk parsing and function
 * placement as pure functions, then a real repository with a linked
 * worktree, the app's real parser, and a branch with no folder.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initParser, parseVirtualFile } from './ast-parser';
import { computeChanges } from './workstream-watch-service';
import {
  parseHunkHeaders, isBinaryDiff, symbolRanges, functionsIn, toHunks, countLines, cleanRelPath,
  lineChangesOf, lineChangesFor, MAX_FILE_BYTES,
} from './line-changes';
import type { SymbolParser } from './workstream-symbols';
import type { ParsedSymbol, Workstream } from '../../shared/types';
import { hunkSentence, lineCounts, functionList } from '../../shared/lib/line-changes';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf-8' });
const parse: SymbolParser = (p, c) => parseVirtualFile(p, c)?.symbols ?? null;

const sym = (name: string, startLine: number, endLine: number, children: ParsedSymbol[] = []) =>
  ({ name, kind: 'function', startLine, endLine, children, modifiers: [] }) as unknown as ParsedSymbol;

describe('hunks from a diff', () => {
  test('headers with and without counts', () => {
    const diff = 'diff --git a/x b/x\n@@ -3 +3 @@ ctx\n-a\n+b\n@@ -10,0 +11,2 @@\n+c\n+d\n@@ -20,3 +22,0 @@\n-e\n';
    assert.deepEqual(parseHunkHeaders(diff), [
      { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 },
      { oldStart: 10, oldLines: 0, newStart: 11, newLines: 2 },
      { oldStart: 20, oldLines: 3, newStart: 22, newLines: 0 },
    ]);
  });

  test('binary is told apart', () => {
    assert.equal(isBinaryDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n'), true);
    assert.equal(isBinaryDiff('@@ -1 +1 @@\n-Binary files are fine to mention\n'), false);
  });

  test('added, changed, removed; committed unless the working copy touches it', () => {
    const whole = [
      { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 },
      { oldStart: 10, oldLines: 0, newStart: 11, newLines: 2 },
      { oldStart: 20, oldLines: 3, newStart: 22, newLines: 0 },
    ];
    const uncommitted = [{ oldStart: 11, oldLines: 0, newStart: 12, newLines: 1 }];
    const hunks = toHunks(whole, uncommitted, (s, e) => [`new ${s}-${e}`], (s, e) => [`old ${s}-${e}`]);
    assert.deepEqual(hunks.map((h) => [h.kind, h.committed, h.functions[0]]), [
      ['changed', true, 'new 3-3'], ['added', false, 'new 11-12'], ['removed', true, 'old 20-22'],
    ]);
    assert.deepEqual(countLines(hunks), { added: 3, removed: 4 });
    assert.equal(toHunks(whole, 'all', () => [], () => []).every((h) => !h.committed), true);
    assert.equal(toHunks(whole, 'none', () => [], () => []).every((h) => h.committed), true);
  });
});

describe('where lines fall', () => {
  const ranges = symbolRanges([
    sym('top', 1, 3),
    sym('Cart', 5, 20, [sym('add', 6, 9), sym('remove', 11, 14)]),
    sym('(Ledger).Post', 22, 25),
  ]);

  test('members are qualified with their parent, as the footprints name them', () => {
    assert.deepEqual(ranges.map((r) => r.name), ['top', 'Cart', 'Cart.add', 'Cart.remove', '(Ledger).Post']);
  });

  test('a change inside a method names the method, not also its class', () => {
    assert.deepEqual(functionsIn(ranges, 7, 8), ['Cart.add']);
    assert.deepEqual(functionsIn(ranges, 8, 12), ['Cart.add', 'Cart.remove']);
    assert.deepEqual(functionsIn(ranges, 16, 17), ['Cart']);
    assert.deepEqual(functionsIn(ranges, 4, 4), []);
    assert.deepEqual(functionsIn(ranges, 2, 23), ['top', 'Cart.add', 'Cart.remove', '(Ledger).Post']);
  });
});

describe('paths and words', () => {
  test('only a path inside the repository', () => {
    assert.equal(cleanRelPath('./src/a.ts'), 'src/a.ts');
    assert.equal(cleanRelPath('src\\a.ts'), 'src/a.ts');
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', '-p', 'C:/x', 'a//b', '', 42, 'a\0b']) {
      assert.equal(cleanRelPath(bad), null, String(bad));
    }
  });

  test('a hunk as a person reads it', () => {
    const h = (kind: 'added' | 'changed' | 'removed', o: [number, number], n: [number, number], functions: string[], committed: boolean) =>
      ({ kind, old: { start: o[0], lines: o[1] }, new: { start: n[0], lines: n[1] }, functions, committed });
    assert.equal(hunkSentence('billing-v2', h('changed', [40, 13], [40, 13], ['validateCreateOrder'], false)),
      'billing-v2 changed 40–52, in validateCreateOrder, not committed');
    assert.equal(hunkSentence('exports', h('added', [9, 0], [10, 1], [], true)), 'exports added line 10');
    assert.equal(hunkSentence('main', h('removed', [5, 3], [4, 0], ['a', 'b', 'c', 'd'], true)),
      'main removed 3 lines after line 4, in a, b and 2 more');
    assert.equal(hunkSentence('x', h('removed', [1, 1], [0, 0], [], true)), 'x removed 1 line at the top');
    assert.equal(functionList(['a', 'b']), 'a and b');
    assert.deepEqual(lineCounts(12, 3), { short: '＋12 −3', words: '12 lines added, 3 removed' });
    assert.deepEqual(lineCounts(1, 0), { short: '＋1', words: '1 line added' });
  });
});

describe('in a real repository', () => {
  let tmp: string;
  let main: string;
  let tree: string;
  const FILE = 'src/cart.ts';
  const BASE = [
    'export function keep() {', '  return 1;', '}', '',
    'export class Cart {', '  add(n: number) {', '    return n + 1;', '  }', '', '  remove(n: number) {', '    return n - 1;', '  }', '}', '',
    'export function gone() {', '  return 0;', '}', '',
  ].join('\n');

  const ws = async (root: string, branch: string, isMain = false): Promise<Workstream> => ({
    root, branch, head: git(root, 'rev-parse', 'HEAD').trim(), main: isMain, shape: 'worktree', agents: [], idle: false,
    changes: await computeChanges(root, isMain ? null : 'main'),
  } as Workstream);

  before(async () => {
    await initParser();
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-line-changes-')));
    main = path.join(tmp, 'main');
    tree = path.join(tmp, 'feature');
    fs.mkdirSync(path.join(main, 'src'), { recursive: true });
    git(tmp, 'init', '-q', '-b', 'main', main);
    fs.writeFileSync(path.join(main, FILE), BASE);
    git(main, 'add', '.');
    git(main, 'commit', '-q', '-m', 'base');
    git(main, 'worktree', 'add', '-q', tree, '-b', 'feature');
    // Committed on the branch: Cart.add changes.
    fs.writeFileSync(path.join(tree, FILE), BASE.replace('return n + 1;', 'return n + 2;'));
    git(tree, 'commit', '-q', '-am', 'add by two');
    // Not committed: gone() is removed and a line goes into Cart.remove.
    fs.writeFileSync(path.join(tree, FILE), BASE
      .replace('return n + 1;', 'return n + 2;')
      .replace('    return n - 1;', '    if (n < 1) return 0;\n    return n - 1;')
      .replace('export function gone() {\n  return 0;\n}\n', ''));
    fs.writeFileSync(path.join(tree, 'src/new.ts'), 'export const x = 1;\nexport const y = 2;\n');
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('each hunk: which lines, which function, committed or not', async () => {
    const r = lineChangesOf(await ws(tree, 'feature'), main, FILE, parse);
    assert.equal(r.status, 'changed');
    assert.deepEqual(r.hunks.map((h) => `${h.kind} ${h.new.start}+${h.new.lines} ${h.functions.join(',')} ${h.committed ? 'committed' : 'not committed'}`), [
      'changed 7+1 Cart.add committed',
      'added 11+1 Cart.remove not committed',
      'removed 15+0 gone not committed',
    ]);
    assert.deepEqual([r.added, r.removed], [2, 4]);
    assert.equal(r.diff, undefined);
  });

  test('the diff text only when asked', async () => {
    const r = lineChangesOf(await ws(tree, 'feature'), main, FILE, parse, { diff: true });
    assert.match(r.diff ?? '', /^-\s+return n \+ 1;$/m);
    assert.match(r.diff ?? '', /^\+\s+if \(n < 1\) return 0;$/m);
  });

  test('a file git does not track yet is all added and not committed', async () => {
    const r = lineChangesOf(await ws(tree, 'feature'), main, 'src/new.ts', parse);
    assert.deepEqual(r.hunks.map((h) => [h.kind, h.new.start, h.new.lines, h.committed]), [['added', 1, 2, false]]);
  });

  test('a workstream that leaves the file alone says so', async () => {
    const r = lineChangesOf(await ws(main, 'main', true), main, FILE, parse);
    assert.equal(r.status, 'unchanged');
    assert.deepEqual(r.hunks, []);
  });

  test('binary, too large, and a link out of the folder say so instead of lines', async () => {
    fs.writeFileSync(path.join(tree, 'img.bin'), Buffer.from([0x89, 0x50, 0, 0x01]));
    fs.writeFileSync(path.join(tree, 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 1));
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside\n');
    fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(tree, 'link.txt'));
    const w = await ws(tree, 'feature');
    assert.equal(lineChangesOf(w, main, 'img.bin', parse).status, 'binary');
    assert.equal(lineChangesOf(w, main, 'big.txt', parse).status, 'too-large');
    const link = lineChangesOf(w, main, 'link.txt', parse, { diff: true });
    assert.equal(link.status, 'unreadable');
    assert.equal(link.diff, undefined);
  });

  test('a branch with no folder is read at its head, all committed', async () => {
    git(tree, 'commit', '-q', '-am', 'the rest');
    const w = await ws(tree, 'feature');
    const branch = { ...w, root: 'branch:feature', shape: 'branch' } as Workstream;
    const r = lineChangesOf(branch, main, FILE, parse);
    assert.deepEqual(r.hunks.map((h) => [h.kind, h.functions.join(','), h.committed]), [
      ['changed', 'Cart.add', true], ['added', 'Cart.remove', true], ['removed', 'gone', true],
    ]);
  });

  test('by default every workstream changing the file; one named even when it does not', async () => {
    const all = [await ws(main, 'main', true), await ws(tree, 'feature')];
    assert.deepEqual(lineChangesFor(all, FILE, parse).map((r) => r.branch), ['feature']);
    assert.deepEqual(lineChangesFor(all, FILE, parse, { exclude: (w) => w.branch === 'feature' }), []);
    assert.deepEqual(lineChangesFor(all, FILE, parse, { workstream: 'main' }).map((r) => [r.branch, r.status]), [['main', 'unchanged']]);
    assert.deepEqual(lineChangesFor(all, FILE, parse, { workstream: 'nope' }), []);
  });
});
