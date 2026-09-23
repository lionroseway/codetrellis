/**
 * Phase 31.0 — every field the item editor sends is actually saved.
 *
 * `PUT /api/items/:uid` named its fields one by one and had fallen behind
 * the editor. The approval-gate toggle, the routing panel (skills, claim
 * policy, execution config, constraints), symbol targets and the
 * shared/local toggle all sent fields the handler never passed on. The
 * response was the unchanged item, the store rendered it, and each control
 * looked as if it had simply not taken.
 *
 * These tests go through the route the UI uses and read the item back
 * independently, so a field dropped again fails here rather than in a
 * user's hands.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('PUT /api/items/:uid saves what the editor sends', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let itemUid: string;

  test.beforeAll(async () => {
    h = await setupHarness('item-edit-fields');
    await h.client.scanProject(h.fixture.projectPath);
    const plan = await h.client.createPlan({ title: 'Item fields', projectPath: h.fixture.projectPath });
    const res = await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title: 'Editable' });
    itemUid = (await res.json()).uid;
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  async function readBack(): Promise<Record<string, unknown>> {
    const res = await h.client.raw('GET', `/api/items/${itemUid}`);
    expect(res.ok).toBe(true);
    return await res.json();
  }

  test('the approval gate toggle', async () => {
    const on = await h.client.raw('PUT', `/api/items/${itemUid}`, { requiresApproval: true });
    expect(on.ok).toBe(true);
    expect((await readBack()).requiresApproval).toBe(true);

    await h.client.raw('PUT', `/api/items/${itemUid}`, { requiresApproval: false });
    expect((await readBack()).requiresApproval).toBe(false);
  });

  test('routing: skills, claim policy, execution config, constraints', async () => {
    const res = await h.client.raw('PUT', `/api/items/${itemUid}`, {
      skills: [{ name: 'sql-review' }],
      skillsMode: 'replace',
      claimPolicy: { allowedAgents: ['claude-code'] },
      claimPolicyMode: 'replace',
      executionConfig: { model: 'fast' },
      executionConfigMode: 'replace',
      constraints: { readOnlyPaths: ['migrations/'] },
      constraintsMode: 'replace',
    });
    expect(res.ok).toBe(true);

    const item = await readBack();
    expect(item.skills).toEqual([{ name: 'sql-review' }]);
    expect(item.skillsMode).toBe('replace');
    expect(item.claimPolicy).toEqual({ allowedAgents: ['claude-code'] });
    expect(item.claimPolicyMode).toBe('replace');
    expect(item.executionConfig).toEqual({ model: 'fast' });
    expect(item.executionConfigMode).toBe('replace');
    expect(item.constraints).toEqual({ readOnlyPaths: ['migrations/'] });
    expect(item.constraintsMode).toBe('replace');
  });

  test('symbol targets and visibility', async () => {
    const symbolSpecs = [{ name: 'main', kind: 'function', action: 'modify', filePath: 'src/index.ts' }];
    const res = await h.client.raw('PUT', `/api/items/${itemUid}`, { symbolSpecs, visibility: 'local' });
    expect(res.ok).toBe(true);

    const item = await readBack();
    expect(item.symbolSpecs).toEqual(symbolSpecs);
    expect(item.visibility).toBe('local');
  });

  test('a value the reader would not understand is refused, not stored', async () => {
    const badMode = await h.client.raw('PUT', `/api/items/${itemUid}`, { skillsMode: 'sometimes' });
    expect(badMode.status).toBe(400);

    const badVisibility = await h.client.raw('PUT', `/api/items/${itemUid}`, { visibility: 'public' });
    expect(badVisibility.status).toBe(400);

    const item = await readBack();
    expect(item.skillsMode).toBe('replace');
    expect(item.visibility).toBe('local');
  });
});
