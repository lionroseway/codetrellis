/**
 * Prompt C — Agent authors a plan, then deliberately deviates.
 *
 * Tests the full authoring + drift loop: agent creates the plan AND
 * deviates from its own plan during execution.
 */

import { test, expect } from '@playwright/test';
import { cleanupPlans, API } from '../helpers/setup';
import {
  FIXTURE_PATH,
  openTempFixture,
  cleanupTempFixture,
} from './helpers/fixture-reset';
import { promptAuthorAndDeviate } from './helpers/prompts';
import {
  spawnTerminal,
  injectPrompt,
  killTerminal,
  createWsCollector,
  getPlanUidByTitle,
  type WsEventCollector,
} from './helpers/agent-harness';
import { runMockAgentDeviation } from './helpers/mock-agent';

const USE_REAL_CLAUDE = process.env.CODETRELLIS_REAL_AGENT === '1';
const PLAN_TITLE = 'E2E Agent-Deviation: Error Handling';

test.describe('Agent-authored plan deviation (Prompt C)', () => {
  test.describe.configure({ mode: 'serial' });
  let wsCollector: WsEventCollector;
  let tempFixture: string;

  test.beforeEach(async () => {
    tempFixture = await openTempFixture();
    wsCollector = await createWsCollector();
  });

  test.afterEach(async ({ request }) => {
    wsCollector?.close();
    await cleanupPlans(request, 'E2E Agent-Deviation');
    cleanupTempFixture(tempFixture);
  });

  test('mock agent authors plan then deviates', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const planUid = await runMockAgentDeviation(tempFixture);
    expect(planUid).toBeTruthy();

    // Plan should exist with correct title
    const planRes = await request.get(`${API}/plans/${planUid}`);
    const plan = await planRes.json();
    expect(plan.title).toBe(PLAN_TITLE);

    // Should have 2 items — first done, second pending (skipped)
    const itemsRes = await request.get(`${API}/plans/${planUid}/items`);
    const items = await itemsRes.json();
    const actions = items.filter((i: any) => i.kind === 'action');
    expect(actions.length).toBe(2);

    const done = actions.filter((i: any) => i.status === 'done');
    const notDone = actions.filter((i: any) => i.status !== 'done');
    expect(done.length).toBe(1);
    expect(notDone.length).toBe(1);
  });

  test('deviation modifies db.py outside plan scope', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    await runMockAgentDeviation(tempFixture);

    const fs = await import('node:fs');
    const content = fs.readFileSync(
      `${tempFixture}/services/api/app/db.py`,
      'utf-8',
    );
    expect(content).toContain('modified outside plan scope');
  });

  test('api.ts is modified (planned change)', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    await runMockAgentDeviation(tempFixture);

    const fs = await import('node:fs');
    const content = fs.readFileSync(
      `${tempFixture}/packages/web/src/api.ts`,
      'utf-8',
    );
    expect(content).toContain('Modified by mock agent');
  });

  test('UserList.tsx is NOT modified (deliberate skip)', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    await runMockAgentDeviation(tempFixture);

    const fs = await import('node:fs');
    const content = fs.readFileSync(
      `${tempFixture}/packages/web/src/UserList.tsx`,
      'utf-8',
    );
    expect(content).not.toContain('Modified by mock agent');
  });

  test('plan-created and plan-item-created events fire', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const createdPromise = wsCollector.waitForEvent('plan-created', {}, 15_000);
    const itemPromise = wsCollector.waitForEvent('plan-item-created', {}, 15_000);

    await runMockAgentDeviation(tempFixture);

    const created = await createdPromise;
    expect(created).toBeTruthy();
    const item = await itemPromise;
    expect(item).toBeTruthy();
  });

  test('drift detection reports deviations', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const planUid = await runMockAgentDeviation(tempFixture);

    // Trigger deviation detection
    await request.post(`${API}/plans/${planUid}/deviations/detect`);

    // Read deviations
    const devRes = await request.get(`${API}/plans/${planUid}/deviations`);
    expect(devRes.ok()).toBeTruthy();
    const deviations = await devRes.json();
    expect(deviations).toBeTruthy();
  });

  if (USE_REAL_CLAUDE) {
    test('real Claude authors then deviates via terminal', async ({ page, request }) => {
      test.setTimeout(180_000);

      const termId = await spawnTerminal(request, {
        preset: 'claude',
        cwd: FIXTURE_PATH,
      });

      await page.waitForTimeout(5000);
      await injectPrompt(request, termId, promptAuthorAndDeviate(FIXTURE_PATH));

      // Wait for plan authoring
      await wsCollector.waitForEvent('plan-created', {}, 60_000);
      const planUid = await getPlanUidByTitle(request, PLAN_TITLE);

      // Wait for partial execution
      await wsCollector.waitForEvent(
        'plan-item-updated',
        { status: 'done' },
        120_000,
      );

      // Verify first item done
      const itemsRes = await request.get(`${API}/plans/${planUid}/items`);
      const items = await itemsRes.json();
      const actions = items.filter((i: any) => i.kind === 'action');
      const doneCount = actions.filter((i: any) => i.status === 'done').length;
      expect(doneCount).toBe(1);

      await killTerminal(request, termId);
    });
  }
});
