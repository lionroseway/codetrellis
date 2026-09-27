/**
 * Two agents of one type are two claimants, end to end (Phase 32 A0, bug 1).
 *
 * `claim_item` recorded the agent's type as the assignee, so a second Claude
 * Code session claiming work on a file the first was already changing was
 * told nothing: the overlap check thought it was the same claimant. Now the
 * claim records the session, and the claim's author is who made it.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Parallel claims', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let planUid: string;
  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const action = (title: string) => req('POST', `/api/plans/${planUid}/items`, {
    kind: 'action', title, fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
  });

  test.beforeAll(async () => {
    h = await setupHarness('parallel-claims');
    await h.client.scanProject(h.fixture.projectPath);
    planUid = (await req('POST', '/api/plans', { title: 'Parallel work', projectPath: h.fixture.projectPath })).uid;
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('a second Claude Code session is told the first is already changing the file', async () => {
    const one = await h.spawnAgent({ agentType: 'claude-code' });
    const two = await h.spawnAgent({ agentType: 'claude-code' });
    const a = await action('Cache prices');
    const b = await action('Retry on 503');

    const first = await one.callTool('claim_item', { uid: a.uid });
    expect(first.isError, first.text).not.toBe(true);
    expect(first.text).not.toMatch(/also affects/);

    const second = await two.callTool('claim_item', { uid: b.uid });
    expect(second.isError, second.text).not.toBe(true);
    expect(second.text).toMatch(/Cache prices.*also affects: packages\/web\/src\/api\.ts/);

    // Both show the agent that holds them, and each claim is recorded as that agent's own.
    for (const uid of [a.uid, b.uid]) {
      const item = await req('GET', `/api/items/${uid}`);
      expect(item).toMatchObject({ assignee: 'claude-code', status: 'assigned' });
      const versions = await req('GET', `/api/items/${uid}/versions`) as Array<{ authorType?: string; author?: string }>;
      expect(versions[0]).toMatchObject({ author: 'claude-code' });
    }
  });
});
