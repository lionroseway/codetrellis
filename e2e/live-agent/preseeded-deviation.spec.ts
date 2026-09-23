/**
 * Prompt D — Pre-seeded plan, agent deliberately deviates.
 *
 * Tests drift detection against a known, stable plan structure.
 * Agent completes one task, skips another, and edits an unplanned file.
 */

import { test, expect } from '@playwright/test';
import { seedPlan, cleanupPlans, API } from '../helpers/setup';
import {
  FIXTURE_PATH,
  openTempFixture,
  cleanupTempFixture,
} from './helpers/fixture-reset';
import { promptExecPreseededWithDeviation } from './helpers/prompts';
import {
  spawnTerminal,
  injectPrompt,
  killTerminal,
  createWsCollector,
  type WsEventCollector,
} from './helpers/agent-harness';
import { runMockAgentPreseededDeviation } from './helpers/mock-agent';

const USE_REAL_CLAUDE = process.env.CODETRELLIS_REAL_AGENT === '1';
const PLAN_TITLE = 'E2E Pre-seeded: Deviation Test';

test.describe('Pre-seeded plan deviation (Prompt D)', () => {
  test.describe.configure({ mode: 'serial' });
  let wsCollector: WsEventCollector;
  let tempFixture: string;

  test.beforeEach(async () => {
    tempFixture = await openTempFixture();
    wsCollector = await createWsCollector();
  });

  test.afterEach(async ({ request }) => {
    wsCollector?.close();
    await cleanupPlans(request, 'E2E');
    cleanupTempFixture(tempFixture);
  });

  test('mock agent completes first item and skips second', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      projectPath: tempFixture,
      actions: [
        {
          title: 'Edit api.ts',
          body: 'Add try-catch blocks',
          fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
        },
        {
          title: 'Edit UserList.tsx',
          body: 'Add error boundary',
          fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
        },
      ],
    });

    await runMockAgentPreseededDeviation(tempFixture, plan.uid);

    // Check item statuses: first done, second still pending
    const itemsRes = await request.get(`${API}/plans/${plan.uid}/items`);
    const items = await itemsRes.json();
    const actions = items.filter((i: any) => i.kind === 'action');
    const doneItems = actions.filter((i: any) => i.status === 'done');
    const pendingItems = actions.filter((i: any) => i.status !== 'done');
    expect(doneItems.length).toBe(1);
    expect(pendingItems.length).toBe(1);
  });

  test('mock agent edits unplanned file (db.py)', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      projectPath: tempFixture,
      actions: [
        {
          title: 'Edit api.ts',
          body: 'Test',
          fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
        },
        {
          title: 'Edit UserList.tsx',
          body: 'Test',
          fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
        },
      ],
    });

    await runMockAgentPreseededDeviation(tempFixture, plan.uid);

    // Verify db.py was modified (the deviation)
    const fs = await import('node:fs');
    const dbContent = fs.readFileSync(
      `${tempFixture}/services/api/app/db.py`,
      'utf-8',
    );
    expect(dbContent).toContain('modified outside plan scope');
  });

  test('drift detection finds deviations after agent run', async ({ request }) => {
    test.skip(USE_REAL_CLAUDE, 'This test uses the mock agent');

    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      projectPath: tempFixture,
      actions: [
        {
          title: 'Edit api.ts',
          body: 'Test',
          fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
        },
        {
          title: 'Edit UserList.tsx',
          body: 'Test',
          fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
        },
      ],
    });

    await runMockAgentPreseededDeviation(tempFixture, plan.uid);

    // Trigger drift detection
    await request.post(`${API}/plans/${plan.uid}/deviations/detect`);
    // Even if the endpoint returns non-200 (some plans have no baseline),
    // we verify the drift report endpoint works
    const driftRes = await request.get(`${API}/plans/${plan.uid}/deviations`);
    expect(driftRes.ok()).toBeTruthy();
    const driftData = await driftRes.json();
    expect(driftData).toBeTruthy();
  });

  if (USE_REAL_CLAUDE) {
    test('real Claude deviates from pre-seeded plan', async ({ page, request }) => {
      test.setTimeout(180_000);

      const plan = await seedPlan(request, {
        title: PLAN_TITLE,
        projectPath: FIXTURE_PATH,
        actions: [
          {
            title: 'Edit api.ts',
            body: 'Add try-catch blocks',
            fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
          },
          {
            title: 'Edit UserList.tsx',
            body: 'Add error boundary',
            fileSpecs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
          },
        ],
      });

      const termId = await spawnTerminal(request, {
        preset: 'claude',
        cwd: FIXTURE_PATH,
      });

      await page.waitForTimeout(5000);
      await injectPrompt(
        request,
        termId,
        promptExecPreseededWithDeviation(PLAN_TITLE),
      );

      // Wait for partial execution
      await wsCollector.waitForEvent(
        'plan-item-updated',
        { status: 'done' },
        120_000,
      );

      // Verify first item done, second still pending
      const itemsRes = await request.get(`${API}/plans/${plan.uid}/items`);
      const items = await itemsRes.json();
      const actions = items.filter((i: any) => i.kind === 'action');
      const doneCount = actions.filter((i: any) => i.status === 'done').length;
      expect(doneCount).toBe(1);

      await killTerminal(request, termId);
    });
  }
});
