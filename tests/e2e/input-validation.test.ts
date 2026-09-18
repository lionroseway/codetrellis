/**
 * Phase 19 — input validation at the API boundary.
 *
 * The unit tests in `src/backend/services/git-safety.test.ts` prove the
 * validators reject the right strings. These prove the validators are
 * actually WIRED UP at the routes that take the value from a request — which
 * is the part that is easy to get wrong and impossible to see from the
 * validator's own tests.
 *
 * Findings covered here grow as the gates land. Currently: 7, 10, 24.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setupHarness, authFetch } from '../harness';

test.describe('Finding 10 — git option injection', () => {
  test('git-ref routes reject arguments that git would read as flags', async () => {
    const h = await setupHarness('finding-10-git-option-injection');
    try {
      // The project must be OPENED before these endpoints will answer:
      // a project root is never caller-nominated (Phase 19), so an
      // unopened path is refused before the check under test can run.
      // Without this the assertion below would pass on a 403 and prove
      // nothing about git-ref validation.
      await h.client.scanProject(h.fixture.projectPath);

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

test.describe('Finding 24 — the parse itself is budgeted', () => {
  test('a file over the budget is skipped, not half-parsed', async () => {
    // There was already a cap on CALLSITE extraction, but it applied AFTER
    // the parse — so a pathological file went through tree-sitter first, and
    // the quadratic behaviour that made it pathological had already happened.
    //
    // tree-sitter runs SYNCHRONOUSLY in the Express process, so an unbounded
    // parse is an unbounded stall for every request, not just for this scan.
    //
    // The observable consequence of the budget is what this measures: an
    // over-budget file contributes NO symbols. Timing would be the more
    // direct measurement and a far worse test — it would pass or fail with
    // the load on the machine.
    const h = await setupHarness('finding-24-parse-budget');
    try {
      // Control: an ordinary file, so a missing symbol below cannot be the
      // scanner simply not working.
      fs.writeFileSync(
        path.join(h.fixture.projectPath, 'ordinary.ts'),
        'export function sentinelUnderBudget() { return 1; }\n',
      );

      // And one over the budget, with its own distinctive export.
      const big = path.join(h.fixture.projectPath, 'generated.ts');
      const line = (i: number) => `export function filler${String(i).padStart(9, '0')}() { return ${i}; }\n`;
      let source = 'export function sentinelOverBudget() { return 1; }\n';
      for (let i = 0; source.length < 2.5 * 1024 * 1024; i++) source += line(i);
      fs.writeFileSync(big, source);
      expect(fs.statSync(big).size, 'precondition: the file must exceed the 2 MiB budget')
        .toBeGreaterThan(2 * 1024 * 1024);

      const scan = await h.client.scanProject(h.fixture.projectPath);
      expect(scan.fileCount, 'the scan must still produce a result').toBeGreaterThan(0);

      const found = async (name: string) =>
        (await h.client.searchSymbols(name) as Array<{ name?: string }>)
          .some((sym) => sym.name === name);

      expect(
        await found('sentinelUnderBudget'),
        'precondition: an ordinary file IS parsed, so the scanner works',
      ).toBe(true);

      expect(
        await found('sentinelOverBudget'),
        'an over-budget file must contribute no symbols — skipping beats half-parsing, ' +
          'which produces confidently wrong symbols and edges',
      ).toBe(false);

      // And the backend is still answering, which is what the finding is about.
      expect((await h.client.raw('GET', '/api/health')).ok).toBe(true);
    } finally {
      await h.teardown();
    }
  });
});
