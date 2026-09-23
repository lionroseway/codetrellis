/**
 * Prompt A — Agent executes a pre-seeded plan.
 *
 * The test harness creates the plan via REST API before the agent
 * starts.  Tests the execution engine in isolation: plan discovery
 * (list_plans), activation (set_active_plan), and the claim → edit →
 * progress → done loop.
 *
 * Supports both real Claude (CODETRELLIS_REAL_AGENT=1) and mock agent.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API } from '../helpers/setup';
import {
  FIXTURE_PATH,
  openTempFixture,
  cleanupTempFixture,
} from './helpers/fixture-reset';
import { promptExecPreseeded } from './helpers/prompts';
import {
  spawnTerminal,
  injectPrompt,
  killTerminal,
  createWsCollector,
  type WsEventCollector,
} from './helpers/agent-harness';
import { runMockAgentPreseeded } from './helpers/mock-agent';

const USE_REAL_CLAUDE = process.env.CODETRELLIS_REAL_AGENT === '1';
const PLAN_TITLE = 'E2E Pre-seeded: Error Handling';

test.describe('Pre-seeded plan execution (Prompt A)', () => {
  test.describe.configure({ mode: 'serial' });
  let wsCollector: WsEventCollector;
  let tempFixture: string;

  test.beforeEach(async () => {
    tempFixture = await openTempFixture();
    wsCollector = await createWsCollector();
  });

  test.afterEach(async ({ request }) => {
    wsCollector?.close();
    await cleanupPlans(request, 'E2E Pre-seeded: Error');
    cleanupTempFixture(tempFixture);
  });

  test('pre-seeded plan exists before agent starts', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      projectPath: tempFixture,
      actions: [
        {
          title: 'Add try-catch to API fetch calls',
          body: 'Wrap fetch() calls in api.ts with try-catch',
          fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
        },
        {
          title: 'Add error boundary to UserList',
          body: 'Add error handling to UserList.tsx',
          fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
        },
      ],
    });

    expect(plan.uid).toBeTruthy();
    expect(plan.actionUids.length).toBe(2);

    // Verify via GET
    const res = await request.get(`${API}/plans/${plan.uid}`);
    expect(res.ok()).toBeTruthy();
    const fetched = await res.json();
    expect(fetched.title).toBe(PLAN_TITLE);
  });

  test('mock agent executes pre-seeded plan to completion', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      projectPath: tempFixture,
      actions: [
        {
          title: 'Add try-catch to API fetch calls',
          body: 'Wrap fetch() calls in api.ts with try-catch',
          fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
        },
        {
          title: 'Add error boundary to UserList',
          body: 'Add error handling to UserList.tsx',
          fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
        },
      ],
    });

    await runMockAgentPreseeded(tempFixture, plan.uid);

    // Verify all items are done
    const itemsRes = await request.get(`${API}/plans/${plan.uid}/items`);
    const items = await itemsRes.json();
    const actionItems = items.filter((i: any) => i.kind === 'action');
    expect(actionItems.length).toBe(2);
    expect(actionItems.every((i: any) => i.status === 'done')).toBe(true);
  });

  test('agent session registers via MCP', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      projectPath: tempFixture,
      actions: [
        {
          title: 'Test action',
          body: 'Test body',
          fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
        },
      ],
    });

    await runMockAgentPreseeded(tempFixture, plan.uid);

    // Verify agent session was registered
    const sessRes = await request.get(`${API}/sessions`);
    expect(sessRes.ok()).toBeTruthy();
  });

  test('plan-item-updated broadcast fires on task completion', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      projectPath: tempFixture,
      actions: [
        {
          title: 'Single action',
          body: 'Test',
          fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
        },
      ],
    });

    // Start waiting for the event BEFORE the agent runs
    const eventPromise = wsCollector.waitForEvent('plan-item-updated', {}, 15_000);

    await runMockAgentPreseeded(tempFixture, plan.uid);

    // Event should have arrived
    const evt = await eventPromise;
    expect(evt).toBeTruthy();
  });

  if (USE_REAL_CLAUDE) {
    test('real Claude executes pre-seeded plan via terminal inject', async ({ page, request }) => {
      await gotoWithProject(page, { projectPath: FIXTURE_PATH });

      const plan = await seedPlan(request, {
        title: PLAN_TITLE,
        projectPath: FIXTURE_PATH,
        actions: [
          {
            title: 'Add try-catch to API fetch calls',
            body: 'Wrap fetch() calls in api.ts with try-catch',
            fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
          },
          {
            title: 'Add error boundary to UserList',
            body: 'Add error handling to UserList.tsx',
            fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
          },
        ],
      });

      // Verify plan visible in UI
      await page.getByRole('button', { name: 'Plans', exact: true }).click();
      await expect(page.locator(`text=${PLAN_TITLE}`)).toBeVisible({ timeout: 5000 });

      // Spawn Claude terminal
      const termId = await spawnTerminal(request, {
        preset: 'claude',
        cwd: FIXTURE_PATH,
      });

      // Wait for shell + Claude startup
      await page.waitForTimeout(5000);

      // Inject execution prompt
      await injectPrompt(request, termId, promptExecPreseeded(PLAN_TITLE));

      // Wait for completion
      const doneEvent = await wsCollector.waitForEvent(
        'plan-item-updated',
        { status: 'done' },
        120_000,
      );
      expect(doneEvent).toBeTruthy();

      // Verify items are done via API
      const itemsRes = await request.get(`${API}/plans/${plan.uid}/items`);
      const items = await itemsRes.json();
      const actionItems = items.filter((i: any) => i.kind === 'action');
      expect(actionItems.every((i: any) => i.status === 'done')).toBe(true);

      await killTerminal(request, termId);
    });
  }
});
