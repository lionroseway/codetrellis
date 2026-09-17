/**
 * Phase 19 — input validation at the API boundary.
 *
 * The unit tests in `src/backend/services/git-safety.test.ts` prove the
 * validators reject the right strings. These prove the validators are
 * actually WIRED UP at the routes that take the value from a request — which
 * is the part that is easy to get wrong and impossible to see from the
 * validator's own tests.
 *
 * Findings covered here grow as the gates land. Currently: 10.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, authFetch } from '../harness';

test.describe('Finding 10 — git option injection', () => {
  test('git-ref routes reject arguments that git would read as flags', async () => {
    const h = await setupHarness('finding-10-git-option-injection');
    try {
      const project = encodeURIComponent(h.fixture.projectPath);

      // git parses ANY argument starting with `-` as an option. Using
      // execFileSync removes the SHELL, but does nothing about this: a
      // "branch" of `--output=…` is an instruction, not a ref.
      const optionLike = [
        '--output=/tmp/codetrellis-pwned',
        '--upload-pack=touch /tmp/codetrellis-pwned',
        '--help',
        '-o/tmp/x',
      ];

      // ── /api/git/branch-tip ─────────────────────────────────────────
      //
      // Passes its `branch` query parameter straight into
      // `git rev-parse <branch>` with no `--` position available.
      for (const branch of optionLike) {
        const res = await authFetch(
          h.backend,
          `/api/git/branch-tip?path=${project}&branch=${encodeURIComponent(branch)}`,
        );
        expect(
          res.status,
          `branch-tip must reject "${branch}" before it reaches git`,
        ).toBe(400);
      }

      // A real branch still resolves, so the check is not simply refusing
      // everything.
      {
        const res = await authFetch(
          h.backend,
          `/api/git/branch-tip?path=${project}&branch=HEAD`,
        );
        expect(res.status, 'a legitimate ref must still work').toBe(200);
      }

      // ── /api/plan-history/:slug/at/:commitHash ──────────────────────
      //
      // The ref is interpolated into `git show <ref>:<path>`, where it must
      // come BEFORE the path — so `--` cannot protect it.
      for (const ref of ['--output=/tmp/x', '--help']) {
        const res = await authFetch(
          h.backend,
          `/api/plan-history/some-plan/at/${encodeURIComponent(ref)}?project=${project}`,
        );
        expect(
          res.status,
          `plan-history must reject "${ref}" as a commit identifier`,
        ).toBe(400);
      }

      // ── /api/plan-history/:slug/diff ────────────────────────────────
      for (const bad of ['--output=/tmp/x', 'a..b']) {
        const res = await authFetch(
          h.backend,
          `/api/plan-history/some-plan/diff?project=${project}&base=${encodeURIComponent(bad)}&head=HEAD`,
        );
        expect(res.status, `diff must reject base="${bad}"`).toBe(400);

        const res2 = await authFetch(
          h.backend,
          `/api/plan-history/some-plan/diff?project=${project}&base=HEAD&head=${encodeURIComponent(bad)}`,
        );
        expect(res2.status, `diff must reject head="${bad}"`).toBe(400);
      }

      // ── and nothing was written ─────────────────────────────────────
      //
      // The strongest assertion available: the whole point of
      // `--output=<path>` is to create a file. If any of the above got
      // through, this exists.
      const fs = await import('node:fs');
      expect(
        fs.existsSync('/tmp/codetrellis-pwned'),
        'no git option injection may have produced a file',
      ).toBe(false);
    } finally {
      await h.teardown();
    }
  });
});
