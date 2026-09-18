/**
 * A commit comparand and a database comparand must describe the same thing.
 *
 * Two independent bugs made `commit:<ref>` incomparable with everything else,
 * and both presented as a confident wrong number rather than as an error:
 *
 *   1. **Hash space.** `git ls-tree` yields the blob OID — SHA-1 of
 *      `"blob <len>\0<content>"` — while every other snapshot carries an md5
 *      of the bytes. Compared with `!==`, they never matched, so EVERY file
 *      present on both sides reported as modified. On this fixture that was
 *      44 of 44 on a tree with no edits.
 *   2. **Population.** `ls-tree` lists every tracked blob; a live snapshot
 *      holds only what the scanner indexes. So every tracked-but-unindexed
 *      file (lockfiles, images, .gitignore) reported as *removed*.
 *
 * Fixing one does not fix the other, so both are pinned here. These assertions
 * are the point of the file: on an unmodified working tree, comparing HEAD to
 * live must find nothing.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupHarness } from '../harness';

interface CompareResult {
  before: { spec: string; label: string; fileCount: number };
  after: { spec: string; label: string; fileCount: number };
  diff: {
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
    summary: { added: number; removed: number; modified: number };
  };
  notes: string[];
}

async function compare(
  h: { client: { raw(m: string, p: string): Promise<Response> }; fixture: { projectPath: string } },
  before: string,
  after: string,
): Promise<CompareResult> {
  const res = await h.client.raw(
    'GET',
    `/api/compare?project=${encodeURIComponent(h.fixture.projectPath)}` +
      `&before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`,
  );
  return (await res.json()) as CompareResult;
}

const headSha = (projectPath: string): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectPath, encoding: 'utf-8' }).trim();

test.describe('Commit vs live comparands (hash space and population)', () => {
  test.setTimeout(120_000);

  test('an untouched working tree differs from HEAD in nothing', async () => {
    const h = await setupHarness('compare-hash-space');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const result = await compare(h, `commit:${headSha(h.fixture.projectPath)}`, 'live');

      // Before the fix: modified was every indexed file (44 of 44), because
      // the two sides hashed into different spaces and could never be equal.
      expect(result.diff.summary.modified).toBe(0);
      expect(result.diff.modifiedFiles).toEqual([]);
      expect(result.diff.summary.added).toBe(0);

      // Before the fix: removed was every tracked-but-UNINDEXABLE file —
      // README.md, package.json, tsconfig.json, pnpm-workspace.yaml,
      // pyproject.toml and the rest — because ls-tree lists every blob while
      // the live side lists only what the product indexes.
      //
      // What remains is a THIRD issue, narrower than either of the above and
      // deliberately pinned rather than absorbed: a file with an indexable
      // extension that FAILS TO PARSE gets no row in `files`, so it is absent
      // from the live side and reads as removed — though it is still on disk
      // and was never removed at all. Any project with a syntax error in it
      // will show this. Tracked separately; this assertion fails loudly if
      // the residual ever grows beyond the fixture's deliberate one.
      expect(result.diff.removedFiles).toEqual(['services/billing/testdata/broken.go']);
    } finally {
      await h.teardown();
    }
  });

  test('a real edit is the only thing reported', async () => {
    const h = await setupHarness('compare-hash-space-edit');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const sha = headSha(h.fixture.projectPath);

      // Touch exactly one indexed source file, then re-scan so the database
      // reflects it the way the live snapshot will read it.
      const relative = 'packages/shared/src/types.ts';
      const target = path.join(h.fixture.projectPath, relative);
      expect(fs.existsSync(target)).toBe(true);
      fs.appendFileSync(target, '\n// touched by compare-hash-space test\n');
      await h.client.scanProject(h.fixture.projectPath);

      const result = await compare(h, `commit:${sha}`, 'live');
      expect(result.diff.summary.modified).toBe(1);
      expect(result.diff.modifiedFiles).toEqual([relative]);
      expect(result.diff.summary.added).toBe(0);
      // The same known residual as above — the unparseable fixture file.
      expect(result.diff.removedFiles).toEqual(['services/billing/testdata/broken.go']);
    } finally {
      await h.teardown();
    }
  });
});

test.describe('A project opened through a symlink (M33)', () => {
  test.setTimeout(120_000);

  test('comparing HEAD to live still finds nothing on an untouched tree', async () => {
    const h = await setupHarness('compare-symlinked-root');
    // /tmp is a symlink on macOS, so this is not an exotic setup — it is what
    // happens to anyone whose project lives under /tmp.
    const link = path.join(fs.realpathSync(os.tmpdir()), `ct-symroot-${process.pid}`);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(h.fixture.projectPath, link, 'dir');
    try {
      // Open it through the link: scan is exempt from confinement, so this is
      // the path that gets STORED on every row.
      await h.client.scanProject(link);

      // Read it through the link too. The handler resolves it to the realpath,
      // so the reader and the rows disagree — which used to make every file
      // report as removed AND re-added.
      const res = await h.client.raw(
        'GET',
        `/api/compare?project=${encodeURIComponent(link)}` +
          `&before=${encodeURIComponent(`commit:${headSha(link)}`)}&after=live`,
      );
      const result = (await res.json()) as CompareResult;

      expect(result.diff.summary.modified).toBe(0);
      expect(result.diff.summary.added).toBe(0);
      expect(result.diff.removedFiles).toEqual(['services/billing/testdata/broken.go']);
    } finally {
      fs.rmSync(link, { force: true });
      await h.teardown();
    }
  });
});
