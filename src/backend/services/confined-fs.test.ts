/**
 * Unit tests for the confined filesystem boundary (Phase 19, Gate 2 / A2).
 *
 * The symlink tests are the point of this file. A lexical containment check
 * — `path.resolve(root, input).startsWith(root)` — passes every one of them
 * while the read escapes, which is why finding A2 said it "undermines every
 * path check in the patch that relies on string comparison".
 *
 * Each test therefore states what a string-comparison implementation would
 * have done, so a future simplification that reintroduces one fails here
 * with an explanation rather than a bare assertion.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveWithin,
  readTextWithin,
  writeFileWithin,
  removeWithin,
  isWithin,
  isInside,
  openReadStreamWithin,
  ConfinementError,
} from './confined-fs';

let tmp: string;
let root: string;
let outside: string;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'confined-fs-'));
  root = path.join(tmp, 'root');
  outside = path.join(tmp, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'inside.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sub', 'nested.txt'), 'nested');
});

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('resolveWithin — ordinary containment', () => {
  test('accepts a file directly inside the root', () => {
    const p = resolveWithin(root, 'inside.txt');
    assert.equal(fs.readFileSync(p, 'utf-8'), 'inside');
  });

  test('accepts a nested file', () => {
    const p = resolveWithin(root, 'sub/nested.txt');
    assert.equal(fs.readFileSync(p, 'utf-8'), 'nested');
  });

  test('accepts a path that does not exist yet (creates are legitimate)', () => {
    const p = resolveWithin(root, 'sub/not-yet.txt');
    assert.ok(p.startsWith(fs.realpathSync.native(root)));
  });

  test('rejects ../ traversal', () => {
    assert.throws(() => resolveWithin(root, '../outside/secret.txt'), ConfinementError);
    assert.throws(() => resolveWithin(root, '../../etc/passwd'), ConfinementError);
  });

  test('rejects an absolute path outside the root', () => {
    assert.throws(() => resolveWithin(root, path.join(outside, 'secret.txt')), ConfinementError);
    assert.throws(() => resolveWithin(root, '/etc/passwd'), ConfinementError);
  });

  test('rejects a NUL byte, which truncates the path at the OS layer', () => {
    assert.throws(() => resolveWithin(root, 'inside.txt\0.png'), ConfinementError);
  });

  test('rejects empty and non-string input', () => {
    assert.throws(() => resolveWithin(root, ''), ConfinementError);
    // @ts-expect-error deliberately wrong type
    assert.throws(() => resolveWithin(root, undefined), ConfinementError);
  });
});

describe('resolveWithin — symlinks (finding A2)', () => {
  test('rejects a symlink that points outside', () => {
    const link = path.join(root, 'escape-link');
    try { fs.unlinkSync(link); } catch { /* */ }
    fs.symlinkSync(outside, link, 'dir');

    // A LEXICAL CHECK PASSES THIS. path.resolve(root, 'escape-link/secret.txt')
    // is a string under root, so `.startsWith(root)` is true — and the read
    // returns the contents of a file outside the root.
    const lexical = path.resolve(root, 'escape-link/secret.txt');
    assert.ok(
      lexical.startsWith(root),
      'precondition: the lexical path really does look contained',
    );
    assert.equal(
      fs.readFileSync(lexical, 'utf-8'),
      'SECRET',
      'precondition: following the link really does escape',
    );

    assert.throws(
      () => resolveWithin(root, 'escape-link/secret.txt'),
      ConfinementError,
      'canonicalising must catch what string comparison cannot',
    );
  });

  test('rejects a symlink to a single file outside', () => {
    const link = path.join(root, 'file-link.txt');
    try { fs.unlinkSync(link); } catch { /* */ }
    fs.symlinkSync(path.join(outside, 'secret.txt'), link, 'file');

    assert.throws(() => resolveWithin(root, 'file-link.txt'), ConfinementError);
    assert.throws(() => readTextWithin(root, 'file-link.txt'), ConfinementError);
  });

  test('rejects a symlink even when it points back INSIDE the root', () => {
    // Refused on principle: a link that resolves inside today can be
    // repointed between the check and the open. Removing links from the
    // boundary removes the race rather than narrowing it.
    const link = path.join(root, 'inward-link.txt');
    try { fs.unlinkSync(link); } catch { /* */ }
    fs.symlinkSync(path.join(root, 'inside.txt'), link, 'file');

    assert.throws(() => resolveWithin(root, 'inward-link.txt'), ConfinementError);
  });

  test('rejects a link in an INTERMEDIATE directory, not just the last component', () => {
    const dir = path.join(root, 'via');
    fs.mkdirSync(dir, { recursive: true });
    const link = path.join(dir, 'hop');
    try { fs.unlinkSync(link); } catch { /* */ }
    fs.symlinkSync(outside, link, 'dir');

    assert.throws(() => resolveWithin(root, 'via/hop/secret.txt'), ConfinementError);
  });
});

describe('readTextWithin', () => {
  test('reads a contained file', () => {
    assert.equal(readTextWithin(root, 'inside.txt'), 'inside');
  });

  test('refuses a directory', () => {
    assert.throws(() => readTextWithin(root, 'sub'), ConfinementError);
  });
});

describe('writeFileWithin', () => {
  test('writes atomically and leaves no temp file behind', () => {
    const written = writeFileWithin(root, 'written.txt', 'hello');
    assert.equal(fs.readFileSync(written, 'utf-8'), 'hello');
    const strays = fs.readdirSync(root).filter((f) => f.startsWith('.tmp-'));
    assert.deepEqual(strays, [], 'no temp files may survive a successful write');
  });

  test('creates intermediate directories inside the root', () => {
    const written = writeFileWithin(root, 'deep/deeper/file.txt', 'x');
    assert.equal(fs.readFileSync(written, 'utf-8'), 'x');
  });

  test('refuses to write outside the root', () => {
    assert.throws(() => writeFileWithin(root, '../outside/written.txt', 'x'), ConfinementError);
    assert.equal(
      fs.existsSync(path.join(outside, 'written.txt')),
      false,
      'a refused write must not have happened anyway — this is the "write precedes validation" bug',
    );
  });

  test('refuses to write THROUGH a symlink pointing outside', () => {
    const link = path.join(root, 'write-through.txt');
    try { fs.unlinkSync(link); } catch { /* */ }
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'ORIGINAL');
    fs.symlinkSync(victim, link, 'file');

    assert.throws(() => writeFileWithin(root, 'write-through.txt', 'OVERWRITTEN'), ConfinementError);
    assert.equal(
      fs.readFileSync(victim, 'utf-8'),
      'ORIGINAL',
      'the file outside the root must be untouched',
    );
  });
});

describe('removeWithin', () => {
  test('deletes a contained file', () => {
    const p = path.join(root, 'to-delete.txt');
    fs.writeFileSync(p, 'x');
    removeWithin(root, 'to-delete.txt');
    assert.equal(fs.existsSync(p), false);
  });

  test('refuses to delete outside the root', () => {
    const victim = path.join(outside, 'do-not-delete.txt');
    fs.writeFileSync(victim, 'x');
    assert.throws(() => removeWithin(root, '../outside/do-not-delete.txt', { recursive: true }), ConfinementError);
    assert.equal(fs.existsSync(victim), true);
  });

  test('refuses to delete the root itself', () => {
    assert.throws(() => removeWithin(root, '.', { recursive: true }), ConfinementError);
    assert.equal(fs.existsSync(root), true);
  });
});

describe('isWithin / isInside', () => {
  test('isWithin does not throw', () => {
    assert.equal(isWithin(root, 'inside.txt'), true);
    assert.equal(isWithin(root, '../outside/secret.txt'), false);
  });

  test('isInside treats the root as inside itself', () => {
    assert.equal(isInside('/a/b', '/a/b'), true);
    assert.equal(isInside('/a/b', '/a/b/c'), true);
    assert.equal(isInside('/a/b', '/a/bc'), false, 'a prefix match is not containment');
    assert.equal(isInside('/a/b', '/a'), false);
  });
});

describe('openReadStreamWithin — the check and the read are one open', () => {
  const drain = (stream: fs.ReadStream) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c) => chunks.push(c as Buffer));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    });

  test('streams a file inside the root, with its size', async () => {
    const { stream, size } = openReadStreamWithin(root, 'sub/nested.txt');
    assert.equal(size, 'nested'.length);
    assert.equal(await drain(stream), 'nested');
  });

  test('honours an inclusive byte range, as a video Range request needs', async () => {
    const { stream } = openReadStreamWithin(root, 'inside.txt', { start: 1, end: 3 });
    assert.equal(await drain(stream), 'nsi');
  });

  test('refuses a link to a file outside — string comparison would have served SECRET', () => {
    const link = path.join(root, 'stream-escape.txt');
    fs.symlinkSync(path.join(outside, 'secret.txt'), link, 'file');
    assert.throws(() => openReadStreamWithin(root, 'stream-escape.txt'), ConfinementError);
  });

  test('refuses a directory, which would otherwise error mid-response', () => {
    assert.throws(() => openReadStreamWithin(root, 'sub'), /not a regular file/);
  });

  test('refuses traversal', () => {
    assert.throws(() => openReadStreamWithin(root, '../outside/secret.txt'), ConfinementError);
  });
});
