/**
 * Three ways the review surface answered badly rather than wrongly.
 *
 * Each is a case where the code had a correct answer available and gave a
 * worse one instead: a 500 for input it should refuse, a silent no-op for a
 * comparand it supports, and "untouched" for a file the plan plainly declared.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness } from '../harness';

const headSha = (projectPath: string): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectPath, encoding: 'utf-8' }).trim();

test.describe('Comparand and target edge cases', () => {
  test.setTimeout(120_000);

  test('an invalid git ref is refused with a reason, not a 500 (M3)', async () => {
    const h = await setupHarness('comparand-bad-ref');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const q = `project=${encodeURIComponent(h.fixture.projectPath)}`;

      // `assertSafeGitRef` throws, but `resolveComparand` is documented as
      // returning null for anything that does not resolve, and every caller
      // branches on the result rather than catching. So option-injection-shaped
      // input produced "Internal server error" while a merely unknown ref
      // produced a clean 404 — the refusal was the less informative of the two.
      const hostile = await h.client.raw(
        'GET',
        `/api/compare?${q}&before=${encodeURIComponent('commit:--upload-pack=touch /tmp/pwn')}&after=live`,
      );
      expect(hostile.status).toBe(404);
      expect(hostile.status).not.toBe(500);

      // The neighbouring case, for contrast: this always behaved.
      const unknown = await h.client.raw('GET', `/api/compare?${q}&before=commit:deadbeef&after=live`);
      expect(unknown.status).toBe(404);

      // The same input on the two surfaces an agent actually calls.
      // `commit:<ref>` is documented as "any git ref", so a RANGE is a
      // natural thing to send — and a range contains `..`, which
      // SAFE_REF forbids. Both used to answer "Internal server error",
      // which the review panel renders verbatim: the user is told the
      // desktop broke when in fact their input was refused.
      const plan = await h.client.createPlan({ title: 'Refusals', projectPath: h.fixture.projectPath });
      const p = `project=${encodeURIComponent(h.fixture.projectPath)}`;
      for (const spec of ['commit:HEAD~1..HEAD', 'commit:--output=/tmp/x']) {
        for (const route of [`review`, `pr-draft`]) {
          const res = await h.client.raw(
            'GET',
            `/api/plans/${encodeURIComponent(plan.uid)}/${route}?${p}`
              + `&before=${encodeURIComponent(spec)}&after=live`,
          );
          expect(res.status, `${route} on ${spec} must not be a 500`).not.toBe(500);
          // And whatever it does answer must carry a reason, not just a code.
          if (!res.ok) {
            const body = (await res.json()) as { reason?: string; error?: string };
            expect(
              body.reason ?? body.error ?? '',
              `${route} on ${spec} refused without saying why`,
            ).not.toBe('Internal server error');
          }
        }
      }

      // The file surface reads a ref too, and refuses rather than crashing.
      const file = await h.client.raw(
        'GET',
        `/api/file/at?${p}&path=src/a.ts&at=${encodeURIComponent('commit:--output=/tmp/x')}`,
      );
      expect(file.status).not.toBe(500);
    } finally {
      await h.teardown();
    }
  });

  test('a PR draft against a checkpoint is not a silent no-op (M5)', async () => {
    const h = await setupHarness('prdraft-checkpoint');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({ title: 'Draft me', projectPath: h.fixture.projectPath });

      // Every `before` was run through `assertSafeGitRef`, and SAFE_REF forbids
      // colons by design — so `checkpoint:1`, a comparand the product offers in
      // its own picker, threw before the draft was ever built. "Copy PR
      // description" did nothing, with a 500 behind it.
      const res = await h.client.raw(
        'GET',
        `/api/plans/${encodeURIComponent(plan.uid)}/pr-draft`
          + `?project=${encodeURIComponent(h.fixture.projectPath)}&before=checkpoint:1&after=live`,
      );
      expect(res.status).not.toBe(500);

      // A genuinely malformed commit ref is still refused — as a reason, not a crash.
      const bad = await h.client.raw(
        'GET',
        `/api/plans/${encodeURIComponent(plan.uid)}/pr-draft`
          + `?project=${encodeURIComponent(h.fixture.projectPath)}`
          + `&before=${encodeURIComponent('commit:--upload-pack=x')}&after=live`,
      );
      expect(bad.status).not.toBe(500);
    } finally {
      await h.teardown();
    }
  });

  test('an absolute declared target still matches its changed file (M4)', async () => {
    const h = await setupHarness('review-absolute-target');
    const root = h.fixture.projectPath;
    try {
      await h.client.scanProject(root);
      const plan = await h.client.createPlan({ title: 'Absolute targets', projectPath: root });

      // The UI writes ABSOLUTE paths into fileSpecs: /api/scan returns a tree
      // built with path.join, and the mention picker passes that straight
      // through. `normalise` only strips a leading slash, so the target became
      // `users/…/src/a.ts` and could never equal `src/a.ts`.
      const relative = 'packages/shared/src/types.ts';
      const createRes = await h.client.raw('POST', `/api/plans/${encodeURIComponent(plan.uid)}/items`, {
        kind: 'action',
        title: 'Touch types.ts',
        fileSpecs: [{ path: path.join(root, relative), intent: 'modify' }],
      });
      expect(createRes.ok).toBe(true);

      const res = await h.client.raw(
        'GET',
        `/api/plans/${encodeURIComponent(plan.uid)}/review`
          + `?project=${encodeURIComponent(root)}`
          + `&before=${encodeURIComponent(`commit:${headSha(root)}`)}&after=live`,
      );
      expect(res.ok).toBe(true);
      const review = (await res.json()) as {
        items: Array<{ title: string; landed: string[]; missing: string[]; verdict: string }>;
      };

      const item = review.items.find((i) => i.title === 'Touch types.ts');
      expect(item, 'the item is in the review').toBeTruthy();
      // Before the fix this was `no-targets`: the target existed but could not
      // be compared against anything, so the plan looked as though it declared
      // nothing at all.
      expect(item!.verdict).not.toBe('no-targets');
      // And the target is reported project-relative, so the developer's home
      // directory does not end up pasted into a pull request.
      const shown = [...item!.landed, ...item!.missing];
      expect(shown.every((p) => !path.isAbsolute(p)), `absolute path leaked: ${shown.join(', ')}`).toBe(true);
    } finally {
      await h.teardown();
    }
  });
});
