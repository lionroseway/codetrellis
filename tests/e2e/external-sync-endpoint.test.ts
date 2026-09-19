/**
 * REST access to external sync state — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * Phase 24 built the whole intake path and left the sync watermark
 * reachable only through the `get_external_sync_state` MCP tool — so the
 * "3 tickets need updating" signal existed as data with **no REST
 * endpoint at all**, let alone a surface. This covers the endpoint the
 * plan header chip reads.
 *
 * The behaviour worth pinning is the first-run case: a null watermark
 * means everything with a ticket key counts as changed, which is correct
 * and must not be presented as a drift backlog.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

interface SyncState {
  planUid: string;
  lastSyncedAt: number | null;
  changed: Array<{
    itemUid: string; title: string; status: string | null;
    externalKey: string; url: string; suggestedTransition: string | null;
  }>;
  planRefs: Array<{ externalKey: string; url: string }>;
}

const EPIC = {
  title: 'Refresh-token rotation',
  external: { url: 'https://acme.atlassian.net/browse/PROJ-412' },
  items: [
    { title: 'Rotate signing keys', external: { url: 'https://acme.atlassian.net/browse/PROJ-413' } },
    { title: 'Expire refresh tokens', external: { url: 'https://acme.atlassian.net/browse/PROJ-415' } },
  ],
};

const parse = <T,>(text: string): T => JSON.parse(text) as T;

test.describe('External sync over REST (Phase 29)', () => {
  test.setTimeout(120_000);

  test('a plan built from an epic reports its tickets and its watermark', async () => {
    const h = await setupHarness('external-sync-rest');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-sync' });
      const created = parse<{ plan_uid: string }>(
        (await agent.callTool('create_plan_from_external', EPIC)).text,
      );

      const res = await h.client.raw('GET', `/api/plans/${encodeURIComponent(created.plan_uid)}/external-sync`);
      expect(res.ok).toBe(true);
      const state = (await res.json()) as SyncState;

      expect(state.planUid).toBe(created.plan_uid);
      // The epic itself becomes the plan, so its ticket is a plan ref.
      expect(state.planRefs.length).toBeGreaterThan(0);
      expect(state.planRefs[0].externalKey).toBe('PROJ-412');

      // Never synced: everything carrying a key counts as changed. That
      // is the correct first run, not a backlog.
      expect(state.lastSyncedAt).toBeNull();
      expect(state.changed.length).toBeGreaterThan(0);
      const keys = state.changed.map((c) => c.externalKey).sort();
      expect(keys).toContain('PROJ-413');
      expect(keys).toContain('PROJ-415');

      // Every entry carries what the chip needs to render a row.
      for (const entry of state.changed) {
        expect(entry.itemUid).toBeTruthy();
        expect(entry.title).toBeTruthy();
        expect(entry.url).toMatch(/^https?:\/\//);
      }
    } finally {
      await h.teardown();
    }
  });

  test('marking synced clears the changed list', async () => {
    const h = await setupHarness('external-sync-watermark');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'harness-sync' });
      const created = parse<{ plan_uid: string }>(
        (await agent.callTool('create_plan_from_external', EPIC)).text,
      );

      const before = (await (await h.client.raw(
        'GET', `/api/plans/${encodeURIComponent(created.plan_uid)}/external-sync`,
      )).json()) as SyncState;
      expect(before.changed.length).toBeGreaterThan(0);

      // The AGENT pushes to the tracker and records the watermark —
      // CodeTrellis holds no credential, which is why the chip has no
      // "sync now" button. This asserts the endpoint reflects that.
      await agent.callTool('mark_external_synced', { plan_uid: created.plan_uid });

      const after = (await (await h.client.raw(
        'GET', `/api/plans/${encodeURIComponent(created.plan_uid)}/external-sync`,
      )).json()) as SyncState;
      expect(after.lastSyncedAt).not.toBeNull();
      expect(after.changed).toHaveLength(0);
    } finally {
      await h.teardown();
    }
  });

  test('a plan with no linked tickets reports nothing to sync', async () => {
    const h = await setupHarness('external-sync-none');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'A plan with no tracker behind it',
        projectPath: h.fixture.projectPath,
      });

      const state = (await (await h.client.raw(
        'GET', `/api/plans/${encodeURIComponent(plan.uid)}/external-sync`,
      )).json()) as SyncState;

      // The chip renders nothing in this case; the endpoint still has to
      // answer cleanly rather than 404, or the UI has an error state to
      // design for that should not exist.
      expect(state.changed).toHaveLength(0);
      expect(state.planRefs).toHaveLength(0);
    } finally {
      await h.teardown();
    }
  });
});
