/**
 * A new plan goes where the default visibility says, however it is made
 * (Phase 32 §0.6, found in the 0.5 audit as m20).
 *
 * Only the MCP `create_plan` wrote a new plan into `.codetrellis/plans/`
 * under a "shared" default. The app window's "New plan" goes through
 * REST, and the phone through `plan.create`, and both left the plan in
 * the database — "Local" beside a setting that says Shared.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone } from '../harness';

test.describe.serial('New plans follow the default visibility', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let phone: Phone;
  let root: string;

  const linked = async (uid: string) =>
    (await (await h.client.raw('GET', `/api/plans/${uid}/file-status?path=${encodeURIComponent(root)}`)).json()).linked as boolean;
  const createOverRest = async (title: string) =>
    (await (await h.client.raw('POST', '/api/plans', { title, projectPath: root })).json()).uid as string;

  test.beforeAll(async () => {
    h = await setupHarness('plan-default-visibility');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    phone = await pairPhone(h.client, { alias: 'Visibility phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await h?.teardown();
  });

  test('shared (the default): made over REST or on the phone, the plan is written into the project', async () => {
    expect((await (await h.client.raw('GET', '/api/settings')).json()).plans.defaultVisibility).toBe('shared');
    expect(await linked(await createOverRest('Shared over REST'))).toBe(true);
    const onPhone = await phone.rpc('plan.create', { title: 'Shared from the phone', projectPath: root });
    expect(await linked(onPhone.uid)).toBe(true);
  });

  test('local: made either way, the plan stays in the database', async () => {
    expect((await h.client.raw('PUT', '/api/settings', { plans: { defaultVisibility: 'local' } })).ok).toBe(true);
    expect(await linked(await createOverRest('Local over REST'))).toBe(false);
    const onPhone = await phone.rpc('plan.create', { title: 'Local from the phone', projectPath: root });
    expect(await linked(onPhone.uid)).toBe(false);
  });
});
