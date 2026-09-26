/**
 * Multi-agent contention tests — proves `claim_item` actually
 * arbitrates between concurrent agents.
 *
 * Two scripted agents connect simultaneously, both call `claim_item`
 * on the same Action. Exactly one should win. Whoever loses should
 * see an "already claimed" response — not an error, not a silent
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
 *
 * Rewritten onto V2 (`add_item` / `claim_item`) for Phase 32 §0.3b; it
 * was skipped because `claim_task` was removed in the V2 migration
 * (docs/V2-MCP-MIGRATION.md §6). The scenarios are unchanged. Parallel
 * agents contending for work is exactly the case Phase 32 is about.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

interface ClaimResult {
  ok: boolean;
  message?: string;
  reason?: string;
}

async function seedAction(h: Harness, title: string): Promise<{ planUid: string; itemUid: string }> {
  const plan = await h.client.createPlan({ title, projectPath: h.fixture.projectPath });
  const seeder = await h.spawnAgent({ agentType: 'seeder' });
  const added = await seeder.callTool('add_item', {
    plan_uid: plan.uid,
    kind: 'action',
    title: 'Contended task',
    file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
  });
  expect(added.isError).not.toBe(true);
  return { planUid: plan.uid, itemUid: (JSON.parse(added.text) as { uid: string }).uid };
}

test.describe('Multi-agent contention', () => {
  test.setTimeout(120_000);

  test('two agents racing on claim_item — exactly one wins', async () => {
    const h = await setupHarness('multi-agent-claim-race');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const { itemUid } = await seedAction(h, 'Race plan');

      const [a, b] = await Promise.all([
        h.spawnAgent({ agentType: 'agent-a' }),
        h.spawnAgent({ agentType: 'agent-b' }),
      ]);

      // Race the two claims concurrently. The result's `ok` says who won;
      // the loser is refused politely ("already claimed"), not errored.
      const [resA, resB] = await Promise.all([a.claimItem(itemUid), b.claimItem(itemUid)]);
      expect(resA.isError).not.toBe(true);
      expect(resB.isError).not.toBe(true);
      const results = [resA, resB].map((r) => JSON.parse(r.text) as ClaimResult);

      const wins = results.filter((r) => r.ok);
      const losses = results.filter((r) => !r.ok);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      expect(losses[0].reason).toMatch(/already claimed|not pending/i);

      // The Action reflects the winning claim: assigned to one of the two
      // agents, and never back at `pending` (which would mean the claim
      // was lost).
      const res = await h.client.raw('GET', `/api/items/${itemUid}`);
      expect(res.ok).toBe(true);
      const item = (await res.json()) as { status: string; assignee: string | null };
      expect(['agent-a', 'agent-b']).toContain(item.assignee);
      expect(['assigned', 'in_progress']).toContain(item.status);
    } finally {
      await h.teardown();
    }
  });

  test('sequential claims on the same Action — second is rejected', async () => {
    // Sanity check: even without concurrency, a second claim should
    // fail. Catches the case where contention arbitration only
    // works under concurrent load.
    const h = await setupHarness('multi-agent-sequential');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const { itemUid } = await seedAction(h, 'Sequential plan');

      const agent = await h.spawnAgent({ agentType: 'sequential-a' });
      const otherAgent = await h.spawnAgent({ agentType: 'sequential-b' });

      const first = JSON.parse((await agent.claimItem(itemUid)).text) as ClaimResult;
      expect(first.ok).toBe(true);
      expect(first.message).toMatch(/claimed/i);

      const second = JSON.parse((await otherAgent.claimItem(itemUid)).text) as ClaimResult;
      expect(second.ok).toBe(false);
      expect(second.reason).toMatch(/already claimed|not pending/i);
    } finally {
      await h.teardown();
    }
  });
});
