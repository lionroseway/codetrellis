/**
 * Multi-agent contention tests — proves `claim_task` actually
 * arbitrates between concurrent agents.
 *
 * Two scripted agents connect simultaneously, both call `claim_task`
 * on the same task. Exactly one should win. Whoever loses should
 * see a "already claimed" response — not an error, not a silent
 * success.
 *
 * History: these tests originally surfaced a real upstream bug
 * where the backend kept a singleton `mcpServer` and the SDK's
 * `Server.connect(transport)` is single-transport, so the second
 * SSE connection re-bound the singleton and severed the first
 * client's stream. Fixed in `mcp/server.ts` by factoring tool
 * registration into `setupMcpServerInstance()` and building a
 * fresh server per SSE connection. Same process, same port — the
 * change is purely in-memory bookkeeping.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

test.describe('Multi-agent contention', () => {
  test.setTimeout(120_000);

  test('two agents racing on claim_task — exactly one wins', async () => {
    const h = await setupHarness('multi-agent-claim-race');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Race plan',
        projectPath: h.fixture.projectPath,
        tasks: [
          {
            description: 'Contended task',
            affectedFiles: ['packages/web/src/api.ts'],
          },
        ],
      });
      const detail = await h.client.getPlan(plan.uid);
      const taskUid = detail.tasks[0].uid;

      const [a, b] = await Promise.all([
        h.spawnAgent({ agentType: 'agent-a' }),
        h.spawnAgent({ agentType: 'agent-b' }),
      ]);

      // Race the two claims concurrently. The tool's text response
      // distinguishes a winning claim ("Task claimed.") from a
      // refusal ("Task already claimed or not pending.").
      const [resA, resB] = await Promise.all([
        a.claimTask(plan.uid, taskUid),
        b.claimTask(plan.uid, taskUid),
      ]);

      const isWin = (text: string) => /claimed/i.test(text) && !/already claimed/i.test(text);
      const isLoss = (text: string) => /already claimed|not pending/i.test(text);

      const wins = [resA, resB].filter((r) => isWin(r.text)).length;
      const losses = [resA, resB].filter((r) => isLoss(r.text)).length;

      expect(wins).toBe(1);
      expect(losses).toBe(1);

      // The plan's task should reflect the winning claim — its
      // assignedAgent should be one of the two agents (we don't
      // assert which; either is correct).
      const fresh = await h.client.getPlan(plan.uid);
      const t = fresh.tasks.find((t) => t.uid === taskUid);
      expect(t).toBeDefined();
      // Once claimed, status should be `assigned` or `in_progress`,
      // never `pending` (which would indicate the claim was lost).
      expect(['assigned', 'in_progress']).toContain(t!.status);
    } finally {
      await h.teardown();
    }
  });

  test('sequential claims on the same task — second is rejected', async () => {
    // Sanity check: even without concurrency, a second claim should
    // fail. Catches the case where contention arbitration only
    // works under concurrent load.
    const h = await setupHarness('multi-agent-sequential');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Sequential plan',
        projectPath: h.fixture.projectPath,
        tasks: [{ description: 'Task', affectedFiles: ['packages/web/src/api.ts'] }],
      });
      const detail = await h.client.getPlan(plan.uid);
      const taskUid = detail.tasks[0].uid;

      const agent = await h.spawnAgent({ agentType: 'sequential-a' });
      const otherAgent = await h.spawnAgent({ agentType: 'sequential-b' });

      const first = await agent.claimTask(plan.uid, taskUid);
      expect(first.text).toMatch(/claimed/i);
      expect(first.text).not.toMatch(/already claimed/i);

      const second = await otherAgent.claimTask(plan.uid, taskUid);
      expect(second.text).toMatch(/already claimed|not pending/i);
    } finally {
      await h.teardown();
    }
  });
});
