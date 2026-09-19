/**
 * The Phase 25 review surface over REST — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * Phase 25 built comparands, compare, review and pr-draft, and shipped
 * every one of them reachable only over REST and MCP — the whole review
 * surface was invisible to the application. `PlanReviewPanel` now reads
 * all four; these are the contracts it depends on.
 *
 * The default comparand matters more than it looks: `scanProject`
 * re-pins the baseline on every run, so baseline→live is empty
 * immediately after a scan — which reads as "nothing changed" at exactly
 * the moment a user opens the panel. `commit:HEAD` is stable across
 * scans, which is why the panel defaults to it and why these tests use
 * it.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness } from '../harness';

interface Comparand { spec: string; label: string; kind: string }

interface PlanReview {
  planUid: string;
  items: Array<{ uid: string; title: string; verdict: string; landed: string[]; missing: string[] }>;
  unclaimedChanges: string[];
  unplannedEdges: Array<{ source: string; target: string }>;
  summary: {
    itemsLanded: number; itemsPartial: number; itemsUntouched: number;
    filesChanged: number; unclaimedCount: number; unplannedEdgeCount: number;
  };
}

interface PrDraft {
  title: string; body: string; head: string | null; base: string | null;
  tickets: string[]; warnings: string[];
}

test.describe('Plan review surface (Phase 29)', () => {
  test.setTimeout(120_000);

  test('comparands offer both ends of a comparison', async () => {
    const h = await setupHarness('review-comparands');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const res = await h.client.raw(
        'GET', `/api/comparands?project=${encodeURIComponent(h.fixture.projectPath)}`,
      );
      expect(res.ok).toBe(true);
      const list = (await res.json()) as Comparand[];

      expect(Array.isArray(list)).toBe(true);
      // The working tree is always an option — it is the "after" a user
      // most often wants.
      expect(list.some((c) => c.spec === 'live'), 'live must always be offered').toBe(true);
      // And recent commits, so the common case needs no typing.
      expect(
        list.some((c) => c.kind === 'commit'),
        'recent commits should be offered as comparands',
      ).toBe(true);
      for (const c of list) {
        expect(c.spec, 'every comparand needs a spec to send back').toBeTruthy();
        expect(c.label, 'every comparand needs a label to show').toBeTruthy();
      }
    } finally {
      await h.teardown();
    }
  });

  test('a review reports which items landed and what nothing claimed', async () => {
    const h = await setupHarness('review-plan');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Touch the notifier',
        projectPath: h.fixture.projectPath,
      });

      // Change a file no plan item declares, so the review has something
      // to report as unclaimed — the finding this panel exists for.
      const stray = path.join(h.fixture.projectPath, 'services/notifier/app.rb');
      fs.appendFileSync(stray, '\n# a change nobody planned\n');
      // Re-scan: 'live' is the SCANNED state, not the disk — liveSnapshot reads
      // file hashes out of the database. In the app the file-watcher closes that
      // gap; in the harness there is no watcher, so an edit that is never scanned
      // is invisible to the comparison. This test passed without it only because
      // commit-vs-live used to report every file as modified, which put app.rb in
      // the list for the wrong reason and would have kept passing if the plumbing
      // under it broke entirely.
      await h.client.scanProject(h.fixture.projectPath);

      const q = `project=${encodeURIComponent(h.fixture.projectPath)}&before=commit:HEAD&after=live`;
      const res = await h.client.raw('GET', `/api/plans/${encodeURIComponent(plan.uid)}/review?${q}`);
      expect(res.ok).toBe(true);
      const review = (await res.json()) as PlanReview;

      expect(review.planUid).toBe(plan.uid);
      expect(review.summary.filesChanged).toBeGreaterThan(0);
      expect(
        review.unclaimedChanges.some((f) => f.includes('app.rb')),
        'a changed file no item declared must be reported as unclaimed',
      ).toBe(true);
      expect(review.summary.unclaimedCount).toBe(review.unclaimedChanges.length);
    } finally {
      await h.teardown();
    }
  });

  test('the PR draft is read-only and carries the review as warnings', async () => {
    const h = await setupHarness('review-pr-draft');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Rotate the signing keys',
        projectPath: h.fixture.projectPath,
      });

      const stray = path.join(h.fixture.projectPath, 'services/notifier/app.rb');
      fs.appendFileSync(stray, '\n# unplanned\n');
      // Rescan, or the edit never reaches the diff: the live snapshot is
      // built from the `files` table, not from the working tree.
      //
      // Without this the test passed for a reason that had nothing to do
      // with its subject. The only unclaimed change in the comparison was
      // `testdata/broken.go`, which appeared as REMOVED because it fails
      // to parse and so has no row in `files` — a phantom removal, fixed
      // as N1. The unplanned edit this test is about was invisible
      // throughout, and closing that bug is what exposed it.
      await h.client.scanProject(h.fixture.projectPath);

      const headBefore = await h.client.raw('GET', `/api/git/head?path=${encodeURIComponent(h.fixture.projectPath)}`);
      const shaBefore = (await headBefore.json()).commitHash;

      const q = `project=${encodeURIComponent(h.fixture.projectPath)}&before=commit:HEAD&after=live`;
      const res = await h.client.raw('GET', `/api/plans/${encodeURIComponent(plan.uid)}/pr-draft?${q}`);
      expect(res.ok).toBe(true);
      const draft = (await res.json()) as PrDraft;

      expect(draft.title).toContain('Rotate the signing keys');
      expect(draft.body.length).toBeGreaterThan(0);
      // The review's finding reaches the reviewer rather than being
      // buried in a panel they may not open.
      expect(draft.warnings.length).toBeGreaterThan(0);

      // Read-only: building a draft must not commit, branch or tag.
      const headAfter = await h.client.raw('GET', `/api/git/head?path=${encodeURIComponent(h.fixture.projectPath)}`);
      expect(
        (await headAfter.json()).commitHash,
        'building a PR draft must not touch the repository',
      ).toBe(shaBefore);
    } finally {
      await h.teardown();
    }
  });

  test('an unknown comparand is refused with a reason, not a crash', async () => {
    const h = await setupHarness('review-bad-comparand');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'A plan', projectPath: h.fixture.projectPath,
      });
      const q = `project=${encodeURIComponent(h.fixture.projectPath)}&before=checkpoint:does-not-exist&after=live`;
      const res = await h.client.raw('GET', `/api/plans/${encodeURIComponent(plan.uid)}/review?${q}`);

      // The panel renders `reason` to the user, so it has to be there.
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.reason || body.error).toBeTruthy();
    } finally {
      await h.teardown();
    }
  });
});
