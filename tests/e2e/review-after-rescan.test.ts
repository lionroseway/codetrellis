/**
 * A review after a rescan must not report that nothing happened.
 *
 * `scanProject` re-pins the baseline on every run, and `reviewPlan`
 * defaulted `before` to `'baseline'`. So the sequence every agent actually
 * follows — edit files, rescan, ask for a review — compared the baseline
 * against itself and answered "untouched" for every item on a plan whose
 * work had genuinely landed. Silently: no error, just a confident zero.
 *
 * Found by walking the product end to end. In the same session,
 * `compare_snapshots` against a checkpoint correctly reported 1 modified
 * while `review_plan` reported 0 of 3 landed.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness } from '../harness';

test.describe('Review after a rescan', () => {
  test.setTimeout(120_000);

  test('an item whose file changed reads as landed, not untouched', async () => {
    const h = await setupHarness('review-after-rescan');
    const root = h.fixture.projectPath;
    try {
      await h.client.scanProject(root);

      const plan = await h.client.createPlan({ title: 'Rounding', projectPath: root });
      const relative = 'packages/shared/src/types.ts';
      const created = await h.client.raw('POST', `/api/plans/${encodeURIComponent(plan.uid)}/items`, {
        kind: 'action',
        title: 'Touch types.ts',
        fileSpecs: [{ path: relative, action: 'modify' }],
      });
      expect(created.ok).toBe(true);

      // Do the work, then rescan — which is what moved the baseline.
      const target = path.join(root, relative);
      fs.appendFileSync(target, '\n// changed by review-after-rescan\n');
      await h.client.scanProject(root);

      // No `before` given: the default is what is under test.
      const res = await h.client.raw(
        'GET',
        `/api/plans/${encodeURIComponent(plan.uid)}/review?project=${encodeURIComponent(root)}`,
      );
      expect(res.ok).toBe(true);
      const review = (await res.json()) as {
        items: Array<{ title: string; verdict: string; landed: string[] }>;
      };

      const item = review.items.find((i) => i.title === 'Touch types.ts');
      expect(item, 'the item is in the review').toBeTruthy();
      expect(
        item!.verdict,
        'the file was edited and the review says nothing happened — the default comparand moved under it',
      ).not.toBe('untouched');
      expect(item!.landed).toContain(relative);
    } finally {
      await h.teardown();
    }
  });

  test('an item nobody touched still reads as untouched', async () => {
    // The fix must not simply mark everything landed.
    const h = await setupHarness('review-after-rescan-negative');
    const root = h.fixture.projectPath;
    try {
      await h.client.scanProject(root);
      const plan = await h.client.createPlan({ title: 'Untouched', projectPath: root });
      const created = await h.client.raw('POST', `/api/plans/${encodeURIComponent(plan.uid)}/items`, {
        kind: 'action',
        title: 'Never touched',
        fileSpecs: [{ path: 'services/notifier/app.rb', action: 'modify' }],
      });
      expect(created.ok).toBe(true);

      const res = await h.client.raw(
        'GET',
        `/api/plans/${encodeURIComponent(plan.uid)}/review?project=${encodeURIComponent(root)}`,
      );
      const review = (await res.json()) as { items: Array<{ title: string; verdict: string }> };
      expect(review.items.find((i) => i.title === 'Never touched')?.verdict).toBe('untouched');
    } finally {
      await h.teardown();
    }
  });
});
