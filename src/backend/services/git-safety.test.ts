/**
 * Unit tests for the git argument validators (Phase 19, finding 10).
 *
 * These run under `npm run test:unit` — no backend, no harness — so they are
 * fast enough to be a genuine gate and specific enough to say exactly which
 * input class regressed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeGitRef, assertSafeGitRef, assertSafeGitPathArg } from './git-safety';

describe('isSafeGitRef', () => {
  test('accepts the refs this codebase actually produces', () => {
    const good = [
      'a1b2c3d',                                   // abbreviated sha
      '0123456789abcdef0123456789abcdef01234567',  // full sha
      'main',
      'dev/saif',
      'release/build6',
      'origin/main',
      'HEAD',
      'HEAD~1',
      'HEAD^',
      'v0.1.13',
      'feature_branch-2',
    ];
    for (const ref of good) {
      assert.equal(isSafeGitRef(ref), true, `should accept ${ref}`);
    }
  });

  test('rejects option injection — the finding this exists for', () => {
    // git reads ANY argument starting with `-` as a flag. execFileSync
    // removes the shell but does nothing about this, which is why the
    // validator is needed as well as argv execution.
    const optionLike = [
      '--output=/Users/victim/.ssh/authorized_keys',
      '--upload-pack=touch /tmp/pwned',
      '-o/tmp/x',
      '--help',
      '--version',
      '-',
    ];
    for (const ref of optionLike) {
      assert.equal(isSafeGitRef(ref), false, `should reject ${ref}`);
    }
  });

  test('rejects shell metacharacters even though we no longer use a shell', () => {
    // Defence in depth: if a future caller reintroduces a shell, these
    // values must already be unable to reach it.
    const nasty = [
      'main; rm -rf /',
      'main && whoami',
      'main | cat',
      'main$(whoami)',
      'main`whoami`',
      'main\nrm -rf /',
      'main with spaces',
      "main'quote",
      'main"quote',
      'main>redirect',
    ];
    for (const ref of nasty) {
      assert.equal(isSafeGitRef(ref), false, `should reject ${JSON.stringify(ref)}`);
    }
  });

  test('rejects ranges, path separators and traversal', () => {
    const rejected = [
      'a..b',        // range — widens what a command touches
      'a...b',
      '../etc/passwd',
      '.hidden',     // leading dot
      'main:file',   // colon separates ref from path; callers apply it, not input
      '',
    ];
    for (const ref of rejected) {
      assert.equal(isSafeGitRef(ref), false, `should reject ${JSON.stringify(ref)}`);
    }
  });

  test('rejects non-strings and absurd lengths', () => {
    assert.equal(isSafeGitRef(undefined), false);
    assert.equal(isSafeGitRef(null), false);
    assert.equal(isSafeGitRef(42), false);
    assert.equal(isSafeGitRef({}), false);
    assert.equal(isSafeGitRef('a'.repeat(300)), false);
  });
});

describe('assertSafeGitRef', () => {
  test('returns the value when valid', () => {
    assert.equal(assertSafeGitRef('main', 'test'), 'main');
  });

  test('throws with the caller label, so the error says which entry point rejected it', () => {
    assert.throws(
      () => assertSafeGitRef('--output=/tmp/x', 'getPlanAtCommit(commitHash)'),
      /getPlanAtCommit\(commitHash\)/,
    );
  });
});

describe('assertSafeGitPathArg', () => {
  test('accepts ordinary paths, including ones git would need -- for', () => {
    assert.equal(assertSafeGitPathArg('src/index.ts', 'test'), 'src/index.ts');
    assert.equal(assertSafeGitPathArg('a file with spaces.md', 'test'), 'a file with spaces.md');
  });

  test('rejects a leading dash, which would be parsed as an option', () => {
    assert.throws(() => assertSafeGitPathArg('--force', 'test'), /leading "-"/);
    assert.throws(() => assertSafeGitPathArg('-rf', 'test'), /leading "-"/);
  });

  test('rejects empty and non-strings', () => {
    assert.throws(() => assertSafeGitPathArg('', 'test'));
    assert.throws(() => assertSafeGitPathArg(undefined, 'test'));
  });
});
