/**
 * Phase 29 §4.14 — "what's next" and the shared/local toggle.
 *
 * Two endpoint groups the register filed as unsurfaced. Working them
 * turned up something worse than a missing UI on one of them:
 *
 * `/api/plans/:uid/next-task` read the V1 `tasks` table. The workspace
 * has written the V2 `plan_items` table since Phase 15, and they are
 * separate tables with separate writers — so the endpoint answered
 * "nothing next" for every plan authored in the current UI. Nothing
 * caught it because nothing called it: no MCP tool exposes it and
 * neither client hit the route. Surfacing it unchanged would have
 * shipped a widget permanently reading "nothing to do".
 *
 * The first two tests pin the fixed behaviour, including the
 * dependency rule that is the only thing this adds over reading the
 * tree. The rest cover the shared/local toggle
 * (`file-status` / `export` / `unlink`), whose three endpoints had no
 * caller between them while `useWebSocket` sat listening for the
 * events they broadcast.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, type Harness } from '../harness';

interface Item { uid: string; title: string; status?: string | null }

async function addAction(
  h: Harness,
  planUid: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<Item> {
  const res = await h.client.raw('POST', `/api/plans/${planUid}/items`, {
    kind: 'action', title, ...extra,
  });
  expect(res.ok).toBe(true);
  return await res.json() as Item;
}

async function nextTask(h: Harness, planUid: string): Promise<Item | { none: true }> {
  const res = await h.client.raw('GET', `/api/plans/${planUid}/next-task`);
  expect(res.ok).toBe(true);
  return await res.json() as Item | { none: true };
}

test.describe('Next up + shared/local', () => {
  test.setTimeout(120_000);

  test('next-task answers from V2 items, in tree order', async () => {
    const h = await setupHarness('next-up-v2');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'V2 plan', projectPath: h.fixture.projectPath,
      });

      // Before the fix this returned { none: true } no matter what,
      // because a V2 plan has no rows in `tasks` at all.
      const first = await addAction(h, plan.uid, 'First action');
      await addAction(h, plan.uid, 'Second action');

      const next = await nextTask(h, plan.uid);
      expect('none' in next).toBe(false);
      expect((next as Item).uid).toBe(first.uid);
      expect((next as Item).title).toBe('First action');

      // Objects are not work — a plan of nothing but Objects has
      // nothing next.
      const objPlan = await h.client.createPlan({
        title: 'Objects only', projectPath: h.fixture.projectPath,
      });
      const objRes = await h.client.raw('POST', `/api/plans/${objPlan.uid}/items`, {
        kind: 'object', title: 'Some context',
      });
      expect(objRes.ok).toBe(true);
      expect(await nextTask(h, objPlan.uid)).toMatchObject({ none: true });
    } finally {
      await h.teardown();
    }
  });

  test('a blocked action is skipped until its dependency settles', async () => {
    const h = await setupHarness('next-up-deps');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Dependent work', projectPath: h.fixture.projectPath,
      });

      const groundwork = await addAction(h, plan.uid, 'Groundwork');
      // Ordered first, but waiting on something later in the tree —
      // which is exactly the case a status column cannot show.
      const blocked = await addAction(h, plan.uid, 'Blocked on groundwork', {
        dependencies: [groundwork.uid],
      });

      // Groundwork comes first anyway; prove the dependency matters by
      // taking it out of the running.
      expect((await nextTask(h, plan.uid) as Item).uid).toBe(groundwork.uid);

      const inProgress = await h.client.raw('PUT', `/api/items/${groundwork.uid}`, {
        status: 'in_progress',
      });
      expect(inProgress.ok).toBe(true);

      // Groundwork is no longer pending and the other action is still
      // waiting on it — so nothing is ready. "Nothing ready" and
      // "nothing pending" are different answers and the strip says so.
      expect(await nextTask(h, plan.uid)).toMatchObject({ none: true });

      const doneRes = await h.client.raw('PUT', `/api/items/${groundwork.uid}`, {
        status: 'done',
      });
      expect(doneRes.ok).toBe(true);
      expect((await nextTask(h, plan.uid) as Item).uid).toBe(blocked.uid);
    } finally {
      await h.teardown();
    }
  });

  test('a V1 plan keeps its old answer', async () => {
    const h = await setupHarness('next-up-v1');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      // `tasks` is only populated when a plan is created with them, so
      // this is the shape the fallback exists for.
      const plan = await h.client.createPlan({
        title: 'V1 plan',
        projectPath: h.fixture.projectPath,
        tasks: [{ description: 'Legacy task one' }, { description: 'Legacy task two' }],
      });

      const next = await nextTask(h, plan.uid);
      expect('none' in next).toBe(false);
      // V1 tasks carry `description`, not `title` — proving the
      // fallback returned a Task and not a PlanItem.
      expect((next as unknown as { description: string }).description).toBe('Legacy task one');
      // And the strip has to cope with that shape: a V1 plan with a
      // description but no items is not "empty", so it renders, and
      // reading `title` alone would print "untitled".
      expect((next as unknown as { title?: string }).title).toBeUndefined();
    } finally {
      await h.teardown();
    }
  });

  test('shared/local round trip: file-status → export → unlink', async () => {
    const h = await setupHarness('plan-sync-toggle');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Toggle me', projectPath: h.fixture.projectPath,
      });
      const qs = `path=${encodeURIComponent(h.fixture.projectPath)}`;

      // A plan starts local — in the database only.
      const before = await h.client.getPlanFileStatus(plan.uid, h.fixture.projectPath);
      expect(before.linked).toBe(false);
      expect(before.planDir).toBeNull();

      const exportRes = await h.client.raw('POST', `/api/plans/${plan.uid}/export?${qs}`);
      expect(exportRes.ok).toBe(true);
      const exported = await exportRes.json() as { planDir: string; files: string[] };
      expect(fs.existsSync(path.join(exported.planDir, 'plan.yaml'))).toBe(true);

      // The chip reads exactly this to decide which state it shows.
      const after = await h.client.getPlanFileStatus(plan.uid, h.fixture.projectPath);
      expect(after.linked).toBe(true);
      expect(after.planDir).toBe(exported.planDir);

      const unlinked = await h.client.unlinkPlan(plan.uid, h.fixture.projectPath);
      expect(unlinked.removed).toBe(true);
      expect(fs.existsSync(exported.planDir)).toBe(false);

      // "The plan itself is untouched" is what the toast promises, so
      // check the DB row survived rather than only that the dir went.
      const still = await h.client.getPlan(plan.uid);
      expect(still.title).toBe('Toggle me');
      expect((await h.client.getPlanFileStatus(plan.uid, h.fixture.projectPath)).linked).toBe(false);
    } finally {
      await h.teardown();
    }
  });
});
