/**
 * Phase 29 §4.8 — plan-level version history.
 *
 * `plan_versions` takes a row on create and on every `updatePlan`, each
 * holding a full JSON snapshot. `/api/plans/:uid/versions` has served
 * them since Phase 3 with no reader, so nothing checked that the rows
 * were usable — only that they existed.
 *
 * "Usable" is the point here. The drawer diffs consecutive snapshots to
 * turn a change summary like "title, status updated" into what the
 * title and status actually became. That only works if every snapshot
 * parses and carries the plan's own fields, so that is what these
 * assert — not just a row count.
 *
 * The sibling `plan_item_versions` was already surfaced in Phase 15, so
 * it is not re-tested here.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

interface Version {
  id: number;
  planUid: string;
  version: number;
  snapshot: string;
  changeSummary: string | null;
  author: string;
  createdAt: number;
}

async function versions(h: Harness, planUid: string): Promise<Version[]> {
  const res = await h.client.raw('GET', `/api/plans/${planUid}/versions`);
  expect(res.ok).toBe(true);
  return await res.json() as Version[];
}

test.describe('Plan version history', () => {
  test.setTimeout(120_000);

  test('a new plan has v1, and every edit adds a readable snapshot', async () => {
    const h = await setupHarness('plan-versions');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Original title',
        description: 'First description',
        projectPath: h.fixture.projectPath,
      });

      const initial = await versions(h, plan.uid);
      expect(initial).toHaveLength(1);
      expect(initial[0].version).toBe(1);

      // v1's snapshot is what the drawer labels "Plan created", and it
      // has to parse or there is nothing to compare later versions to.
      //
      // It also has to be the SAME SHAPE as every later version.
      // `createPlan` used to write `{ plan, tasks }` here while
      // `updatePlan` wrote the bare plan — one column, two shapes,
      // nothing checking. Diffing v2 against v1 then compared a plan to
      // a wrapper and reported every tracked field as changed from
      // nothing on a plan's first edit. This assertion is what keeps
      // the two writers agreeing.
      const firstSnapshot = JSON.parse(initial[0].snapshot) as { title: string; description: string; plan?: unknown };
      expect(firstSnapshot.plan).toBeUndefined();
      expect(firstSnapshot.title).toBe('Original title');
      expect(firstSnapshot.description).toBe('First description');

      const edit = await h.client.raw('PUT', `/api/plans/${plan.uid}`, {
        title: 'Renamed', status: 'in_progress',
      });
      expect(edit.ok).toBe(true);

      const after = await versions(h, plan.uid);
      expect(after.length).toBeGreaterThanOrEqual(2);

      // Newest first — the drawer pairs each row with the one below it
      // to compute a diff, so the order is load-bearing, not cosmetic.
      expect(after[0].version).toBeGreaterThan(after[1].version);

      const latest = JSON.parse(after[0].snapshot) as { title: string; status: string };
      expect(latest.title).toBe('Renamed');
      expect(latest.status).toBe('in_progress');

      // The previous row still holds the pre-edit state, which is what
      // makes "Original title → Renamed" renderable at all — and it has
      // to be reachable at the same key as the newer one, or the diff
      // reads as "(empty) → Renamed".
      const prior = JSON.parse(after[1].snapshot) as { title: string };
      expect(prior.title).toBe('Original title');
      expect(prior.title).not.toBe(latest.title);

      // Every row carries an author and a timestamp — both shown.
      for (const v of after) {
        expect(v.author).toBeTruthy();
        expect(v.createdAt).toBeGreaterThan(0);
      }
    } finally {
      await h.teardown();
    }
  });

  test('versions for an unknown plan answer empty, not an error', async () => {
    const h = await setupHarness('plan-versions-missing');
    try {
      // The drawer opens from a chip on an already-loaded plan, but a
      // plan can be deleted in another window while it is open. Empty
      // is a renderable answer; a 500 is not.
      const res = await h.client.raw('GET', '/api/plans/does-not-exist/versions');
      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual([]);
    } finally {
      await h.teardown();
    }
  });
});
