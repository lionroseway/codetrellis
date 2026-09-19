/**
 * A file that failed to parse is not a file that was deleted.
 *
 * The two sides of a commit→live compare are built from different
 * places. The commit side comes from `git ls-tree`, filtered by
 * extension. The live side comes from the `files` table, which holds
 * only what the parser succeeded on. So anything with an indexable
 * extension that does not parse — a syntax error, which during active
 * development is a normal state — was reported as REMOVED from a project
 * where it is sitting on disk.
 *
 * Extension parity was fixable from the commit side and was (B3). Parse
 * success is not knowable there without parsing the historical blob, so
 * the check has to happen on the live side, where the file either exists
 * or does not.
 *
 * The fixture carries a deliberate one: `services/billing/testdata/broken.go`.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness } from '../harness';

const headSha = (projectPath: string): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectPath, encoding: 'utf-8' }).trim();

test.describe('Phantom removals', () => {
  test.setTimeout(120_000);

  test('an unparseable file on disk is not reported as removed (N1)', async () => {
    const h = await setupHarness('compare-phantom');
    const root = h.fixture.projectPath;
    try {
      await h.client.scanProject(root);

      const res = await h.client.raw(
        'GET',
        `/api/compare?project=${encodeURIComponent(root)}`
          + `&before=${encodeURIComponent(`commit:${headSha(root)}`)}&after=live`,
      );
      expect(res.ok).toBe(true);
      const body = (await res.json()) as {
        diff: { removedFiles: string[]; summary: { removed: number } };
        notes: string[];
      };

      // Nothing was deleted between HEAD and the working tree — the
      // harness copies the fixture and commits it — so any removal here
      // is an artefact of the two sides being populated differently.
      const stillThere = body.diff.removedFiles.filter((rel) =>
        fs.existsSync(path.join(root, rel)),
      );
      expect(
        stillThere,
        `reported as removed but present on disk: ${stillThere.join(', ')}`,
      ).toEqual([]);

      // The headline number counts the same list it is a summary of.
      expect(body.diff.summary.removed).toBe(body.diff.removedFiles.length);
    } finally {
      await h.teardown();
    }
  });

  test('a genuinely deleted file is still reported as removed', async () => {
    // The fix must not simply stop reporting removals.
    const h = await setupHarness('compare-real-removal');
    const root = h.fixture.projectPath;
    try {
      await h.client.scanProject(root);
      const sha = headSha(root);

      const victim = path.join(root, 'packages/shared/src/validators.ts');
      expect(fs.existsSync(victim)).toBe(true);
      fs.rmSync(victim);
      await h.client.scanProject(root);

      const res = await h.client.raw(
        'GET',
        `/api/compare?project=${encodeURIComponent(root)}`
          + `&before=${encodeURIComponent(`commit:${sha}`)}&after=live`,
      );
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { diff: { removedFiles: string[] } };
      expect(body.diff.removedFiles).toContain('packages/shared/src/validators.ts');
    } finally {
      await h.teardown();
    }
  });
});
