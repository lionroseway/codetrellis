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

test.describe('Finding 7 — terminal history path traversal and read-side creation', () => {
  test('a read cannot create a file, and ids cannot traverse', async () => {
    const h = await setupHarness('finding-7-terminal-history');
    const fs = await import('node:fs');
    const path = await import('node:path');
    try {
      // Assert the harness actually gave us a data dir. Without this, a
      // missing value silently turns every path below into a relative one
      // and the whole test passes while checking nothing — which is exactly
      // what it did until `startBackend` was fixed to return it.
      const dataDir = h.backend.dataDir;
      expect(dataDir, 'the harness must expose the backend data dir').toBeTruthy();
      expect(path.isAbsolute(dataDir), 'data dir must be absolute').toBe(true);
      const canary = path.join(dataDir, 'canary-written-by-a-read.log');
      const outside = path.join(dataDir, '..', 'escaped-terminal-log.log');

      // ── traversal ───────────────────────────────────────────────────
      //
      // The id was interpolated straight into a filename, so `../…` left
      // the terminals directory entirely.
      const traversals = [
        '../escaped-terminal-log',
        '../../escaped-terminal-log',
        'sub/dir/escape',
        '..%2Fescaped',
      ];
      for (const id of traversals) {
        const res = await authFetch(
          h.backend,
          `/api/terminals/${encodeURIComponent(id)}/history`,
        );
        expect(
          [400, 404, 500].includes(res.status),
          `a traversing terminal id ("${id}") must not be served a 200`,
        ).toBe(true);
      }

      expect(
        fs.existsSync(outside),
        'no terminal-history request may create a file outside the terminals directory',
      ).toBe(false);

      // ── a read must not create ──────────────────────────────────────
      //
      // Reading the scrollback of a terminal that does not exist used to
      // open 'a+' and bring the file into being.
      {
        const res = await authFetch(h.backend, '/api/terminals/canary-written-by-a-read/history');
        // Either an empty history or a 404 is fine. Creating a file is not.
        expect([200, 404].includes(res.status), 'a missing terminal reads as empty').toBe(true);
      }

      const terminalsDir = path.join(dataDir, 'terminals');
      const created = fs.existsSync(path.join(terminalsDir, 'canary-written-by-a-read.log'));
      expect(created, 'reading a non-existent terminal must NOT create its log file').toBe(false);
      expect(fs.existsSync(canary), 'no stray file in the data dir either').toBe(false);
    } finally {
      await h.teardown();
    }
  });
});
