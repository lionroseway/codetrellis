/**
 * Agent-driven loop tests — exercises the same feedback chain as
 * `loop.test.ts`, but the actor is a real MCP client connected over
 * SSE (the same wire format Claude Code / Codex / Cursor use).
 *
 * What this layer adds beyond the REST loop test:
 *   - Verifies the MCP transport itself works on the spawned port.
 *   - Verifies the V2 agent tools (`add_item`, `get_next_item`,
 *     `claim_item`, `update_item`) do what their descriptions say.
 *   - Verifies auto-progress reaches V2 Actions: an agent editing an
 *     Action's files moves it to in_progress without being told.
 *   - Catches MCP SDK regressions before they ship to humans.
 *
 * Rewritten onto V2 for Phase 32 §0.3b. It was skipped because it drove
 * the V1 task tools the V2 migration removed (docs/V2-MCP-MIGRATION.md
 * §6); the scenarios are unchanged. Rewriting the second one found that
 * auto-progress only ever advanced V1 tasks, which the workspace no
 * longer renders — fixed in plan-progress-service in the same change.
 *
 * No real LLM. No API keys. Fully offline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, waitFor, type Harness } from '../harness';

interface ItemRow {
  uid: string;
  kind: string;
  status: string | null;
  assignee?: string | null;
}

async function getItem(h: Harness, uid: string): Promise<ItemRow> {
  const res = await h.client.raw('GET', `/api/items/${uid}`);
  expect(res.ok).toBe(true);
  return (await res.json()) as ItemRow;
}

test.describe('Agent-driven loop (via MCP)', () => {
  test.setTimeout(120_000);

  test('agent connects, finds the next Action, claims it, reports done — REST sees it', async () => {
    const h = await setupHarness('agent-loop-claim');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Agent claim flow',
        projectPath: h.fixture.projectPath,
      });

      const agent = await h.spawnAgent({
        agentType: 'harness-claude',
        model: 'harness-test/1.0',
      });

      // 1. The MCP server should advertise the tools we depend on.
      const tools = await agent.mcp.listTools();
      const toolNames = new Set(tools.map((t) => t.name));
      for (const required of ['register_session', 'add_item', 'get_next_item', 'claim_item', 'update_item']) {
        expect(toolNames.has(required), `missing MCP tool: ${required}`).toBe(true);
      }

      // 2. One Action targeting a known fixture file.
      const added = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Update the API client',
        file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
      });
      expect(added.isError).not.toBe(true);
      const itemUid = (JSON.parse(added.text) as ItemRow).uid;
      expect((await getItem(h, itemUid)).status).toBe('pending');

      // 3. get_next_item offers it.
      const next = await agent.getNextItem(plan.uid);
      expect(next.isError).not.toBe(true);
      expect((JSON.parse(next.text) as ItemRow).uid).toBe(itemUid);

      // 4. Claim it.
      const claim = await agent.claimItem(itemUid);
      expect(claim.isError).not.toBe(true);
      const claimed = JSON.parse(claim.text) as { ok: boolean; message: string };
      expect(claimed.ok).toBe(true);
      expect(claimed.message).toMatch(/claimed/i);

      // 5. Mark it in_progress, then done.
      const inflight = await agent.updateItemStatus(itemUid, 'in_progress');
      expect(inflight.isError).not.toBe(true);
      const finished = await agent.updateItemStatus(itemUid, 'done');
      expect(finished.isError).not.toBe(true);

      // 6. REST sees the Action done.
      const final = await waitFor(
        async () => {
          const fresh = await getItem(h, itemUid);
          return fresh.status === 'done' ? fresh : null;
        },
        { timeoutMs: 5000, description: `action ${itemUid} to land in done via MCP update_item` },
      );
      expect(final.status).toBe('done');
    } finally {
      await h.teardown();
    }
  });

  test('agent file edit on an Action\'s file = auto-progress fires', async () => {
    // Tighter version of loop.test.ts, with the agent in the loop and
    // on the V2 model. Proves: an agent's file edit is seen by the
    // watcher and moves the Action whose file specs name that file.
    const h = await setupHarness('agent-loop-auto-progress');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Agent auto-progress',
        projectPath: h.fixture.projectPath,
      });

      const agent = await h.spawnAgent({ agentType: 'harness-codex' });
      const added = await agent.callTool('add_item', {
        plan_uid: plan.uid,
        kind: 'action',
        title: 'Edit the validators',
        file_specs: [{ path: 'packages/shared/src/validators.ts', action: 'modify' }],
      });
      expect(added.isError).not.toBe(true);
      const itemUid = (JSON.parse(added.text) as ItemRow).uid;
      expect((await getItem(h, itemUid)).status).toBe('pending');

      // Agents edit files with their own native tools and then report;
      // there is deliberately no MCP "write file" tool.
      const before = fs.readFileSync(path.join(h.fixture.projectPath, 'packages/shared/src/validators.ts'), 'utf-8');
      await agent.writeFile(
        'packages/shared/src/validators.ts',
        `${before}\n// Edited by harness-codex via scripted-agent.writeFile()\n`,
      );

      const advanced = await waitFor(
        async () => {
          const fresh = await getItem(h, itemUid);
          return fresh.status === 'in_progress' ? fresh : null;
        },
        // Same 20 s buffer rationale as `loop.test.ts` — generous on
        // green, only matters when the system is under load.
        { timeoutMs: 20_000, description: `action ${itemUid} to advance via file watcher` },
      );
      expect(advanced.status).toBe('in_progress');
    } finally {
      await h.teardown();
    }
  });
});
