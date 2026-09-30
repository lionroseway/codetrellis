/**
 * readBlobsAtCommit reads a commit's files in one git process, as they were
 * at that commit, and leaves out what the commit does not have. Real git,
 * throwaway repo.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { readBlobsAtCommit } from './git-blobs';

let tmp: string;
let first: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: tmp, encoding: 'utf8' }).trim();
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-blobs-')));
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.writeFileSync(path.join(tmp, 'src/a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(tmp, 'src/b c.ts'), 'export const café = "é";\n');
  fs.writeFileSync(path.join(tmp, 'empty.ts'), '');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  first = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(tmp, 'src/a.ts'), 'export const a = 2;\n');
  git('commit', '-q', '-am', 'second');
});

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

test('each file as it was at the commit, not as it is now', async () => {
  const files = await readBlobsAtCommit(tmp, first, ['src/a.ts', 'src/b c.ts', 'empty.ts']);
  assert.deepEqual([...files.keys()], ['src/a.ts', 'src/b c.ts', 'empty.ts']);
  assert.equal(files.get('src/a.ts'), 'export const a = 1;\n');
  assert.equal(files.get('src/b c.ts'), 'export const café = "é";\n');
  assert.equal(files.get('empty.ts'), '');
});

test('a path the commit does not have, or a directory, is left out and the rest still read', async () => {
  const files = await readBlobsAtCommit(tmp, first, ['nope.ts', 'src', 'src/a.ts', 'bad\nname.ts']);
  assert.deepEqual([...files.entries()], [['src/a.ts', 'export const a = 1;\n']]);
});

test('an option-shaped commit is refused before git sees it', async () => {
  await assert.rejects(readBlobsAtCommit(tmp, '--output=/tmp/x', ['src/a.ts']), /is not a commit/);
});
