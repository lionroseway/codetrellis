/**
 * Prompt B — Agent authors a plan from scratch, then executes it.
 *
 * Tests the full authoring → execution loop: create_plan, add_item,
 * page and phase Object items, then claim → edit → progress → done.
 *
 * Supports both real Claude (CODETRELLIS_REAL_AGENT=1) and mock agent.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, cleanupPlans, API } from '../helpers/setup';
import {
  FIXTURE_PATH,
  openTempFixture,
  cleanupTempFixture,
} from './helpers/fixture-reset';
import { promptAuthorAndExec } from './helpers/prompts';
import {
  spawnTerminal,
  injectPrompt,
  killTerminal,
  createWsCollector,
  getPlanUidByTitle,
  type WsEventCollector,
} from './helpers/agent-harness';
import { runMockAgentAuthored } from './helpers/mock-agent';

const USE_REAL_CLAUDE = process.env.CODETRELLIS_REAL_AGENT === '1';
const PLAN_TITLE = 'E2E Agent-Authored: Error Handling';

test.describe('Agent-authored plan flow (Prompt B)', () => {
  test.describe.configure({ mode: 'serial' });
  let wsCollector: WsEventCollector;
  let tempFixture: string;

  test.beforeEach(async () => {
    tempFixture = await openTempFixture();
    wsCollector = await createWsCollector();
  });

  test.afterEach(async ({ request }) => {
    wsCollector?.close();
    await cleanupPlans(request, 'E2E Agent-Authored');
    cleanupTempFixture(tempFixture);
  });

  test('mock agent authors and executes plan', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const planUid = await runMockAgentAuthored(tempFixture);
    expect(planUid).toBeTruthy();

    // Verify the plan was created with correct title
    const planRes = await request.get(`${API}/plans/${planUid}`);
    expect(planRes.ok()).toBeTruthy();
    const plan = await planRes.json();
    expect(plan.title).toBe(PLAN_TITLE);

    // All items should be done
    const itemsRes = await request.get(`${API}/plans/${planUid}/items`);
    const items = await itemsRes.json();
    const actions = items.filter((i: any) => i.kind === 'action');
    expect(actions.length).toBe(2);
    expect(actions.every((i: any) => i.status === 'done')).toBe(true);
  });

  // The summary page and the phase are Object items since the unified item
  // model replaced plan docs and phases; these read them back as items.
  test('mock agent creates a summary page via MCP', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const planUid = await runMockAgentAuthored(tempFixture);

    const itemsRes = await request.get(`${API}/plans/${planUid}/items`);
    expect(itemsRes.ok()).toBeTruthy();
    const items = await itemsRes.json();
    const page = items.find((i: any) => i.title === 'Error Handling Improvement');
    expect(page?.kind).toBe('object');
  });

  test('mock agent creates a phase via MCP', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const planUid = await runMockAgentAuthored(tempFixture);

    const itemsRes = await request.get(`${API}/plans/${planUid}/items`);
    expect(itemsRes.ok()).toBeTruthy();
    const items = await itemsRes.json();
    const phase = items.find((i: any) => i.title === 'Phase 1: Core error handling');
    expect(phase?.kind).toBe('object');
  });

  test('plan-created broadcast fires when agent creates plan', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const eventPromise = wsCollector.waitForEvent('plan-created', {}, 15_000);

    await runMockAgentAuthored(tempFixture);

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  test('plan-item-created broadcast fires for each item', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const eventPromise = wsCollector.waitForEvent('plan-item-created', {}, 15_000);

    await runMockAgentAuthored(tempFixture);

    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  // A summary page is an Object item now, so it arrives as
  // plan-item-created; there is no plan-doc-created any more.
  test('plan-item-created broadcast fires for the summary page', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    await runMockAgentAuthored(tempFixture);

    await expect.poll(() => wsCollector.getEvents().some((e) => {
      const item = (e.payload as { item?: { kind?: string; title?: string } }).item;
      return e.type === 'plan-item-created'
        && item?.kind === 'object'
        && item.title === 'Error Handling Improvement';
    }), { timeout: 15_000 }).toBe(true);
  });

  test('fixture files are modified by agent', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    await runMockAgentAuthored(tempFixture);

    // Verify the mock agent actually wrote to the fixture files
    const fs = await import('node:fs');
    const apiContent = fs.readFileSync(
      `${tempFixture}/packages/web/src/api.ts`,
      'utf-8',
    );
    expect(apiContent).toContain('Modified by mock agent');

    const userListContent = fs.readFileSync(
      `${tempFixture}/packages/web/src/UserList.tsx`,
      'utf-8',
    );
    expect(userListContent).toContain('Modified by mock agent');
  });

  if (USE_REAL_CLAUDE) {
    test('real Claude authors and executes plan via terminal', async ({ page, request }) => {
      test.setTimeout(180_000);

      await gotoWithProject(page, { projectPath: FIXTURE_PATH });

      const termId = await spawnTerminal(request, {
        preset: 'claude',
        cwd: FIXTURE_PATH,
      });

      await page.waitForTimeout(5000);
      await injectPrompt(request, termId, promptAuthorAndExec(FIXTURE_PATH));

      // Wait for plan authoring
      const planCreated = await wsCollector.waitForEvent('plan-created', {}, 60_000);
      expect(planCreated).toBeTruthy();

      const planUid = await getPlanUidByTitle(request, PLAN_TITLE);
      expect(planUid).toBeTruthy();

      // Wait for item creation + execution
      await wsCollector.waitForEvent('plan-item-created', {}, 30_000);
      await wsCollector.waitForEvent(
        'plan-item-updated',
        { status: 'done' },
        120_000,
      );

      // Verify via API
      const itemsRes = await request.get(`${API}/plans/${planUid}/items`);
      const items = await itemsRes.json();
      expect(items.length).toBeGreaterThan(0);

      // Verify a doc was created
      const docsRes = await request.get(`${API}/plans/${planUid}/docs`);
      const docs = await docsRes.json();
      expect(docs.length).toBeGreaterThan(0);

      await killTerminal(request, termId);
    });
  }
});
