/**
 * Unit tests for trusted project roots (Phase 19, Gate 2.2 and finding 22).
 *
 * TWO DIFFERENT QUESTIONS
 *
 *     confined-fs    is this path inside that root?
 *     trusted-roots  is that root one we actually opened?
 *
 * Several findings were only as bad as they were because the answer to the
 * second was "whatever the request said". An endpoint that accepts
 * `projectRoot` in its body and then carefully confines a path beneath it has
 * confined nothing — the caller chose the root, so everything is inside it.
 *
 * The two failure modes below are finding 22 exactly, and neither is caught by
 * `confined-fs`: it is not that module's job.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmp: string;
let roots: typeof import('./trusted-roots');

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-roots-'));
  process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
  fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
  roots = await import('./trusted-roots');
  roots.setActiveProjectRoot(null);
});

afterEach(() => {
  roots.setActiveProjectRoot(null);
  delete process.env.CODETRELLIS_DATA_DIR;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

describe('with no project open, everything is refused', () => {
  test('a caller-named root is not trusted just because it exists', () => {
    // FINDING 22, FIRST HALF. The old check was `if (root && …)` — with no
    // active project and no recent one it was SKIPPED, so a paired phone
    // could read any file on the machine. Absence of a root must mean deny.
    const anywhere = fs.mkdtempSync(path.join(tmp, 'anywhere-'));
    assert.equal(roots.listTrustedRoots().length, 0, 'precondition: nothing is open');
    assert.equal(roots.isTrustedProjectRoot(anywhere), false);
    assert.throws(() => roots.resolveTrustedProjectRoot(anywhere));
  });

  test('empty and non-string candidates are refused', () => {
    assert.throws(() => roots.resolveTrustedProjectRoot(''));
    assert.throws(() => roots.resolveTrustedProjectRoot('   '));
    assert.throws(() => roots.resolveTrustedProjectRoot(undefined));
    assert.throws(() => roots.resolveTrustedProjectRoot(null));
    assert.throws(() => roots.resolveTrustedProjectRoot(42));
  });
});

describe('with a project open', () => {
  test('the opened project is trusted and comes back canonical', () => {
    const project = fs.mkdtempSync(path.join(tmp, 'project-'));
    roots.setActiveProjectRoot(project);

    const resolved = roots.resolveTrustedProjectRoot(project);
    assert.equal(resolved, fs.realpathSync.native(project));
    assert.equal(roots.isTrustedProjectRoot(project), true);
  });

  test('A SIBLING SHARING A NAME PREFIX IS NOT TRUSTED', () => {
    // FINDING 22, SECOND HALF. `resolved.startsWith(root)` is a string prefix
    // test: "/work/project-evil" passes for root "/work/project". The
    // directory next door is not the project.
    const project = path.join(tmp, 'project');
    const sibling = path.join(tmp, 'project-evil');
    fs.mkdirSync(project);
    fs.mkdirSync(sibling);
    roots.setActiveProjectRoot(project);

    assert.ok(
      sibling.startsWith(project),
      'precondition: a prefix comparison really would accept the sibling',
    );
    assert.equal(roots.isTrustedProjectRoot(sibling), false);
  });

  test('a subdirectory of the project is not itself a root', () => {
    // Being INSIDE a trusted root is confined-fs's question. This one is
    // "which root", and the answer is the project, not a folder within it.
    const project = fs.mkdtempSync(path.join(tmp, 'project-'));
    const sub = path.join(project, 'src');
    fs.mkdirSync(sub);
    roots.setActiveProjectRoot(project);

    assert.equal(roots.isTrustedProjectRoot(sub), false);
  });

  test('a link pointing at the project resolves to the same root', () => {
    // Canonicalising both ends means an alias for an opened project is that
    // project — not a way to smuggle a different one past the comparison.
    const project = fs.mkdtempSync(path.join(tmp, 'project-'));
    const alias = path.join(tmp, 'alias');
    fs.symlinkSync(project, alias, 'dir');
    roots.setActiveProjectRoot(project);

    assert.equal(roots.resolveTrustedProjectRoot(alias), fs.realpathSync.native(project));
  });

  test('a link pointing ELSEWHERE is not the project', () => {
    const project = fs.mkdtempSync(path.join(tmp, 'project-'));
    const elsewhere = fs.mkdtempSync(path.join(tmp, 'elsewhere-'));
    const alias = path.join(tmp, 'looks-like-project');
    fs.symlinkSync(elsewhere, alias, 'dir');
    roots.setActiveProjectRoot(project);

    assert.equal(roots.isTrustedProjectRoot(alias), false);
  });

  test('closing the project withdraws the trust', () => {
    const project = fs.mkdtempSync(path.join(tmp, 'project-'));
    roots.setActiveProjectRoot(project);
    assert.equal(roots.isTrustedProjectRoot(project), true);

    roots.setActiveProjectRoot(null);
    assert.equal(roots.isTrustedProjectRoot(project), false, 'trust must not outlive the open project');
  });
});

describe('allowAbsent', () => {
  test('forgives a missing directory but NOT an unknown one', () => {
    // A project can be deleted or unmounted while its plans are still being
    // read. That relaxes existence, never membership.
    const gone = path.join(tmp, 'deleted-project');
    roots.setActiveProjectRoot(gone);
    assert.doesNotThrow(() => roots.resolveTrustedProjectRoot(gone, 'projectRoot', { allowAbsent: true }));

    const neverOpened = path.join(tmp, 'never-opened');
    assert.throws(() => roots.resolveTrustedProjectRoot(neverOpened, 'projectRoot', { allowAbsent: true }));
  });
});

describe('projectRelative — opened path vs canonical path (M33)', () => {
  test('a path stored under the symlinked root still relativises', () => {
    // The shape that broke it: rows are written by `scan`, which is exempt from
    // confinement and therefore stores whatever the user typed. Every confined
    // reader then resolves the root to its realpath. On macOS /tmp is a symlink,
    // so those two disagree for any project under /tmp — and path.relative
    // between them produced '../../…', which matched nothing. Diff, compare,
    // review and playback all reported every file removed AND re-added.
    const real = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-real-'));
    const link = path.join(fs.realpathSync(os.tmpdir()), `ct-link-${process.pid}`);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(real, link, 'dir');
    try {
      // The user opened the SYMLINKED path, so that is what scan stored and
      // what is registered as a trusted root. Readers resolve it to its
      // realpath. That disagreement is the bug.
      roots.setActiveProjectRoot(link);
      const storedUnderLink = path.join(link, 'src', 'a.ts');

      // Reader holds the canonical root; the row holds the opened one.
      assert.equal(roots.projectRelative(real, storedUnderLink), path.join('src', 'a.ts'));
      // And the reverse, which is the same disagreement the other way round.
      assert.equal(roots.projectRelative(link, path.join(real, 'src', 'a.ts')), path.join('src', 'a.ts'));
      // The ordinary case is untouched.
      assert.equal(roots.projectRelative(real, path.join(real, 'src', 'a.ts')), path.join('src', 'a.ts'));
      // A relative path is passed through, as before.
      assert.equal(roots.projectRelative(real, 'src/a.ts'), 'src/a.ts');
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});
